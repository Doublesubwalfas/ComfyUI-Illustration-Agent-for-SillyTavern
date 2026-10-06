import {
    getSettings, saveSettings, getGallery, updateGalleryRecord, removeGalleryRecords, getRecordByUrl, notify
} from './config.js';
import { escapeHtml, clamp } from './util.js';
import { deliverRoleplayImage, showImageToCharacter } from './chat.js';
import { rerollRecord } from './agent.js';
import { deleteStoredImage } from './comfy.js';
import { on } from './bus.js';

const $id = (id) => document.getElementById(id);
const PAGE = 48;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const G = { filter: 'all', char: null, q: '', select: false, sel: new Set(), list: [], shown: 0, shield: 0, io: null };
const V = {
    list: [], idx: -1, scale: 1, tx: 0, ty: 0, openedAt: 0,
    ptrs: new Map(), g: null, pinch: null, lastTap: 0, lastX: 0, lastY: 0, tapTimer: null
};

const now = () => performance.now();
const galleryOpen = () => !$id('ia_gallery').hidden;
const viewerOpen = () => !$id('ia_viewer').hidden;
const thumbOf = (r) => r.thumb || r.url || r.cleanUrl || '';
const fullOf = (r) => r.url || r.cleanUrl || '';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
export function initGallery() {
    if ($id('ia_gallery')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div id="ia_bubble" class="ia-bubble" title="Illustration Gallery" role="button" aria-label="Open illustration gallery">
        <i id="ia_bubble_icon" class="fa-solid fa-camera-retro"></i>
        <span id="ia_bubble_badge" class="ia-bubble-badge">0</span>
    </div>

    <div id="ia_gallery" class="ia-overlay" hidden>
        <div class="ia-panel" role="dialog" aria-modal="true" aria-label="Illustration gallery">
            <header class="ia-g-head">
                <div class="ia-g-title"><i class="fa-solid fa-images"></i><b>Gallery</b><span id="ia_g_count" class="ia-muted"></span></div>
                <div class="ia-g-search">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input id="ia_g_search" type="search" placeholder="Search name, caption, prompt…" autocomplete="off" enterkeyhint="search">
                    <button type="button" id="ia_g_clear" class="ia-clear" hidden aria-label="Clear search"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="ia-g-actions">
                    <button type="button" id="ia_g_select" class="ia-icon-btn" aria-label="Select images"><i class="fa-solid fa-square-check"></i></button>
                    <button type="button" id="ia_g_delete" class="ia-icon-btn ia-danger" aria-label="Delete selected" hidden><i class="fa-solid fa-trash"></i><span id="ia_g_selcount"></span></button>
                    <button type="button" id="ia_g_close" class="ia-icon-btn" aria-label="Close gallery"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </header>
            <nav id="ia_g_nav" class="ia-g-nav" aria-label="Filters"></nav>
            <main id="ia_g_grid" class="ia-g-grid"></main>
        </div>
    </div>

    <div id="ia_viewer" class="ia-viewer" hidden role="dialog" aria-modal="true" aria-label="Image viewer">
        <div id="ia_v_stage" class="ia-v-stage"><img id="ia_v_img" alt="" draggable="false"></div>
        <div id="ia_v_error" class="ia-v-error" hidden></div>
        <div class="ia-v-top">
            <div class="ia-v-titles"><b id="ia_v_title"></b><span id="ia_v_pos" class="ia-muted"></span></div>
            <button type="button" id="ia_v_close" class="ia-icon-btn ia-v-closebtn" aria-label="Close viewer"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <button type="button" id="ia_v_prev" class="ia-v-nav ia-prev" aria-label="Previous"><i class="fa-solid fa-chevron-left"></i></button>
        <button type="button" id="ia_v_next" class="ia-v-nav ia-next" aria-label="Next"><i class="fa-solid fa-chevron-right"></i></button>
        <div class="ia-v-bottom">
            <div id="ia_v_desc" class="ia-v-desc" title="Tap to expand"></div>
            <div class="ia-v-toolbar">
                <button type="button" id="ia_v_fav" class="ia-tool"><i class="fa-regular fa-heart"></i><span>Favorite</span></button>
                <button type="button" id="ia_v_insert" class="ia-tool"><i class="fa-solid fa-comment-medical"></i><span>Insert</span></button>
                <button type="button" id="ia_v_show" class="ia-tool"><i class="fa-solid fa-hand-sparkles"></i><span>Show</span></button>
                <button type="button" id="ia_v_save" class="ia-tool"><i class="fa-solid fa-download"></i><span>Save</span></button>
                <button type="button" id="ia_v_redo" class="ia-tool"><i class="fa-solid fa-rotate-right"></i><span>Redo</span></button>
                <button type="button" id="ia_v_del" class="ia-tool ia-danger"><i class="fa-solid fa-trash"></i><span>Delete</span></button>
            </div>
        </div>
    </div>`);

    initBubble();
    initGalleryEvents();
    initViewerEvents();
    updateBadge();
    applyBubbleVisibility();

    on('gallery', () => {
        updateBadge();
        if (galleryOpen() && !viewerOpen()) { renderNav(); render(true); }
    });
    on('ui', applyBubbleVisibility);
    on('status', (state) => {
        const busy = state !== 'idle';
        $id('ia_bubble').classList.toggle('is-busy', busy);
        $id('ia_bubble_icon').className = busy ? 'fa-solid fa-wand-magic-sparkles fa-spin' : 'fa-solid fa-camera-retro';
    });

    document.addEventListener('keydown', (e) => {
        if (viewerOpen()) {
            if (e.key === 'Escape') { e.preventDefault(); closeViewer(); }
            else if (e.key === 'ArrowLeft') step(-1);
            else if (e.key === 'ArrowRight') step(1);
        } else if (galleryOpen() && e.key === 'Escape' && document.activeElement?.id !== 'ia_g_search') closeGallery();
    });
}

function updateBadge() {
    const n = getGallery().length;
    $id('ia_bubble_badge').textContent = n > 99 ? '99+' : String(n);
}

function applyBubbleVisibility() {
    const s = getSettings();
    $id('ia_bubble').classList.toggle('ia-hidden', !s.showBubble);
    positionBubble();
}

// ---------------------------------------------------------------------------
// Floating bubble (Pointer Events: one code path for mouse, touch and pen)
// ---------------------------------------------------------------------------
function positionBubble() {
    const el = $id('ia_bubble');
    const s = getSettings();
    const size = el.offsetWidth || 52;
    const pos = s.bubblePos || { side: 'right', y: 0.6 };
    const top = clamp(pos.y * window.innerHeight, 8, window.innerHeight - size - 8);
    el.style.top = top + 'px';
    el.style.bottom = 'auto';
    if (pos.side === 'left') { el.style.left = '10px'; el.style.right = 'auto'; }
    else { el.style.right = '10px'; el.style.left = 'auto'; }
}

function initBubble() {
    const el = $id('ia_bubble');
    let down = null, dragged = false, suppressClick = false;

    el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        const r = el.getBoundingClientRect();
        down = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
        dragged = false;
    });
    el.addEventListener('pointermove', (e) => {
        if (!down) return;
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!dragged && Math.hypot(dx, dy) > 8) dragged = true;
        if (!dragged) return;
        const size = el.offsetWidth;
        el.style.left = clamp(down.left + dx, 4, window.innerWidth - size - 4) + 'px';
        el.style.top = clamp(down.top + dy, 4, window.innerHeight - size - 4) + 'px';
        el.style.right = 'auto';
    });
    const end = () => {
        if (!down) return;
        if (dragged) {
            const r = el.getBoundingClientRect();
            getSettings().bubblePos = {
                side: r.left + r.width / 2 < window.innerWidth / 2 ? 'left' : 'right',
                y: clamp(r.top / window.innerHeight, 0, 0.95)
            };
            saveSettings();
            positionBubble();
            suppressClick = true;
        }
        down = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // Opening happens on CLICK, not on pointerup: the browser's trailing synthetic
    // click then lands on the bubble itself and can never "tap through" onto the
    // gallery that has just opened underneath the finger.
    el.addEventListener('click', (e) => {
        e.preventDefault();
        if (suppressClick) { suppressClick = false; return; }
        galleryOpen() ? closeGallery() : openGallery();
    });
    window.addEventListener('resize', positionBubble);
    window.addEventListener('orientationchange', () => setTimeout(positionBubble, 200));
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------
export function openGallery() {
    G.select = false; G.sel.clear(); G.q = '';
    $id('ia_g_search').value = '';
    $id('ia_g_clear').hidden = true;
    syncSelectUi();
    renderNav();
    render();
    $id('ia_gallery').hidden = false;
    document.body.classList.add('ia-gallery-open');
}

export function closeGallery() {
    closeViewer();
    $id('ia_gallery').hidden = true;
    document.body.classList.remove('ia-gallery-open');
}

function computeList() {
    const q = G.q.trim().toLowerCase();
    return getGallery().filter(r => {
        if (G.filter === 'favorites' && !r.favorite) return false;
        if (G.char && r.character !== G.char) return false;
        if (q && !((r.character || '').toLowerCase().includes(q) ||
                   (r.description || '').toLowerCase().includes(q) ||
                   (r.positive || '').toLowerCase().includes(q))) return false;
        return true;
    });
}

function renderNav() {
    const chars = [...new Set(getGallery().map(r => r.character).filter(Boolean))];
    const chip = (attrs, active, html) => `<button type="button" class="ia-chip${active ? ' active' : ''}" ${attrs}>${html}</button>`;
    $id('ia_g_nav').innerHTML =
        chip('data-f="all"', G.filter === 'all' && !G.char, '<i class="fa-solid fa-layer-group"></i> All') +
        chip('data-f="favorites"', G.filter === 'favorites' && !G.char, '<i class="fa-solid fa-heart"></i> Favorites') +
        chars.map(c => chip(`data-c="${escapeHtml(c)}"`, G.char === c, `<i class="fa-solid fa-user"></i> ${escapeHtml(c)}`)).join('');
}

function cardHtml(r) {
    const sel = G.sel.has(String(r.id));
    const src = thumbOf(r);
    return `
    <div class="ia-card${sel ? ' ia-selected' : ''}" data-id="${escapeHtml(r.id)}">
        <div class="ia-card-img">
            ${src ? `<img src="${escapeHtml(src)}" loading="lazy" decoding="async" alt="" draggable="false">` : '<div class="ia-noimg"><i class="fa-solid fa-image"></i></div>'}
            <button type="button" class="ia-card-fav" aria-label="Toggle favorite"><i class="${r.favorite ? 'fa-solid' : 'fa-regular'} fa-heart"></i></button>
            <i class="ia-card-check fa-solid fa-circle-check"></i>
        </div>
        <div class="ia-card-meta"><b>${escapeHtml(r.character || 'Unknown')}</b><span class="ia-desc">${escapeHtml(r.description || r.reason || '')}</span></div>
    </div>`;
}

function render(keepScroll = false) {
    const grid = $id('ia_g_grid');
    const top = keepScroll ? grid.scrollTop : 0;
    G.list = computeList();
    G.shown = 0;
    $id('ia_g_count').textContent = G.list.length ? `${G.list.length}` : '';
    grid.innerHTML = '';
    if (!G.list.length) {
        grid.innerHTML = `<div class="ia-empty">${G.q ? `No images match “${escapeHtml(G.q)}”.` : 'No illustrations yet.'}</div>`;
        return;
    }
    appendPage();
    grid.scrollTop = top;
}

function appendPage() {
    const grid = $id('ia_g_grid');
    grid.querySelector('#ia_g_sentinel')?.remove();
    const next = G.list.slice(G.shown, G.shown + PAGE);
    grid.insertAdjacentHTML('beforeend', next.map(cardHtml).join(''));
    G.shown += next.length;
    if (G.shown < G.list.length) {
        grid.insertAdjacentHTML('beforeend', '<div id="ia_g_sentinel" class="ia-sentinel"></div>');
        G.io?.disconnect();
        G.io = new IntersectionObserver((en) => { if (en[0].isIntersecting) appendPage(); }, { root: grid, rootMargin: '600px' });
        G.io.observe($id('ia_g_sentinel'));
    }
}

function syncSelectUi() {
    $id('ia_g_select').classList.toggle('active', G.select);
    $id('ia_g_delete').hidden = !G.select;
    $id('ia_g_selcount').textContent = G.sel.size ? ` ${G.sel.size}` : '';
    $id('ia_g_grid').classList.toggle('ia-selecting', G.select);
}

function toggleSel(card, id) {
    const k = String(id);
    G.sel.has(k) ? G.sel.delete(k) : G.sel.add(k);
    card.classList.toggle('ia-selected', G.sel.has(k));
    syncSelectUi();
}

function toggleFav(id) {
    const r = getGallery().find(x => String(x.id) === String(id));
    if (!r) return;
    updateGalleryRecord(id, { favorite: !r.favorite });
}

async function removeRecords(ids) {
    const removed = removeGalleryRecords(ids);
    if (getSettings().deleteFilesOnRemove) {
        for (const r of removed) { await deleteStoredImage(r.url); if (r.thumb) await deleteStoredImage(r.thumb); }
    }
    return removed;
}

function initGalleryEvents() {
    $id('ia_g_close').addEventListener('click', closeGallery);
    // Tapping the dim area outside the panel (desktop) closes it.
    $id('ia_gallery').addEventListener('click', (e) => { if (e.target.id === 'ia_gallery' && now() > G.shield) closeGallery(); });

    $id('ia_g_nav').addEventListener('click', (e) => {
        const b = e.target.closest('.ia-chip'); if (!b) return;
        if (b.dataset.c) { G.char = b.dataset.c; G.filter = 'all'; }
        else { G.char = null; G.filter = b.dataset.f; }
        renderNav(); render();
    });

    const search = $id('ia_g_search');
    let t;
    search.addEventListener('input', () => {
        $id('ia_g_clear').hidden = !search.value.trim();
        clearTimeout(t);
        t = setTimeout(() => { G.q = search.value; render(); }, 150);
    });
    $id('ia_g_clear').addEventListener('click', () => { search.value = ''; G.q = ''; $id('ia_g_clear').hidden = true; render(); search.focus(); });

    $id('ia_g_select').addEventListener('click', () => {
        G.select = !G.select;
        if (!G.select) { G.sel.clear(); $id('ia_g_grid').querySelectorAll('.ia-selected').forEach(c => c.classList.remove('ia-selected')); }
        syncSelectUi();
    });

    $id('ia_g_delete').addEventListener('click', async () => {
        if (!G.sel.size) return;
        const extra = getSettings().deleteFilesOnRemove ? ' The image files will also be deleted from the server.' : '';
        if (!confirm(`Delete ${G.sel.size} selected image(s) from the gallery?${extra}`)) return;
        await removeRecords([...G.sel]);
        G.sel.clear(); G.select = false; syncSelectUi();
        notify('success', 'Deleted selected images.');
    });

    const grid = $id('ia_g_grid');
    grid.addEventListener('click', (e) => {
        if (now() < G.shield) return;                    // swallow ghost taps right after closing the viewer / long-press
        const card = e.target.closest('.ia-card'); if (!card) return;
        const id = card.dataset.id;
        if (e.target.closest('.ia-card-fav')) { toggleFav(id); return; }
        if (G.select) { toggleSel(card, id); return; }
        openViewer(G.list, G.list.findIndex(r => String(r.id) === id));
    });

    // Long-press a card to start selecting.
    let lp = null;
    grid.addEventListener('pointerdown', (e) => {
        const card = e.target.closest('.ia-card');
        if (!card || e.target.closest('.ia-card-fav')) return;
        clearTimeout(lp);
        lp = setTimeout(() => {
            lp = null; G.shield = now() + 450;
            G.select = true; syncSelectUi(); toggleSel(card, card.dataset.id);
            navigator.vibrate?.(15);
        }, 520);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'scroll']) grid.addEventListener(ev, () => { clearTimeout(lp); lp = null; }, { passive: true });
    grid.addEventListener('contextmenu', (e) => { if (e.target.closest('.ia-card')) e.preventDefault(); });
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------
export function openViewerByUrl(url) {
    const rec = getRecordByUrl(url);
    if (!rec) return;
    const list = galleryOpen() ? G.list : getGallery();
    let i = list.findIndex(r => r.id === rec.id);
    openViewer(i >= 0 ? list : getGallery(), i >= 0 ? i : getGallery().findIndex(r => r.id === rec.id));
}

function openViewer(list, index) {
    if (!list.length || index < 0) return;
    V.list = list; V.idx = index; V.openedAt = now();
    $id('ia_viewer').classList.remove('ia-chrome-off');
    $id('ia_viewer').hidden = false;
    $id('ia_gallery').inert = true;                 // nothing behind the viewer can receive taps
    show();
}

function closeViewer() {
    if (!viewerOpen()) return;
    $id('ia_viewer').hidden = true;
    $id('ia_gallery').inert = false;
    $id('ia_v_img').removeAttribute('src');
    clearTimeout(V.tapTimer);
    V.list = []; V.idx = -1; V.ptrs.clear(); V.g = null; V.pinch = null;
    G.shield = now() + 450;                          // ignore the tail of the closing tap
    if (galleryOpen()) { renderNav(); render(true); }   // pick up deletions / favorites / new variations
}

function resetZoom() {
    V.scale = 1; V.tx = 0; V.ty = 0;
    $id('ia_v_img').style.transform = '';
}

function show() {
    const r = V.list[V.idx];
    if (!r) { closeViewer(); return; }
    resetZoom();
    const img = $id('ia_v_img'), err = $id('ia_v_error');
    err.hidden = true; img.style.visibility = 'visible';
    img.onerror = () => {
        img.style.visibility = 'hidden';
        const legacy = /^https?:\/\/.+\/view\?/.test(fullOf(r));
        err.innerHTML = legacy
            ? '<i class="fa-solid fa-link-slash"></i><b>This image is stored as a localhost link</b>It was made by an older version and only loads on the PC running ComfyUI. Open this extension\'s settings on that PC and press <i>Repair old images</i>.'
            : '<i class="fa-solid fa-image"></i><b>Image could not be loaded</b>The file may have been deleted from the server.';
        err.hidden = false;
    };
    img.src = fullOf(r);
    img.alt = r.description || '';
    $id('ia_v_title').textContent = r.character || 'Illustration';
    $id('ia_v_pos').textContent = `${V.idx + 1} / ${V.list.length}`;
    const desc = $id('ia_v_desc');
    desc.textContent = r.description || r.reason || 'No description.';
    desc.classList.remove('open');
    $id('ia_v_prev').hidden = V.idx <= 0;
    $id('ia_v_next').hidden = V.idx >= V.list.length - 1;
    syncFav(r);
    for (const d of [-1, 1]) { const n = V.list[V.idx + d]; if (n) new Image().src = fullOf(n); }   // preload neighbours
}

function syncFav(r) {
    $id('ia_v_fav').innerHTML = r.favorite
        ? '<i class="fa-solid fa-heart" style="color:#ff6b6b"></i><span>Favorited</span>'
        : '<i class="fa-regular fa-heart"></i><span>Favorite</span>';
}

function step(d) {
    const n = V.idx + d;
    if (n < 0 || n >= V.list.length) return;
    V.idx = n; show();
}

function toggleChrome() { $id('ia_viewer').classList.toggle('ia-chrome-off'); }

// -- zoom / pan ------------------------------------------------------------
function applyTransform() { $id('ia_v_img').style.transform = `translate3d(${V.tx}px,${V.ty}px,0) scale(${V.scale})`; }

function clampPan() {
    const img = $id('ia_v_img'), st = $id('ia_v_stage').getBoundingClientRect();
    const mx = Math.max(0, (img.clientWidth * V.scale - st.width) / 2);
    const my = Math.max(0, (img.clientHeight * V.scale - st.height) / 2);
    V.tx = clamp(V.tx, -mx, mx); V.ty = clamp(V.ty, -my, my);
}

function zoomAt(ns, px, py) {
    ns = clamp(ns, 1, 6);
    const r = $id('ia_v_stage').getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const qx = (px - cx - V.tx) / V.scale, qy = (py - cy - V.ty) / V.scale;
    V.scale = ns; V.tx = px - cx - ns * qx; V.ty = py - cy - ns * qy;
    if (ns === 1) { V.tx = 0; V.ty = 0; }
    clampPan(); applyTransform();
}

function handleTap(x, y) {
    if (now() - V.lastTap < 300 && Math.hypot(x - V.lastX, y - V.lastY) < 40) {     // double tap
        clearTimeout(V.tapTimer); V.lastTap = 0;
        zoomAt(V.scale > 1 ? 1 : 2.5, x, y);
        return;
    }
    V.lastTap = now(); V.lastX = x; V.lastY = y;
    V.tapTimer = setTimeout(toggleChrome, 280);                                       // single tap: show/hide controls
}

function initViewerEvents() {
    const stage = $id('ia_v_stage');

    stage.addEventListener('pointerdown', (e) => {
        if (now() - V.openedAt < 300) return;                                         // tap-through guard
        stage.setPointerCapture(e.pointerId);
        V.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (V.ptrs.size === 1) V.g = { sx: e.clientX, sy: e.clientY, t: now(), moved: false, otx: V.tx, oty: V.ty };
        else if (V.ptrs.size === 2) {
            const [a, b] = [...V.ptrs.values()];
            V.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: V.scale };
            V.g = null;
        }
    });

    stage.addEventListener('pointermove', (e) => {
        if (!V.ptrs.has(e.pointerId)) return;
        V.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (V.pinch && V.ptrs.size >= 2) {
            const [a, b] = [...V.ptrs.values()];
            zoomAt(V.pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / V.pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
            return;
        }
        if (!V.g) return;
        const dx = e.clientX - V.g.sx, dy = e.clientY - V.g.sy;
        if (Math.hypot(dx, dy) > 8) V.g.moved = true;
        if (V.scale > 1) { V.tx = V.g.otx + dx; V.ty = V.g.oty + dy; clampPan(); applyTransform(); }
        else if (V.g.moved) $id('ia_v_img').style.transform = `translate3d(${dx}px,${Math.max(0, dy) * 0.6}px,0)`;
    });

    const finish = (e, cancelled) => {
        if (!V.ptrs.has(e.pointerId)) return;
        V.ptrs.delete(e.pointerId);
        if (V.pinch && V.ptrs.size < 2) V.pinch = null;
        if (V.ptrs.size > 0 || !V.g) return;
        const g = V.g; V.g = null;
        const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
        if (V.scale > 1) { if (!g.moved && !cancelled) handleTap(e.clientX, e.clientY); return; }
        applyTransform();                                                              // snap back after a drag
        if (cancelled) return;
        if (!g.moved) { if (now() - g.t < 450) handleTap(e.clientX, e.clientY); }
        else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1);
        else if (dy > 110 && dy > Math.abs(dx) * 1.4) closeViewer();
    };
    stage.addEventListener('pointerup', (e) => finish(e, false));
    stage.addEventListener('pointercancel', (e) => finish(e, true));
    stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(V.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); }, { passive: false });

    $id('ia_v_close').addEventListener('click', closeViewer);
    $id('ia_v_prev').addEventListener('click', () => step(-1));
    $id('ia_v_next').addEventListener('click', () => step(1));
    $id('ia_v_desc').addEventListener('click', (e) => e.currentTarget.classList.toggle('open'));

    const cur = () => V.list[V.idx];

    $id('ia_v_fav').addEventListener('click', () => {
        const r = cur(); if (!r) return;
        const upd = updateGalleryRecord(r.id, { favorite: !r.favorite });
        if (upd) syncFav(upd);
    });

    $id('ia_v_insert').addEventListener('click', async () => {
        const r = cur(); if (!r) return;
        closeGallery();
        await deliverRoleplayImage(fullOf(r), r.description);
    });

    $id('ia_v_show').addEventListener('click', async () => {
        const r = cur(); if (!r) return;
        closeGallery();
        await showImageToCharacter(fullOf(r), r.description);
    });

    $id('ia_v_save').addEventListener('click', async () => {
        const r = cur(); if (!r) return;
        const name = `illustration_${(r.character || 'img').replace(/[^\w-]+/g, '_')}_${String(r.date || Date.now()).slice(0, 10)}.png`;
        try {
            const blob = await (await fetch(fullOf(r))).blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        } catch (_) { window.open(fullOf(r), '_blank'); }
    });

    $id('ia_v_redo').addEventListener('click', () => { const r = cur(); if (r) rerollRecord(r); });

    $id('ia_v_del').addEventListener('click', async () => {
        const r = cur(); if (!r) return;
        if (!confirm('Delete this image from the gallery?')) return;
        await removeRecords([r.id]);
        V.list = V.list.filter(x => x.id !== r.id);
        if (!V.list.length) { closeViewer(); return; }
        V.idx = Math.min(V.idx, V.list.length - 1);
        show();
    });
}
