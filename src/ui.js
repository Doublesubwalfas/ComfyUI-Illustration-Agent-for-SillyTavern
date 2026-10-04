import { getSettings, saveSettings, getGalleryDb } from './config.js';
import { getEffectiveComfyUrl } from './comfy.js';
import { queryAgentLLM, runEvaluation } from './agent.js';
import { deliverRoleplayImage } from './chat.js';

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

export function setupUI() {
    if ($('#ia_main_container').length > 0) return;

    // 1. Settings Drawer HTML
    const settingsHtml = `
    <div id="ia_main_container" class="illustration-agent-settings" style="margin-bottom: 12px;">
        <div class="inline-drawer">
            <div id="ia_drawer_toggle" class="inline-drawer-toggle inline-drawer-header" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
                <b><i class="fa-solid fa-palette" style="margin-right: 6px; color: #ff7675;"></i>Marinara Illustration Agent</b>
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
                        <label class="checkbox_label" style="cursor: pointer;">
                            <input type="checkbox" id="ia_enabled">
                            <span><b>Enable Autonomous Illustrator</b></span>
                        </label>
                        <button type="button" id="ia_open_gallery_btn" class="menu_button" style="padding: 3px 10px;"><i class="fa-solid fa-images"></i> Gallery Window</button>
                    </div>

                    <div class="ia-row">
                        <label for="ia_delivery_mode"><b>Roleplay Output Delivery:</b></label>
                        <select id="ia_delivery_mode" class="text_pole">
                            <option value="attached">Append to Assistant Turn (Permanent & In-Context)</option>
                            <option value="separate">Separate Comment Card (Hidden from LLM Context)</option>
                        </select>
                        <small style="opacity: 0.7;">Attached mode saves image into chat swipes; Separate mode uses /comment to exclude from prompt.</small>
                    </div>

                    <div class="ia-row">
                        <label for="ia_trigger_mode"><b>Evaluation Frequency:</b></label>
                        <select id="ia_trigger_mode" class="text_pole">
                            <option value="every">Evaluate Every Assistant Message</option>
                            <option value="interval">Evaluate Once Every X Messages</option>
                        </select>
                    </div>

                    <div id="ia_interval_row" class="ia-row" style="display: none;">
                        <label for="ia_trigger_interval"><b>Message Interval (X turns):</b></label>
                        <input type="number" id="ia_trigger_interval" class="text_pole" min="2" max="20" value="3">
                    </div>

                    <div class="ia-row">
                        <label for="ia_pipeline_phase"><b>Pipeline Phase:</b></label>
                        <select id="ia_pipeline_phase" class="text_pole">
                            <option value="post">Post-Processing (After Turn - Default)</option>
                            <option value="parallel">Parallel (Simultaneous)</option>
                            <option value="pre">Pre-Generation</option>
                        </select>
                    </div>

                    <div class="ia-row-inline">
                        <label class="checkbox_label">
                            <input type="checkbox" id="ia_interactive_review">
                            <span>Review & Edit Prompts Before Generating</span>
                        </label>
                    </div>

                    <div class="ia-row">
                        <label for="ia_batch_count"><b>Images per generation (Batch):</b></label>
                        <input type="number" id="ia_batch_count" class="text_pole" min="1" max="4" value="1">
                    </div>

                    <div class="ia-row">
                        <label for="ia_lookback"><b>Lookback History (Messages):</b></label>
                        <input type="number" id="ia_lookback" class="text_pole" min="1" max="10" value="3">
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

                <div class="ia-section">
                    <div class="ia-section-title"><i class="fa-solid fa-wand-magic-sparkles"></i> Image Generation Backend</div>
                    <div class="ia-row">
                        <label for="ia_img_backend"><b>Generator Engine:</b></label>
                        <select id="ia_img_backend" class="text_pole">
                            <option value="comfyui_direct">ComfyUI Direct (Editable Workflow JSON)</option>
                            <option value="sillytavern">SillyTavern Native (Uses /imagine & Active Config)</option>
                        </select>
                    </div>

                    <div id="ia_comfy_fields">
                        <div class="ia-row">
                            <label><b>ComfyUI Host URL:</b></label>
                            <input type="text" id="ia_comfy_url" class="text_pole" placeholder="http://127.0.0.1:8188">
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
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
                        <div id="ia_macro_detector" style="margin-top: 4px;"></div>
                    </div>
                </div>

                <div class="ia-section">
                    <div class="ia-section-title"><i class="fa-solid fa-file-code"></i> Unified Agent System Prompt</div>
                    <div class="ia-row">
                        <label><b>Style Prefix:</b></label>
                        <input type="text" id="ia_style_prefix" class="text_pole">
                    </div>
                    <div class="ia-row">
                        <label><b>Default Negative Prompt:</b></label>
                        <input type="text" id="ia_default_negative" class="text_pole">
                    </div>
                    <div class="ia-row">
                        <label><b>Agent Instructions & Schema:</b></label>
                        <textarea id="ia_unified_prompt" class="text_pole" rows="12" style="font-family: monospace; font-size: 0.8em;"></textarea>
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

    // 2. Body-Mounted Modals & Android Bubble
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
                <label><b>Narrative Description (Perceived by Character LLM):</b></label>
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
            <small style="opacity: 0.8; margin-top: 6px;">Tap the variation you want inserted into the chat. All candidates are saved in the gallery.</small>
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
        `;
        $('body').append(bodyFloatingHtml);
    }

    bindSettingsEvents();
    setupAndroidBubble();
}

function bindSettingsEvents() {
    const s = getSettings();
    $('#ia_drawer_content').on('click', (e) => e.stopPropagation());

    $('#ia_enabled').prop('checked', !!s.enabled).on('change', function () { s.enabled = $(this).is(':checked'); saveSettings(); });
    $('#ia_delivery_mode').val(s.deliveryMode || 'attached').on('change', function () { s.deliveryMode = $(this).val(); saveSettings(); });
    $('#ia_trigger_mode').val(s.triggerMode || 'every').on('change', function () {
        s.triggerMode = $(this).val();
        $('#ia_interval_row').toggle(s.triggerMode === 'interval');
        saveSettings();
    });
    $('#ia_trigger_interval').val(s.triggerInterval || 3).on('change', function () { s.triggerInterval = Math.max(2, parseInt($(this).val()) || 3); saveSettings(); });
    $('#ia_pipeline_phase').val(s.pipelinePhase).on('change', function () { s.pipelinePhase = $(this).val(); saveSettings(); });
    $('#ia_interactive_review').prop('checked', !!s.interactiveReview).on('change', function () { s.interactiveReview = $(this).is(':checked'); saveSettings(); });
    $('#ia_batch_count').val(s.batchCount).on('change', function () { s.batchCount = Math.max(1, parseInt($(this).val()) || 1); saveSettings(); });
    $('#ia_lookback').val(s.lookback).on('change', function () { s.lookback = Math.max(1, parseInt($(this).val()) || 3); saveSettings(); });
    $('#ia_style_prefix').val(s.stylePrefix).on('input', function () { s.stylePrefix = $(this).val(); saveSettings(); });
    $('#ia_default_negative').val(s.defaultNegative).on('input', function () { s.defaultNegative = $(this).val(); saveSettings(); });
    $('#ia_unified_prompt').val(s.unifiedPrompt).on('input', function () { s.unifiedPrompt = $(this).val(); saveSettings(); });

    $('#ia_res_port_w').val(s.resPortraitW).on('change', function () { s.resPortraitW = parseInt($(this).val()) || 832; saveSettings(); });
    $('#ia_res_port_h').val(s.resPortraitH).on('change', function () { s.resPortraitH = parseInt($(this).val()) || 1216; saveSettings(); });
    $('#ia_res_land_w').val(s.resLandscapeW).on('change', function () { s.resLandscapeW = parseInt($(this).val()) || 1216; saveSettings(); });
    $('#ia_res_land_h').val(s.resLandscapeH).on('change', function () { s.resLandscapeH = parseInt($(this).val()) || 832; saveSettings(); });
    $('#ia_res_sq_w').val(s.resSquareW).on('change', function () { s.resSquareW = parseInt($(this).val()) || 1024; saveSettings(); });
    $('#ia_res_sq_h').val(s.resSquareH).on('change', function () { s.resSquareH = parseInt($(this).val()) || 1024; saveSettings(); });
    $('#ia_res_bg_w').val(s.resBgW).on('change', function () { s.resBgW = parseInt($(this).val()) || 1344; saveSettings(); });
    $('#ia_res_bg_h').val(s.resBgH).on('change', function () { s.resBgH = parseInt($(this).val()) || 768; saveSettings(); });

    $('#ia_comfy_steps').val(s.comfySteps).on('change', function () { s.comfySteps = parseInt($(this).val()) || 20; saveSettings(); });
    $('#ia_comfy_cfg').val(s.comfyCfg).on('change', function () { s.comfyCfg = parseFloat($(this).val()) || 4.5; saveSettings(); });
    $('#ia_comfy_sampler').val(s.comfySampler).on('input', function () { s.comfySampler = $(this).val(); saveSettings(); });
    $('#ia_comfy_scheduler').val(s.comfyScheduler).on('input', function () { s.comfyScheduler = $(this).val(); saveSettings(); });

    $('#ia_llm_provider').val(s.llmProvider).on('change', function () {
        s.llmProvider = $(this).val();
        $('#ia_custom_llm_fields').toggle(s.llmProvider === 'custom');
        saveSettings();
    });
    $('#ia_custom_llm_url').val(s.customLlmUrl).on('input', function () { s.customLlmUrl = $(this).val(); saveSettings(); });
    $('#ia_custom_llm_key').val(s.customLlmKey).on('input', function () { s.customLlmKey = $(this).val(); saveSettings(); });
    $('#ia_custom_llm_model').val(s.customLlmModel).on('input', function () { s.customLlmModel = $(this).val(); saveSettings(); });

    $('#ia_img_backend').val(s.imageBackend).on('change', function () {
        s.imageBackend = $(this).val();
        $('#ia_comfy_fields').toggle(s.imageBackend === 'comfyui_direct');
        saveSettings();
    });
    $('#ia_comfy_url').val(s.comfyUrl).on('input', function () { s.comfyUrl = $(this).val(); saveSettings(); });
    $('#ia_comfy_workflow').val(s.comfyWorkflow).on('input', function () { s.comfyWorkflow = $(this).val(); saveSettings(); });

    $('#ia_interval_row').toggle(s.triggerMode === 'interval');
    $('#ia_custom_llm_fields').toggle(s.llmProvider === 'custom');
    $('#ia_comfy_fields').toggle(s.imageBackend === 'comfyui_direct');

    $('#ia_manual_eval_btn').on('click', () => runEvaluation(true));
    $('#ia_open_gallery_btn').on('click', openGallery);
    $('#ia_win_min_btn').on('click', () => { $('#ia_gallery_modal').fadeOut(150); $('#ia_gallery_bubble').fadeIn(200); });
    $('#ia_win_close_btn').on('click', () => { $('#ia_gallery_modal').fadeOut(150); });
    $('#ia_close_review, #ia_rev_cancel').on('click', () => $('#ia_review_modal').fadeOut(150));
    $('#ia_close_batch_picker').on('click', () => $('#ia_batch_picker_modal').fadeOut(150));
    $('#ia_gallery_flat_toggle').on('change', () => renderGalleryContent());

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

function renderGalleryNav() {
    const $nav = $('#ia_gallery_nav').empty();
    const db = getGalleryDb();
    const chars = [...new Set(db.map(x => x.character))];

    $nav.append(`<div class="ia-section-title" style="padding: 4px 6px;">Filters</div>`);
    $nav.append(`
        <div class="ia-nav-filter" data-filter="all" style="padding: 6px; cursor: pointer; border-radius: 4px; margin-bottom: 2px;">
            <i class="fa-solid fa-layer-group"></i> All Media
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
        if ($(this).hasClass('ia-nav-filter')) renderGalleryContent(null, $(this).data('filter'));
        else renderGalleryContent($(this).data('char'), null);
    });
}

function renderGalleryContent(filterChar = null, filterType = null) {
    const $grid = $('#ia_gallery_content').empty();
    const isFlat = $('#ia_gallery_flat_toggle').is(':checked');
    let records = [...getGalleryDb()];

    if (!isFlat) {
        if (filterChar) records = records.filter(r => r.character === filterChar);
        if (filterType === 'background') records = records.filter(r => r.type === 'background');
    }

    if (records.length === 0) {
        $grid.append(`<div style="opacity: 0.6; padding: 20px; grid-column: 1 / -1; text-align: center;">No media recorded yet.</div>`);
        return;
    }

    records.forEach(r => {
        const imageMarkup = r.url ? `<img src="${r.url}" loading="lazy" />` : `<div style="background: #111; height: 160px; display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-image"></i></div>`;
        const tagBadge = r.type === 'background' ? `<span style="background: #e67e22; color: #fff; padding: 2px 5px; border-radius: 3px; font-size: 0.72em;">BG</span>` : `<span style="background: #3498db; color: #fff; padding: 2px 5px; border-radius: 3px; font-size: 0.72em;">Photo</span>`;

        const $card = $(`
            <div class="ia-card">
                ${imageMarkup}
                <div class="ia-card-meta">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <b style="font-size: 0.88em;">${r.character}</b>
                        ${tagBadge}
                    </div>
                    <div class="ia-desc-text">${r.description || r.reason || 'No description'}</div>
                    <div class="ia-card-actions">
                        ${r.type === 'background'
                            ? `<button type="button" class="ia-card-btn ia-set-bg-btn"><i class="fa-solid fa-mountain-sun"></i> Set BG</button>`
                            : `<button type="button" class="ia-card-btn ia-insert-roleplay-btn"><i class="fa-solid fa-comment-medical"></i> Insert to Chat</button>`}
                    </div>
                </div>
            </div>
        `);

        $card.find('.ia-set-bg-btn').on('click', async (e) => {
            e.stopPropagation();
            if (r.url) {
                await SillyTavern.getContext().executeSlashCommands(`/bg ${r.url}`);
                toastr.success(`Set wallpaper: ${r.location || 'Scene'}`, 'Marinara');
            }
        });

        $card.find('.ia-insert-roleplay-btn').on('click', async (e) => {
            e.stopPropagation();
            await deliverRoleplayImage(r.url, r.description);
            $('#ia_gallery_modal').fadeOut(150);
        });

        $grid.append($card);
    });
}