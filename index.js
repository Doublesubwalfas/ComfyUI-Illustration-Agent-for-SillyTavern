const MODULE_NAME = 'comfyui-illustration-agent';

const defaultMarinaraPrompt = `Anchor the decision to <assistant_response>, the latest assistant turn. Use recent context only for continuity.
Set \`shouldGenerate\` to true if the latest assistant response contains at least one of the following:
1. A direct photo action: a character takes a picture, selfie, or explicitly requests/captures a photo. This always triggers generation, regardless of how casual the moment is.
2. A distinct visual shift or action: the scene features a physical action, an emotional expression, a new location, a newly described character, or a physical transformation.

If no picture is taken and the current scene is purely conversational or visually static, set \`shouldGenerate\` to false and keep the prompt empty.

Independently decide whether the active Roleplay background should change. Set \`generateBackground\` to true only when an <illustrator_background_generation enabled="true"> block is present and the latest scene enters a meaningfully different reusable location or setting. Prefer tracker location changes when available; otherwise infer from recent context. A background may be generated alongside an illustration or while \`shouldGenerate\` is false. Keep \`generateBackground\` false when the block is absent, the location is unchanged, or only mood, lighting, time, or camera framing changed.

Return valid JSON only:
{
  "shouldGenerate": boolean,
  "generateBackground": boolean,
  "reason": "why generate or why not",
  "prompt": "detailed prompt if shouldGenerate is true",
  "negativePrompt": "what to avoid",
  "style": "visual style",
  "aspectRatio": "landscape|portrait|square",
  "characters": ["visible character name"]
}

Prompt rules: describe composition, lighting, mood, environment, and every visible character/persona directly. For each visible character/persona, include available body build (chubby, slim, muscular, etc.), clothing/outfit, hair, face, distinguishing features, and other appearance details from context. Do not invent missing traits. Put all visible names in characters. Include no UI, watermark, logo, signature, captions, speech bubbles, subtitles, manga SFX, or meta-instructions.`;

const defaultSettings = {
    enabled: false,
    pipelinePhase: 'post', // 'pre', 'parallel', 'post'
    interactiveReview: false,
    batchCount: 1,
    lookback: 3,
    stylePrefix: 'masterpiece, best quality, ultra-detailed, cinematic lighting',
    defaultNegative: 'lowres, bad anatomy, bad hands, text, error, blurry, jpeg artifacts',
    marinaraPrompt: defaultMarinaraPrompt,
    
    // LLM Settings
    llmProvider: 'current',
    customLlmUrl: 'https://api.openai.com/v1',
    customLlmKey: '',
    customLlmModel: 'gpt-4o-mini',

    // Image Backend
    imageBackend: 'sillytavern',
    comfyUrl: 'http://127.0.0.1:8188',
    comfyPosNode: '6',
    comfyNegNode: '7',
    comfySeedNode: '3',
    comfyWorkflow: `{
  "3": { "inputs": { "seed": 0, "steps": 25, "cfg": 7, "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] }, "class_type": "KSampler" },
  "4": { "inputs": { "ckpt_name": "v1-5-pruned-emaonly.safetensors" }, "class_type": "CheckpointLoaderSimple" },
  "5": { "inputs": { "width": 832, "height": 1216, "batch_size": 1 }, "class_type": "EmptyLatentImage" },
  "6": { "inputs": { "text": "", "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
  "7": { "inputs": { "text": "", "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
  "8": { "inputs": { "samples": ["3", 0], "vae": ["4", 2] }, "class_type": "VAEDecode" },
  "9": { "inputs": { "filename_prefix": "ST_Illustrator", "images": ["8", 0] }, "class_type": "SaveImage" }
}`
};

let imageGalleryDb = [];
let isEvaluating = false;

function loadStorage() {
    try {
        const stored = localStorage.getItem('ia_gallery_records');
        if (stored) imageGalleryDb = JSON.parse(stored);
    } catch {
        imageGalleryDb = [];
    }
}

function saveStorage() {
    try {
        localStorage.setItem('ia_gallery_records', JSON.stringify(imageGalleryDb));
    } catch (e) {
        console.warn('[Illustration Agent] Storage error', e);
    }
}

// 1. Inject UI Drawer
function injectUI() {
    if ($('#ia_main_container').length > 0) return;

    const html = `
    <div id="ia_main_container" class="illustration-agent-settings" style="margin-bottom: 12px;">
        <div class="inline-drawer">
            <!-- Handled natively by SillyTavern's inline-drawer-toggle -->
            <div id="ia_drawer_toggle" class="inline-drawer-toggle inline-drawer-header" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 6px 10px;">
                <b><i class="fa-solid fa-palette" style="margin-right: 6px; color: #ff7675;"></i>Marinara Illustration Agent</b>
                <div id="ia_drawer_icon" class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            
            <div id="ia_drawer_content" class="inline-drawer-content" style="display: none; padding: 12px;">
                <!-- General Section -->
                <div class="ia-section">
                    <div class="ia-section-title"><i class="fa-solid fa-sliders"></i> Core Pipeline Settings</div>
                    
                    <div class="ia-row-inline">
                        <label class="checkbox_label" style="cursor: pointer;">
                            <input type="checkbox" id="ia_enabled">
                            <span><b>Enable Autonomous Illustrator</b></span>
                        </label>
                        <button type="button" id="ia_open_gallery_btn" class="menu_button" style="padding: 3px 8px;">
                            <i class="fa-solid fa-images"></i> Gallery
                        </button>
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
                        <label for="ia_batch_count"><b>Images per generation:</b></label>
                        <input type="number" id="ia_batch_count" class="text_pole" min="1" max="4" value="1">
                    </div>

                    <div class="ia-row">
                        <label for="ia_lookback"><b>Lookback History (Messages):</b></label>
                        <input type="number" id="ia_lookback" class="text_pole" min="1" max="10" value="3">
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
                            <option value="sillytavern">SillyTavern Native (Uses /imagine & Active Config)</option>
                            <option value="comfyui_direct">ComfyUI Direct (Editable Workflow JSON)</option>
                        </select>
                    </div>

                    <div id="ia_comfy_fields" style="display: none;">
                        <div class="ia-row">
                            <label><b>ComfyUI Host URL:</b></label>
                            <input type="text" id="ia_comfy_url" class="text_pole" placeholder="http://127.0.0.1:8188">
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
                            <div>
                                <label><small>Positive Node ID</small></label>
                                <input type="text" id="ia_comfy_pos_node" class="text_pole" value="6">
                            </div>
                            <div>
                                <label><small>Negative Node ID</small></label>
                                <input type="text" id="ia_comfy_neg_node" class="text_pole" value="7">
                            </div>
                            <div>
                                <label><small>Seed Node ID</small></label>
                                <input type="text" id="ia_comfy_seed_node" class="text_pole" value="3">
                            </div>
                        </div>
                        <div class="ia-row" style="margin-top: 6px;">
                            <label><b>ComfyUI API Workflow (JSON):</b></label>
                            <textarea id="ia_comfy_workflow" class="text_pole" rows="6" style="font-family: monospace; font-size: 0.8em;"></textarea>
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

    <!-- Review Modal Container -->
    <div id="ia_review_modal" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <b><i class="fa-solid fa-pen-to-square"></i> Review Scene Illustration Prompt</b>
            <div id="ia_close_review" style="cursor: pointer;"><i class="fa-solid fa-xmark"></i></div>
        </div>
        <div class="ia-row">
            <label><b>Positive Prompt:</b></label>
            <textarea id="ia_rev_positive" class="text_pole" rows="4"></textarea>
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

    <!-- Gallery Modal Container -->
    <div id="ia_gallery_modal" style="display: none;">
        <div class="ia-gallery-header">
            <b><i class="fa-solid fa-images"></i> Illustration Agent Gallery</b>
            <div style="display: flex; gap: 12px; align-items: center;">
                <label class="checkbox_label">
                    <input type="checkbox" id="ia_gallery_flat_toggle">
                    <span>Flat View (Sorted by Date)</span>
                </label>
                <button type="button" id="ia_gallery_close_btn" class="menu_button"><i class="fa-solid fa-xmark"></i> Close</button>
            </div>
        </div>
        <div class="ia-gallery-body">
            <div id="ia_gallery_nav" class="ia-gallery-sidebar"></div>
            <div id="ia_gallery_content" class="ia-gallery-grid"></div>
        </div>
    </div>
    `;

    const container = $('#extensions_settings').length ? $('#extensions_settings') : $('#extensions_settings2');
    container.append(html);

    // Stop inside clicks from bubbling up to any drawer containers
    $('#ia_drawer_content').on('click', (e) => e.stopPropagation());

    $('#ia_open_gallery_btn').on('click', (e) => { e.stopPropagation(); openGallery(); });
    $('#ia_gallery_close_btn').on('click', () => $('#ia_gallery_modal').fadeOut(150));
    $('#ia_close_review, #ia_rev_cancel').on('click', () => $('#ia_review_modal').fadeOut(150));
}

// 2. Settings Binding
function loadSettings() {
    const context = SillyTavern.getContext();
    context.extensionSettings[MODULE_NAME] = Object.assign({}, defaultSettings, context.extensionSettings[MODULE_NAME] || {});
    const s = context.extensionSettings[MODULE_NAME];

    $('#ia_enabled').prop('checked', !!s.enabled);
    $('#ia_pipeline_phase').val(s.pipelinePhase);
    $('#ia_interactive_review').prop('checked', !!s.interactiveReview);
    $('#ia_batch_count').val(s.batchCount);
    $('#ia_lookback').val(s.lookback);
    $('#ia_style_prefix').val(s.stylePrefix);
    $('#ia_default_negative').val(s.defaultNegative);
    $('#ia_marinara_prompt').val(s.marinaraPrompt);

    $('#ia_llm_provider').val(s.llmProvider);
    $('#ia_custom_llm_url').val(s.customLlmUrl);
    $('#ia_custom_llm_key').val(s.customLlmKey);
    $('#ia_custom_llm_model').val(s.customLlmModel);

    $('#ia_img_backend').val(s.imageBackend);
    $('#ia_comfy_url').val(s.comfyUrl);
    $('#ia_comfy_pos_node').val(s.comfyPosNode);
    $('#ia_comfy_neg_node').val(s.comfyNegNode);
    $('#ia_comfy_seed_node').val(s.comfySeedNode);
    $('#ia_comfy_workflow').val(s.comfyWorkflow);

    toggleConditionalFields();
}

function toggleConditionalFields() {
    const s = SillyTavern.getContext().extensionSettings[MODULE_NAME];
    $('#ia_custom_llm_fields').toggle(s.llmProvider === 'custom');
    $('#ia_comfy_fields').toggle(s.imageBackend === 'comfyui_direct');
}

function bindUI() {
    const context = SillyTavern.getContext();
    const save = () => context.saveSettingsDebounced?.();
    const s = context.extensionSettings[MODULE_NAME];

    $('#ia_enabled').on('change', function () { s.enabled = $(this).is(':checked'); save(); });
    $('#ia_pipeline_phase').on('change', function () { s.pipelinePhase = $(this).val(); save(); });
    $('#ia_interactive_review').on('change', function () { s.interactiveReview = $(this).is(':checked'); save(); });
    $('#ia_batch_count').on('change', function () { s.batchCount = Math.max(1, parseInt($(this).val()) || 1); save(); });
    $('#ia_lookback').on('change', function () { s.lookback = Math.max(1, parseInt($(this).val()) || 3); save(); });
    $('#ia_style_prefix').on('input', function () { s.stylePrefix = $(this).val(); save(); });
    $('#ia_default_negative').on('input', function () { s.defaultNegative = $(this).val(); save(); });
    $('#ia_marinara_prompt').on('input', function () { s.marinaraPrompt = $(this).val(); save(); });

    $('#ia_llm_provider').on('change', function () { s.llmProvider = $(this).val(); toggleConditionalFields(); save(); });
    $('#ia_custom_llm_url').on('input', function () { s.customLlmUrl = $(this).val(); save(); });
    $('#ia_custom_llm_key').on('input', function () { s.customLlmKey = $(this).val(); save(); });
    $('#ia_custom_llm_model').on('input', function () { s.customLlmModel = $(this).val(); save(); });

    $('#ia_img_backend').on('change', function () { s.imageBackend = $(this).val(); toggleConditionalFields(); save(); });
    $('#ia_comfy_url').on('input', function () { s.comfyUrl = $(this).val(); save(); });
    $('#ia_comfy_pos_node').on('input', function () { s.comfyPosNode = $(this).val(); save(); });
    $('#ia_comfy_neg_node').on('input', function () { s.comfyNegNode = $(this).val(); save(); });
    $('#ia_comfy_seed_node').on('input', function () { s.comfySeedNode = $(this).val(); save(); });
    $('#ia_comfy_workflow').on('input', function () { s.comfyWorkflow = $(this).val(); save(); });

    $('#ia_manual_eval_btn').on('click', (e) => { e.stopPropagation(); runEvaluation(true); });
    $('#ia_gallery_flat_toggle').on('change', renderGalleryContent);
}

// 3. Evaluator LLM Calls
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

// 4. Main Evaluation Engine
async function runEvaluation(force = false) {
    if (isEvaluating) return;
    const context = SillyTavern.getContext();
    const s = context.extensionSettings[MODULE_NAME];

    if (!context.chat || context.chat.length === 0) return;
    if (!force && !s.enabled) return;

    isEvaluating = true;
    try {
        const recentMessages = context.chat.slice(-s.lookback);
        const lastMsg = recentMessages[recentMessages.length - 1];

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

        toastr.info('Illustration Agent evaluating scene...', 'Marinara');

        const rawResponse = await queryAgentLLM(fullPrompt);
        if (!rawResponse) { isEvaluating = false; return; }

        const cleaned = rawResponse.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON object returned by LLM');
        const result = JSON.parse(jsonMatch[0]);

        console.log('[Illustration Agent Decision]', result);

        if (result.generateBackground) {
            toastr.info(`Background update triggered: ${result.reason}`, 'Marinara');
            const bgPrompt = [s.stylePrefix, result.prompt, 'scenery, landscape, empty scene, no people'].filter(Boolean).join(', ');
            await context.executeSlashCommands(`/bg ${bgPrompt}`);
        }

        if (force || result.shouldGenerate === true) {
            const combinedPos = [s.stylePrefix, result.prompt].filter(Boolean).join(', ');
            const combinedNeg = [s.defaultNegative, result.negativePrompt].filter(Boolean).join(', ');

            if (s.interactiveReview) {
                promptReviewModal(combinedPos, combinedNeg, result.aspectRatio, result);
            } else {
                executeImagePipeline(combinedPos, combinedNeg, result.aspectRatio, result);
            }
        }
    } catch (e) {
        console.error('[Illustration Agent Error]', e);
        toastr.error('Evaluation failed. See browser console.', 'Marinara');
    } finally {
        isEvaluating = false;
    }
}

// 5. Review Modal Handler
function promptReviewModal(pos, neg, ar, metadata) {
    $('#ia_rev_positive').val(pos);
    $('#ia_rev_negative').val(neg);
    $('#ia_rev_ar').val(ar || 'portrait');
    $('#ia_review_modal').fadeIn(150);

    $('#ia_rev_confirm').off('click').on('click', () => {
        $('#ia_review_modal').fadeOut(150);
        executeImagePipeline($('#ia_rev_positive').val(), $('#ia_rev_negative').val(), $('#ia_rev_ar').val(), metadata);
    });
}

// 6. Direct ComfyUI / Image Pipeline Execution
async function executeImagePipeline(positive, negative, aspectRatio, metadata) {
    const context = SillyTavern.getContext();
    const s = context.extensionSettings[MODULE_NAME];
    toastr.success(`Illustrating scene: ${metadata.reason || 'Active Moment'}`, 'Marinara');

    const totalBatch = s.batchCount || 1;

    for (let i = 0; i < totalBatch; i++) {
        if (s.imageBackend === 'comfyui_direct') {
            await executeComfyDirect(positive, negative, aspectRatio, metadata);
        } else {
            await context.executeSlashCommands(`/imagine ${positive}`);
        }
    }
}

async function executeComfyDirect(positive, negative, aspectRatio, metadata) {
    const s = SillyTavern.getContext().extensionSettings[MODULE_NAME];
    try {
        const workflow = JSON.parse(s.comfyWorkflow);

        if (workflow[s.comfyPosNode]) workflow[s.comfyPosNode].inputs.text = positive;
        if (workflow[s.comfyNegNode]) workflow[s.comfyNegNode].inputs.text = negative;
        if (workflow[s.comfySeedNode]) workflow[s.comfySeedNode].inputs.seed = Math.floor(Math.random() * 1000000000);

        const resp = await fetch(`${s.comfyUrl.replace(/\/+$/, '')}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: workflow })
        });
        const data = await resp.json();
        toastr.info(`ComfyUI Prompt Queued (ID: ${data.prompt_id})`, 'Marinara');

        recordImage({
            id: Date.now() + Math.random().toString(36).substr(2, 4),
            character: SillyTavern.getContext().characters?.[SillyTavern.getContext().characterId]?.name || 'Unknown',
            chatId: SillyTavern.getContext().chatId || 'Chat',
            date: new Date().toISOString(),
            positive,
            negative,
            aspectRatio,
            reason: metadata.reason,
            url: ''
        });
    } catch (e) {
        console.error('[ComfyUI Direct Error]', e);
        toastr.error('ComfyUI Direct dispatch failed.', 'Marinara');
    }
}

// 7. Gallery System
function recordImage(entry) {
    imageGalleryDb.unshift(entry);
    saveStorage();
}

function openGallery() {
    renderGalleryNav();
    renderGalleryContent();
    $('#ia_gallery_modal').fadeIn(150);
}

function renderGalleryNav() {
    const $nav = $('#ia_gallery_nav').empty();
    const characters = [...new Set(imageGalleryDb.map(x => x.character))];

    $nav.append(`<div class="ia-section-title" style="padding: 4px 6px;">Characters</div>`);
    characters.forEach(c => {
        $nav.append(`
            <div class="ia-nav-char" data-char="${c}" style="padding: 6px; cursor: pointer; border-radius: 4px; margin-bottom: 2px;">
                <i class="fa-solid fa-user"></i> ${c}
            </div>
        `);
    });

    $('.ia-nav-char').on('click', function() {
        $('.ia-nav-char').css('background', 'transparent');
        $(this).css('background', 'rgba(255,255,255,0.15)');
        renderGalleryContent($(this).data('char'));
    });
}

function renderGalleryContent(filterChar = null) {
    const $grid = $('#ia_gallery_content').empty();
    const isFlat = $('#ia_gallery_flat_toggle').is(':checked');

    let records = [...imageGalleryDb];
    if (!isFlat && filterChar) {
        records = records.filter(r => r.character === filterChar);
    }

    if (records.length === 0) {
        $grid.append(`<div style="opacity: 0.6; padding: 20px;">No illustrations recorded yet.</div>`);
        return;
    }

    records.forEach(r => {
        $grid.append(`
            <div class="ia-card" title="Reason: ${r.reason || 'N/A'}">
                <div style="background: #111; height: 160px; display: flex; align-items: center; justify-content: center; font-size: 2em; color: #555;">
                    <i class="fa-solid fa-image"></i>
                </div>
                <div class="ia-card-meta">
                    <b>${r.character}</b> - <small>${new Date(r.date).toLocaleDateString()}</small><br>
                    <span style="opacity: 0.7;">${(r.positive || '').substring(0, 45)}...</span>
                </div>
            </div>
        `);
    });
}

// 8. In-Chat Reroll / Swipe Buttons
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
    loadStorage();
    injectUI();
    loadSettings();
    bindUI();

    const context = SillyTavern.getContext();
    const { eventSource, eventTypes } = context;

    if (eventSource && eventTypes) {
        eventSource.on(eventTypes.CHAT_COMPLETION_STARTED || 'chat_completion_started', () => {
            if (context.extensionSettings[MODULE_NAME]?.pipelinePhase === 'pre') {
                runEvaluation(false);
            }
        });

        eventSource.on(eventTypes.CHAT_COMPLETION_FINISHED, () => {
            attachInChatMessageButtons();
            const phase = context.extensionSettings[MODULE_NAME]?.pipelinePhase || 'post';
            if (phase === 'post' || phase === 'parallel') {
                runEvaluation(false);
            }
        });
    }

    setInterval(attachInChatMessageButtons, 2000);
    console.log('[Illustration Agent] Marinara Architecture Engine Loaded.');
});