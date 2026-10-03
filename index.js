import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const MODULE_NAME = 'comfyui-illustration-agent';

const defaultSettings = {
    enabled: false,
    lookback: 3,
    stylePrefix: 'masterpiece, best quality, detailed background, cinematic lighting',
    negativePrompt: 'low quality, blurry, text, bad anatomy, bad hands, jpeg artifacts',
    systemPrompt: `You are an Illustration Director for a roleplay novel.
Analyze the latest messages and decide if the current scene warrants a visual illustration (e.g. dramatic scene shift, key character action, intimacy, entrance, fight, scenic landscape).

You MUST respond strictly with a valid JSON block containing:
{
  "shouldGenerate": true or false,
  "reason": "Short reason explaining why or why not",
  "prompt": "Detailed comma-separated prompt describing subject, pose, clothes, expression, environment, lighting"
}`
};

let isEvaluating = false;

// 1. Settings Initialization
function loadSettings() {
    extension_settings[MODULE_NAME] = Object.assign({}, defaultSettings, extension_settings[MODULE_NAME] || {});
    
    $('#ia_auto_enabled').prop('checked', extension_settings[MODULE_NAME].enabled);
    $('#ia_style_prefix').val(extension_settings[MODULE_NAME].stylePrefix);
    $('#ia_negative_prompt').val(extension_settings[MODULE_NAME].negativePrompt);
    $('#ia_lookback').val(extension_settings[MODULE_NAME].lookback);
    $('#ia_system_prompt').val(extension_settings[MODULE_NAME].systemPrompt);
}

function bindUI() {
    $('#ia_auto_enabled').on('change', function () {
        extension_settings[MODULE_NAME].enabled = $(this).is(':checked');
        saveSettingsDebounced();
    });

    $('#ia_style_prefix').on('input', function () {
        extension_settings[MODULE_NAME].stylePrefix = $(this).val();
        saveSettingsDebounced();
    });

    $('#ia_negative_prompt').on('input', function () {
        extension_settings[MODULE_NAME].negativePrompt = $(this).val();
        saveSettingsDebounced();
    });

    $('#ia_lookback').on('change', function () {
        extension_settings[MODULE_NAME].lookback = Math.max(1, parseInt($(this).val()) || 3);
        saveSettingsDebounced();
    });

    $('#ia_system_prompt').on('input', function () {
        extension_settings[MODULE_NAME].systemPrompt = $(this).val();
        saveSettingsDebounced();
    });

    $('#ia_force_generate_btn').on('click', () => runIllustrationAgent(true));
}

// 2. Evaluation Logic
async function runIllustrationAgent(force = false) {
    if (isEvaluating) return;
    const context = SillyTavern.getContext();
    if (!context || !context.chat || context.chat.length === 0) return;

    if (!force && !extension_settings[MODULE_NAME].enabled) return;

    isEvaluating = true;
    try {
        const lookbackCount = extension_settings[MODULE_NAME].lookback;
        const recentMessages = context.chat.slice(-lookbackCount);

        let contextText = recentMessages
            .map(m => `${m.name || (m.is_user ? 'User' : 'Character')}: ${m.mes}`)
            .join('\n\n');

        const activeChar = context.characters?.[context.characterId];
        const charAppearance = activeChar?.data?.description || activeChar?.description || '';

        const agentInstruction = `
${extension_settings[MODULE_NAME].systemPrompt}

Character Appearance Reference:
${charAppearance ? charAppearance.substring(0, 500) : 'None'}

Current Scene Dialog & Action:
${contextText}

Remember: Return pure JSON only with keys "shouldGenerate", "reason", and "prompt".
`;

        toastr.info('Illustration Agent evaluating scene...', 'Illustrator');

        // Background call that doesn't interrupt or inject into chat history
        const response = await context.generateQuietPrompt(agentInstruction, false, false);
        if (!response) {
            isEvaluating = false;
            return;
        }

        // Clean json output (handles markdown wrapping like ```json ... ```)
        const cleanedResponse = response.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        let parsed;
        try {
            parsed = JSON.parse(cleanedResponse);
        } catch (e) {
            // Fallback: search for first { and last }
            const match = cleanedResponse.match(/\{[\s\S]*\}/);
            if (match) parsed = JSON.parse(match[0]);
            else throw new Error('Could not parse JSON response from Agent');
        }

        if (force || parsed.shouldGenerate === true) {
            toastr.success(`Triggering Illustration: ${parsed.reason || 'Moment detected'}`, 'Illustrator');

            const fullPrompt = [extension_settings[MODULE_NAME].stylePrefix, parsed.prompt]
                .filter(Boolean)
                .join(', ');

            // Triggers SillyTavern's ComfyUI connection via Slash command
            await context.executeSlashCommands(`/imagine ${fullPrompt}`);
        } else {
            console.log('[Illustration Agent] Decision: No illustration warranted.', parsed.reason);
        }
    } catch (err) {
        console.error('[Illustration Agent Error]', err);
        toastr.error('Failed to run Illustration Agent. See browser console.', 'Illustrator');
    } finally {
        isEvaluating = false;
    }
}

// 3. Lifecycle Registration
jQuery(async () => {
    loadSettings();
    bindUI();

    // Listen for AI assistant turn completion
    eventSource.on(event_types.CHAT_COMPLETION_FINISHED, () => {
        if (extension_settings[MODULE_NAME]?.enabled) {
            runIllustrationAgent(false);
        }
    });

    console.log('[Illustration Agent] Initialized successfully.');
});