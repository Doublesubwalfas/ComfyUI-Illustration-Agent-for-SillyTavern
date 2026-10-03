import { DEFAULT_STYLE_PROFILE, BUILT_IN_TEMPLATES } from './prompts.js';
import { processTurn, updateCharacterMemory, fetchAvatarReferences, getCardAppearanceText } from './agent.js';
import { compilePrompt } from './compiler.js';
import { submitToComfyUI, uploadReferenceImage, reviewPromptModal } from './comfyui.js';
import { handleImageOutput, mountGalleryDrawer, renderGalleryData } from './gallery.js';

// Absolute imports for SillyTavern's internal modules
import { SlashCommandParser } from '/scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '/scripts/slash-commands/SlashCommand.js';

const DEFAULT_SETTINGS = {
    enabled: true,
    runInterval: 5,
    promptConnection: 'agent default',
    contextSize: 50,
    maxTokens: 4096,
    attachCardAppearance: true,
    sendAvatarReferences: false,
    exposePromptBeforeSend: false,
    comfyUrl: 'http://127.0.0.1:8188',
    workflow: '{"3":{"inputs":{"seed":%seed%,"steps":%steps%,"cfg":%cfg%,"sampler_name":"euler","scheduler":"normal","denoise":1,"model":["4",0],"positive":["6",0],"negative":["7",0],"latent_image":["5",0]},"class_type":"KSampler"},"4":{"inputs":{"ckpt_name":"model.safetensors"},"class_type":"CheckpointLoaderSimple"},"5":{"inputs":{"width":%width%,"height":%height%,"batch_size":1},"class_type":"EmptyLatentImage"},"6":{"inputs":{"text":"%prompt%","clip":["4",1]},"class_type":"CLIPTextEncode"},"7":{"inputs":{"text":"%negative_prompt%","clip":["4",1]},"class_type":"CLIPTextEncode"},"8":{"inputs":{"samples":["3",0],"vae":["4",2]},"class_type":"VAEDecode"},"9":{"inputs":{"filename_prefix":"ComfyUI","images":["8",0]},"class_type":"SaveImage"}}',
    modelClass: 'sdxl',
    posDefaults: 'masterpiece, best quality, highres',
    negDefaults: 'worst quality, low quality, bad anatomy',
    aspectRatio: 'landscape',
    steps: 25,
    cfg: 7,
    activeStyleId: 'default',
    styleProfiles: [DEFAULT_STYLE_PROFILE],
    generateBackgrounds: false,
    autoApplyBackground: true,
    globalGallery: [],
    customTemplates: []
};

// Inlined HTML to guarantee it loads without needing a file fetch
const SETTINGS_HTML = `
<div id="comfy-agent-settings" class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>ComfyUI Illustration Agent</b>
        <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content" style="padding-top: 10px;">
        <div class="setting-group">
            <h4>Agent Decision & Context</h4>
            <label class="checkbox-row"><input type="checkbox" id="cia_enabled" data-extension-name="comfyui_illustration_agent" data-setting="enabled"> Enable Illustrator Agent in this chat</label>
            
            <label for="cia_runInterval">Run Interval (0 = manual only)</label>
            <input type="number" id="cia_runInterval" data-extension-name="comfyui_illustration_agent" data-setting="runInterval" min="0">
            
            <label for="cia_promptTemplateId">Active Prompt Template</label>
            <select id="cia_promptTemplateId" data-extension-name="comfyui_illustration_agent" data-setting="promptTemplateId"></select>
            
            <label for="cia_promptConnection">Prompt Connection (Profile name or 'agent default')</label>
            <input type="text" id="cia_promptConnection" data-extension-name="comfyui_illustration_agent" data-setting="promptConnection">
            
            <label class="checkbox-row"><input type="checkbox" id="cia_attachCardAppearance" data-extension-name="comfyui_illustration_agent" data-setting="attachCardAppearance"> Attach Card Appearance (injects first 400 chars of character desc)</label>
            
            <label class="checkbox-row"><input type="checkbox" id="cia_sendAvatarReferences" data-extension-name="comfyui_illustration_agent" data-setting="sendAvatarReferences"> Send Avatar References to ComfyUI</label>
            
            <label class="checkbox-row"><input type="checkbox" id="cia_exposePromptBeforeSend" data-extension-name="comfyui_illustration_agent" data-setting="exposePromptBeforeSend"> <b>Expose prompt before sending (Review Modal)</b></label>
        </div>

        <div class="setting-group">
            <h4>Image Backend (ComfyUI)</h4>
            <label for="cia_comfyUrl">ComfyUI API URL</label>
            <input type="text" id="cia_comfyUrl" data-extension-name="comfyui_illustration_agent" data-setting="comfyUrl">
            
            <label for="cia_modelClass">Model Class</label>
            <select id="cia_modelClass" data-extension-name="comfyui_illustration_agent" data-setting="modelClass">
                <option value="sdxl">SDXL (Base 1024x1024)</option>
                <option value="sd15">SD 1.5 (Base 512x512)</option>
            </select>
            
            <label for="cia_aspectRatio">Default Aspect Ratio</label>
            <select id="cia_aspectRatio" data-extension-name="comfyui_illustration_agent" data-setting="aspectRatio">
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
                <option value="square">Square</option>
            </select>
            
            <label for="cia_workflow">Workflow JSON (API Format)</label>
            <textarea id="cia_workflow" data-extension-name="comfyui_illustration_agent" data-setting="workflow" placeholder="Paste ComfyUI API JSON here. Must contain %prompt%..."></textarea>
            
            <label for="cia_steps">Sampling Steps (%steps%)</label>
            <input type="number" id="cia_steps" data-extension-name="comfyui_illustration_agent" data-setting="steps" min="1" max="150">
            
            <label for="cia_cfg">CFG Scale (%cfg%)</label>
            <input type="number" id="cia_cfg" data-extension-name="comfyui_illustration_agent" data-setting="cfg" min="1" max="30" step="0.5">
            
            <label for="cia_posDefaults">Connection Positive Defaults</label>
            <textarea id="cia_posDefaults" data-extension-name="comfyui_illustration_agent" data-setting="posDefaults"></textarea>
            
            <label for="cia_negDefaults">Connection Negative Defaults</label>
            <textarea id="cia_negDefaults" data-extension-name="comfyui_illustration_agent" data-setting="negDefaults"></textarea>
            
            <button id="cia_test_connection" class="comfy-btn">Test ComfyUI Connection</button>
        </div>

        <div class="setting-group">
            <h4>Style Profile</h4>
            <label for="cia_activeStyleId">Active Style</label>
            <select id="cia_activeStyleId" data-extension-name="comfyui_illustration_agent" data-setting="activeStyleId"></select>
        </div>

        <div class="setting-group">
            <h4>Backgrounds</h4>
            <label class="checkbox-row"><input type="checkbox" id="cia_generateBackgrounds" data-extension-name="comfyui_illustration_agent" data-setting="generateBackgrounds"> Allow agent to generate Scene Backgrounds</label>
            <label class="checkbox-row"><input type="checkbox" id="cia_autoApplyBackground" data-extension-name="comfyui_illustration_agent" data-setting="autoApplyBackground"> Auto-apply generated background to UI</label>
        </div>

        <div class="setting-group">
            <h4>Gallery & Storage</h4>
            <button id="cia_open_gallery" class="comfy-btn">Open Image Gallery</button>
            <p id="cia_gallery_count" style="font-size: 0.9em; color: var(--SmartThemeQuoteColor); margin-top: 10px;">Total images in global gallery: 0</p>
            
            <label class="checkbox-row"><input type="checkbox" id="cia_deleteImageFiles" data-extension-name="comfyui_illustration_agent" data-setting="deleteImageFiles"> Delete physical image files when removing global gallery entries</label>
            
            <button id="cia_prune_gallery" class="comfy-btn danger" style="margin-top: 10px;">Prune Global Gallery</button>
            <button id="cia_clear_chat_gallery" class="comfy-btn danger" style="margin-top: 10px;">Clear Gallery For This Chat</button>
        </div>
    </div>
</div>
`;

let messageHandlerBound = null;

export async function activate() {
    const context = SillyTavern.getContext();

    // 1. Merge settings safely
    if (!context.extensionSettings.comfyui_illustration_agent) {
        context.extensionSettings.comfyui_illustration_agent = {};
    }
    const extSettings = context.extensionSettings.comfyui_illustration_agent;
    for (const key in DEFAULT_SETTINGS) {
        if (extSettings[key] === undefined) extSettings[key] = DEFAULT_SETTINGS[key];
    }

    // 2. Render Settings UI
    try {
        $('#extensions_settings').append(SETTINGS_HTML);
        bindSettingsUI(extSettings, context);
    } catch (e) {
        console.error('Failed to load ComfyUI Agent settings HTML', e);
    }

    // 3. Register Event Handlers
    messageHandlerBound = onMessageReceived.bind(null, extSettings);
    context.eventSource.on(context.eventTypes.MESSAGE_RECEIVED, messageHandlerBound);
    context.eventSource.on(context.eventTypes.APP_READY, () => mountGalleryDrawer(extSettings));

    // 4. Register Slash Commands
    // FIX: Calling SlashCommandParser directly from the import, not from the context!
    SlashCommandParser.addCommandObject(
        SlashCommand.fromProps({
            name: 'draw',
            helpString: 'Manually trigger the Illustrator to draw a specific prompt.',
            unnamedArgumentList: [{ description: 'Prompt', typeList: ['string'], isRequired: true }],
            callback: async (args, text) => {
                await executePipeline({ prompt: text, negativePrompt: '', shouldGenerate: true, characters: [] }, extSettings, true);
                return '';
            }
        })
    );

    SlashCommandParser.addCommandObject(
        SlashCommand.fromProps({
            name: 'illustrator',
            helpString: 'Manage the ComfyUI Illustration Agent.',
            unnamedArgumentList: [
                { description: 'Action (on|off|style|interval|background|gallery|review)', typeList: ['string'], isRequired: true },
                { description: 'Value', typeList: ['string'], isRequired: false }
            ],
            callback: (args, value) => {
                const [action, ...rest] = (value || '').split(' ');
                const val = rest.join(' ').toLowerCase();

                switch (action.toLowerCase()) {
                    case 'on':
                        extSettings.enabled = true;
                        $('#cia_enabled').prop('checked', true);
                        toastr.success('Illustrator Agent Enabled.');
                        break;
                    case 'off':
                        extSettings.enabled = false;
                        $('#cia_enabled').prop('checked', false);
                        toastr.success('Illustrator Agent Disabled.');
                        break;
                    case 'style':
                        if (val) {
                            const match = extSettings.styleProfiles.find(s => s.name.toLowerCase().includes(val) || s.id === val);
                            if (match) {
                                extSettings.activeStyleId = match.id;
                                $('#cia_activeStyleId').val(match.id);
                                toastr.success(`Illustrator Style set to: ${match.name}`);
                            } else {
                                toastr.warning(`Style not found: ${val}`);
                            }
                        }
                        break;
                    case 'interval':
                        if (!isNaN(parseInt(val))) {
                            extSettings.runInterval = parseInt(val);
                            $('#cia_runInterval').val(extSettings.runInterval);
                            toastr.success(`Illustrator interval set to ${extSettings.runInterval}.`);
                        }
                        break;
                    case 'background':
                        extSettings.generateBackgrounds = val === 'on' || val === 'true';
                        $('#cia_generateBackgrounds').prop('checked', extSettings.generateBackgrounds);
                        toastr.success(`Background generation: ${extSettings.generateBackgrounds ? 'ON' : 'OFF'}`);
                        break;
                    case 'review':
                        extSettings.exposePromptBeforeSend = val === 'on' || val === 'true';
                        $('#cia_exposePromptBeforeSend').prop('checked', extSettings.exposePromptBeforeSend);
                        toastr.success(`Prompt review modal: ${extSettings.exposePromptBeforeSend ? 'ON' : 'OFF'}`);
                        break;
                    case 'gallery':
                        $('#comfy-agent-gallery-drawer').addClass('open');
                        renderGalleryData(extSettings);
                        break;
                    default:
                        toastr.info('Valid actions: on, off, style <name>, interval <n>, background on|off, gallery, review on|off');
                }
                context.saveSettingsDebounced();
                return '';
            }
        })
    );
    
    // UI Triggers
    $('#cia_open_gallery').on('click', () => {
        $('#comfy-agent-gallery-drawer').addClass('open');
        renderGalleryData(extSettings);
    });

    $('#cia_prune_gallery').on('click', () => {
        if(confirm('Prune global gallery? This removes the index entries.')) {
            extSettings.globalGallery = [];
            context.saveSettingsDebounced();
            toastr.success('Global gallery pruned.');
            $('#cia_gallery_count').text(`Total images in global gallery: 0`);
        }
    });

    $('#cia_clear_chat_gallery').on('click', () => {
        if(confirm('Clear gallery for this chat?')) {
            const meta = context.chatMetadata || window.chat_metadata || {};
            if(meta.comfyui_illustration_agent) {
                meta.comfyui_illustration_agent.gallery = [];
                context.saveMetadataDebounced();
                toastr.success('Local gallery cleared.');
            }
        }
    });

    $('#cia_test_connection').on('click', async () => {
        try {
            const res = await fetch(`${extSettings.comfyUrl.replace(/\/$/, '')}/system_stats`);
            if (res.ok) toastr.success('ComfyUI Connection Successful!');
            else throw new Error(res.status);
        } catch(e) {
            toastr.error('ComfyUI Connection Failed.');
        }
    });
}

function bindSettingsUI(extSettings, context) {
    $('[data-extension-name="comfyui_illustration_agent"]').each(function() {
        const key = $(this).data('setting');
        if (extSettings[key] !== undefined) {
            if ($(this).is(':checkbox')) $(this).prop('checked', extSettings[key]);
            else $(this).val(extSettings[key]);
        }
        $(this).on('change input', function() {
            if ($(this).is(':checkbox')) extSettings[key] = $(this).prop('checked');
            else extSettings[key] = $(this).val();
            context.saveSettingsDebounced();
        });
    });

    // Populate dropdowns
    const styleSel = $('#cia_activeStyleId').empty();
    extSettings.styleProfiles.forEach(sp => styleSel.append(`<option value="${sp.id}">${sp.name}</option>`));
    styleSel.val(extSettings.activeStyleId);

    const tmplSel = $('#cia_promptTemplateId').empty();
    [...BUILT_IN_TEMPLATES, ...extSettings.customTemplates].forEach(t => tmplSel.append(`<option value="${t.id}">${t.name}</option>`));
    
    // Default chat fallback if missing
    const meta = context.chatMetadata || window.chat_metadata || {};
    if(!meta.comfyui_illustration_agent) {
        meta.comfyui_illustration_agent = {};
    }

    $('#cia_gallery_count').text(`Total images in global gallery: ${extSettings.globalGallery.length}`);
}

export function disable() {
    const context = SillyTavern.getContext();
    if (messageHandlerBound) {
        context.eventSource.removeListener(context.eventTypes.MESSAGE_RECEIVED, messageHandlerBound);
    }
    // FIX: Using the direct imports here too
    SlashCommandParser.commands['draw'] && delete SlashCommandParser.commands['draw'];
    SlashCommandParser.commands['illustrator'] && delete SlashCommandParser.commands['illustrator'];
    $('#comfy-agent-settings').remove();
    $('#comfy-agent-gallery-drawer').remove();
    $('#comfy-agent-review-modal').remove();
}

async function onMessageReceived(extSettings, messageId) {
    const context = SillyTavern.getContext();
    const msg = context.chat[messageId];
    if (msg.is_user) return; // Only trigger on assistant

    const decision = await processTurn(messageId, extSettings, extSettings);
    if (!decision) return;

    await executePipeline(decision, extSettings, false);
}

async function executePipeline(decision, extSettings, isManual) {
    const context = SillyTavern.getContext();
    const meta = context.chatMetadata || window.chat_metadata || {};

    // 1. Template kind extraction
    const tmplId = meta.comfyui_illustration_agent?.promptTemplateId || 'background';
    const template = [...BUILT_IN_TEMPLATES, ...extSettings.customTemplates].find(t => t.id === tmplId);
    const kind = isManual ? 'illustration' : (template?.kind || 'illustration');
    const isBackground = decision.generateBackground && extSettings.generateBackgrounds;

    // 2. Pre-Compilation Assembly
    let rawPos = decision.prompt || '';
    if (extSettings.attachCardAppearance && decision.characters?.length > 0) {
        rawPos += `, ` + getCardAppearanceText(decision.characters);
    }

    // 3. Compile
    const compiled = compilePrompt(rawPos, decision.negativePrompt || '', isBackground ? 'background' : kind);
    
    // 4. Style Merge
    const styleProf = extSettings.styleProfiles.find(s => s.id === extSettings.activeStyleId) || DEFAULT_STYLE_PROFILE;
    let finalPos = `${compiled.positive}, ${extSettings.posDefaults}, ${styleProf.positiveTokens}`.replace(/,\s*,/g, ',').trim();
    let finalNeg = `${compiled.negative}, ${extSettings.negDefaults}, ${styleProf.negativeTokens}`.replace(/,\s*,/g, ',').trim();

    // 5. Dimension / Aspect Ratio
    const dims = { w: 1024, h: 1024 }; // dummy for review modal
    const aspect = decision.aspectRatio || extSettings.aspectRatio;

    // 6. Review Modal
    if (extSettings.exposePromptBeforeSend) {
        const review = await reviewPromptModal(finalPos, finalNeg, isBackground ? 'background' : kind, dims);
        if (!review) return; // Cancelled
        finalPos = review.positive;
        finalNeg = review.negative;
    }

    // 7. Avatar Refs
    const refNames = [];
    if (extSettings.sendAvatarReferences && decision.characters?.length > 0) {
        const blobs = await fetchAvatarReferences(decision.characters, extSettings);
        for (const blob of blobs) {
            const name = await uploadReferenceImage(blob, extSettings);
            if (name) refNames.push(name);
        }
    }

    // 8. Submit
    toastr.info('Illustrator Agent generating image...', '', { timeOut: 3000 });
    const imageBlob = await submitToComfyUI(finalPos, finalNeg, aspect, extSettings, isBackground, refNames);
    if (!imageBlob) return; // Error handled internally

    // 9. Output & Storage
    await handleImageOutput(imageBlob, decision, finalPos, finalNeg, isBackground, extSettings, extSettings);

    // 10. Memory
    if (!isBackground) {
        updateCharacterMemory(decision.characters, finalPos);
    }
}