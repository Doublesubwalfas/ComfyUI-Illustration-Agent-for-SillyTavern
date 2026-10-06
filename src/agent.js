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

// Fixed: No longer tells the model to ignore character cards/references
const AGENT_SYSTEM_PROMPT =
    'You are an expert visual director and prompt engineer for image generation. ' +
    'You analyze roleplay context and character visual references to construct rich, highly detailed image generation prompts. ' +
    'Respond ONLY with the requested JSON object.';

const MAX_MSG_CHARS = 2500;  // Increased from 700 to prevent chopping the visual action in long replies
const MAX_CHAR_DESC = 3500;  // Increased from 1000 so the agent reads the full character appearance
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
                    temperature: 0.2,
                    max_tokens: 1000 // Raised from 450 to allow full descriptive tag chains
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
            try { svc = (await import(new URL('/scripts/extensions/shared.js', location.origin).href)).ConnectionManagerRequestService; } catch (_) { /* handled below */ }
        }
        if (!svc?.sendRequest) throw new Error('Connection Manager is not available in this SillyTavern.');
        const messages = [{ role: 'system', content: AGENT_SYSTEM_PROMPT }, { role: 'user', content: prompt }];
        try {
            const built = typeof svc.constructPrompt === 'function' ? svc.constructPrompt(messages, s.connectionProfile) : messages;
            const res = await withTimeout(svc.sendRequest(
                s.connectionProfile, built, 1000,
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
            systemPrompt: AGENT_SYSTEM_PROMPT, prompt, responseLength: 900, trimNames: false
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
// Sensing helpers (all local, all free)
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
    if (msg.original_avatar) { const c = chars.find(x => x.avatar === msg.original_avatar); if (c) return c; }
    if (msg.name) { const c = chars.find(x => x.name === msg.name); if (c) return c; }
    return ctx.characterId != null ? chars[ctx.characterId] : null;
}

function getCharacterCardText(ch) {
    if (!ch) return '';
    // Concatenate standard SillyTavern card character description + personality blocks
    return [
        ch.data?.description || ch.description || '',
        ch.data?.personality || ch.personality || ''
    ].filter(Boolean).join('\n\n');
}

function compact(m, s) {
    let t = cleanTriggerTags(m.mes || '');
    if (!s.includeThinking) t = stripThinkingTags(t);
    t = stripImageMarkdown(t);
    return `${m.name || (m.is_user ? 'User' : 'Assistant')}: ${truncate(t, MAX_MSG_CHARS)}`;
}

function buildPrompt({ schema, ctx, chat, idx, msg, tags, mode, force = false }) {
    const s = getSettings();
    const look = Math.max(1, parseInt(s.lookback) || 3);
    const recent = chat.slice(Math.max(0, idx - look + 1), idx + 1);
    const ch = findCharacter(ctx, msg);
    const desc = getCharacterCardText(ch);

    let tagBlock = '';
    if (tags?.has && (mode === 'mode2' || mode === 'forced-tags')) {
        tagBlock = '\n[VISUAL DESCRIPTION EXTRACTED FROM THE ASSISTANT\'S RESPONSE:]\n';
        if (tags.image) tagBlock += `-> ${tags.image}\n`;
        if (tags.scene) tagBlock += `-> ${tags.scene}\n`;
        tagBlock += 'CONVERT THIS EXACT DESCRIPTION INTO RICH IMAGE TAGS AND PRESERVE THE CHARACTER REFERENCE TRAITS.\n';
    }

    let forceNote = '';
    if (force && mode === 'mode1') {
        forceNote = '\n[USER DIRECTIVE: The user explicitly invoked illustration for this turn. Set "decision": "yes" and describe the key visual moment with rich details.]\n';
    }

    let last = cleanTriggerTags(msg.mes || '');
    if (!s.includeThinking) last = stripThinkingTags(last);
    last = stripImageMarkdown(last);

    return `${schema}
${forceNote}
Character Reference:
Name: ${ch?.name || msg.name || 'Character'}
Description & Traits:
${truncate(desc, MAX_CHAR_DESC)}

Recent Isolated Context:
${recent.map(m => compact(m, s)).join('\n\n')}
${tagBlock}
<assistant_response>
${truncate(last, MAX_MSG_CHARS)}
</assistant_response>`;
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

    // FIXED: Never swap out mode1's edited schema for mode3 during forced invocation!
    const schemaKey = { mode1: 'promptMode1', mode2: 'promptMode2', mode3: 'promptMode3' }[mode] || 'promptMode1';
    const schema = s[schemaKey] || s.promptMode1;
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
            const promptText = buildPrompt({ schema, ctx, chat, idx, msg, tags, mode: tagsMode, force });
            const raw = await queryAgentLLM(promptText, ac.signal);
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