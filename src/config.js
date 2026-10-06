import { getCtx, urlKey } from './util.js';
import { emit } from './bus.js';

const SETTINGS_KEY = 'illustration_agent_settings';

// Standard SDXL/SD1.5 Checkpoint Workflow (Default)
export const DEFAULT_WORKFLOW = {
    "3": { class_type: "KSampler", inputs: {
        seed: "%seed%", steps: "%steps%", cfg: "%cfg%", sampler_name: "%sampler%",
        scheduler: "%scheduler%", denoise: "%denoise%",
        model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "%model%" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: "%width%", height: "%height%", batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "%prompt%", clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "%negative_prompt%", clip: ["4", 1] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "ia_agent", images: ["8", 0] } }
};

export const GGUF_WORKFLOW = {
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

// RESTORED: Marinara Engine's exact step-by-step visual grounding rules
export const DEFAULT_PROMPTS = {
    promptMode1:
`You are the autonomous Marinara Illustration Director for this roleplay novel.
Analyze the latest assistant turn (<assistant_response>) anchored to recent chat continuity.

Execute these steps strictly:

### STEP 1: DECISION (yes or no)
Set "decision" to "yes" ONLY IF the latest turn contains an explicit visual beat:
1. A direct photo/selfie action (a character takes, poses for, sends, or requests a picture).
2. A physical action, dynamic combat, intimacy, transformation, outfit change, or character reveal.
3. The narrative transitions to a noticeably different visual environment.
Otherwise, set "decision" to "no" (for static dialogue, contemplation, or minor gestures). Stop and return empty prompts.

### STEP 2: NARRATIVE GROUNDING (Crucial)
"description": Write a concise 1-2 sentence visual description in plain natural English of what is depicted.
- You MUST anchor this strictly to the Character Reference (hair color, hair style, eye color, facial expression, body type, and current outfit). Do not invent missing traits.
- For photos/selfies: "A selfie taken by [Char] smiling in [Location] wearing [Outfit]..."

### STEP 3: IMAGE GENERATION PROMPT
"prompt": Comma-separated image generation tags derived DIRECTLY from your Step 2 description.
- Order: Subject tags first (e.g. 1girl, character name, hair color, eye color, outfit details), followed by pose, expression, camera angle, and environment lighting.
- Keep character tags explicit so their appearance matches the Character Reference faithfully.
"negativePrompt": Specific tags to avoid (e.g., bad anatomy, distorted hands, blurry).
"aspectRatio": "portrait" for characters/selfies, "landscape" for wide scenes, "square" otherwise.

Respond ONLY with valid JSON in this exact schema:
${JSON_SHAPE}`,

    promptMode2:
`You are the Marinara Tag Compiler for this roleplay novel.
A visual description extracted from the roleplay response (<assistant_response>) is provided below.

Execute these steps strictly:
1. "description": Clean up the extracted description into a 1-2 sentence caption, explicitly incorporating the character's core visual traits from the Character Reference.
2. "prompt": Convert that grounded description into detailed comma-separated image tags. Start with character identity tags (gender, hair, eyes, facial features, outfit), then action/pose, then lighting and angle.
3. "negativePrompt": Tags to avoid (e.g. bad anatomy, distorted limbs).
4. "aspectRatio": "portrait" for characters/selfies, "landscape" for scenery, "square" otherwise.

Respond ONLY with valid JSON in this exact schema:
${JSON_SHAPE.replace('"yes"|"no"', '"yes"')}`,

    promptMode3:
`You are the Marinara Visual Director for this roleplay novel.
Based on the latest assistant turn (<assistant_response>), draft an immediate high-quality illustration prompt of the depicted moment.

Execute these steps strictly:
1. "description": Write a 1-2 sentence visual description of the scene, explicitly including the character's physical traits from the Character Reference.
2. "prompt": Convert the scene into detailed comma-separated tags. Lead with character appearance (hair, eyes, clothes from Character Reference), followed by pose, setting, and cinematic lighting.
3. "negativePrompt": Tags to avoid.
4. "aspectRatio": "portrait" for character/selfie, "landscape" for wide view, "square" otherwise.

Respond ONLY with valid JSON in this exact schema:
${JSON_SHAPE.replace('"yes"|"no"', '"yes"')}`
};

export const DEFAULT_MODE2_INJECTION =
    '[Illustration Agent: only when a genuinely visual moment happens (a photo or selfie, a pose, an outfit change, a striking action, or a new location), end your reply with ONE tag: <image>concise visual description: subject, pose, outfit, expression, setting, lighting</image>. Never mention the tag in the narration. If nothing visual happens, omit it.]';

const DEFAULTS = {
    version: 3,
    enabled: true,
    agentMode: 'mode1',
    deliveryMode: 'attached',
    imageBackend: 'comfyui',
    comfyTransport: 'server',

    lookback: 3,
    includeThinking: false,
    batchCount: 1,
    interactiveReview: false,
    toasts: 'normal',

    fastGate: true,
    gateSensitivity: 2,
    extraCues: '',
    cooldown: 2,
    mode2Inject: true,
    mode2SkipLLM: false,
    mode2InjectionText: DEFAULT_MODE2_INJECTION,
    triggerInterval: 3,

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
    
    selectedWorkflowPreset: 'Default Checkpoint (SDXL/SD1.5)',
    workflowPresets: { 
        'Default Checkpoint (SDXL/SD1.5)': JSON.stringify(DEFAULT_WORKFLOW, null, 2),
        'GGUF MultiGPU (UNET+CLIP+VAE)': JSON.stringify(GGUF_WORKFLOW, null, 2) 
    },
    activeWorkflowText: JSON.stringify(DEFAULT_WORKFLOW, null, 2),

    stylePrefix: 'masterpiece, best quality, cinematic lighting',
    defaultNegative: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality',
    ...DEFAULT_PROMPTS,

    llmProvider: 'current',
    connectionProfile: '',
    customLlmUrl: 'https://api.openai.com/v1',
    customLlmKey: '',
    customLlmModel: 'gpt-4o-mini',
    llmTimeoutSec: 45,

    showBubble: true,
    uiScale: 100,
    galleryColumns: 'auto',
    lockSend: 'all',
    bubblePos: null,
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
        s.selectedWorkflowPreset = Object.keys(s.workflowPresets)[0] || 'Default Checkpoint (SDXL/SD1.5)';
        if (!s.workflowPresets[s.selectedWorkflowPreset]) {
            s.workflowPresets[s.selectedWorkflowPreset] = JSON.stringify(DEFAULT_WORKFLOW, null, 2);
        }
    }
    s.version = 3;
}

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

let byUrl = null;
let byLegacy = null;

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