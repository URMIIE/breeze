// 테마가 화면에 color-scheme: dark 를 걸면, 표시가 없는 iframe 안 문서와 어긋나서 브라우저가 iframe 바탕을 불투명 흰색으로 칠한다.
// 투명 바탕으로 만든 메시지 속 카드가 흰 상자로 뜨고 옅은 글자가 안 보이므로, iframe 쪽을 안 문서와 같은 normal 로 맞춘다.
let style = null;

export function start() {
    style = document.createElement('style');
    style.id = 'etk-iframe-dark-fix';
    style.textContent = 'html body #chat .mes iframe { color-scheme: normal !important; }';
    document.head.append(style);
}

export function stop() {
    style?.remove();
    style = null;
}
