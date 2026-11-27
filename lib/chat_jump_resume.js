// 기능 목록에 줄을 두지 않고 breeze 가 켜질 때 늘 같이 돈다(끄고 켤 일이 없는 고침).
// /chat-jump 멈춤 해결: 메시지로 부드럽게 굴러가다(scrollTo smooth) 중간에 멈춰 엉뚱한 자리에 남는 문제.
// 까닭: 위쪽 메시지를 불러온 직후 다른 코드가 그 메시지를 다시 그리며 scrollTop 을 다시 넣으면 브라우저가 부드러운 스크롤을 그 자리에서 끝낸다.
//       상태창이 많은 긴 채팅일수록 굴러가는 시간이 길어 도중에 걸린다.
// 하는 일: 채팅 칸의 scrollTo 가 '메시지 맨 위로 부드럽게'일 때만 지켜본다.
//   ① 방금 메시지를 불러왔으면 채팅 칸이 0.2초 조용해질 때까지(1.5초까지) 기다렸다 굴림 → 시작하자마자 끊기지 않음
//   ② 그래도 목적지 전에 멈추면 목적지 한 화면 앞까지 옮기고 남은 한 화면만 부드럽게(15초까지). 사용자가 굴리거나 누르면 그만둠
// 잘 가는 스크롤은 그대로 한 번에 간다. 메시지 맨 위가 아닌 스크롤 · 바로 뛰는 스크롤은 건드리지 않는다.
let chat = null, orig = null, wrapped = null, addWatch = null, lastAdd = 0, job = null;
const USER = ['wheel', 'touchstart', 'keydown', 'mousedown'];

function endJob() {
    if (!job) return;
    clearInterval(job.timer); clearTimeout(job.cap); job.quiet?.disconnect();
    for (const t of USER) chat.removeEventListener(t, endJob);
    job = null;
}
// 그 높이에 맨 위가 놓일 메시지
function messageAt(top) {
    const base = chat.getBoundingClientRect().top - chat.scrollTop;
    for (const m of chat.querySelectorAll(':scope > .mes')) if (Math.abs(m.getBoundingClientRect().top - base - top) <= 2) return m;
    return null;
}
function follow(el) {
    const offset = () => el.getBoundingClientRect().top - chat.getBoundingClientRect().top;
    const go = () => orig.call(chat, { top: chat.scrollTop + offset(), behavior: 'smooth' });
    endJob();
    job = { timer: 0, cap: setTimeout(endJob, 15000), quiet: null };
    for (const t of USER) chat.addEventListener(t, endJob, { passive: true });
    const watch = () => {
        let last = -1;
        job.timer = setInterval(() => {
            const off = offset(), top = chat.scrollTop, moving = top !== last;
            last = top;
            const atEnd = top >= chat.scrollHeight - chat.clientHeight - 1;
            if (!el.isConnected || Math.abs(off) <= 2 || (off > 0 && atEnd)) return endJob();
            if (moving) return;
            const near = Math.sign(off) * Math.min(Math.abs(off), chat.clientHeight);
            orig.call(chat, { top: top + off - near, behavior: 'instant' });
            go();
        }, 250);
    };
    if (Date.now() - lastAdd > 1000) { go(); watch(); return; }
    // 방금 메시지를 불러옴: 다시 그리기가 잦아들 때까지 기다림
    let t = 0;
    const start = () => { if (!job) return; job.quiet?.disconnect(); job.quiet = null; clearTimeout(t); clearTimeout(max); go(); watch(); };
    job.quiet = new MutationObserver(() => { clearTimeout(t); t = setTimeout(start, 200); });
    job.quiet.observe(chat, { childList: true, subtree: true, attributes: true, characterData: true });
    t = setTimeout(start, 200);
    const max = setTimeout(start, 1500);
}

export function start() {
    chat = document.getElementById('chat');
    if (!chat) return;
    orig = chat.scrollTo;
    wrapped = function (...args) {
        const o = args[0];
        const el = args.length === 1 && o && typeof o === 'object' && o.behavior === 'smooth' && Number.isFinite(o.top) ? messageAt(o.top) : null;
        if (!el) return orig.apply(this, args);
        follow(el);
    };
    chat.scrollTo = wrapped;
    // 메시지가 채팅 칸에 새로 붙은 때만 적어 둠(칸 바로 아래만 봄: 안쪽 변화는 안 봄)
    addWatch = new MutationObserver((list) => { if (list.some(r => r.addedNodes.length)) lastAdd = Date.now(); });
    addWatch.observe(chat, { childList: true });
}
export function stop() {
    endJob();
    addWatch?.disconnect(); addWatch = null;
    if (chat && chat.scrollTo === wrapped) { delete chat.scrollTo; wrapped = null; return true; }
    return false;   // 다른 코드가 그 위에 덧씌움 → 새로고침해야 완전히 꺼짐
}
