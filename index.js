import { setupUI } from './src/ui.js';
import { runEvaluation } from './src/agent.js';
import { attachInChatMessageButtons, cleanTriggerTags } from './src/chat.js';
import { getSettings } from './src/config.js';

let lastHandledMessageId = null;
const EXTENSION_START_TIME = Date.now();

jQuery(async () => {
    setupUI();

    const context = SillyTavern.getContext();
    const eventSource = context.eventSource || SillyTavern.eventSource;
    const events = context.event_types || context.eventTypes || SillyTavern.event_types || SillyTavern.eventTypes || {};

    // 1. UI CLEANUP: Removes <image> and <scene> tags from the screen and adds Reroll buttons.
    function handleUIRender(msgId) {
        if (context.chat && msgId !== undefined && context.chat[msgId]) {
            const currentMsg = context.chat[msgId];
            if (!currentMsg.is_user && currentMsg.mes) {
                const cleaned = cleanTriggerTags(currentMsg.mes);
                if (cleaned !== currentMsg.mes) {
                    currentMsg.mes = cleaned;
                    if (Array.isArray(currentMsg.swipes) && currentMsg.swipes.length > 0) {
                        const sIdx = currentMsg.swipe_id ?? (currentMsg.swipes.length - 1);
                        if (currentMsg.swipes[sIdx]) currentMsg.swipes[sIdx] = cleanTriggerTags(currentMsg.swipes[sIdx]);
                    }
                    if (typeof context.updateMessage === 'function') {
                        context.updateMessage(msgId, currentMsg);
                    }
                }
            }
        }
        attachInChatMessageButtons(runEvaluation);
    }

    // 2. EVALUATION TRIGGER: Only fires when AI completes live generation
    function handleAssistantTurnFinished(msgId) {
        // Block execution if this event fired during chat load / initialization
        if (Date.now() - EXTENSION_START_TIME < 3000) {
            console.log('[Illustration Agent] Ignored event during initialization phase.');
            return;
        }

        const s = getSettings();
        if (!s || !s.enabled) return; // Master switch

        if (msgId !== undefined && msgId !== null && lastHandledMessageId === msgId) {
            return;
        }
        lastHandledMessageId = msgId;

        let extractedImageText = null;
        let extractedSceneText = null;

        if (context.chat && msgId !== undefined && context.chat[msgId]) {
            const currentMsg = context.chat[msgId];
            if (!currentMsg.is_user && currentMsg.mes) {
                const imageMatch = /<image>([\s\S]*?)<\/image>/i.exec(currentMsg.mes);
                const sceneMatch = /<scene>([\s\S]*?)<\/scene>/i.exec(currentMsg.mes);
                
                if (imageMatch) extractedImageText = imageMatch[1].trim();
                if (sceneMatch) extractedSceneText = sceneMatch[1].trim();
            }
        }

        // Clean UI first so tags disappear instantly, then evaluate
        handleUIRender(msgId);

        const phase = s.pipelinePhase || 'post';
        if (phase === 'post' || phase === 'parallel') {
            runEvaluation(false, { extractedImageText, extractedSceneText });
        }
    }

    if (eventSource && events) {
        // CHAT LOADED: Just clean up tags and attach buttons. Do NOT generate art.
        const chatChangedEvt = events.CHAT_CHANGED || 'chat_changed';
        eventSource.on(chatChangedEvt, () => {
            setTimeout(() => {
                attachInChatMessageButtons(runEvaluation);
            }, 400);
        });

        // MESSAGE RENDERED: Clean tags from screen. Do NOT generate art.
        const charRenderEvt = events.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered';
        eventSource.on(charRenderEvt, (msgId) => {
            handleUIRender(msgId);
        });

        // MESSAGE RECEIVED: The AI just finished a live response (or swipe). Trigger the Agent!
        const msgRecvEvt = events.MESSAGE_RECEIVED || 'message_received';
        eventSource.on(msgRecvEvt, (msgId) => {
            if (context.chat && msgId !== undefined && context.chat[msgId]?.is_user) return;
            handleAssistantTurnFinished(msgId);
        });
    }

    setInterval(() => {
        const s = getSettings();
        if (s && s.enabled) attachInChatMessageButtons(runEvaluation);
    }, 2500);
    
    console.log('[Illustration Agent] Doublesub Illustration Agent Pipeline Ready.');
});