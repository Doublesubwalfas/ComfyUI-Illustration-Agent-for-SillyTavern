export const MODULE_NAME = 'comfyui-illustration-agent';

export const defaultUnifiedSystemPrompt = `You are the autonomous Marinara Illustration Agent for a roleplay novel.
Analyze the latest assistant turn (<assistant_response>) anchored to recent chat continuity.

Execute these steps strictly:

### STEP 1: DECISION (yes or no)
- Set "decision" to "yes" if the latest assistant turn contains ANY of:
  1. A direct photo/selfie action (a character takes, poses for, sends, or requests a picture).
  2. A physical action, dynamic combat, intimacy, transformation, or character reveal.
  3. The narrative transitions to a noticeably different reusable location/room.
- Otherwise, set "decision" to "no" (for static conversation, contemplation, or minor dialog). Stop and return empty prompts.

### STEP 2: TARGET (roleplay OR background)
- "target": "background" -> ONLY when the scene transitions to a new reusable room, building, landscape, or environment.
- "target": "roleplay" -> For character actions, selfies, intimate moments, portraits, or key events.
(Note: "background" and "roleplay" are mutually exclusive. Pick only one.)

### STEP 3: NARRATIVE DESCRIPTION
- "description": Write an accurate, concise 1-2 sentence description in plain natural English of what is visually depicted.
  - Ground it strictly in the character's card traits, outfit, pose, expression, and environment. Do not hallucinate missing features.
  - For selfies/photos, state explicitly: "A selfie taken by [Char] smiling in [Location] wearing [Outfit]..."
  - This narrative text will be perceived by the LLM in future turns so it remembers the visual moment.

### STEP 4: IMAGE GENERATION PROMPT
- "prompt": High-quality text-to-image tags derived DIRECTLY from your description (subject, pose, clothing details, expression, environment, lighting, angle).
- "negativePrompt": Specific tags to avoid (e.g., bad anatomy, distorted hands, blurry, lowres).

Respond ONLY with valid JSON in this exact schema:
{
  "decision": "yes" | "no",
  "target": "roleplay" | "background",
  "location": "concise name of place if background",
  "reason": "short explanation of why or why not",
  "description": "grounded 1-2 sentence scene description for LLM memory",
  "prompt": "detailed image generation tags",
  "negativePrompt": "negative prompt tags",
  "aspectRatio": "portrait" | "landscape" | "square",
  "characters": ["visible character names"]
}`;

export const defaultSettings = {
    enabled: true,
    deliveryMode: 'attached', // 'attached' (inside message) or 'separate' (/comment card)
    triggerMode: 'every',
    triggerInterval: 3,
    pipelinePhase: 'post',
    interactiveReview: false,
    batchCount: 1,
    lookback: 3,
    stylePrefix: 'semi-realistic anime style, 2.5D anime, 3D anime, masterpiece, best quality, cinematic lighting',
    defaultNegative: 'lowres, bad anatomy, bad hands, text, error, blurry, jpeg artifacts',
    unifiedPrompt: defaultUnifiedSystemPrompt,

    // Resolutions
    resPortraitW: 832,
    resPortraitH: 1216,
    resLandscapeW: 1216,
    resLandscapeH: 832,
    resSquareW: 1024,
    resSquareH: 1024,
    resBgW: 1344,
    resBgH: 768,

    // ComfyUI Defaults
    comfySteps: 20,
    comfyCfg: 4.5,
    comfySampler: 'euler_ancestral',
    comfyScheduler: 'normal',

    // LLM
    llmProvider: 'current',
    customLlmUrl: 'https://api.openai.com/v1',
    customLlmKey: '',
    customLlmModel: 'gpt-4o-mini',

    // Backend
    imageBackend: 'comfyui_direct',
    comfyUrl: 'http://127.0.0.1:8188',
    comfyWorkflow: ''
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