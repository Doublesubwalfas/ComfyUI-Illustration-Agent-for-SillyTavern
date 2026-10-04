import { getSettings, saveGalleryRecord } from './config.js';

export function getEffectiveComfyUrl() {
    const s = getSettings();
    let url = (s.comfyUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
    try {
        const parsed = new URL(url);
        if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
            window.location.hostname !== '127.0.0.1' && window.location.hostname !== 'localhost') {
            parsed.hostname = window.location.hostname;
            return parsed.origin;
        }
    } catch (e) {
        console.warn('[Illustration Agent] URL parsing error', e);
    }
    return url;
}

// Uploads the image to SillyTavern's server to produce a short permanent link: /user/images/...
async function uploadToSillyTavernServer(imgBlob, filename) {
    try {
        const formData = new FormData();
        formData.append('file', imgBlob, filename);

        const resp = await fetch('/api/files/upload', {
            method: 'POST',
            body: formData
        });

        if (resp.ok) {
            const data = await resp.json();
            if (data && data.path) return data.path;
        }
    } catch (e) {
        console.warn('[Illustration Agent] Direct /api/files/upload failed, trying fallback', e);
    }
    return null;
}

async function convertBlobToBase64(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

export async function pollComfyResult(comfyUrl, promptId, maxAttempts = 75) {
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 1500));
        try {
            const resp = await fetch(`${comfyUrl}/history/${promptId}`);
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
            console.warn('[Illustration Agent] Polling ComfyUI history...', e);
        }
    }
    throw new Error('ComfyUI generation timed out.');
}

export async function generateComfyImage(positive, negative, width, height, metadata) {
    const s = getSettings();
    const comfyBaseUrl = getEffectiveComfyUrl();

    if (!s.comfyWorkflow || !s.comfyWorkflow.trim()) {
        throw new Error('ComfyUI API Workflow JSON is empty.');
    }

    const randomSeed = Math.floor(Math.random() * 1000000000000);
    const steps = s.comfySteps || 20;
    const cfg = s.comfyCfg || 4.5;
    const sampler = s.comfySampler || 'euler_ancestral';
    const scheduler = s.comfyScheduler || 'normal';
    const denoise = 1.0;

    let rawStr = s.comfyWorkflow;
    const safePositive = JSON.stringify(positive).slice(1, -1);
    const safeNegative = JSON.stringify(negative).slice(1, -1);

    rawStr = rawStr
        .replaceAll('%prompt%', safePositive)
        .replaceAll('%positive%', safePositive)
        .replaceAll('%negative_prompt%', safeNegative)
        .replaceAll('%negative%', safeNegative)
        .replaceAll('%sampler%', sampler)
        .replaceAll('%scheduler%', scheduler)
        .replaceAll('"%seed%"', randomSeed)
        .replaceAll('%seed%', randomSeed)
        .replaceAll('"%steps%"', steps)
        .replaceAll('%steps%', steps)
        .replaceAll('"%cfg%"', cfg)
        .replaceAll('%cfg%', cfg)
        .replaceAll('"%denoise%"', denoise)
        .replaceAll('%denoise%', denoise)
        .replaceAll('"%width%"', width)
        .replaceAll('%width%', width)
        .replaceAll('"%height%"', height)
        .replaceAll('%height%', height);

    const workflow = JSON.parse(rawStr);

    const resp = await fetch(`${comfyBaseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow })
    });

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`ComfyUI HTTP ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    toastr.info(`ComfyUI Job Running (${data.prompt_id})...`, 'Marinara');

    const comfyDirectUrl = await pollComfyResult(comfyBaseUrl, data.prompt_id);

    // Fetch image blob from ComfyUI
    const imgResp = await fetch(comfyDirectUrl);
    const imgBlob = await imgResp.blob();

    // 1. Upload to SillyTavern's local storage for a clean permanent path
    const filename = `ia_${Date.now()}.png`;
    let serverPath = await uploadToSillyTavernServer(imgBlob, filename);
    const base64Url = await convertBlobToBase64(imgBlob);

    // Final clean URL: use local ST path if available, or comfyDirectUrl as fallback
    const finalCleanUrl = serverPath || comfyDirectUrl;

    saveGalleryRecord({
        id: Date.now() + Math.random().toString(36).substr(2, 4),
        character: SillyTavern.getContext().characters?.[SillyTavern.getContext().characterId]?.name || 'Unknown',
        chatId: SillyTavern.getContext().chatId || 'Chat',
        date: new Date().toISOString(),
        description: metadata.description || 'Illustration of the scene',
        positive,
        negative,
        aspectRatio: `${width}x${height}`,
        type: metadata.isBackground ? 'background' : 'illustration',
        location: metadata.location || '',
        reason: metadata.reason,
        url: finalCleanUrl,
        base64Backup: base64Url
    });

    return { cleanUrl: finalCleanUrl, base64Url };
}