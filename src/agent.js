import { getCtx, truncate, joinTags, withTimeout, clamp, slashSafe, normalizeUrl } from './util.js';
import { getSettings, notify, getRecordByUrl } from './config.js';
import { generateImage, recordExternalImage } from './comfy.js';
import {
    cleanTriggerTags, stripThinkingTags, stripImageMarkdown, readTags, stripTagsInMessage,
    contentSig, snapshotTarget, deliverRoleplayImage, replaceImageUrl, lastAssistantIndex
} from './chat.js';
import { passesGate } from './prefilter.js';
import { reviewPrompt, pickCandidate } from './dialogs.js';
import { emit } from './bus.js';
import { waitForStIdle } from './stb.js';

// ===========================================================================
//  The agent loop:   SENSE (free, local)  ->  DECIDE (one cheap LLM call)  ->  ACT (queued)
// ===========================================================================

const AGENT_SYSTEM_PROMPT =
    'You are an expert anime and visual director generating precise image generation prompts for diffusion models. ' +
    'Your absolute priority is CHARACTER FIDELITY: preserve every visual trait from the Character Reference verbatim — ' +
    'hair color, hair style and length, eye color, skin tone, body type, bust/hips, height, distinguishing marks (scars, ' +
    'tattoos, glasses, heterochromia), and default accessories. Never invent, swap, or paraphrase these traits. ' +
    'If the Character Reference contains an [VISUAL APPEARANCE] block, treat it as the single source of truth and copy its ' +
    'wording directly into the prompt. If a visual trait is missing from [VISUAL APPEARANCE] but present in [CHARACTER DESCRIPTION], ' +
    'infer it from there. Only if a trait is completely absent should you fall back to generic conventions for that character archetype. ' +
    'Accurately capture the current scene from the latest response (action, pose, expression, current clothing/attire, environment/setting, ' +
    'lighting, camera angle). If the scene describes an outfit change or specific attire, depict that outfit; otherwise use the Character ' +
    'Reference outfit. Respond ONLY with the requested JSON object.';

const MAX_MSG_CHARS = 4000;
const MAX_CHAR_DESC = 6000;
const MAX_QUEUE = 3;
const MODE2_KEY = 'illustration_agent_mode2';

let runToken = 0;          
let evalAbort = null;      
const queue = [];          
let queueRunning = false;
let currentJobAbort = null;

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function refreshStatus(detail = '') {
    const state = evalAbort ? 'evaluating' : (queueRunning || queue.length ? 'generating' : 'idle');
    emit('status', state, detail || (queue.length ? `${queue.length} queued` : ''));
}

export function resetAgentState() {
    runToken++;
    try { evalAbort?.abort(); } catch (_) {}
    evalAbort = null;
    refreshStatus();
}

export function cancelAll() {
    queue.length = 0;
    try { currentJobAbort?.abort(); } catch (_) {}
    resetAgentState();
    notify('info', 'Cancelled running and queued illustrations.');
}

function enqueue(job) {
    if (queue.length >= MAX_QUEUE) {
        queue.shift();
        notify('warning', 'Illustration queue is full: dropped the oldest job.');
    }
    queue.push(job);
    refreshStatus();
    runQueue();
}

async function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    while (queue.length) {
        const job = queue.shift();
        currentJobAbort = new AbortController();
        refreshStatus();
        try { await job(currentJobAbort.signal); }
        catch (e) {
            if (e?.name === 'AbortError' || /Cancelled/.test(e?.message || '')) console.log('[Illustration Agent] job cancelled');
            else { console.error('[Illustration Agent] job failed', e); notify('error', e.message || String(e)); }
        }
        currentJobAbort = null;
    }
    queueRunning = false;
    refreshStatus();
}

// ---------------------------------------------------------------------------
// Mode 2: Inject <image> instruction
// ---------------------------------------------------------------------------
export function syncMode2Injection() {
    try {
        const s = getSettings();
        const ctx = getCtx();
        if (typeof ctx.setExtensionPrompt !== 'function') return;
        const on = s.enabled && s.agentMode === 'mode2' && s.mode2Inject && (s.mode2InjectionText || '').trim();
        const IN_CHAT = ctx.extension_prompt_types?.IN_CHAT ?? 1;
        ctx.setExtensionPrompt(MODE2_KEY, on ? s.mode2InjectionText.trim() : '', IN_CHAT, 1, false, 0);
    } catch (e) { console.warn('[Illustration Agent] could not sync Mode 2 instruction', e); }
}

// ---------------------------------------------------------------------------
// LLM access
// ---------------------------------------------------------------------------
export async function queryAgentLLM(prompt, signal = null) {
    const s = getSettings();
    const ctx = getCtx();
    const ms = (s.llmTimeoutSec || 45) * 1000;

    if (s.llmProvider === 'custom') {
        const url = `${(s.customLlmUrl || '').replace(/\/+$/, '')}/chat/completions`;
        const ctl = new AbortController();
        signal?.addEventListener('abort', () => ctl.abort(), { once: true });
        const timer = setTimeout(() => ctl.abort(), ms);
        try {
            const resp = await fetch(url, {
                method: 'POST', signal: ctl.signal,
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s.customLlmKey || ''}` },
                body: JSON.stringify({
                    model: s.customLlmModel,
                    messages: [{ role: 'system', content: AGENT_SYSTEM_PROMPT }, { role: 'user', content: prompt }],
                    temperature: 0.2, max_tokens: 900
                })
            });
            if (!resp.ok) throw new Error(`Custom LLM HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
            const content = (await resp.json())?.choices?.[0]?.message?.content;
            if (!content) throw new Error('Custom LLM returned an empty response.');
            return content;
        } finally { clearTimeout(timer); }
    }

    if (s.llmProvider === 'profile') {
        if (!s.connectionProfile) throw new Error('Pick a Connection Profile in the Evaluator section.');
        let svc = ctx.ConnectionManagerRequestService;
        if (!svc?.sendRequest) {
            try { svc = (await import(new URL('/scripts/extensions/shared.js', location.origin).href)).ConnectionManagerRequestService; } catch (_) {}
        }
        if (!svc?.sendRequest) throw new Error('Connection Manager is not available in this SillyTavern.');
        const messages = [{ role: 'system', content: AGENT_SYSTEM_PROMPT }, { role: 'user', content: prompt }];
        try {
            const built = typeof svc.constructPrompt === 'function' ? svc.constructPrompt(messages, s.connectionProfile) : messages;
            const res = await withTimeout(svc.sendRequest(
                s.connectionProfile, built, 900,
                { stream: false, signal, extractData: true, includePreset: true, includeInstruct: true }
            ), ms, 'Connection profile request');
            const content = typeof res === 'string' ? res : res?.content;
            if (!content) throw new Error('The connection profile returned an empty response.');
            return content;
        } catch (e) {
            throw new Error(e?.cause?.message ? `${e.message}: ${e.cause.message}` : e.message);
        }
    }

    if (typeof ctx.generateRaw === 'function') {
        return await withTimeout(ctx.generateRaw({
            systemPrompt: AGENT_SYSTEM_PROMPT, prompt, responseLength: 800, trimNames: false
        }), ms, 'Evaluator');
    }
    return await withTimeout(ctx.generateQuietPrompt(prompt, false, true), ms, 'Evaluator');
}

// ---------------------------------------------------------------------------
// Parsing the agent's JSON
// ---------------------------------------------------------------------------
function extractJsonObject(text) {
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
    }
    return null;
}

export function parseAgentResult(raw) {
    const text = stripThinkingTags(String(raw || '')).replace(/```(?:json)?/gi, '');
    const json = extractJsonObject(text);
    if (!json) throw new Error('The evaluator did not return a JSON object.');
    let obj;
    try { obj = JSON.parse(json); }
    catch { obj = JSON.parse(json.replace(/,\s*([}\]])/g, '$1')); }
    const d = obj.decision;
    const yes = d === true || /^y/i.test(String(d ?? ''));
    return {
        decision: yes ? 'yes' : 'no',
        description: String(obj.description || '').trim(),
        prompt: String(obj.prompt || '').trim(),
        negativePrompt: String(obj.negativePrompt || obj.negative_prompt || '').trim(),
        aspectRatio: ['portrait', 'landscape', 'square'].includes(obj.aspectRatio) ? obj.aspectRatio : 'portrait'
    };
}

function resultFromTags(tags) {
    return {
        decision: 'yes',
        description: (tags.scene || tags.image || '').slice(0, 250),
        prompt: [tags.image, tags.scene].filter(Boolean).join(', '),
        negativePrompt: '',
        aspectRatio: tags.scene && !tags.image ? 'landscape' : 'portrait'
    };
}

// ---------------------------------------------------------------------------
// Sensing helpers
// ---------------------------------------------------------------------------
const isAssistant = (m) => m && !m.is_user && !m.is_system;

export function intervalDue(chat, idx, interval) {
    const n = chat.slice(0, idx + 1).filter(isAssistant).length;
    return n % Math.max(1, interval || 3) === 0;
}

export function turnsSinceIllustration(chat, idx) {
    let d = 1;
    for (let i = idx - 1; i >= 0; i--) {
        if (!isAssistant(chat[i])) continue;
        if (chat[i].extra?.ia_done) return d;
        d++;
    }
    return Infinity;
}

function findCharacter(ctx, msg) {
    const chars = ctx.characters || [];
    if (!chars.length) return null;
    if (msg.original_avatar) {
        const c = chars.find(x => x.avatar === msg.original_avatar || x.data?.avatar === msg.original_avatar);
        if (c) return c;
    }
    if (msg.name) {
        const msgName = msg.name.trim().toLowerCase();
        const c = chars.find(x =>
            (x.name && x.name.trim().toLowerCase() === msgName) ||
            (x.data?.name && x.data.name.trim().toLowerCase() === msgName)
        );
        if (c) return c;
    }
    const chId = ctx.characterId ?? ctx.this_chid;
    if (chId != null) {
        if (typeof chId === 'number' && chars[chId]) return chars[chId];
        const c = chars.find(x => x.id === chId || x.avatar === chId || String(x.name).toLowerCase() === String(chId).toLowerCase());
        if (c) return c;
    }
    return chars.length === 1 ? chars[0] : null;
}

// ---------------------------------------------------------------------------
// FIX 1: Appearance-aware character extraction.
// Many modern character cards ship a dedicated "appearance" field (Marinara
// ecosystem, V2 character cards with a visual sheet, etc). We now look for it
// under several naming conventions and mark it as the single source of truth.
// If it is absent we fall back to the description, but we tag the block so the
// LLM knows it must extract visual traits itself rather than paraphrase.
// ---------------------------------------------------------------------------
function pickAppearance(d, ch) {
    const candidates = [
        d?.appearance,
        d?.character_appearance,
        d?.visual_description,
        d?.appearance_notes,
        d?.extensions?.appearance,
        d?.extensions?.visual,
        d?.extensions?.character_sheet,
        ch?.appearance
    ];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim();
        if (c && typeof c === 'object') {
            // Some ecosystems store { hair, eyes, body, outfit } style objects.
            const flat = Object.entries(c)
                .filter(([, v]) => typeof v === 'string' && v.trim())
                .map(([k, v]) => `${k.replace(/[_-]+/g, ' ')}: ${v.trim()}`)
                .join('\n');
            if (flat) return flat;
        }
    }
    return '';
}

function extractCharacterDetails(ch) {
    if (!ch) return '';
    const d = ch.data || ch;
    const parts = [];

    // 1. Explicit visual appearance block — highest priority for the image LLM.
    const appearance = pickAppearance(d, ch);
    if (appearance) {
        parts.push(`[VISUAL APPEARANCE — single source of truth for character design, copy verbatim]\n${appearance}`);
    } else {
        parts.push(
            '[VISUAL APPEARANCE — no dedicated appearance field was found on this card]\n' +
            'No explicit appearance data. Extract every visual trait you can find from the Character Description below ' +
            'and use it verbatim. Do not invent traits that are not implied by the description.'
        );
    }

    // 2. Description (may contain supplemental visual detail).
    const desc = d.description || ch.description || '';
    if (desc.trim()) parts.push(`[CHARACTER DESCRIPTION]\n${desc.trim()}`);

    // 3. Personality.
    const personality = d.personality || ch.personality || '';
    if (personality.trim()) parts.push(`[PERSONALITY & TRAITS — informs expression and posture only, not appearance]\n${personality.trim()}`);

    // 4. Scenario.
    const scenario = d.scenario || ch.scenario || '';
    if (scenario.trim()) parts.push(`[SCENARIO & SETTING]\n${scenario.trim()}`);

    // 5. Tags.
    const tags = Array.isArray(d.tags) ? d.tags.filter(Boolean).join(', ') : (d.tags || ch.tags || '');
    if (tags.trim()) parts.push(`[VISUAL TAGS]\n${tags.trim()}`);

    // 6. mes_example / first_mes often contain the character's default outfit
    //    described in prose — useful when appearance and description are thin.
    if (!appearance) {
        const first = d.first_mes || ch.first_mes || '';
        if (first.trim()) parts.push(`[OPENING SCENE (for default outfit / environment cues only)]\n${truncate(first.trim(), 1200)}`);
    }

    return parts.join('\n\n');
}

function extractUserDetails(ctx) {
    const name = ctx.name1 || 'User';
    const persona = ctx.persona || ctx.power_user?.persona_description || '';
    if (!persona.trim()) return `User Name: ${name} (no persona description set)`;
    // Raised the old 800-char cap — personas often describe the user's outfit and body.
    return `User (${name}) Reference:\n${truncate(persona.trim(), 2000)}`;
}

// ---------------------------------------------------------------------------
// FIX 2: Reasoning-aware message compaction.
// Modern reasoning models in SillyTavern store chain-of-thought in
// message.extra.reasoning (and variants) instead of inline <think>...</think>
// tags. The old code only stripped inline tags, so the includeThinking toggle
// had nothing to work with. We now:
//   * pull extra.reasoning / reasoning_content / thinking when includeThinking is on
//   * keep inline <think> blocks when includeThinking is on
//   * strip both when includeThinking is off
// ---------------------------------------------------------------------------
function getReasoning(m) {
    const ex = m?.extra || {};
    return String(
        ex.reasoning || ex.reasoning_content || ex.reasoning_text || ex.thinking || ''
    ).trim();
}

function compact(m, s, ctx) {
    let t = cleanTriggerTags(m.mes || '');
    if (s.includeThinking) {
        const reasoning = getReasoning(m);
        if (reasoning) {
            t = `[Inner reasoning]\n${reasoning}\n\n[Visible reply]\n${t}`;
        }
        // inline <think> blocks are intentionally left intact when includeThinking is on
    } else {
        t = stripThinkingTags(t);
    }
    t = stripImageMarkdown(t);
    const speaker = m.name || (m.is_user ? (ctx?.name1 || 'User') : 'Assistant');
    const cap = s.includeThinking ? 3500 : 2500;
    return `${speaker}: ${truncate(t, cap)}`;
}

function buildPrompt({ schema, ctx, chat, idx, msg, tags, mode }) {
    const s = getSettings();
    const look = Math.max(1, parseInt(s.lookback) || 3);
    const recent = chat.slice(Math.max(0, idx - look), idx);
    const ch = findCharacter(ctx, msg);
    const charDesc = extractCharacterDetails(ch);
    const userDesc = extractUserDetails(ctx);

    let tagBlock = '';
    if (tags?.has && (mode === 'mode2' || mode === 'forced-tags')) {
        tagBlock = '\n[VISUAL DESCRIPTION EXTRACTED FROM THE ASSISTANT\'S RESPONSE:]\n';
        if (tags.image) tagBlock += `-> ${tags.image}\n`;
        if (tags.scene) tagBlock += `-> ${tags.scene}\n`;
        tagBlock += 'CONVERT THIS EXACT DESCRIPTION INTO DETAILED BOORU TAGS AND STRICTLY INCLUDE THE CHARACTER TRAITS BELOW.\n';
    }

    let last = cleanTriggerTags(msg.mes || '');
    if (!s.includeThinking) last = stripThinkingTags(last);
    last = stripImageMarkdown(last);

    return `${schema}

[CHARACTER REFERENCE]
Primary Character: ${ch?.name || msg.name || 'Character'}
${truncate(charDesc, MAX_CHAR_DESC)}

FIDELITY RULES (mandatory):
- Treat the [VISUAL APPEARANCE] block as authoritative. Copy hair color, eye color, hair length/style, body type, skin tone and any distinguishing marks from it word-for-word into the prompt.
- If a required visual trait is not listed in [VISUAL APPEARANCE], check the [CHARACTER DESCRIPTION] and [VISUAL TAGS] blocks before falling back on generic conventions.
- Never swap hair color, eye color, or body type for a different value just because the scene mood changed.

[USER REFERENCE]
${userDesc}

[RECENT CONTEXT (for continuity)]
${recent.map(m => compact(m, s, ctx)).join('\n\n') || '(Start of conversation)'}
${tagBlock}
[CURRENT ASSISTANT RESPONSE TO ILLUSTRATE]
Character Speaking/Acting: ${ch?.name || msg.name || 'Character'}
Response:
${truncate(last, MAX_MSG_CHARS)}`;
}

function sizeFor(aspect, s) {
    if (aspect === 'landscape') return [s.resLandscapeW || 1216, s.resLandscapeH || 832];
    if (aspect === 'square') return [s.resSquareW || 1024, s.resSquareH || 1024];
    return [s.resPortraitW || 832, s.resPortraitH || 1216];
}

// ---------------------------------------------------------------------------
// ENTRY POINTS
// ---------------------------------------------------------------------------

export async function handleNewMessage(idx) {
    const s = getSettings();
    if (!s.enabled) return;
    const chat = getCtx().chat;
    const msg = chat?.[idx];
    if (!isAssistant(msg)) return;

    const tags = readTags(msg);              
    if (tags.has) stripTagsInMessage(idx);   
    await evaluate({ idx, tags, force: false });
}

export async function illustrateMessage(idx = null) {
    const chat = getCtx().chat || [];
    idx = idx ?? lastAssistantIndex();
    if (idx == null || !isAssistant(chat[idx])) { notify('warning', 'No assistant message to illustrate.'); return; }
    await evaluate({ idx, tags: readTags(chat[idx]), force: true });
}

// ---------------------------------------------------------------------------
// SENSE -> DECIDE
// ---------------------------------------------------------------------------
async function evaluate({ idx, tags, force }) {
    const s = getSettings();
    const ctx = getCtx();
    const chat = ctx.chat;
    const msg = chat[idx];
    if (!msg) return;
    const mode = s.agentMode;
    const sig = contentSig(msg);

    if (!force) {
        if (msg.extra?.ia_sig === sig) return;                                           
        if (mode === 'mode2' && !tags.has) return;                                       
        if (mode === 'mode3' && !intervalDue(chat, idx, s.triggerInterval)) return;
        if (mode === 'mode1') {
            if (turnsSinceIllustration(chat, idx) < (s.cooldown || 0)) return;           
            if (s.fastGate !== false) {
                const prev = chat[idx - 1];
                const gate = passesGate({
                    assistantText: cleanTriggerTags(msg.mes || ''),
                    userText: prev?.is_user ? prev.mes : '',
                    sensitivity: s.gateSensitivity, extra: s.extraCues
                });
                if (!gate.pass) { console.log(`[Illustration Agent] gate: score ${gate.score} < ${s.gateSensitivity}, skipped`); return; }
            }
        }
        msg.extra = msg.extra || {};
        msg.extra.ia_sig = sig;
    }

    const schema = { mode1: s.promptMode1, mode2: s.promptMode2, mode3: s.promptMode3 }[mode] || s.promptMode1;
    const tagsMode = force && tags.has ? 'forced-tags' : mode;

    await waitForStIdle();
    if (getCtx().chat?.[idx] !== msg) return;                                            

    const myToken = ++runToken;
    const target = snapshotTarget(idx);
    evalAbort?.abort();
    const ac = (evalAbort = new AbortController());
    refreshStatus();

    let result;
    try {
        const useTagsOnly = (mode === 'mode2' || (force && tags.has)) && tags.has && s.mode2SkipLLM;
        if (useTagsOnly) {
            result = resultFromTags(tags);
        } else {
            const fullPrompt = buildPrompt({ schema, ctx, chat, idx, msg, tags, mode: tagsMode });
            console.log('[Illustration Agent Prompt Sent]', fullPrompt);
            const raw = await queryAgentLLM(fullPrompt, ac.signal);
            if (myToken !== runToken || getCtx().chatId !== target.chatId) return;       
            try { result = parseAgentResult(raw); }
            catch (parseErr) {
                if (!tags.has) throw parseErr;                                           
                console.warn('[Illustration Agent] unparseable LLM output, using tag text directly', parseErr);
                result = resultFromTags(tags);
            }
        }
    } catch (e) {
        if (e?.name === 'AbortError') return;
        if (msg.extra) delete msg.extra.ia_sig;                                          
        console.error('[Illustration Agent] evaluation failed', e);
        notify('error', 'Evaluation failed: ' + e.message);
        return;
    } finally {
        if (evalAbort === ac) evalAbort = null;
        refreshStatus();
    }

    if (myToken !== runToken) return;
    if (mode === 'mode1' && !force && result.decision !== 'yes') { notify('info', 'No illustration needed for this turn.'); return; }
    if (!result.prompt) { notify('warning', 'The agent returned an empty prompt, so nothing was generated.'); return; }

    // -------------------- ACT --------------------
    let positive = joinTags(s.stylePrefix, result.prompt);
    let negative = joinTags(s.defaultNegative, result.negativePrompt);
    let aspect = result.aspectRatio;
    let description = result.description;

    if (s.interactiveReview) {
        const edited = await reviewPrompt({ description, positive, negative, aspect });
        if (!edited) return;
        ({ positive, negative, aspect, description } = edited);
    }

    msg.extra = msg.extra || {};
    msg.extra.ia_done = true;                                                            
    const character = findCharacter(ctx, msg)?.name || msg.name;

    enqueue(async (signal) => {
        try { await runGeneration({ positive, negative, aspect, description, target, character, signal }); }
        catch (e) { delete msg.extra?.ia_done; throw e; }
    });
}

async function generateViaSdCommand(positive) {
    const ctx = getCtx();
    const run = ctx.executeSlashCommandsWithOptions || ctx.executeSlashCommands;
    const res = await run.call(ctx, `/sd quiet=true ${slashSafe(positive)}`, { handleParserErrors: true, handleExecutionErrors: true });
    const out = typeof res === 'string' ? res : res?.pipe;
    if (!out || !String(out).trim()) throw new Error('/sd returned no image. Is the Image Generation extension configured?');
    return normalizeUrl(String(out).trim());
}

async function runGeneration({ positive, negative, aspect, description, target, character, signal }) {
    const s = getSettings();
    const [width, height] = sizeFor(aspect, s);
    const n = clamp(parseInt(s.batchCount) || 1, 1, 4);
    const results = [];

    for (let i = 0; i < n; i++) {
        if (signal.aborted) throw new Error('Cancelled');
        emit('status', 'generating', n > 1 ? `image ${i + 1}/${n}` : '');
        if (s.imageBackend === 'sd_command') {
            const url = await generateViaSdCommand(positive);
            recordExternalImage({ url, positive, description, character });
            results.push({ url, thumb: null });
        } else {
            results.push(await generateImage({ positive, negative, width, height, description, character, signal }));
        }
    }

    if (results.length === 1) { await deliverRoleplayImage(results[0].url, description, target); return; }
    const pick = await pickCandidate(results);
    if (pick != null) await deliverRoleplayImage(results[pick].url, description, target);
}

export async function rerollImage(url, { replaceInChat = true } = {}) {
    const rec = getRecordByUrl(url);
    if (!rec?.positive) { notify('warning', 'This image has no stored prompt, so it cannot be rerolled.'); return; }
    const [w, h] = String(rec.aspectRatio || '').split('x').map(Number);
    const s = getSettings();
    notify('info', 'Rerolling illustration…');
    enqueue(async (signal) => {
        const r = await generateImage({
            positive: rec.positive, negative: rec.negative,
            width: w || s.resPortraitW, height: h || s.resPortraitH,
            description: rec.description, character: rec.character, signal
        });
        const idx = replaceInChat ? replaceImageUrl([url, rec.url, rec.legacyUrl], r.url) : null;
        notify('success', idx == null ? 'New variation saved to the Gallery.' : 'Illustration rerolled.');
    });
}

export async function rerollRecord(rec) { return rerollImage(rec.url, { replaceInChat: false }); }