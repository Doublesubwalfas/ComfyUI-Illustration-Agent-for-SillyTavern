function getComfyUrl(settings) {
    return settings.comfyUrl.replace(/\/$/, '') || 'http://127.0.0.1:8188';
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function getDimensions(aspectRatio, modelClass, isBackground) {
    if (isBackground) {
        return aspectRatio === 'portrait' ? { w: 720, h: 1280 } :
               aspectRatio === 'square' ? { w: 1024, h: 1024 } : { w: 1280, h: 720 };
    }
    if (modelClass === 'sdxl') {
        return aspectRatio === 'portrait' ? { w: 768, h: 1344 } :
               aspectRatio === 'square' ? { w: 1024, h: 1024 } : { w: 1344, h: 768 };
    }
    // SD1.5
    return aspectRatio === 'portrait' ? { w: 512, h: 768 } :
           aspectRatio === 'square' ? { w: 512, h: 512 } : { w: 768, h: 512 };
}

export async function uploadReferenceImage(fileBlob, settings) {
    const formData = new FormData();
    formData.append('image', fileBlob, `ref_${generateId()}.png`);
    formData.append('overwrite', 'true');
    try {
        const res = await fetch(`${getComfyUrl(settings)}/upload/image`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        return data.name;
    } catch (e) {
        toastr.warning('Avatar upload to ComfyUI failed; generating without references.');
        console.warn('ComfyUI upload err:', e);
        return null;
    }
}

export async function submitToComfyUI(finalPos, finalNeg, aspect, settings, isBackground, referenceNames) {
    const dims = getDimensions(aspect, settings.modelClass, isBackground);
    let wfStr = settings.workflow;
    
    if (!wfStr || !wfStr.includes('%prompt%')) {
        toastr.error('Workflow is missing %prompt% placeholder.');
        return null;
    }

    // Generate strict random seed
    const seed = Math.floor(Math.random() * 1000000000000000);

    // Substitutions (string level before JSON parse)
    wfStr = wfStr.split('"%prompt%"').join(JSON.stringify(finalPos))
                 .split('"%negative_prompt%"').join(JSON.stringify(finalNeg))
                 .replace(/%width%/g, dims.w)
                 .replace(/%height%/g, dims.h)
                 .replace(/%seed%/g, seed)
                 .replace(/%steps%/g, settings.steps || 25)
                 .replace(/%cfg%/g, settings.cfg || 7);

    // Reference placeholders
    for (let i = 0; i < 4; i++) {
        const phName = `%reference_image_name_0${i + 1}%`;
        const val = referenceNames[i] || '';
        wfStr = wfStr.replace(new RegExp(phName, 'g'), val);
    }

    let wfObj;
    try {
        wfObj = JSON.parse(wfStr);
    } catch (e) {
        toastr.error('Invalid workflow JSON after substitution.');
        return null;
    }

    // Seed Randomization Scan (fallback for non-placeholder workflows)
    for (const key in wfObj) {
        const node = wfObj[key];
        if (node.class_type && node.class_type.includes('Sampler') && node.inputs) {
            if (typeof node.inputs.seed === 'number') node.inputs.seed = seed;
            if (typeof node.inputs.noise_seed === 'number') node.inputs.noise_seed = seed;
        }
    }

    const clientId = generateId();
    const payload = { prompt: wfObj, client_id: clientId };
    const baseUrl = getComfyUrl(settings);

    try {
        const res = await fetch(`${baseUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`POST /prompt failed: ${res.status}`);
        const data = await res.json();
        const promptId = data.prompt_id;

        // Try WebSocket, fallback to polling
        let historyData = null;
        try {
            historyData = await waitForCompletionWS(baseUrl, clientId, promptId);
        } catch (e) {
            toastr.warning('WebSocket unavailable, polling…');
            historyData = await waitForCompletionPoll(baseUrl, promptId);
        }

        if (!historyData || !historyData.outputs) {
            toastr.error('Workflow completed but produced no images.');
            return null;
        }

        // Extract first image
        let targetFile = null;
        for (const nodeId in historyData.outputs) {
            const out = historyData.outputs[nodeId];
            if (out.images && out.images.length > 0) {
                targetFile = out.images[0];
                break;
            }
        }

        if (!targetFile) {
            toastr.error('No images found in ComfyUI history output.');
            return null;
        }

        // Fetch image blob
        const imgRes = await fetch(`${baseUrl}/view?filename=${encodeURIComponent(targetFile.filename)}&subfolder=${encodeURIComponent(targetFile.subfolder || '')}&type=${targetFile.type || 'output'}`);
        if (!imgRes.ok) {
            toastr.error(`Failed to fetch image: /view returned ${imgRes.status}`);
            return null;
        }
        
        return await imgRes.blob();

    } catch (e) {
        toastr.error(`ComfyUI Error: ${e.message}`);
        console.error(e);
        return null;
    }
}

function waitForCompletionWS(baseUrl, clientId, promptId) {
    return new Promise((resolve, reject) => {
        const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws?clientId=${clientId}`;
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => { ws.close(); reject(new Error('WS Timeout')); }, 3000);

        ws.onopen = () => clearTimeout(timeout);
        ws.onerror = (e) => reject(e);
        ws.onmessage = async (e) => {
            if (typeof e.data !== 'string') return;
            const msg = JSON.parse(e.data);
            if (msg.type === 'executing' && msg.data.node === null && msg.data.prompt_id === promptId) {
                ws.close();
                resolve(await fetchHistory(baseUrl, promptId));
            } else if (msg.type === 'execution_success' && msg.data.prompt_id === promptId) {
                ws.close();
                resolve(await fetchHistory(baseUrl, promptId));
            }
        };
    });
}

async function waitForCompletionPoll(baseUrl, promptId) {
    const maxTries = 200; // ~5 mins at 1.5s
    for (let i = 0; i < maxTries; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const res = await fetch(`${baseUrl}/history/${promptId}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data[promptId]) return data[promptId];
    }
    throw new Error('Polling timeout');
}

async function fetchHistory(baseUrl, promptId) {
    const res = await fetch(`${baseUrl}/history/${promptId}`);
    if (!res.ok) throw new Error('History fetch failed');
    const clen = res.headers.get('content-length');
    if (clen && parseInt(clen) > 67108864) {
        throw new Error('ComfyUI history response too large; aborting.'); // 64MiB limit
    }
    const data = await res.json();
    return data[promptId];
}

export function reviewPromptModal(pos, neg, kind, dims) {
    return new Promise((resolve) => {
        const id = 'comfy-agent-review-modal';
        $(`#${id}`).remove();
        
        const html = `
        <div id="${id}">
            <div class="modal-content">
                <h3>Review Prompt</h3>
                <div class="info-line">Kind: ${kind} | Target Dims: ${dims.w}x${dims.h}</div>
                <label>Positive Prompt:</label>
                <textarea id="cia_review_pos">${pos}</textarea>
                <div class="char-count" id="cia_pos_count"></div>
                <label>Negative Prompt:</label>
                <textarea id="cia_review_neg">${neg}</textarea>
                <div class="char-count" id="cia_neg_count"></div>
                
                <div class="modal-buttons">
                    <button id="cia_review_cancel" class="comfy-btn danger">Cancel</button>
                    <button id="cia_review_generate" class="comfy-btn">Generate</button>
                </div>
            </div>
        </div>`;
        $('body').append(html);

        const updateCounts = () => {
            $('#cia_pos_count').text($('#cia_review_pos').val().length + ' chars');
            $('#cia_neg_count').text($('#cia_review_neg').val().length + ' chars');
        };
        $('#cia_review_pos, #cia_review_neg').on('input', updateCounts);
        updateCounts();

        $('#cia_review_cancel').on('click', () => {
            $(`#${id}`).remove();
            resolve(null);
        });

        $('#cia_review_generate').on('click', () => {
            const p = $('#cia_review_pos').val();
            const n = $('#cia_review_neg').val();
            $(`#${id}`).remove();
            resolve({ positive: p, negative: n });
        });
    });
}