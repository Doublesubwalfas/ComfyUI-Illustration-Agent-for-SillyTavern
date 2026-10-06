import { getCtx, urlKey } from './util.js';
import { emit } from './bus.js';

const SETTINGS_KEY = 'illustration_agent_settings';

// ---------------------------------------------------------------------------
// Default ComfyUI API workflow. Macros (%prompt%, %seed%, ...) are substituted
// at leaf values only; numeric macros become real JSON numbers.
// ---------------------------------------------------------------------------
export const DEFAULT_WORKFLOW = {
    "3": { class_type: "KSampler", inputs: {
        seed: "%seed%", steps: "%steps%", cfg: "%cfg%", sampler_name: "%sampler%",
        scheduler: "%scheduler%", denoise: "%denoise%",
        model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
    "4": { class_type: "UNETLoader", inputs: { unet_name: "%model%", weight_dtype: "default" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: "%width%", height: "%height%", batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "%prompt%", clip: ["10", 0] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "%negative_prompt%", clip: ["10", 0] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["11", 0] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "ia_agent", images: ["8", 0] } },
    "10": { class_type: "CLIPLoader", inputs: { clip_name: "%clip%", type: "stable_diffusion" } },
    "11": { class_type: "VAELoader", inputs: { vae_name: "%vae%" } }
};

const JSON_SHAPE = '{"decision":"yes"|"no","description":"...","prompt":"...","negativePrompt":"...","aspectRatio":"portrait"|"landscape"|"square"}';

export const DEFAULT_PROMPTS = {
    promptMode1:
`You are a strict visual director deciding whether the latest roleplay turn warrants a generated illustration.
Respond ONLY with one JSON object, no commentary:
${JSON_SHAPE}

Rules:
- decision is "yes" ONLY when the turn contains an explicit visual beat: a photo/selfie being taken or shown, a deliberate pose, a change of clothing or state of dress, a striking physical action, or a major location/scenery change.
- Pure dialogue, internal thoughts, or minor gestures = "no" (leave "prompt" empty). When in doubt, answer "no".
- "prompt": comma-separated booru-style tags describing the scene. Always include the character's consistent physical traits (hair, eyes, body, outfit) taken from the Character Reference, plus expression, pose, setting, lighting, and camera angle. No narrative sentences.
- "description": one short sentence describing the image, used as the roleplay caption.
- "negativePrompt": extra tags to avoid, or "" if none.
- "aspectRatio": portrait for people/selfies, landscape for scenery/groups, square otherwise.`,

    promptMode2:
`You are a tag compiler. A visual description extracted from the assistant's roleplay response is provided below.
Convert it faithfully into comma-separated booru-style image tags, preserving every visual detail, and merge in the character's consistent physical traits from the Character Reference.
Respond ONLY with one JSON object, no commentary:
${JSON_SHAPE.replace('"yes"|"no"', '"yes"')}

Rules:
- Always set decision to "yes". Never refuse, never ask questions.
- "prompt": the compiled tag string. No narrative sentences.
- "description": one short sentence describing the image, used as the roleplay caption.
- "negativePrompt": extra tags to avoid, or "" if none.
- "aspectRatio": portrait for people/selfies, landscape for scenery/groups, square otherwise.`,

    promptMode3:
`You are a visual director. On every invocation, produce an illustration prompt for the single most visually interesting beat in the recent context.
Respond ONLY with one JSON object, no commentary:
${JSON_SHAPE.replace('"yes"|"no"', '"yes"')}

Rules:
- Always set decision to "yes".
- "prompt": comma-separated booru-style tags including the character's consistent physical traits from the Character Reference, plus expression, pose, setting, lighting, and camera angle. No narrative sentences.
- "description": one short sentence describing the image, used as the roleplay caption.
- "negativePrompt": extra tags to avoid, or "" if none.
- "aspectRatio": portrait for people/selfies, landscape for scenery/groups, square otherwise.`
};

export const DEFAULT_MODE2_INJECTION =
    '[Illustration Agent: only when a genuinely visual moment happens (a photo or selfie, a pose, an outfit change, a striking action, or a new location), end your reply with ONE tag: <image>concise visual description: subject, pose, outfit, expression, setting, lighting</image>. Never mention the tag in the narration. If nothing visual happens, omit it.]';

const DEFAULTS = {
    version: 3,
    enabled: true,
    agentMode: 'mode1',            // mode1 autonomous | mode2 tag-triggered | mode3 interval
    deliveryMode: 'attached',      // attached | separate
    imageBackend: 'comfyui',       // comfyui | sd_command
    comfyTransport: 'server',      // server (via SillyTavern, works on mobile) | direct (browser -> ComfyUI)

    lookback: 3,
    includeThinking: false,
    batchCount: 1,
    interactiveReview: false,
    toasts: 'normal',              // normal | quiet

    // Mode 1 (sensing)
    fastGate: true,
    gateSensitivity: 2,            // 1 high | 2 medium | 4 low
    extraCues: '',
    cooldown: 2,                   // min assistant turns between automatic illustrations
    // Mode 2
    mode2Inject: true,
    mode2SkipLLM: false,
    mode2InjectionText: DEFAULT_MODE2_INJECTION,
    // Mode 3
    triggerInterval: 3,

    // Image generation
    resPortraitW: 832, resPortraitH: 1216,
    resLandscapeW: 1216, resLandscapeH: 832,
    resSquareW: 1024, resSquareH: 1024,
    comfyUrl: 'http://127.0.0.1:8188',
    comfyRewriteHost: false,
    comfyTimeoutSec: 300,
    comfyModel: 'anima-turbo-v1.1.safetensors',
    comfyClip: 'Qwen3-0.6B-heretic-abliterated-uncensored.i1-Q6_K.gguf',
    comfyVae: 'qwen_image_vae.safetensors',
    comfySteps: 20,
    comfyCfg: 4.5,
    comfySampler: 'euler_ancestral',
    comfyScheduler: 'normal',
    selectedWorkflowPreset: 'Default KSampler',
    workflowPresets: { 'Default KSampler': JSON.stringify(DEFAULT_WORKFLOW, null, 2) },
    activeWorkflowText: JSON.stringify(DEFAULT_WORKFLOW, null, 2),

    stylePrefix: 'masterpiece, best quality, aesthetic, highly detailed',
    defaultNegative: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality',
    ...DEFAULT_PROMPTS,

    // Evaluator LLM
    llmProvider: 'current',        // current | profile | custom
    connectionProfile: '',
    customLlmUrl: 'https://api.openai.com/v1',
    customLlmKey: '',
    customLlmModel: 'gpt-4o-mini',
    llmTimeoutSec: 45,

    // UI / storage
    showBubble: true,
    uiScale: 100,                  // gallery/viewer size, percent
    galleryColumns: 'auto',        // auto | 1 | 2 | 3 | 4
    lockSend: 'all',               // all | eval | off  (turn Send into Stop while the agent works)
    bubblePos: null,               // { side: 'left'|'right', y: 0..1 }
    thumbnails: true,
    deleteFilesOnRemove: false,

    gallery: []
};

let store = null;

function migrate(s) {
    if (s.imageBackend === 'comfyui_direct') s.imageBackend = 'comfyui';
    if (s.imageBackend === 'slash_imagine') s.imageBackend = 'sd_command';
    delete s.pipelinePhase;
    if (!Array.isArray(s.gallery)) s.gallery = [];
    if (!s.workflowPresets || typeof s.workflowPresets !== 'object') s.workflowPresets = {};
    if (!s.workflowPresets[s.selectedWorkflowPreset]) {
        s.selectedWorkflowPreset = Object.keys(s.workflowPresets)[0] || 'Default KSampler';
        if (!s.workflowPresets[s.selectedWorkflowPreset]) {
            s.workflowPresets[s.selectedWorkflowPreset] = JSON.stringify(DEFAULT_WORKFLOW, null, 2);
        }
    }
    s.version = 3;
}

// The settings object IS the one SillyTavern persists (no stale copies).
export function getSettings() {
    if (store) return store;
    const root = getCtx().extensionSettings;
    if (!root[SETTINGS_KEY] || typeof root[SETTINGS_KEY] !== 'object') root[SETTINGS_KEY] = {};
    store = root[SETTINGS_KEY];
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (!(k in store)) store[k] = structuredClone(v);
    }
    migrate(store);
    return store;
}

export function saveSettings() {
    try {
        const ctx = getCtx();
        if (typeof ctx.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
    } catch (e) {
        console.error('[Illustration Agent] Error saving settings', e);
    }
}

export function notify(level, message, title = 'Illustration Agent') {
    try {
        if (getSettings().toasts === 'quiet' && (level === 'info' || level === 'success')) return;
        toastr[level](message, title);
    } catch (_) { console.log(`[Illustration Agent] ${level}: ${message}`); }
}

// ---------------------------------------------------------------------------
// Gallery (records live in extension settings; image FILES live on the ST server)
// ---------------------------------------------------------------------------
let byUrl = null;     // urlKey(url)       -> record
let byLegacy = null;  // urlKey(legacyUrl) -> record (old localhost links after migration)

function buildIndex() {
    byUrl = new Map(); byLegacy = new Map();
    for (const r of getGallery()) {
        if (r.url) byUrl.set(urlKey(r.url), r);
        if (r.cleanUrl) byUrl.set(urlKey(r.cleanUrl), r);
        if (r.legacyUrl) byLegacy.set(urlKey(r.legacyUrl), r);
    }
}

function galleryChanged() {
    byUrl = null; byLegacy = null;
    saveSettings();
    emit('gallery');
}

export function getGallery() { return getSettings().gallery; }

export function lookupByUrl(url) {
    if (!byUrl) buildIndex();
    const k = urlKey(url);
    if (byUrl.has(k)) return { record: byUrl.get(k), legacy: false };
    if (byLegacy.has(k)) return { record: byLegacy.get(k), legacy: true };
    return null;
}

export function getRecordByUrl(url) { return lookupByUrl(url)?.record || null; }
export function hasGalleryImages() { return getGallery().length > 0; }

export function addGalleryRecord(record) {
    delete record.base64Backup;
    getGallery().unshift(record);
    galleryChanged();
}

export function updateGalleryRecord(id, patch) {
    const r = getGallery().find(x => String(x.id) === String(id));
    if (!r) return null;
    Object.assign(r, patch);
    galleryChanged();
    return r;
}

export function removeGalleryRecords(ids) {
    const s = getSettings();
    const set = new Set(ids.map(String));
    const removed = s.gallery.filter(r => set.has(String(r.id)));
    s.gallery = s.gallery.filter(r => !set.has(String(r.id)));
    galleryChanged();
    return removed;
}
