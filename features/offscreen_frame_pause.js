// 화면 밖 상태창(메시지 안 iframe)의 움직임 멈추기.
// 정규식이나 스크립트 확장이 그리는 상태창은 같은 출처 iframe 이라, 화면 밖으로 스크롤돼 안 보여도 브라우저가 끝없는 CSS 움직임(입자 · 깜빡임 · 빛줄기)을
// 계속 다시 그렸다. 상태창 몇 개만 있어도 가만히 둔 채팅이 CPU 를 40% 가까이 써서, 무엇을 누르든 그 위에서 돌아 느렸다.
// → iframe 이 화면(위아래 반 화면 여유)에서 벗어나면 그 안 문서의 CSS 움직임을 멈추고, 다시 들어오면 그 자리에서 이어서 움직인다.
//   화면에 보이는 상태창은 그대로라 모양은 같다. 상태창이 다시 읽히면(load) 멈춤 표시가 사라지므로 그때 다시 맞춘다.
//   iframe 이 새로 생기는 건 #chat 에 붙는 요소만 보고 안에 iframe 이 있을 때만 일한다(글이 흘러 들어올 때 문서 전체를 다시 찾지 않게).
const PAUSE_ID = 'etk-frame-pause';
const PAUSE_CSS = '*,*::before,*::after{animation-play-state:paused!important}';
let io = null, mo = null, chat = null;
const seen = new WeakSet();
const off = new WeakSet();   // 지금 화면 밖인 iframe

function docOf(frame) { try { return frame.contentDocument; } catch { return null; } }
function setPaused(frame, paused) {
    const doc = docOf(frame);
    if (!doc?.head && !doc?.documentElement) return;
    const had = doc.getElementById(PAUSE_ID);
    if (paused && !had) {
        const s = doc.createElement('style');
        s.id = PAUSE_ID;
        s.textContent = PAUSE_CSS;
        (doc.head || doc.documentElement).append(s);
    } else if (!paused && had) had.remove();
}
function onLoad(e) { const f = e.currentTarget; setPaused(f, off.has(f)); }
function watch(frame) {
    if (seen.has(frame)) return;
    seen.add(frame);
    frame.addEventListener('load', onLoad);
    io.observe(frame);
}
function onIntersect(entries) {
    for (const e of entries) {
        const f = e.target;
        if (e.isIntersecting) off.delete(f); else off.add(f);
        setPaused(f, !e.isIntersecting);
    }
}

export function start() {
    chat = document.getElementById('chat');
    if (!chat) return;
    io = new IntersectionObserver(onIntersect, { rootMargin: '50% 0px 50% 0px' });
    chat.querySelectorAll('iframe').forEach(watch);
    mo = new MutationObserver((list) => {
        for (const m of list) for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'IFRAME') watch(n);
            else if (n.firstElementChild) n.querySelectorAll('iframe').forEach(watch);
        }
    });
    mo.observe(chat, { childList: true, subtree: true });
}

export function stop() {
    mo?.disconnect(); mo = null;
    io?.disconnect(); io = null;
    chat?.querySelectorAll('iframe').forEach(f => { f.removeEventListener('load', onLoad); setPaused(f, false); });
    chat = null;
}
