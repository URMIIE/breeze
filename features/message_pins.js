// 메시지 버튼 관리: 자주 쓰는 버튼은 이름 옆에 꺼내 두고(⋯ 메뉴 안의 진짜 버튼을 이름 줄로 옮김), 안 쓰는 버튼은 숨긴다(CSS 로만 — 기능은 그대로).
// 복제하지 않고 옮기므로 실리태번 · 확장이 건 클릭 처리와 켜짐 표시가 그대로 따라온다. 옮긴 자리에 주석 노드를 남겨 두었다가 풀면 제자리로.
// 다른 확장이 숨긴 버튼(display: none)는 목록에도 안 넣고 꺼내지도 않는다.
// 다른 확장 · 테마가 이미 같은 일을 하고 있으면 쉰다: 원래 ⋯ 메뉴 안에만 있는 실리태번 버튼이 우리가 옮기지 않았는데 이름 줄에 나와 있으면 그쪽이 꺼낸 것.
// 메시지를 배치할 때 그 메시지 줄만 한 번 보므로 따로 감시하지 않는다.
const GENERIC = new Set(['mes_button', 'interactable', 'etk-pinned', 'extraMesButtonsHint', 'mes_edit_cancel', 'mes_edit_done']);
// 메시지 상태에 따라 둘 중 하나만 보이는 짝 버튼 — 늘 앞 버튼 자리에 붙여 자리가 바뀌지 않게
const PAIRS = { mes_hide: ['mes_unhide'], mes_media_gallery: ['mes_media_list'] };
const MENU_ONLY = ['mes_translate', 'sd_message_gen', 'mes_narrate', 'mes_prompt', 'mes_hide', 'mes_unhide', 'mes_media_gallery', 'mes_media_list', 'mes_embed', 'mes_swipe_picker', 'mes_create_bookmark', 'mes_create_branch', 'mes_copy'];
const TAKEN = MENU_ONLY.map(k => `:scope > .${k}:not(.etk-pinned)`).join(', ');
let takenByOther = false;
const slots = new WeakMap();
let api = null, observer = null, timer = 0, listeners = [], hideStyle = null;

const hidden = () => (api.options().hidden ??= []).filter(k => /^[\w-]+$/.test(k));
function applyHidden() {
    hideStyle ??= Object.assign(document.createElement('style'), { id: 'etk-mes-hide' });
    if (!hideStyle.isConnected) document.head.append(hideStyle);
    const keys = hidden();
    const order = (api.options().menuOrder ??= []).filter(k => /^[\w-]+$/.test(k));
    hideStyle.textContent = (keys.length ? `#chat .mes :is(.mes_buttons, .extraMesButtons) :is(${keys.map(k => '.' + k).join(', ')}) { display: none !important; }` : '')
        // ⋯ 메뉴는 flex 라 order 로 순서만 바꿈(버튼을 옮기지 않아 다른 확장이 건 처리는 그대로), 짝 버튼은 앞 버튼과 같은 자리
        + (order.length ? `#chat .mes .extraMesButtons > * { order: ${order.length + 1}; }` + order.map((k, i) => `#chat .mes .extraMesButtons > :is(${[k, ...(PAIRS[k] || [])].map(x => '.' + x).join(', ')}) { order: ${i + 1}; }`).join('') : '');
}

const pins = () => (api.options().pins ??= []).filter(k => /^[\w-]+$/.test(k));
const keyOf = btn => [...btn.classList].find(c => !GENERIC.has(c) && !c.startsWith('fa-')) || '';
const hiddenByOthers = btn => getComputedStyle(btn).display === 'none';

// 이름은 실리태번 · 그 확장이 버튼에 붙여 둔 이름(화면 언어로 번역된 것)만 씀(따로 지어 붙이면 실제 이름과 달라짐)
function labelOf(btn) {
    let t = (btn.getAttribute('title') || btn.getAttribute('aria-label') || '').split('\n')[0].trim();
    if (t.length > 28) t = t.replace(/\s*\(.*\)\s*$/, '');
    return t || '이름 모를 버튼';
}

// 테마가 버튼 아이콘을 그림(mask)으로 바꿔 그리면 목록도 그 그림으로 — 글꼴 아이콘만 보여 주면 실제 버튼과 모양이 달랐음
function maskOf(btn) {
    for (const st of [getComputedStyle(btn, '::before'), getComputedStyle(btn)]) {
        const m = st.webkitMaskImage || st.maskImage;
        if (m && m !== 'none') return m;
    }
    return '';
}

function collectButtons() {
    const seen = new Map();
    // 우리가 숨긴 버튼도 목록에는 나와야 하므로, 모으는 동안만 우리 숨김 규칙을 잠깐 끔(다른 확장이 숨긴 것만 빠지게)
    if (hideStyle) hideStyle.disabled = true;
    try {
        for (const root of [...document.querySelectorAll('#chat .mes'), document.querySelector('#message_template')]) {   // 실제 메시지 먼저(테마가 그린 아이콘은 메시지 안에서만 보임)
            if (!root) continue;
            for (const btn of root.querySelectorAll('.mes_buttons .mes_button, .extraMesButtons .mes_button, .extraMesButtons > div[title]')) {
                const key = keyOf(btn);
                if (!key || seen.has(key) || hiddenByOthers(btn)) continue;
                seen.set(key, { key, label: labelOf(btn), mask: maskOf(btn), icon: btn.classList.contains('etk_swipe_dup') ? 'fa-solid fa-angles-right' : [...btn.classList].filter(c => c.startsWith('fa-')).join(' ') });   // 목록은 모두 글꼴 아이콘이라, 직접 그린 화살표 버튼도 같은 꼴의 글꼴 아이콘으로   // 글꼴 아이콘이 없는 breeze 버튼(가는 선 화살표)는 그 버튼 모양 이름을 그대로 써서 아이콘이 보이게
            }
        }
    } finally { if (hideStyle) hideStyle.disabled = false; }
    return [...seen.values()];
}

function unplace(row, extra, keep = []) {
    for (const btn of row.querySelectorAll(':scope > .etk-pinned')) {
        if (keep.includes(keyOf(btn))) continue;
        const slot = slots.get(btn);
        if (slot?.parentNode) slot.replaceWith(btn); else extra.append(btn);
        btn.classList.remove('etk-pinned');
    }
}

// 다른 쪽이 숨긴 버튼 종류: 한 차례 옮기기 전에 종류마다 하나씩만 재어 둠(옮기는 중에 재면 옮길 때마다 화면 계산을 다시 함)
// 잰 결과는 3초 동안 다시 씀 — 채팅을 열 때 메시지 · 버튼이 붙을 때마다 다시 재면, 잴 때마다 브라우저가 화면 전체 모양을 다시 계산해 0.1초 가까이 썼음.
// 어떤 버튼을 숨기는지는 다른 확장 · 테마의 CSS 가 정하는 것이라 몇 초 사이엔 안 바뀜
let hiddenMemo = { at: 0, keys: '', value: new Set() };
function hiddenKinds(keys) {
    const sig = keys.join(' ');
    if (hiddenMemo.keys === sig && Date.now() - hiddenMemo.at < 3000 && hiddenMemo.found) return hiddenMemo.value;
    const hidden = new Set();
    let found = false;
    for (const key of keys) {
        const btn = document.querySelector(`#chat .mes_buttons .${key}`);
        if (btn) found = true;
        if (btn && hiddenByOthers(btn)) hidden.add(key);
    }
    hiddenMemo = { at: Date.now(), keys: sig, value: hidden, found };   // 아직 버튼이 하나도 없을 때 잰 것은 기억하지 않음
    return hidden;
}

function placeOne(mes, list, hidden) {
    const row = mes.querySelector('.mes_buttons');
    const extra = row?.querySelector('.extraMesButtons');
    const hint = row?.querySelector('.extraMesButtonsHint');
    if (!row || !extra || !hint) return;
    const lead = k => Object.keys(PAIRS).find(l => PAIRS[l].includes(k)) || k;
    const wanted = [...new Set(list.map(lead).flatMap(k => [k, ...(PAIRS[k] || [])]))];
    unplace(row, extra, wanted);
    for (const key of wanted) {
        // 다른 확장이 ⋯ 메뉴가 아니라 이름 줄에 바로 붙이는 버튼도 찾아 고정 순서에 넣음 —
        // 전엔 이런 버튼은 그 확장이 붙인 자리(맨 앞)에 그대로 남아, 붙는 때에 따라 순서가 바뀌어 보였음
        const btn = row.querySelector(`:scope > .etk-pinned.${key}`) || extra.querySelector(`:scope > .${key}`) || row.querySelector(`:scope > .${key}, :scope > :not(.extraMesButtons) > .${key}`);
        if (!btn || hidden.has(key)) continue;
        if (!btn.classList.contains('etk-pinned')) {
            const slot = document.createComment('etk-pin');
            btn.replaceWith(slot);
            slots.set(btn, slot);
            btn.classList.add('etk-pinned');
        }
        // 다른 쪽이 줄의 버튼들을 상자 하나로 묶어 두었으면(줄을 격자로 푸는 테마에서 겹침을 막는 묶음) 이미 꺼낸 버튼은 그 안에 그대로 둠 —
        // 다시 줄로 빼면 그쪽이 또 묶어, 둘이 번갈아 옮겼음
        if (btn.classList.contains('etk-pinned') && btn.parentElement !== row && btn.parentElement?.parentElement === row) continue;
        row.insertBefore(btn, hint);
    }
}

function placeAll(mesList = document.querySelectorAll('#chat .mes')) {
    const list = pins();
    const lead = k => Object.keys(PAIRS).find(l => PAIRS[l].includes(k)) || k;
    const hidden = hiddenKinds([...new Set(list.map(lead).flatMap(k => [k, ...(PAIRS[k] || [])]))]);
    for (const mes of mesList) {
        if (!mes.isConnected) continue;
        const row = mes.querySelector('.mes_buttons');
        if (row?.querySelector(TAKEN)) {
            // 다른 쪽이 꺼내 놓음 → 우리가 꺼낸 것은 제자리로 돌려놓고 쉼(다음에 다시 봄 — 그쪽이 꺼지면 다시 함)
            if (!takenByOther) { takenByOther = true; api?.rest?.('same'); for (const r of document.querySelectorAll('#chat .mes_buttons')) { const ex = r.querySelector('.extraMesButtons'); if (ex) unplace(r, ex); } }
            return;
        }
        placeOne(mes, list, hidden);
    }
    if (takenByOther) api?.rest?.(null);
    takenByOther = false;
}

// 기다리지 않고 지금 하던 일이 끝나는 대로(화면에 나가기 전) 한 번 — 신호가 여러 번 와도 한 번만.
// 타이머로 미루면 채팅을 열 때처럼 바쁠 때 밀려 버튼 줄이 한참 뒤에 바뀜. 확장이 늦게 붙이는 버튼은 아래 감시가 붙는 순간 바로 옮김
let queued = false;
function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (api) placeAll(); });
}

export function start(a) {
    api = a;
    applyHidden();
    const { eventSource, eventTypes: ev } = a.ctx();
    for (const name of ['CHAT_CHANGED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'MORE_MESSAGES_LOADED', 'MESSAGE_EDITED']) {
        if (ev[name]) { eventSource.on(ev[name], schedule); listeners.push([ev[name], schedule]); }
    }
    schedule();
    // 메시지가 새로 붙거나 다른 확장이 이름 줄에 버튼을 늦게 붙이면 그 메시지만 다시.
    // 우리가 옮기며 생긴 변화(.etk-pinned)는 거르고, 끝난 뒤 takeRecords 로 버려 자기 변화에 다시 반응하지 않음
    const chat = document.getElementById('chat');
    if (!chat) return;
    const pending = new Set();
    let t = 0;
    observer = new MutationObserver(records => {
        for (const r of records) {
            for (const n of r.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (n.classList.contains('mes')) pending.add(n);
                else if (n.classList.contains('mes_button') && !n.classList.contains('etk-pinned') && r.target.closest?.('.mes_buttons')) {
                    const mes = r.target.closest('.mes'); if (mes) pending.add(mes);
                }
            }
        }
        if (!pending.size) return;
        // 기다리지 않고 바로(화면에 나가기 전) 옮김 — 0.08초 뒤로 미루면 채팅을 열 때 다른 확장 일에 밀려 1초 넘게 늦게 옮겨져,
        // 메시지가 뜬 뒤에 버튼 줄이 뒤늦게 바뀌며 덜컥였음
        placeAll([...pending]); pending.clear(); observer?.takeRecords();
    });
    observer.observe(chat, { childList: true, subtree: true });
}

export function stop() {
    hideStyle?.remove(); hideStyle = null;
    observer?.disconnect(); observer = null;
    clearTimeout(timer);
    const { eventSource } = api.ctx();
    for (const [n, fn] of listeners) eventSource.removeListener?.(n, fn);
    listeners = [];
    for (const row of document.querySelectorAll('#chat .mes_buttons')) {
        const extra = row.querySelector('.extraMesButtons');
        if (extra) unplace(row, extra);
    }
}

export function options(box, a) {
    const render = () => {
        const o = a.options(); o.pins ??= []; o.hidden ??= [];
        const keepTop = box.querySelector('.etk-pin-list')?.scrollTop || 0;   // 순서를 바꿔 다시 그려도 보던 자리 그대로
        const sort = o.listSort || 'base';
        box.innerHTML = '<div class="etk-flex etk-pin-head"><small><i class="fa-solid fa-thumbtack"></i> 메시지에 바로 표시 · <i class="fa-solid fa-eye-slash"></i> 숨기기</small><select class="text_pole etk-pin-sort"><option value="base">기본순</option><option value="name">이름순</option><option value="reverse">역순</option></select></div>'
            + (takenByOther ? '<small class="etk-rest">다른 확장이나 테마가 버튼을 꺼내 두고 있어서 고정은 쉬고 있어요</small>' : '');
        // 고정한 버튼은 위에 이름 줄 순서대로, 나머지는 ⋯ 메뉴 순서대로 두고 위 · 아래 화살표로 각각 그 안에서 순서를 바꿈
        o.menuOrder ??= [];
        const all = collectButtons();
        const pinnedList = o.pins.map(k => all.find(b => b.key === k)).filter(Boolean);
        const rank = k => { const i = o.menuOrder.indexOf(k); return i < 0 ? Infinity : i; };
        const menuList = all.filter(b => !o.pins.includes(b.key)).map((b, i) => [b, i]).sort((x, y) => rank(x[0].key) - rank(y[0].key) || x[1] - y[1]).map(x => x[0]);
        const base = [...pinnedList, ...menuList];
        // 보기 순서만 바꿈(실제 버튼 순서는 기본순에서 화살표로) — 이름순 · 역순에서는 화살표를 숨김
        const shown = sort === 'name' ? [...base].sort((x, y) => x.label.localeCompare(y.label, 'ko')) : sort === 'reverse' ? [...base].reverse() : base;
        const sel = box.querySelector('.etk-pin-sort');
        sel.value = sort;
        sel.addEventListener('change', () => { o.listSort = sel.value; a.save(); render(); });
        if (sort === 'name') sel.closest('.etk-pin-head').insertAdjacentHTML('afterend', '<small class="etk-pin-hint">순서는 기본순 · 역순에서 화살표로 바꿀 수 있어요.</small>');
        // 버튼이 많아도 설정 칸이 길어지지 않게 줄은 스크롤되는 목록에
        const list = document.createElement('div');
        list.className = 'etk-pin-list';
        box.append(list);
        for (const b of shown) {
            const row = document.createElement('div');
            row.className = 'etk-pin-row';
            const pinned = o.pins.includes(b.key);
            row.innerHTML = `<i class="${b.icon} etk-pin-icon"></i><span></span><div class="etk-pin etk-move fa-solid fa-chevron-up interactable" tabindex="0" title="앞으로"></div><div class="etk-pin etk-move fa-solid fa-chevron-down interactable" tabindex="0" title="뒤로"></div><div class="etk-pin etk-eye fa-solid interactable" tabindex="0"></div><div class="etk-pin etk-tack fa-solid fa-thumbtack interactable" tabindex="0" title="메시지에 바로 표시"></div>`;
            const move = (d) => {
                const list = pinned ? o.pins : menuList.map(x => x.key);
                const at = list.indexOf(b.key), j = at + d;
                if (j < 0 || j >= list.length) return;
                [list[at], list[j]] = [list[j], list[at]];
                if (pinned) placeAll(); else { o.menuOrder = list; applyHidden(); }
                a.save(); render();
            };
            // 역순에서도 화살표로 순서를 바꿈(보이는 방향 그대로: 위 화살표 = 목록에서 위로). 이름순은 이름이 순서를 정해서 화살표 없음
            const dir = sort === 'reverse' ? -1 : 1;
            if (sort === 'name') row.querySelectorAll('.etk-move').forEach(m => m.remove());
            else {
                row.querySelector('.fa-chevron-up').addEventListener('click', () => move(-dir));
                row.querySelector('.fa-chevron-down').addEventListener('click', () => move(dir));
            }
            row.querySelector('span').textContent = b.label;
            if (b.mask) { const ic = row.querySelector('.etk-pin-icon'); ic.className = 'etk-pin-icon etk-pin-mask'; ic.style.webkitMaskImage = ic.style.maskImage = b.mask; }
            const eye = row.querySelector('.etk-eye'), pin = row.querySelector('.etk-tack');
            const paint = () => {
                const off = o.hidden.includes(b.key);
                eye.classList.toggle('fa-eye', !off); eye.classList.toggle('fa-eye-slash', off); eye.classList.toggle('etk-on', off);
                eye.title = off ? '누르면 다시 보이기' : '누르면 숨기기';
                pin.classList.toggle('etk-on', o.pins.includes(b.key));
                row.classList.toggle('etk-off', off);
            };
            paint();
            eye.addEventListener('click', () => { o.hidden = o.hidden.includes(b.key) ? o.hidden.filter(k => k !== b.key) : [...o.hidden, b.key]; a.save(); applyHidden(); paint(); });
            pin.addEventListener('click', () => { o.pins = o.pins.includes(b.key) ? o.pins.filter(k => k !== b.key) : [...o.pins, b.key]; a.save(); placeAll(); render(); });
            list.append(row);
        }
        list.scrollTop = keepTop;
    };
    render();
    // 버튼을 붙이는 기능을 켜고 끄면 목록도 바로 바꿈(설정 창을 열어 둔 채 켜고 끄면 지운 버튼이 목록에 남아 있었음)
    const onChange = () => { if (!box.isConnected) return document.removeEventListener('etk-buttons-changed', onChange); render(); };
    document.addEventListener('etk-buttons-changed', onChange);
}
