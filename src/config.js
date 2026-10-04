export const MODULE_NAME = 'comfyui-illustration-agent';

// MODE 1: Full Autonomous Doublesub Engine Schema
export const schemaMode1 = `You are the autonomous Doublesub Illustration Agent for a roleplay novel.
Analyze the latest assistant turn (<assistant_response>) anchored to recent chat continuity.

### STEP 1: DECISION
Set "decision" to "yes" ONLY IF:
1. A direct photo/selfie action happens.
2. A physical action, dynamic combat, intimacy, or character reveal occurs.
Otherwise, set "decision" to "no" and stop.

### STEP 2: SCENE GENERATION
If decision is "yes", write a prompt for the current scene/action.

Respond ONLY with valid JSON in this exact schema:
{
  "decision": "yes" | "no",
  "reason": "short explanation of your decision",
  "description": "grounded 1-2 sentence scene description for LLM memory",
  "prompt": "detailed image generation tags (1girl, etc)",
  "negativePrompt": "negative tags (bad anatomy, etc)",
  "aspectRatio": "portrait" | "landscape" | "square"
}`;

// MODE 2: Extracted XML-Tag Schema (<image> & <scene>)
export const schemaMode2 = `You are the Scene Illustration Agent for a roleplay novel.
You have been provided with an extracted visual description requested by the character.
Your ONLY job is to convert their natural language description into high-quality image generation tags.

Respond ONLY with valid JSON in this exact schema:
{
  "description": "Cleaned up 1-2 sentence description based on the extracted request",
  "prompt": "detailed image generation tags (1girl, solo, etc) translating the request",
  "negativePrompt": "negative prompt tags",
  "aspectRatio": "portrait" | "landscape" | "square"
}`;

// MODE 3: Direct Forced Prompt Generator
export const schemaMode3 = `You are the Direct Illustration Generator for a roleplay novel.
Based on the latest assistant turn (<assistant_response>), draft an immediate high-quality illustration prompt of the current moment.

Respond ONLY with valid JSON in this exact schema:
{
  "description": "1-2 sentence visual description of the current moment",
  "prompt": "detailed image generation tags describing subject, pose, clothes",
  "negativePrompt": "negative prompt tags to avoid",
  "aspectRatio": "portrait" | "landscape" | "square"
}`;

export const defaultComfyWorkflowJson = `{
  "10": {
    "inputs": {
      "text": "%prompt%",
      "clip": ["128", 0]
    },
    "class_type": "CLIPTextEncode",
    "_meta": { "title": "CLIP Text Encode (Prompt)" }
  },
  "11": {
    "inputs": {
      "text": "%negative_prompt%",
      "clip": ["128", 0]
    },
    "class_type": "CLIPTextEncode",
    "_meta": { "title": "CLIP Text Encode (Prompt)" }
  },
  "12": {
    "inputs": {
      "seed": "%seed%",
      "steps": "%steps%",
      "cfg": "%cfg%",
      "sampler_name": "%sampler%",
      "scheduler": "%scheduler%",
      "denoise": "%denoise%",
      "model": ["129", 0],
      "positive": ["10", 0],
      "negative": ["11", 0],
      "latent_image": ["113", 0]
    },
    "class_type": "KSampler",
    "_meta": { "title": "KSampler" }
  },
  "14": {
    "inputs": {
      "samples": ["12", 0],
      "vae": ["137", 0]
    },
    "class_type": "VAEDecode",
    "_meta": { "title": "VAE Decode" }
  },
  "15": {
    "inputs": {
      "filename_prefix": "ComfyInject",
      "images": ["14", 0]
    },
    "class_type": "SaveImage",
    "_meta": { "title": "Save Image" }
  },
  "113": {
    "inputs": {
      "width": "%width%",
      "height": "%height%",
      "batch_size": 1
    },
    "class_type": "EmptyLatentImage",
    "_meta": { "title": "Empty Latent Image" }
  },
  "128": {
    "inputs": {
      "clip_name": "%clip%",
      "type": "stable_diffusion",
      "device": "cuda:1"
    },
    "class_type": "CLIPLoaderGGUFMultiGPU",
    "_meta": { "title": "CLIPLoaderGGUFMultiGPU" }
  },
  "129": {
    "inputs": {
      "ckpt_name": "%model%",
      "device": "cuda:0"
    },
    "class_type": "CheckpointLoaderSimpleMultiGPU",
    "_meta": { "title": "CheckpointLoaderSimpleMultiGPU" }
  },
  "137": {
    "inputs": {
      "vae_name": "%vae%"
    },
    "class_type": "VAELoader",
    "_meta": { "title": "Load VAE" }
  }
}`;

export const defaultSettings = {
    enabled: true,
    agentMode: 'mode1',
    deliveryMode: 'attached',
    triggerInterval: 3,
    pipelinePhase: 'post',
    interactiveReview: false,
    batchCount: 1,
    lookback: 3,
    stylePrefix: 'semi-realistic anime style, 2.5D anime, 3D anime, masterpiece, best quality, cinematic lighting',
    defaultNegative: 'lowres, bad anatomy, bad hands, text, error, blurry, jpeg artifacts',

    mode2InjectionText: '[SYSTEM NOTE: To trigger an illustration, you MUST output a visual description enclosed EXACTLY in <image>...</image> tags (for photos) or <scene>...</scene> tags (for actions). Example: <image>A selfie of me smiling.</image> Do NOT add markdown or extra commentary around the tags.]',

    promptMode1: schemaMode1,
    promptMode2: schemaMode2,
    promptMode3: schemaMode3,

    resPortraitW: 832,
    resPortraitH: 1216,
    resLandscapeW: 1216,
    resLandscapeH: 832,
    resSquareW: 1024,
    resSquareH: 1024,

    comfySteps: 20,
    comfyCfg: 4.5,
    comfySampler: 'euler_ancestral',
    comfyScheduler: 'normal',
    comfyModel: 'anima-turbo-v1.1.safetensors',
    comfyClip: 'Qwen3-0.6B-heretic-abliterated-uncensored.i1-Q6_K.gguf',
    comfyVae: 'qwen_image_vae.safetensors',

    activeWorkflowText: defaultComfyWorkflowJson,
    workflowPresets: {
        'Default MultiGPU GGUF (Anima + Qwen)': defaultComfyWorkflowJson
    },
    selectedWorkflowPreset: 'Default MultiGPU GGUF (Anima + Qwen)',

    llmProvider: 'current',
    customLlmUrl: 'https://api.openai.com/v1',
    customLlmKey: '',
    customLlmModel: 'gpt-4o-mini',

    imageBackend: 'comfyui_direct',
    comfyUrl: 'http://127.0.0.1:8188'
};

export function getSettings() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = {};
    }
    context.extensionSettings[MODULE_NAME] = Object.assign(
        {},
        defaultSettings,
        context.extensionSettings[MODULE_NAME]
    );
    return context.extensionSettings[MODULE_NAME];
}

export function saveSettings() {
    const context = SillyTavern.getContext();
    context.saveSettingsDebounced?.();
}

export function getGalleryDb() {
    const s = getSettings();
    return Array.isArray(s.gallery) ? s.gallery : [];
}

export function saveGalleryRecord(entry) {
    const s = getSettings();
    if (!Array.isArray(s.gallery)) s.gallery = [];
    s.gallery.unshift(entry);
    saveSettings();
    $('#ia_gallery_bubble_badge').text(s.gallery.length);
}

export function deleteGalleryRecords(idsToDelete) {
    const s = getSettings();
    if (!Array.isArray(s.gallery)) return;
    s.gallery = s.gallery.filter(record => !idsToDelete.includes(record.id));
    saveSettings();
    $('#ia_gallery_bubble_badge').text(s.gallery.length);
}