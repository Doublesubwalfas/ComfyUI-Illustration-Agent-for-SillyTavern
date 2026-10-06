import { getSettings, saveGalleryRecord } from './config.js';

export function getEffectiveComfyUrl() {
    const s = getSettings();
    let url = (s.comfyUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
    if (!s.comfyRewriteHost) return url;   // opt-in only

    try {
        const parsed = new URL(url);
        const isLocal = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
        const pageLocal = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
        if (isLocal && !pageLocal) {
            parsed.hostname = window.location.hostname;
            return parsed.origin;
        }
    } catch (e) {
        console.warn('[Illustration Agent] URL parsing error', e);
    }
    return url;
}

async function uploadToSillyTavernServer(imgBlob, filename) {
    try {
        const formData = new FormData();
        formData.append('file', imgBlob, filename);
        const resp = await fetch('/api/files/upload', { method: 'POST', body: formData });
        if (resp.ok) {
            const data = await resp.json();
            if (data && data.path) return data.path;
        }
    } catch (e) {
        console.warn('[Illustration Agent] /api/files/upload failed', e);
    }
    return null;
}

// Macro substitution at leaf values only (never inside key names or JSON syntax).
// Numeric macros are injected as REAL JSON numbers (not quoted strings) so
// ComfyUI's server-side type validation accepts them.
function substituteWorkflow(rawText, params) {
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch (e) {
        throw new Error('Workflow is not valid JSON: ' + e.message);
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Workflow must be a JSON object.');
    }

    const subs = {
        '%prompt%': String(params.positive ?? ''),
        '%positive%': String(params.positive ?? ''),
        '%negative_prompt%': String(params.negative ?? ''),
        '%negative%': String(params.negative ?? ''),
        '%sampler%': String(params.sampler ?? ''),
        '%scheduler%': String(params.scheduler ?? ''),
        '%model%': String(params.model ?? ''),
        '%clip%': String(params.clip ?? ''),
        '%vae%': String(params.vae ?? ''),
        '%seed%': Number(params.seed),
        '%steps%': Number(params.steps),
        '%cfg%': Number(params.cfg),
        '%denoise%': Number(params.denoise),
        '%width%': Number(params.width),
        '%height%': Number(params.height)
    };

    function walk(node) {
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object') {
            const out = {};
            for (const k in node) out[k] = walk(node[k]);
            return out;
        }
        if (typeof node === 'string') {
            // Exact macro leaf: preserve the native type (number stays number).
            if (Object.prototype.hasOwnProperty.call(subs, node)) return subs[node];
            // Embedded macro inside a larger string: stringify the value.
            let result = node;
            for (const macro in subs) {
                if (result.includes(macro)) result = result.split(macro).join(String(subs[macro]));
            }
            return result;
        }
        return node;
    }

    const workflow = walk(parsed);

    const hasSampler = Object.values(workflow).some(
        n => n && (n.class_type === 'KSampler' || n.class_type === 'KSamplerAdvanced')
    );
    if (!hasSampler) {
        console.warn('[Illustration Agent] Workflow has no KSampler node — generation may fail.');
    }
    return workflow;
}

export async function pollComfyResult(comfyUrl, promptId, maxAttempts = 75, signal = null) {
    for (let i = 0; i < maxAttempts; i++) {
        if (signal?.aborted) throw new Error('Cancelled');

        await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 1500);
            if (signal) {
                signal.addEventListener('abort', () => {
                    clearTimeout(t);
                    reject(new Error('Cancelled'));
                }, { once: true });
            }
        });

        try {
            const resp = await fetch(`${comfyUrl}/history/${promptId}`, { signal });
            if (!resp.ok) continue;
            const history = await resp.json();
            if (history && history[promptId] && history[promptId].outputs) {
                const outputs = history[promptId].outputs;
                for (const nodeId in outputs) {
                    if (outputs[nodeId].images && outputs[nodeId].images.length > 0) {
                        const imgInfo = outputs[nodeId].images[0];
                        return `${comfyUrl}/view?filename=${encodeURIComponent(imgInfo.filename)}&subfolder=${encodeURIComponent(imgInfo.subfolder || '')}&type=${encodeURIComponent(imgInfo.type || 'output')}`;
                    }
                }
            }
        } catch (e) {
            if (signal?.aborted) throw new Error('Cancelled');
            console.warn('[Illustration Agent] Polling ComfyUI history...', e);
        }
    }
    throw new Error('ComfyUI generation timed out.');
}

export async function generateComfyImage(positive, negative, width, height, metadata, signal = null) {
    const s = getSettings();
    const comfyBaseUrl = getEffectiveComfyUrl();
    const rawWorkflow = s.activeWorkflowText || '';

    if (!rawWorkflow.trim()) throw new Error('ComfyUI API Workflow JSON is empty.');

    const workflow = substituteWorkflow(rawWorkflow, {
        positive, negative,
        sampler: s.comfySampler || 'euler_ancestral',
        scheduler: s.comfyScheduler || 'normal',
        model: s.comfyModel || '',
        clip: s.comfyClip || '',
        vae: s.comfyVae || '',
        seed: Math.floor(Math.random() * 1e12),
        steps: s.comfySteps || 20,
        cfg: s.comfyCfg || 4.5,
        denoise: 1.0,
        width, height
    });

    const resp = await fetch(`${comfyBaseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
        signal
    });

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`ComfyUI HTTP ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const data = await resp.json();
    toastr.info(`ComfyUI Job Running (${data.prompt_id})...`, 'Doublesub');

    const comfyDirectUrl = await pollComfyResult(comfyBaseUrl, data.prompt_id, 75, signal);
    const imgResp = await fetch(comfyDirectUrl, { signal });
    const imgBlob = await imgResp.blob();

    const filename = `ia_img_${Date.now()}.png`;
    let finalCleanUrl = comfyDirectUrl;

    const serverPath = await uploadToSillyTavernServer(imgBlob, filename);
    if (serverPath) finalCleanUrl = serverPath;

    // NOTE: base64Backup intentionally omitted (localStorage quota).
    saveGalleryRecord({
        id: Date.now() + Math.random().toString(36).substr(2, 4),
        character: SillyTavern.getContext().characters?.[SillyTavern.getContext().characterId]?.name || 'Unknown',
        chatId: SillyTavern.getContext().chatId || 'Chat',
        date: new Date().toISOString(),
        description: metadata.description || 'Illustration of the scene',
        positive,
        negative,
        aspectRatio: `${width}x${height}`,
        type: 'illustration',
        url: finalCleanUrl,
        favorite: false
    });

    return { cleanUrl: finalCleanUrl };
}
