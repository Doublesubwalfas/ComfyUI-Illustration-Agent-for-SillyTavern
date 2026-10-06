import { setupUI } from './src/ui.js';
import { runEvaluation, resetAgentState } from './src/agent.js';
import { attachInChatMessageButtons, cleanTriggerTags, extractVisualTags } from './src/chat.js';
import { getSettings } from './src/config.js';

let lastHandledMessageId = null;
let lastHandledSwipeId = null;
let chatReady = false;
let uiObserver = null;

jQuery(async () => {
    setupUI();

    const context = SillyTavern.getContext();
    const eventSource = context.eventSource || SillyTavern.eventSource;
    const events = context.event_types || context.eventTypes ||
                   SillyTavern.event_types || SillyTavern.eventTypes || {};

    if (context.chat && context.chat.length > 0) chatReady = true;

    // --- UI CLEANUP -------------------------------------------------------
    // Idempotent. Strips trigger tags and (re)attaches reroll buttons.
    function handleUIRender(msgId) {
        if (context.chat && msgId !== undefined && context.chat[msgId]) {
            const currentMsg = context.chat[msgId];
            if (!currentMsg.is_user && currentMsg.mes) {
                const cleaned = cleanTriggerTags(currentMsg.mes);
                if (cleaned !== currentMsg.mes) {
                    currentMsg.mes = cleaned;
                    if (Array.isArray(currentMsg.swipes) && currentMsg.swipes.length > 0) {
                        const sIdx = currentMsg.swipe_id ?? (currentMsg.swipes.length - 1);
                        if (currentMsg.swipes[sIdx]) {
                            currentMsg.swipes[sIdx] = cleanTriggerTags(currentMsg.swipes[sIdx]);
                        }
                    }
                    if (typeof context.updateMessage === 'function') {
                        context.updateMessage(msgId, currentMsg);
                    }
                }
            }
        }
        attachInChatMessageButtons(runEvaluation);
    }

    // --- EVALUATION TRIGGER ----------------------------------------------
    function handleAssistantTurnFinished(msgId) {
        if (!chatReady) return;

        const s = getSettings();
        if (!s || !s.enabled) return;

        if (msgId === undefined || msgId === null) return;
        const msg = context.chat?.[msgId];
        if (!msg || msg.is_user) return;

        const swipeId = msg.swipe_id ?? 0;
        if (lastHandledMessageId === msgId && lastHandledSwipeId === swipeId) {
            return; // same message, same swipe → already handled
        }
        lastHandledMessageId = msgId;
        lastHandledSwipeId = swipeId;

        // CRITICAL: extract trigger tags from the RAW message text BEFORE any
        // cleaning. cleanTriggerTags() strips <image>/<scene> entirely, so
        // running the extraction after cleaning always produced null — which
        // is why Mode 2 never fired and scene illustrations never appeared.
        let extractedImageText = null;
        let extractedSceneText = null;

        if (msg.mes) {
            const tags = extractVisualTags(msg.mes);
            extractedImageText = tags.image;
            extractedSceneText = tags.scene;
        }

        // Fallback: the active swipe may carry the tags even if mes does not.
        if (!extractedImageText && !extractedSceneText &&
            Array.isArray(msg.swipes) && msg.swipes.length > 0) {
            const sIdx = msg.swipe_id ?? (msg.swipes.length - 1);
            const tags = extractVisualTags(msg.swipes[sIdx] || '');
            extractedImageText = tags.image;
            extractedSceneText = tags.scene;
        }

        handleUIRender(msgId);

        const phase = s.pipelinePhase || 'post';
        if (phase === 'post' || phase === 'parallel') {
            runEvaluation(false, { extractedImageText, extractedSceneText });
        }
    }

    // --- CHAT OBSERVER ----------------------------------------------------
    function attachChatObserver() {
        if (uiObserver) uiObserver.disconnect();
        const chatEl = document.getElementById('chat');
        if (!chatEl) return;

        uiObserver = new MutationObserver(() => {
            const s = getSettings();
            if (s && s.enabled) attachInChatMessageButtons(runEvaluation);
        });
        uiObserver.observe(chatEl, { childList: true, subtree: true });
    }

    // --- EVENT BINDINGS ---------------------------------------------------
    if (eventSource && events) {
        const chatChangedEvt = events.CHAT_CHANGED || 'chat_changed';
        eventSource.on(chatChangedEvt, () => {
            chatReady = true;
            lastHandledMessageId = null;
            lastHandledSwipeId = null;
            resetAgentState();
            setTimeout(() => {
                attachInChatMessageButtons(runEvaluation);
                attachChatObserver();
            }, 400);
        });

        const charRenderEvt = events.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered';
        eventSource.on(charRenderEvt, (msgId) => {
            handleUIRender(msgId);
        });

        const msgRecvEvt = events.MESSAGE_RECEIVED || 'message_received';
        eventSource.on(msgRecvEvt, (msgId) => {
            if (context.chat && msgId !== undefined && context.chat[msgId]?.is_user) return;
            handleAssistantTurnFinished(msgId);
        });
    }

    attachChatObserver();

    console.log('[Illustration Agent] Doublesub Illustration Agent Pipeline Ready.');
});
