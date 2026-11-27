// 이 채팅 기억: 프롬프트 목록 옆의 스위치 줄(켜고 끄기 · ⓘ).
import { ctx, toast, tr, settings } from './shared.js';
import { memory } from './files.js';
import { kindList, kindsOf, refreshEntries, snapshot, rawKinds } from './kinds.js';
import { store, remember } from './remember.js';
import { showMemory } from './memory_window.js';

/** 막대 자리: top = 목록 바로 위 · head = '프롬프트' 제목 줄 안 · under = 제목 줄 바로 아래 · bottom = 목록 맨 밑 */
export const BAR_SPOTS = ['top', 'head', 'under', 'bottom'];
export const barSpot = () => BAR_SPOTS.includes(settings().barPos) ? settings().barPos : 'top';
/** 목록 위 도구 줄(.pf-toolbar)이 우리와 같은 자리에 있으면 그 줄: 그때만 한 줄로 합침 */
export function sharedToolbar(host) {
    const toolbar = host?.querySelector('.pf-toolbar');
    if (!toolbar) return null;
    const prev = toolbar.previousElementSibling;
    const at = toolbar.closest('.completion_prompt_manager_header') ? 'head'
        : prev?.classList.contains('completion_prompt_manager_header') ? 'under'
            : prev?.id === 'completion_prompt_manager_list' ? 'bottom' : 'top';
    return at === barSpot() ? toolbar : null;
}
export function placeOwnBar(host, list, bar) {
    const wrap = list.parentElement;
    const head = wrap?.querySelector(':scope > .completion_prompt_manager_header');
    const spot = barSpot();
    bar.classList.toggle('cpm-at-head', spot === 'head' && !!head);
    if (spot === 'head' && head) (head.firstElementChild || head).after(bar);
    else if (spot === 'under' && head) {
        // 그 자리에 다른 확장 줄이 먼저 있으면 그 아래로
        let at = head;
        while (at.nextElementSibling && at.nextElementSibling !== bar && !at.nextElementSibling.classList.contains('completion_prompt_manager_footer') && at.nextElementSibling.id !== 'completion_prompt_manager_list') at = at.nextElementSibling;
        at.after(bar);
    }
    else if (spot === 'bottom') list.after(bar);
    else list.before(bar);
}
// 막대는 보이는 내용이 바뀔 때만 다시 만듦: 토글을 누를 때마다 지우고 다시 넣으면 목록을 지켜보는 쪽들이 매번 다시 그렸음
export let barKey = '';
export function renderBar() {
    const list = document.getElementById('completion_prompt_manager_list');
    const host = document.getElementById('completion_prompt_manager');
    {
        const c = ctx(), mem = memory(), en = settings().enabled;
        const key = [c.mainApi, c.getCurrentChatId(), en, en && !mem?.off, mem?.preset, settings().showBar, barSpot(), !!sharedToolbar(host), !!list].join('|');
        const panelOk = !(settings().showBar && list && host && c.getCurrentChatId()) || !!host.querySelector('.cpm-bar');
        const hereOk = !document.getElementById('cpm_here') || !c.getCurrentChatId() || !!document.querySelector('#cpm_here .cpm-bar');
        if (key === barKey && panelOk && hereOk) return;
        barKey = key;
    }
    document.querySelectorAll('.cpm-bar').forEach(el => el.remove());
    const here = document.getElementById('cpm_here');
    if (here) here.innerHTML = ctx().mainApi !== 'openai' ? `<small class="cpm-help">${tr`This extension works only when you connect with a Chat Completion API.`}</small>`
        : ctx().getCurrentChatId() ? '' : `<small class="cpm-help">${tr`Open a chat to see and edit what it remembers here.`}</small>`;
    if (ctx().mainApi !== 'openai' || !ctx().getCurrentChatId()) return;
    const inPanel = settings().showBar && list && host;
    if (!inPanel && !here) return;
    const enabled = settings().enabled;
    const mem = memory();
    const on = enabled && !mem?.off;
    const kinds = kindsOf(mem);
    const e = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const hint = !enabled ? tr`Chat preset memory is off. Turn it on in the extension settings.`
        : on ? (mem?.preset ? tr`Saved preset: ${mem.preset}` : tr`Not remembered yet`) : tr`Don't remember anything for this chat`;
    const bar = document.createElement('div');
    bar.className = 'cpm-bar' + (enabled ? '' : ' cpm-disabled');
    bar.innerHTML = `
        <label class="cpm-switch" title="${e(hint)}">
            <input type="checkbox" role="switch" ${on ? 'checked' : ''} ${enabled ? '' : 'disabled'}>
            <span class="cpm-track" aria-hidden="true"></span>
            <span class="cpm-text">${e(tr`Remember this chat`)}</span>
        </label>
        <button type="button" class="cpm-info-btn" title="${e(tr`What this chat remembers`)}" aria-label="${e(tr`What this chat remembers`)}"><i class="fa-solid fa-circle-info"></i></button>`;
    bindBar(bar);
    // 확장 설정 칸에는 늘 · 프롬프트 목록 위에는 설정을 켰을 때만 (같은 막대 두 벌)
    if (here) here.append(bar);
    if (inPanel) {
        const copy = bar.cloneNode(true);
        bindBar(copy);
        const toolbar = sharedToolbar(host);
        if (toolbar) {
            // 목록 위에 다른 도구 줄이 같은 자리에 있으면 한 줄로: 스위치와 ⓘ 는 그 줄 왼쪽
            // (cpm-bar 클래스를 달아 둬야 그 도구 줄을 그리는 쪽이 '목록이 바뀜'으로 보고 다시 그리지 않음)
            const sw = document.createElement('div');
            sw.className = 'cpm-bar cpm-inpf cpm-inpf-switch' + (enabled ? '' : ' cpm-disabled');
            sw.append(copy.querySelector('.cpm-switch'), copy.querySelector('.cpm-info-btn'));
            toolbar.prepend(sw);
        } else {
            placeOwnBar(host, list, copy);
        }
    }
}

export function bindBar(bar) {
    bar.querySelector('input').addEventListener('change', ev => {
        store(snapshot(), { off: !ev.target.checked });
    });
    bar.querySelector('.cpm-info-btn').addEventListener('click', showMemory);
    bar.querySelectorAll('.cpm-kind').forEach(btn => btn.addEventListener('click', () => {
        const next = { ...rawKinds(), [btn.dataset.kind]: btn.getAttribute('aria-pressed') !== 'true' };
        if (!kindList().some(k => next[k])) return void toast.info(tr`Pick at least one, or turn the switch off.`, tr`Chat Preset Memory`);
        (next.world ? refreshEntries() : Promise.resolve()).then(() => store(snapshot(next), { kinds: next }));   // 켠 종류는 지금 상태부터 기억
    }));
}

export let barTimer = null;
let barWatch = null;
/** 줄과 감시를 걷음(기능을 끌 때) */
export function unwatchPromptManager() {
    barWatch?.disconnect(); barWatch = null;
    clearTimeout(barTimer);
    barKey = '';
    document.querySelectorAll('.cpm-bar').forEach(el => el.remove());
}
export function watchPromptManager() {
    const host = document.getElementById('completion_prompt_manager');
    if (!host) return void (barTimer = setTimeout(watchPromptManager, 1000));
    barWatch = new MutationObserver(() => {
        if (!settings().showBar || !document.getElementById('completion_prompt_manager_list')) return;
        const toolbar = sharedToolbar(host);
        // 도구 줄이 같은 자리에 있으면 그 안에, 없으면 목록 위에 우리 막대가 있는지 (도구 줄은 다시 그려질 때 통째로 바뀜)
        if (toolbar ? toolbar.querySelector('.cpm-inpf') : host.querySelector('.cpm-bar:not(.cpm-inpf)')) return;
        clearTimeout(barTimer);
        barTimer = setTimeout(renderBar, 20);
    });
    barWatch.observe(host, { childList: true, subtree: true });
    renderBar();
}
