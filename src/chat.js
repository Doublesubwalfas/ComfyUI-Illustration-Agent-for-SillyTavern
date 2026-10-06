import { getCtx, debounce, hashString, normalizeUrl, slashSafe } from './util.js';
import { getSettings, notify, lookupByUrl, hasGalleryImages } from './config.js';

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------
const TAG_PRESENT = /<(?:image|scene)>/i;

export function cleanTriggerTags(text) {
    if (!text || typeof text !== 'string') return text;
    return text
        .replace(/([*_]{1,2})\s*<(image|scene)>[\s\S]*?<\/\2>\s*\1/gi, '')   // *<image>..</image>*
        .replace(/[ \t]*<(image|scene)>[\s\S]*?<\/\1>/gi, '')
        .replace(/[ \t]*<(?:image|scene)>[\s\S]*$/i, '')                         // unclosed tag (cut-off reply)
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function stripThinkingTags(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export function stripImageMarkdown(text) {
    return String(text || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
}

// MUST run on RAW text; cleanTriggerTags() removes what this reads.
export function extractVisualTags(text) {
    const out = { image: null, scene: null };
    if (!text || typeof text !== 'string') return out;
    const grab = (name) => {
        const closed = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i').exec(text);
        if (closed && closed[1].trim()) return closed[1].trim();
        const open = new RegExp(`<${name}>([\\s\\S]{1,400})$`, 'i').exec(text);   // unclosed
        return open && open[1].trim() ? open[1].trim() : null;
    };
    out.image = grab('image');
    out.scene = grab('scene');
    return out;
}

export function readTags(msg) {
    let t = extractVisualTags(msg?.mes || '');
    if (!t.image && !t.scene && Array.isArray(msg?.swipes) && msg.swipes.length) {
        const i = msg.swipe_id ?? msg.swipes.length - 1;
        t = extractVisualTags(msg.swipes[i] || '');
    }
    return { ...t, has: !!(t.image || t.scene) };
}

export function contentSig(msg) {
    return hashString(stripImageMarkdown(cleanTriggerTags(msg?.mes || '')));
}

// ---------------------------------------------------------------------------
// Message plumbing
// ---------------------------------------------------------------------------
export const queueSave = debounce(() => persistChat(), 1200);

export async function persistChat() {
    const ctx = getCtx();
    try {
        if (typeof ctx.saveChat === 'function') await ctx.saveChat();
    } catch (e) { console.warn('[Illustration Agent] Failed to save chat', e); }
}

function refreshMessage(idx) {
    const ctx = getCtx();
    try {
        if (typeof ctx.updateMessageBlock === 'function') {
            ctx.updateMessageBlock(idx, ctx.chat[idx]);
            return true;
        }
    } catch (e) { console.warn('[Illustration Agent] updateMessageBlock failed', e); }
    return false;
}

export function lastAssistantIndex() {
    const chat = getCtx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user && !chat[i].is_system) return i;
    return null;
}

// Remove <image>/<scene> tags from a message (and its swipes) once they've been read.
export function stripTagsInMessage(idx) {
    const msg = getCtx().chat?.[idx];
    if (!msg || msg.is_user) return false;
    let changed = false;
    if (TAG_PRESENT.test(msg.mes || '')) { msg.mes = cleanTriggerTags(msg.mes); changed = true; }
    if (Array.isArray(msg.swipes)) {
        msg.swipes.forEach((sw, i) => {
            if (typeof sw === 'string' && TAG_PRESENT.test(sw)) { msg.swipes[i] = cleanTriggerTags(sw); changed = true; }
        });
    }
    if (changed) { refreshMessage(idx); queueSave(); }
    return changed;
}

// A target is a *reference* to the message an image belongs to, captured when the
// decision is made. Generation can take a minute; the chat may move on or change.
export function snapshotTarget(idx) {
    const ctx = getCtx();
    const m = ctx.chat?.[idx];
    if (!m) return null;
    return { chatId: ctx.chatId, idx, sendDate: m.send_date, name: m.name };
}

export function resolveTarget(t) {
    const ctx = getCtx();
    if (!t || ctx.chatId !== t.chatId) return null;
    const chat = ctx.chat || [];
    if (chat[t.idx] && chat[t.idx].send_date === t.sendDate) return t.idx;
    const i = chat.findIndex(m => m.send_date === t.sendDate && m.name === t.name);
    return i >= 0 ? i : null;
}

const cleanAlt = (d) => String(d || 'Scene illustration').replace(/[\[\]()\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

export async function deliverRoleplayImage(url, description, target = null) {
    const ctx = getCtx();
    if (!ctx?.chat?.length) return false;
    const s = getSettings();
    const alt = cleanAlt(description);

    if (s.deliveryMode === 'separate') {
        if (target && ctx.chatId !== target.chatId) {
            notify('warning', 'Chat changed while generating. Image saved to the Gallery only.');
            return false;
        }
        await ctx.executeSlashCommands(`/comment ${slashSafe(`![${alt}](${url})`)}`);
        notify('success', 'Illustration added as a separate card.');
        return true;
    }

    const idx = target ? resolveTarget(target) : lastAssistantIndex();
    if (idx == null) {
        notify('warning', 'Chat changed while generating. Image saved to the Gallery only.');
        return false;
    }

    const msg = ctx.chat[idx];
    msg.extra = msg.extra || {};
    const list = (msg.extra.ia_images = msg.extra.ia_images || []);
    if (list.includes(url)) return true;
    list.push(url);

    const md = `\n\n![${alt}](${url})`;
    msg.mes = (msg.mes || '') + md;
    if (Array.isArray(msg.swipes) && msg.swipes.length) {
        const si = msg.swipe_id ?? msg.swipes.length - 1;
        if (typeof msg.swipes[si] === 'string') msg.swipes[si] += md;
    }

    if (!refreshMessage(idx)) {
        const $t = $(`#chat .mes[mesid="${idx}"] .mes_text`).last();
        if ($t.length) $t.append(`<img src="${url}" alt="${alt.replace(/"/g, '&quot;')}">`);
    }
    queueSave();
    decorateChat();
    notify('success', 'Illustration attached.');
    return true;
}

// Swap an image URL inside whichever message contains it (used by Reroll).
export function replaceImageUrl(oldUrls, newUrl) {
    const ctx = getCtx();
    const olds = [].concat(oldUrls).filter(Boolean);
    const chat = ctx.chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        const hit = olds.find(u => (m.mes || '').includes(u));
        if (!hit) continue;
        const swap = (t) => typeof t === 'string' ? olds.reduce((acc, u) => acc.split(u).join(newUrl), t) : t;
        m.mes = swap(m.mes);
        if (Array.isArray(m.swipes)) m.swipes = m.swipes.map(swap);
        if (Array.isArray(m.extra?.ia_images)) m.extra.ia_images = m.extra.ia_images.map(u => olds.includes(u) ? newUrl : u);
        refreshMessage(i);
        queueSave();
        return i;
    }
    return null;
}

export async function showImageToCharacter(url, description) {
    const ctx = getCtx();
    const text = slashSafe(`[I show you a picture: *${cleanAlt(description)}*]`) + ` ![Image](${url})`;
    await ctx.executeSlashCommands(`/send ${text}`);
    notify('success', 'Image sent to the character.');
}

// ---------------------------------------------------------------------------
// In-chat decoration (idempotent): reroll buttons on our images, a wand button
// on every assistant message. Also repairs migrated legacy image links.
// ---------------------------------------------------------------------------
export function decorateChat() {
    if (hasGalleryImages()) {
        document.querySelectorAll('#chat .mes_text img').forEach(img => {
            if (img.closest('.ia-img-wrapper')) return;
            const src = img.getAttribute('src') || '';
            if (!src) return;
            const hit = lookupByUrl(src);
            if (!hit) return;
            const url = normalizeUrl(hit.record.url || src);
            if (hit.legacy && hit.record.url) img.setAttribute('src', url);

            const wrap = document.createElement('div');
            wrap.className = 'ia-img-wrapper';
            wrap.dataset.iaUrl = url;
            img.parentNode.insertBefore(wrap, img);
            wrap.appendChild(img);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ia-reroll-btn';
            btn.title = 'Reroll with a new seed (same prompt)';
            btn.innerHTML = '<i class="fa-solid fa-rotate-right"></i><span> Reroll</span>';
            wrap.appendChild(btn);

            const alt = img.getAttribute('alt');
            if (alt) {
                const cap = document.createElement('span');
                cap.className = 'ia-img-caption';
                cap.textContent = alt;
                wrap.appendChild(cap);
            }
        });
    }

    document.querySelectorAll('#chat .mes[is_user="false"]:not(.ia-has-btn)').forEach(mes => {
        const holder = mes.querySelector('.extraMesButtons');
        if (!holder) return;
        const b = document.createElement('div');
        b.className = 'mes_button ia-mes-btn fa-solid fa-wand-magic-sparkles interactable';
        b.title = 'Illustrate this message';
        b.tabIndex = 0;
        holder.prepend(b);
        mes.classList.add('ia-has-btn');
    });
}
