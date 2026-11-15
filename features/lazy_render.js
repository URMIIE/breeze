// 긴 채팅에서 화면 밖 메시지 안 그리기.
// 메시지가 많으면 화면에 안 보이는 메시지까지 배치 · 그리기를 해서, 굴리거나 답이 흘러 들어올 때 버벅인다.
// 화면에서 먼 메시지만 브라우저가 배치 · 그리기를 건너뛰게 한다(content-visibility: auto).
// 건너뛰는 메시지는 적어 둔 높이(최소 높이)만큼 자리를 차지해 굴림 막대 길이가 그대로이다.
// 메시지를 격자로 배치하는 테마에선 건너뛰기가 걸린 메시지가 화면에 들어와도 내용만큼 늘어나지 않고 적어 둔 높이에 묶인다.
// 그래서 적어 둔 높이가 틀리면(건너뛰는 중에 재서 납작한 값, 잰 뒤 번역 · 그림이 들어와 늘어난 글) 납작해지거나 끝이 잘린다.
// → 화면 근처(위아래 한 화면) 메시지는 건너뛰지 않고 그대로 그리고, 멀어지는 순간 그때의 실제 높이를 잰 뒤에야 건너뛰게 한다.
//   아직 안 잰 메시지(막 불러온 옛 메시지 · 새 답)는 건너뛰지 않으므로 틀린 값이 적힐 일이 없다.
// 화면 근처인지는 IntersectionObserver 로 안다 — #chat 의 바뀜을 지켜보지 않아 다른 확장의 감시와 서로 되먹일 일이 없다.
// 건너뛰는 메시지는 안쪽 내용이 메시지 상자 밖으로 못 나가므로(브라우저 규칙), 메뉴 · 말풍선이 잘리지 않게 마지막 몇 개와 마우스를 올렸거나 고치는 중인 메시지는 뺀다.
// 다른 확장 · 테마가 이미 화면 밖 메시지를 건너뛰게 해 두었으면(메시지에 content-visibility 가 걸려 있거나 메시지를 통째로 감춰 두었으면) 쉰다 — 채팅을 열 때 한 번만 본다.
const KEEP_LAST = 4;
const FAR = 'etk-far';
const CSS = `
#chat.etk-lazy-render > .mes.${FAR}:not(:nth-last-child(-n+${KEEP_LAST})):not(:hover):not(:focus-within) { content-visibility: auto; min-height: var(--etk-mes-height, 0px); }
`;
let api = null, style = null, listeners = [], chat = null, io = null, seen = new WeakSet();

function release(mes) {
    mes.classList.remove(FAR);
    mes.style.removeProperty('--etk-mes-height');
}

function onIntersect(entries) {
    // 먼저 다 재고 나서 한꺼번에 적는다(섞으면 메시지마다 화면 계산을 다시 함)
    const far = [];
    for (const e of entries) {
        const mes = e.target;
        if (e.isIntersecting) { release(mes); continue; }
        if (mes.classList.contains(FAR)) continue;
        const h = mes.offsetHeight;
        if (h > 0) far.push([mes, h]);
    }
    for (const [mes, h] of far) {
        mes.style.setProperty('--etk-mes-height', `${h}px`);
        mes.classList.add(FAR);
    }
}

function observeAll() {
    if (!io || !chat) return;
    for (const mes of chat.querySelectorAll(':scope > .mes')) {
        if (seen.has(mes)) continue;
        seen.add(mes);
        io.observe(mes);
    }
}

function stopObserving() {
    io?.disconnect(); io = null; seen = new WeakSet();
    chat?.querySelectorAll(`:scope > .mes.${FAR}`).forEach(release);
}

function check() {
    if (!chat) return;
    stopObserving();
    chat.classList.remove('etk-lazy-render');
    const sample = chat.querySelector(':scope > .mes');
    if (!sample) return;
    // 우리 규칙을 뗀 상태에서: 이미 건너뛰게 돼 있거나, 그려져 있어야 할 메시지가 감춰져 있으면 다른 쪽이 하는 중
    const cs = getComputedStyle(sample);
    const hidden = [...chat.querySelectorAll(':scope > .mes')].slice(0, 30).some(m => m.style.display === 'none' || m.hidden);
    if (cs.contentVisibility !== 'visible' || hidden) { api?.rest?.('same'); return; }
    api?.rest?.(null);
    chat.classList.add('etk-lazy-render');
    io = new IntersectionObserver(onIntersect, { root: chat, rootMargin: '100% 0px 100% 0px' });
    observeAll();
}

// 고치거나 스와이프한 메시지는 높이가 달라지므로 건너뛰기를 풀어 둔다(다음에 화면에서 멀어질 때 다시 잼)
function forget(id) {
    const mes = chat?.querySelector(`:scope > .mes[mesid="${Number(id)}"]`);
    if (mes) release(mes);
}

export function start(a) {
    api = a;
    chat = document.getElementById('chat');
    if (!chat) return;
    style = document.createElement('style');
    style.id = 'etk-lazy-render';
    style.textContent = CSS;
    document.head.append(style);
    const { eventSource, eventTypes: ev } = a.ctx();
    // 채팅이 바뀐 뒤 메시지가 그려지고 나서 한 번
    const onChat = () => setTimeout(check, 300);
    if (ev.CHAT_CHANGED) { eventSource.on(ev.CHAT_CHANGED, onChat); listeners.push([ev.CHAT_CHANGED, onChat]); }
    // 새로 그려진 메시지도 지켜보기 시작(재는 건 화면에서 멀어질 때)
    const later = () => setTimeout(observeAll, 0);
    for (const name of ['MORE_MESSAGES_LOADED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED']) {
        if (ev[name]) { eventSource.on(ev[name], later); listeners.push([ev[name], later]); }
    }
    for (const name of ['MESSAGE_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED']) {
        if (ev[name]) { eventSource.on(ev[name], forget); listeners.push([ev[name], forget]); }
    }
    check();
}

export function stop() {
    const { eventSource } = api.ctx();
    for (const [n, fn] of listeners) eventSource.removeListener?.(n, fn);
    listeners = [];
    stopObserving();
    chat?.classList.remove('etk-lazy-render');
    style?.remove(); style = null;
}
