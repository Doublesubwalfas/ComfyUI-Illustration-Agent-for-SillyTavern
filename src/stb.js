// ---------------------------------------------------------------------------
// Send/Stop button bridge.
//
// While the agent works (LLM decision and/or image rendering) the SillyTavern send
// button turns into the STOP button, exactly like a normal roleplay generation.
// Pressing it cancels the agent's work. This uses the same two functions that
// SillyTavern's own Memory and Connection Manager extensions use:
//     deactivateSendButtons()  -> hides send/continue/impersonate, shows Stop
//     activateSendButtons()    -> restores them
// If script.js cannot be imported we fall back to toggling the same DOM elements.
// ---------------------------------------------------------------------------
import { getCtx, sleep } from './util.js';

let core;                 // undefined = not tried, null = unavailable, object = script.js module
let held = false;
let stGenerating = false; // SillyTavern itself is generating a roleplay reply
let releaseTimer = null;
let watchdog = null;
let onStop = () => {};

const stopBtn = () => document.getElementById('mes_stop');
const stopVisible = () => { const b = stopBtn(); return !!b && getComputedStyle(b).display !== 'none'; };

async function loadCore() {
    if (core !== undefined) return core;
    try { core = await import(/* webpackIgnore: true */ new URL('/script.js', location.origin).href); }
    catch (e) { core = null; console.warn('[Illustration Agent] could not import script.js, using DOM fallback', e); }
    return core;
}

const ids = ['send_but', 'mes_continue', 'mes_impersonate'];
function lock() {
    if (core?.deactivateSendButtons) { core.deactivateSendButtons(); return; }
    ids.forEach(id => document.getElementById(id)?.classList.add('displayNone'));
    const b = stopBtn(); if (b) b.style.display = 'flex';
}
function unlock() {
    if (core?.activateSendButtons) { core.activateSendButtons(); return; }
    ids.forEach(id => document.getElementById(id)?.classList.remove('displayNone'));
    const b = stopBtn(); if (b) b.style.display = 'none';
}

export function initSendBridge({ onUserStop }) {
    onStop = onUserStop || onStop;
    loadCore();

    // Pressing Stop while we hold the button cancels our work. We do NOT stop propagation,
    // so SillyTavern's own handler still runs and restores the UI.
    document.addEventListener('click', (e) => {
        if (held && e.target?.closest?.('#mes_stop')) onStop();
    }, true);

    const ctx = getCtx();
    const T = ctx.eventTypes || ctx.event_types || {};
    const es = ctx.eventSource;
    if (!es) return;
    es.on(T.GENERATION_STARTED || 'generation_started', () => { stGenerating = true; });
    es.on(T.GENERATION_ENDED || 'generation_ended', () => { stGenerating = false; });
    es.on(T.GENERATION_STOPPED || 'generation_stopped', () => { stGenerating = false; if (held) onStop(); });
}

// Don't start while SillyTavern is generating its own reply (same check Memory uses).
export async function waitForStIdle(maxMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
        if (held || (!stGenerating && !stopVisible())) return true;
        await sleep(150);
    }
    return false;
}

export async function holdSendButton() {
    clearTimeout(releaseTimer);
    if (held || stGenerating || stopVisible()) return;       // ST is busy itself, don't interfere
    held = true;
    await loadCore();
    lock();
    clearInterval(watchdog);
    // ST may re-enable the buttons when its own generation wraps up; keep ours asserted.
    watchdog = setInterval(() => { if (held && !stGenerating && !stopVisible()) lock(); }, 800);
}

// Debounced so brief idle gaps between evaluation and rendering don't flicker the button.
export function releaseSendButton() {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
        if (!held) return;
        held = false;
        clearInterval(watchdog); watchdog = null;
        if (!stGenerating) unlock();
    }, 400);
}
