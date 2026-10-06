import { setupUI } from './src/ui.js';
import { getSettings } from './src/config.js';
import { getCtx } from './src/util.js';
import {
    handleNewMessage, illustrateMessage, rerollImage, resetAgentState, syncMode2Injection, cancelAll
} from './src/agent.js';
import { initSendBridge, holdSendButton, releaseSendButton } from './src/stb.js';
import { on } from './src/bus.js';
import { decorateChat, stripTagsInMessage } from './src/chat.js';
import { openViewerByUrl } from './src/gallery.js';

jQuery(async () => {
    setupUI();

    const ctx = getCtx();
    const eventSource = ctx.eventSource;
    const T = ctx.eventTypes || ctx.event_types || {};

    // --- in-chat decoration (debounced, idempotent) ------------------------
    let raf = 0;
    const scheduleDecorate = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; try { decorateChat(); } catch (e) { console.warn(e); } });
    };
    let observer = null;
    const watchChat = () => {
        observer?.disconnect();
        const el = document.getElementById('chat');
        if (!el) return;
        observer = new MutationObserver(scheduleDecorate);
        observer.observe(el, { childList: true, subtree: true });
        scheduleDecorate();
    };

    $(document)
        .on('click', '#chat .ia-reroll-btn', function (e) {
            e.preventDefault(); e.stopPropagation();
            rerollImage($(this).closest('.ia-img-wrapper').attr('data-ia-url'));
        })
        .on('click', '#chat .ia-img-wrapper img', function (e) {
            e.preventDefault(); e.stopPropagation();
            openViewerByUrl($(this).closest('.ia-img-wrapper').attr('data-ia-url'));
        })
        .on('click', '#chat .ia-mes-btn', function (e) {
            e.preventDefault(); e.stopPropagation();
            const id = Number($(this).closest('.mes').attr('mesid'));
            if (Number.isInteger(id)) illustrateMessage(id);
        });

    // --- events -------------------------------------------------------------
    if (eventSource) {
        eventSource.on(T.CHAT_CHANGED || 'chat_changed', () => {
            resetAgentState();
            syncMode2Injection();
            setTimeout(watchChat, 300);
        });

        // Tidy any leftover <image>/<scene> tags and decorate (also covers chat history on load).
        eventSource.on(T.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered', (id) => {
            try { stripTagsInMessage(id); } catch (e) { console.warn(e); }
            scheduleDecorate();
        });

        // The trigger. Fires once per finished assistant message (after streaming ends).
        eventSource.on(T.MESSAGE_RECEIVED || 'message_received', (id, type) => {
            if (type === 'impersonate' || type === 'quiet') return;
            if (!getSettings().enabled) return;
            setTimeout(() => handleNewMessage(id), 120);   // let ST finish rendering the message first
        });
    }

    // --- SillyTavern's Send button doubles as the agent's Stop button ------------
    initSendBridge({ onUserStop: cancelAll });
    on('status', (state) => {
        const mode = getSettings().lockSend;
        const want = mode !== 'off' && (state === 'evaluating' || (state === 'generating' && mode === 'all'));
        want ? holdSendButton() : releaseSendButton();
    });

    syncMode2Injection();
    watchChat();
    console.log('[Illustration Agent] v3 ready.');
});
