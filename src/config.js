import {
    getSettings, saveSettings, getGallery, updateGalleryRecord, removeGalleryRecords, getRecordByUrl, notify
} from './config.js';
import { escapeHtml, clamp } from './util.js';
import { deliverRoleplayImage, showImageToCharacter } from './chat.js';
import { rerollRecord } from './agent.js';
import { deleteStoredImage } from './comfy.js';
import { on } from './bus.js';
import { getRoot, app, $id, hostEl, icon, applyUiPrefs } from './shadow.js';

const PAGE = 48;
const now = () => performance.now();

const G = { filter: 'all', char: null, q: '', select: false, sel: new Set(), list: [], shown: 0, shield: 0, io: null };
const V = { list: [], idx: -1, scale: 1, tx: 0, ty: 0, openedAt: 0, ptrs: new Map(), g: null, pinch: null, lastTap: 0, lastX: 0, lastY: 0, tapTimer: null };

const galleryOpen = () => !$id('ia_gallery').hidden;
const viewerOpen = () => !$id('ia_viewer').hidden;
const thumbOf = (r) => r.thumb || r.url || r.cleanUrl || '';
const fullOf = (r) => r.url || r.cleanUrl || '';

// ---------------------------------------------------------------------------
export function initGallery() {
    if ($id('ia_gallery')) return;
    getRoot();
    app().insertAdjacentHTML('beforeend', `
    <div id="ia_bubble" class="bubble" role="button" aria-label="Open illustration gallery">
        <span id="ia_bubble_icon">${icon('camera')}</span><span id="ia_bubble_badge" class="badge">0</span>
    </div>

    <div id="ia_gallery" class="gallery" hidden>
        <div class="panel surface" role="dialog" aria-modal="true" aria-label="Illustration gallery">
            <header class="bar">
                <button type="button" id="g_close" class="btn icon" aria-label="Close gallery">${icon('back')}</button>
                <div class="title"><span>Gallery</span><span id="g_count" class="muted"></span></div>
                <span class="spacer"></span>
                <button type="button" id="g_search_toggle" class="btn icon" aria-label="Search">${icon('search')}</button>
                <button type="button" id="g_select" class="btn icon" aria-label="Select images">${icon('select')}</button>
            </header>
            <div id="g_searchrow" class="searchrow">
                <input id="g_search" type="search" placeholder="Search name, caption, prompt…" autocomplete="off" enterkeyhint="search">
                <button type="button" id="g_clear" class="btn icon" aria-label="Clear search" hidden>${icon('x')}</button>
            </div>
            <nav id="g_nav" class="chips" aria-label="Filters"></nav>
            <main id="g_grid" class="grid"></main>
            <footer id="g_selbar" class="selbar" hidden>
                <span id="g_selcount" class="grow">0 selected</span>
                <button type="button" id="g_selall" class="btn">All</button>
                <button type="button" id="g_delete" class="btn solid-danger">${icon('trash')} Delete</button>
                <button type="button" id="g_selcancel" class="btn">Cancel</button>
            </footer>
        </div>
    </div>

    <div id="ia_viewer" class="viewer" hidden role="dialog" aria-modal="true" aria-label="Image viewer">
        <div id="v_stage" class="stage"><img id="v_img" alt="" draggable="false"></div>
        <div id="v_err" class="verr" hidden></div>
        <div class="vtop">
            <div class="vtitles"><b id="v_title"></b><span id="v_pos" class="muted"></span></div>
            <button type="button" id="v_close" class="vclose" aria-label="Close viewer">${icon('x')}</button>
        </div>
        <button type="button" id="v_prev" class="vnav prev" aria-label="Previous">${icon('left')}</button>
        <button type="button" id="v_next" class="vnav next" aria-label="Next">${icon('right')}</button>
        <div class="vbottom">
            <div id="v_desc" class="vdesc"></div>
            <div class="tools">
                <button type="button" id="v_fav" class="tool"></button>
                <button type="button" id="v_insert" class="tool">${icon('insert')}<span>Insert</span></button>
                <button type="button" id="v_show" class="tool">${icon('send')}<span>Show</span></button>
                <button type="button" id="v_save" class="tool">${icon('download')}<span>Save</span></button>
                <button type="button" id="v_redo" class="tool">${icon('redo')}<span>Redo</span></button>
                <button type="button" id="v_del" class="tool danger">${icon('trash')}<span>Delete</span></button>
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
    on('ui', () => { applyUiPrefs(); applyBubbleVisibility(); });
    on('status', (state) => {
        const busy = state !== 'idle';
        $id('ia_bubble').classList.toggle('busy', busy);
        $id('ia_bubble_icon').innerHTML = busy ? icon('sparkle', 'spin') : icon('camera');
    });

    document.addEventListener('keydown', (e) => {
        if (viewerOpen()) {
            if (e.key === 'Escape') { e.preventDefault(); closeViewer(); }
            else if (e.key === 'ArrowLeft') step(-1);
            else if (e.key === 'ArrowRight') step(1);
        } else if (galleryOpen() && e.key === 'Escape' && getRoot().activeElement?.id !== 'g_search') closeGallery();
    });
}

function updateBadge() {
    const n = getGallery().length;
    $id('ia_bubble_badge').textContent = n > 99 ? '99+' : String(n);
}

function applyBubbleVisibility() {
    $id('ia_bubble').classList.toggle('off', !getSettings().showBubble);
    positionBubble();
}

function positionBubble() {
    const el = $id('ia_bubble');
    const size = el.offsetWidth || 54;
    const pos = getSettings().bubblePos || { side: 'right', y: 0.6 };
    el.style.top = clamp(pos.y * window.innerHeight, 8, window.innerHeight - size - 8) + 'px';
    el.style.bottom = 'auto';
    if (pos.side === 'left') { el.style.left = '10px'; el.style.right = 'auto'; }
    else { el.style.right = '10px'; el.style.left = 'auto'; }
}

function initBubble() {
    const el = $id('ia_bubble');
    let down = null, dragged = false;
    
    el.addEventListener('pointerdown', (e) => {
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        const r = el.getBoundingClientRect();
        down = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
        dragged = false;
    });
    
    el.addEventListener('pointermove', (e) => {
        if (!down) return;
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!dragged && Math.hypot(dx, dy) > 12) dragged = true;
        if (!dragged) return;
        const size = el.offsetWidth;
        el.style.left = clamp(down.left + dx, 4, window.innerWidth - size - 4) + 'px';
        el.style.top = clamp(down.top + dy, 4, window.innerHeight - size - 4) + 'px';
        el.style.right = 'auto';
    });
    
    const end = (e) => {
        if (!down) return;
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
        if (dragged) {
            const r = el.getBoundingClientRect();
            getSettings().bubblePos = { side: r.left + r.width / 2 < window.innerWidth / 2 ? 'left' : 'right', y: clamp(r.top / window.innerHeight, 0, 0.95) };
            saveSettings(); positionBubble();
        } else {
            galleryOpen() ? closeGallery() : openGallery();
        }
        down = null;
    };
    
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', (e) => e.preventDefault());
    
    window.addEventListener('resize', positionBubble);
    window.addEventListener('orientationchange', () => setTimeout(positionBubble, 250));
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------
export function openGallery() {
    G.select = false; G.sel.clear(); G.q = '';
    $id('g_search').value = ''; $id('g_clear').hidden = true;
    $id('g_searchrow').classList.remove('open');
    G.shield = now() + 450; // Protect against synthetic touch click immediately closing the modal
    syncSelectUi(); renderNav(); render();
    $id('ia_gallery').hidden = false;
    hostEl().classList.add('gallery-open');
}

export function closeGallery() {
    closeViewer(true);
    $id('ia_gallery').hidden = true;
    hostEl().classList.remove('gallery-open');
    G.shield = now() + 450;
}

function computeList() {
    const q = G.q.trim().toLowerCase();
    return getGallery().filter(r => {
        if (!r) return false;
        if (G.filter === 'favorites' && !r.favorite) return false;
        if (G.char && r.character !== G.char) return false;
        if (q && !((r.character || '').toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q) || (r.positive || '').toLowerCase().includes(q))) return false;
        return true;
    });
}

function renderNav() {
    const chars = [...new Set(getGallery().map(r => r?.character).filter(Boolean))];
    const chip = (attrs, active, html) => `<button type="button" class="chip${active ? ' active' : ''}" ${attrs}>${html}</button>`;
    $id('g_nav').innerHTML =
        chip('data-f="all"', G.filter === 'all' && !G.char, `${icon('layers')} All`) +
        chip('data-f="favorites"', G.filter === 'favorites' && !G.char, `${icon('heart')} Favorites`) +
        chars.map(c => chip(`data-c="${escapeHtml(c)}"`, G.char === c, `${icon('user')} ${escapeHtml(c)}`)).join('');
}

function cardHtml(r) {
    const src = thumbOf(r);
    return `
    <div class="card${G.sel.has(String(r.id)) ? ' sel' : ''}" data-id="${escapeHtml(r.id)}">
        <div class="img">
            ${src ? `<img src="${escapeHtml(src)}" loading="lazy" decoding="async" alt="" draggable="false">` : `<div class="noimg">${icon('image')}</div>`}
            <button type="button" class="fav${r.favorite ? ' on' : ''}" data-act="fav" aria-label="Toggle favorite">${icon('heart', r.favorite ? 'fill' : '')}</button>
            <span class="tick">${icon('check')}</span>
        </div>
        <div class="meta"><b>${escapeHtml(r.character || 'Unknown')}</b><span class="desc">${escapeHtml(r.description || r.reason || '')}</span></div>
    </div>`;
}

function render(keepScroll = false) {
    const grid = $id('g_grid');
    const top = keepScroll ? grid.scrollTop : 0;
    G.list = computeList(); G.shown = 0;
    $id('g_count').textContent = G.list.length ? String(G.list.length) : '';
    grid.innerHTML = '';
    if (!G.list.length) {
        grid.innerHTML = `<div class="empty">${G.q ? `No images match “${escapeHtml(G.q)}”.` : 'No illustrations yet.'}</div>`;
        return;
    }
    appendPage();
    grid.scrollTop = top;
}

function appendPage() {
    const grid = $id('g_grid');
    grid.querySelector('#g_sentinel')?.remove();
    const next = G.list.slice(G.shown, G.shown + PAGE);
    grid.insertAdjacentHTML('beforeend', next.map(cardHtml).join(''));
    G.shown += next.length;
    if (G.shown < G.list.length) {
        grid.insertAdjacentHTML('beforeend', '<div id="g_sentinel" class="sentinel"></div>');
        G.io?.disconnect();
        G.io = new IntersectionObserver((en) => { if (en[0].isIntersecting) appendPage(); }, { root: grid, rootMargin: '600px' });
        G.io.observe($id('g_sentinel'));
    }
}

function syncSelectUi() {
    $id('g_select').classList.toggle('on', G.select);
    $id('g_selbar').hidden = !G.select;
    $id('g_selcount').textContent = `${G.sel.size} selected`;
    $id('g_grid').classList.toggle('selecting', G.select);
}

function toggleSel(card) {
    const k = card.dataset.id;
    G.sel.has(k) ? G.sel.delete(k) : G.sel.add(k);
    card.classList.toggle('sel', G.sel.has(k));
    syncSelectUi();
}

function exitSelect() {
    G.select = false; G.sel.clear();
    $id('g_grid').querySelectorAll('.card.sel').forEach(c => c.classList.remove('sel'));
    syncSelectUi();
}

function toggleFav(id) {
    const r = getGallery().find(x => String(x.id) === String(id));
    if (r) updateGalleryRecord(id, { favorite: !r.favorite });
}

async function removeRecords(ids) {
    const removed = removeGalleryRecords(ids);
    if (getSettings().deleteFilesOnRemove) {
        for (const r of removed) { await deleteStoredImage(r.url); if (r.thumb) await deleteStoredImage(r.thumb); }
    }
    return removed;
}

function initGalleryEvents() {
    $id('g_close').addEventListener('click', closeGallery);
    $id('ia_gallery').addEventListener('click', (e) => { 
        if (e.target.id === 'ia_gallery' && now() > G.shield) closeGallery(); 
    });

    $id('g_nav').addEventListener('click', (e) => {
        const b = e.target.closest('.chip'); if (!b) return;
        if (b.dataset.c) { G.char = b.dataset.c; G.filter = 'all'; } else { G.char = null; G.filter = b.dataset.f; }
        renderNav(); render();
    });

    const search = $id('g_search');
    let t;
    search.addEventListener('input', () => {
        $id('g_clear').hidden = !search.value.trim();
        clearTimeout(t); t = setTimeout(() => { G.q = search.value; render(); }, 150);
    });
    $id('g_clear').addEventListener('click', () => { search.value = ''; G.q = ''; $id('g_clear').hidden = true; render(); search.focus(); });
    $id('g_search_toggle').addEventListener('click', () => {
        const row = $id('g_searchrow');
        row.classList.toggle('open');
        if (row.classList.contains('open')) search.focus();
    });

    $id('g_select').addEventListener('click', () => { G.select ? exitSelect() : (G.select = true, syncSelectUi()); });
    $id('g_selcancel').addEventListener('click', exitSelect);
    $id('g_selall').addEventListener('click', () => {
        const all = G.sel.size === G.list.length;
        G.sel.clear();
        if (!all) G.list.forEach(r => G.sel.add(String(r.id)));
        $id('g_grid').querySelectorAll('.card').forEach(c => c.classList.toggle('sel', G.sel.has(c.dataset.id)));
        syncSelectUi();
    });
    $id('g_delete').addEventListener('click', async () => {
        if (!G.sel.size) return;
        const extra = getSettings().deleteFilesOnRemove ? ' The image files will also be deleted from the server.' : '';
        if (!confirm(`Delete ${G.sel.size} selected image(s) from the gallery?${extra}`)) return;
        await removeRecords([...G.sel]);
        exitSelect();
        notify('success', 'Deleted selected images.');
    });

    const grid = $id('g_grid');
    grid.addEventListener('click', (e) => {
        if (now() < G.shield) return;
        const card = e.target.closest('.card'); if (!card) return;
        if (e.target.closest('[data-act="fav"]')) { toggleFav(card.dataset.id); return; }
        if (G.select) { toggleSel(card); return; }
        openViewer(G.list, G.list.findIndex(r => String(r.id) === card.dataset.id));
    });

    let lp = null;
    grid.addEventListener('pointerdown', (e) => {
        const card = e.target.closest('.card');
        if (!card || e.target.closest('[data-act="fav"]')) return;
        clearTimeout(lp);
        lp = setTimeout(() => { lp = null; G.shield = now() + 450; G.select = true; syncSelectUi(); if (!G.sel.has(card.dataset.id)) toggleSel(card); navigator.vibrate?.(15); }, 550);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'scroll']) grid.addEventListener(ev, () => { clearTimeout(lp); lp = null; }, { passive: true });
    grid.addEventListener('contextmenu', (e) => { if (e.target.closest('.card')) e.preventDefault(); });
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------
export function openViewerByUrl(url) {
    const rec = getRecordByUrl(url);
    if (!rec) return;
    const list = galleryOpen() ? G.list : getGallery();
    let i = list.findIndex(r => r.id === rec.id);
    if (i < 0) { openViewer(getGallery(), getGallery().findIndex(r => r.id === rec.id)); return; }
    openViewer(list, i);
}

function openViewer(list, index) {
    if (!list.length || index < 0) return;
    V.list = list; V.idx = index; V.openedAt = now();
    $id('ia_viewer').classList.remove('nochrome');
    $id('ia_viewer').hidden = false;
    $id('ia_gallery').inert = true;
    hostEl().classList.add('viewer-open');
    show();
}

function closeViewer(silent = false) {
    if (!viewerOpen()) return;
    $id('ia_viewer').hidden = true;
    $id('ia_gallery').inert = false;
    hostEl().classList.remove('viewer-open');
    $id('v_img').removeAttribute('src');
    clearTimeout(V.tapTimer);
    V.list = []; V.idx = -1; V.ptrs.clear(); V.g = null; V.pinch = null;
    G.shield = now() + 450;
    if (!silent && galleryOpen()) { renderNav(); render(true); }
}

function resetZoom() { V.scale = 1; V.tx = 0; V.ty = 0; $id('v_img').style.transform = ''; }

function show() {
    const r = V.list[V.idx];
    if (!r) { closeViewer(); return; }
    resetZoom();
    const img = $id('v_img'), err = $id('v_err');
    err.hidden = true; img.style.visibility = 'visible';
    img.onerror = () => {
        img.style.visibility = 'hidden';
        const legacy = /^https?:\/\/.+\/view\?/.test(fullOf(r));
        err.innerHTML = legacy
            ? `${icon('alert')}<b>This image is stored as a localhost link</b><span>It was made by an older version and only loads on the PC running ComfyUI. Open the extension settings on that PC and press “Repair old images”.</span>`
            : `${icon('image')}<b>Image could not be loaded</b><span>The file may have been deleted from the server.</span>`;
        err.hidden = false;
    };
    img.src = fullOf(r);
    img.alt = r.description || '';
    $id('v_title').textContent = r.character || 'Illustration';
    $id('v_pos').textContent = `${V.idx + 1} / ${V.list.length}`;
    const desc = $id('v_desc');
    desc.textContent = r.description || r.reason || 'No description.';
    desc.classList.remove('open');
    $id('v_prev').hidden = V.idx <= 0;
    $id('v_next').hidden = V.idx >= V.list.length - 1;
    syncFav(r);
    for (const d of [-1, 1]) { const n = V.list[V.idx + d]; if (n) new Image().src = fullOf(n); }
}

function syncFav(r) {
    const b = $id('v_fav');
    b.classList.toggle('on', !!r.favorite);
    b.innerHTML = `${icon('heart', r.favorite ? 'fill' : '')}<span>${r.favorite ? 'Favorited' : 'Favorite'}</span>`;
}

function step(d) {
    const n = V.idx + d;
    if (n < 0 || n >= V.list.length) return;
    V.idx = n; show();
}

const toggleChrome = () => $id('ia_viewer').classList.toggle('nochrome');
function applyTransform() { $id('v_img').style.transform = `translate3d(${V.tx}px,${V.ty}px,0) scale(${V.scale})`; }

function clampPan() {
    const img = $id('v_img'), st = $id('v_stage').getBoundingClientRect();
    const mx = Math.max(0, (img.clientWidth * V.scale - st.width) / 2);
    const my = Math.max(0, (img.clientHeight * V.scale - st.height) / 2);
    V.tx = clamp(V.tx, -mx, mx); V.ty = clamp(V.ty, -my, my);
}

function zoomAt(ns, px, py) {
    ns = clamp(ns, 1, 6);
    const r = $id('v_stage').getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const qx = (px - cx - V.tx) / V.scale, qy = (py - cy - V.ty) / V.scale;
    V.scale = ns; V.tx = px - cx - ns * qx; V.ty = py - cy - ns * qy;
    if (ns === 1) { V.tx = 0; V.ty = 0; }
    clampPan(); applyTransform();
}

function handleTap(x, y) {
    if (now() - V.lastTap < 300 && Math.hypot(x - V.lastX, y - V.lastY) < 40) {
        clearTimeout(V.tapTimer); V.lastTap = 0;
        zoomAt(V.scale > 1 ? 1 : 2.5, x, y);
        return;
    }
    V.lastTap = now(); V.lastX = x; V.lastY = y;
    V.tapTimer = setTimeout(toggleChrome, 280);
}

function initViewerEvents() {
    const stage = $id('v_stage');

    stage.addEventListener('pointerdown', (e) => {
        if (now() - V.openedAt < 300) return;
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
        else if (V.g.moved) $id('v_img').style.transform = `translate3d(${dx}px,${Math.max(0, dy) * 0.6}px,0)`;
    });

    const finish = (e, cancelled) => {
        if (!V.ptrs.has(e.pointerId)) return;
        V.ptrs.delete(e.pointerId);
        if (V.pinch && V.ptrs.size < 2) V.pinch = null;
        if (V.ptrs.size > 0 || !V.g) return;
        const g = V.g; V.g = null;
        const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
        if (V.scale > 1) { if (!g.moved && !cancelled) handleTap(e.clientX, e.clientY); return; }
        applyTransform();
        if (cancelled) return;
        if (!g.moved) { if (now() - g.t < 450) handleTap(e.clientX, e.clientY); }
        else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1);
        else if (dy > 110 && dy > Math.abs(dx) * 1.4) closeViewer();
    };
    stage.addEventListener('pointerup', (e) => finish(e, false));
    stage.addEventListener('pointercancel', (e) => finish(e, true));
    stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(V.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); }, { passive: false });

    $id('v_close').addEventListener('click', () => closeViewer());
    $id('v_prev').addEventListener('click', () => step(-1));
    $id('v_next').addEventListener('click', () => step(1));
    $id('v_desc').addEventListener('click', (e) => e.currentTarget.classList.toggle('open'));

    const cur = () => V.list[V.idx];

    $id('v_fav').addEventListener('click', () => {
        const r = cur(); if (!r) return;
        const upd = updateGalleryRecord(r.id, { favorite: !r.favorite });
        if (upd) syncFav(upd);
    });
    $id('v_insert').addEventListener('click', async () => { const r = cur(); if (!r) return; closeGallery(); await deliverRoleplayImage(fullOf(r), r.description); });
    $id('v_show').addEventListener('click', async () => { const r = cur(); if (!r) return; closeGallery(); await showImageToCharacter(fullOf(r), r.description); });
    $id('v_save').addEventListener('click', async () => {
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
    $id('v_redo').addEventListener('click', () => { const r = cur(); if (r) rerollRecord(r); });
    $id('v_del').addEventListener('click', async () => {
        const r = cur(); if (!r) return;
        if (!confirm('Delete this image from the gallery?')) return;
        await removeRecords([r.id]);
        V.list = V.list.filter(x => x.id !== r.id);
        if (!V.list.length) { closeViewer(); return; }
        V.idx = Math.min(V.idx, V.list.length - 1);
        show();
    });
}