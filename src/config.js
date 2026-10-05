const SETTINGS_KEY = 'illustration_agent_settings';
const GALLERY_KEY = 'illustration_agent_gallery';

const DEFAULT_COMFY_WORKFLOW = {
  "3": {
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
    },
    "class_type": "KSampler"
  },
  "4": {
    "inputs": {
      "ckpt_name": "%model%"
    },
    "class_type": "CheckpointLoaderSimple"
  },
  "5": {
    "inputs": {
      "width": "%width%",
      "height": "%height%",
      "batch_size": 1
    },
    "class_type": "EmptyLatentImage"
  },
  "6": {
    "inputs": {
      "text": "%prompt%",
      "clip": ["4", 1]
    },
    "class_type": "CLIPTextEncode"
  },
  "7": {
    "inputs": {
      "text": "%negative_prompt%",
      "clip": ["4", 1]
    },
    "class_type": "CLIPTextEncode"
  },
  "8": {
    "inputs": {
      "samples": ["3", 0],
      "vae": ["4", 2]
    },
    "class_type": "VAEDecode"
  },
  "9": {
    "inputs": {
      "filename_prefix": "IllustrationAgent",
      "images": ["8", 0]
    },
    "class_type": "SaveImage"
  }
};

const DEFAULT_PROMPT_MODE1 = `You are an Autonomous Visual Director for an interactive narrative.
Assess whether the current scene requires an illustration.
Criteria for illustration: Dramatic actions, intimate moments, location shifts, or expressive character focus.

Respond ONLY with valid JSON matching this schema:
{
  "decision": "yes" | "no",
  "reason": "Short rationale",
  "description": "Visual summary of the scene",
  "prompt": "Detailed comma-separated Stable Diffusion / FLUX tags describing subject, pose, clothing, background, lighting",
  "negativePrompt": "blurry, low quality, distorted, extra limbs, bad anatomy",
  "aspectRatio": "portrait" | "landscape" | "square"
}`;

const DEFAULT_PROMPT_MODE2 = `Convert the provided <image> or <scene> tag into high-quality image generation tags.
Incorporate character traits and current visual focus.

Respond ONLY with valid JSON matching this schema:
{
  "decision": "yes",
  "description": "Visual summary of the scene",
  "prompt": "Detailed comma-separated tags describing character, expression, clothing, atmosphere, lighting",
  "negativePrompt": "blurry, low quality, distorted, extra limbs",
  "aspectRatio": "portrait" | "landscape" | "square"
}`;

const DEFAULT_PROMPT_MODE3 = `Generate an illustration for the current moment in the narrative.
Respond ONLY with valid JSON matching this schema:
{
  "decision": "yes",
  "description": "Visual summary of the current beat",
  "prompt": "Detailed comma-separated tags describing the scene and characters",
  "negativePrompt": "blurry, low quality, distorted",
  "aspectRatio": "portrait" | "landscape" | "square"
}`;

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
    comfyModel: 'anima-turbo-v1.1.safetensors',
    comfyClip: 'Qwen3-0.6B-heretic-abliterated-uncensored.i1-Q6_K.gguf',
    comfyVae: 'qwen_image_vae.safetensors',
    comfySteps: 20,
    comfyCfg: 4.5,
    comfySampler: 'euler_ancestral',
    comfyScheduler: 'normal',

    selectedWorkflowPreset: 'Default KSampler',
    workflowPresets: {
        'Default KSampler': JSON.stringify(DEFAULT_COMFY_WORKFLOW, null, 2)
    },
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
            const stored = context?.extensionSettings?.[SETTINGS_KEY] || JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
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
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));
    } catch (e) {
        console.error('[Illustration Agent] Error saving settings', e);
    }
}

export function getGalleryDb() {
    const s = getSettings();
    return s.gallery || [];
}

export function saveGalleryRecord(record) {
    const s = getSettings();
    if (!Array.isArray(s.gallery)) s.gallery = [];
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