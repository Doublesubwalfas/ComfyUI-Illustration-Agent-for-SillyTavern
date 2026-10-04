const MODULE_NAME = 'comfyui-illustration-agent';

const defaultMarinaraPrompt = `Anchor the decision to <assistant_response>, the latest assistant turn. Use recent context only for continuity.
Set \`shouldGenerate\` to true if the latest assistant response contains at least one of the following:
1. A direct photo action: a character takes a picture, selfie, or explicitly requests/captures a photo. This always triggers generation, regardless of how casual the moment is.
2. A distinct visual shift or action: the scene features a physical action, an emotional expression, a new location, a newly described character, or a physical transformation.

If no picture is taken and the current scene is purely conversational or visually static, set \`shouldGenerate\` to false and keep the prompt empty.

Independently decide whether the active Roleplay background should change. Set \`generateBackground\` to true only when the latest scene enters a meaningfully different reusable location or setting. Always provide a concise "location" name (e.g. "Kuu's bedroom", "snowy forest", "tavern counter"). Keep \`generateBackground\` false when the location is unchanged, or only mood, lighting, time, or camera framing changed.

Return valid JSON only:
{
  "shouldGenerate": boolean,
  "generateBackground": boolean,
  "location": "concise name of location or room",
  "reason": "why generate or why not",
  "description": "natural 1-2 sentence description of what the photo or moment actually shows in plain English without tags, for character recognition (e.g. 'A selfie taken by Kuu smiling in her bedroom wearing a knitted sweater')",
  "prompt": "detailed prompt tags if shouldGenerate is true",
  "negativePrompt": "what to avoid",
  "style": "visual style",
  "aspectRatio": "landscape|portrait|square",
  "characters": ["visible character name"]
}

Prompt rules: describe composition, lighting, mood, environment, and every visible character directly. Include body build, clothing/outfit, hair, face, and distinguishing features. Put all visible names in characters. Include no UI, watermark, logo, signature, captions, speech bubbles, subtitles, manga SFX, or meta-instructions.`;

const defaultSettings = {
    enabled: true,
    triggerMode: 'every',
    triggerInterval: 3,
    pipelinePhase: 'post',
    interactiveReview: false,
    batchCount: 1,
    lookback: 3,
    stylePrefix: 'semi-realistic anime style, 2.5D anime, 3D anime, masterpiece, best quality, cinematic lighting',
    defaultNegative: 'lowres, bad anatomy, bad hands, text, error, blurry, jpeg artifacts',
    marinaraPrompt: defaultMarinaraPrompt,

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

let imageGalleryDb = [];
let isEvaluating = false;
let messageTurnCounter = 0;
let lastEvaluatedMsgId = null;

// Sequential Task Queue
const taskQueue = [];
let isQueueRunning = false;

function enqueueTask(taskFn) {
    taskQueue.push(taskFn);
    processQueue();
}

async function processQueue() {
    if (isQueueRunning) return;
    isQueueRunning = true;
    while (taskQueue.length > 0) {
        const currentTask = taskQueue.shift();
        try {
            await currentTask();
        } catch (e) {
            console.error('[Illustration Agent Task Error]', e);
        }
    }
    isQueueRunning = false;
}

// Server-Synced Central Storage
function loadStorage() {
    const context = SillyTavern.getContext();
    const settings = context.extensionSettings?.[MODULE_NAME];
    imageGalleryDb = (settings && Array.isArray(settings.gallery)) ? settings.gallery : [];
    updateGalleryBubbleBadge();
}

function saveStorage() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = {};
    }
    context.extensionSettings[MODULE_NAME].gallery = imageGalleryDb;
    context.saveSettingsDebounced?.();
    updateGalleryBubbleBadge();
}

function updateGalleryBubbleBadge() {
    $('#ia_gallery_bubble_badge').text(imageGalleryDb.length);
}

// Smart IP Resolution for mobile
function getEffectiveComfyUrl() {
    const s = SillyTavern.getContext().extensionSettings[MODULE_NAME];
    let url = (s.comfyUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
    try {
        const parsed = new URL(url);
        if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
            window.location.hostname !== '127.0.0.1' && window.location.hostname !== 'localhost') {
            parsed.hostname = window.location.hostname;
            return parsed.origin;
        }
    } catch (e) {
        console.warn('[Illustration Agent] URL Parse error', e);
    }
    return url;
}

// Base64 converter for universal device rendering
async function convertUrlToBase64(imgUrl) {
    try {
        const res = await fetch(imgUrl);
        const blob = await res.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn('[Illustration Agent] Base64 conversion fallback', e);
        return imgUrl;
    }
}

function inspectWorkflowMacros() {
    const raw = $('#ia_comfy_workflow').val() || '';
    const macros = [
        { name: '%prompt%', req: true },
        { name: '%negative_prompt%', req: false },
        { name: '%seed%', req: false },
        { name: '%steps%', req: false },
        { name: '%cfg%', req: false },
        { name: '%sampler%', req: false },
        { name: '%scheduler%', req: false },
        { name: '%denoise%', req: false },
        { name: '%width%', req: false },
        { name: '%height%', req: false }
    ];

    const $status = $('#ia_macro_detector').empty();
    macros.forEach(m => {
        const found = raw.includes(m.name);
        const color = found ? '#2ecc71' : (m.req ? '#e74c3c' : '#7f8c8d');
        const icon = found ? '✓' : (m.req ? '✗ Required' : '○ Optional');
        $status.append(`
            <span style="font-size: 0.75em; padding: 2px 6px; border-radius: 4px; border: 1px solid ${color}; color: ${color}; margin-right: 4px; margin-bottom: 4px; display: inline-block;">
                ${m.name}: ${icon}
            </span>
        `);
    });
}

// 1. Inject UI Elements
function injectUI() {
    if ($('#ia_main_container').length > 0) return;

    // Settings Drawer
    const settingsHtml = `
    <div id="ia_main_container" class="illustration-agent-settings" style="margin-bottom: 12px;">
        <div class="inline-drawer">
            <div id="ia_drawer_toggle" class="inline-drawer-toggle inline-drawer-header" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
                <b><i class="fa-solid fa-palette" style="margin-right: 6px; color: #ff7675;"></i>Marinara Illustration Agent</b>
                <div id="ia_drawer_icon" class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            
            <div id="ia_drawer_content" class="inline-drawer-content" style="display: none; padding: 12px;">
                <!-- Diagnostics / Ping Buttons -->
                <div class="ia-section">
                    <div class="ia-section-title"><i class="fa-solid fa-network-wired"></i> Connection Diagnostics</div>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" id="ia_ping_llm_btn" class="menu_button" style="flex: 1;">
                            <i class="fa-solid fa-brain"></i> Test LLM
                        </button>
                        <button type="button" id="ia_ping_image_btn" class="menu_button" style="flex: 1;">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Test ComfyUI
                        </button>
                    </div>
                </div>

                <!-- Core Pipeline Settings -->
                <div class="ia-section">
                    <div class="ia-section-title"><i class="fa-solid fa-sliders"></i> Core Pipeline Settings</div>
                    
                    <div class="ia-row-inline">
                        <label class="checkbox_label" style="cursor: pointer;">
                            <input type="checkbox" id="ia_enabled">
                            <span><b>Enable Autonomous Illustrator</b></span>
                        </label>
                        <button type="button" id="ia_open_gallery_btn" class="menu_button" style="padding: 3px 10px;">
                            <i class="fa-solid fa-images"></i> Gallery Window
                        </button>
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
                            <option value="post">Post-Processing (After Assistant Turn - Default)</option>
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
                        <small style="opacity: 0.7;">If > 1, a picker will let you choose which image to insert into roleplay.</small>
                    </div>

                    <div class="ia-row">
                        <label for="ia_lookback"><b>Lookback History (Messages):</b></label>
                        <input type="number" id="ia_lookback" class="text_pole" min="1" max="10" value="3">
                    </div>
                </div>

                <!-- Custom Resolution Config -->
                <div class="ia-section">
                    <div class="ia-section-title"><i class="fa-solid fa-crop-simple"></i> Resolution & Aspect Ratios (W × H)</div>
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

                <!-- Evaluator LLM API -->
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

                <!-- Image Backend Selection -->
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
                            <textarea id="ia_comfy_workflow" class="text_pole" rows="8" style="font-family: monospace; font-size: 0.8em;" placeholder="Paste API format JSON here..."></textarea>
                        </div>
                        
                        <div style="margin-top: 4px;">
                            <label style="font-size: 0.8em; opacity: 0.8;"><b>Macro Detection Status:</b></label>
                            <div id="ia_macro_detector" style="margin-top: 4px;"></div>
                        </div>
                    </div>
                </div>

                <!-- Marinara Prompting Rules -->
                <div class="ia-section">
                    <div class="ia-section-title"><i class="fa-solid fa-file-code"></i> Marinara System Instructions & Macros</div>
                    <div class="ia-row">
                        <label><b>Style Prefix:</b></label>
                        <input type="text" id="ia_style_prefix" class="text_pole">
                    </div>
                    <div class="ia-row">
                        <label><b>Default Negative Prompt:</b></label>
                        <input type="text" id="ia_default_negative" class="text_pole">
                    </div>
                    <div class="ia-row">
                        <label><b>Agent Instruction Template:</b></label>
                        <textarea id="ia_marinara_prompt" class="text_pole" rows="8"></textarea>
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

    // Floating Modals & Android Bubble attached to BODY
    if ($('#ia_gallery_bubble').length === 0) {
        const bodyFloatingHtml = `
        <div id="ia_gallery_bubble" title="Drag anywhere or tap to open gallery">
            <i id="ia_bubble_icon" class="fa-solid fa-camera-retro"></i>
            <div id="ia_gallery_bubble_badge">0</div>
        </div>

        <div id="ia_review_modal" style="display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 500px; max-width: 90vw; background: var(--SmartThemeBlurTintColor, #202028); border: 1px solid rgba(255,255,255,0.2); border-radius: 10px; z-index: 100000; padding: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.85);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <b><i class="fa-solid fa-pen-to-square"></i> Review Scene Illustration</b>
                <div id="ia_close_review" style="cursor: pointer;"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <div class="ia-row">
                <label><b>Description (Perceived by Character LLM):</b></label>
                <input type="text" id="ia_rev_desc" class="text_pole">
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
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
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

    $('#ia_drawer_content').on('click', (e) => e.stopPropagation());

    $('#ia_open_gallery_btn').on('click', (e) => { e.stopPropagation(); openGalleryWindow(); });
    $('#ia_win_min_btn').on('click', minimizeGalleryWindow);
    $('#ia_win_close_btn').on('click', closeGalleryWindow);
    $('#ia_close_review, #ia_rev_cancel').on('click', () => $('#ia_review_modal').fadeOut(150));
    $('#ia_close_batch_picker').on('click', () => $('#ia_batch_picker_modal').fadeOut(150));

    setupAndroidBubbleDraggable();
}

function setupAndroidBubbleDraggable() {
    const $bubble = $('#ia_gallery_bubble');
    let isDragging = false;
    let startX, startY, initLeft, initTop;
    let thresholdExceeded = false;

    $bubble.off('touchstart mousedown').on('touchstart mousedown', function (e) {
        const evt = e.touches ? e.touches[0] : e;
        isDragging = true;
        thresholdExceeded = false;
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

        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
            thresholdExceeded = true;
        }

        if (thresholdExceeded) {
            let nextX = initLeft + dx;
            let nextY = initTop + dy;

            nextX = Math.max(8, Math.min(window.innerWidth - 60, nextX));
            nextY = Math.max(8, Math.min(window.innerHeight - 60, nextY));

            $bubble.css({
                left: nextX + 'px',
                top: nextY + 'px',
                right: 'auto',
                bottom: 'auto'
            });
        }
    });

    $(document).off('touchend mouseup.iabubble').on('touchend mouseup.iabubble', function () {
        if (!isDragging) return;
        isDragging = false;

        if (thresholdExceeded) {
            const rect = $bubble[0].getBoundingClientRect();
            const midX = window.innerWidth / 2;
            const targetX = (rect.left + 26 < midX) ? 12 : (window.innerWidth - 64);

            $bubble.css({ transition: 'all 0.25s cubic-bezier(0.25, 1, 0.5, 1)' });
            $bubble.css('left', targetX + 'px');
            setTimeout(() => $bubble.css({ transition: 'none' }), 250);
        } else {
            openGalleryWindow();
        }
    });
}

function openGalleryWindow() {
    loadStorage();
    $('#ia_gallery_bubble').fadeOut(150);
    renderGalleryNav();
    renderGalleryContent();
    $('#ia_gallery_modal').fadeIn(200);
}

function minimizeGalleryWindow() {
    $('#ia_gallery_modal').fadeOut(150, () => {
        $('#ia_gallery_bubble').fadeIn(200);
    });
}

function closeGalleryWindow() {
    $('#ia_gallery_modal').fadeOut(150);
    $('#ia_gallery_bubble').fadeIn(150);
}

// 2. Settings Binding
function loadSettings() {
    const context = SillyTavern.getContext();
    context.extensionSettings[MODULE_NAME] = Object.assign({}, defaultSettings, context.extensionSettings[MODULE_NAME] || {});
    const s = context.extensionSettings[MODULE_NAME];

    $('#ia_enabled').prop('checked', !!s.enabled);
    $('#ia_trigger_mode').val(s.triggerMode || 'every');
    $('#ia_trigger_interval').val(s.triggerInterval || 3);
    $('#ia_pipeline_phase').val(s.pipelinePhase);
    $('#ia_interactive_review').prop('checked', !!s.interactiveReview);
    $('#ia_batch_count').val(s.batchCount);
    $('#ia_lookback').val(s.lookback);
    $('#ia_style_prefix').val(s.stylePrefix);
    $('#ia_default_negative').val(s.defaultNegative);
    $('#ia_marinara_prompt').val(s.marinaraPrompt);

    $('#ia_res_port_w').val(s.resPortraitW || 832);
    $('#ia_res_port_h').val(s.resPortraitH || 1216);
    $('#ia_res_land_w').val(s.resLandscapeW || 1216);
    $('#ia_res_land_h').val(s.resLandscapeH || 832);
    $('#ia_res_sq_w').val(s.resSquareW || 1024);
    $('#ia_res_sq_h').val(s.resSquareH || 1024);
    $('#ia_res_bg_w').val(s.resBgW || 1344);
    $('#ia_res_bg_h').val(s.resBgH || 768);

    $('#ia_comfy_steps').val(s.comfySteps || 20);
    $('#ia_comfy_cfg').val(s.comfyCfg || 4.5);
    $('#ia_comfy_sampler').val(s.comfySampler || 'euler_ancestral');
    $('#ia_comfy_scheduler').val(s.comfyScheduler || 'normal');

    $('#ia_llm_provider').val(s.llmProvider);
    $('#ia_custom_llm_url').val(s.customLlmUrl);
    $('#ia_custom_llm_key').val(s.customLlmKey);
    $('#ia_custom_llm_model').val(s.customLlmModel);

    $('#ia_img_backend').val(s.imageBackend);
    $('#ia_comfy_url').val(s.comfyUrl);
    $('#ia_comfy_workflow').val(s.comfyWorkflow);

    toggleConditionalFields();
    inspectWorkflowMacros();
}

function toggleConditionalFields() {
    const s = SillyTavern.getContext().extensionSettings[MODULE_NAME];
    $('#ia_custom_llm_fields').toggle(s.llmProvider === 'custom');
    $('#ia_comfy_fields').toggle(s.imageBackend === 'comfyui_direct');
    $('#ia_interval_row').toggle(s.triggerMode === 'interval');
}

function bindUI() {
    const context = SillyTavern.getContext();
    const save = () => context.saveSettingsDebounced?.();
    const s = context.extensionSettings[MODULE_NAME];

    $('#ia_enabled').on('change', function () { s.enabled = $(this).is(':checked'); save(); });
    $('#ia_trigger_mode').on('change', function () { s.triggerMode = $(this).val(); toggleConditionalFields(); save(); });
    $('#ia_trigger_interval').on('change', function () { s.triggerInterval = Math.max(2, parseInt($(this).val()) || 3); save(); });
    $('#ia_pipeline_phase').on('change', function () { s.pipelinePhase = $(this).val(); save(); });
    $('#ia_interactive_review').on('change', function () { s.interactiveReview = $(this).is(':checked'); save(); });
    $('#ia_batch_count').on('change', function () { s.batchCount = Math.max(1, parseInt($(this).val()) || 1); save(); });
    $('#ia_lookback').on('change', function () { s.lookback = Math.max(1, parseInt($(this).val()) || 3); save(); });
    $('#ia_style_prefix').on('input', function () { s.stylePrefix = $(this).val(); save(); });
    $('#ia_default_negative').on('input', function () { s.defaultNegative = $(this).val(); save(); });
    $('#ia_marinara_prompt').on('input', function () { s.marinaraPrompt = $(this).val(); save(); });

    $('#ia_res_port_w').on('change', function () { s.resPortraitW = parseInt($(this).val()) || 832; save(); });
    $('#ia_res_port_h').on('change', function () { s.resPortraitH = parseInt($(this).val()) || 1216; save(); });
    $('#ia_res_land_w').on('change', function () { s.resLandscapeW = parseInt($(this).val()) || 1216; save(); });
    $('#ia_res_land_h').on('change', function () { s.resLandscapeH = parseInt($(this).val()) || 832; save(); });
    $('#ia_res_sq_w').on('change', function () { s.resSquareW = parseInt($(this).val()) || 1024; save(); });
    $('#ia_res_sq_h').on('change', function () { s.resSquareH = parseInt($(this).val()) || 1024; save(); });
    $('#ia_res_bg_w').on('change', function () { s.resBgW = parseInt($(this).val()) || 1344; save(); });
    $('#ia_res_bg_h').on('change', function () { s.resBgH = parseInt($(this).val()) || 768; save(); });

    $('#ia_comfy_steps').on('change', function () { s.comfySteps = parseInt($(this).val()) || 20; save(); });
    $('#ia_comfy_cfg').on('change', function () { s.comfyCfg = parseFloat($(this).val()) || 4.5; save(); });
    $('#ia_comfy_sampler').on('input', function () { s.comfySampler = $(this).val(); save(); });
    $('#ia_comfy_scheduler').on('input', function () { s.comfyScheduler = $(this).val(); save(); });

    $('#ia_llm_provider').on('change', function () { s.llmProvider = $(this).val(); toggleConditionalFields(); save(); });
    $('#ia_custom_llm_url').on('input', function () { s.customLlmUrl = $(this).val(); save(); });
    $('#ia_custom_llm_key').on('input', function () { s.customLlmKey = $(this).val(); save(); });
    $('#ia_custom_llm_model').on('input', function () { s.customLlmModel = $(this).val(); save(); });

    $('#ia_img_backend').on('change', function () { s.imageBackend = $(this).val(); toggleConditionalFields(); save(); });
    $('#ia_comfy_url').on('input', function () { s.comfyUrl = $(this).val(); save(); });

    $('#ia_comfy_workflow').on('input', function () {
        s.comfyWorkflow = $(this).val();
        inspectWorkflowMacros();
        save();
    });

    $('#ia_manual_eval_btn').on('click', (e) => { e.stopPropagation(); runEvaluation(true); });
    $('#ia_gallery_flat_toggle').on('change', () => renderGalleryContent());

    $('#ia_ping_llm_btn').on('click', pingLLM);
    $('#ia_ping_image_btn').on('click', pingImageBackend);
}

// 3. Diagnostics
async function pingLLM() {
    toastr.info('Testing connection to LLM...', 'Diagnostics');
    const start = performance.now();
    try {
        const res = await queryAgentLLM('Reply with the single word: "READY"');
        const ms = Math.round(performance.now() - start);
        if (res) {
            toastr.success(`LLM is online! (${ms}ms) Response: ${res.substring(0, 30)}`, 'Diagnostics');
        } else {
            toastr.error('LLM returned an empty response.', 'Diagnostics');
        }
    } catch (e) {
        toastr.error(`LLM Connection Failed: ${e.message}`, 'Diagnostics');
    }
}

async function pingImageBackend() {
    const s = SillyTavern.getContext().extensionSettings[MODULE_NAME];
    toastr.info('Testing Image Generator connection...', 'Diagnostics');

    if (s.imageBackend === 'comfyui_direct') {
        const baseUrl = getEffectiveComfyUrl();
        const start = performance.now();
        try {
            const resp = await fetch(`${baseUrl}/system_stats`);
            const ms = Math.round(performance.now() - start);
            if (resp.ok) {
                const data = await resp.json();
                const vram = data?.devices?.[0]?.vram_total ? ` - VRAM: ${(data.devices[0].vram_total / 1073741824).toFixed(1)}GB` : '';
                toastr.success(`ComfyUI Connected! (${ms}ms)${vram}`, 'Diagnostics');
            } else {
                throw new Error(`HTTP ${resp.status}`);
            }
        } catch (e) {
            toastr.error(`ComfyUI Unreachable at ${baseUrl}: ${e.message}`, 'Diagnostics');
        }
    } else {
        toastr.success('Using SillyTavern native (/imagine). Ready!', 'Diagnostics');
    }
}

// 4. Evaluator LLM Calls
async function queryAgentLLM(fullPrompt) {
    const s = SillyTavern.getContext().extensionSettings[MODULE_NAME];

    if (s.llmProvider === 'custom') {
        const resp = await fetch(`${s.customLlmUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${s.customLlmKey}`
            },
            body: JSON.stringify({
                model: s.customLlmModel,
                messages: [{ role: 'user', content: fullPrompt }],
                temperature: 0.3
            })
        });
        const data = await resp.json();
        return data.choices?.[0]?.message?.content || '';
    } else {
        return await SillyTavern.getContext().generateQuietPrompt(fullPrompt, false, false);
    }
}

function findExistingBackground(locationName) {
    if (!locationName) return null;
    const cleanQuery = locationName.toLowerCase().trim();

    return imageGalleryDb.find(item => {
        if (item.type !== 'background' || !item.url) return false;
        const loc = (item.location || '').toLowerCase();
        return loc.includes(cleanQuery) || cleanQuery.includes(loc);
    });
}

// 5. Main Evaluation Engine
async function runEvaluation(force = false, triggeredMessageId = null) {
    if (isEvaluating) return;
    const context = SillyTavern.getContext();
    const s = context.extensionSettings[MODULE_NAME];

    if (!context.chat || context.chat.length === 0) return;
    if (!force && !s.enabled) return;

    if (!force && s.triggerMode === 'interval') {
        messageTurnCounter++;
        if (messageTurnCounter % (s.triggerInterval || 3) !== 0) {
            console.log(`[Illustration Agent] Interval skipping turn (${messageTurnCounter}/${s.triggerInterval})`);
            return;
        }
    }

    isEvaluating = true;
    try {
        const recentMessages = context.chat.slice(-s.lookback);
        const lastMsg = recentMessages[recentMessages.length - 1];

        // Format dialog context
        const contextText = recentMessages.map(m => `${m.name || (m.is_user ? 'User' : 'Assistant')}: ${m.mes}`).join('\n\n');
        const activeChar = context.characters?.[context.characterId];
        const charDescription = activeChar?.data?.description || activeChar?.description || '';

        const fullPrompt = `${s.marinaraPrompt}

Current Character Reference:
Name: ${activeChar?.name || 'Character'}
Description: ${charDescription.substring(0, 800)}

Recent Context (for continuity):
${contextText}

<assistant_response>
${lastMsg.mes}
</assistant_response>`;

        // Activate Android Bubble visual indicator
        $('#ia_gallery_bubble').addClass('is-generating');
        $('#ia_bubble_icon').removeClass('fa-camera-retro').addClass('fa-wand-magic-sparkles fa-spin');
        
        // Show evaluation notification on screen
        toastr.info('Autonomous Illustrator: Evaluating latest scene...', 'Marinara');

        const rawResponse = await queryAgentLLM(fullPrompt);
        if (!rawResponse) {
            resetGeneratingIndicator();
            isEvaluating = false;
            return;
        }

        const cleaned = rawResponse.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON object returned by LLM');
        const result = JSON.parse(jsonMatch[0]);

        console.log('[Illustration Agent Decision]', result);

        // MUTUAL EXCLUSION: Background takes priority over character art
        if (result.generateBackground) {
            const loc = result.location || 'New Scene';
            const matchedBg = findExistingBackground(loc);

            if (matchedBg) {
                toastr.success(`Decision: Reusing saved background: "${matchedBg.location}"`, 'Marinara');
                await context.executeSlashCommands(`/bg ${matchedBg.url}`);
                resetGeneratingIndicator();
            } else {
                toastr.info(`Decision: Generating background for "${loc}"`, 'Marinara');
                enqueueTask(async () => {
                    const bgPositive = [s.stylePrefix, result.prompt, 'scenery, landscape, interior, detailed background, no people, empty scene'].filter(Boolean).join(', ');
                    const bgNegative = [s.defaultNegative, 'character, person, people, human, face, girl, boy, 1girl'].filter(Boolean).join(', ');

                    const bgUrl = await generateComfyImage(bgPositive, bgNegative, s.resBgW, s.resBgH, {
                        ...result,
                        isBackground: true
                    });

                    if (bgUrl) {
                        toastr.success(`Background updated: ${loc}`, 'Marinara');
                        await context.executeSlashCommands(`/bg ${bgUrl}`);
                    }
                    resetGeneratingIndicator();
                });
            }
        } else if (force || result.shouldGenerate === true) {
            toastr.success(`Decision: Illustrating scene: ${result.reason || 'Moment detected'}`, 'Marinara');
            const combinedPos = [s.stylePrefix, result.prompt].filter(Boolean).join(', ');
            const combinedNeg = [s.defaultNegative, result.negativePrompt].filter(Boolean).join(', ');

            if (s.interactiveReview) {
                promptReviewModal(combinedPos, combinedNeg, result.aspectRatio, result);
            } else {
                enqueueTask(async () => {
                    await executeImagePipeline(combinedPos, combinedNeg, result.aspectRatio, result);
                });
            }
        } else {
            toastr.info(`Decision: Scene is static, no art needed. (${result.reason || 'No shift'})`, 'Marinara');
            resetGeneratingIndicator();
        }
    } catch (e) {
        console.error('[Illustration Agent Error]', e);
        resetGeneratingIndicator();
        toastr.error('Evaluation failed: ' + e.message, 'Marinara');
    } finally {
        isEvaluating = false;
    }
}

function resetGeneratingIndicator() {
    $('#ia_gallery_bubble').removeClass('is-generating');
    $('#ia_bubble_icon').removeClass('fa-wand-magic-sparkles fa-spin').addClass('fa-camera-retro');
}

function promptReviewModal(pos, neg, ar, metadata) {
    $('#ia_rev_desc').val(metadata.description || '');
    $('#ia_rev_positive').val(pos);
    $('#ia_rev_negative').val(neg);
    $('#ia_rev_ar').val(ar || 'portrait');
    $('#ia_review_modal').fadeIn(150);

    $('#ia_rev_confirm').off('click').on('click', () => {
        $('#ia_review_modal').fadeOut(150);
        metadata.description = $('#ia_rev_desc').val();
        enqueueTask(async () => {
            await executeImagePipeline($('#ia_rev_positive').val(), $('#ia_rev_negative').val(), $('#ia_rev_ar').val(), metadata);
        });
    });
}

// 6. Image Pipeline Execution
async function executeImagePipeline(positive, negative, aspectRatio, metadata) {
    const context = SillyTavern.getContext();
    const s = context.extensionSettings[MODULE_NAME];

    let width = s.resPortraitW;
    let height = s.resPortraitH;

    if (aspectRatio === 'landscape') {
        width = s.resLandscapeW;
        height = s.resLandscapeH;
    } else if (aspectRatio === 'square') {
        width = s.resSquareW;
        height = s.resSquareH;
    }

    const totalBatch = s.batchCount || 1;
    const generatedUrls = [];

    try {
        for (let i = 0; i < totalBatch; i++) {
            if (s.imageBackend === 'comfyui_direct') {
                const imageUrl = await generateComfyImage(positive, negative, width, height, metadata);
                if (imageUrl) generatedUrls.push(imageUrl);
            } else {
                await context.executeSlashCommands(`/imagine ${positive}`);
            }
        }

        if (generatedUrls.length === 1) {
            injectImageIntoChatMessage(generatedUrls[0], metadata.description);
        } else if (generatedUrls.length > 1) {
            showBatchCandidatePicker(generatedUrls, metadata.description);
        }
    } finally {
        resetGeneratingIndicator();
    }
}

function showBatchCandidatePicker(urls, description) {
    const $grid = $('#ia_batch_grid').empty();

    urls.forEach((url, idx) => {
        const $item = $(`
            <div class="ia-batch-item" title="Click to insert Variation #${idx + 1} into Roleplay">
                <img src="${url}" />
                <div style="padding: 6px; text-align: center; font-size: 0.85em; background: rgba(0,0,0,0.4);">
                    <b>Variation #${idx + 1}</b>
                </div>
            </div>
        `);

        $item.on('click', () => {
            injectImageIntoChatMessage(url, description);
            $('#ia_batch_picker_modal').fadeOut(150);
            toastr.success(`Inserted Variation #${idx + 1} into roleplay!`, 'Marinara');
        });

        $grid.append($item);
    });

    $('#ia_batch_picker_modal').fadeIn(150);
}

async function pollComfyResult(comfyUrl, promptId, maxAttempts = 75) {
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 1500));

        try {
            const resp = await fetch(`${comfyUrl}/history/${promptId}`);
            if (!resp.ok) continue;

            const history = await resp.json();
            if (history && history[promptId] && history[promptId].outputs) {
                const outputs = history[promptId].outputs;
                for (const nodeId in outputs) {
                    if (outputs[nodeId].images && outputs[nodeId].images.length > 0) {
                        const imgInfo = outputs[nodeId].images[0];
                        return `${comfyUrl}/view?filename=${encodeURIComponent(imgInfo.filename)}&subfolder=${encodeURIComponent(imgInfo.subfolder || '')}&type=${encodeURIComponent(imgInfo.type || 'output')}`;
                    }
                }
            }
        } catch (e) {
            console.warn('[Illustration Agent] Polling ComfyUI history...', e);
        }
    }
    throw new Error('ComfyUI generation timed out.');
}

// Injects the image and vision perception description into chat
function injectImageIntoChatMessage(imageUrl, description) {
    const context = SillyTavern.getContext();
    if (!context || !context.chat || context.chat.length === 0) return;

    let messageIndex = context.chat.length - 1;
    while (messageIndex >= 0 && context.chat[messageIndex].is_user) {
        messageIndex--;
    }
    if (messageIndex < 0) messageIndex = context.chat.length - 1;

    const targetMsg = context.chat[messageIndex];
    const descText = description || 'A photo of the scene';

    const imageMarkdown = `\n\n![[Scene Description: ${descText}]](${imageUrl})\n*<small class="ia-img-caption"><i class="fa-solid fa-camera"></i> ${descText}</small>*`;

    if (!targetMsg.mes.includes(imageUrl)) {
        targetMsg.mes += imageMarkdown;

        if (typeof context.updateMessage === 'function') {
            context.updateMessage(messageIndex, targetMsg);
        }
        if (typeof context.saveChatDebounced === 'function') {
            context.saveChatDebounced();
        }

        const $mesElement = $(`#chat .mes[mesid="${messageIndex}"] .mes_text, .mes_text`).last();
        if ($mesElement.length && !$mesElement.find(`img[src="${imageUrl}"]`).length) {
            $mesElement.append(`
                <div class="ia-img-wrapper" style="margin-top: 10px;">
                    <img src="${imageUrl}" alt="${descText}" title="${descText}" />
                    <span class="ia-img-caption"><i class="fa-solid fa-camera"></i> ${descText}</span>
                    <button type="button" class="ia-reroll-btn"><i class="fa-solid fa-rotate-right"></i> Reroll</button>
                </div>
            `);
        }
    }
}

async function generateComfyImage(positive, negative, width, height, metadata) {
    const s = SillyTavern.getContext().extensionSettings[MODULE_NAME];
    const comfyBaseUrl = getEffectiveComfyUrl();

    try {
        if (!s.comfyWorkflow || !s.comfyWorkflow.trim()) {
            throw new Error('ComfyUI API Workflow JSON is empty.');
        }

        const randomSeed = Math.floor(Math.random() * 1000000000000);
        const steps = s.comfySteps || 20;
        const cfg = s.comfyCfg || 4.5;
        const sampler = s.comfySampler || 'euler_ancestral';
        const scheduler = s.comfyScheduler || 'normal';
        const denoise = 1.0;

        let rawStr = s.comfyWorkflow;

        const safePositive = JSON.stringify(positive).slice(1, -1);
        const safeNegative = JSON.stringify(negative).slice(1, -1);

        rawStr = rawStr
            .replaceAll('%prompt%', safePositive)
            .replaceAll('%positive%', safePositive)
            .replaceAll('%negative_prompt%', safeNegative)
            .replaceAll('%negative%', safeNegative)
            .replaceAll('%sampler%', sampler)
            .replaceAll('%scheduler%', scheduler)
            .replaceAll('"%seed%"', randomSeed)
            .replaceAll('%seed%', randomSeed)
            .replaceAll('"%steps%"', steps)
            .replaceAll('%steps%', steps)
            .replaceAll('"%cfg%"', cfg)
            .replaceAll('%cfg%', cfg)
            .replaceAll('"%denoise%"', denoise)
            .replaceAll('%denoise%', denoise)
            .replaceAll('"%width%"', width)
            .replaceAll('%width%', width)
            .replaceAll('"%height%"', height)
            .replaceAll('%height%', height);

        const workflow = JSON.parse(rawStr);

        const resp = await fetch(`${comfyBaseUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: workflow })
        });

        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`ComfyUI HTTP ${resp.status}: ${errText}`);
        }

        const data = await resp.json();
        toastr.info(`ComfyUI Running (${data.prompt_id})...`, 'Marinara');

        const rawImageUrl = await pollComfyResult(comfyBaseUrl, data.prompt_id);
        const base64Url = await convertUrlToBase64(rawImageUrl);

        recordImage({
            id: Date.now() + Math.random().toString(36).substr(2, 4),
            character: SillyTavern.getContext().characters?.[SillyTavern.getContext().characterId]?.name || 'Unknown',
            chatId: SillyTavern.getContext().chatId || 'Chat',
            date: new Date().toISOString(),
            description: metadata.description || 'Illustration of the scene',
            positive,
            negative,
            aspectRatio: `${width}x${height}`,
            type: metadata.isBackground ? 'background' : 'illustration',
            location: metadata.location || '',
            reason: metadata.reason,
            url: base64Url
        });

        return base64Url;
    } catch (e) {
        console.error('[ComfyUI Direct Error]', e);
        toastr.error(`ComfyUI execution failed: ${e.message}`, 'Marinara');
        return null;
    }
}

// 7. Gallery System
function recordImage(entry) {
    loadStorage();
    imageGalleryDb.unshift(entry);
    saveStorage();
}

function renderGalleryNav() {
    const $nav = $('#ia_gallery_nav').empty();
    const characters = [...new Set(imageGalleryDb.map(x => x.character))];

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
    characters.forEach(c => {
        $nav.append(`
            <div class="ia-nav-char" data-char="${c}" style="padding: 6px; cursor: pointer; border-radius: 4px; margin-bottom: 2px;">
                <i class="fa-solid fa-user"></i> ${c}
            </div>
        `);
    });

    $('.ia-nav-filter, .ia-nav-char').off('click').on('click', function () {
        $('.ia-nav-filter, .ia-nav-char').css('background', 'transparent');
        $(this).css('background', 'rgba(255,255,255,0.15)');

        if ($(this).hasClass('ia-nav-filter')) {
            renderGalleryContent(null, $(this).data('filter'));
        } else {
            renderGalleryContent($(this).data('char'), null);
        }
    });
}

function renderGalleryContent(filterChar = null, filterType = null) {
    const $grid = $('#ia_gallery_content').empty();
    const isFlat = $('#ia_gallery_flat_toggle').is(':checked');

    loadStorage();
    let records = [...imageGalleryDb];

    if (!isFlat) {
        if (filterChar) records = records.filter(r => r.character === filterChar);
        if (filterType === 'background') records = records.filter(r => r.type === 'background');
    }

    if (records.length === 0) {
        $grid.append(`<div style="opacity: 0.6; padding: 20px; grid-column: 1 / -1; text-align: center;">No media recorded yet.</div>`);
        return;
    }

    records.forEach(r => {
        const imageMarkup = r.url
            ? `<img src="${r.url}" loading="lazy" />`
            : `<div style="background: #111; height: 160px; display: flex; align-items: center; justify-content: center; font-size: 2em; color: #555;"><i class="fa-solid fa-image"></i></div>`;

        const tagBadge = r.type === 'background'
            ? `<span style="background: #e67e22; color: #fff; padding: 2px 5px; border-radius: 3px; font-size: 0.72em;">BG</span>`
            : `<span style="background: #3498db; color: #fff; padding: 2px 5px; border-radius: 3px; font-size: 0.72em;">Photo</span>`;

        const $card = $(`
            <div class="ia-card">
                ${imageMarkup}
                <div class="ia-card-meta">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <b style="font-size: 0.88em;">${r.character}</b>
                        ${tagBadge}
                    </div>
                    <div class="ia-desc-text" title="${r.description || r.reason}">${r.description || r.reason || 'No description'}</div>
                    <div class="ia-card-actions">
                        ${r.type === 'background'
                            ? `<button type="button" class="ia-card-btn ia-set-bg-btn"><i class="fa-solid fa-mountain-sun"></i> Set BG</button>`
                            : `<button type="button" class="ia-card-btn ia-insert-roleplay-btn"><i class="fa-solid fa-comment-medical"></i> Insert to Chat</button>`
                        }
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
            injectImageIntoChatMessage(r.url, r.description);
            toastr.success('Inserted photo & vision description into chat!', 'Marinara');
            closeGalleryWindow();
        });

        $grid.append($card);
    });
}

// 8. In-Chat Reroll Buttons
function attachInChatMessageButtons() {
    $('.mes_text img').each(function () {
        const $img = $(this);
        if ($img.parent().hasClass('ia-img-wrapper')) return;

        $img.wrap('<div class="ia-img-wrapper"></div>');
        const $btn = $('<button type="button" class="ia-reroll-btn"><i class="fa-solid fa-rotate-right"></i> Reroll</button>');
        $img.after($btn);

        $btn.on('click', async (e) => {
            e.stopPropagation();
            toastr.info('Rerolling illustration...', 'Marinara');
            await runEvaluation(true);
        });
    });
}

// 9. SillyTavern Lifecycle Hookup
jQuery(async () => {
    injectUI();
    loadSettings();
    loadStorage();
    bindUI();

    const context = SillyTavern.getContext();
    const eventSource = context.eventSource || SillyTavern.eventSource;
    const events = context.event_types || context.eventTypes || SillyTavern.event_types || SillyTavern.eventTypes || {};

    function handleAssistantTurnFinished(msgId) {
        // Prevent duplicate firing on the same message
        if (msgId !== undefined && msgId !== null && lastEvaluatedMsgId === msgId) {
            return;
        }
        lastEvaluatedMsgId = msgId;

        attachInChatMessageButtons();

        const s = context.extensionSettings[MODULE_NAME];
        if (!s || !s.enabled) return;

        const phase = s.pipelinePhase || 'post';
        if (phase === 'post' || phase === 'parallel') {
            runEvaluation(false, msgId);
        }
    }

    if (eventSource && events) {
        // 1. Primary Hook: Fires when character message completes rendering
        const charRenderEvt = events.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered';
        eventSource.on(charRenderEvt, (msgId) => {
            handleAssistantTurnFinished(msgId);
        });

        // 2. Secondary Hook: Fires when message is received
        const msgRecvEvt = events.MESSAGE_RECEIVED || 'message_received';
        eventSource.on(msgRecvEvt, (msgId) => {
            // Guard: ensure it's not a user message
            if (context.chat && msgId !== undefined && context.chat[msgId]?.is_user) return;
            handleAssistantTurnFinished(msgId);
        });

        // 3. Fallback: Fires when generation engine completes
        const genEndEvt = events.GENERATION_ENDED || 'generation_ended';
        eventSource.on(genEndEvt, () => {
            handleAssistantTurnFinished(null);
        });
    }

    setInterval(attachInChatMessageButtons, 2500);
    console.log('[Illustration Agent] Autonomous Engine & Android Chat-Head Loaded.');
});