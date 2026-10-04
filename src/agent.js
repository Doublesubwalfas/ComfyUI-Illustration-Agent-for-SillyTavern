import { getSettings, getGalleryDb } from './config.js';
import { generateComfyImage } from './comfy.js';
import { deliverRoleplayImage } from './chat.js';
import { promptReviewModal, showBatchCandidatePicker, resetGeneratingIndicator } from './ui.js';

let isEvaluating = false;
let messageTurnCounter = 0;
const taskQueue = [];
let isQueueRunning = false;

export function enqueueTask(taskFn) {
    taskQueue.push(taskFn);
    processQueue();
}

async function processQueue() {
    if (isQueueRunning) return;
    isQueueRunning = true;
    while (taskQueue.length > 0) {
        const task = taskQueue.shift();
        try {
            await task();
        } catch (e) {
            console.error('[Illustration Agent Task Error]', e);
        }
    }
    isQueueRunning = false;
}

export async function queryAgentLLM(fullPrompt) {
    const s = getSettings();
    if (s.llmProvider === 'custom') {
        const resp = await fetch(`${s.customLlmUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${s.customLlmKey}`
            },
            body: JSON.stringify({
                model: s.customLlmModel,
                messages: [{ role: 'user', content: fullPrompt }],
                temperature: 0.3
            })
        });
        const data = await resp.json();
        return data.choices?.[0]?.message?.content || '';
    } else {
        return await SillyTavern.getContext().generateQuietPrompt(fullPrompt, false, false);
    }
}

function findExistingBackground(locationName) {
    if (!locationName) return null;
    const cleanQuery = locationName.toLowerCase().trim();
    const db = getGalleryDb();

    return db.find(item => {
        if (item.type !== 'background' || !item.url) return false;
        const loc = (item.location || '').toLowerCase();
        return loc.includes(cleanQuery) || cleanQuery.includes(loc);
    });
}

export async function runEvaluation(force = false) {
    if (isEvaluating) return;
    const context = SillyTavern.getContext();
    const s = getSettings();

    if (!context.chat || context.chat.length === 0) return;
    if (!force && !s.enabled) return;

    if (!force && s.triggerMode === 'interval') {
        messageTurnCounter++;
        if (messageTurnCounter % (s.triggerInterval || 3) !== 0) return;
    }

    isEvaluating = true;
    try {
        const recentMessages = context.chat.slice(-s.lookback);
        const lastMsg = recentMessages[recentMessages.length - 1];

        const contextText = recentMessages.map(m => `${m.name || (m.is_user ? 'User' : 'Assistant')}: ${m.mes}`).join('\n\n');
        const activeChar = context.characters?.[context.characterId];
        const charDescription = activeChar?.data?.description || activeChar?.description || '';

        const fullPrompt = `${s.unifiedPrompt}

Current Character Reference:
Name: ${activeChar?.name || 'Character'}
Description: ${charDescription.substring(0, 800)}

Recent Context (for continuity):
${contextText}

<assistant_response>
${lastMsg.mes}
</assistant_response>`;

        $('#ia_gallery_bubble').addClass('is-generating');
        $('#ia_bubble_icon').removeClass('fa-camera-retro').addClass('fa-wand-magic-sparkles fa-spin');
        toastr.info('Autonomous Illustrator: Evaluating latest scene...', 'Marinara');

        const rawResponse = await queryAgentLLM(fullPrompt);
        if (!rawResponse) {
            resetGeneratingIndicator();
            isEvaluating = false;
            return;
        }

        const cleaned = rawResponse.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON object returned by LLM');
        const result = JSON.parse(jsonMatch[0]);

        console.log('[Illustration Agent Decision]', result);

        const shouldGen = (result.decision === 'yes') || (result.shouldGenerate === true);
        const isBg = (result.target === 'background') || (result.generateBackground === true);

        // MUTUAL EXCLUSION: Background takes priority
        if (shouldGen && isBg) {
            const loc = result.location || 'New Scene';
            const matchedBg = findExistingBackground(loc);

            if (matchedBg) {
                toastr.success(`Decision: Reusing background "${matchedBg.location}"`, 'Marinara');
                await context.executeSlashCommands(`/bg ${matchedBg.url}`);
                resetGeneratingIndicator();
            } else {
                toastr.info(`Decision: Generating background for "${loc}"`, 'Marinara');
                enqueueTask(async () => {
                    const bgPositive = [s.stylePrefix, result.prompt, 'scenery, landscape, interior, detailed background, no people, empty scene'].filter(Boolean).join(', ');
                    const bgNegative = [s.defaultNegative, 'character, person, people, human, face, girl, boy, 1girl'].filter(Boolean).join(', ');

                    const bgResult = await generateComfyImage(bgPositive, bgNegative, s.resBgW, s.resBgH, {
                        ...result,
                        isBackground: true
                    });

                    if (bgResult && bgResult.cleanUrl) {
                        toastr.success(`Background updated: ${loc}`, 'Marinara');
                        await context.executeSlashCommands(`/bg ${bgResult.cleanUrl}`);
                    }
                    resetGeneratingIndicator();
                });
            }
        } else if (force || shouldGen) {
            toastr.success(`Decision: Illustrating scene (${result.reason || 'Moment detected'})`, 'Marinara');
            const combinedPos = [s.stylePrefix, result.prompt].filter(Boolean).join(', ');
            const combinedNeg = [s.defaultNegative, result.negativePrompt].filter(Boolean).join(', ');

            if (s.interactiveReview) {
                promptReviewModal(combinedPos, combinedNeg, result.aspectRatio, result, executeImagePipeline);
            } else {
                enqueueTask(async () => {
                    await executeImagePipeline(combinedPos, combinedNeg, result.aspectRatio, result);
                });
            }
        } else {
            toastr.info(`Decision: Static scene, no illustration needed. (${result.reason || 'No shift'})`, 'Marinara');
            resetGeneratingIndicator();
        }
    } catch (e) {
        console.error('[Illustration Agent Error]', e);
        resetGeneratingIndicator();
        toastr.error('Evaluation failed: ' + e.message, 'Marinara');
    } finally {
        isEvaluating = false;
    }
}

export async function executeImagePipeline(positive, negative, aspectRatio, metadata) {
    const s = getSettings();
    let width = s.resPortraitW;
    let height = s.resPortraitH;

    if (aspectRatio === 'landscape') {
        width = s.resLandscapeW;
        height = s.resLandscapeH;
    } else if (aspectRatio === 'square') {
        width = s.resSquareW;
        height = s.resSquareH;
    }

    const totalBatch = s.batchCount || 1;
    const generatedResults = [];

    try {
        for (let i = 0; i < totalBatch; i++) {
            if (s.imageBackend === 'comfyui_direct') {
                const res = await generateComfyImage(positive, negative, width, height, metadata);
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