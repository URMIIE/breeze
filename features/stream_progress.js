// 답 받는 중 표시: 답이 써지는 동안 그 메시지 아래에 ‘받는 중 · 1,234자’를 보여 줌.
// 까닭: 답에 상태창 코드(<style> · HTML)가 들어 있으면, 다 올 때까지 화면에는 반쯤 온 코드가 안 그려지거나 실리태번이 ‘CSS ERROR: …’ 한 줄만 보여 줘서
//       답이 멈춘 것처럼 보였다(실제로는 안 보이는 코드를 받는 중).
// 하는 일: 생성이 시작되면 0.4초마다 지금 받는 메시지의 글자 수만 읽어 메시지 글 끝(글 칸의 ::after)에 적고,
//          새 글이 5초 넘게 없으면 그 시간도 같이 적음. 받는 동안 글 칸에 뜬 ‘CSS ERROR: …’ 줄은 ‘상태창 꾸밈을 받는 중이에요’로 바꿔 보여 줌(화면만).
//          생성이 끝나거나 멈추면 지움. 생성 중이 아닐 때는 아무것도 돌지 않음.
let api = null, timer = 0, shownOn = null, lastLen = -1, lastAt = 0, listeners = [];
const ctx = () => api.ctx();

const ATTR = 'data-etk-stream-progress';
const hide = () => { shownOn?.removeAttribute(ATTR); shownOn = null; };
function clear() {
    clearInterval(timer); timer = 0;
    hide();
    lastLen = -1;
}
function tick() {
    const c = ctx(), p = c.streamingProcessor;
    // 생성이 시작된 직후엔 아직 받는 줄이 없다(첫 글자 전) → 기다림. 끝은 생성 끝 · 멈춤 신호로만
    if (!p || p.isFinished || p.isStopped) { hide(); return; }
    const id = Number(p.messageId), mes = document.querySelector(`#chat .mes[mesid="${id}"]`), text = mes?.querySelector('.mes_text');
    const len = String(c.chat?.[id]?.mes || '').length;
    if (!text || !len) { hide(); return; }
    if (len !== lastLen) { lastLen = len; lastAt = Date.now(); }
    const quiet = Math.floor((Date.now() - lastAt) / 1000);
    const label = `받는 중 · ${len.toLocaleString('ko-KR')}자${quiet >= 5 ? ` · ${quiet}초째 새 글 없음` : ''}`;
    // 글 칸 끝에 글 칸 자신의 꾸밈(::after)으로 적음 — 메시지 안에 줄을 따로 끼우면 테마가 메시지 안을 격자 · 순서로 다시 짜 놓은 곳에서 자리가 제각각이었음.
    // 실리태번이 글 칸 안을 글자마다 다시 그려도 글 칸에 붙인 속성은 남음
    if (shownOn !== text) { hide(); shownOn = text; }
    if (text.getAttribute(ATTR) !== label) text.setAttribute(ATTR, label);
    // 반쯤 온 <style> 을 실리태번이 오류 글로 바꿔 보여 준 줄
    const w = document.createTreeWalker(text, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) if (n.nodeValue.includes('CSS ERROR: ')) n.nodeValue = n.nodeValue.replace(/CSS ERROR: [^\n]*/g, '상태창 꾸밈을 받는 중이에요');
}
const begin = () => { if (!timer) { lastLen = -1; lastAt = Date.now(); timer = setInterval(tick, 400); } };

export function start(a) {
    api = a;
    const { eventSource, eventTypes } = ctx();
    const listen = (ev, fn) => { eventSource.on(ev, fn); listeners.push([ev, fn]); };
    listen(eventTypes.GENERATION_STARTED, (_type, _options, dryRun) => { if (!dryRun) begin(); });
    listen(eventTypes.GENERATION_ENDED, clear);
    listen(eventTypes.GENERATION_STOPPED, clear);
    listen(eventTypes.CHAT_CHANGED, clear);
    if (ctx().streamingProcessor && !ctx().streamingProcessor.isFinished) begin();
}
export function stop() {
    const { eventSource } = ctx();
    for (const [ev, fn] of listeners) eventSource.removeListener?.(ev, fn);
    listeners = [];
    clear();
}
