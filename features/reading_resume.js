// 채팅을 열면 읽던 자리로.
// 굴려 읽는 동안 화면 맨 위에 걸친 메시지와 그 안에서 얼마나 내려갔는지를 브라우저에만 적어 두고(채팅 파일 · 설정은 안 건드림),
// 그 채팅을 다시 열면 그 자리로 옮긴다. 맨 아래에서 읽던 채팅은 실리태번이 원래 맨 아래로 가므로 손대지 않는다.
// 그림 · 카드가 늦게 그려지며 높이가 바뀌므로 자리가 두 번 연속 그대로일 때까지(최대 2초) 다시 맞추고, 그동안은 채팅을 가려 튀는 모습을 감춘다.
// 다른 확장 · 테마가 같은 일을 하면 쉰다(둘이 스크롤을 번갈아 당기지 않게). 채팅이 바뀐 직후 우리가 손대기 전에 한 번만 본다:
// 그쪽이 ‘읽던 자리로 옮기는 중’ 신호(chat-reading-resume)를 냈거나, 채팅을 인라인 opacity 로 가려 두었거나, 이미 맨 아래가 아닌 자리로 옮겨 놨으면 그쪽 것.
// 가리기는 우리 클래스로만 — 채팅의 인라인 opacity 를 떠 두었다 되돌리면, 다른 코드가 잠깐 가려 둔 값을 원래 값으로 알고 가린 채로 남는다.
const STORE = 'breeze.reading-positions';
const MAX_CHATS = 300;
let api = null, chat = null, listeners = [], entries = {};
let userMoved = false, movedKey = null, generating = false, job = null, saveTimer = 0, otherSignal = 0, resting = false;

function load() { try { entries = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { entries = {}; } }
function persist() {
    const keys = Object.keys(entries);
    if (keys.length > MAX_CHATS) keys.sort((a, b) => entries[a].at - entries[b].at).slice(0, keys.length - MAX_CHATS).forEach(k => delete entries[k]);
    try { localStorage.setItem(STORE, JSON.stringify(entries)); } catch { /* 저장소가 막힌 브라우저 */ }
}

function chatKey() {
    const c = api.ctx();
    const id = c.getCurrentChatId?.();
    if (!id) return null;
    const owner = c.groupId ? `g:${c.groupId}` : `c:${c.characters?.[c.characterId]?.avatar ?? c.characterId}`;
    return `${owner}|${id}`;
}

// 메시지를 알아보는 표시: 번호만으로는 앞 메시지를 지우면 어긋나므로 보낸 시각까지
const stamp = m => `${m?.send_date ?? ''}|${m?.is_user ? 1 : 0}`;

function capture() {
    const key = chatKey();
    // 채팅을 바꾸는 사이(옛 채팅이 비워지고 새 채팅이 그려지는 동안)에도 스크롤 신호가 나옴 — 그때 재면 ‘맨 아래’로 덮어써 읽던 자리를 잃음.
    // 그래서 사람이 굴린 그 채팅일 때만, 메시지가 그려져 있을 때만 적음
    if (!key || !chat || key !== movedKey || !chat.querySelector(':scope > .mes')) return;
    const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
    if (atBottom) { entries[key] = { bottom: true, at: Date.now() }; return schedulePersist(); }
    const top = chat.getBoundingClientRect().top;
    let first = null;
    for (const mes of chat.querySelectorAll(':scope > .mes')) {
        if (mes.getBoundingClientRect().bottom > top + 1) { first = mes; break; }
    }
    if (!first) return;
    const id = Number(first.getAttribute('mesid'));
    entries[key] = { id, stamp: stamp(api.ctx().chat?.[id]), offset: Math.round(top - first.getBoundingClientRect().top), at: Date.now() };
    schedulePersist();
}
function schedulePersist() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 300); }

let lastCapture = 0, trailing = 0;
// 굴리는 동안 매번 재면 긴 답에서 배치 계산을 계속 시켜 느려지므로 0.25초에 한 번 + 마지막 자리
function onScroll() {
    if (!userMoved || job || generating || resting) return;
    const wait = lastCapture + 250 - Date.now();
    clearTimeout(trailing);
    if (wait > 0) { trailing = setTimeout(onScroll, wait); return; }
    lastCapture = Date.now();
    capture();
}

function onGesture(e) {
    if (e.type === 'keydown' && (!/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/.test(e.key) || e.target?.closest?.('input, textarea, select, [contenteditable]'))) return;
    if (e.type !== 'keydown' && !e.target?.closest?.('#chat')) return;
    userMoved = true;
    movedKey = chatKey();
    finish();   // 자리 맞추는 중에 사람이 움직이면 그 사람 뜻대로
}

const show = () => {};   // 채팅을 가리지 않음(예전 판이 남긴 표시를 지울 일도 없음)

// 옮긴 뒤 실리태번이 맨 아래로 한 번 더 내림(채팅을 열 때 늦게 부르는 맨 아래로 이동) — 그대로 두면 맨 아래가 한 번 보였다가 돌아왔음.
// 스크롤 신호는 화면을 그리기 직전에 오므로, 그때 바로 제자리로 돌려 그 화면이 안 보이게 함(사람이 움직이면 job 이 끝나 손대지 않음)
function holdPlace() {
    if (!job?.jumped || job.lastTop === null) return;
    const mes = chat.querySelector(`:scope > .mes[mesid="${job.entry.id}"]`);
    if (!mes || Math.abs(chat.scrollTop - job.lastTop) < chat.clientHeight / 2) return;
    chat.scrollTop = Math.max(0, chat.scrollTop + mes.getBoundingClientRect().top - chat.getBoundingClientRect().top + job.entry.offset);
}

// 자리를 잡은 뒤 2초 동안은 채팅을 맨 아래로 내리는 것을 그 자리에서 막음: 실리태번은 채팅을 열고 나서 ‘다음 화면 그리기 직전’에 맨 아래로 내리는데,
// 그건 스크롤 신호보다 늦게 돌아서 신호를 듣고 되돌리면 맨 아래 화면이 한 장 먼저 나갔음(맨 아래로 갔다가 올라옴).
// 채팅 칸의 scrollTop 에 값을 넣는 길을 잠깐 거쳐 가게 해, 읽던 자리에서 반 화면 넘게 벗어나는 값은 읽던 자리로 바꿈. 사람이 움직이면 바로 풂
const protoTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
function targetTop() {
    const mes = job && chat.querySelector(`:scope > .mes[mesid="${job.entry.id}"]`);
    return mes ? Math.max(0, protoTop.get.call(chat) + mes.getBoundingClientRect().top - chat.getBoundingClientRect().top + job.entry.offset) : null;
}
function guardOn() {
    if (Object.prototype.hasOwnProperty.call(chat, 'scrollTop')) return;
    Object.defineProperty(chat, 'scrollTop', {
        configurable: true,
        get() { return protoTop.get.call(this); },
        set(v) {
            const t = job?.jumped ? targetTop() : null;
            protoTop.set.call(this, t !== null && Math.abs(Number(v) - t) > this.clientHeight / 2 ? t : v);
        },
    });
}
function guardOff() { if (chat && Object.prototype.hasOwnProperty.call(chat, 'scrollTop')) delete chat.scrollTop; }

function finish() {
    guardOff();
    if (!job) return;
    clearTimeout(job.timer);
    show();
    job = null;
}

function restore() {
    finish();
    userMoved = false;
    movedKey = null;
    if (generating) return;
    const key = chatKey();
    const entry = key && entries[key];
    resting = false;
    if (!entry || entry.bottom) return;
    const opened = Date.now();
    job = { key, entry, until: opened + 2000, lastTop: null, stable: 0, timer: 0, checked: false, jumped: false };
    const tryOnce = () => {
        if (!job || chatKey() !== job.key) return finish();
        if (!job.checked) {
            job.checked = true;
            const moved = chat.scrollTop > 0 && chat.scrollHeight - chat.scrollTop - chat.clientHeight > chat.clientHeight * 1.5;   // 그림이 늦게 그려져 조금 떨어진 것은 옮긴 것으로 안 봄
            if (otherSignal >= opened - 500 || chat.style.opacity === '0' || (moved && !job.jumped)) { resting = true; return finish(); }
        }
        const mes = chat.querySelector(`:scope > .mes[mesid="${entry.id}"]`);
        const msg = api.ctx().chat?.[entry.id];
        if (!mes || stamp(msg) !== entry.stamp) {
            // 아직 안 불러온 옛 메시지거나 그 사이 메시지가 바뀜 — 기다리는 동안 빈 화면이 보이지 않게 바로 보여 줌
            if (!msg && Date.now() < job.until) { show(); job.timer = setTimeout(tryOnce, 200); return; }
            return finish();
        }
        // 한 번만 옮기고 그 뒤는 브라우저에 맡김: 위쪽 그림 · 카드가 늦게 그려져 높이가 바뀌어도 브라우저가 보던 메시지를 제자리에 붙잡아 둠(스크롤 고정).
        // 자주 다시 재고 옮기면 긴 채팅일수록 재는 데 화면이 멈추고 옮길 때마다 덜컥임
        if (!job.jumped) {
            chat.scrollTop = Math.max(0, chat.scrollTop + mes.getBoundingClientRect().top - chat.getBoundingClientRect().top + entry.offset);
            job.jumped = true;
            job.lastTop = Math.round(chat.scrollTop);
            guardOn();
        }
        show();
        // 남은 시간 동안은 실리태번이 맨 아래로 크게 내리는 것만 막고(holdPlace) 끝냄
        job.timer = setTimeout(finish, Math.max(0, job.until - Date.now()));
    };
    // 채팅을 가리지 않고, 채팅이 바뀐 이 순간(메시지는 이미 그려져 있고 화면엔 아직 안 나간 때) 바로 그 자리로 옮김 —
    // 채팅을 가린 채 기다리면 열 때마다 바탕(검은 화면)이 잠깐 보임.
    const mes = chat.querySelector(`:scope > .mes[mesid="${entry.id}"]`);
    if (mes && stamp(api.ctx().chat?.[entry.id]) === entry.stamp) {
        chat.scrollTop = Math.max(0, chat.scrollTop + mes.getBoundingClientRect().top - chat.getBoundingClientRect().top + entry.offset);
        job.jumped = true;
        job.lastTop = Math.round(chat.scrollTop);
        guardOn();
    }
    // 다른 쪽의 신호는 채팅이 바뀐 그 순간(같은 신호의 다른 처리기)에 나오므로 다음 차례에 봄
    job.timer = setTimeout(tryOnce, 0);
}

// 채팅을 그리는 동안(메시지가 붙는 그 순간, 화면에 나가기 전) 읽던 메시지가 붙으면 바로 옮김 — 채팅이 다 열렸다는 신호까지 기다리면
// 그사이 실리태번이 맨 아래로 내린 화면이 한 번 보였다가 돌아왔음. 채팅이 비워지면(다른 채팅으로 바뀜) 다시 볼 준비
let early = null, earlyKey = null;
function onChatChildren() {
    if (!chat.querySelector(':scope > .mes')) { earlyKey = null; return; }
    const key = chatKey();
    if (!key || key === earlyKey || generating) return;
    const entry = entries[key];
    if (!entry || entry.bottom) return;
    const mes = chat.querySelector(`:scope > .mes[mesid="${entry.id}"]`);
    if (!mes || stamp(api.ctx().chat?.[entry.id]) !== entry.stamp) return;
    earlyKey = key;
    restore();
}

const GESTURES = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
const onOtherSignal = () => { otherSignal = Date.now(); };
function onLeave() { if (userMoved && !job) capture(), persist(); }
function onVisibility() { if (document.visibilityState === 'hidden') onLeave(); }

export function start(a) {
    api = a;
    chat = document.getElementById('chat');
    if (!chat) return;
    load();
    const { eventSource, eventTypes: ev } = a.ctx();
    const on = (name, fn) => { if (ev[name]) { eventSource.on(ev[name], fn); listeners.push([ev[name], fn]); } };
    on('CHAT_CHANGED', () => { generating = false; if (!(job && job.key === chatKey() && job.jumped)) restore(); });   // 그리는 중에 이미 옮겼으면 그대로
    early = new MutationObserver(onChatChildren);
    early.observe(chat, { childList: true });
    on('GENERATION_STARTED', (type, _opts, dryRun) => { if (dryRun || type === 'quiet') return; onLeave(); generating = true; finish(); userMoved = false; });
    on('GENERATION_ENDED', () => { generating = false; });
    on('GENERATION_STOPPED', () => { generating = false; });
    for (const name of ['MESSAGE_SENT', 'MESSAGE_SWIPED', 'MESSAGE_DELETED']) on(name, () => { finish(); userMoved = false; });
    for (const g of GESTURES) document.addEventListener(g, onGesture, { capture: true, passive: true });
    chat.addEventListener('scroll', onScroll, { passive: true });
    chat.addEventListener('scroll', holdPlace, { passive: true });
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('chat-reading-resume', onOtherSignal);
}

export function stop() {
    finish();
    clearTimeout(trailing);
    const { eventSource } = api.ctx();
    for (const [n, fn] of listeners) eventSource.removeListener?.(n, fn);
    listeners = [];
    for (const g of GESTURES) document.removeEventListener(g, onGesture, true);
    chat?.removeEventListener('scroll', onScroll);
    chat?.removeEventListener('scroll', holdPlace);
    early?.disconnect(); early = null;
    window.removeEventListener('pagehide', onLeave);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('chat-reading-resume', onOtherSignal);
}
