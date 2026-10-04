import {
    getSettings,
    saveSettings,
    getGalleryDb,
    schemaMode1,
    schemaMode2,
    schemaMode3,
    defaultComfyWorkflowJson
} from './config.js';
import { getEffectiveComfyUrl } from './comfy.js';
import { queryAgentLLM, runEvaluation } from './agent.js';
import { deliverRoleplayImage, showImageToCharacter } from './chat.js';

export function resetGeneratingIndicator() {
    $('#ia_gallery_bubble').removeClass('is-generating');
    $('#ia_bubble_icon').removeClass('fa-wand-magic-sparkles fa-spin').addClass('fa-camera-retro');
}

export function promptReviewModal(pos, neg, ar, metadata, confirmCallback) {
    $('#ia_rev_desc').val(metadata.description || '');
    $('#ia_rev_positive').val(pos);
    $('#ia_rev_negative').val(neg);
    $('#ia_rev_ar').val(ar || 'portrait');
    $('#ia_review_modal').fadeIn(150);

    $('#ia_rev_confirm').off('click').on('click', () => {
        $('#ia_review_modal').fadeOut(150);
        metadata.description = $('#ia_rev_desc').val();
        if (confirmCallback) {
            confirmCallback($('#ia_rev_positive').val(), $('#ia_rev_negative').val(), $('#ia_rev_ar').val(), metadata);
        }
    });
}

export function showBatchCandidatePicker(results, description, selectCallback) {
    const $grid = $('#ia_batch_grid').empty();
    results.forEach((item, idx) => {
        const $item = $(`
            <div class="ia-batch-item" title="Click to insert Variation #${idx + 1}">
                <img src="${item.cleanUrl}" />
                <div style="padding: 6px; text-align: center; font-size: 0.85em; background: rgba(0,0,0,0.4);">
                    <b>Variation #${idx + 1}</b>
                </div>
            </div>
        `);
        $item.on('click', async () => {
            if (selectCallback) await selectCallback(item.cleanUrl, description);
            $('#ia_batch_picker_modal').fadeOut(150);
        });
        $grid.append($item);
    });
    $('#ia_batch_picker_modal').fadeIn(150);
}

function updateMacroBadges() {
    const s = getSettings();
    const schemaText = $('#ia_schema_editor').val() || '';
    const workflowText = $('#ia_comfy_workflow').val() || '';

    const schemaTokens = [
        { name: 'decision', desc: 'Output JSON key for yes/no decision' },
        { name: 'illustrations', desc: 'Output JSON Array for multi-gen tasks' },
        { name: 'type', desc: 'Output JSON key for roleplay vs background' },
        { name: 'description', desc: 'Output JSON key for narrative vision memory' },
        { name: 'prompt', desc: 'Output JSON key for image generation prompt' },
        { name: 'negativePrompt', desc: 'Output JSON key for negative prompt tags' },
        { name: 'location', desc: 'Output JSON key for background room/place name' },
        { name: '<assistant_response>', desc: 'Target anchor for the latest assistant message' }
    ];

    const $schemaBadges = $('#ia_schema_macro_badges').empty();
    schemaTokens.forEach(t => {
        const active = schemaText.includes(t.name);
        $schemaBadges.append(`
            <span class="ia-badge ${active ? 'active' : 'inactive'}" title="${t.desc}">
                ${active ? '✓' : '✗'} ${t.name}
            </span>
        `);
    });

    const workflowTokens = [
        { name: '%prompt%', desc: 'Injected image generation tags' },
        { name: '%negative_prompt%', desc: 'Injected negative prompt tags' },
        { name: '%seed%', desc: 'Injected random seed number' },
        { name: '%steps%', desc: 'Injected sampler step count' },
        { name: '%cfg%', desc: 'Injected CFG scale' },
        { name: '%sampler%', desc: 'Injected sampler algorithm' },
        { name: '%scheduler%', desc: 'Injected scheduler name' },
        { name: '%denoise%', desc: 'Injected denoise strength (1.0)' },
        { name: '%width%', desc: 'Injected aspect ratio width' },
        { name: '%height%', desc: 'Injected aspect ratio height' },
        { name: '%model%', desc: 'Injected checkpoint/safetensors name' },
        { name: '%clip%', desc: 'Injected GGUF/CLIP model name' },
        { name: '%vae%', desc: 'Injected VAE name' }
    ];

    const $wfBadges = $('#ia_workflow_macro_badges').empty();
    workflowTokens.forEach(t => {
        const active = workflowText.includes(t.name);
        $wfBadges.append(`
            <span class="ia-badge ${active ? 'active' : 'inactive'}" title="${t.desc}">
                ${active ? '✓' : '✗'} ${t.name}
            </span>
        `);
    });
}

export function setupUI() {
    if ($('#ia_main_container').length > 0) return;

    const settingsHtml = `
    <div id="ia_main_container" class="illustration-agent-settings" style="margin-bottom: 12px;">
        <div class="inline-drawer">
            <div id="ia_drawer_toggle" class="inline-drawer-toggle inline-drawer-header" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
                <b><i class="fa-solid fa-palette" style="margin-right: 6px; color: #ff7675;"></i>Doublesub Illustration Agent</b>
                <div id="ia_drawer_icon" class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            
            <div id="ia_drawer_content" class="inline-drawer-content" style="display: none; padding: 12px;">
                <div class="ia-section">
                    <div class="ia-section-title"><i class="fa-solid fa-network-wired"></i> Diagnostics</div>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" id="ia_ping_llm_btn" class="menu_button" style="flex: 1;"><i class="fa-solid fa-brain"></i> Test LLM</button>
                        <button type="button" id="ia_ping_image_btn" class="menu_button" style="flex: 1;"><i class="fa-solid fa-wand-magic-sparkles"></i> Test ComfyUI</button>
                    </div>
                </div>

                <div class="ia-section">
                    <div class="ia-section-title"><i class="fa-solid fa-sliders"></i> Core Pipeline Settings</div>
                    <div class="ia-row-inline">
                        <label class="checkbox_label" style="cursor: pointer;" title="Master switch: Disables the entire extension.">
                            <input type="checkbox" id="ia_enabled">
                            <span><b>Enable SillyTavern Illustration Agent</b> (Master Toggle)</span>
                        </label>
                        <button type="button" id="ia_open_gallery_btn" class="menu_button" style="padding: 3px 10px;"><i class="fa-solid fa-images"></i> Gallery Window</button>
                    </div>

                    <div class="ia-row">
                        <label for="ia_agent_mode"><b>Agent Operation Mode:</b></label>
                        <select id="ia_agent_mode" class="text_pole">
                            <option value="mode1">Mode 1: Autonomous Evaluator (Analyzes scene/actions automatically)</option>
                            <option value="mode2">Mode 2: Tag-Triggered Only ({image} / {scene})</option>
                            <option value="mode3">Mode 3: Interval-Forced (Triggers every X messages blindly)</option>
                        </select>
                        <small id="ia_mode_hint" style="opacity: 0.7; margin-top: 2px;"></small>
                    </div>
                    
                    <div class="ia-row" id="ia_mode2_instructions" style="display: none; margin-top: 8px; border-left: 2px solid #2ecc71; padding-left: 8px;">
                        <label><b>Mode 2 System Prompt Injection (Editable):</b></label>
                        <small style="opacity: 0.8; display: block; margin-bottom: 4px;">Copy this instruction into your character's System Prompt, Scenario, or Author's Note.</small>
                        <textarea id="ia_mode2_injection" class="text_pole" rows="4" style="font-size: 0.85em; font-family: monospace;"></textarea>
                    </div>

                    <div class="ia-row">
                        <label for="ia_delivery_mode"><b>Roleplay Output Delivery:</b></label>
                        <select id="ia_delivery_mode" class="text_pole">
                            <option value="attached">Append to Assistant Turn (Permanent & In-Context)</option>
                            <option value="separate">Separate Comment Card (Hidden from LLM Context)</option>
                        </select>
                    </div>

                    <div id="ia_interval_row" class="ia-row">
                        <label for="ia_trigger_interval"><b>Trigger Interval (For Mode 3):</b></label>
                        <input type="number" id="ia_trigger_interval" class="text_pole" min="1" max="20" value="3">
                        <small style="opacity: 0.7;">The AI will generate an image every X messages.</small>
                    </div>

                    <div class="ia-row">
                        <label for="ia_lookback"><b>Lookback History (Forced Context Window):</b></label>
                        <input type="number" id="ia_lookback" class="text_pole" min="1" max="10" value="3">
                        <small style="opacity: 0.7;">The agent is strictly sandboxed to read only the last X messages for evaluation.</small>
                    </div>

                    <div class="ia-row">
                        <label for="ia_batch_count"><b>Images per generation (Batch):</b></label>
                        <input type="number" id="ia_batch_count" class="text_pole" min="1" max="4" value="1">
                    </div>

                    <div class="ia-row-inline">
                        <label class="checkbox_label">
                            <input type="checkbox" id="ia_interactive_review">
                            <span>Review & Edit Prompts Before Generating</span>
                        </label>
                    </div>
                </div>

                <div class="ia-section">
                    <div class="ia-section-title"><i class="fa-solid fa-crop-simple"></i> Resolution (W × H)</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div>
                            <label><small>Portrait (Roleplay)</small></label>
                            <div style="display: flex; gap: 4px;">
                                <input type="number" id="ia_res_port_w" class="text_pole" placeholder="832">
                                <input type="number" id="ia_res_port_h" class="text_pole" placeholder="1216">
                            </div>
                        </div>
                        <div>
                            <label><small>Landscape (Roleplay)</small></label>
                            <div style="display: flex; gap: 4px;">
                                <input type="number" id="ia_res_land_w" class="text_pole" placeholder="1216">
                                <input type="number" id="ia_res_land_h" class="text_pole" placeholder="832">
                            </div>
                        </div>
                        <div>
                            <label><small>Square (Roleplay)</small></label>
                            <div style="display: flex; gap: 4px;">
                                <input type="number" id="ia_res_sq_w" class="text_pole" placeholder="1024">
                                <input type="number" id="ia_res_sq_h" class="text_pole" placeholder="1024">
                            </div>
                        </div>
                        <div>
                            <label><small>Background Widescreen</small></label>
                            <div style="display: flex; gap: 4px;">
                                <input type="number" id="ia_res_bg_w" class="text_pole" placeholder="1344">
                                <input type="number" id="ia_res_bg_h" class="text_pole" placeholder="768">
                            </div>
                        </div>
                    </div>
                </div>

                <div class="ia-section">
                    <div class="ia-section-title"><i class="fa-solid fa-wand-magic-sparkles"></i> ComfyUI Workflow & Model Inputs</div>
                    <div class="ia-row">
                        <label><b>Workflow Preset:</b></label>
                        <div class="ia-preset-bar">
                            <select id="ia_workflow_preset_select" class="text_pole"></select>
                            <button type="button" id="ia_wf_preset_save_btn" class="menu_button" title="Save Preset"><i class="fa-solid fa-floppy-disk"></i></button>
                            <button type="button" id="ia_wf_preset_add_btn" class="menu_button" title="Save as New"><i class="fa-solid fa-plus"></i></button>
                            <button type="button" id="ia_wf_preset_del_btn" class="menu_button" title="Delete Preset"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="ia-row">
                        <label><b>ComfyUI Host URL:</b></label>
                        <input type="text" id="ia_comfy_url" class="text_pole" placeholder="http://127.0.0.1:8188">
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
                        <div>
                            <label><small>Model (%model%)</small></label>
                            <input type="text" id="ia_comfy_model" class="text_pole">
                        </div>
                        <div>
                            <label><small>CLIP / GGUF (%clip%)</small></label>
                            <input type="text" id="ia_comfy_clip" class="text_pole">
                        </div>
                        <div>
                            <label><small>VAE (%vae%)</small></label>
                            <input type="text" id="ia_comfy_vae" class="text_pole">
                        </div>
                        <div>
                            <label><small>Steps (%steps%)</small></label>
                            <input type="number" id="ia_comfy_steps" class="text_pole" value="20">
                        </div>
                        <div>
                            <label><small>CFG Scale (%cfg%)</small></label>
                            <input type="number" step="0.1" id="ia_comfy_cfg" class="text_pole" value="4.5">
                        </div>
                        <div>
                            <label><small>Sampler (%sampler%)</small></label>
                            <input type="text" id="ia_comfy_sampler" class="text_pole" value="euler_ancestral">
                        </div>
                        <div>
                            <label><small>Scheduler (%scheduler%)</small></label>
                            <input type="text" id="ia_comfy_scheduler" class="text_pole" value="normal">
                        </div>
                    </div>
                    <div class="ia-row">
                        <label><b>ComfyUI API Workflow (JSON):</b></label>
                        <textarea id="ia_comfy_workflow" class="text_pole" rows="8" style="font-family: monospace; font-size: 0.8em;"></textarea>
                    </div>
                    <label style="font-size: 0.8em; opacity: 0.8;"><b>Workflow Macro Status:</b></label>
                    <div id="ia_workflow_macro_badges" class="ia-macro-container"></div>
                </div>

                <div class="ia-section">
                    <div class="ia-section-title"><i class="fa-solid fa-file-code"></i> Agent Instructions & Schema Presets</div>
                    <div class="ia-row">
                        <label><b>Schema Preset:</b></label>
                        <div class="ia-preset-bar">
                            <select id="ia_schema_preset_select" class="text_pole"></select>
                            <button type="button" id="ia_schema_preset_save_btn" class="menu_button" title="Save Preset"><i class="fa-solid fa-floppy-disk"></i></button>
                            <button type="button" id="ia_schema_preset_add_btn" class="menu_button" title="Save as New"><i class="fa-solid fa-plus"></i></button>
                            <button type="button" id="ia_schema_preset_del_btn" class="menu_button" title="Delete Preset"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="ia-row">
                        <label><b>Style Prefix:</b></label>
                        <input type="text" id="ia_style_prefix" class="text_pole">
                    </div>
                    <div class="ia-row">
                        <label><b>Default Negative Prompt:</b></label>
                        <input type="text" id="ia_default_negative" class="text_pole">
                    </div>
                    <div class="ia-row">
                        <label><b>Active Instructions & Schema:</b></label>
                        <textarea id="ia_schema_editor" class="text_pole" rows="11" style="font-family: monospace; font-size: 0.8em;"></textarea>
                    </div>
                    <label style="font-size: 0.8em; opacity: 0.8;"><b>Schema Token Validation:</b></label>
                    <div id="ia_schema_macro_badges" class="ia-macro-container"></div>
                </div>

                <div class="ia-section">
                    <div class="ia-section-title"><i class="fa-solid fa-brain"></i> Agent Evaluator LLM</div>
                    <div class="ia-row">
                        <label for="ia_llm_provider"><b>Evaluator Source:</b></label>
                        <select id="ia_llm_provider" class="text_pole">
                            <option value="current">Current Chat LLM (Quiet Background Prompt)</option>
                            <option value="custom">Custom API (OpenAI / Claude Proxy / BananaPro)</option>
                        </select>
                    </div>
                    <div id="ia_custom_llm_fields" style="display: none;">
                        <div class="ia-row">
                            <label><b>API Base URL:</b></label>
                            <input type="text" id="ia_custom_llm_url" class="text_pole" placeholder="https://api.openai.com/v1">
                        </div>
                        <div class="ia-row">
                            <label><b>API Key:</b></label>
                            <input type="password" id="ia_custom_llm_key" class="text_pole">
                        </div>
                        <div class="ia-row">
                            <label><b>Model:</b></label>
                            <input type="text" id="ia_custom_llm_model" class="text_pole" placeholder="gpt-4o-mini">
                        </div>
                    </div>
                </div>

                <button type="button" id="ia_manual_eval_btn" class="menu_button" style="width: 100%; margin-top: 6px;">
                    <i class="fa-solid fa-bolt"></i> Evaluate & Illustrate Scene Now
                </button>
            </div>
        </div>
    </div>
    `;

    const container = $('#extensions_settings').length ? $('#extensions_settings') : $('#extensions_settings2');
    container.append(settingsHtml);

    if ($('#ia_gallery_bubble').length === 0) {
        const bodyFloatingHtml = `
        <div id="ia_gallery_bubble" title="Drag anywhere or tap to open gallery">
            <i id="ia_bubble_icon" class="fa-solid fa-camera-retro"></i>
            <div id="ia_gallery_bubble_badge">0</div>
        </div>

        <div id="ia_review_modal" style="display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 500px; max-width: 90vw; background: var(--SmartThemeBlurTintColor, #202028); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 10px; z-index: 100000; padding: 16px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.85);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <b><i class="fa-solid fa-pen-to-square"></i> Review Scene Illustration</b>
                <div id="ia_close_review" style="cursor: pointer;"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <div class="ia-row">
                <label><b>Narrative Description:</b></label>
                <textarea id="ia_rev_desc" class="text_pole" rows="2"></textarea>
            </div>
            <div class="ia-row">
                <label><b>Positive Prompt (Image Generator):</b></label>
                <textarea id="ia_rev_positive" class="text_pole" rows="3"></textarea>
            </div>
            <div class="ia-row">
                <label><b>Negative Prompt:</b></label>
                <textarea id="ia_rev_negative" class="text_pole" rows="2"></textarea>
            </div>
            <div class="ia-row">
                <label><b>Aspect Ratio:</b></label>
                <select id="ia_rev_ar" class="text_pole">
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                    <option value="square">Square</option>
                </select>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
                <button type="button" id="ia_rev_cancel" class="menu_button">Cancel</button>
                <button type="button" id="ia_rev_confirm" class="menu_button" style="background: #27ae60; color: white;">Generate Now</button>
            </div>
        </div>

        <div id="ia_batch_picker_modal" style="display: none;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 8px;">
                <b><i class="fa-solid fa-images"></i> Choose Image for Roleplay</b>
                <div id="ia_close_batch_picker" style="cursor: pointer;"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <div id="ia_batch_grid" class="ia-batch-grid"></div>
        </div>

        <div id="ia_gallery_modal" style="display: none;">
            <div class="ia-gallery-header">
                <b><i class="fa-solid fa-images" style="color: #ff7675; margin-right: 6px;"></i>Illustration Gallery</b>
                <div class="ia-gallery-controls">
                    <label class="checkbox_label" style="font-size: 0.85em; margin-right: 6px;">
                        <input type="checkbox" id="ia_gallery_flat_toggle">
                        <span>Flat View</span>
                    </label>
                    <button type="button" id="ia_win_min_btn" class="ia-win-btn" title="Minimize to Bubble"><i class="fa-solid fa-minus"></i></button>
                    <button type="button" id="ia_win_close_btn" class="ia-win-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
            <div class="ia-gallery-body">
                <div id="ia_gallery_nav" class="ia-gallery-sidebar"></div>
                <div id="ia_gallery_content" class="ia-gallery-grid"></div>
            </div>
        </div>
        
        <!-- Lightbox Enlarge Modal -->
        <div id="ia_lightbox_modal" style="display: none;">
            <div class="ia-lightbox-header">
                <b id="ia_lightbox_title">Image View</b>
                <div id="ia_close_lightbox" style="cursor: pointer; padding: 4px 10px;"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <div class="ia-lightbox-content">
                <img id="ia_lightbox_img" src="" />
            </div>
            <div class="ia-lightbox-footer">
                <div id="ia_lightbox_desc" class="ia-lightbox-desc"></div>
                <div class="ia-lightbox-actions">
                    <button type="button" id="ia_lb_fav_btn" class="menu_button"><i class="fa-regular fa-heart"></i> Favorite</button>
                    <button type="button" id="ia_lb_show_btn" class="menu_button" style="background: #3498db; color: white;"><i class="fa-solid fa-hand-sparkles"></i> Show to Character</button>
                    <button type="button" id="ia_lb_dl_btn" class="menu_button" style="background: #2ecc71; color: white;"><i class="fa-solid fa-download"></i> Save</button>
                </div>
            </div>
        </div>
        `;
        $('body').append(bodyFloatingHtml);
    }

    bindSettingsEvents();
    setupAndroidBubble();
    updateMacroBadges();
}

function updateModeHint(mode) {
    const hints = {
        mode1: 'Evaluates recent turns for photo actions, physical shifts, and background transitions. Can output multiple images simultaneously.',
        mode2: 'Trigger-word driven: fires ONLY if {image} (selfies/devices) or {scene} (action without background) are present.',
        mode3: 'Bypasses the thinking step: unconditionally generates image prompts every X assistant messages.'
    };
    $('#ia_mode_hint').text(hints[mode] || '');
    
    if (mode === 'mode2') {
        $('#ia_mode2_instructions').slideDown(150);
    } else {
        $('#ia_mode2_instructions').slideUp(150);
    }
}

function bindSettingsEvents() {
    const s = getSettings();
    $('#ia_drawer_content').on('click', (e) => e.stopPropagation());

    refreshPresetDropdowns();

    $('#ia_enabled').prop('checked', !!s.enabled).on('change', function () { s.enabled = $(this).is(':checked'); saveSettings(); });
    
    $('#ia_agent_mode').val(s.agentMode || 'mode1').on('change', function () {
        s.agentMode = $(this).val();
        updateModeHint(s.agentMode);
        if (s.agentMode === 'mode1' && s.schemaPresets['Mode 1: Full Autonomous (Doublesub)']) {
            switchSchemaPreset('Mode 1: Full Autonomous (Doublesub)');
        } else if (s.agentMode === 'mode2' && s.schemaPresets['Mode 2: Tag Triggered ({image} & {scene})']) {
            switchSchemaPreset('Mode 2: Tag Triggered ({image} & {scene})');
        } else if (s.agentMode === 'mode3' && s.schemaPresets['Mode 3: Direct Prompt Generator']) {
            switchSchemaPreset('Mode 3: Direct Prompt Generator');
        }
        saveSettings();
    });
    updateModeHint(s.agentMode || 'mode1');

    $('#ia_mode2_injection').val(s.mode2InjectionText).on('input', function() { s.mode2InjectionText = $(this).val(); saveSettings(); });
    $('#ia_delivery_mode').val(s.deliveryMode || 'attached').on('change', function () { s.deliveryMode = $(this).val(); saveSettings(); });
    $('#ia_trigger_interval').val(s.triggerInterval || 3).on('change', function () { s.triggerInterval = Math.max(1, parseInt($(this).val()) || 3); saveSettings(); });
    $('#ia_pipeline_phase').val(s.pipelinePhase).on('change', function () { s.pipelinePhase = $(this).val(); saveSettings(); });
    $('#ia_interactive_review').prop('checked', !!s.interactiveReview).on('change', function () { s.interactiveReview = $(this).is(':checked'); saveSettings(); });
    $('#ia_batch_count').val(s.batchCount).on('change', function () { s.batchCount = Math.max(1, parseInt($(this).val()) || 1); saveSettings(); });
    $('#ia_lookback').val(s.lookback).on('change', function () { s.lookback = Math.max(1, parseInt($(this).val()) || 3); saveSettings(); });

    $('#ia_style_prefix').val(s.stylePrefix).on('input', function () { s.stylePrefix = $(this).val(); saveSettings(); });
    $('#ia_default_negative').val(s.defaultNegative).on('input', function () { s.defaultNegative = $(this).val(); saveSettings(); });

    $('#ia_schema_editor').val(s.activeSchemaText).on('input', function () { s.activeSchemaText = $(this).val(); updateMacroBadges(); saveSettings(); });

    $('#ia_res_port_w').val(s.resPortraitW).on('change', function () { s.resPortraitW = parseInt($(this).val()) || 832; saveSettings(); });
    $('#ia_res_port_h').val(s.resPortraitH).on('change', function () { s.resPortraitH = parseInt($(this).val()) || 1216; saveSettings(); });
    $('#ia_res_land_w').val(s.resLandscapeW).on('change', function () { s.resLandscapeW = parseInt($(this).val()) || 1216; saveSettings(); });
    $('#ia_res_land_h').val(s.resLandscapeH).on('change', function () { s.resLandscapeH = parseInt($(this).val()) || 832; saveSettings(); });
    $('#ia_res_sq_w').val(s.resSquareW).on('change', function () { s.resSquareW = parseInt($(this).val()) || 1024; saveSettings(); });
    $('#ia_res_sq_h').val(s.resSquareH).on('change', function () { s.resSquareH = parseInt($(this).val()) || 1024; saveSettings(); });
    $('#ia_res_bg_w').val(s.resBgW).on('change', function () { s.resBgW = parseInt($(this).val()) || 1344; saveSettings(); });
    $('#ia_res_bg_h').val(s.resBgH).on('change', function () { s.resBgH = parseInt($(this).val()) || 768; saveSettings(); });

    $('#ia_comfy_model').val(s.comfyModel).on('input', function () { s.comfyModel = $(this).val(); saveSettings(); });
    $('#ia_comfy_clip').val(s.comfyClip).on('input', function () { s.comfyClip = $(this).val(); saveSettings(); });
    $('#ia_comfy_vae').val(s.comfyVae).on('input', function () { s.comfyVae = $(this).val(); saveSettings(); });

    $('#ia_comfy_steps').val(s.comfySteps).on('change', function () { s.comfySteps = parseInt($(this).val()) || 20; saveSettings(); });
    $('#ia_comfy_cfg').val(s.comfyCfg).on('change', function () { s.comfyCfg = parseFloat($(this).val()) || 4.5; saveSettings(); });
    $('#ia_comfy_sampler').val(s.comfySampler).on('input', function () { s.comfySampler = $(this).val(); saveSettings(); });
    $('#ia_comfy_scheduler').val(s.comfyScheduler).on('input', function () { s.comfyScheduler = $(this).val(); saveSettings(); });
    $('#ia_comfy_url').val(s.comfyUrl).on('input', function () { s.comfyUrl = $(this).val(); saveSettings(); });

    $('#ia_comfy_workflow').val(s.activeWorkflowText).on('input', function () { s.activeWorkflowText = $(this).val(); updateMacroBadges(); saveSettings(); });

    $('#ia_llm_provider').val(s.llmProvider).on('change', function () {
        s.llmProvider = $(this).val();
        $('#ia_custom_llm_fields').toggle(s.llmProvider === 'custom');
        saveSettings();
    });
    $('#ia_custom_llm_url').val(s.customLlmUrl).on('input', function () { s.customLlmUrl = $(this).val(); saveSettings(); });
    $('#ia_custom_llm_key').val(s.customLlmKey).on('input', function () { s.customLlmKey = $(this).val(); saveSettings(); });
    $('#ia_custom_llm_model').val(s.customLlmModel).on('input', function () { s.customLlmModel = $(this).val(); saveSettings(); });

    $('#ia_manual_eval_btn').on('click', () => runEvaluation(true));
    $('#ia_open_gallery_btn').on('click', openGallery);
    $('#ia_win_min_btn').on('click', () => { $('#ia_gallery_modal').fadeOut(150); $('#ia_gallery_bubble').fadeIn(200); });
    $('#ia_win_close_btn').on('click', () => { $('#ia_gallery_modal').fadeOut(150); });
    $('#ia_close_review, #ia_rev_cancel').on('click', () => $('#ia_review_modal').fadeOut(150));
    $('#ia_close_batch_picker').on('click', () => $('#ia_batch_picker_modal').fadeOut(150));
    $('#ia_close_lightbox').on('click', () => $('#ia_lightbox_modal').fadeOut(150));
    $('#ia_gallery_flat_toggle').on('change', () => renderGalleryContent());

    // Diagnostic Handlers
    $('#ia_ping_llm_btn').on('click', async () => {
        toastr.info('Pinging LLM...', 'Diagnostics');
        const t0 = performance.now();
        try {
            const r = await queryAgentLLM('Reply with the word READY');
            const ms = Math.round(performance.now() - t0);
            toastr.success(`LLM is online! (${ms}ms) Response: ${r.slice(0, 30)}`, 'Diagnostics');
        } catch (e) {
            toastr.error(`LLM Connection Failed: ${e.message}`, 'Diagnostics');
        }
    });

    $('#ia_ping_image_btn').on('click', async () => {
        const baseUrl = getEffectiveComfyUrl();
        toastr.info('Pinging ComfyUI...', 'Diagnostics');
        const t0 = performance.now();
        try {
            const res = await fetch(`${baseUrl}/system_stats`);
            const ms = Math.round(performance.now() - t0);
            if (res.ok) {
                toastr.success(`ComfyUI Online at ${baseUrl} (${ms}ms)`, 'Diagnostics');
            } else {
                throw new Error(`HTTP ${res.status}`);
            }
        } catch (e) {
            toastr.error(`ComfyUI Unreachable at ${baseUrl}: ${e.message}`, 'Diagnostics');
        }
    });

    // Preset Handlers
    $('#ia_schema_preset_select').on('change', function () { switchSchemaPreset($(this).val()); });
    $('#ia_schema_preset_save_btn').on('click', () => saveCurrentSchemaPreset());
    $('#ia_schema_preset_add_btn').on('click', () => addNewSchemaPreset());
    $('#ia_schema_preset_del_btn').on('click', () => deleteCurrentSchemaPreset());
    $('#ia_workflow_preset_select').on('change', function () { switchWorkflowPreset($(this).val()); });
    $('#ia_wf_preset_save_btn').on('click', () => saveCurrentWorkflowPreset());
    $('#ia_wf_preset_add_btn').on('click', () => addNewWorkflowPreset());
    $('#ia_wf_preset_del_btn').on('click', () => deleteCurrentWorkflowPreset());
}

function refreshPresetDropdowns() {
    const s = getSettings();
    const $sSel = $('#ia_schema_preset_select').empty();
    Object.keys(s.schemaPresets).forEach(name => {
        $sSel.append(`<option value="${name}">${name}</option>`);
    });
    $sSel.val(s.selectedSchemaPreset);

    const $wSel = $('#ia_workflow_preset_select').empty();
    Object.keys(s.workflowPresets).forEach(name => {
        $wSel.append(`<option value="${name}">${name}</option>`);
    });
    $wSel.val(s.selectedWorkflowPreset);
}

function switchSchemaPreset(name) {
    const s = getSettings();
    if (s.schemaPresets[name]) {
        s.selectedSchemaPreset = name;
        s.activeSchemaText = s.schemaPresets[name];
        $('#ia_schema_editor').val(s.activeSchemaText);
        $('#ia_schema_preset_select').val(name);
        updateMacroBadges();
        saveSettings();
        toastr.info(`Loaded schema: ${name}`, 'Presets');
    }
}

function saveCurrentSchemaPreset() {
    const s = getSettings();
    const name = s.selectedSchemaPreset;
    s.schemaPresets[name] = $('#ia_schema_editor').val();
    s.activeSchemaText = s.schemaPresets[name];
    saveSettings();
    toastr.success(`Saved schema preset "${name}"`, 'Presets');
}

function addNewSchemaPreset() {
    const name = prompt('Enter a name for the new Schema Preset:');
    if (!name) return;
    const s = getSettings();
    s.schemaPresets[name] = $('#ia_schema_editor').val();
    s.selectedSchemaPreset = name;
    s.activeSchemaText = s.schemaPresets[name];
    refreshPresetDropdowns();
    saveSettings();
    toastr.success(`Created schema preset "${name}"`, 'Presets');
}

function deleteCurrentSchemaPreset() {
    const s = getSettings();
    const name = s.selectedSchemaPreset;
    if (name.startsWith('Mode ')) {
        toastr.warning('Cannot delete built-in factory presets.', 'Presets');
        return;
    }
    if (confirm(`Delete schema preset "${name}"?`)) {
        delete s.schemaPresets[name];
        s.selectedSchemaPreset = Object.keys(s.schemaPresets)[0];
        s.activeSchemaText = s.schemaPresets[s.selectedSchemaPreset];
        $('#ia_schema_editor').val(s.activeSchemaText);
        refreshPresetDropdowns();
        saveSettings();
        toastr.info(`Deleted preset "${name}"`, 'Presets');
    }
}

function switchWorkflowPreset(name) {
    const s = getSettings();
    if (s.workflowPresets[name]) {
        s.selectedWorkflowPreset = name;
        s.activeWorkflowText = s.workflowPresets[name];
        $('#ia_comfy_workflow').val(s.activeWorkflowText);
        $('#ia_workflow_preset_select').val(name);
        updateMacroBadges();
        saveSettings();
        toastr.info(`Loaded workflow: ${name}`, 'Presets');
    }
}

function saveCurrentWorkflowPreset() {
    const s = getSettings();
    const name = s.selectedWorkflowPreset;
    s.workflowPresets[name] = $('#ia_comfy_workflow').val();
    s.activeWorkflowText = s.workflowPresets[name];
    saveSettings();
    toastr.success(`Saved workflow preset "${name}"`, 'Presets');
}

function addNewWorkflowPreset() {
    const name = prompt('Enter a name for the new Workflow Preset:');
    if (!name) return;
    const s = getSettings();
    s.workflowPresets[name] = $('#ia_comfy_workflow').val();
    s.selectedWorkflowPreset = name;
    s.activeWorkflowText = s.workflowPresets[name];
    refreshPresetDropdowns();
    saveSettings();
    toastr.success(`Created workflow preset "${name}"`, 'Presets');
}

function deleteCurrentWorkflowPreset() {
    const s = getSettings();
    const name = s.selectedWorkflowPreset;
    if (name.startsWith('Default')) {
        toastr.warning('Cannot delete built-in factory workflow.', 'Presets');
        return;
    }
    if (confirm(`Delete workflow preset "${name}"?`)) {
        delete s.workflowPresets[name];
        s.selectedWorkflowPreset = Object.keys(s.workflowPresets)[0];
        s.activeWorkflowText = s.workflowPresets[s.selectedWorkflowPreset];
        $('#ia_comfy_workflow').val(s.activeWorkflowText);
        refreshPresetDropdowns();
        saveSettings();
        toastr.info(`Deleted preset "${name}"`, 'Presets');
    }
}

function setupAndroidBubble() {
    const $bubble = $('#ia_gallery_bubble');
    let isDragging = false, startX, startY, initLeft, initTop, threshold = false;

    $bubble.off('touchstart mousedown').on('touchstart mousedown', function (e) {
        const evt = e.touches ? e.touches[0] : e;
        isDragging = true;
        threshold = false;
        startX = evt.clientX;
        startY = evt.clientY;
        const rect = $bubble[0].getBoundingClientRect();
        initLeft = rect.left;
        initTop = rect.top;
        $bubble.css({ transition: 'none' });
    });

    $(document).off('touchmove mousemove.iabubble').on('touchmove mousemove.iabubble', function (e) {
        if (!isDragging) return;
        const evt = e.touches ? e.touches[0] : e;
        const dx = evt.clientX - startX;
        const dy = evt.clientY - startY;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) threshold = true;
        if (threshold) {
            const nx = Math.max(8, Math.min(window.innerWidth - 60, initLeft + dx));
            const ny = Math.max(8, Math.min(window.innerHeight - 60, initTop + dy));
            $bubble.css({ left: nx + 'px', top: ny + 'px', right: 'auto', bottom: 'auto' });
        }
    });

    $(document).off('touchend mouseup.iabubble').on('touchend mouseup.iabubble', function () {
        if (!isDragging) return;
        isDragging = false;
        if (threshold) {
            const rect = $bubble[0].getBoundingClientRect();
            const targetX = (rect.left + 26 < window.innerWidth / 2) ? 12 : (window.innerWidth - 64);
            $bubble.css({ transition: 'all 0.25s cubic-bezier(0.25, 1, 0.5, 1)', left: targetX + 'px' });
            setTimeout(() => $bubble.css({ transition: 'none' }), 250);
        } else {
            openGallery();
        }
    });
}

function openGallery() {
    $('#ia_gallery_bubble').fadeOut(150);
    renderGalleryNav();
    renderGalleryContent();
    $('#ia_gallery_modal').fadeIn(200);
}

function toggleFavorite(id) {
    const s = getSettings();
    const item = s.gallery.find(r => r.id === id);
    if (item) {
        item.favorite = !item.favorite;
        saveSettings();
        renderGalleryContent(window._iaLastFilterChar, window._iaLastFilterType);
    }
}

async function downloadImageLocal(url, filename) {
    try {
        toastr.info('Downloading image...', 'Doublesub');
        const response = await fetch(url);
        const blob = await response.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename || 'illustration.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    } catch (e) {
        toastr.error('Failed to download image', 'Doublesub');
    }
}

function openLightbox(record) {
    const displayUrl = record.url && record.url.startsWith('ia_bg_') ? `/backgrounds/${record.url}` : (record.url || record.cleanUrl);
    
    $('#ia_lightbox_img').attr('src', displayUrl);
    $('#ia_lightbox_title').text(record.character || 'Illustration');
    $('#ia_lightbox_desc').text(record.description || record.reason || 'No description provided.');
    
    const $favBtn = $('#ia_lb_fav_btn');
    $favBtn.html(record.favorite ? '<i class="fa-solid fa-heart" style="color:#e74c3c;"></i> Favorited' : '<i class="fa-regular fa-heart"></i> Favorite');
    $favBtn.off('click').on('click', () => {
        toggleFavorite(record.id);
        $favBtn.html(record.favorite ? '<i class="fa-solid fa-heart" style="color:#e74c3c;"></i> Favorited' : '<i class="fa-regular fa-heart"></i> Favorite');
    });

    $('#ia_lb_dl_btn').off('click').on('click', () => {
        const dName = record.type === 'background' ? `bg_${record.date}.png` : `illustration_${record.character}_${record.date}.png`;
        downloadImageLocal(displayUrl, dName);
    });

    $('#ia_lb_show_btn').off('click').on('click', async () => {
        $('#ia_lightbox_modal').fadeOut(150);
        $('#ia_gallery_modal').fadeOut(150);
        await showImageToCharacter(record.url, record.description);
    });

    $('#ia_lightbox_modal').fadeIn(200);
}

function renderGalleryNav() {
    const $nav = $('#ia_gallery_nav').empty();
    const db = getGalleryDb();
    const chars = [...new Set(db.map(x => x.character))];

    $nav.append(`<div class="ia-section-title" style="padding: 4px 6px;">Filters</div>`);
    $nav.append(`
        <div class="ia-nav-filter" data-filter="all" style="padding: 6px; cursor: pointer; border-radius: 4px; margin-bottom: 2px;">
            <i class="fa-solid fa-layer-group"></i> All Media
        </div>
        <div class="ia-nav-filter" data-filter="favorites" style="padding: 6px; cursor: pointer; border-radius: 4px; margin-bottom: 2px;">
            <i class="fa-solid fa-heart" style="color:#e74c3c;"></i> Favorites
        </div>
        <div class="ia-nav-filter" data-filter="background" style="padding: 6px; cursor: pointer; border-radius: 4px; margin-bottom: 2px;">
            <i class="fa-solid fa-mountain-sun"></i> Backgrounds
        </div>
    `);

    $nav.append(`<div class="ia-section-title" style="padding: 4px 6px; margin-top: 10px;">Characters</div>`);
    chars.forEach(c => {
        $nav.append(`<div class="ia-nav-char" data-char="${c}" style="padding: 6px; cursor: pointer; border-radius: 4px; margin-bottom: 2px;"><i class="fa-solid fa-user"></i> ${c}</div>`);
    });

    $('.ia-nav-filter, .ia-nav-char').off('click').on('click', function () {
        $('.ia-nav-filter, .ia-nav-char').css('background', 'transparent');
        $(this).css('background', 'rgba(255, 255, 255, 0.15)');
        
        let type = $(this).data('filter');
        let char = $(this).data('char');
        renderGalleryContent(char, type);
    });
}

function renderGalleryContent(filterChar = null, filterType = null) {
    window._iaLastFilterChar = filterChar;
    window._iaLastFilterType = filterType;

    const $grid = $('#ia_gallery_content').empty();
    const isFlat = $('#ia_gallery_flat_toggle').is(':checked');
    let records = [...getGalleryDb()];

    if (!isFlat) {
        if (filterChar) records = records.filter(r => r.character === filterChar);
        if (filterType === 'background') records = records.filter(r => r.type === 'background');
        if (filterType === 'favorites') records = records.filter(r => r.favorite);
    }

    if (records.length === 0) {
        $grid.append(`<div style="opacity: 0.6; padding: 20px; grid-column: 1 / -1; text-align: center;">No media found.</div>`);
        return;
    }

    records.forEach(r => {
        const displayUrl = r.url && r.url.startsWith('ia_bg_') ? `/backgrounds/${r.url}` : (r.url || r.cleanUrl);
        const imageMarkup = displayUrl ? `<img src="${displayUrl}" loading="lazy" class="ia-clickable-img" />` : `<div style="background: #111; height: 160px; display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-image"></i></div>`;
        const tagBadge = r.type === 'background' ? `<span style="background: #e67e22; color: #fff; padding: 2px 5px; border-radius: 3px; font-size: 0.72em;">BG</span>` : `<span style="background: #3498db; color: #fff; padding: 2px 5px; border-radius: 3px; font-size: 0.72em;">Photo</span>`;
        const heartClass = r.favorite ? "fa-solid fa-heart" : "fa-regular fa-heart";

        const $card = $(`
            <div class="ia-card">
                <div style="position:relative; width:100%;">
                    ${imageMarkup}
                    <div class="ia-card-fav-btn" title="Toggle Favorite"><i class="${heartClass}"></i></div>
                </div>
                <div class="ia-card-meta">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <b style="font-size: 0.88em;">${r.character}</b>
                        ${tagBadge}
                    </div>
                    <div class="ia-desc-text" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${r.description || r.reason || 'No description'}</div>
                    <div class="ia-card-actions">
                        ${r.type === 'background'
                            ? `<button type="button" class="ia-card-btn ia-set-bg-btn"><i class="fa-solid fa-mountain-sun"></i> Set BG</button>`
                            : `<button type="button" class="ia-card-btn ia-insert-roleplay-btn"><i class="fa-solid fa-comment-medical"></i> Insert</button>`}
                        <button type="button" class="ia-card-btn ia-expand-btn"><i class="fa-solid fa-expand"></i> View</button>
                    </div>
                </div>
            </div>
        `);

        $card.find('.ia-clickable-img, .ia-expand-btn').on('click', () => openLightbox(r));
        
        $card.find('.ia-card-fav-btn').on('click', (e) => {
            e.stopPropagation();
            toggleFavorite(r.id);
        });

        $card.find('.ia-set-bg-btn').on('click', async (e) => {
            e.stopPropagation();
            if (r.url) {
                await SillyTavern.getContext().executeSlashCommands(`/bg ${r.url}`);
                toastr.success(`Set wallpaper: ${r.location || 'Scene'}`, 'Doublesub');
            }
        });

        $card.find('.ia-insert-roleplay-btn').on('click', async (e) => {
            e.stopPropagation();
            await deliverRoleplayImage(r.url, r.description);
            $('#ia_gallery_modal').fadeOut(150);
            $('#ia_gallery_bubble').fadeIn(200);
        });

        $grid.append($card);
    });
}