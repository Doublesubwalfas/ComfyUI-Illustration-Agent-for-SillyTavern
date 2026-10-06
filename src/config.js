const SETTINGS_KEY = 'illustration_agent_settings';

const DEFAULT_COMFY_WORKFLOW = { /* ...unchanged... */ };

const DEFAULT_PROMPT_MODE1 = `...`; // unchanged
const DEFAULT_PROMPT_MODE2 = `...`; // unchanged
const DEFAULT_PROMPT_MODE3 = `...`; // unchanged

const defaultSettings = {
    enabled: true,
    agentMode: 'mode1',
    deliveryMode: 'attached',
    imageBackend: 'comfyui_direct',
    triggerInterval: 3,
    lookback: 3,
    includeThinking: false,
    batchCount: 1,
    interactiveReview: false,
    pipelinePhase: 'post',

    resPortraitW: 832,
    resPortraitH: 1216,
    resLandscapeW: 1216,
    resLandscapeH: 832,
    resSquareW: 1024,
    resSquareH: 1024,

    comfyUrl: 'http://127.0.0.1:8188',
    comfyRewriteHost: false, // NEW: opt-in host rewrite
    comfyModel: 'anima-turbo-v1.1.safetensors',
    comfyClip: 'Qwen3-0.6B-heretic-abliterated-uncensored.i1-Q6_K.gguf',
    comfyVae: 'qwen_image_vae.safetensors',
    comfySteps: 20,
    comfyCfg: 4.5,
    comfySampler: 'euler_ancestral',
    comfyScheduler: 'normal',

    selectedWorkflowPreset: 'Default KSampler',
    workflowPresets: { 'Default KSampler': JSON.stringify(DEFAULT_COMFY_WORKFLOW, null, 2) },
    activeWorkflowText: JSON.stringify(DEFAULT_COMFY_WORKFLOW, null, 2),

    stylePrefix: 'masterpiece, best quality, aesthetic, highly detailed',
    defaultNegative: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality',

    promptMode1: DEFAULT_PROMPT_MODE1,
    promptMode2: DEFAULT_PROMPT_MODE2,
    promptMode3: DEFAULT_PROMPT_MODE3,
    mode2InjectionText: '[Instruction: When a pivotal visual beat or action happens, include an <image>description</image> tag summarizing the visual scene.]',

    llmProvider: 'current',
    customLlmUrl: 'https://api.openai.com/v1',
    customLlmKey: '',
    customLlmModel: 'gpt-4o-mini',

    gallery: []
};

let currentSettings = null;

export function getSettings() {
    if (!currentSettings) {
        try {
            const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
            const stored = context?.extensionSettings?.[SETTINGS_KEY] || {};
            currentSettings = Object.assign({}, defaultSettings, stored);
            if (!Array.isArray(currentSettings.gallery)) currentSettings.gallery = [];
            if (!currentSettings.imageBackend) currentSettings.imageBackend = 'comfyui_direct';
        } catch (e) {
            console.warn('[Illustration Agent] Failed to parse stored settings, using defaults.', e);
            currentSettings = Object.assign({}, defaultSettings);
        }
    }
    return currentSettings;
}

export function saveSettings() {
    if (!currentSettings) return;
    try {
        const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        if (context && context.extensionSettings) {
            context.extensionSettings[SETTINGS_KEY] = currentSettings;
            if (typeof context.saveSettingsDebounced === 'function') {
                context.saveSettingsDebounced();
            }
        }
        // NOTE: no localStorage mirror. extensionSettings is authoritative.
    } catch (e) {
        console.error('[Illustration Agent] Error saving settings', e);
    }
}

export function getGalleryDb() {
    return getSettings().gallery || [];
}

export function getGalleryUrlsSet() {
    const set = new Set();
    for (const r of getGalleryDb()) {
        if (r.url) set.add(r.url);
        if (r.cleanUrl) set.add(r.cleanUrl);
    }
    return set;
}

export function saveGalleryRecord(record) {
    const s = getSettings();
    if (!Array.isArray(s.gallery)) s.gallery = [];
    // Guard against accidentally storing huge base64 payloads.
    delete record.base64Backup;
    s.gallery.unshift(record);
    saveSettings();

    const count = s.gallery.length;
    $('#ia_gallery_bubble_badge').text(count > 99 ? '99+' : count);
}

export function deleteGalleryRecords(ids) {
    const s = getSettings();
    if (!Array.isArray(s.gallery)) return;
    const set = new Set(ids);
    s.gallery = s.gallery.filter(item => !set.has(item.id));
    saveSettings();

    const count = s.gallery.length;
    $('#ia_gallery_bubble_badge').text(count > 99 ? '99+' : count);
}