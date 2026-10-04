import { getSettings, getGalleryDb } from './config.js';
import { generateComfyImage } from './comfy.js';
import { deliverRoleplayImage, cleanTriggerTags } from './chat.js';
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

export async function runEvaluation(force = false, tags = null) {
    if (isEvaluating) return;
    const context = SillyTavern.getContext();
    const s = getSettings();

    if (!context.chat || context.chat.length === 0) return;
    if (!s.enabled) return;

    const lookbackCount = Math.max(1, parseInt(s.lookback) || 3);
    const recentMessages = context.chat.slice(-lookbackCount);
    const lastMsg = recentMessages[recentMessages.length - 1];

    const lastMsgTextRaw = lastMsg.mes || '';
    const hasImageTag = tags ? tags.hasImage : /\{\s*image\s*\}/i.test(lastMsgTextRaw);
    const hasSceneTag = tags ? tags.hasScene : /\{\s*scene\s*\}/i.test(lastMsgTextRaw);

    if (!force && s.agentMode === 'mode2') {
        if (!hasImageTag && !hasSceneTag) {
            console.log('[Illustration Agent] Mode 2: No {image} or {scene} tag found in assistant turn. Skipping.');
            return;
        }
    }

    if (!force && s.agentMode === 'mode3') {
        messageTurnCounter++;
        if (messageTurnCounter % (s.triggerInterval || 3) !== 0) {
            console.log(`[Illustration Agent] Mode 3: Skipping turn (${messageTurnCounter}/${s.triggerInterval})`);
            return;
        }
    }

    isEvaluating = true;
    try {
        const contextText = recentMessages
            .map(m => `${m.name || (m.is_user ? 'User' : 'Assistant')}: ${cleanTriggerTags(m.mes)}`)
            .join('\n\n');

        const activeChar = context.characters?.[context.characterId];
        const charDescription = activeChar?.data?.description || activeChar?.description || '';

        const activeSchema = s.activeSchemaText || '';

        const fullPrompt = `${activeSchema}

Character Reference:
Name: ${activeChar?.name || 'Character'}
Description: ${charDescription.substring(0, 500)}

Recent Isolated Context:
${contextText}

<assistant_response>
${cleanTriggerTags(lastMsg.mes)}
</assistant_response>`;

        $('#ia_gallery_bubble').addClass('is-generating');
        $('#ia_bubble_icon').removeClass('fa-camera-retro').addClass('fa-wand-magic-sparkles fa-spin');
        toastr.info('Illustration Agent evaluating scene...', 'Doublesub');

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

        if (result.decision !== 'yes' && !force) {
            toastr.info(`Decision: Static scene, no illustration needed.`, 'Doublesub');
            resetGeneratingIndicator();
            return;
        }

        // Support array of illustrations (Mode 1 multi-queue) or fallback to single object (Legacy/Mode 2/3)
        let items = Array.isArray(result.illustrations) ? result.illustrations : [result];

        items.forEach(item => {
            let isBg = (item.type === 'background' || item.target === 'background');
            
            if (s.agentMode === 'mode2') {
                isBg = false;
                if (hasSceneTag) item.description = '';
            }
            if (s.agentMode === 'mode3') {
                isBg = false;
            }

            if (isBg) {
                const loc = item.location || 'New Scene';
                const matchedBg = findExistingBackground(loc);

                if (matchedBg) {
                    toastr.success(`Decision: Reusing background "${matchedBg.location}"`, 'Doublesub');
                    enqueueTask(async () => {
                        await context.executeSlashCommands(`/bg ${matchedBg.url}`);
                        resetGeneratingIndicator();
                    });
                } else {
                    toastr.info(`Decision: Generating background for "${loc}"`, 'Doublesub');
                    enqueueTask(async () => {
                        const bgPositive = [s.stylePrefix, item.prompt, 'scenery, landscape, interior, detailed background, no people, empty scene'].filter(Boolean).join(', ');
                        const bgNegative = [s.defaultNegative, 'character, person, people, human, face, girl, boy, 1girl'].filter(Boolean).join(', ');

                        const bgResult = await generateComfyImage(bgPositive, bgNegative, s.resBgW, s.resBgH, {
                            ...item,
                            isBackground: true
                        });

                        if (bgResult && bgResult.cleanUrl) {
                            toastr.success(`Background updated: ${loc}`, 'Doublesub');
                            await context.executeSlashCommands(`/bg ${bgResult.cleanUrl}`);
                        }
                        resetGeneratingIndicator();
                    });
                }
            } else {
                toastr.success(`Decision: Illustrating scene (${item.reason || 'Action Moment'})`, 'Doublesub');
                const combinedPos = [s.stylePrefix, item.prompt].filter(Boolean).join(', ');
                const combinedNeg = [s.defaultNegative, item.negativePrompt].filter(Boolean).join(', ');

                if (s.interactiveReview) {
                    promptReviewModal(combinedPos, combinedNeg, item.aspectRatio, item, executeImagePipeline);
                } else {
                    enqueueTask(async () => {
                        await executeImagePipeline(combinedPos, combinedNeg, item.aspectRatio, item);
                    });
                }
            }
        });

    } catch (e) {
        console.error('[Illustration Agent Error]', e);
        resetGeneratingIndicator();
        toastr.error('Evaluation failed: ' + e.message, 'Doublesub');
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