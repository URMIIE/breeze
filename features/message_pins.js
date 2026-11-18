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
// 버튼 종류 이름: 실리태번 · 확장이 붙인 첫 클래스. 한 확장이 버튼 여러 개에 같은 클래스를 붙이면(아이콘 · data 값으로만 다름)
//   모두 한 종류로 묶여 하나만 목록에 뜨고 숨기기 · 꺼내기가 함께 움직였음 → 같은 메시지 안에 같은 클래스 버튼이 또 있으면 아이콘(없으면 data 값)까지 붙여 가름
const ICON_STYLE = /^fa-(solid|regular|brands|light|thin|duotone|fw|lg|xs|sm)$/;
const keyOf = btn => {
    const base = [...btn.classList].find(c => !GENERIC.has(c) && !c.startsWith('fa-')) || '';
    if (!base) return '';
    const scope = btn.closest('.mes, #message_template') || btn.parentElement;
    if (!scope || scope.querySelectorAll(`.${CSS.escape(base)}`).length < 2) return base;
    const icon = [...btn.classList].find(c => c.startsWith('fa-') && !ICON_STYLE.test(c));
    if (icon) return `${base}.${icon}`;
    const data = [...btn.attributes].find(a => a.name.startsWith('data-') && a.value && /^[\w-]+$/.test(a.value));
    return data ? `${base}[${data.name}="${data.value}"]` : base;
};
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
                seen.set(key, { key, label: labelOf(btn), mask: maskOf(btn), html: [...btn.classList].some(c => c.startsWith('fa-')) ? '' : (btn.querySelector('svg, img, i[class*="fa-"]')?.outerHTML || ''), icon: btn.classList.contains('etk_swipe_dup') ? 'fa-solid fa-angles-right' : [...btn.classList].filter(c => c.startsWith('fa-')).join(' ') });   // 목록은 모두 글꼴 아이콘이라, 직접 그린 화살표 버튼도 같은 꼴의 글꼴 아이콘으로   // 글꼴 아이콘이 없는 breeze 버튼(가는 선 화살표)는 그 버튼 모양 이름을 그대로 써서 아이콘이 보이게
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
            if (!takenByOther) { takenByOther = true; api?.rest?.('same', { saw: '원래 ⋯ 메뉴 안에만 있는 버튼이, breeze가 꺼내지 않았는데 이름 줄에 나와 있어요', who: { kind: 'unknown' }, back: '그쪽을 끄면 다음에 채팅을 열 때 breeze가 맡아요.' }); for (const r of document.querySelectorAll('#chat .mes_buttons')) { const ex = r.querySelector('.extraMesButtons'); if (ex) unplace(r, ex); } }
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
    // 순서 바꾸기: 화살표로 한 칸씩 옮기던 것을 손잡이(⠿)를 끌어서 한 번에. 휴대폰도 손잡이를 눌러 끌면 됨(손잡이 위에선 화면이 스크롤되지 않음)
    // 목록은 '메시지에 바로 표시' · '⋯ 메뉴' · '숨김' 세 칸으로 나눠 켜진 것 순서대로 보이게(숨긴 것은 맨 아래). 칸 사이로 끌면 바로 표시 ↔ 메뉴가 바뀜
    const render = () => {
        const o = a.options(); o.pins ??= []; o.hidden ??= []; o.menuOrder ??= [];
        const keepTop = box.querySelector('.etk-pin-list')?.scrollTop || 0;   // 다시 그려도 보던 자리 그대로
        const sort = o.listSort === 'name' ? 'name' : 'base';
        box.innerHTML = '<div class="etk-flex etk-pin-head"><small class="etk-pin-legend"><span><i class="fa-solid fa-arrows-up-down"></i>끌어서 순서 바꾸기 · ↑↓ 한 칸씩</span><span><i class="fa-solid fa-thumbtack"></i>바로 표시</span><span><i class="fa-solid fa-eye-slash"></i>숨기기</span></small><select class="text_pole etk-pin-sort"><option value="base">켜진 순서</option><option value="name">이름순</option></select></div>'
            + (takenByOther ? '<small class="etk-rest">다른 확장이나 테마가 버튼을 꺼내 두고 있어서 고정은 쉬고 있어요</small>' : '');
        // 목록은 지금 화면에 있는 버튼만이 아니라 한 번이라도 본 버튼까지(번역 · QuickActions 처럼 확장이 메시지에 붙이는 버튼은 채팅을 열어야만 화면에 있어서,
        // 채팅을 안 열면 고정해 둔 버튼이 목록에서 빠져 고정이 풀린 것처럼 보였음) — 본 버튼의 이름 · 아이콘을 적어 두고 없을 땐 그걸로
        o.known ??= {};
        const seenNow = collectButtons();
        let knownChanged = false;
        for (const b of seenNow) { const k = o.known[b.key]; if (!k || k.label !== b.label || k.icon !== b.icon || (k.html || '') !== (b.html || '')) { o.known[b.key] = { label: b.label, icon: b.icon, html: b.html || '' }; knownChanged = true; } }
        if (knownChanged) a.save();
        const all = [...seenNow];
        for (const key of new Set([...o.pins, ...o.menuOrder, ...o.hidden])) if (!all.some(b => b.key === key) && o.known[key]) all.push({ key, ...o.known[key], mask: '' });
        const pinnedList = o.pins.map(k => all.find(b => b.key === k)).filter(Boolean);
        const rank = k => { const i = o.menuOrder.indexOf(k); return i < 0 ? Infinity : i; };
        const menuList = all.filter(b => !o.pins.includes(b.key)).map((b, i) => [b, i]).sort((x, y) => rank(x[0].key) - rank(y[0].key) || x[1] - y[1]).map(x => x[0]);
        const sel = box.querySelector('.etk-pin-sort');
        sel.value = sort;
        sel.addEventListener('change', () => { o.listSort = sel.value; a.save(); render(); });
        const list = document.createElement('div');
        list.className = 'etk-pin-list';
        box.append(list);
        const sections = sort === 'name'
            ? [{ id: 'all', items: [...pinnedList, ...menuList].sort((x, y) => x.label.localeCompare(y.label, 'ko')) }]
            : [{ id: 'pin', title: '메시지에 바로 표시', items: pinnedList }, { id: 'menu', title: '⋯ 메뉴', items: menuList.filter(b => !o.hidden.includes(b.key)) }, { id: 'hidden', title: '숨김', items: menuList.filter(b => o.hidden.includes(b.key)) }];
        for (const sec of sections) {
            if (sec.title) { const h = document.createElement('div'); h.className = 'etk-pin-sec'; h.dataset.sec = sec.id; h.innerHTML = `<span></span><small>${sec.items.length}</small>`; h.firstChild.textContent = sec.title; list.append(h); }
            for (const b of sec.items) list.append(rowOf(b, sec.id, o));
        }
        list.scrollTop = keepTop;
    };
    const rowOf = (b, secId, o) => {
        const row = document.createElement('div');
        row.className = 'etk-pin-row'; row.dataset.key = b.key; row.dataset.sec = secId;
        const canDrag = secId === 'pin' || secId === 'menu';
        row.innerHTML = `<i class="${b.icon} etk-pin-icon"></i><span></span><div class="etk-pin-ctrls">${canDrag ? '<div class="etk-pin etk-move fa-solid fa-chevron-up interactable" tabindex="0" title="한 칸 위로"></div><div class="etk-pin etk-move fa-solid fa-chevron-down interactable" tabindex="0" title="한 칸 아래로"></div>' : ''}<div class="etk-pin etk-eye fa-solid interactable" tabindex="0"></div><div class="etk-pin etk-tack fa-solid fa-thumbtack interactable" tabindex="0" title="메시지에 바로 표시"></div></div>`;
        row.querySelector('span').textContent = b.label;
        const ic = row.querySelector('.etk-pin-icon');
        if (b.mask) { ic.className = 'etk-pin-icon etk-pin-mask'; ic.style.webkitMaskImage = ic.style.maskImage = b.mask; }
        else if (b.html && !b.icon) { ic.className = 'etk-pin-icon etk-pin-html'; ic.innerHTML = b.html; }   // 글꼴 아이콘이 없는 버튼(그림 · svg)은 그 그림을 그대로
        const eye = row.querySelector('.etk-eye'), pin = row.querySelector('.etk-tack'), off = o.hidden.includes(b.key);
        eye.classList.add(off ? 'fa-eye-slash' : 'fa-eye'); eye.classList.toggle('etk-on', off);
        eye.title = off ? '누르면 다시 보이기' : '누르면 숨기기';
        pin.classList.toggle('etk-on', o.pins.includes(b.key));
        row.classList.toggle('etk-off', off);
        eye.addEventListener('click', () => { o.hidden = off ? o.hidden.filter(k => k !== b.key) : [...o.hidden, b.key]; a.save(); applyHidden(); render(); });
        pin.addEventListener('click', () => { o.pins = o.pins.includes(b.key) ? o.pins.filter(k => k !== b.key) : [...o.pins, b.key]; a.save(); placeAll(); render(); });
        // 한 칸씩은 ↑↓ 버튼으로, 멀리 옮길 땐 줄을 끌어서(둘 다 됨)
        const step = (d) => {
            if (secId === 'pin') { const l = [...o.pins], i = l.indexOf(b.key), j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; o.pins = l; placeAll(); }
            else { const shown = [...row.parentElement.querySelectorAll('.etk-pin-row')].filter(r => r.dataset.sec === 'menu').map(r => r.dataset.key); const i = shown.indexOf(b.key), j = i + d; if (j < 0 || j >= shown.length) return; [shown[i], shown[j]] = [shown[j], shown[i]]; o.menuOrder = [...shown, ...o.menuOrder.filter(k => !shown.includes(k))]; applyHidden(); }
            a.save(); render();
        };
        if (canDrag) { row.querySelector('.fa-chevron-up').addEventListener('click', () => step(-1)); row.querySelector('.fa-chevron-down').addEventListener('click', () => step(1)); }
        if (canDrag) { row.classList.add('etk-pin-drag'); row.addEventListener('pointerdown', (e) => { if (!e.target.closest('.etk-pin') && e.button < 1) startDrag(e, row, o); }); }
        return row;
    };
    // 끌기(월드인포 폴더와 같은 방식): 줄 아무 데나 잡고 — 마우스는 누른 채 조금 움직이면, 손가락은 0.35초 눌렀다가 — 끌면 줄이 목록 안에서 따라 움직이고,
    // 놓으면 칸(바로 표시 · 메뉴)마다 순서를 읽어 저장. 숨김 칸으로는 못 들어감. 손잡이(⠿)를 따로 두니 거기만 잡혀서 줄을 꾹 잡아 끌면 안 됐음
    const startDrag = (e, row, o) => {
        const list = row.parentElement, sx = e.clientX, sy = e.clientY, touch = e.pointerType !== 'mouse';
        let started = false, timer = 0, raf = 0, lastY = sy;
        const begin = () => {
            started = true;
            try { row.setPointerCapture(e.pointerId); } catch { /* 이미 뗌 */ }
            row.classList.add('etk-dragging');
            navigator.vibrate?.(10);
        };
        const noScroll = (te) => { if (started) te.preventDefault(); };
        const move = (ev) => {
            if (!started) {
                const d = Math.hypot(ev.clientX - sx, ev.clientY - sy);
                if (touch) { if (d > 8) quit(); return; }
                if (d < 6) return;
                begin();
            }
            ev.preventDefault();
            const y = lastY = ev.clientY, lr = list.getBoundingClientRect();
            if (y < lr.top + 24) list.scrollTop -= 8; else if (y > lr.bottom - 24) list.scrollTop += 8;   // 가장자리에서 목록이 따라 굴러감
            if (raf) return;
            raf = requestAnimationFrame(() => { raf = 0; place(lastY); follow(lastY); });
        };
        // 잡은 줄은 손가락 · 마우스를 그대로 따라오게(자리만 바꾸면 줄이 다른 줄 가운데를 넘을 때마다 한 칸씩 뛰어 뚝뚝 끊겨 보였음)
        const grabDy = sy - (row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
        const follow = (y) => { const lr = list.getBoundingClientRect(); const natural = lr.top - list.scrollTop + row.offsetTop - list.offsetTop * 0 + row.offsetHeight / 2; row.style.transform = `translateY(${Math.round(y - grabDy - natural)}px)`; };
        const place = (y) => {
            {
                const items = [...list.children].filter(c => c !== row);
                const hiddenHead = list.querySelector('.etk-pin-sec[data-sec="hidden"]');
                let before = items.find(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null;
                if (before?.classList.contains('etk-pin-sec') && before.dataset.sec === 'pin') before = before.nextElementSibling === row ? row.nextElementSibling : before.nextElementSibling;   // 맨 위 칸 제목 위로는 못 감
                if (hiddenHead && (!before || before.compareDocumentPosition(hiddenHead) & Node.DOCUMENT_POSITION_PRECEDING)) before = hiddenHead;   // 숨김 칸 안으로는 못 감
                if (before !== row && row.nextElementSibling !== before) list.insertBefore(row, before);
            }
        };
        // 신호는 문서에서 받음: 끄는 줄을 목록 안에서 옮기면(insertBefore) 브라우저가 그 줄의 포인터 붙잡기를 풀어서, 줄 밖으로 나가는 순간 움직임 · 놓기가 안 와
        // 끌기가 중간에 멈추고 놓은 것도 못 받아 끄는 모양이 그대로 남았음
        const quit = () => { clearTimeout(timer); document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', end, true); document.removeEventListener('pointercancel', end, true); document.removeEventListener('touchmove', noScroll, true); window.removeEventListener('blur', end); };
        const end = () => {
            quit();
            if (!started) return;
            if (!row.isConnected) return;   // 끄는 중에 설정 창이 닫혀 목록이 사라짐
            cancelAnimationFrame(raf); raf = 0; place(lastY); row.style.transform = '';   // 마지막 자리는 놓을 때 한 번 더(화면 그리기가 늦으면 마지막 움직임이 빠졌음)
            row.classList.remove('etk-dragging');
            let sec = 'pin';
            const pins = [], menu = [];
            for (const c of list.children) {
                if (c.classList.contains('etk-pin-sec')) { sec = c.dataset.sec; continue; }
                if (sec === 'pin') pins.push(c.dataset.key); else if (sec === 'menu') menu.push(c.dataset.key);
            }
            const hiddenKeys = o.menuOrder.filter(k => o.hidden.includes(k) && !pins.includes(k));
            const pinsChanged = pins.join('|') !== o.pins.join('|'), secOld = row.dataset.sec, secNew = pins.includes(row.dataset.key) ? 'pin' : 'menu';
            o.pins = pins;
            o.menuOrder = [...menu, ...hiddenKeys, ...o.menuOrder.filter(k => !menu.includes(k) && !hiddenKeys.includes(k) && !pins.includes(k))];
            a.save(); applyHidden();
            // 놓을 때 하던 일(모든 메시지에 꺼낸 버튼 다시 붙이기 · 채팅 속 버튼을 전부 다시 모아 목록 새로 그리기)이 119ms 걸렸음 →
            // 꺼낸 버튼이 바뀐 때만 다시 붙이고, 목록은 줄이 이미 제자리라 칸이 바뀐 때만 새로 그림(칸 제목의 개수 · 고정 표시가 바뀌어서)
            if (pinsChanged) placeAll();
            if (secOld !== secNew) render();
        };
        if (touch) { timer = setTimeout(begin, 350); document.addEventListener('touchmove', noScroll, { passive: false, capture: true }); }
        else e.preventDefault();   // 마우스로 끌 때 글자가 골라지지 않게
        document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', end, true); document.addEventListener('pointercancel', end, true); window.addEventListener('blur', end);
    };
    render();
    // 버튼을 붙이는 기능을 켜고 끄면 목록도 바로 바꿈(설정 창을 열어 둔 채 켜고 끄면 지운 버튼이 목록에 남아 있었음)
    const onChange = () => { if (!box.isConnected) return document.removeEventListener('etk-buttons-changed', onChange); render(); };
    document.addEventListener('etk-buttons-changed', onChange);
}
