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

// GGUF MultiGPU / UNETLoader Workflow (Alternative)
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

export const DEFAULT_PROMPTS = {
    promptMode1:
`You are an expert visual director deciding whether the latest roleplay turn warrants an illustration.
Respond ONLY with one JSON object, no commentary:
${JSON_SHAPE}

Rules:
- decision is "yes" ONLY when the turn contains an explicit visual beat: a photo/selfie, a deliberate pose, an outfit change, an intimate moment, a striking physical action, or a dramatic scene shift.
- Pure dialogue, contemplation, or minor gestures = "no" (leave "prompt" empty).
- "prompt": comma-separated booru tags matching the character and current scene:
  * Subject count: e.g. "1girl, solo" or "1boy, solo" (or "1girl, 1boy, couple" if interacting with user).
  * Character appearance: explicitly include exact hair color, hair style/length, eye color, body type, and facial expression matching the Character Reference.
  * Current Outfit: the clothing actually worn in the current scene (honor any outfit changes described in the response; otherwise use the Character Reference outfit).
  * Scene & Action: current pose, action, environment/setting, lighting (e.g. cinematic lighting, soft rim light), and camera framing (e.g. close-up, medium shot, wide shot, Dutch angle).
  * Focus strictly on the single climactic visual moment/frame of the latest response, not a summary of past events.
- "description": 1-2 sentence grounded scene description of the depicted moment.
- "negativePrompt": extra tags to avoid, or "" if none.
- "aspectRatio": portrait for characters/selfies, landscape for scenery/groups, square otherwise.`,

    promptMode2:
`You are a tag compiler. A visual description extracted from the roleplay response is provided below.
Convert it into detailed, high-quality comma-separated booru tags.
Respond ONLY with one JSON object, no commentary:
${JSON_SHAPE.replace('"yes"|"no"', '"yes"')}

Rules:
- Always set decision to "yes".
- "prompt": comprehensive booru tags translating the extracted description:
  * Subject count: e.g. "1girl, solo" or "1boy, solo" or "1girl, 1boy".
  * Character appearance: faithfully include exact hair color, hair style/length, eye color, body type matching the Character Reference.
  * Scene & Outfit: exact clothing, pose, action, expression, environment, lighting, and camera angle matching the extracted description and scene.
- "description": 1-2 sentence caption summarizing the image.
- "negativePrompt": extra tags to avoid, or "" if none.
- "aspectRatio": portrait for people/selfies, landscape for scenery/groups, square otherwise.`,

    promptMode3:
`You are a visual director. Produce an illustration prompt for the most visually compelling beat in the recent context.
Respond ONLY with one JSON object, no commentary:
${JSON_SHAPE.replace('"yes"|"no"', '"yes"')}

Rules:
- Always set decision to "yes".
- "prompt": highly detailed comma-separated booru tags matching the character and scene:
  * Subject count: e.g. "1girl, solo" or "1boy, solo" or "1girl, 1boy".
  * Character appearance: explicitly include hair color, eye color, hairstyle, body type matching the Character Reference.
  * Current Outfit: clothing matching the current scene (or Character Reference if unchanged).
  * Scene & Action: pose, expression, environment/setting, lighting, camera angle.
- "description": 1-2 sentence visual description of the depicted moment.
- "negativePrompt": extra tags to avoid, or "" if none.
- "aspectRatio": portrait for characters/selfies, landscape for scenery/groups, square otherwise.`
};

export const DEFAULT_MODE2_INJECTION =
    '[Illustration Agent: only when a genuinely visual moment happens (a photo or selfie, a pose, an outfit change, a striking action, or a new location), end your reply with ONE tag: <image>concise visual description: subject, pose, outfit, expression, setting, lighting</image>. Never mention the tag in the narration. If nothing visual happens, omit it.]';

// ---------------------------------------------------------------------------
// The agent's system prompt and user-prompt template are editable settings.
// The user-prompt template supports {{placeholders}} that get filled in at
// runtime by agent.js's fillTemplate()/buildPrompt().
// ---------------------------------------------------------------------------
export const DEFAULT_AGENT_SYSTEM_PROMPT =
`You are an expert anime and visual director producing precise image-generation prompts for diffusion models.

CHARACTER FIDELITY IS THE HIGHEST PRIORITY.
- Multiple characters may be present. Only depict the characters who are EXPLICITLY in the scene (named, speaking, acting, or directly described as physically present).
- For each depicted character, preserve their visual traits VERBATIM: hair color, hair style and length, eye color, skin tone, body type, bust/hips, height, distinguishing marks (scars, tattoos, glasses, heterochromia), and default accessories. Never swap or paraphrase traits across characters.
- If a character has a [VISUAL APPEARANCE] block, treat it as the single source of truth and copy its wording into the prompt.
- If a visual trait is missing there but present in [DESCRIPTION] or [VISUAL TAGS], infer from that. Only fall back to generic conventions if a trait is genuinely absent.
- Accurately capture the current scene: pose, expression, current clothing/attire, environment, lighting, camera angle. If the scene describes an outfit change, depict that; otherwise use the character's default outfit.
- When multiple characters are in frame, describe them with distinct tags (e.g. "1girl, 1boy" plus separate hair/eye tags) so traits don't bleed between them.
- If only one character is on screen, do NOT add others merely because they exist elsewhere in the story.
Respond ONLY with the requested JSON object.`;

export const DEFAULT_USER_PROMPT_TEMPLATE =
`{{schema}}

[SCENE CHARACTERS — only depict those actually present]
{{characters}}

FIDELITY RULES (mandatory):
- The scene description below determines WHO is on screen. Include a character only if they are named, speaking, acting, or directly described as physically present.
- For every character you include, copy their hair color, eye color, hair length/style, body type, skin tone and distinguishing marks from their [VISUAL APPEARANCE] block word-for-word.
- If a trait is missing from [VISUAL APPEARANCE], check [DESCRIPTION] and [VISUAL TAGS] before falling back to generic conventions.
- Never blend traits between characters (do not give one character another's hair color, eye color, outfit, etc.).
- Match the current outfit, pose, expression, action, environment, lighting and camera angle from the scene below.

[USER REFERENCE]
{{userReference}}

[RECENT CONTEXT (for continuity)]
{{recentContext}}
{{tagBlock}}
[CURRENT ASSISTANT RESPONSE TO ILLUSTRATE]
Speaker: {{speaker}}
Response:
{{response}}`;

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

    stylePrefix: 'masterpiece, best quality, aesthetic, highly detailed',
    defaultNegative: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality',
    agentSystemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
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
    if ((s.version || 3) < 4) {
        for (const k of ['promptMode1', 'promptMode2', 'promptMode3']) {
            if (!s[k] || s[k].includes('Scene: pose, camera angle') || s[k].includes('You MUST incorporate the character\'s exact physical traits')) {
                s[k] = DEFAULT_PROMPTS[k];
            }
        }
    }
    s.version = 4;
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