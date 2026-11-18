// 테마가 화면에 color-scheme: dark 를 걸면, 표시가 없는 iframe 안 문서와 어긋나서 브라우저가 iframe 바탕을 불투명 흰색으로 칠한다.
// 투명 바탕으로 만든 메시지 속 카드가 흰 상자로 뜨고 옅은 글자가 안 보이므로, iframe 쪽을 안 문서와 같은 normal 로 맞춘다.
// 다른 쪽이 이미 iframe 에 dark 가 아닌 color-scheme 을 걸어 두었으면 쉰다: 우리 규칙을 잠깐 끈 채 iframe 값을 봄.
// 화면이 dark 일 때만 판단할 거리가 있고, 채팅마다 iframe 이 처음 보일 때 한 번만 본다(우리 규칙을 껐다 켜면 화면 전체를 다시 계산하므로)
import { styledBy } from '../lib/who.js';
let style = null, api = null, checkedChat = null, offs = [];

function check() {
    if (!style || !api) return;
    const chatId = api.ctx().getCurrentChatId?.() || '';
    if (checkedChat === chatId) return;
    const frame = document.querySelector('#chat .mes iframe');
    if (!frame) return;
    checkedChat = chatId;
    if (!/dark/.test(getComputedStyle(document.documentElement).colorScheme + ' ' + getComputedStyle(document.body).colorScheme)) { style.disabled = false; api.rest(null); return; }
    style.disabled = true;
    const other = getComputedStyle(frame).colorScheme;
    if (other && !/dark/.test(other)) {
        api.rest('same', { saw: `메시지 속 상태창(iframe)에 다른 쪽이 이미 바탕 처리(color-scheme: ${other})를 걸어 두었어요`, who: styledBy(frame, 'color-scheme', v => !!v && !/dark/.test(v)), back: '그쪽을 끄면 다음에 채팅을 열 때 breeze가 맡아요.' });
        return;   // 그쪽 것이 이미 같은 일을 해서 우리 규칙은 꺼 둠
    }
    style.disabled = false;
    api.rest(null);
}

export function start(a) {
    api = a;
    style = document.createElement('style');
    style.id = 'etk-iframe-dark-fix';
    style.textContent = 'html body #chat .mes iframe { color-scheme: normal !important; }';
    document.head.append(style);
    const { eventSource, eventTypes } = api.ctx();
    const later = () => setTimeout(check, 300);
    const onChat = () => { checkedChat = null; later(); };
    eventSource.on(eventTypes.CHAT_CHANGED, onChat);
    eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, later);
    offs = [() => eventSource.removeListener(eventTypes.CHAT_CHANGED, onChat), () => eventSource.removeListener(eventTypes.CHARACTER_MESSAGE_RENDERED, later)];
    later();
}

export function stop() {
    offs.forEach(f => f()); offs = [];
    style?.remove();
    style = null; checkedChat = null;
}
