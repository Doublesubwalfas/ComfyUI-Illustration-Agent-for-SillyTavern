import { AGENT_JSON_SCHEMA, BUILT_IN_TEMPLATES } from './prompts.js';
import { MEMORY_STOPWORDS } from './compiler.js';

export async function processTurn(messageId, settings, extSettings) {
    const context = SillyTavern.getContext();
    const meta = context.chatMetadata || window.chat_metadata || {};
    
    if (!meta.comfyui_illustration_agent) meta.comfyui_illustration_agent = { messageCounter: 0, enabled: true };
    const agentMeta = meta.comfyui_illustration_agent;

    if (!agentMeta.enabled || settings.runInterval === 0) return null;

    agentMeta.messageCounter++;
    if (agentMeta.messageCounter % settings.runInterval !== 0) return null;

    // Build context
    const chatSubset = context.chat.slice(-settings.contextSize).map(m => `${m.name}: ${m.mes}`).join('\n');
    const templateId = agentMeta.promptTemplateId || 'background';
    const template = [...BUILT_IN_TEMPLATES, ...(extSettings.customTemplates || [])].find(t => t.id === templateId) || BUILT_IN_TEMPLATES[0];

    let systemPrompt = template.body + `\n\nContext:\n${chatSubset}\n\n`;

    // Inject known appearance refs
    if (agentMeta.characterRefs && Object.keys(agentMeta.characterRefs).length > 0) {
        systemPrompt += `Known Appearances (use these if the character appears):\n`;
        for (const [char, data] of Object.entries(agentMeta.characterRefs)) {
            systemPrompt += `<known_appearance name="${char}">${data.appearanceTags.join(', ')}</known_appearance>\n`;
        }
    }

    // Hardening Instruction
    systemPrompt += `\n\nCRITICAL: You must respond ONLY with a raw JSON object matching the requested schema. Do not enclose your response in markdown code blocks, backticks, or prepend/append conversational prose.`;

    let generateRawFn = window.generateRaw || (context && context.generateRaw);
    if (!generateRawFn) {
        toastr.error('Illustrator: generateRaw is unavailable in this ST version.');
        return null;
    }

    try {
        const response = await generateRawFn({
            prompt: systemPrompt,
            should_silence: true,
            jsonSchema: AGENT_JSON_SCHEMA
        });

        if (!response) throw new Error('Empty response');

        // Clean markdown blocks if LLM disobeyed
        let cleanJson = response.replace(/^```json/m, '').replace(/^```/m, '').trim();
        if (cleanJson.endsWith('```')) cleanJson = cleanJson.slice(0, -3).trim();

        let decision;
        try {
            decision = JSON.parse(cleanJson);
        } catch (e) {
            // Regex Fallback
            decision = {
                shouldGenerate: /"shouldGenerate"\s*:\s*true/i.test(cleanJson),
                generateBackground: /"generateBackground"\s*:\s*true/i.test(cleanJson),
                prompt: (/"prompt"\s*:\s*"([^"]+)"/.exec(cleanJson) || [])[1] || "",
                negativePrompt: (/"negativePrompt"\s*:\s*"([^"]+)"/.exec(cleanJson) || [])[1] || "",
                characters: []
            };
            if (!decision.shouldGenerate && !decision.generateBackground) return null;
        }

        if (!decision.shouldGenerate && !decision.generateBackground) return null;

        return decision;
    } catch (e) {
        console.warn('Illustrator Agent LLM failure:', e);
        return null;
    }
}

export function updateCharacterMemory(charactersList, compiledPos) {
    if (!charactersList || charactersList.length === 0) return;
    
    const context = SillyTavern.getContext();
    const meta = context.chatMetadata || window.chat_metadata || {};
    if (!meta.comfyui_illustration_agent) return;
    const agentMeta = meta.comfyui_illustration_agent;
    
    if (!agentMeta.characterRefs) agentMeta.characterRefs = {};

    const rawTags = compiledPos.split(',').map(t => t.trim().toLowerCase());
    const validTags = rawTags.filter(t => t && !MEMORY_STOPWORDS.has(t));

    charactersList.forEach(char => {
        if (!agentMeta.characterRefs[char]) {
            agentMeta.characterRefs[char] = { appearanceTags: [], lastSeen: Date.now(), generations: 0 };
        }
        const ref = agentMeta.characterRefs[char];
        const newTags = new Set([...ref.appearanceTags, ...validTags]);
        ref.appearanceTags = Array.from(newTags).slice(-20); // Cap at 20
        ref.lastSeen = Date.now();
        ref.generations++;
    });
    
    context.saveMetadataDebounced();
}

export async function fetchAvatarReferences(charactersList, settings) {
    if (!settings.sendAvatarReferences || !charactersList || charactersList.length === 0) return [];
    
    const context = SillyTavern.getContext();
    const refs = [];
    
    for (const charName of charactersList) {
        if (refs.length >= 4) break;
        const c = context.characters.find(c => c.name === charName);
        if (c && c.avatar) {
            try {
                const res = await fetch(`/characters/${c.avatar}`);
                if (res.ok) {
                    const blob = await res.blob();
                    refs.push(blob);
                }
            } catch (e) {
                console.warn('Failed to fetch avatar for', charName);
            }
        }
    }
    return refs;
}

export function getCardAppearanceText(charactersList) {
    const context = SillyTavern.getContext();
    let inject = '';
    
    charactersList.forEach(charName => {
        const c = context.characters.find(c => c.name === charName);
        if (c && c.description) {
            inject += `${charName}'s Appearance: ${c.description.substring(0, 400)}\n`;
        }
    });
    return inject;
}