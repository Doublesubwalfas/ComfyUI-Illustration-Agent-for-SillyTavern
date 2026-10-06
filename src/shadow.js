import { CSS, SPRITE } from './ui-css.js';
import { getSettings } from './config.js';

let host = null;
let root = null;

// One isolated Shadow DOM hosts the bubble, gallery, viewer and dialogs.
export function getRoot() {
    if (root) return root;
    host = document.createElement('div');
    host.id = 'ia_ui_host';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>${SPRITE}<div id="ia_app"></div>`;
    document.body.appendChild(host);
    applyUiPrefs();
    return root;
}

export const $id = (id) => getRoot().getElementById(id);
export const app = () => getRoot().getElementById('ia_app');
export const hostEl = () => { getRoot(); return host; };

export function icon(name, cls = '') {
    return `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// User-tunable size and column count (so the layout can be adjusted without touching code).
export function applyUiPrefs() {
    if (!host) return;
    const s = getSettings();
    const scale = Math.min(1.6, Math.max(0.8, (Number(s.uiScale) || 100) / 100));
    host.style.setProperty('--s', String(scale));
    const cols = String(s.galleryColumns || 'auto');
    if (cols === 'auto') host.style.removeProperty('--cols');
    else host.style.setProperty('--cols', `repeat(${parseInt(cols, 10) || 2}, minmax(0, 1fr))`);
}
