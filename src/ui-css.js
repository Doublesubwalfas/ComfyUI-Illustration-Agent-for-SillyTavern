// Styles for everything that lives inside the Shadow DOM (bubble, gallery, viewer, dialogs).
// SillyTavern's global CSS cannot reach in here, and ours cannot leak out.
export const CSS = `
:host {
    all: initial;
    position: fixed; inset: 0; z-index: 99999; pointer-events: none;
    --s: 1;
    --accent: #ff7675;
    --line: rgba(255,255,255,.14);
    --fg: var(--SmartThemeBodyColor, #e8e8ee);
    --tint: var(--SmartThemeBlurTintColor, #1b1b22);
    --danger: #ff6b6b;
    font-family: var(--mainFontFamily, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
    font-size: calc(15px * var(--s)); line-height: 1.35; color: var(--fg);
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer;
    -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
input, textarea, select { font: inherit; font-size: max(16px, 1em); /* >=16px stops iOS zoom-on-focus */ color: inherit; width: 100%;
    background: rgba(255,255,255,.07); border: 1px solid var(--line); border-radius: 10px; padding: .6em .75em; outline: none; margin: 0; }
input:focus, textarea:focus, select:focus { border-color: var(--accent); }
select option { color: #111; }
textarea { resize: vertical; min-height: 3em; }
label.f { display: flex; flex-direction: column; gap: .3em; font-size: .9em; }
label.f > span { opacity: .8; }

.i { width: 1.3em; height: 1.3em; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
.i.fill { fill: currentColor; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.muted { opacity: .65; font-size: .88em; }

/* opaque surface (the theme tint is often translucent; layer it over a solid base) */
.surface { background-color: #121218; background-image: linear-gradient(var(--tint), var(--tint)); }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: .45em; min-height: 2.9em; padding: 0 1em;
    border-radius: 10px; background: rgba(255,255,255,.1); }
.btn:active { background: rgba(255,255,255,.22); }
.btn.icon { min-width: 2.9em; padding: 0; background: transparent; }
.btn.icon:active, .btn.icon.on { background: rgba(255,255,255,.16); }
.btn.primary { background: #27ae60; color: #fff; }
.btn.danger { color: var(--danger); }
.btn.solid-danger { background: #d63031; color: #fff; }

/* ---------- Floating bubble ---------- */
.bubble { position: fixed; width: 54px; height: 54px; border-radius: 50%; pointer-events: auto; cursor: pointer;
    background: linear-gradient(135deg, #ff7675, #d63031); color: #fff; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 18px rgba(0,0,0,.6); touch-action: none; user-select: none; -webkit-user-select: none; z-index: 1; }
.bubble .i { width: 1.6em; height: 1.6em; }
.bubble.busy { background: linear-gradient(135deg, #0984e3, #6c5ce7); animation: pulse 1.4s infinite ease-in-out; }
.bubble.off { display: none; }
.badge { position: absolute; top: -3px; right: -3px; background: #2d3436; color: #fff; font-size: .7em; font-weight: 700; padding: 1px 6px; border-radius: 10px; border: 1px solid rgba(255,255,255,.4); }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(108,92,231,.7); } 70% { box-shadow: 0 0 0 16px rgba(108,92,231,0); } 100% { box-shadow: 0 0 0 0 rgba(108,92,231,0); } }
:host(.gallery-open) .bubble { display: none; }

/* ---------- Gallery ---------- */
.gallery { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.65); pointer-events: auto; z-index: 2; }
.panel { width: min(1100px, 96vw); height: min(88vh, 900px); display: flex; flex-direction: column; overflow: hidden;
    border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.85); }
.bar { display: flex; align-items: center; gap: .3em; padding: .35em .5em; border-bottom: 1px solid var(--line); background: rgba(0,0,0,.25); flex-shrink: 0; }
.bar .title { display: flex; align-items: baseline; gap: .5em; font-weight: 700; font-size: 1.1em; min-width: 0; }
.bar .spacer { flex: 1; }
.searchrow { display: none; align-items: center; gap: .4em; padding: .5em .7em; border-bottom: 1px solid var(--line); flex-shrink: 0; }
.searchrow.open { display: flex; }
.chips { display: flex; gap: .5em; padding: .55em .7em; overflow-x: auto; border-bottom: 1px solid var(--line); flex-shrink: 0; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.chips::-webkit-scrollbar { display: none; }
.chip { flex-shrink: 0; min-height: 2.5em; padding: 0 1em; border-radius: 999px; background: rgba(255,255,255,.09); border: 1px solid var(--line); display: inline-flex; align-items: center; gap: .4em; white-space: nowrap; font-size: .93em; }
.chip.active { background: rgba(255,118,117,.3); border-color: var(--accent); }
.grid { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding: .8em; display: grid; gap: .8em; align-content: start; grid-auto-rows: max-content;
    grid-template-columns: var(--cols, repeat(auto-fill, minmax(calc(190px * var(--s)), 1fr))); }
.empty { grid-column: 1 / -1; text-align: center; opacity: .6; padding: 3em 1em; }
.sentinel { grid-column: 1 / -1; height: 1px; }
.card { position: relative; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: rgba(0,0,0,.25); cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.card .img { position: relative; aspect-ratio: 3 / 4; background: rgba(0,0,0,.5); }
.card .img img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.card .noimg { display: flex; height: 100%; align-items: center; justify-content: center; opacity: .5; }
.card .fav { position: absolute; top: .35em; right: .35em; width: 2.7em; height: 2.7em; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; display: flex; align-items: center; justify-content: center; }
.card .fav.on { color: var(--danger); }
.card .tick { position: absolute; left: .45em; top: .45em; width: 1.7em; height: 1.7em; border-radius: 50%; border: 2px solid #fff; background: rgba(0,0,0,.45); display: none; align-items: center; justify-content: center; color: #fff; }
.grid.selecting .tick { display: flex; }
.card.sel { outline: 3px solid #2ecc71; outline-offset: -3px; }
.card.sel .tick { background: #2ecc71; border-color: #2ecc71; }
.card .meta { padding: .5em .65em .65em; display: flex; flex-direction: column; gap: .2em; }
.card .meta b { font-size: .9em; }
.card .desc { font-size: .8em; opacity: .8; font-style: italic; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.selbar { display: flex; align-items: center; gap: .5em; padding: .5em .7em calc(.5em + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--line); background: rgba(0,0,0,.35); flex-shrink: 0; }
.selbar .grow { flex: 1; font-weight: 600; }

/* ---------- Viewer ---------- */
.viewer { position: fixed; inset: 0; background: #06060a; color: #fff; pointer-events: auto; z-index: 3; touch-action: none; overscroll-behavior: contain; user-select: none; -webkit-user-select: none; }
.stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; touch-action: none; }
.stage img { max-width: 100%; max-height: 100%; object-fit: contain; transform-origin: center; will-change: transform; -webkit-user-drag: none; }
.verr { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .6em; padding: 2em; text-align: center; opacity: .92; pointer-events: none; }
.verr .i { width: 2.4em; height: 2.4em; opacity: .6; }
.vtop, .vbottom, .vnav { transition: opacity .2s ease; }
.vtop { position: absolute; top: 0; left: 0; right: 0; z-index: 2; display: flex; align-items: center; gap: .6em; pointer-events: none;
    padding: calc(env(safe-area-inset-top, 0px) + .4em) calc(env(safe-area-inset-right, 0px) + .6em) 1.4em calc(env(safe-area-inset-left, 0px) + .9em); background: linear-gradient(rgba(0,0,0,.75), transparent); }
.vtop > * { pointer-events: auto; }
.vtitles { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.vtitles b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vclose { width: 3em; height: 3em; border-radius: 50%; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; }
.vnav { position: absolute; top: 50%; transform: translateY(-50%); z-index: 2; width: 2.8em; height: 4.4em; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; }
.vnav.prev { left: 0; border-radius: 0 12px 12px 0; }
.vnav.next { right: 0; border-radius: 12px 0 0 12px; }
.vbottom { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; pointer-events: none;
    padding: 2em calc(env(safe-area-inset-right, 0px) + .6em) calc(env(safe-area-inset-bottom, 0px) + .5em) calc(env(safe-area-inset-left, 0px) + .6em); background: linear-gradient(transparent, rgba(0,0,0,.85) 40%); }
.vbottom > * { pointer-events: auto; }
.vdesc { font-size: .92em; font-style: italic; opacity: .92; margin-bottom: .6em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; cursor: pointer; }
.vdesc.open { display: block; max-height: 32vh; overflow-y: auto; }
.tools { display: flex; gap: .3em; max-width: 600px; margin: 0 auto; }
.tool { flex: 1; min-width: 0; min-height: 3.8em; border-radius: 12px; background: rgba(255,255,255,.12); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .15em; }
.tool span { font-size: .62em; opacity: .9; white-space: nowrap; }
.tool:active { background: rgba(255,255,255,.28); }
.tool.danger { color: #ff8a8a; }
.tool.on { color: var(--danger); }
.viewer.nochrome .vtop, .viewer.nochrome .vbottom, .viewer.nochrome .vnav { opacity: 0; pointer-events: none; }
.viewer.nochrome .vtop > *, .viewer.nochrome .vbottom > * { pointer-events: none; }

/* ---------- Dialogs ---------- */
.dlg-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.65); pointer-events: auto; z-index: 4; padding: 1em; }
.dlg { width: min(540px, 100%); max-height: 100%; display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.85); }
.dlg.wide { width: min(840px, 100%); }
.dlg-head, .dlg-foot { display: flex; align-items: center; gap: .5em; padding: .5em .8em; }
.dlg-head { justify-content: space-between; border-bottom: 1px solid var(--line); font-weight: 700; }
.dlg-foot { justify-content: flex-end; border-top: 1px solid var(--line); padding-bottom: calc(.5em + env(safe-area-inset-bottom, 0px)); }
.dlg-body { padding: .8em; overflow-y: auto; display: flex; flex-direction: column; gap: .7em; }
.pick { display: grid; grid-template-columns: repeat(auto-fit, minmax(calc(140px * var(--s)), 1fr)); gap: .7em; }
.pick button { border: 2px solid transparent; border-radius: 12px; overflow: hidden; background: rgba(0,0,0,.3); display: flex; flex-direction: column; text-align: center; }
.pick button:active { border-color: var(--accent); }
.pick img { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; display: block; }
.pick span { padding: .5em; font-size: .85em; }

/* ---------- Mobile: panel becomes the whole screen ---------- */
@media (max-width: 700px) {
    .gallery { background: #000; }
    .panel { position: fixed; inset: 0; width: auto; height: auto; max-width: none; border-radius: 0; border: 0; box-shadow: none; }
    .bar { padding-top: calc(env(safe-area-inset-top, 0px) + .35em); }
    .grid { grid-template-columns: var(--cols, repeat(2, minmax(0, 1fr))); gap: .6em; padding: .6em calc(env(safe-area-inset-right, 0px) + .6em) calc(env(safe-area-inset-bottom, 0px) + .6em) calc(env(safe-area-inset-left, 0px) + .6em); }
    .dlg-overlay { align-items: flex-end; padding: 0; }
    .dlg { width: 100%; border-radius: 16px 16px 0 0; max-height: 92%; }
}
@media (min-width: 701px) { .searchrow { display: flex; } #g_search_toggle { display: none; } }
`;

export const SPRITE = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></symbol>
<symbol id="i-back" viewBox="0 0 24 24"><path d="m12 19-7-7 7-7M19 12H5"/></symbol>
<symbol id="i-left" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></symbol>
<symbol id="i-right" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>
<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></symbol>
<symbol id="i-select" viewBox="0 0 24 24"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></symbol>
<symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></symbol>
<symbol id="i-heart" viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></symbol>
<symbol id="i-insert" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6M9 10h6"/></symbol>
<symbol id="i-send" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></symbol>
<symbol id="i-download" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></symbol>
<symbol id="i-redo" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></symbol>
<symbol id="i-image" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/></symbol>
<symbol id="i-camera" viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/></symbol>
<symbol id="i-sparkle" viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></symbol>
<symbol id="i-layers" viewBox="0 0 24 24"><path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></symbol>
<symbol id="i-user" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></symbol>
<symbol id="i-alert" viewBox="0 0 24 24"><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"/><path d="M12 9v4M12 17h.01"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></symbol>
</defs></svg>`;
