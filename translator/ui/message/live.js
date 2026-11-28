// 번역을 받는 동안의 미리 보기: 다 받은 문단부터 화면에서 번역으로 바꾸고, 아직 기다리는 문단은 원문을 흐리게 둔다.
// 저장된 글은 건드리지 않고 화면에만 그린다. 알림은 job/closed.js 가 준다(요청을 보냄, 문단 하나를 다 받음, 끝남).
//
// 그리는 것은 문단을 다 받았을 때 그 문단 하나뿐이다(글자 조각이 올 때마다 메시지를 다시 그리면 이미 보인 문단까지 새 요소가 되어
// 글이 계속 움직인다). 받는 중인 문단은 건드리지 않는다.
// 화면 문단은 번역을 시작할 때 한 번 원문 문단에 맞춰 두고(paragraphs.js alignTo), 그 뒤로는 원문 문단 번호로 찾는다.
// 이야기 문단이 아닌 곳(코드, 스크립트나 정규식이 따로 그린 칸)은 paragraphs.js 가 문단으로 세지 않으므로 건드리지 않는다.
// 문단의 원래 마디는 들고 있다가, 멈추거나 실패하면 그대로 되돌린다. 번역이 붙어 메시지가 다시 그려지면 표시는 요소와 함께 사라진다.
//
// mount(api) → { handle(event), close() }
//   api.bodyOf(id) → Element | null   그 메시지의 본문 요소. 그리면 안 될 때(화면에 없음, 번역이 이미 보이는 중, 글을 고치는 칸이 열림)는 null
//   api.shown(text, id) → string      화면에 글자로 나오는 글만 남긴 글
//   api.clean?(html) → string         허용한 글자 꾸밈 태그만 남긴 HTML
//   api.keepSource?() → boolean       원문을 먼저 보는 보기인가(그러면 받은 문단도 원문 그대로 두고 흐림만 걷는다)

import { proseIn, ownText, alignTo, lightHtml, richHtml, lettersOf } from './paragraphs.js';

const WAIT = 'btr-live-wait', GOT = 'btr-live-got';

/** 화면 문단을 원문 문단에 맞춘다 → 원문 문단 번호 → 그 문단을 그린 요소들 */
function placesIn(body, paragraphs) {
    const els = proseIn(body), places = new Map();
    alignTo(els.map(ownText), paragraphs).forEach((at, i) => {
        if (at >= 0) places.set(at, [...(places.get(at) ?? []), els[i]]);
    });
    return places;
}

/** 번역을 시작할 때 한 번: 그릴 수 없으면 빈 것을 적어 둔다(도중에 메시지가 다시 그려져도 새로 맞추지 않고 건너뛴다) */
function begin(api, { id, sources }) {
    const body = api.bodyOf(id);
    return { body, places: body ? placesIn(body, sources.map(text => api.shown(text, id))) : new Map(), kept: new Map() };
}

const usable = run => Boolean(run?.body?.isConnected);

function dim(run, ats) {
    if (!usable(run)) return;
    for (const at of ats) for (const el of run.places.get(at) ?? []) if (!run.kept.has(el)) el.classList.add(WAIT);
}

/**
 * 문단 하나를 번역으로. 한 문단이 화면에서 여러 요소로 그려졌으면(목록 항목들) 어느 줄이 어느 요소인지 알 수 없어 원문 그대로 밝히기만 한다.
 * 원문을 먼저 보는 보기면 글은 바꾸지 않고 밝히기만 한다: 번역으로 바꿨다가 끝날 때 원문으로 되돌리면 문단마다 글과 높이가 두 번 바뀐다
 */
function swap(api, run, { id, at, text }) {
    const els = (usable(run) ? run.places.get(at) : null) ?? [];
    const shown = api.shown(text, id), [el] = els;
    if (els.length === 1 && el.isConnected && lettersOf(shown) && !api.keepSource?.()) {
        if (!run.kept.has(el)) run.kept.set(el, [...el.childNodes]);
        el.innerHTML = api.clean && /<[a-z]/i.test(shown) ? api.clean(richHtml(shown)) : lightHtml(shown);
        el.classList.add(GOT);
    }
    for (const each of els) each.classList.remove(WAIT);
}

/** 끝: 흐림을 걷고, 바꿔 둔 문단을 원래 마디로 되돌린다. 메시지가 이미 다시 그려졌으면(번역이 붙음) 옛 요소는 화면에 없어 할 일이 없다 */
function revert(run) {
    for (const els of run.places.values()) for (const el of els) el.classList.remove(WAIT, GOT);
    for (const [el, nodes] of run.kept) if (el.isConnected) el.replaceChildren(...nodes);
    run.kept.clear();
}

export function mount(api) {
    const runs = new Map();   // 메시지 번호 → 받는 중인 미리 보기
    const end = id => { const run = runs.get(id); runs.delete(id); if (run) revert(run); };
    return {
        handle(event) {
            if (event.type === 'end') { end(event.id); return; }
            if (!runs.has(event.id)) { if (event.type !== 'wait') return; runs.set(event.id, begin(api, event)); }
            const run = runs.get(event.id);
            if (event.type === 'wait') dim(run, event.ats); else swap(api, run, event);
        },
        close() { for (const id of [...runs.keys()]) end(id); },
    };
}
