import { getSettings } from './config.js';
import { generateComfyImage } from './comfy.js';
import { deliverRoleplayImage, cleanTriggerTags, stripThinkingTags } from './chat.js';
import { promptReviewModal, showBatchCandidatePicker, resetGeneratingIndicator } from './ui.js';

let isEvaluating = false;
let messageTurnCounter = 0;
let currentAbortController = null;
const taskQueue = [];
let isQueueRunning = false;

export function resetAgentState() {
    messageTurnCounter = 0;
    isEvaluating = false;
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
                temperature: 0.3
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
            responseLength: 800,
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

    if (!force && s.agentMode === 'mode2') {
        if (!tags || (!tags.extractedImageText && !tags.extractedSceneText)) {
            console.log('[Illustration Agent] Mode 2: No <image>/<scene> tag found. Skipping.');
            return;
        }
    }

    if (!force && s.agentMode === 'mode3') {
        messageTurnCounter++;
        if (messageTurnCounter % (s.triggerInterval || 3) !== 0) {
            console.log(`[Illustration Agent] Mode 3: Skip (${messageTurnCounter}/${s.triggerInterval})`);
            return;
        }
    }

    isEvaluating = true;
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
        const contextText = recentMessages
            .map(m => {
                let msgText = cleanTriggerTags(m.mes);
                if (!s.includeThinking) msgText = stripThinkingTags(msgText);
                return `${m.name || (m.is_user ? 'User' : 'Assistant')}: ${msgText}`;
            })
            .join('\n\n');

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
Description: ${charDescription.substring(0, 1500)}

Recent Isolated Context:
${contextText}
${mode2Context}
<assistant_response>
${finalAssistantText}
</assistant_response>`;

        $('#ia_gallery_bubble').addClass('is-generating');
        $('#ia_bubble_icon').removeClass('fa-camera-retro').addClass('fa-wand-magic-sparkles fa-spin');
        toastr.info('Illustration Agent evaluating scene...', 'Doublesub');

        const rawResponse = await queryAgentLLM(fullPrompt);
        if (!rawResponse) return;

        const cleaned = rawResponse.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON object returned by LLM');
        const result = JSON.parse(jsonMatch[0]);

        console.log('[Illustration Agent Output]', result);

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