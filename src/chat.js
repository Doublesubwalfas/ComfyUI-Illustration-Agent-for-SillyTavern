import { getSettings } from './config.js';

export function cleanTriggerTags(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/[*_]*<(image|scene)>[\s\S]*?<\/\1>[*_]*/gi, '').trim();
}

export async function persistChat() {
    const context = SillyTavern.getContext();
    try {
        if (typeof context.saveChat === 'function') {
            await context.saveChat();
        } else if (typeof window.saveChat === 'function') {
            await window.saveChat();
        }
    } catch (e) {
        console.warn('[Illustration Agent] Failed to save chat file', e);
    }
}

export async function showImageToCharacter(cleanImageUrl, description) {
    const context = SillyTavern.getContext();
    const descText = description || 'An image';
    const text = `[I show you a picture: *${descText}*]\n\n![Image](${cleanImageUrl})`;
    
    await context.executeSlashCommands(`/send ${text}`);
    toastr.success('Image sent to character in chat.', 'Doublesub');
}

export async function deliverRoleplayImage(cleanImageUrl, description) {
    const context = SillyTavern.getContext();
    if (!context || !context.chat || context.chat.length === 0) return;

    const s = getSettings();
    const delivery = s.deliveryMode || 'attached';
    const descText = description || 'Scene Illustration';

    if (delivery === 'separate') {
        const commentTag = `![${descText}](${cleanImageUrl})\n*(${descText})*`;
        await context.executeSlashCommands(`/comment ${commentTag}`);
        toastr.success('Illustration added as separate hidden card.', 'Doublesub');
    } else {
        let messageIndex = context.chat.length - 1;
        while (messageIndex >= 0 && context.chat[messageIndex].is_user) {
            messageIndex--;
        }
        if (messageIndex < 0) messageIndex = context.chat.length - 1;

        const targetMsg = context.chat[messageIndex];
        targetMsg.mes = cleanTriggerTags(targetMsg.mes);

        const imageMarkdown = `\n\n![${descText}](${cleanImageUrl})\n*<small class="ia-img-caption"><i class="fa-solid fa-camera"></i> ${descText}</small>*`;

        if (!targetMsg.mes.includes(cleanImageUrl)) {
            targetMsg.mes += imageMarkdown;

            if (Array.isArray(targetMsg.swipes) && targetMsg.swipes.length > 0) {
                const swipeIdx = targetMsg.swipe_id ?? (targetMsg.swipes.length - 1);
                if (targetMsg.swipes[swipeIdx]) {
                    targetMsg.swipes[swipeIdx] = cleanTriggerTags(targetMsg.swipes[swipeIdx]);
                    if (!targetMsg.swipes[swipeIdx].includes(cleanImageUrl)) {
                        targetMsg.swipes[swipeIdx] += imageMarkdown;
                    }
                }
            }

            if (typeof context.updateMessage === 'function') {
                context.updateMessage(messageIndex, targetMsg);
            }
            await persistChat();

            const $targetMes = $(`#chat .mes[mesid="${messageIndex}"] .mes_text`).last();
            if ($targetMes.length && !$targetMes.find(`img[src="${cleanImageUrl}"]`).length) {
                $targetMes.append(`
                    <div class="ia-img-wrapper" style="margin-top: 10px;">
                        <img src="${cleanImageUrl}" alt="${descText}" />
                        <span class="ia-img-caption"><i class="fa-solid fa-camera"></i> ${descText}</span>
                        <button type="button" class="ia-reroll-btn"><i class="fa-solid fa-rotate-right"></i> Reroll</button>
                    </div>
                `);
            }
            toastr.success('Illustration attached cleanly to message.', 'Doublesub');
        }
    }
}

export function attachInChatMessageButtons(triggerFn) {
    $('.mes_text img').each(function () {
        const $img = $(this);
        if ($img.parent().hasClass('ia-img-wrapper')) return;

        $img.wrap('<div class="ia-img-wrapper"></div>');
        const $btn = $('<button type="button" class="ia-reroll-btn"><i class="fa-solid fa-rotate-right"></i> Reroll</button>');
        $img.after($btn);

        $btn.on('click', async (e) => {
            e.stopPropagation();
            toastr.info('Rerolling illustration...', 'Doublesub');
            if (triggerFn) await triggerFn(true);
        });
    });
}