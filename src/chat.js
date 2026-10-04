import { getSettings } from './config.js';

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

export async function deliverRoleplayImage(cleanImageUrl, description) {
    const context = SillyTavern.getContext();
    if (!context || !context.chat || context.chat.length === 0) return;

    const s = getSettings();
    const delivery = s.deliveryMode || 'attached';
    const descText = description || 'Scene Illustration';

    if (delivery === 'separate') {
        // Mode B: Native SillyTavern comment card (Completely excluded from LLM prompt context)
        const commentTag = `![${descText}](${cleanImageUrl})\n*(${descText})*`;
        await context.executeSlashCommands(`/comment ${commentTag}`);
        toastr.success('Illustration added as separate hidden card.', 'Marinara');
    } else {
        // Mode A: Attached cleanly to character message (Permanent & Swipe-Synced)
        let messageIndex = context.chat.length - 1;
        while (messageIndex >= 0 && context.chat[messageIndex].is_user) {
            messageIndex--;
        }
        if (messageIndex < 0) messageIndex = context.chat.length - 1;

        const targetMsg = context.chat[messageIndex];
        const imageMarkdown = `\n\n![${descText}](${cleanImageUrl})\n*<small class="ia-img-caption"><i class="fa-solid fa-camera"></i> ${descText}</small>*`;

        if (!targetMsg.mes.includes(cleanImageUrl)) {
            // 1. Update text
            targetMsg.mes += imageMarkdown;

            // 2. Synchronize with swipes array so SillyTavern reload preserves the image
            if (Array.isArray(targetMsg.swipes) && targetMsg.swipes.length > 0) {
                const swipeIdx = targetMsg.swipe_id ?? (targetMsg.swipes.length - 1);
                if (targetMsg.swipes[swipeIdx] && !targetMsg.swipes[swipeIdx].includes(cleanImageUrl)) {
                    targetMsg.swipes[swipeIdx] += imageMarkdown;
                }
            }

            // 3. Save to disk and update UI
            if (typeof context.updateMessage === 'function') {
                context.updateMessage(messageIndex, targetMsg);
            }
            await persistChat();

            // 4. Fallback DOM render
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
            toastr.success('Illustration attached cleanly to message.', 'Marinara');
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
            toastr.info('Rerolling illustration...', 'Marinara');
            if (triggerFn) await triggerFn(true);
        });
    });
}