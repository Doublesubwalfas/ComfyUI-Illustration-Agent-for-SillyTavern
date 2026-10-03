function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

export async function saveImageToDisk(blob) {
    const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
    const filename = `agent_${generateId()}.${ext}`;
    const file = new File([blob], filename, { type: blob.type });
    const formData = new FormData();
    formData.append('file', file); // ST expects 'file' or 'image'

    try {
        const res = await fetch('/api/images/upload', { method: 'POST', body: formData });
        if (res.ok) {
            const data = await res.json();
            return data.path || `/user/images/${filename}`; 
        }
    } catch (e) {
        console.warn('Disk upload failed:', e);
    }
    
    toastr.warning('Image shown in chat but could not be saved to disk.');
    return new Promise(res => {
        const reader = new FileReader();
        reader.onloadend = () => res(reader.result);
        reader.readAsDataURL(blob);
    });
}

export async function handleImageOutput(blob, decision, compiledPos, compiledNeg, isBackground, settings, extSettings) {
    const context = SillyTavern.getContext(); 
    
    const pathOrDataUrl = await saveImageToDisk(blob);
    const isDataUrl = pathOrDataUrl.startsWith('data:');
    const viewUrl = pathOrDataUrl; 
    
    const id = generateId();
    const now = Date.now();

    // Insert into chat
    const md = `![Illustration](${viewUrl})`;
    await context.appendChatMessages([{
        name: 'Illustrator',
        is_user: false, is_system: true,
        mes: md,
        extra: { comfyui_illustration_agent: true, prompt: compiledPos, negative: compiledNeg }
    }]);

    // Per-chat index
    const meta = context.chatMetadata || window.chat_metadata || {};
    if (!meta.comfyui_illustration_agent) meta.comfyui_illustration_agent = {};
    if (!meta.comfyui_illustration_agent.gallery) meta.comfyui_illustration_agent.gallery = [];
    
    const entry = {
        id, filename: pathOrDataUrl.split('/').pop(), relPath: pathOrDataUrl,
        prompt: compiledPos, negativePrompt: compiledNeg, style: decision.style,
        aspectRatio: decision.aspectRatio, characters: decision.characters || [],
        createdAt: now, messageIndex: context.chat.length - 1, viewUrl, isBackground
    };
    
    meta.comfyui_illustration_agent.gallery.push(entry);

    if (isBackground && settings.autoApplyBackground) {
        meta.comfyui_illustration_agent.activeBackgroundId = id;
        try {
            await context.SlashCommandParser.commands['bg'].callback({ _scope: null }, viewUrl, false);
        } catch (e) {
            $('#bg1').attr('src', viewUrl); // Super fallback
            toastr.warning('Image saved to gallery but background could not be applied via command.');
        }
    }

    context.saveMetadataDebounced();

    // Global Index
    if (!isDataUrl) {
        if (!extSettings.globalGallery) extSettings.globalGallery = [];
        extSettings.globalGallery.push({
            id, characterNames: decision.characters || [],
            chatId: context.chatId, chatName: context.chatId, 
            relPath: pathOrDataUrl, prompt: compiledPos, negativePrompt: compiledNeg,
            style: decision.style, aspectRatio: decision.aspectRatio, createdAt: now, isBackground
        });
        
        if (extSettings.globalGallery.length > 5000) {
            toastr.warning('Global gallery exceeds 5000 entries. Please prune it in settings.');
        }
        
        context.saveSettingsDebounced();
    }
}

export function mountGalleryDrawer(extSettings) {
    if ($('#comfy-agent-gallery-drawer').length) return;
    
    const html = `
    <div id="comfy-agent-gallery-drawer">
        <div class="gallery-header">
            <h3>Illustration Gallery</h3>
            <div class="gallery-tabs">
                <div class="gallery-tab active" data-target="tab-local">This Chat</div>
                <div class="gallery-tab" data-target="tab-global">Character Gallery</div>
            </div>
            <div class="close-btn" id="cagd-close">&times;</div>
        </div>
        <div class="gallery-body" id="cagd-tab-local">
            <div class="comfy-memory-inspector" id="cagd-memory-view"></div>
            <div class="comfy-gallery-grid" id="cagd-local-grid"></div>
        </div>
        <div class="gallery-body comfy-global-layout" id="cagd-tab-global" style="display:none;">
            <div class="comfy-sidebar" id="cagd-global-sidebar"></div>
            <div class="comfy-global-content">
                <input type="text" id="cagd-global-search" placeholder="Search prompts..." class="text_pole" style="margin-bottom: 15px;">
                <div class="comfy-gallery-grid" id="cagd-global-grid"></div>
            </div>
        </div>
    </div>`;
    $('body').append(html);

    $('#cagd-close').on('click', () => $('#comfy-agent-gallery-drawer').removeClass('open'));
    $('.gallery-tab').on('click', function() {
        $('.gallery-tab').removeClass('active');
        $(this).addClass('active');
        $('.gallery-body').hide();
        $(`#cagd-${$(this).data('target')}`).show();
        renderGalleryData(extSettings);
    });
}

export function renderGalleryData(extSettings) {
    const context = SillyTavern.getContext(); 
    const meta = context.chatMetadata?.comfyui_illustration_agent || {};
    
    // Memory Inspector
    const memDiv = $('#cagd-memory-view').empty();
    memDiv.append('<h4>Active Appearance Memory (This Chat)</h4>');
    if (meta.characterRefs && Object.keys(meta.characterRefs).length > 0) {
        for (const [char, data] of Object.entries(meta.characterRefs)) {
            const block = $(`<div class="comfy-memory-char"><b>${char}:</b></div>`);
            data.appearanceTags.forEach(tag => block.append(`<span class="comfy-memory-tag">${tag}</span>`));
            memDiv.append(block);
        }
    } else {
        memDiv.append('<i>No appearance data gathered yet.</i>');
    }

    // Local Grid
    const localGrid = $('#cagd-local-grid').empty();
    (meta.gallery || []).slice().reverse().forEach(img => {
        localGrid.append(`
            <div class="comfy-gallery-item">
                <img src="${img.viewUrl}" onclick="window.open('${img.viewUrl}', '_blank')">
                <div class="item-details">
                    <div class="item-prompt" title="${img.prompt}">${img.prompt}</div>
                    <i>${new Date(img.createdAt).toLocaleDateString()}</i>
                    <div class="item-actions">
                        <button class="comfy-btn" onclick="document.getElementById('chat_input').value = '/draw '+${JSON.stringify(img.prompt.substring(0,30))};">Recall</button>
                    </div>
                </div>
            </div>
        `);
    });

    // Global Sidebar
    const globalSidebar = $('#cagd-global-sidebar').empty();
    const globalGallery = extSettings.globalGallery || [];
    const chars = {};
    globalGallery.forEach(g => {
        (g.characterNames || []).forEach(c => chars[c] = (chars[c] || 0) + 1);
    });
    
    globalSidebar.append(`<div class="char-filter active" data-char="ALL">All Characters <span class="char-count-badge">${globalGallery.length}</span></div>`);
    Object.entries(chars).sort((a,b) => b[1] - a[1]).forEach(([c, count]) => {
        globalSidebar.append(`<div class="char-filter" data-char="${c}">${c} <span class="char-count-badge">${count}</span></div>`);
    });

    $('.char-filter').on('click', function() {
        $('.char-filter').removeClass('active');
        $(this).addClass('active');
        renderGlobalGrid(extSettings, $(this).data('char'), $('#cagd-global-search').val());
    });

    $('#cagd-global-search').off('input').on('input', function() {
        renderGlobalGrid(extSettings, $('.char-filter.active').data('char'), $(this).val());
    });

    renderGlobalGrid(extSettings, 'ALL', '');
}

function renderGlobalGrid(extSettings, activeChar, searchStr) {
    const grid = $('#cagd-global-grid').empty();
    let items = extSettings.globalGallery || [];
    
    if (activeChar !== 'ALL') items = items.filter(g => (g.characterNames || []).includes(activeChar));
    if (searchStr) items = items.filter(g => g.prompt.toLowerCase().includes(searchStr.toLowerCase()));

    items.slice().reverse().forEach(img => {
        grid.append(`
            <div class="comfy-gallery-item">
                <img src="${img.relPath}" onclick="window.open('${img.relPath}', '_blank')">
                <div class="item-details">
                    <div class="item-prompt" title="${img.prompt}">${img.prompt}</div>
                    <i>${img.chatName || 'Unknown Chat'}</i>
                </div>
            </div>
        `);
    });
}