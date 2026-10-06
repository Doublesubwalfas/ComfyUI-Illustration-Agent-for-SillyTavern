import { escapeHtml } from './util.js';

const $id = (id) => document.getElementById(id);
let reviewResolve = null;
let pickResolve = null;

export function initDialogs() {
    if ($id('ia_review')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div id="ia_review" class="ia-overlay ia-dialog-overlay" hidden>
        <div class="ia-dialog" role="dialog" aria-modal="true">
            <div class="ia-dialog-head"><b><i class="fa-solid fa-pen-to-square"></i> Review illustration</b>
                <button type="button" class="ia-icon-btn" id="ia_rev_x" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="ia-dialog-body">
                <label class="ia-field"><span>Caption</span><textarea id="ia_rev_desc" class="text_pole" rows="2"></textarea></label>
                <label class="ia-field"><span>Positive prompt</span><textarea id="ia_rev_pos" class="text_pole" rows="4"></textarea></label>
                <label class="ia-field"><span>Negative prompt</span><textarea id="ia_rev_neg" class="text_pole" rows="3"></textarea></label>
                <label class="ia-field"><span>Aspect ratio</span>
                    <select id="ia_rev_ar" class="text_pole"><option value="portrait">Portrait</option><option value="landscape">Landscape</option><option value="square">Square</option></select></label>
            </div>
            <div class="ia-dialog-foot">
                <button type="button" class="menu_button" id="ia_rev_cancel">Skip</button>
                <button type="button" class="menu_button ia-primary" id="ia_rev_ok"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button>
            </div>
        </div>
    </div>
    <div id="ia_picker" class="ia-overlay ia-dialog-overlay" hidden>
        <div class="ia-dialog ia-dialog-wide" role="dialog" aria-modal="true">
            <div class="ia-dialog-head"><b><i class="fa-solid fa-images"></i> Choose the image to attach</b>
                <button type="button" class="ia-icon-btn" id="ia_pick_x" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="ia-dialog-body"><div id="ia_pick_grid" class="ia-pick-grid"></div>
                <small class="ia-muted">All variations are already saved in the Gallery.</small></div>
        </div>
    </div>`);

    const finishReview = (val) => { $id('ia_review').hidden = true; const r = reviewResolve; reviewResolve = null; r?.(val); };
    $id('ia_rev_ok').addEventListener('click', () => finishReview({
        description: $id('ia_rev_desc').value, positive: $id('ia_rev_pos').value,
        negative: $id('ia_rev_neg').value, aspect: $id('ia_rev_ar').value
    }));
    $id('ia_rev_cancel').addEventListener('click', () => finishReview(null));
    $id('ia_rev_x').addEventListener('click', () => finishReview(null));

    const finishPick = (val) => { $id('ia_picker').hidden = true; const r = pickResolve; pickResolve = null; r?.(val); };
    $id('ia_pick_x').addEventListener('click', () => finishPick(null));
    $id('ia_pick_grid').addEventListener('click', (e) => {
        const el = e.target.closest('[data-i]');
        if (el) finishPick(Number(el.dataset.i));
    });
}

// Resolves with the edited values, or null if skipped.
export function reviewPrompt({ description, positive, negative, aspect }) {
    reviewResolve?.(null);
    $id('ia_rev_desc').value = description || '';
    $id('ia_rev_pos').value = positive || '';
    $id('ia_rev_neg').value = negative || '';
    $id('ia_rev_ar').value = aspect || 'portrait';
    $id('ia_review').hidden = false;
    return new Promise(res => { reviewResolve = res; });
}

// Resolves with the chosen index, or null.
export function pickCandidate(results) {
    pickResolve?.(null);
    $id('ia_pick_grid').innerHTML = results.map((r, i) => `
        <button type="button" class="ia-pick-item" data-i="${i}">
            <img src="${escapeHtml(r.thumb || r.url)}" loading="lazy" alt="Variation ${i + 1}">
            <span>Variation ${i + 1}</span>
        </button>`).join('');
    $id('ia_picker').hidden = false;
    return new Promise(res => { pickResolve = res; });
}
