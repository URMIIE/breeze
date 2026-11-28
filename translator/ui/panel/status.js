// 상태창 번역 화면.
// 상태창은 매번 같은 칸이라 한 번 저장된 번역이 계속 붙는다. 그 저장된 줄들을 보여 주고 고치게 한다.
// 위에서부터: 머리(이 캐릭터, 줄 수, 전부 비우기) → 한글 글꼴 · 원문으로 볼 정규식(누르면 그 화면으로: status-options.js)
//   → 찾기 칸 → 걸러 보기 → 줄 목록. 줄을 누르면 그 줄 바로 아래에 고치는 칸이 펼쳐진다. 여러 줄 고르기, 전부 비우기 확인, 빈 화면.
// 화면만 다룬다: 줄의 저장, 지우기, 번역 요청은 api 를 넘겨준 쪽이 한다(글꼴 · 정규식 고르기만 설정에 바로 적는다).
//
// api 꼴
//   data(): {
//     lines: {
//       id: string,            줄의 열쇠
//       text: string,          저장된 번역
//       src: string,           원문
//       kind: 'message' | 'regex' | 'worldinfo' | '',   원문이 적혀 있던 곳의 종류. 모르면 ''(그 칸을 비워 둔다. 짐작해 적지 않는다)
//       name: string,          메시지면 '채팅 이름 #메시지 번호', 정규식이나 월드인포면 그 이름
//       regex?: string,        상태창을 그리는 정규식 이름(원문이 메시지에 있던 글일 때 알면)
//       character?: string,    어느 캐릭터 것인지
//       manual?: boolean,      사용자가 직접 고친 줄
//       now?: boolean,         지금 답의 상태창에 나온 줄
//       pieces?: string[],     한 줄이 여러 조각이면 조각마다의 번역(text 는 조각 사이를 ' | ' 로 이은 글)
//     }[]
//     nowHasStatus?: boolean   지금 답에 상태창이 있는지(빈 화면에서 '지금 답의 상태창 번역하기'를 보일지)
//   }
//   context?: () => object     실리태번 getContext. 주면 한글 글꼴 · 원문으로 볼 정규식 줄이 보인다
//   titled?: boolean           false 면 화면 이름 줄을 그리지 않는다(틀이 머리에 이름을 그리는 자리)
//   setHead?({ title, sub, back: { label, onBack } | null })
//           판 머리의 글. back 이 있으면 머리의 뒤로 가기를 이 화면이 맡는다. 이 함수가 없으면 화면 안에 뒤로 가기 줄을 그린다
//   onSave(id: string, text: string)        줄 번역을 직접 고쳐 저장(여러 조각 줄은 조각 사이를 | 로 나눈 글)
//   onRetranslate(ids: string[])            고른 줄을 묶어 재번역(요청 1번)
//   onRemove(ids: string[])                 줄 지우기(다음에 나오면 새로 번역)
//   onClear({ keepManual: boolean })        전부 비우기
//   onTranslateNow()                        지금 답의 상태창 번역하기
// 돌려주는 값: { refresh(), close(), park(), attach(host, api) }. refresh 는 data() 를 다시 읽어 그리고, close 는 듣기를 떼고 비운다.
//   park 는 화면을 떼어 두기만 하고(다시 열 때 그대로 붙인다), attach 는 떼어 둔 화면을 새 자리 · 새 api 로 붙인다.

import { registerScreen } from './screens.js';
import { optionTools, fontRowSamples, mountFonts, mountKept } from './status-options.js';
import { lastAnswer } from './open-data.js';
import { shownIn } from '../../store/status.js';
import { characterKey } from '../../rules/hold.js';
import { shared } from '../../screen/bridge.js';

const FILTERS = [
    { key: 'now', label: '지금 답', test: line => line.now },
    { key: 'all', label: '전부', test: () => true },
    { key: 'manual', label: '직접 고침', test: line => line.manual },
    { key: 'message', label: '메시지', test: line => line.kind === 'message' },
    { key: 'regex', label: '정규식', test: line => line.kind === 'regex' },
    { key: 'worldinfo', label: '월드인포', test: line => line.kind === 'worldinfo' },
];
// 한 캐릭터의 줄이 수천 개가 되기도 한다. 전부 그리면 몇 초 멈췄고, 내리는 만큼 이어 그리면 내릴수록 무거워졌다.
// 그래서 보이는 자리 둘레의 줄 WINDOW 개만 그리고, 위아래는 빈 칸의 높이로 자리를 잡는다(줄이 몇 개든 그리는 양이 같다).
// 줄 높이는 글 길이에 따라 다르다: 그려 본 줄은 잰 높이를, 안 그려 본 줄은 잰 줄들의 평균을 쓴다
const WINDOW = 40;          // 한 번에 그려 두는 줄 수(줄 하나 60px 쯤: 화면 세 개 치)
const OVERSCAN = 400;       // 보이는 자리 위로 미리 그려 두는 높이(px)
const ROW_GUESS = 58;       // 아직 잰 줄이 없을 때의 줄 높이
const SUB_PAGES = { font: '한글 글꼴', kept: '원문으로 볼 정규식' };

/** 태그 하나를 만든다. 글은 textContent 로만 넣는다(넘겨받은 글을 HTML 로 읽지 않게) */
function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key.startsWith('aria-') && value != null) { node.setAttribute(key, String(value)); continue; }
        if (value == null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value === true ? '' : String(value));
    }
    node.append(...kids.flat().filter(kid => kid != null && kid !== false));
    return node;
}
const icon = (name, cls = '') => el('i', { class: `fa-solid fa-${name} ${cls}`.trim(), 'aria-hidden': 'true' });
const button = (cls, act, props, ...kids) => el('button', { type: 'button', class: cls, 'data-act': act, ...props }, ...kids);

/** 줄 아래 작은 글: 원문이 있던 곳. 모르는 줄은 빈 글(칸을 그리지 않는다) */
function placeMark(line) {
    if (line.kind === 'regex') return `정규식 '${line.name}'에 있던 글`;
    if (line.kind === 'worldinfo') return `월드인포 '${line.name}'에 있던 글`;
    if (line.kind !== 'message') return '';
    return messagePlace(line.name) || '메시지에 있던 글';
}

/** '채팅 이름 #번호'(store/status.js placeName 의 꼴) → '채팅 이름 채팅의 12번 메시지' */
function messagePlace(name) {
    const cut = String(name || '').lastIndexOf(' #');
    return cut > 0 ? `${name.slice(0, cut)} 채팅의 ${name.slice(cut + 2)}번 메시지` : '';
}

/** 줄 고치기의 '이 글은 어디서 왔나요' 칸들 */
function whereRows(line) {
    const place = line.kind === 'regex' ? `정규식 '${line.name}'` : line.kind === 'worldinfo' ? `월드인포 '${line.name}'` : messagePlace(line.name) || line.name;
    const rows = [['원문이 있던 곳', place]];
    if (line.regex && line.kind !== 'regex') rows.push(['상태창을 그리는 정규식', line.regex]);
    if (line.character) rows.push(['캐릭터', line.character]);
    return rows.filter(([, value]) => value);
}

/**
 * @param {HTMLElement} host 판 안에서 이 화면이 들어갈 자리
 * @param {object} api 맨 위 주석의 꼴
 */
export function mount(host, api) {
    const state = { data: {}, lines: [], counts: {}, filter: 'now', query: '', mode: 'list', cur: null, picked: new Set(), confirm: null, keepManual: true, shown: null, heights: new Map(), rowH: new Map(), win: [0, 0], scrollY: 0, groupTop: 0, viewH: 0, nodes: new Map() };
    const root = el('div');
    const parts = buildShell(root);
    const ctx = { state, parts, root };
    ctx.paint = () => paintAll(ctx);
    const place = (where, given) => {
        // 공통 모습은 판의 뿌리(.btr-plan)에 걸려 있다. 그 뿌리 없이 그려지는 자리에서는 이 화면이 뿌리를 겸한다
        root.className = `btr-status-root${where.closest('.btr-plan') ? '' : ' btr-plan phone fix'}`;
        Object.assign(ctx, { api: given, tools: given.context ? optionTools(given.context) : null, wide: given.wide ?? Boolean(where.closest('.rcol')) });
        where.replaceChildren(root);
    };

    const onClick = event => clickAct(ctx, event.target.closest('[data-act]'));
    const onInput = event => inputAct(ctx, event.target);
    const onScroll = () => onScrolled(ctx);
    ctx.sizes = new ResizeObserver(entries => sized(ctx, entries));
    ctx.sizes.observe(parts.editor);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    parts.scroll.addEventListener('scroll', onScroll, { passive: true });
    parts.filters.addEventListener('scroll', () => { parts.filters.dataset.left = parts.filters.scrollLeft; }, { passive: true });

    place(host, api);
    load(ctx, true);
    ctx.paint();
    return {
        refresh() { load(ctx, false); ctx.paint(); },
        /** 떼어 두기: 열린 고치는 칸 · 고르기 · 확인 판은 접는다(다시 열면 목록 맨 위부터) */
        park() {
            leaveSub(ctx);
            Object.assign(state, { mode: 'list', cur: null, confirm: null, query: '' });
            state.picked.clear();
            parts.search.value = '';
            root.remove();
        },
        attach(where, given) {
            place(where, given);
            state.filter = state.counts.now ? 'now' : 'all';
            parts.scroll.scrollTop = 0;
            state.scrollY = 0;
            ctx.paint();
        },
        close() {
            cancelAnimationFrame(ctx.typed);
            leaveSub(ctx);
            root.removeEventListener('click', onClick);
            root.removeEventListener('input', onInput);
            parts.scroll.removeEventListener('scroll', onScroll);
            ctx.sizes.disconnect();
            root.remove();
        },
    };
}

function load({ state, api }, first) {
    state.data = api.data?.() ?? {};
    state.lines = (state.data.lines ?? []).map(line => ({ ...line, id: String(line.id) }));
    state.byId = new Map(state.lines.map(line => [line.id, line]));
    state.picked = new Set([...state.picked].filter(id => state.byId.has(id)));
    if (state.cur && !state.byId.has(state.cur)) state.cur = null;
    // 걸러 보기마다의 줄 수는 읽을 때 한 번만 센다(그릴 때마다 줄 전부를 여섯 번씩 훑지 않게)
    state.counts = Object.fromEntries(FILTERS.map(filter => [filter.key, 0]));
    for (const line of state.lines) {
        for (const filter of FILTERS) if (filter.test(line)) state.counts[filter.key]++;
        line.hay = `${line.text}\n${line.src}`.toLowerCase();   // 찾기는 이 글에서(글자를 칠 때마다 만들지 않게)
    }
    state.shown = null;
    // 지금 답에 상태창 줄이 없으면 '전부'에서 시작한다
    if (first || !state.counts.now) state.filter = state.counts.now ? 'now' : 'all';
}

/** 한 번만 만드는 틀. 입력 칸은 다시 그리지 않는다(쓰는 중에 커서가 날아가지 않게) */
function buildShell(root) {
    const parts = {
        list: el('div', { class: 'slist' }),
        top: el('div', { class: 'stop' }),
        options: el('div', { class: 'group sopts' }),
        search: el('input', { class: 'input', type: 'search', 'data-role': 'search', 'aria-label': '번역이나 원문으로 찾기' }),
        filters: el('div', { class: 'filters', role: 'group', 'aria-label': '걸러 보기' }),
        group: el('div', { class: 'group srows' }),
        padTop: el('div', { class: 'spad' }),
        padEnd: el('div', { class: 'spad' }),
        empty: el('div', { class: 'sempty' }),
        foot: el('div', { class: 'foot' }),
        sub: el('div', { class: 'ssub' }),
        subBack: button('back stitle', 'leave-sub', {}, icon('chevron-left'), '상태창 번역'),
        subBox: el('div'),
        edit: el('input', { class: 'input', type: 'text', 'data-role': 'edit', 'aria-label': '번역' }),
        save: button('go sm solid', 'save', {}, '저장'),
        editor: el('div', { class: 'sedit' }),
        layer: el('div', { class: 'slayer' }),
    };
    parts.scroll = el('div', { class: 'sscroll' }, parts.top, parts.options, parts.search, parts.filters, parts.group, parts.empty);
    parts.list.append(parts.scroll, parts.foot);
    parts.sub.append(parts.subBack, parts.subBox);
    root.append(parts.list, parts.sub, parts.layer);
    return parts;
}

// ---------- 그리기 ----------

function paintAll(ctx) {
    const { state, parts } = ctx;
    const sub = state.mode in SUB_PAGES;
    parts.list.hidden = sub;
    parts.sub.hidden = !sub;
    paintHead(ctx);
    if (!sub) paintList(ctx);
    paintLayer(ctx);
}

/**
 * 글꼴 · 정규식 화면과 여러 줄 고르기에서는 뒤로 가기가 목록으로 돌아온다.
 * 머리는 한 줄: 판 머리(휴대폰) · 오른쪽 칸 이름(PC)에 '뒤로 + 지금 화면 이름'. 판 머리를 못 받는 자리에서만 화면 안에 그 줄을 그린다
 * (판 머리 · 화면 안 뒤로 줄 · 화면 제목이 따로 있으면 같은 머리가 세 겹이었다)
 */
function paintHead(ctx) {
    const { state, api, parts } = ctx;
    const toList = () => { leaveSub(ctx); state.mode = 'list'; state.picked.clear(); ctx.paint(); };
    const back = state.mode !== 'list' ? { label: '상태창 번역', onBack: toList } : null;
    const title = SUB_PAGES[state.mode] ?? '상태창 번역';
    parts.subBack.hidden = Boolean(api.setHead);
    parts.subBack.replaceChildren(icon('chevron-left'), title);
    api.setHead?.({ title, sub: '', back });
}

const findLine = (state, id) => state.byId.get(id) ?? null;

/** 지금 보이는 줄: 찾는 글이 있으면 늘 전부에서 찾고, 없으면 고른 버튼으로 거른다. 같은 조건이면 앞서 거른 것을 다시 쓴다 */
function visibleLines(state) {
    const key = `${state.filter}|${state.query}`;
    if (state.shown?.key === key) return state.shown.lines;
    const query = state.query.toLowerCase();
    const filter = FILTERS.find(item => item.key === state.filter) ?? FILTERS[1];
    const lines = query ? state.lines.filter(line => line.hay.includes(query)) : state.lines.filter(filter.test);
    state.shown = { key, lines };
    state.tops = null;
    return lines;
}

function paintList(ctx) {
    const { state, parts } = ctx;
    const total = state.lines.length, picking = state.mode === 'pick';
    parts.top.replaceChildren(...(picking ? pickTop(state) : listTop(ctx)).filter(Boolean));
    paintOptions(ctx);
    parts.search.hidden = picking || !total;
    parts.search.placeholder = total && !ctx.wide ? `번역이나 원문으로 찾기 (${total}줄 전부에서)` : '번역이나 원문으로 찾기';
    paintFilters(ctx);
    paintGroup(ctx);
    paintFoot(ctx);
}

function listTop({ state, api }) {
    const total = state.lines.length;
    return [
        api.titled === false ? null : el('div', { class: 'stitle' }, icon('table-list', 'lic'), '상태창 번역'),
        el('div', { class: 'note sscope' },
            el('span', { text: `이 캐릭터에 쓰이는 ${total}줄` }),
            total ? button('slink', 'clear', {}, '전부 비우기') : null),
    ];
}

function pickTop(state) {
    const shown = visibleLines(state);
    const all = shown.length > 0 && shown.every(line => state.picked.has(line.id));
    // 무엇이 몇 줄 골라지는지 버튼에 그대로 적는다('보이는 줄'이라고만 하면 화면에 보이는 몇 줄인 줄 알았는데 걸러진 줄 전부가 골라졌다)
    const what = state.query ? '찾은 ' : state.filter === 'all' ? '' : `${FILTERS.find(filter => filter.key === state.filter)?.label ?? ''} `;
    const label = `${what}${shown.length}줄 전부 ${all ? '빼기' : '고르기'}`;
    return [el('div', { class: 'note sscope' },
        el('b', { class: 'stitle', text: `${state.picked.size}줄 골랐어요` }),
        button('slink', 'pick-all', {}, label))];
}

/** 목록 위의 두 줄: 한글 글꼴(지금 고른 글꼴로 쓴 글자), 원문으로 볼 정규식(고른 수) */
function paintOptions(ctx) {
    const { parts, tools, state } = ctx;
    parts.options.hidden = !tools || state.mode === 'pick';
    if (parts.options.hidden) return;
    const kept = tools.keptKeys().length;
    const keptText = kept ? `${kept}개` : '없음';
    parts.options.replaceChildren(
        button('line', 'sub', { 'data-page': 'font' }, icon('font', 'lic'), el('div', { class: 'k', text: '한글 글꼴' }),
            el('span', { class: 'v' }, ...fontRowSamples(tools)), icon('chevron-right', 'arr')),
        button('line', 'sub', { 'data-page': 'kept' }, icon('eye', 'lic'), el('div', { class: 'k', text: '원문으로 볼 정규식' }),
            el('span', { class: 'v', text: keptText }), icon('chevron-right', 'arr')));
}

function paintFilters({ state, parts }) {
    const shown = FILTERS.filter(filter => filter.key === 'all' || state.counts[filter.key] > 0);
    parts.filters.hidden = !state.lines.length;
    // 밀어 둔 자리는 밀 때 적어 둔 값을 쓴다(그릴 때 읽으면 페이지 전체 배치를 그 자리에서 다시 셈: 이 페이지에서 한 번에 40ms 쯤)
    const left = parts.filters.dataset.left;
    parts.filters.replaceChildren(...shown.map(filter => {
        const on = !state.query && state.filter === filter.key;
        return button(`set${on ? ' on' : ''}`, 'filter', { 'data-key': filter.key, 'aria-pressed': on }, filter.label, ' ', el('i', { text: String(state.counts[filter.key]) }));
    }));
    if (left > 0) parts.filters.scrollLeft = left;
}

function paintGroup(ctx) {
    const { state, parts } = ctx;
    const shown = visibleLines(state);
    parts.group.hidden = !shown.length;
    parts.empty.hidden = !!shown.length;
    parts.empty.textContent = state.lines.length ? '찾는 글이 없어요' : '아직 번역해 둔 상태창 글이 없어요.\n상태창이 있는 답을 번역하면 여기에 모여요.';
    // 걸러 보기 · 찾는 글이 바뀌면 목록 맨 위로(내려 본 자리가 그대로면 짧아진 목록의 빈 곳이 보였다)
    const key = `${state.filter}|${state.query}`;
    if (state.drawnKey !== key) {
        state.drawnKey = key;
        if (state.scrollY > state.groupTop) parts.scroll.scrollTop = state.groupTop;   // 쓰기만 한다(읽으면 그 자리에서 배치를 다시 셈)
    }
    drawWindow(ctx, true);
}

/** 줄마다의 위 끝 자리(잰 높이, 안 잰 줄은 평균). 줄 수 + 1 칸 */
function topsOf(state, lines) {
    if (state.tops) return state.tops;
    let sum = 0, n = 0;
    for (const value of state.heights.values()) { sum += value; n++; }
    const guess = n ? sum / n : ROW_GUESS, tops = new Float64Array(lines.length + 1);
    for (let i = 0; i < lines.length; i++) tops[i + 1] = tops[i] + (state.heights.get(lines[i].id) ?? guess);
    state.tops = tops;
    return tops;
}

/** 위 끝이 y 보다 아래인 첫 줄 바로 앞의 줄 번호 */
function rowAt(tops, y) {
    let lo = 0, hi = tops.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tops[mid] <= y) lo = mid; else hi = mid - 1; }
    return Math.max(0, lo);
}

/** 스크롤할 때: 스크롤 자리 · 목록의 위 끝 · 보이는 높이를 적어 두고 줄을 고쳐 그린다(배치가 끝난 때라 읽어도 다시 셈하지 않는다) */
function onScrolled(ctx) {
    const { state, parts } = ctx, view = parts.scroll;
    state.scrollY = view.scrollTop;
    state.groupTop = parts.group.offsetTop;
    state.viewH = view.clientHeight;
    drawWindow(ctx, false);
}

/**
 * 보이는 자리 둘레의 줄만 그린다. again 이면 그려 둔 줄도 새로 만든다(고르기 · 자료가 바뀌었을 때).
 * 그리는 동안 배치 값(높이 · 자리)을 읽지 않는다: 이 페이지는 배치를 한 번 다시 셀 때마다 수십 ms 가 들어,
 * 읽기 한 번이 그대로 멈춤이 되었다. 자리는 스크롤 때 적어 둔 값을, 높이는 ResizeObserver 가 알려 준 값을 쓴다
 */
function drawWindow(ctx, again) {
    const { state, parts } = ctx;
    if (parts.list.hidden || parts.group.hidden) return;
    const lines = visibleLines(state), tops = topsOf(state, lines);
    const y = state.scrollY - state.groupTop, viewH = state.viewH || 900;
    let start = rowAt(tops, y - OVERSCAN), end = Math.min(lines.length, start + WINDOW);
    while (end < lines.length && tops[end] < y + viewH + OVERSCAN) end++;
    if (end - start < WINDOW) start = Math.max(0, end - WINDOW);
    if (!again && start === state.win[0] && end === state.win[1]) return;
    const old = again ? new Map() : state.nodes, nodes = new Map(), rows = [];
    for (let i = start; i < end; i++) {
        const line = lines[i], row = old.get(line.id) ?? lineRow(state, line);
        nodes.set(line.id, row);
        rows.push(row);
    }
    for (const [id, row] of old) if (!nodes.has(id)) ctx.sizes.unobserve(row);
    for (const row of rows) ctx.sizes.observe(row);
    state.nodes = nodes;
    state.win = [start, end];
    parts.group.replaceChildren(...(start ? [parts.padTop] : []), ...rows, parts.padEnd);
    placeEditor(ctx);
    placePads(ctx);
}

function placePads({ state, parts }) {
    const lines = visibleLines(state), tops = topsOf(state, lines), [start, end] = state.win;
    parts.padTop.style.height = `${tops[start]}px`;
    parts.padEnd.style.height = `${tops[lines.length] - tops[Math.min(end, lines.length)]}px`;
}

/** ResizeObserver 가 알려 준 줄 높이를 적는다. 보이는 자리보다 위의 줄 높이가 바뀌면 그만큼 스크롤을 옮겨 보던 줄이 제자리에 있게 한다 */
function sized(ctx, entries) {
    const { state, parts } = ctx;
    const lines = visibleLines(state), tops = topsOf(state, lines), first = rowAt(tops, state.scrollY - state.groupTop);
    const index = new Map();
    for (let i = state.win[0]; i < state.win[1]; i++) index.set(lines[i]?.id, i);
    let shift = 0, changed = false;
    for (const entry of entries) {
        const node = entry.target, id = node === parts.editor ? state.cur : node.dataset.id;
        if (!node.isConnected || !index.has(id)) continue;
        const size = entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight;
        if (node === parts.editor) state.editorH = size; else state.rowH.set(id, size);
        const h = (state.rowH.get(id) ?? size) + (id === state.cur && parts.editor.isConnected ? state.editorH ?? 0 : 0), i = index.get(id);
        const was = tops[i + 1] - tops[i];
        if (Math.abs(h - was) < 0.5) continue;
        if (i < first) shift += h - was;
        state.heights.set(id, h);
        changed = true;
    }
    if (!changed) return;
    state.tops = null;
    placePads(ctx);
    if (shift) { parts.scroll.scrollTop += shift; state.scrollY += shift; }
}

/** 목록의 한 줄: 왼쪽 번역(직접 고친 줄은 딱지), 오른쪽 원문, 아래 작은 글로 원문이 있던 곳 */
function lineRow(state, line) {
    const picking = state.mode === 'pick', on = picking && state.picked.has(line.id);
    const open = !picking && state.cur === line.id;
    const mark = placeMark(line);
    const body = [
        el('span', { class: 'two2' },
            el('b', {}, line.text, line.manual ? el('span', { class: 'badge', text: '직접 고침' }) : null),
            el('small', { text: line.src })),
        mark ? el('span', { class: 'mk2', text: mark }) : null];
    const cls = `srow${picking ? ' pick' : ''}${open ? ' cur' : ''}`;
    const tick = picking ? el('span', { class: `chk${on ? '' : ' off'}` }, on ? icon('check') : null) : null;
    return button(cls, picking ? 'tick' : 'open', { 'data-id': line.id, 'aria-pressed': picking ? on : null, 'aria-expanded': picking ? null : open }, tick, picking ? el('span', { class: 'sbody' }, body) : body);
}

function paintFoot({ state, parts }) {
    const picking = state.mode === 'pick', total = state.lines.length;
    let kids = [];
    if (picking) kids = pickFoot(state);
    else if (total) kids = [button('go line', 'pick', {}, '여러 줄 고르기')];
    else if (state.data.nowHasStatus) kids = [button('go line', 'now', {}, '지금 답의 상태창 번역하기', el('small', { text: '요청 1번' }))];
    parts.foot.replaceChildren(...kids);
    parts.foot.hidden = !kids.length;
}

function pickFoot(state) {
    const n = state.picked.size;
    const go = n ? button('go solid', 'redo-picked', {}, `${n}줄 재번역`, el('small', { text: '요청 1번' }))
        : button('go solid', 'redo-picked', { disabled: true }, '재번역할 줄을 눌러 주세요');
    return [go, el('div', { class: 'btns' },
        button('go sm line', 'stop-pick', {}, '그만 고르기'),
        button('go sm line', 'remove-picked', { disabled: !n }, n ? `${n}줄 지우기` : '지우기'))];
}

// ---------- 줄 고치기(누른 줄 바로 아래에 펼친다) ----------

/** 고치는 칸을 누른 줄 아래에 둔다. 그 줄이 지금 목록에 없으면 뗀다 */
function placeEditor(ctx) {
    const { state, parts } = ctx;
    const line = state.mode === 'pick' ? null : findLine(state, state.cur);
    const row = line ? state.nodes?.get(line.id) : null;
    if (!row) { parts.editor.remove(); return; }
    if (parts.editor.dataset.id !== line.id) { parts.edit.value = line.text; parts.editor.dataset.id = line.id; }
    paintEditor(ctx, line);
    row.after(parts.editor);
}

/** 원문, 번역 칸, 어디서 왔나, 저장, 이 줄 재번역, 지우기 */
function paintEditor(ctx, line) {
    const { parts } = ctx;
    const where = whereRows(line);
    parts.editor.replaceChildren(...[
        el('div', { class: 'lab', text: '원문' }),
        el('div', { class: 'srcbox', text: line.src }),
        el('div', { class: 'lab two2' }, el('span', { text: '번역' }), el('span', { text: `지금 저장된 것: ${line.text}` })),
        parts.edit,
        line.pieces?.length > 1 ? el('div', { class: 'note', text: `${line.pieces.length}조각으로 나뉜 줄이에요. 조각 사이는 | 로 나눠 적어 주세요.` }) : null,
        where.length ? el('div', { class: 'lab', text: '이 글은 어디서 왔나요' }) : null,
        where.length ? el('div', { class: 'where' }, where.map(([key, value]) => el('div', { class: 'kv' }, el('b', { text: key }), el('span', { text: value })))) : null,
        el('div', { class: 'note', text: '저장하면 이 캐릭터의 모든 채팅에 보여요.' }),
        el('div', { class: 'btns' }, parts.save, button('go sm line', 'redo-line', {}, '이 줄 재번역')),
        button('quiet', 'remove-line', {}, '이 줄 지우기 (다음에 나오면 새로 번역)'),
    ].filter(Boolean));
    paintSave(ctx);
}

function paintSave({ state, parts }) {
    const line = findLine(state, state.cur);
    const text = parts.edit.value.trim();
    parts.save.disabled = !line || !text || text === line.text;
}

/** 줄을 눌렀을 때: 그 줄 아래에 펼치고, 펼쳐 있던 줄이면 접는다. 목록 전체를 다시 그리지 않는다 */
function toggleLine(ctx, id) {
    const { state } = ctx;
    state.cur = state.cur === id ? null : id;
    for (const [rowId, row] of state.nodes) {
        const open = rowId === state.cur;
        row.classList.toggle('cur', open);
        row.setAttribute('aria-expanded', String(open));
    }
    placeEditor(ctx);
}

// ---------- 글꼴 · 정규식 화면 ----------

function enterSub(ctx, page) {
    const { state, parts, tools } = ctx;
    if (!tools || !(page in SUB_PAGES)) return;
    leaveSub(ctx);
    state.mode = page;
    ctx.leaveSub = page === 'font' ? mountFonts(parts.subBox, tools) : mountKept(parts.subBox, tools);
}

function leaveSub(ctx) {
    ctx.leaveSub?.();
    ctx.leaveSub = null;
}

// ---------- 지우기 확인: 판 아래에서 올라오는 작은 판 ----------

function paintLayer({ state, parts }) {
    const ask = state.confirm;
    parts.layer.hidden = !ask;
    if (!ask) { parts.layer.replaceChildren(); return; }
    const manual = ask.manual, left = ask.count - (state.keepManual ? manual : 0);
    const keep = manual ? button('keep', 'keep', { role: 'checkbox', 'aria-checked': state.keepManual },
        el('span', { class: `chk${state.keepManual ? '' : ' off'}` }, state.keepManual ? icon('check') : null), el('span', { text: `직접 고친 ${manual}줄은 남기기` })) : null;
    const sheet = el('div', { class: 'ssheet', role: 'dialog', 'aria-label': ask.title },
        el('div', { class: 'ssheet-head' },
            el('div', {}, el('b', { text: ask.title }), el('small', { text: ask.sub })),
            button('sx', 'cancel', { 'aria-label': '닫기' }, icon('xmark'))),
        el('div', { class: 'note', text: ask.note }),
        keep,
        el('div', { class: 'btns' },
            button('go sm line', 'cancel', {}, '취소'),
            button('go sm solid', 'confirm', { disabled: !left }, `${left}줄 ${ask.verb}`)));
    parts.layer.replaceChildren(el('div', { class: 'sdim', 'data-act': 'cancel' }), sheet);
}

// ---------- 누름 ----------

function askClear(state) {
    const total = state.lines.length, manual = state.counts.manual;
    state.keepManual = true;
    state.confirm = { kind: 'clear', title: '상태창 번역을 전부 비울까요?', sub: `이 캐릭터에 쓰이는 ${total}줄`, note: '지금 보이는 상태창도 원문으로 돌아가요. 비운 뒤에는 되돌릴 수 없어요.', count: total, manual, verb: '비우기' };
}

/** 고른 줄 지우기: 직접 고친 줄이 섞여 있으면 한 번 더 묻는다 */
function removePicked(ctx) {
    const { state, api } = ctx;
    const ids = [...state.picked];
    const manual = ids.filter(id => findLine(state, id)?.manual).length;
    if (!manual) { api.onRemove?.(ids); state.picked.clear(); return; }
    state.keepManual = true;
    state.confirm = { kind: 'remove', ids, title: `고른 ${ids.length}줄을 지울까요?`, sub: `직접 고친 줄 ${manual}줄이 섞여 있어요`, note: '지금 보이는 상태창도 원문으로 돌아가요. 지운 뒤에는 되돌릴 수 없어요.', count: ids.length, manual, verb: '지우기' };
}

function confirmAsk({ state, api }) {
    const ask = state.confirm;
    if (!ask) return;
    if (ask.kind === 'clear') api.onClear?.({ keepManual: state.keepManual && ask.manual > 0 });
    else {
        const ids = state.keepManual ? ask.ids.filter(id => !findLine(state, id)?.manual) : ask.ids;
        api.onRemove?.(ids);
        state.picked.clear();
    }
    state.confirm = null;
}

/** 지금 보이는 줄을 전부 고르거나, 다 골라져 있으면 전부 뺀다 */
function pickAll(state) {
    const shown = visibleLines(state);
    const all = shown.every(line => state.picked.has(line.id));
    for (const line of shown) { if (all) state.picked.delete(line.id); else state.picked.add(line.id); }
}

function saveLine({ state, parts, api }) {
    const text = parts.edit.value.trim();
    if (text) api.onSave?.(state.cur, text);
}

const ACTS = {
    filter: ({ state, parts }, target) => { state.filter = target.dataset.key; state.query = ''; parts.search.value = ''; },
    tick: ({ state }, target) => { const id = target.dataset.id; if (state.picked.has(id)) state.picked.delete(id); else state.picked.add(id); },
    pick: ({ state }) => { state.mode = 'pick'; state.picked.clear(); },
    'stop-pick': ({ state }) => { state.mode = 'list'; state.picked.clear(); },
    'pick-all': ({ state }) => pickAll(state),
    'redo-picked': ({ state, api }) => { if (state.picked.size) api.onRetranslate?.([...state.picked]); },
    'remove-picked': ctx => removePicked(ctx),
    clear: ({ state }) => askClear(state),
    keep: ({ state }) => { state.keepManual = !state.keepManual; },
    cancel: ({ state }) => { state.confirm = null; },
    confirm: ctx => confirmAsk(ctx),
    save: ctx => saveLine(ctx),
    'redo-line': ({ state, api }) => api.onRetranslate?.([state.cur]),
    'remove-line': ({ state, api }) => { api.onRemove?.([state.cur]); state.cur = null; },
    now: ({ api }) => api.onTranslateNow?.(),
    sub: (ctx, target) => enterSub(ctx, target.dataset.page),
    'leave-sub': ctx => { leaveSub(ctx); ctx.state.mode = 'list'; },
};

function clickAct(ctx, target) {
    if (!target || target.disabled) return;
    if (target.dataset.act === 'open') { toggleLine(ctx, target.dataset.id); return; }
    if (!ACTS[target.dataset.act]) return;
    ACTS[target.dataset.act](ctx, target);
    ctx.paint();
}

function inputAct(ctx, target) {
    if (target === ctx.parts.edit) { paintSave(ctx); return; }
    if (target !== ctx.parts.search || ctx.typed) return;
    // 찾기는 다음 그림 차례에 한 번만(빠르게 친 글자 여럿을 한 번에). 기다렸다 찾지는 않는다
    ctx.typed = requestAnimationFrame(() => {
        ctx.typed = 0;
        ctx.state.query = target.value.trim();
        paintFilters(ctx);
        paintGroup(ctx);
    });
}

// ---------- 판에 잇기 ----------

/** 맨 끝 답의 화면 글자(목록의 '지금 답'을 가리려고) */
function lastShownText(context) {
    const chat = context().chat, id = chat.indexOf(lastAnswer(chat));
    return document.querySelector(`#chat > .mes[mesid="${id}"] .mes_text`)?.innerText ?? '';
}

/** 다시 번역받은 뒤 알릴 글 */
function redoneText({ asked, learned }, skipped) {
    const left = asked - learned + skipped;
    if (!learned) return '새 번역을 받지 못했어요. 번역은 그대로예요.';
    return `${learned}줄을 새 번역으로 바꿨어요.${left ? ` ${left}줄은 그대로예요.` : ''}`;
}

/**
 * 상태창 번역의 기록과 요청을 화면의 api 꼴로 묶는다.
 * 기록은 상태창 번역(screen/start.js)과 같은 것을 연다: 여기서 고친 것과 그쪽이 새로 받은 번역이 서로를 덮지 않게.
 * @param {{ rec: object, save: () => void }} book  @param {object | null} screen screenTools()  @param {object} api 화면 등록이 받는 api
 */
function statusApi({ rec, save }, screen, api) {
    const notice = (text, kind) => api.notice?.(text, kind);
    const after = () => { save(); api.refresh(); };
    let asking = false;
    /** 요청 하나를 보내는 일: 보내는 동안 또 누른 것은 받지 않는다 */
    const request = async (work, failed) => {
        if (!screen) { notice('상태창 번역이 켜지지 않았어요. 새로고침한 뒤 다시 해 주세요.', 'warning'); return; }
        if (asking) { notice('앞의 요청을 받는 중이에요.'); return; }
        asking = true;
        try { await work(); } catch (error) { console.warn('[번역]', error); notice(error?.message || failed, 'warning'); }
        asking = false;
        api.refresh();
    };
    return {
        context: api.context, titled: false, wide: api.wide, setHead: api.setHead,
        data() {
            const lines = rec.list({ onlySeen: true }), now = shownIn(lines.map(line => line.id), lastShownText(api.context));
            for (const line of lines) line.now = now.has(line.id);
            return { lines, nowHasStatus: now.size > 0 || Boolean(screen?.hasStatusNow()) };
        },
        onSave: (id, text) => (rec.edit(id, text) ? after() : notice('조각 수가 맞지 않아요. 조각 사이를 | 로 나눠 적어 주세요.', 'warning')),
        onRemove: ids => { rec.removeMany(ids); after(); },
        onClear: options => { rec.clear(options); after(); },
        /** 고른 줄에 다시 번역받을 표시를 달고 한 번에 묻는다. 원문이 남아 있지 않은 줄은 물을 수 없어 뺀다 */
        onRetranslate: ids => request(async () => {
            const marked = rec.markRedo(ids).length, skipped = ids.length - marked;
            if (!marked) { notice('원문이 남아 있지 않은 줄이라 재번역할 수 없어요.'); return; }
            after();
            notice(`${marked}줄을 재번역하고 있어요. 끝나면 바뀌어요.`);
            notice(redoneText(await screen.redo(), skipped));
        }, '재번역하지 못했어요.'),
        /** 지금 답의 상태창에서 번역이 없는 글을 한 번에 묻는다 */
        onTranslateNow: () => request(async () => {
            notice('지금 답의 상태창을 번역하고 있어요.');
            const result = await screen.askNow();
            if (!result) notice('지금 답을 먼저 번역해 주세요.');
            else notice(result.asked ? `상태창 글 ${result.learned}개를 번역했어요.` : '새로 번역할 상태창 글이 없어요.');
            setTimeout(() => api.refresh(), 2000);   // 받은 번역은 1.5초 뒤 모아서 저장에 적힌다(screen/live.js): 그 뒤에 목록을 한 번 더 그린다
        }, '상태창을 번역하지 못했어요.'),
    };
}

// 캐릭터마다 한 번 만든 화면을 떼어 두었다가 다시 열 때 그대로 붙인다(기록 읽기 · 줄 만들기를 여는 순간에 하지 않게).
// 붙인 뒤 한가할 때 기록을 다시 읽어 바뀐 것만큼 다시 그린다
const views = new Map();   // 캐릭터 열쇠 → Promise<{ book, screen, handle }>
const built = new WeakMap();   // 그 Promise → 다 만든 것(만들어졌으면 기다리지 않고 바로 붙인다)
const idle = fn => (globalThis.requestIdleCallback ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 50));

/** 그 캐릭터의 기록 · 상태창 번역 도구를 열고, 화면을 떼어 둔 채로 만든다. 같은 캐릭터면 한 번만 */
function viewOf(api) {
    const key = characterKey(api.context()) || 'none';
    if (!views.has(key)) {
        views.set(key, Promise.all([
            shared(api.tools.status)(key),
            import('../../screen/start.js').then(module => module.screenTools(), () => null),
        ]).then(([book, screen]) => {
            const view = { book, screen };
            view.handle = mount(document.createElement('div'), statusApi(book, screen, api));
            view.handle.park();
            built.set(views.get(key), view);
            return view;
        }));
        views.get(key).catch(() => views.delete(key));
    }
    return { key, view: views.get(key) };
}

registerScreen('status', {
    title: '상태창 번역',
    icon: 'table-list',
    summary: () => '',
    /** 판이 열릴 때 한가한 틈에 미리 만들어 둔다(틀이 부른다). 누른 순간에는 붙이기만 한다 */
    warm(api) { idle(() => viewOf(api).view.catch(() => {})); },
    render(box, api) {
        let view = null, closed = false;
        const show = found => {
            if (closed) { found.book.flush(); return; }
            view = found;
            view.handle.attach(box, statusApi(found.book, found.screen, api));
            idle(() => { if (!closed && view) view.handle.refresh(); });
        };
        const { view: pending } = viewOf(api);
        // 이미 만들어 둔 화면이면 이 자리에서 바로 붙인다(다음 그림에 보이게)
        const done = built.get(pending);
        if (done) show(done);
        else pending.then(show).catch(error => console.warn('[번역] 상태창 번역 화면을 열지 못했어요', error));
        return {
            refresh: () => view?.handle.refresh(),
            close() { closed = true; if (view) { view.handle.park(); view.book.flush(); } },
        };
    },
});
