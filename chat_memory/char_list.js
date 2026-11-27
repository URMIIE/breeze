// 이 채팅 기억: 설정 화면의 캐릭터별 마지막 설정 목록.
import { ctx, toast, tr, settings, charKey } from './shared.js';

/** 캐릭터 목록 검색: 이름 · 프리셋 글자로 거름 */
export function filterChars() {
    const box = document.getElementById('cpm_chars');
    const q = box?.querySelector('.cpm-search')?.value.trim().toLowerCase() || '';
    box?.querySelectorAll('.cpm-char-list li[data-key]').forEach(li => { li.hidden = !!q && !li.textContent.toLowerCase().includes(q); });
}

/** 설정 칸: 캐릭터별 마지막 설정 목록: 한 줄씩 지우기(되돌리기 알림) */
export function renderChars() {
    const box = document.getElementById('cpm_chars');
    if (!box) return;
    const c = ctx();
    const byChar = settings().byChar;
    const keys = Object.keys(byChar);
    box.querySelector('.cpm-count').textContent = keys.length ? tr`${keys.length} characters` : tr`None`;
    box.querySelector('.cpm-char-foot').hidden = !keys.length;
    if (!box.open) return;
    const nameOf = key => key.startsWith('group:')
        ? c.groups?.find(g => String(g.id) === key.slice(6))?.name
        : c.characters?.find(ch => ch.avatar === key)?.name;
    const here = charKey();
    const rows = keys.map(key => ({ key, name: nameOf(key), mem: byChar[key] }))
        .sort((a, b) => (b.key === here) - (a.key === here) || (a.name ? 0 : 1) - (b.name ? 0 : 1) || String(a.name ?? a.key).localeCompare(String(b.name ?? b.key)));
    const e = x => String(x ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
    const list = box.querySelector('.cpm-char-list');
    list.innerHTML = rows.length ? rows.map(r => `<li data-key="${e(r.key)}">
        <span class="cpm-char-main"><span class="cpm-char-name">${e(r.name ?? (r.key.startsWith('group:') ? tr`Group` : r.key.replace(/\.png$/i, '')))}${r.key === here ? ` <small>${e(tr`now`)}</small>` : ''}${r.name ? '' : ` <small>${e(r.key.startsWith('group:') ? tr`deleted group` : tr`deleted`)}</small>`}</span>
        <span class="cpm-char-sub">${e(r.mem?.preset || tr`No preset`)}</span></span>
        <button type="button" class="cpm-char-del fa-solid fa-xmark" title="${e(tr`Remove`)}" aria-label="${e(tr`Remove`)}"></button></li>`).join('')
        : `<li class="cpm-char-empty">${e(tr`There are no character defaults yet.`)}</li>`;
    filterChars();
    list.querySelectorAll('.cpm-char-del').forEach(btn => btn.addEventListener('click', () => {
        const key = btn.closest('li').dataset.key;
        const old = settings().byChar[key];
        if (!old) return;
        const name = nameOf(key) ?? key;
        delete settings().byChar[key];
        ctx().saveSettingsDebounced();
        renderChars();
        const esc = x => String(x).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
        toast.success(`${esc(tr`Removed the last settings for ${name}.`)} <u>${esc(tr`Undo`)}</u>`, tr`Chat Preset Memory`, {
            escapeHtml: false, timeOut: 8000, extendedTimeOut: 4000,
            onclick: () => { if (!settings().byChar[key]) settings().byChar[key] = old; ctx().saveSettingsDebounced(); renderChars(); },
        });
    }));
}

/** 캐릭터별 마지막 설정을 모두 지움(물어본 뒤, 되돌리기 알림) */
export async function clearCharDefaults() {
    const n = Object.keys(settings().byChar).length;
    if (!n) return;
    const ok = await ctx().callGenericPopup(tr`Clear the character defaults (${n})? Saved chat settings are kept.`, ctx().POPUP_TYPE.CONFIRM);
    if (!ok) return;
    const undo = structuredClone(settings().byChar);
    settings().byChar = {};
    ctx().saveSettingsDebounced();
    renderChars();
    toast.success(`${tr`Cleared ${n} character defaults.`} <u>${tr`Undo`}</u>`, tr`Chat Preset Memory`, {
        escapeHtml: false, timeOut: 10000, extendedTimeOut: 4000,
        onclick: () => { settings().byChar = { ...undo, ...settings().byChar }; ctx().saveSettingsDebounced(); renderChars(); toast.info(tr`Restored the character defaults.`, tr`Chat Preset Memory`); },
    });
}
