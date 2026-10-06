import { escapeHtml } from './util.js';
import { getRoot, app, $id, icon } from './shadow.js';

let reviewResolve = null;
let pickResolve = null;

export function initDialogs() {
    if ($id('ia_review')) return;
    getRoot();
    app().insertAdjacentHTML('beforeend', `
    <div id="ia_review" class="dlg-overlay" hidden>
        <div class="dlg surface" role="dialog" aria-modal="true">
            <div class="dlg-head"><span>${icon('sparkle')} Review illustration</span>
                <button type="button" id="rv_x" class="btn icon" aria-label="Close">${icon('x')}</button></div>
            <div class="dlg-body">
                <label class="f"><span>Caption</span><textarea id="rv_desc" rows="2"></textarea></label>
                <label class="f"><span>Positive prompt</span><textarea id="rv_pos" rows="4"></textarea></label>
                <label class="f"><span>Negative prompt</span><textarea id="rv_neg" rows="3"></textarea></label>
                <label class="f"><span>Aspect ratio</span>
                    <select id="rv_ar"><option value="portrait">Portrait</option><option value="landscape">Landscape</option><option value="square">Square</option></select></label>
            </div>
            <div class="dlg-foot">
                <button type="button" id="rv_cancel" class="btn">Skip</button>
                <button type="button" id="rv_ok" class="btn primary">${icon('sparkle')} Generate</button>
            </div>
        </div>
    </div>
    <div id="ia_picker" class="dlg-overlay" hidden>
        <div class="dlg wide surface" role="dialog" aria-modal="true">
            <div class="dlg-head"><span>${icon('image')} Choose the image to attach</span>
                <button type="button" id="pk_x" class="btn icon" aria-label="Close">${icon('x')}</button></div>
            <div class="dlg-body"><div id="pk_grid" class="pick"></div>
                <span class="muted">All variations are already saved in the Gallery.</span></div>
        </div>
    </div>`);

    const finishReview = (val) => { $id('ia_review').hidden = true; const r = reviewResolve; reviewResolve = null; r?.(val); };
    $id('rv_ok').addEventListener('click', () => finishReview({
        description: $id('rv_desc').value, positive: $id('rv_pos').value, negative: $id('rv_neg').value, aspect: $id('rv_ar').value
    }));
    $id('rv_cancel').addEventListener('click', () => finishReview(null));
    $id('rv_x').addEventListener('click', () => finishReview(null));

    const finishPick = (val) => { $id('ia_picker').hidden = true; const r = pickResolve; pickResolve = null; r?.(val); };
    $id('pk_x').addEventListener('click', () => finishPick(null));
    $id('pk_grid').addEventListener('click', (e) => { const el = e.target.closest('[data-i]'); if (el) finishPick(Number(el.dataset.i)); });
}

export function reviewPrompt({ description, positive, negative, aspect }) {
    reviewResolve?.(null);
    $id('rv_desc').value = description || '';
    $id('rv_pos').value = positive || '';
    $id('rv_neg').value = negative || '';
    $id('rv_ar').value = aspect || 'portrait';
    $id('ia_review').hidden = false;
    return new Promise(res => { reviewResolve = res; });
}

export function pickCandidate(results) {
    pickResolve?.(null);
    $id('pk_grid').innerHTML = results.map((r, i) => `
        <button type="button" data-i="${i}"><img src="${escapeHtml(r.thumb || r.url)}" loading="lazy" alt="Variation ${i + 1}"><span>Variation ${i + 1}</span></button>`).join('');
    $id('ia_picker').hidden = false;
    return new Promise(res => { pickResolve = res; });
}
