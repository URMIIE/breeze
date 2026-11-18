import { styledBy, fromSheet, theme } from '../lib/who.js';
// 항목 많은 월드인포 창 가볍게.
// ① 월드인포 편집 창은 한 쪽에 보이는 항목을 모두 한꺼번에 배치 · 그리기 때문에 항목이 많으면 굴릴 때 버벅인다.
//    화면 밖 항목은 브라우저가 배치 · 그리기를 건너뛰게 한다(content-visibility). 항목 내용 · 순서 · 저장에는 손대지 않는다.
//    입력 초점이 든 항목(고치는 중)은 건너뛰지 않는다. 펼친 항목 전체를 빼는 것도 재 봤는데(항목 300개, 5개 펼침),
//    펼친 항목이 늘 그려져 굴릴 때 가장 긴 멈춤이 약 40ms 늘기만 하고 잘림 같은 문제는 없어 빼지 않는다.
// ② 실리태번은 창을 굴릴 때마다 열린 항목들의 그룹 · 자동화 ID 칸을 다 훑어 자동완성 메뉴를 하나씩 닫는다.
//    메뉴는 초점을 잃으면 닫히므로 열려 있을 수 있는 건 초점이 있는 칸 하나뿐 — 그 칸만 닫게 바꾼다.
//    실리태번의 처리기를 그 내용(자동완성을 닫는 일)으로 알아보고, 못 찾으면(업데이트로 바뀜) 손대지 않는다. 끄면 원래 것으로 되돌린다.
// 다른 확장 · 테마가 이미 ① 을 해 두었으면(항목에 content-visibility 가 걸려 있으면) ① 은 쉰다 — 창이 열릴 때 한 번만 본다.
// (항목마다 거는 캐릭터 지정칸 꾸밈(select2)을 쓸 때까지 미루는 방법도 재 봤는데, 항목 300개에서 펼치기가 빨라지지 않아 넣지 않음.)
const CSS = `
#world_popup_entries_list.etk-light .world_entry:not(:focus-within) { content-visibility: auto; contain-intrinsic-size: auto 60px; }
`;
const AUTOCOMPLETE = '.world_entry input[name="group"], .world_entry input[name="automationId"]';
let style = null, observer = null, swapped = null;

function check(list) {
    const first = list.querySelector('.world_entry');
    if (!first) return;
    list.classList.remove('etk-light');
    const taken = getComputedStyle(first).contentVisibility !== 'visible';
    list.classList.toggle('etk-light', !taken);
    if (!taken) api?.rest(null); else api?.rest('same', { saw: "월드인포 항목에 '화면 밖은 안 그리기'(content-visibility)가 이미 걸려 있어요", who: styledBy(first, 'content-visibility', v => !!v && v !== 'visible'), back: '그쪽을 끄면 다음에 월드인포 창을 열 때 breeze가 맡아요.' });
}

function closeFocusedAutocomplete() {
    const input = document.activeElement;
    if (!(input instanceof HTMLInputElement) || !input.matches(AUTOCOMPLETE)) return;
    const $input = $(input);
    // 열렸는지는 메뉴의 인라인 display 로 봄(:visible 은 화면 계산을 부름)
    if ($input.autocomplete('instance') !== undefined && $input.autocomplete('widget')?.[0]?.style.display !== 'none') $input.autocomplete('close');
}

function swapScrollHandler() {
    if (swapped) return true;
    const box = document.getElementById('WorldInfo');
    const list = box && window.jQuery?._data?.(box, 'events')?.scroll;
    const stock = Array.isArray(list) ? list.find(({ handler }) => { const src = String(handler); return src.includes('automationId') && src.includes('autocomplete'); }) : null;
    if (!stock) return false;
    $(box).off('scroll', stock.handler).on('scroll', closeFocusedAutocomplete);
    swapped = { box, original: stock.handler };
    return true;
}

function restoreScrollHandler() {
    if (!swapped) return;
    const { box, original } = swapped;
    swapped = null;
    $(box).off('scroll', closeFocusedAutocomplete);
    const has = ($._data(box, 'events')?.scroll || []).some(({ handler }) => handler === original);
    if (!has) $(box).on('scroll', original);
}

let api = null, onReady = null;
export function start(a) {
    api = a;
    const list = document.getElementById('world_popup_entries_list');
    if (!list) return;
    style = document.createElement('style');
    style.id = 'etk-light-worldinfo';
    style.textContent = CSS;
    document.head.append(style);
    // 목록이 비었다가 채워질 때(책을 열 때 · 쪽을 넘길 때)만 — 바로 아래 자식이 바뀌는 것만 봄
    let had = false;
    observer = new MutationObserver(() => {
        const has = !!list.firstElementChild;
        if (has && !had) check(list);
        had = has;
    });
    observer.observe(list, { childList: true });
    check(list);
    // 실리태번이 굴림 처리기를 거는 건 앱 준비 때라, 아직이면 그때 바꿈
    if (!swapScrollHandler()) {
        const { eventSource, eventTypes } = a.ctx();
        onReady = () => { onReady = null; if (style) swapScrollHandler(); };
        eventSource.once?.(eventTypes.APP_READY, onReady);
    }
}

export function stop() {
    observer?.disconnect(); observer = null;
    style?.remove(); style = null;
    document.getElementById('world_popup_entries_list')?.classList.remove('etk-light');
    if (onReady) { api?.ctx().eventSource.removeListener?.(api.ctx().eventTypes.APP_READY, onReady); onReady = null; }
    restoreScrollHandler();
}
