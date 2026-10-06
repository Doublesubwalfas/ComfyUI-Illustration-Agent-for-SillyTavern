import { getCtx, blobToBase64, normalizeUrl, sleep } from './util.js';
import { getSettings, addGalleryRecord, updateGalleryRecord, getGallery } from './config.js';
import { replaceImageUrl } from './chat.js';

const IMG_FOLDER = 'illustration-agent';

function stHeaders() {
    const ctx = getCtx();
    return typeof ctx.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
}

// Only used by the legacy "direct" transport.
export function getComfyUrl() {
    const s = getSettings();
    const url = (s.comfyUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
    if (s.comfyTransport !== 'direct' || !s.comfyRewriteHost) return url;
    try {
        const p = new URL(url);
        const local = (h) => h === '127.0.0.1' || h === 'localhost';
        if (local(p.hostname) && !local(location.hostname)) { p.hostname = location.hostname; return p.origin; }
    } catch (_) { /* keep url */ }
    return url;
}

// ---------------------------------------------------------------------------
// Workflow macros: substituted at LEAF values only. Numeric macros stay numbers.
// ---------------------------------------------------------------------------
export function substituteWorkflow(rawText, params) {
    let parsed;
    try { parsed = JSON.parse(rawText); }
    catch (e) { throw new Error('Workflow is not valid JSON: ' + e.message); }
    if (!parsed || typeof parsed !== 'object') throw new Error('Workflow must be a JSON object.');

    const subs = {
        '%prompt%': String(params.positive ?? ''), '%positive%': String(params.positive ?? ''),
        '%negative_prompt%': String(params.negative ?? ''), '%negative%': String(params.negative ?? ''),
        '%sampler%': String(params.sampler ?? ''), '%scheduler%': String(params.scheduler ?? ''),
        '%model%': String(params.model ?? ''), '%clip%': String(params.clip ?? ''), '%vae%': String(params.vae ?? ''),
        '%seed%': Number(params.seed), '%steps%': Number(params.steps), '%cfg%': Number(params.cfg),
        '%denoise%': Number(params.denoise), '%width%': Number(params.width), '%height%': Number(params.height)
    };

    const walk = (node) => {
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object') {
            const out = {};
            for (const k in node) out[k] = walk(node[k]);
            return out;
        }
        if (typeof node === 'string') {
            if (Object.prototype.hasOwnProperty.call(subs, node)) return subs[node];
            let r = node;
            for (const m in subs) if (r.includes(m)) r = r.split(m).join(String(subs[m]));
            return r;
        }
        return node;
    };
    return walk(parsed);
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------
function makeAbort(signal, timeoutMs) {
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
    signal?.addEventListener('abort', () => ctl.abort(), { once: true });
    return { signal: ctl.signal, done: () => clearTimeout(timer), timedOut: () => timedOut };
}

// Browser -> SillyTavern server -> ComfyUI. The ComfyUI address is resolved on the
// SERVER, so it works from phones, tablets and over HTTPS tunnels.
async function generateViaServer(workflow, signal) {
    const s = getSettings();
    const ms = (s.comfyTimeoutSec || 300) * 1000;
    const ab = makeAbort(signal, ms);
    try {
        const resp = await fetch('/api/sd/comfy/generate', {
            method: 'POST',
            headers: stHeaders(),
            body: JSON.stringify({
                url: (s.comfyUrl || 'http://127.0.0.1:8188').replace(/\/+$/, ''),
                prompt: JSON.stringify({ prompt: workflow })
            }),
            signal: ab.signal
        });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            throw new Error(`ComfyUI (via SillyTavern) failed, HTTP ${resp.status}: ${txt.slice(0, 300) || 'is ComfyUI running and is the URL correct for the SillyTavern host?'}`);
        }
        const data = await resp.json();
        if (!data?.data) throw new Error('ComfyUI returned no image data.');
        return { b64: data.data, format: String(data.format || 'png').toLowerCase() };
    } catch (e) {
        if (ab.timedOut()) throw new Error(`ComfyUI timed out after ${s.comfyTimeoutSec || 300}s`);
        throw e;
    } finally { ab.done(); }
}

// Legacy: browser talks to ComfyUI itself (needs CORS + a reachable address).
async function generateDirect(workflow, signal) {
    const s = getSettings();
    const base = getComfyUrl();
    const resp = await fetch(`${base}/prompt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }), signal
    });
    if (!resp.ok) throw new Error(`ComfyUI HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const { prompt_id: id } = await resp.json();

    const deadline = Date.now() + (s.comfyTimeoutSec || 300) * 1000;
    while (Date.now() < deadline) {
        if (signal?.aborted) throw new Error('Cancelled');
        await sleep(1200);
        try {
            const h = await fetch(`${base}/history/${id}`, { signal });
            if (!h.ok) continue;
            const item = (await h.json())[id];
            if (item?.status?.status_str === 'error') throw new Error('ComfyUI reported an execution error.');
            const outs = item?.outputs && Object.values(item.outputs).flatMap(o => o.images || []);
            if (outs?.length) {
                const i = outs[0];
                const q = `filename=${encodeURIComponent(i.filename)}&subfolder=${encodeURIComponent(i.subfolder || '')}&type=${encodeURIComponent(i.type || 'output')}`;
                const img = await fetch(`${base}/view?${q}`, { signal });
                const blob = await img.blob();
                return { b64: await blobToBase64(blob), format: (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg') };
            }
        } catch (e) {
            if (signal?.aborted) throw new Error('Cancelled');
            if (/execution error/.test(e.message)) throw e;
        }
    }
    throw new Error('ComfyUI generation timed out.');
}

export async function pingComfy() {
    const s = getSettings();
    const url = (s.comfyUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
    if (s.comfyTransport === 'direct') {
        const r = await fetch(`${getComfyUrl()}/system_stats`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return getComfyUrl();
    }
    const r = await fetch('/api/sd/comfy/ping', { method: 'POST', headers: stHeaders(), body: JSON.stringify({ url }) });
    if (!r.ok) throw new Error(`The SillyTavern server could not reach ComfyUI at ${url} (HTTP ${r.status})`);
    return url;
}

// ---------------------------------------------------------------------------
// Storage: images are saved on the SillyTavern server so every device can load them.
// ---------------------------------------------------------------------------
export async function uploadImage(b64, format, filename) {
    const resp = await fetch('/api/images/upload', {
        method: 'POST', headers: stHeaders(),
        body: JSON.stringify({ image: b64, format, ch_name: IMG_FOLDER, filename })
    });
    if (!resp.ok) throw new Error(`Saving the image on the SillyTavern server failed (HTTP ${resp.status}).`);
    const data = await resp.json();
    if (!data?.path) throw new Error('SillyTavern did not return an image path.');
    return normalizeUrl(data.path);
}

async function makeThumb(b64, format) {
    try {
        const blob = await (await fetch(`data:image/${format === 'jpg' ? 'jpeg' : format};base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const sc = Math.min(1, 384 / Math.max(bmp.width, bmp.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bmp.width * sc));
        canvas.height = Math.max(1, Math.round(bmp.height * sc));
        canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
        bmp.close?.();
        const out = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
        return out ? await blobToBase64(out) : null;
    } catch (_) { return null; }
}

async function storeWithThumb(b64, format, stamp) {
    const fmt = format === 'jpeg' ? 'jpg' : format;
    const url = await uploadImage(b64, fmt, `ia_${stamp}`);
    let thumb = null;
    if (getSettings().thumbnails) {
        const t = await makeThumb(b64, fmt);
        if (t) thumb = await uploadImage(t, 'jpg', `ia_${stamp}_t`).catch(() => null);
    }
    return { url, thumb };
}

export async function deleteStoredImage(url) {
    if (!url || !url.startsWith('/user/images/')) return;
    try {
        await fetch('/api/images/delete', {
            method: 'POST', headers: stHeaders(), body: JSON.stringify({ path: url.replace(/^\//, '') })
        });
    } catch (_) { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Public: generate one image, store it, and record it in the Gallery.
// ---------------------------------------------------------------------------
export async function generateImage({ positive, negative, width, height, description, character, signal = null }) {
    const s = getSettings();
    const raw = s.activeWorkflowText || '';
    if (!raw.trim()) throw new Error('The ComfyUI workflow JSON is empty.');

    const workflow = substituteWorkflow(raw, {
        positive, negative, width, height,
        sampler: s.comfySampler || 'euler_ancestral', scheduler: s.comfyScheduler || 'normal',
        model: s.comfyModel || '', clip: s.comfyClip || '', vae: s.comfyVae || '',
        seed: Math.floor(Math.random() * 1e12), steps: s.comfySteps || 20, cfg: s.comfyCfg || 4.5, denoise: 1.0
    });

    const { b64, format } = s.comfyTransport === 'direct'
        ? await generateDirect(workflow, signal)
        : await generateViaServer(workflow, signal);

    const stamp = Date.now();
    const { url, thumb } = await storeWithThumb(b64, format, stamp);
    const ctx = getCtx();
    addGalleryRecord({
        id: `${stamp}${Math.random().toString(36).slice(2, 6)}`,
        character: character || ctx.characters?.[ctx.characterId]?.name || 'Unknown',
        chatId: ctx.chatId || 'Chat',
        date: new Date().toISOString(),
        description: description || 'Illustration of the scene',
        positive, negative,
        aspectRatio: `${width}x${height}`,
        type: 'illustration', url, thumb, favorite: false
    });
    return { url, thumb };
}

// Record an image produced by SillyTavern's own /sd command.
export function recordExternalImage({ url, positive, description, character }) {
    const ctx = getCtx();
    addGalleryRecord({
        id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        character: character || ctx.characters?.[ctx.characterId]?.name || 'Unknown',
        chatId: ctx.chatId || 'Chat', date: new Date().toISOString(),
        description: description || 'Illustration of the scene',
        positive, negative: '', aspectRatio: 'sd-command', type: 'illustration', url, thumb: null, favorite: false
    });
}

// ---------------------------------------------------------------------------
// One-time repair for images made by v2.x: they were saved as http://127.0.0.1:8188/view?...
// links that only work on the PC running ComfyUI. Run this ON THAT PC while ComfyUI is up.
// ---------------------------------------------------------------------------
export async function migrateLegacyImages(onProgress = () => {}) {
    const legacy = getGallery().filter(r => /^https?:\/\//i.test(r.url || '') && /\/view\?/.test(r.url));
    let ok = 0, fail = 0;
    for (const [n, r] of legacy.entries()) {
        onProgress(n + 1, legacy.length);
        try {
            const resp = await fetch(r.url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const fmt = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
            const { url, thumb } = await storeWithThumb(await blobToBase64(blob), fmt, `mig_${Date.now()}_${n}`);
            const old = r.url;
            updateGalleryRecord(r.id, { url, thumb, legacyUrl: old });
            replaceImageUrl([old], url);
            ok++;
        } catch (_) { fail++; }
    }
    return { total: legacy.length, ok, fail };
}
