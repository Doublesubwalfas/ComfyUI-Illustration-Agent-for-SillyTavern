import {
    getSettings, saveSettings, DEFAULT_PROMPTS, DEFAULT_MODE2_INJECTION,
    DEFAULT_AGENT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT_TEMPLATE, notify
} from './config.js';
import { getCtx, escapeHtml, clamp } from './util.js';
import { queryAgentLLM, illustrateMessage, cancelAll, syncMode2Injection } from './agent.js';
import { pingComfy, migrateLegacyImages } from './comfy.js';
import { initDialogs } from './dialogs.js';
import { initGallery, openGallery } from './gallery.js';
import { on, emit } from './bus.js';

const $r = (sel) => $('#ia_main_container').find(sel);

// ---- tiny field builders (each field carries data-ia="<settings key>") -----
const chk = (key, label, hint = '') =>
    `<label class="checkbox_label" title="${escapeHtml(hint)}"><input type="checkbox" data-ia="${key}"><span>${label}</span></label>`;
const num = (key, label, min, max, step = 1) =>
    `<label class="ia-field"><span>${label}</span><input type="number" class="text_pole" data-ia="${key}" data-type="${step % 1 ? 'float' : 'int'}" min="${min}" max="${max}" step="${step}"></label>`;
const txt = (key, label, ph = '', type = 'text') =>
    `<label class="ia-field"><span>${label}</span><input type="${type}" class="text_pole" data-ia="${key}" placeholder="${escapeHtml(ph)}" autocomplete="off"></label>`;
const sel = (key, label, opts, type = 'text') =>
    `<label class="ia-field"><span>${label}</span><select class="text_pole" data-ia="${key}" data-type="${type}">${opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>`;
const area = (key, label, rows, mono = false) =>
    `<label class="ia-field"><span>${label}</span><textarea class="text_pole${mono ? ' ia-mono' : ''}" rows="${rows}" data-ia="${key}"></textarea></label>`;
const section = (icon, title, body, open = false) =>
    `<details class="ia-sec"${open ? ' open' : ''}><summary><i class="fa-solid ${icon}"></i> ${title}</summary><div class="ia-sec-body">${body}</div></details>`;

function buildHtml() {
    return `
<div id="ia_main_container" class="ia-root">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b><i class="fa-solid fa-palette" style="color:#ff7675;margin-right:6px"></i>Illustration Agent</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content" style="display:none;">

      <div class="ia-topbar">
        ${chk('enabled', '<b>Enabled</b>', 'Master switch')}
        <span id="ia_status" class="ia-status">Idle</span>
      </div>
      <div class="ia-btnrow">
        <button type="button" id="ia_open_gallery" class="menu_button"><i class="fa-solid fa-images"></i> Gallery</button>
        <button type="button" id="ia_eval_now" class="menu_button"><i class="fa-solid fa-bolt"></i> Illustrate last message</button>
        <button type="button" id="ia_cancel" class="menu_button" title="Cancel running and queued jobs"><i class="fa-solid fa-ban"></i></button>
      </div>

      ${section('fa-robot', 'Agent', `
        ${sel('agentMode', 'Mode', [
            ['mode1', '1 · Autonomous (decides by itself)'],
            ['mode2', '2 · Tag-triggered (<image> / <scene>)'],
            ['mode3', '3 · Every N messages']])}
        <small id="ia_mode_hint" class="ia-muted"></small>

        <div data-ia-mode="mode1" class="ia-group">
          ${chk('fastGate', 'Local pre-filter (skip the LLM on pure dialogue)', 'Free, instant keyword scoring of the narration. Strongly recommended.')}
          ${sel('gateSensitivity', 'Pre-filter sensitivity', [['1', 'High: any visual hint'], ['2', 'Medium (recommended)'], ['4', 'Low: clear visual beats only']], 'int')}
          ${txt('extraCues', 'Extra trigger words (comma separated)', 'e.g. cosplay, onsen, katana')}
          ${num('cooldown', 'Cooldown (assistant turns between auto-illustrations)', 0, 20)}
        </div>
        <div data-ia-mode="mode2" class="ia-group">
          ${chk('mode2Inject', 'Automatically add the instruction below to the chat prompt', 'Without this you must paste it into your card or Author\'s Note yourself.')}
          ${chk('mode2SkipLLM', 'Fast: use the tag text directly (no LLM call)', 'Skips tag compilation. Best for natural-language image models.')}
          ${area('mode2InjectionText', 'Instruction sent to the roleplay model', 5, true)}
          <button type="button" id="ia_reset_m2" class="menu_button">Reset instruction</button>
        </div>
        <div data-ia-mode="mode3" class="ia-group">
          ${num('triggerInterval', 'Generate every N assistant messages', 1, 20)}
        </div>

        ${num('lookback', 'Lookback (messages the evaluator reads)', 1, 10)}
        ${chk('includeThinking', 'Include &lt;think&gt; blocks in the evaluator context')}
        ${num('batchCount', 'Images per generation', 1, 4)}
        ${chk('interactiveReview', 'Review and edit the prompt before generating')}
        ${sel('deliveryMode', 'Delivery', [['attached', 'Append to the assistant message'], ['separate', 'Separate comment card']])}
        ${sel('toasts', 'Notifications', [['normal', 'Normal'], ['quiet', 'Quiet (errors and warnings only)']])}
        ${sel('lockSend', 'Send button while the agent works', [
            ['all', 'Turn into Stop (during LLM decision and image rendering)'],
            ['eval', 'Turn into Stop (during LLM decision only)'],
            ['off', 'Leave the Send button alone']])}
        <small class="ia-muted">Pressing Stop cancels the agent's current and queued work, just like stopping a roleplay reply.</small>
      `, true)}

      ${section('fa-brain', 'Evaluator LLM', `
        ${sel('llmProvider', 'Source', [
            ['current', 'Current chat model (isolated prompt)'],
            ['profile', 'Connection Profile (recommended: a small, fast model)'],
            ['custom', 'Custom OpenAI-compatible API']])}
        <div data-ia-llm="profile" class="ia-group">
          ${sel('connectionProfile', 'Profile', [['', '(none)']])}
        </div>
        <div data-ia-llm="custom" class="ia-group">
          ${txt('customLlmUrl', 'API base URL', 'https://api.openai.com/v1')}
          ${txt('customLlmKey', 'API key', '', 'password')}
          ${txt('customLlmModel', 'Model', 'gpt-4o-mini')}
          <small class="ia-muted">The key is stored in your SillyTavern settings. The browser calls this API directly, so the provider must allow CORS.</small>
        </div>
        ${num('llmTimeoutSec', 'Timeout (seconds)', 5, 300)}
        <button type="button" id="ia_test_llm" class="menu_button"><i class="fa-solid fa-plug"></i> Test evaluator</button>
      `)}

      ${section('fa-wand-magic-sparkles', 'Image generation', `
        ${sel('imageBackend', 'Backend', [['comfyui', 'ComfyUI workflow (full control)'], ['sd_command', 'SillyTavern /sd (Image Generation extension)']])}
        <div data-ia-img="comfyui" class="ia-group">
          ${sel('comfyTransport', 'Connection', [['server', 'Through SillyTavern server (works on phones and tunnels)'], ['direct', 'Direct from browser (advanced; needs CORS)']])}
          ${txt('comfyUrl', 'ComfyUI URL (as seen from the SillyTavern host)', 'http://127.0.0.1:8188')}
          <div data-ia-tr="direct">${chk('comfyRewriteHost', 'Rewrite localhost to the browser host (direct mode only)')}</div>
          ${num('comfyTimeoutSec', 'Generation timeout (seconds)', 30, 1800)}
          <div class="ia-grid2">
            ${txt('comfyModel', 'Model (%model%)')}
            ${txt('comfyClip', 'CLIP (%clip%)')}
            ${txt('comfyVae', 'VAE (%vae%)')}
            ${num('comfySteps', 'Steps (%steps%)', 1, 150)}
            ${num('comfyCfg', 'CFG (%cfg%)', 0, 30, 0.1)}
            ${txt('comfySampler', 'Sampler (%sampler%)')}
            ${txt('comfyScheduler', 'Scheduler (%scheduler%)')}
          </div>
          <div class="ia-preset-bar">
            <select id="ia_wf_select" class="text_pole"></select>
            <button type="button" id="ia_wf_save" class="menu_button" title="Save preset"><i class="fa-solid fa-floppy-disk"></i></button>
            <button type="button" id="ia_wf_add" class="menu_button" title="Save as new"><i class="fa-solid fa-plus"></i></button>
            <button type="button" id="ia_wf_del" class="menu_button" title="Delete preset"><i class="fa-solid fa-trash"></i></button>
          </div>
          <textarea id="ia_wf_text" class="text_pole ia-mono" rows="8" spellcheck="false"></textarea>
          <div id="ia_wf_badges" class="ia-badges"></div>
          <button type="button" id="ia_test_comfy" class="menu_button"><i class="fa-solid fa-plug"></i> Test ComfyUI</button>
        </div>
        <div data-ia-img="sd_command" class="ia-group"><small class="ia-muted">Uses the Image Generation extension's own settings. Resolution, negative prompt and workflow below do not apply.</small></div>
        <div class="ia-grid3">
          ${num('resPortraitW', 'Portrait W', 64, 4096, 8)}${num('resPortraitH', 'Portrait H', 64, 4096, 8)}<span></span>
          ${num('resLandscapeW', 'Land. W', 64, 4096, 8)}${num('resLandscapeH', 'Land. H', 64, 4096, 8)}<span></span>
          ${num('resSquareW', 'Square W', 64, 4096, 8)}${num('resSquareH', 'Square H', 64, 4096, 8)}<span></span>
        </div>
      `)}

      ${section('fa-file-code', 'Prompts', `
        ${txt('stylePrefix', 'Style prefix')}
        ${txt('defaultNegative', 'Default negative prompt')}

        <label class="ia-field"><span>Agent system prompt (role and character-fidelity rules)</span>
          <textarea id="ia_sys_prompt" class="text_pole ia-mono" rows="10" spellcheck="false"></textarea></label>
        <button type="button" id="ia_reset_sys" class="menu_button">Reset system prompt</button>

        <label class="ia-field"><span>User prompt template (uses the placeholders shown below)</span>
          <textarea id="ia_user_tpl" class="text_pole ia-mono" rows="14" spellcheck="false"></textarea></label>
        <div id="ia_tpl_badges" class="ia-badges"></div>
        <button type="button" id="ia_reset_tpl" class="menu_button">Reset user prompt template</button>

        <label class="ia-field"><span>Evaluator instructions (edits apply to the current mode)</span>
          <textarea id="ia_schema" class="text_pole ia-mono" rows="10" spellcheck="false"></textarea></label>
        <div id="ia_schema_badges" class="ia-badges"></div>
        <button type="button" id="ia_reset_schema" class="menu_button">Reset evaluator instructions</button>
      `)}

      ${section('fa-images', 'Gallery and storage', `
        ${chk('showBubble', 'Show the floating gallery bubble')}
        ${num('uiScale', 'Gallery size (% of normal; raise it if controls feel small)', 80, 160, 5)}
        ${sel('galleryColumns', 'Gallery columns', [['auto', 'Automatic'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']])}
        ${chk('thumbnails', 'Create small thumbnails (much faster gallery on phones)')}
        ${chk('deleteFilesOnRemove', 'Also delete image files from the server when removing from the gallery', 'Chat messages that still contain those images will show broken links.')}
        <button type="button" id="ia_repair" class="menu_button"><i class="fa-solid fa-screwdriver-wrench"></i> Repair old images</button>
        <small class="ia-muted">Images from v2.x were saved as links to 127.0.0.1:8188 and cannot load on other devices. Press this once <b>on the PC running ComfyUI</b> (ComfyUI must be running) to copy them onto the SillyTavern server.</small>
      `)}
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Declarative binding
// ---------------------------------------------------------------------------
function readValue(el) {
    const type = el.dataset.type || (el.type === 'checkbox' ? 'bool' : 'text');
    if (type === 'bool') return el.checked;
    if (type === 'int' || type === 'float') {
        const n = type === 'int' ? parseInt(el.value, 10) : parseFloat(el.value);
        if (Number.isNaN(n)) return undefined;
        const min = el.min !== '' ? Number(el.min) : -Infinity, max = el.max !== '' ? Number(el.max) : Infinity;
        return clamp(n, min, max);
    }
    return el.value;
}

function bindFields() {
    const s = getSettings();
    document.querySelectorAll('#ia_main_container [data-ia]').forEach(el => {
        const key = el.dataset.ia;
        if (el.type === 'checkbox') el.checked = !!s[key];
        else el.value = s[key] ?? '';
        const evt = (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'number') ? 'change' : 'input';
        el.addEventListener(evt, () => {
            const v = readValue(el);
            if (v === undefined) { el.value = s[key] ?? ''; return; }
            s[key] = v;
            saveSettings();
            onSettingChanged(key);
        });
    });
}

function onSettingChanged(key) {
    if (key === 'agentMode') { refreshVisibility(); loadSchema(); }
    if (['enabled', 'agentMode', 'mode2Inject', 'mode2InjectionText'].includes(key)) syncMode2Injection();
    if (['llmProvider', 'imageBackend', 'comfyTransport'].includes(key)) refreshVisibility();
    if (key === 'llmProvider') refreshProfiles();
    if (['showBubble', 'uiScale', 'galleryColumns'].includes(key)) emit('ui');
}

const HINTS = {
    mode1: 'Senses each reply locally (free), asks the LLM only when something visual happened, then illustrates. Cooldown prevents spam.',
    mode2: 'Idle until the roleplay model writes an <image>/<scene> tag. No tag means no LLM call and no image.',
    mode3: 'Illustrates the most visual beat every N assistant messages, with no decision step.'
};

function refreshVisibility() {
    const s = getSettings();
    $('#ia_mode_hint').text(HINTS[s.agentMode] || '');
    $('[data-ia-mode]').each(function () { $(this).toggle($(this).data('iaMode') === s.agentMode); });
    $('[data-ia-llm]').each(function () { $(this).toggle($(this).data('iaLlm') === s.llmProvider); });
    $('[data-ia-img]').each(function () { $(this).toggle($(this).data('iaImg') === s.imageBackend); });
    $('[data-ia-tr]').each(function () { $(this).toggle($(this).data('iaTr') === s.comfyTransport); });
}

function refreshProfiles() {
    try {
        const s = getSettings();
        const ctx = getCtx();
        let profiles = [];
        try { profiles = ctx.ConnectionManagerRequestService?.getSupportedProfiles?.() || []; } catch (_) {}
        if (!profiles.length) {
            const raw = ctx.extensionSettings?.connectionManager?.profiles;
            profiles = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
        }
        const $sel = $('[data-ia="connectionProfile"]').empty().append('<option value="">(none)</option>');
        if (Array.isArray(profiles)) {
            profiles.forEach(p => {
                if (p && (p.id || p.name)) $sel.append(`<option value="${escapeHtml(p.id || p.name)}">${escapeHtml(p.name || p.id)}</option>`);
            });
        }
        $sel.val(s.connectionProfile || '');
    } catch (e) {
        console.warn('[Illustration Agent] Failed to refresh profiles', e);
    }
}

// ---- prompt editor (per mode) ------------------------------------------------
const schemaKey = () => ({ mode1: 'promptMode1', mode2: 'promptMode2', mode3: 'promptMode3' }[getSettings().agentMode] || 'promptMode1');

function loadSchema() {
    $('#ia_schema').val(getSettings()[schemaKey()]);
    updateBadges();
}

function badge(label, ok, hint) {
    return `<span class="ia-badge ${ok ? 'active' : 'inactive'}" title="${escapeHtml(hint)}">${ok ? '✓' : '✗'} ${escapeHtml(label)}</span>`;
}

function updateBadges() {
    const schema = $('#ia_schema').val() || '';
    $('#ia_schema_badges').html(['decision', 'description', 'prompt', 'negativePrompt', 'aspectRatio']
        .map(k => badge(k, schema.includes(k), 'JSON key the evaluator must return')).join(''));

    const wf = $('#ia_wf_text').val() || '';
    let valid = true;
    try { JSON.parse(wf); } catch { valid = false; }
    const macros = ['%prompt%', '%negative_prompt%', '%seed%', '%steps%', '%cfg%', '%sampler%', '%scheduler%', '%denoise%', '%width%', '%height%', '%model%', '%clip%', '%vae%'];
    $('#ia_wf_badges').html(badge('valid JSON', valid, 'The workflow must parse') + macros.map(m => badge(m, wf.includes(m), 'Workflow macro')).join(''));
}

// ---- system prompt & user prompt template ------------------------------------
const TPL_PLACEHOLDERS = [
    'schema', 'characters', 'userReference',
    'recentContext', 'tagBlock', 'speaker', 'response'
];

function loadAgentPrompts() {
    const s = getSettings();
    $('#ia_sys_prompt').val(s.agentSystemPrompt || DEFAULT_AGENT_SYSTEM_PROMPT);
    $('#ia_user_tpl').val(s.userPromptTemplate || DEFAULT_USER_PROMPT_TEMPLATE);
    updateTplBadges();
}

function updateTplBadges() {
    const tpl = $('#ia_user_tpl').val() || '';
    $('#ia_tpl_badges').html(TPL_PLACEHOLDERS
        .map(k => badge(`{{${k}}}`, tpl.includes(`{{${k}}}`), 'Template placeholder'))
        .join(''));
}

// ---- workflow presets ---------------------------------------------------------
function refreshPresets() {
    const s = getSettings();
    $('#ia_wf_select').empty();
    Object.keys(s.workflowPresets || {}).forEach(n => $('#ia_wf_select').append(`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`));
    $('#ia_wf_select').val(s.selectedWorkflowPreset);
    $('#ia_wf_text').val(s.activeWorkflowText);
}

function workflowTextValid() {
    try { JSON.parse($('#ia_wf_text').val()); return true; }
    catch (e) { notify('error', 'Workflow is not valid JSON: ' + e.message); return false; }
}

function bindWorkflow() {
    const s = getSettings();
    $('#ia_wf_text').on('input', function () { s.activeWorkflowText = $(this).val(); saveSettings(); updateBadges(); });
    $('#ia_wf_select').on('change', function () {
        const n = $(this).val();
        if (!s.workflowPresets[n]) return;
        s.selectedWorkflowPreset = n; s.activeWorkflowText = s.workflowPresets[n];
        $('#ia_wf_text').val(s.activeWorkflowText); updateBadges(); saveSettings();
    });
    $('#ia_wf_save').on('click', () => {
        if (!workflowTextValid()) return;
        s.workflowPresets[s.selectedWorkflowPreset] = $('#ia_wf_text').val(); saveSettings();
        notify('success', `Saved preset "${s.selectedWorkflowPreset}"`);
    });
    $('#ia_wf_add').on('click', () => {
        const name = (prompt('Name for the new workflow preset:') || '').trim();
        if (!name || !workflowTextValid()) return;
        s.workflowPresets[name] = $('#ia_wf_text').val();
        s.selectedWorkflowPreset = name; s.activeWorkflowText = s.workflowPresets[name];
        refreshPresets(); saveSettings();
    });
    $('#ia_wf_del').on('click', () => {
        const n = s.selectedWorkflowPreset;
        if (n.startsWith('Default')) { notify('warning', 'The built-in preset cannot be deleted.'); return; }
        if (!confirm(`Delete workflow preset "${n}"?`)) return;
        delete s.workflowPresets[n];
        s.selectedWorkflowPreset = Object.keys(s.workflowPresets)[0];
        s.activeWorkflowText = s.workflowPresets[s.selectedWorkflowPreset];
        refreshPresets(); updateBadges(); saveSettings();
    });
}

// ---------------------------------------------------------------------------
export function setupUI() {
    if ($('#ia_main_container').length) return;

    // Guaranteed mount target: prioritizes standard visible panel
    let $host = $('#ia_settings_mount');
    if (!$host.length) $host = $('#extensions_settings');
    if (!$host.length) $host = $('#extensions_settings2');

    if (!$host.length) {
        // DOM not ready yet, retry in 200ms
        setTimeout(setupUI, 200);
        return;
    }

    $host.append(buildHtml());

    // Drawer toggle click listener
    $('#ia_main_container .inline-drawer-toggle').off('click').on('click', function (e) {
        e.stopPropagation();
        const $content = $(this).next('.inline-drawer-content');
        const $icon = $(this).find('.inline-drawer-icon');
        $content.slideToggle(200);
        $icon.toggleClass('down up');
    });

    try { initDialogs(); } catch (e) { console.warn(e); }
    try { initGallery(); } catch (e) { console.warn(e); }
    try { bindFields(); } catch (e) { console.warn(e); }
    try { bindWorkflow(); } catch (e) { console.warn(e); }
    try { refreshPresets(); } catch (e) { console.warn(e); }
    try { refreshProfiles(); } catch (e) { console.warn(e); }
    try { refreshVisibility(); } catch (e) { console.warn(e); }
    try { loadSchema(); } catch (e) { console.warn(e); }
    try { loadAgentPrompts(); } catch (e) { console.warn(e); }

    const s = getSettings();
    $('#ia_schema').on('input', function () { s[schemaKey()] = $(this).val(); saveSettings(); updateBadges(); });
    $('#ia_reset_schema').on('click', () => {
        if (!confirm('Reset the evaluator instructions for the current mode?')) return;
        s[schemaKey()] = DEFAULT_PROMPTS[schemaKey()]; saveSettings(); loadSchema();
    });

    $('#ia_sys_prompt').on('input', function () {
        s.agentSystemPrompt = $(this).val();
        saveSettings();
    });
    $('#ia_user_tpl').on('input', function () {
        s.userPromptTemplate = $(this).val();
        saveSettings();
        updateTplBadges();
    });
    $('#ia_reset_sys').on('click', () => {
        if (!confirm('Reset the agent system prompt to its default?')) return;
        s.agentSystemPrompt = DEFAULT_AGENT_SYSTEM_PROMPT;
        saveSettings();
        $('#ia_sys_prompt').val(DEFAULT_AGENT_SYSTEM_PROMPT);
    });
    $('#ia_reset_tpl').on('click', () => {
        if (!confirm('Reset the user prompt template to its default?')) return;
        s.userPromptTemplate = DEFAULT_USER_PROMPT_TEMPLATE;
        saveSettings();
        $('#ia_user_tpl').val(DEFAULT_USER_PROMPT_TEMPLATE);
        updateTplBadges();
    });

    $('#ia_reset_m2').on('click', () => {
        s.mode2InjectionText = DEFAULT_MODE2_INJECTION; saveSettings();
        $('[data-ia="mode2InjectionText"]').val(DEFAULT_MODE2_INJECTION); syncMode2Injection();
    });

    $('#ia_open_gallery').on('click', openGallery);
    $('#ia_eval_now').on('click', () => illustrateMessage());
    $('#ia_cancel').on('click', cancelAll);

    $('#ia_test_llm').on('click', async () => {
        const t0 = performance.now();
        try {
            const r = await queryAgentLLM('Reply with the single word READY.');
            toastr.success(`Evaluator online (${Math.round(performance.now() - t0)} ms): ${String(r || '').trim().slice(0, 40)}`, 'Diagnostics');
        } catch (e) { toastr.error(`Evaluator failed: ${e.message}`, 'Diagnostics'); }
    });
    $('#ia_test_comfy').on('click', async () => {
        const t0 = performance.now();
        try {
            const where = await pingComfy();
            toastr.success(`ComfyUI reachable at ${where} (${Math.round(performance.now() - t0)} ms)`, 'Diagnostics');
        } catch (e) { toastr.error(e.message, 'Diagnostics'); }
    });
    $('#ia_repair').on('click', async function () {
        const $b = $(this).prop('disabled', true);
        try {
            const r = await migrateLegacyImages((n, t) => $b.html(`<i class="fa-solid fa-spinner fa-spin"></i> ${n}/${t}`));
            if (!r.total) toastr.info('No old-style images found. Nothing to repair.', 'Repair');
            else toastr[r.fail ? 'warning' : 'success'](`Repaired ${r.ok} of ${r.total} image(s).${r.fail ? ` ${r.fail} could not be fetched from ComfyUI (run this on the ComfyUI PC).` : ''}`, 'Repair');
        } finally { $b.prop('disabled', false).html('<i class="fa-solid fa-screwdriver-wrench"></i> Repair old images'); }
    });

    on('status', (state, detail) => {
        const label = { idle: 'Idle', evaluating: 'Evaluating…', generating: 'Generating…' }[state] || state;
        $('#ia_status').text(detail ? `${label} (${detail})` : label).attr('data-state', state);
    });
}