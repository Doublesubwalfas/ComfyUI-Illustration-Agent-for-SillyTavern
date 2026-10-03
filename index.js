const MODULE_NAME = 'comfyui-illustration-agent';

const defaultSettings = {
    enabled: false,
    lookback: 3,
    stylePrefix: 'masterpiece, best quality, cinematic lighting, 8k',
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

// 1. Injects the HTML template into SillyTavern's extension drawer
async function loadHtmlTemplate() {
    const context = SillyTavern.getContext();
    let template = '';

    try {
        if (typeof context.renderExtensionTemplateAsync === 'function') {
            template = await context.renderExtensionTemplateAsync(`third-party/${MODULE_NAME}`, 'settings');
        }
    } catch {
        // Fallback if third-party path structure differs
    }

    if (!template) {
        try {
            const templateUrl = new URL('settings.html', import.meta.url).href;
            template = await $.get(templateUrl);
        } catch (e) {
            console.error(`[${MODULE_NAME}] Failed to load settings.html`, e);
        }
    }

    if (template) {
        $('#extensions_settings').append(template);
    }
}

// 2. Load settings into inputs
function loadSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    extensionSettings[MODULE_NAME] = Object.assign({}, defaultSettings, extensionSettings[MODULE_NAME] || {});

    $('#ia_auto_enabled').prop('checked', extensionSettings[MODULE_NAME].enabled);
    $('#ia_style_prefix').val(extensionSettings[MODULE_NAME].stylePrefix);
    $('#ia_negative_prompt').val(extensionSettings[MODULE_NAME].negativePrompt);
    $('#ia_lookback').val(extensionSettings[MODULE_NAME].lookback);
    $('#ia_system_prompt').val(extensionSettings[MODULE_NAME].systemPrompt);
}

// 3. Bind UI inputs & handlers
function bindUI() {
    const { extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();

    $('#ia_auto_enabled').off('change').on('change', function () {
        extensionSettings[MODULE_NAME].enabled = $(this).is(':checked');
        saveSettingsDebounced();
    });

    $('#ia_style_prefix').off('input').on('input', function () {
        extensionSettings[MODULE_NAME].stylePrefix = $(this).val();
        saveSettingsDebounced();
    });

    $('#ia_negative_prompt').off('input').on('input', function () {
        extensionSettings[MODULE_NAME].negativePrompt = $(this).val();
        saveSettingsDebounced();
    });

    $('#ia_lookback').off('change').on('change', function () {
        extensionSettings[MODULE_NAME].lookback = Math.max(1, parseInt($(this).val()) || 3);
        saveSettingsDebounced();
    });

    $('#ia_system_prompt').off('input').on('input', function () {
        extensionSettings[MODULE_NAME].systemPrompt = $(this).val();
        saveSettingsDebounced();
    });

    $('#ia_force_generate_btn').off('click').on('click', () => runIllustrationAgent(true));
}

// 4. Background Scene Evaluation
async function runIllustrationAgent(force = false) {
    if (isEvaluating) return;
    const context = SillyTavern.getContext();
    const { extensionSettings } = context;

    if (!context || !context.chat || context.chat.length === 0) return;
    if (!force && !extensionSettings[MODULE_NAME]?.enabled) return;

    isEvaluating = true;
    try {
        const lookbackCount = extensionSettings[MODULE_NAME].lookback;
        const recentMessages = context.chat.slice(-lookbackCount);

        const contextText = recentMessages
            .map(m => `${m.name || (m.is_user ? 'User' : 'Character')}: ${m.mes}`)
            .join('\n\n');

        const activeChar = context.characters?.[context.characterId];
        const charAppearance = activeChar?.data?.description || activeChar?.description || '';

        const agentInstruction = `
${extensionSettings[MODULE_NAME].systemPrompt}

Character Appearance Reference:
${charAppearance ? charAppearance.substring(0, 500) : 'None'}

Current Scene Dialog & Action:
${contextText}

Remember: Return pure JSON only with keys "shouldGenerate", "reason", and "prompt".
`;

        toastr.info('Illustration Agent evaluating scene...', 'Illustrator');

        const response = await context.generateQuietPrompt(agentInstruction, false, false);
        if (!response) {
            isEvaluating = false;
            return;
        }

        const cleanedResponse = response.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        let parsed;
        try {
            parsed = JSON.parse(cleanedResponse);
        } catch {
            const match = cleanedResponse.match(/\{[\s\S]*\}/);
            if (match) parsed = JSON.parse(match[0]);
            else throw new Error('Could not parse JSON response from Agent');
        }

        if (force || parsed.shouldGenerate === true) {
            toastr.success(`Triggering Illustration: ${parsed.reason || 'Moment detected'}`, 'Illustrator');

            const fullPrompt = [extensionSettings[MODULE_NAME].stylePrefix, parsed.prompt]
                .filter(Boolean)
                .join(', ');

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

// 5. Initialize once DOM is ready
jQuery(async () => {
    const context = SillyTavern.getContext();
    const { eventSource, eventTypes } = context;

    await loadHtmlTemplate();
    loadSettings();
    bindUI();

    // Event listener for assistant response completions
    if (eventSource && eventTypes) {
        eventSource.on(eventTypes.CHAT_COMPLETION_FINISHED, () => {
            if (context.extensionSettings[MODULE_NAME]?.enabled) {
                runIllustrationAgent(false);
            }
        });
    }

    console.log('[Illustration Agent] Initialized successfully.');
});