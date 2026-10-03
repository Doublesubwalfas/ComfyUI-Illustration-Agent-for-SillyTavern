export const AGENT_JSON_SCHEMA = {
    name: 'IllustratorDecision',
    strict: true,
    value: {
        $schema: 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        properties: {
            shouldGenerate: { type: 'boolean' },
            generateBackground: { type: 'boolean' },
            reason: { type: 'string' },
            prompt: { type: 'string' },
            negativePrompt: { type: 'string' },
            style: { type: 'string' },
            aspectRatio: { type: 'string', enum: ['landscape', 'portrait', 'square'] },
            characters: { type: 'array', items: { type: 'string' } }
        },
        required: ['shouldGenerate', 'generateBackground', 'reason', 'prompt', 'negativePrompt', 'characters']
    }
};

const BASE_INSTRUCTION = `You are an invisible Illustration Agent observing a roleplay.
Your job is to decide if the LATEST assistant turn describes a significant visual event that warrants an image, and if so, write a detailed image prompt.

Rules for deciding:
1. ONLY trigger (shouldGenerate=true) if there is a distinct visual shift (new action, intense emotion, transformation, or direct selfie/photo action) in the LATEST turn.
2. ONLY trigger a background (generateBackground=true) if <illustrator_background_generation enabled="true"> is present AND the location changed to a reusable environment.
3. Describe all visible characters accurately based on context. Do not invent traits.
4. Output MUST be ONLY valid JSON matching the schema. No markdown blocks, no conversational text.`;

export const BUILT_IN_TEMPLATES = [
    {
        id: 'background',
        name: 'Background (Establishing Shot)',
        kind: 'background',
        body: `${BASE_INSTRUCTION}\nFocus: Pure environment establishing shot. Return an empty characters array []. Describe lighting, architecture, and mood.`
    },
    {
        id: 'illustration',
        name: 'Standard Illustration',
        kind: 'illustration',
        body: `${BASE_INSTRUCTION}\nFocus: Polished single-scene illustration capturing the current emotional or physical beat. Describe subject poses and expressions clearly.`
    },
    {
        id: 'comic',
        name: 'Comic Page',
        kind: 'comic',
        body: `${BASE_INSTRUCTION}\nFocus: Panelled comic page. Describe actions dynamically. Assume speech bubbles and lettering will be part of the style.`
    },
    {
        id: 'colored_manga',
        name: 'Colored Manga',
        kind: 'colored_manga',
        body: `${BASE_INSTRUCTION}\nFocus: Highly stylized colored manga beat with impact frames, speed lines, and dramatic angles.`
    },
    {
        id: 'bw_manga',
        name: 'B&W Manga',
        kind: 'bw_manga',
        body: `${BASE_INSTRUCTION}\nFocus: Traditional black and white manga ink style. Describe heavy contrast, screentones, and intense expressions.`
    },
    {
        id: 'selfie',
        name: 'Selfie / Portrait',
        kind: 'selfie',
        body: `${BASE_INSTRUCTION}\nFocus: Close-up portrait or selfie. Aspect ratio should be portrait. Detail the face, eyes, and expression prominently.`
    }
];

export const DEFAULT_STYLE_PROFILE = {
    id: 'default',
    name: 'Default Anime 2.5D',
    positiveTokens: 'semi-realistic anime style, 2.5D anime, 3D anime, masterpiece, best quality, realistic light physics, soft gradient shading, dynamic form shadows, volumetric lighting, subsurface scattering, global illumination, raytraced shadows, ambient occlusion, smooth shadow transitions, 3D contour shading, dramatic lighting, highly detailed skin texture, expressive face, detailed eyes',
    negativeTokens: 'worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration, cel shading, flat shading, hard shadows, flat colors, flat lighting, 2d illustration, black outlines, lineart, anime screencap'
};