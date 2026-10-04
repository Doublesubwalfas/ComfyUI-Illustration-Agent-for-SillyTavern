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

    function handleAssistantTurnFinished(msgId) {
        if (msgId !== undefined && msgId !== null && lastHandledMessageId === msgId) {
            return;
        }
        lastHandledMessageId = msgId;

        // Clean any visible {image} or {scene} trigger tags from the current message
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

        const s = getSettings();
        if (!s || !s.enabled) return;

        const phase = s.pipelinePhase || 'post';
        if (phase === 'post' || phase === 'parallel') {
            runEvaluation(false);
        }
    }

    if (eventSource && events) {
        const charRenderEvt = events.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered';
        eventSource.on(charRenderEvt, (msgId) => {
            handleAssistantTurnFinished(msgId);
        });

        const msgRecvEvt = events.MESSAGE_RECEIVED || 'message_received';
        eventSource.on(msgRecvEvt, (msgId) => {
            if (context.chat && msgId !== undefined && context.chat[msgId]?.is_user) return;
            handleAssistantTurnFinished(msgId);
        });

        const chatChangedEvt = events.CHAT_CHANGED || 'chat_changed';
        eventSource.on(chatChangedEvt, () => {
            setTimeout(() => attachInChatMessageButtons(runEvaluation), 400);
        });
    }

    setInterval(() => attachInChatMessageButtons(runEvaluation), 2500);
    console.log('[Illustration Agent] Mode Switcher, MultiGPU Workflow & Token Badges Ready.');
});