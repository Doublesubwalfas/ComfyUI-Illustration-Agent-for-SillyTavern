const SETTINGS_KEY = 'illustration_agent_settings';

// ---------------------------------------------------------------------------
// Default ComfyUI API workflow (UNET + CLIP + VAE split loading, KSampler).
// Macros such as %prompt% / %seed% are substituted at generation time.
// Numeric macros (%seed%, %steps%, %cfg%, %width%, ...) are injected as real
// JSON numbers, so ComfyUI type validation passes.
// ---------------------------------------------------------------------------
const DEFAULT_COMFY_WORKFLOW = {
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": "%seed%",
            "steps": "%steps%",
            "cfg": "%cfg%",
            "sampler_name": "%sampler%",
            "scheduler": "%scheduler%",
            "denoise": "%denoise%",
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0]
        }
    },
    "4": {
        "class_type": "UNETLoader",
        "inputs": {
            "unet_name": "%model%",
            "weight_dtype": "default"
        }
    },
    "5": {
        "class_type": "EmptyLatentImage",
        "inputs": {
            "width": "%width%",
            "height": "%height%",
            "batch_size": 1
        }
    },
    "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {
            "text": "%prompt%",
            "clip": ["10", 0]
        }
    },
    "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {
            "text": "%negative_prompt%",
            "clip": ["10", 0]
        }
    },
    "8": {
        "class_type": "VAEDecode",
        "inputs": {
            "samples": ["3", 0],
            "vae": ["11", 0]
        }
    },
    "9": {
        "class_type": "SaveImage",
        "inputs": {
            "filename_prefix": "ia_agent",
            "images": ["8", 0]
        }
    },
    "10": {
        "class_type": "CLIPLoader",
        "inputs": {
            "clip_name": "%clip%",
            "type": "stable_diffusion"
        }
    },
    "11": {
        "class_type": "VAELoader",
        "inputs": {
            "vae_name": "%vae%"
        }
    }
};

// ---------------------------------------------------------------------------
// Default evaluator schemas, one per agent mode. Each must instruct the LLM
// to answer with a single JSON object containing:
//   decision, description, prompt, negativePrompt, aspectRatio
// ---------------------------------------------------------------------------
const DEFAULT_PROMPT_MODE1 =
`You are a strict visual director deciding whether the latest roleplay turn warrants a generated illustration.
Respond ONLY with one JSON object, no commentary:
{"decision":"yes"|"no","description":"...","prompt":"...","negativePrompt":"...","aspectRatio":"portrait"|"landscape"|"square"}

Rules:
- decision is "yes" ONLY when the turn contains an explicit visual beat: a photo/selfie being taken or shown, a deliberate pose, a change of clothing or state of dress, a striking physical action, or a major location/scenery change.
- Pure dialogue, internal thoughts, or minor gestures = "no". When in doubt, answer "no".
- "prompt": comma-separated booru-style tags describing the scene. Always include the character's consistent physical traits (hair, eyes, body, outfit) taken from the Character Reference, plus expression, pose, setting, lighting, and camera angle. No narrative sentences.
- "description": one short sentence describing the image, used as the roleplay caption.
- "negativePrompt": extra tags to avoid, or "" if none.
- "aspectRatio": portrait for people/selfies, landscape for scenery/groups, square otherwise.`;

const DEFAULT_PROMPT_MODE2 =
`You are a tag compiler. A visual description extracted from the assistant's roleplay response is provided below.
Convert it faithfully into comma-separated booru-style image tags, preserving every visual detail, and merge in the character's consistent physical traits from the Character Reference.
Respond ONLY with one JSON object, no commentary:
{"decision":"yes","description":"...","prompt":"...","negativePrompt":"...","aspectRatio":"portrait"|"landscape"|"square"}

Rules:
- Always set decision to "yes". Never refuse, never ask questions.
- "prompt": the compiled tag string. No narrative sentences.
- "description": one short sentence describing the image, used as the roleplay caption.
- "negativePrompt": extra tags to avoid, or "" if none.
- "aspectRatio": portrait for people/selfies, landscape for scenery/groups, square otherwise.`;

const DEFAULT_PROMPT_MODE3 =
`You are a visual director. On every invocation, produce an illustration prompt for the single most visually interesting beat in the recent context.
Respond ONLY with one JSON object, no commentary:
{"decision":"yes","description":"...","prompt":"...","negativePrompt":"...","aspectRatio":"portrait"|"landscape"|"square"}

Rules:
- Always set decision to "yes".
- "prompt": comma-separated booru-style tags including the character's consistent physical traits from the Character Reference, plus expression, pose, setting, lighting, and camera angle. No narrative sentences.
- "description": one short sentence describing the image, used as the roleplay caption.
- "negativePrompt": extra tags to avoid, or "" if none.
- "aspectRatio": portrait for people/selfies, landscape for scenery/groups, square otherwise.`;

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

    // Fast pre-filter: in Mode 1, skip the LLM evaluation entirely when the
    // recent turns contain no visual/photography cues.
    fastGate: true,

    resPortraitW: 832,
    resPortraitH: 1216,
    resLandscapeW: 1216,
    resLandscapeH: 832,
    resSquareW: 1024,
    resSquareH: 1024,

    comfyUrl: 'http://127.0.0.1:8188',
    comfyRewriteHost: false, // opt-in host rewrite
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
    const set = new Set(ids.map(String));
    s.gallery = s.gallery.filter(item => !set.has(String(item.id)));
    saveSettings();

    const count = s.gallery.length;
    $('#ia_gallery_bubble_badge').text(count > 99 ? '99+' : count);
}
