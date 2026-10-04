import { setupUI } from './src/ui.js';
import { runEvaluation } from './src/agent.js';
import { attachInChatMessageButtons, cleanTriggerTags } from './src/chat.js';
import { getSettings } from './src/config.js';

let lastHandledMessageId = null;

jQuery(async () => {
    setupUI();

    const context = SillyTavern.getContext();
    const eventSource = context.eventSource || SillyTavern.eventSource;
    const events = context.event_types || context.eventTypes || SillyTavern.event_types || SillyTavern.eventTypes || {};

    // 1. UI CLEANUP: Removes {image}/{scene} tags from the screen and adds Reroll buttons.
    // Safe to run every time a message is rendered (like when loading a chat).
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

    // 2. EVALUATION TRIGGER: This only fires when the AI finishes a live generation.
    function handleAssistantTurnFinished(msgId) {
        const s = getSettings();
        if (!s || !s.enabled) return; // Master switch

        if (msgId !== undefined && msgId !== null && lastHandledMessageId === msgId) {
            return;
        }
        lastHandledMessageId = msgId;

        let hasImage = false;
        let hasScene = false;

        if (context.chat && msgId !== undefined && context.chat[msgId]) {
            const currentMsg = context.chat[msgId];
            if (!currentMsg.is_user && currentMsg.mes) {
                hasImage = /\{\s*image\s*\}/i.test(currentMsg.mes);
                hasScene = /\{\s*scene\s*\}/i.test(currentMsg.mes);
            }
        }

        // Clean UI first so tags disappear instantly, then evaluate
        handleUIRender(msgId);

        const phase = s.pipelinePhase || 'post';
        if (phase === 'post' || phase === 'parallel') {
            runEvaluation(false, { hasImage, hasScene });
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