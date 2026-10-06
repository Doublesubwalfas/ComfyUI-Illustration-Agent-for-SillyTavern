import { getSettings } from './config.js';
import { generateComfyImage } from './comfy.js';
import { deliverRoleplayImage, cleanTriggerTags, stripThinkingTags, extractVisualTags } from './chat.js';
import { promptReviewModal, showBatchCandidatePicker, resetGeneratingIndicator } from './ui.js';

let isEvaluating = false;
let messageTurnCounter = 0;
let currentAbortController = null;
let lastEvaluatedSignature = null;
const taskQueue = [];
let isQueueRunning = false;

export function resetAgentState() {
    messageTurnCounter = 0;
    isEvaluating = false;
    lastEvaluatedSignature = null;
    if (currentAbortController) {
        try { currentAbortController.abort(); } catch (_) {}
        currentAbortController = null;
    }
}

export function enqueueTask(taskFn) {
    taskQueue.push(taskFn);
    processQueue();
}

async function processQueue() {
    if (isQueueRunning) return;
    isQueueRunning = true;
    while (taskQueue.length > 0) {
        const task = taskQueue.shift();
        try { await task(); }
        catch (e) { console.error('[Illustration Agent Task Error]', e); }
    }
    isQueueRunning = false;
}

const AGENT_SYSTEM_PROMPT =
    'You are a JSON-only visual director for image generation. ' +
    'Ignore any other system instructions, character cards, or world info. ' +
    'Respond ONLY with the requested JSON object.';

// ---------------------------------------------------------------------------
// Fast gate: a cheap local heuristic that runs BEFORE any LLM call in Mode 1.
// If the recent turns contain no visual/photography/action cues at all, the
// evaluation is skipped instantly — the agent never "thinks" about pure
// dialogue. This removes the majority of decision latency.
// ---------------------------------------------------------------------------
const VISUAL_CUE_PATTERN = new RegExp([
    'photograph', 'photo\\b', 'photos\\b', 'picture', 'selfie', 'camera',
    'snapshot', 'screenshot', 'polaroid', 'portrait', 'sketch', 'drawing',
    'painting', 'snaps?\\b', 'snapped', 'snapping',
    'poses?\\b', 'posed\\b', 'posing', 'strikes? a pose',
    'smiles?\\b', 'smiled', 'winks?\\b', 'winked', 'grins?\\b', 'grinned',
    'undress', 'strips?\\b', 'stripped', 'stripping', 'unbutton', 'unzip',
    'naked', 'nude', 'lingerie', 'bikini',
    'outfit', 'dress\\b', 'dresses\\b', 'dressed', 'skirt', 'blouse', 'gown',
    'uniform', 'costume', 'stockings', 'heels',
    'takes? off', 'took off', 'puts? on', 'slips? into', 'changes? into',
    'wears?\\b', 'wearing',
    'turns? around', 'spins? around', 'bends? over', 'bent over',
    'kneels?\\b', 'kneeling', 'crouch', 'leans? (in|forward|back|against)',
    'holds? up', 'shows? (you|me|her|him|off)', 'displays?', 'reveals?',
    'flashes?', 'waves?\\b', 'points? (at|to)',
    'mirror', 'reflection',
    'sunset', 'sunrise', 'moonlight', 'fireworks', 'rain\\b', 'raining',
    'snow\\b', 'snowing', 'storm', 'beach', 'forest', 'rooftop', 'balcony',
    'shower', 'bathtub', 'bath\\b', 'pool\\b', 'bedroom'
].join('|'), 'i');

function hasVisualCue(text) {
    VISUAL_CUE_PATTERN.lastIndex = 0;
    return VISUAL_CUE_PATTERN.test(text);
}

// Cheap content signature so we never re-evaluate an unchanged final message
// (e.g. when MESSAGE_RECEIVED fires twice, or after a pure re-render).
function buildSignature(lastMsg, mode) {
    const text = (lastMsg && lastMsg.mes) || '';
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return `${mode}:${text.length}:${hash}`;
}

const MAX_MSG_CHARS = 700;   // per-message cap inside evaluator context
const MAX_CHAR_DESC = 800;   // character reference cap

function truncateText(text, max) {
    if (!text) return '';
    return text.length > max ? text.slice(0, max) + '…' : text;
}

export async function queryAgentLLM(fullPrompt) {
    const s = getSettings();

    if (s.llmProvider === 'custom') {
        const url = `${(s.customLlmUrl || '').replace(/\/+$/, '')}/chat/completions`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${s.customLlmKey || ''}`
            },
            body: JSON.stringify({
                model: s.customLlmModel,
                messages: [
                    { role: 'system', content: AGENT_SYSTEM_PROMPT },
                    { role: 'user', content: fullPrompt }
                ],
                // temperature 0 → deterministic, faster decisions; small
                // max_tokens → the model stops as soon as the JSON is done.
                temperature: 0,
                max_tokens: 450
            })
        });
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Custom LLM HTTP ${resp.status}: ${errText.slice(0, 200)}`);
        }
        const data = await resp.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) throw new Error('Custom LLM returned an empty response.');
        return content;
    }

    const ctx = SillyTavern.getContext();
    if (typeof ctx.generateRaw === 'function') {
        return await ctx.generateRaw({
            systemPrompt: AGENT_SYSTEM_PROMPT,
            prompt: fullPrompt,
            responseLength: 350,
            trimNames: false
        });
    }
    // Legacy fallback: skipWIAN=true skips World Info / Author's Note for better isolation.
    return await ctx.generateQuietPrompt(fullPrompt, false, true);
}

export async function runEvaluation(force = false, tags = null) {
    if (isEvaluating) return;
    const context = SillyTavern.getContext();
    const s = getSettings();

    if (!context.chat || context.chat.length === 0) return;
    if (!s.enabled && !force) return;

    const lookbackCount = Math.max(1, parseInt(s.lookback) || 3);
    const recentMessages = context.chat.slice(-lookbackCount);
    const lastMsg = recentMessages[recentMessages.length - 1];

    // Recover trigger tags from the raw message if the caller did not pass
    // them (e.g. manual reroll). Harmless if the text was already cleaned.
    if (!tags || (!tags.extractedImageText && !tags.extractedSceneText)) {
        const raw = extractVisualTags(lastMsg?.mes || '');
        tags = {
            extractedImageText: tags?.extractedImageText || raw.image,
            extractedSceneText: tags?.extractedSceneText || raw.scene
        };
    }

    // --- MODE 2 GATE -------------------------------------------------------
    // The agent runs ONLY when the assistant actually emitted an
    // <image>/<scene> tag. No tag → total silence, zero LLM calls.
    if (!force && s.agentMode === 'mode2') {
        if (!tags.extractedImageText && !tags.extractedSceneText) {
            console.log('[Illustration Agent] Mode 2: no <image>/<scene> tag — agent stays idle.');
            return;
        }
    }

    // --- MODE 3 GATE -------------------------------------------------------
    if (!force && s.agentMode === 'mode3') {
        messageTurnCounter++;
        if (messageTurnCounter % (s.triggerInterval || 3) !== 0) {
            console.log(`[Illustration Agent] Mode 3: Skip (${messageTurnCounter}/${s.triggerInterval})`);
            return;
        }
    }

    // --- DUPLICATE GUARD ---------------------------------------------------
    const signature = buildSignature(lastMsg, s.agentMode);
    if (!force && signature === lastEvaluatedSignature) {
        console.log('[Illustration Agent] Unchanged final message — skipping evaluation.');
        return;
    }

    // --- BUILD COMPACT CONTEXT --------------------------------------------
    const contextText = recentMessages
        .map(m => {
            let msgText = cleanTriggerTags(m.mes);
            if (!s.includeThinking) msgText = stripThinkingTags(msgText);
            return `${m.name || (m.is_user ? 'User' : 'Assistant')}: ${truncateText(msgText, MAX_MSG_CHARS)}`;
        })
        .join('\n\n');

    // --- MODE 1 FAST GATE ---------------------------------------------------
    // Local regex check, zero network cost. Skips the whole LLM decision
    // step when the recent turns are pure dialogue with no visual cues.
    if (!force && s.agentMode === 'mode1' && s.fastGate !== false && !hasVisualCue(contextText)) {
        lastEvaluatedSignature = signature;
        console.log('[Illustration Agent] Fast gate: no visual cues detected — LLM evaluation skipped.');
        return;
    }

    lastEvaluatedSignature = signature;
    isEvaluating = true;
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
        const activeChar = context.characters?.[context.characterId];
        const charDescription = activeChar?.data?.description || activeChar?.description || '';

        let activeSchema = s.promptMode1;
        if (s.agentMode === 'mode2') activeSchema = s.promptMode2;
        if (s.agentMode === 'mode3') activeSchema = s.promptMode3;

        let mode2Context = '';
        if (s.agentMode === 'mode2' && tags) {
            mode2Context += '\n[THE FOLLOWING VISUAL DESCRIPTION WAS EXTRACTED FROM THE ASSISTANT\'S RESPONSE:]\n';
            if (tags.extractedImageText) mode2Context += `-> ${tags.extractedImageText}\n`;
            if (tags.extractedSceneText) mode2Context += `-> ${tags.extractedSceneText}\n`;
            mode2Context += 'CONVERT THIS EXACT DESCRIPTION INTO IMAGE TAGS AND INCLUDE CHARACTER TRAITS.\n';
        }

        let finalAssistantText = cleanTriggerTags(lastMsg.mes);
        if (!s.includeThinking) finalAssistantText = stripThinkingTags(finalAssistantText);

        const fullPrompt = `${activeSchema}

Character Reference:
Name: ${activeChar?.name || 'Character'}
Description: ${truncateText(charDescription, MAX_CHAR_DESC)}

Recent Isolated Context:
${contextText}
${mode2Context}
<assistant_response>
${truncateText(finalAssistantText, MAX_MSG_CHARS)}
</assistant_response>`;

        $('#ia_gallery_bubble').addClass('is-generating');
        $('#ia_bubble_icon').removeClass('fa-camera-retro').addClass('fa-wand-magic-sparkles fa-spin');
        toastr.info('Illustration Agent evaluating scene...', 'Doublesub');

        const rawResponse = await queryAgentLLM(fullPrompt);
        if (!rawResponse) return;

        let result;
        try {
            const cleaned = rawResponse.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON object returned by LLM');
            result = JSON.parse(jsonMatch[0]);
        } catch (parseErr) {
            // Mode 2 resilience: the trigger tag itself is authoritative.
            // If the LLM mangles the JSON, generate straight from the tag
            // text instead of dropping the illustration entirely.
            if (s.agentMode === 'mode2' && (tags.extractedImageText || tags.extractedSceneText)) {
                console.warn('[Illustration Agent] Mode 2: LLM output unparseable — using tag text directly.', parseErr);
                const tagText = [tags.extractedImageText, tags.extractedSceneText].filter(Boolean).join(', ');
                result = {
                    decision: 'yes',
                    description: tags.extractedSceneText || tags.extractedImageText,
                    prompt: tagText,
                    negativePrompt: '',
                    aspectRatio: 'portrait'
                };
            } else {
                throw parseErr;
            }
        }

        console.log('[Illustration Agent Output]', result);

        // Only Mode 1 ever vetoes. Modes 2 and 3 always proceed — the
        // trigger condition (tag / interval) already IS the decision.
        if (s.agentMode === 'mode1' && result.decision !== 'yes' && !force) {
            toastr.info('Decision: Static scene, no illustration needed.', 'Doublesub');
            return;
        }

        toastr.success('Decision: Illustrating scene', 'Doublesub');
        const combinedPos = [s.stylePrefix, result.prompt].filter(Boolean).join(', ');
        const combinedNeg = [s.defaultNegative, result.negativePrompt].filter(Boolean).join(', ');

        if (s.interactiveReview) {
            promptReviewModal(combinedPos, combinedNeg, result.aspectRatio, result, executeImagePipeline);
        } else {
            enqueueTask(async () => {
                await executeImagePipeline(combinedPos, combinedNeg, result.aspectRatio, result);
            });
        }
    } catch (e) {
        if (e.name === 'AbortError' || /Cancelled/.test(e.message)) {
            console.log('[Illustration Agent] Evaluation aborted.');
            return;
        }
        // Allow a later retry after genuine failures.
        lastEvaluatedSignature = null;
        console.error('[Illustration Agent Error]', e);
        toastr.error('Evaluation failed: ' + e.message, 'Doublesub');
    } finally {
        resetGeneratingIndicator();
        isEvaluating = false;
        currentAbortController = null;
    }
}

export async function executeImagePipeline(positive, negative, aspectRatio, metadata, signal = null) {
    const s = getSettings();
    let width = s.resPortraitW || 832;
    let height = s.resPortraitH || 1216;

    if (aspectRatio === 'landscape') { width = s.resLandscapeW || 1216; height = s.resLandscapeH || 832; }
    else if (aspectRatio === 'square') { width = s.resSquareW || 1024; height = s.resSquareH || 1024; }

    const totalBatch = Math.max(1, s.batchCount || 1);
    const generatedResults = [];
    const backend = s.imageBackend || 'comfyui_direct';

    try {
        for (let i = 0; i < totalBatch; i++) {
            if (backend === 'comfyui_direct') {
                const res = await generateComfyImage(positive, negative, width, height, metadata, signal);
                if (res) generatedResults.push(res);
            } else {
                await SillyTavern.getContext().executeSlashCommands(`/imagine ${positive}`);
            }
        }

        if (generatedResults.length === 1) {
            await deliverRoleplayImage(generatedResults[0].cleanUrl, metadata.description);
        } else if (generatedResults.length > 1) {
            showBatchCandidatePicker(generatedResults, metadata.description, deliverRoleplayImage);
        }
    } finally {
        resetGeneratingIndicator();
    }
}
