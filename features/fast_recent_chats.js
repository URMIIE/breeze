// 홈 화면 최근 채팅 빨리 띄우기.
// 홈 화면은 켤 때마다 서버에 최근 채팅 목록을 물어보는데, 서버가 채팅 파일들을 훑는 동안 목록 자리가 비어 있다.
// 지난번에 받은 목록을 브라우저에 적어 두었다가 바로 보여 주고, 그 뒤에서 진짜 목록을 받아 달라졌을 때만 홈 화면을 한 번 다시 그린다.
// 실리태번 홈 화면이 부른 요청만 손댄다.
const PATH = '/api/chats/recent';
const STORE = 'breeze.recent-chats';
let orig = null, wrapped = null, on = false, fresh = null, api = null, sawHome = false, firstCall = true, watchTimer = 0;
// 다른 쪽이 같은 일을 하는지: ① 실리태번 홈 화면이 목록을 처음 물을 때 화면에 이미 최근 채팅이 그려져 있거나
// ② 홈 화면에 최근 채팅이 그려졌는데 그 요청이 우리를 거치지 않았으면(다른 쪽이 먼저 답함) 쉬는 중 표시
const ROWS = '.recentChat';
const REST_INFO = (saw) => ({ saw, who: { kind: 'unknown' }, back: '그쪽을 끄면 다음에 켤 때부터 breeze가 맡아요.' });

const read = () => { try { return localStorage.getItem(STORE); } catch { return null; } };
const write = (text) => { try { localStorage.setItem(STORE, text); } catch { /* 저장소가 막힌 브라우저 */ } };
const reply = (text) => new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });

async function redraw() {
    // 채팅을 이미 열었으면 홈 화면이 아니므로 그대로 둠
    if (SillyTavern.getContext().getCurrentChatId?.()) return;
    try {
        const { openWelcomeScreen } = await import('../../../../welcome-screen.js');
        await openWelcomeScreen({ force: true });
    } catch (e) { console.warn('[Breeze] 최근 채팅 다시 그리기', e); }
}

export function start(a) {
    api = a;
    on = true;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
        if (on && !sawHome && !api.ctx().getCurrentChatId?.() && document.querySelector(ROWS)) api.rest('same', REST_INFO('홈 화면에 최근 채팅이 그려졌는데, 그 목록 요청이 breeze를 거치지 않았어요(다른 쪽이 먼저 답함)'));
    }, 8000);
    if (wrapped) return;
    orig = window.fetch;
    wrapped = async function (input, init) {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (!on || url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] !== PATH || !/welcome-screen\.js/.test(new Error().stack || '')) return orig.apply(this, arguments);
        // 방금 뒤에서 받아 둔 진짜 목록이 있으면(다시 그리는 중) 그걸 줌 — 요청을 또 보내지 않음
        if (fresh !== null) { const text = fresh; fresh = null; return reply(text); }
        sawHome = true;
        if (firstCall) {
            firstCall = false;
            if (document.querySelector(ROWS)) { api?.rest('same', REST_INFO('실리태번이 최근 채팅 목록을 받기도 전에 홈 화면에 목록이 이미 그려져 있었어요')); return orig.apply(this, arguments); }
            api?.rest(null);
        }
        const cached = read();
        if (cached === null) {
            const res = await orig.apply(this, arguments);
            if (res.ok) res.clone().text().then(write).catch(() => {});
            return res;
        }
        orig.apply(this, arguments).then(async (res) => {
            if (!res.ok) return;
            const text = await res.text();
            if (text === cached) return;
            write(text);
            fresh = text;
            await redraw();
            fresh = null;
        }).catch(() => {});
        return reply(cached);
    };
    window.fetch = wrapped;
}

// 다른 확장이 그 뒤에 fetch 를 또 감쌌으면 우리 것만 빼낼 수 없어, 그땐 감싼 채로 두고 그냥 지나가게 한다
export function stop() {
    on = false;
    if (window.fetch === wrapped) { window.fetch = orig; wrapped = null; }
}
