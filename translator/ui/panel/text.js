// 판의 화면들이 같이 쓰는 글 다루기, 시안의 선 그림(SV), 여러 화면에 같은 말로 나와야 하는 이름.

/** 넘겨받은 글을 HTML 안에 넣을 때: 태그와 속성 값으로 읽히지 않게 바꾼다 */
export const esc = text => String(text ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

const PATHS = {
    x: '<path d="M6 6l12 12M18 6L6 18"/>', ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    down: '<path d="M6 9l6 6 6-6"/>', up: '<path d="M6 15l6-6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>', left: '<path d="M15 6l-6 6 6 6"/>',
    pen: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z"/>', redo: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 5v6h-6"/>',
    swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
};
/** 시안의 선 그림: SV('down') · 'right' · 'x' · 'plus' · 'ok' · 'up' · 'left' · 'pen' · 'redo' · 'swap'. 색과 크기는 common.css 가 준다 */
export const SV = id => `<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[id] ?? ''}</svg>`;
/** 줄 앞의 Font Awesome 아이콘(시안의 IC) */
export const IC = name => `<i class="fa-solid fa-${name} lic" aria-hidden="true"></i>`;

/** 쓰는 곳 셋: 저장 이름 → 화면 글 */
export const PLACE_NAME = { all: '모든 채팅', card: '이 캐릭터', chat: '지금 채팅만' };

/** 용어집의 이름(옛 화면들이 아직 읽는다) */
export const NAMES = { title: '용어집', hint: '지명, 물건, 조직 이름' };
export const ALL_TITLE = '모든 채팅';
