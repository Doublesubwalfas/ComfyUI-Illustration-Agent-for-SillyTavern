export const getCtx = () => SillyTavern.getContext();

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function truncate(text, max) {
    if (!text) return '';
    return text.length > max ? text.slice(0, max) + '…' : text;
}

// Cheap, stable content signature (djb2) used to avoid re-evaluating the same text.
export function hashString(str) {
    const s = String(str ?? '');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + ':' + s.length;
}

// Join prompt fragments with ", " ignoring empties and stray commas.
export function joinTags(...parts) {
    return parts
        .map(p => String(p ?? '').trim().replace(/^[,\s]+|[,\s]+$/g, ''))
        .filter(Boolean)
        .join(', ');
}

// SillyTavern's upload endpoints return paths like "user/images/x.png" (no leading slash).
export function normalizeUrl(p) {
    if (!p) return p;
    const s = String(p);
    if (/^(https?:|data:|blob:|\/)/i.test(s)) return s;
    return '/' + s.replace(/^\.?\/+/, '');
}

// Identity of an image URL that survives host changes (phone vs PC access).
// Server-stored images: pathname. Legacy ComfyUI /view?... links: the full URL.
export function urlKey(url) {
    if (!url) return '';
    const u = String(url);
    if (u.includes('?') || /^(data:|blob:)/i.test(u)) return u;
    try { return decodeURIComponent(new URL(u, 'http://x.invalid').pathname); }
    catch { return u; }
}

export function withTimeout(promise, ms, label = 'Request') {
    let t;
    const timeout = new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

export function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = () => reject(fr.error || new Error('Could not read blob'));
        fr.readAsDataURL(blob);
    });
}

// Make text safe to embed in a slash command (| splits commands, {{ }} are macros).
export function slashSafe(text) {
    return String(text ?? '').replace(/\|/g, '/').replace(/\{\{/g, '{ {').replace(/\r?\n/g, ' ');
}
