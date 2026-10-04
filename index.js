import { setupUI } from './src/ui.js';
import { runEvaluation } from './src/agent.js';
import { attachInChatMessageButtons } from './src/chat.js';
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

        attachInChatMessageButtons(runEvaluation);

        const s = getSettings();
        if (!s || !s.enabled) return;

        const phase = s.pipelinePhase || 'post';
        if (phase === 'post' || phase === 'parallel') {
            runEvaluation(false);
        }
    }

    if (eventSource && events) {
        // Primary Hook: Assistant message completely rendered
        const charRenderEvt = events.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered';
        eventSource.on(charRenderEvt, (msgId) => {
            handleAssistantTurnFinished(msgId);
        });

        // Secondary Hook: Message received
        const msgRecvEvt = events.MESSAGE_RECEIVED || 'message_received';
        eventSource.on(msgRecvEvt, (msgId) => {
            if (context.chat && msgId !== undefined && context.chat[msgId]?.is_user) return;
            handleAssistantTurnFinished(msgId);
        });

        // Chat switched / reloaded
        const chatChangedEvt = events.CHAT_CHANGED || 'chat_changed';
        eventSource.on(chatChangedEvt, () => {
            setTimeout(() => attachInChatMessageButtons(runEvaluation), 400);
        });
    }

    setInterval(() => attachInChatMessageButtons(runEvaluation), 2500);
    console.log('[Illustration Agent] Modular Architecture Active.');
});