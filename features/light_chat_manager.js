import { styledBy, fromSheet, theme } from '../lib/who.js';
// 채팅 파일 관리 창 가볍게.
// 채팅 파일이 많은 캐릭터는 관리 창의 줄이 수백 개라 굴릴 때 버벅이고, 창을 닫은 뒤에도 그 줄들이 화면 뒤에 남아 페이지를 무겁게 한다.
// ① 화면 밖 줄은 브라우저가 그리기를 건너뛰게 하고(content-visibility — 채팅 줄과 그 창의 백업 목록 줄), ② 창을 닫으면 목록을 비운다(다시 열면 실리태번이 새로 채움).
// 다른 확장 · 테마가 이미 채팅 줄에 같은 처리를 해 두었으면 채팅 줄은 쉰다 — 창이 열릴 때 한 번만 본다(백업 목록 줄은 따로, 같은 값이라 겹쳐도 그대로).
const CSS = `
#select_chat_div.etk-light .select_chat_block_wrapper { content-visibility: auto; contain-intrinsic-size: auto 64px; }
#shadow_select_chat_popup .chatBackupsList > .chatBackupsListItem { content-visibility: auto; contain-intrinsic-size: auto 40px; }
`;
let style = null, listObserver = null, popupObserver = null, api = null;

export function start(a) {
    api = a;
    const list = document.getElementById('select_chat_div');
    const popup = document.getElementById('shadow_select_chat_popup');
    if (!list || !popup) return;
    style = document.createElement('style');
    style.id = 'etk-light-chat-manager';
    style.textContent = CSS;
    document.head.append(style);
    // 목록이 비었다가 채워질 때만(바로 아래 자식만 봄)
    let had = false;
    listObserver = new MutationObserver(() => {
        const first = list.firstElementChild;
        if (first && !had) {
            list.classList.remove('etk-light');
            const row = list.querySelector('.select_chat_block_wrapper');
            const mine = !!row && getComputedStyle(row).contentVisibility === 'visible';
            list.classList.toggle('etk-light', mine);
            if (row && mine) api?.rest(null); else if (row) api?.rest('same', { saw: "채팅 줄에 '화면 밖은 안 그리기'(content-visibility)가 이미 걸려 있어요", who: styledBy(row, 'content-visibility', v => !!v && v !== 'visible'), back: '그쪽을 끄면 다음에 관리 창을 열 때 breeze가 맡아요.' });
        }
        had = !!first;
    });
    listObserver.observe(list, { childList: true });
    // 창이 닫히면(보임 상태가 바뀔 때만 — 이 요소의 style · class 만 봄) 목록 비우기
    popupObserver = new MutationObserver(() => {
        if (getComputedStyle(popup).display === 'none' && list.firstElementChild) list.replaceChildren();
    });
    popupObserver.observe(popup, { attributes: true, attributeFilter: ['style', 'class'] });
}

export function stop() {
    listObserver?.disconnect(); listObserver = null;
    popupObserver?.disconnect(); popupObserver = null;
    style?.remove(); style = null;
    document.getElementById('select_chat_div')?.classList.remove('etk-light');
}
