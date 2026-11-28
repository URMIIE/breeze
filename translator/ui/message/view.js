// 보기 방식: 메시지 본문의 문단에 다른 쪽 글(번역이 보이면 원문, 원문이 보이면 번역)을 붙여 그린다.
// 저장된 글은 건드리지 않고 화면에만 그린다. 실리태번을 직접 부르지 않고, 넘겨받은 자료로 그리기만 한다.
//
// mount(host, api) → { paint, flush, refresh, close }
//   host  메시지들이 든 요소(#chat). 누름은 여기 하나에서 듣는다. 자리 지키기도 이 요소의 스크롤로 한다
//   api
//     view()                  { main: 'tr' | 'src', when: 'tap' | 'bubble' | 'every' | 'said' }
//                             main 평소 보이는 글(번역, 원문), when 다른 쪽 글이 보이는 때
//                             (문단을 누르면 아래에, 누르면 말풍선으로, 문단마다 늘, 대사에만 늘)
//     onEdit(hit)             '이 문단 수정'을 눌렀을 때. 그 문단을 고치는 화면을 연다
//     onRedo?(hit)            '대사 다시 번역'을 눌렀을 때. 주면 대사 문단에서 버튼이 하나 더 뜬다
//                             hit = { body, el, at, pair, source, translation }
//                             body 본문 요소, el 문단 요소, at 번역 문단 번호, pair 원문 문단 번호(없으면 -1), source, translation 그 문단의 글
//     busy?(body)             그리면 안 될 때 true(메시지를 고치는 칸이 열려 있을 때)
//     clean?(html)            허용한 글자 꾸밈 태그만 남긴 HTML 을 돌려준다. 주면 문단을 원문으로 바꿀 때 원문의 글자 꾸밈을 살린다
//     skip?                   이야기 문단으로 보지 않을 곳의 선택자(주지 않으면 paragraphs.js 의 SKIP)
//   paint(body, data, { still })
//     body  메시지 본문 요소(.mes_text)
//     data  { key, source: string[], translation: string[], map: number[] } 또는 null(번역이 없거나 원문으로 바꿔 보는 중: 붙인 것을 뗀다)
//           key 글이 바뀌었는지 가리는 값(원문과 번역문의 지문), source, translation 화면에 글자로 나오는 글만 남긴 문단들(core/shown.js),
//           map[번역 문단 번호] = 원문 문단 번호(없으면 -1). store/pairs.js 의 match 가 주는 짝이다
//     still 읽는 자리를 따로 지키는 쪽이 있을 때 true(번역을 받는 동안: 둘이 같은 변화를 각자 맞추면 화면이 위아래로 오간다)
//   paintDrawn(body, data) → boolean  원문 먼저 보기에서 원문으로 그려진 본문에 글을 바꾸지 않고 붙인다(못 붙이면 false)
//   flush()    미뤄 둔 그리기를 지금 한다
//   refresh()  보기 방식이 바뀌었을 때: 그려 둔 메시지를 전부 다시 그린다
//   close()    붙인 것을 전부 떼고 듣기를 멈춘다
//
// 다시 붙이는 일은 바뀐 메시지에만, 메시지당 한 번:
//   paint 는 모아 뒀다가 다음 화면 그리기 직전에 한 번에 한다(같은 메시지를 여러 번 불러도 마지막 것 하나).
//   글(key)과 보기 방식이 그대로이고 붙여 둔 칸도 그대로 있으면 아무것도 하지 않는다. 다른 기능이 문단 안에 버튼을 끼워
//   글자 마디만 쪼갠 것을 바뀜으로 보고 다시 붙이면, 칸이 새로 생기고 그쪽이 버튼을 또 끼워 서로 끝없이 다시 그린다.
//   여러 메시지는 떼기 전부 → 읽기 전부 → 붙이기 전부(번갈아 하면 읽을 때마다 화면 전체의 모양을 다시 계산한다).

import { proseIn, proseOf, wrapLoose, alignTo, originalFor, ownText, isDialogue, lightHtml, richHtml, lettersOf, SKIP } from './paragraphs.js';

const BOX = 'btr-view-box', ACTS = 'btr-view-acts', FIXED = 'btr-view-fixed', BUBBLE = 'btr-view-bubble';
const MARKS = `.${FIXED}, [data-btr-swapped]`;
// 문단이나 칸 안에서도 제 할 일이 있는 것들
const BUSY = 'a, button, input, textarea, select, summary, [role="button"]';
const NO_PAIR = '이 문단의 짝을 찾지 못했어요.';
const EDIT = '<button type="button" class="btr-view-act" data-act="edit"><i class="fa-solid fa-pen-to-square"></i>이 문단 수정</button>';
const REDO = '<button type="button" class="btr-view-act" data-act="redo"><i class="fa-solid fa-rotate"></i>대사 재번역</button>';

const marksIn = body => body.querySelectorAll(MARKS).length;
const isFixedWhen = (view, text) => view.when === 'every' || (view.when === 'said' && isDialogue(text));

/** 문단에 늘 붙어 있는 칸. 목록 항목의 칸은 항목 안에, 그 밖에는 문단 바로 아래에 붙는다 */
function fixedOf(el) {
    if (el.tagName === 'LI') return el.querySelector(`:scope > .${FIXED}`);
    return el.nextElementSibling?.classList.contains(FIXED) ? el.nextElementSibling : null;
}

/** 화면 문단 하나의 자리: 번역 문단 번호, 원문 문단 번호, 붙일 원문. 아직 번역되지 않은 문단(원문 그대로)은 붙일 것이 없다 */
function slotFor(data, at, own, el) {
    const pair = at < 0 ? -1 : data.map[at] ?? -1;
    const orig = originalFor(data, at, own, el.tagName === 'LI');
    // 화면 글자만 견주면, 다른 기능이 그 문단의 글을 바꿔 그린 때 번역 안 된 문단도 원문과 다르게 보인다: 짝 자료의 글끼리도 견준다
    const same = orig != null && (lettersOf(orig) === lettersOf(own) || lettersOf(data.source[pair]) === lettersOf(data.translation[at]));
    return { at, pair, own, orig: same ? null : orig, same };
}

/** 문단 자리의 글을 원문으로 바꾼다. 원래 마디는 그대로 들고 있다가 되돌린다(다른 기능이 단 버튼과 듣기가 남게) */
function swap(v, state, el, orig) {
    state.kept.set(el, [...el.childNodes]);
    el.innerHTML = v.api.clean && /<[a-z]/i.test(orig) ? v.api.clean(richHtml(orig)) : lightHtml(orig);
    el.dataset.btrSwapped = '';
    v.dirty = true;
}

function unswap(v, state) {
    for (const [el, nodes] of state.kept) {
        el.replaceChildren(...nodes);
        delete el.dataset.btrSwapped;
        v.dirty = true;
    }
    state.kept.clear();
}

/**
 * 다른 쪽 글이 든 칸. kind: 'peek' 눌러서 아래에 뜬 것, 'bubble' 말풍선, 'fixed' 늘 붙어 있는 것.
 * 문단(p)이나 div 가 아닌 요소로 만든다: 메시지 글의 대사 줄을 찾아 꾸미는 기능들이 문단과 div 를 대사 한 줄로 세어,
 * 번역 문단과 그 아래 칸을 이어진 대사로 보고 한 묶음으로 쌌다 풀기를 되풀이한다(화면이 끌려간다).
 */
function makeBox(v, state, el, slot, kind, sign = '') {
    const box = document.createElement('aside'), swapped = state.kept.get(el);
    box.className = `${BOX} btr-view-${kind}${swapped ? ' btr-view-tr' : ''}`;
    if (swapped) box.append(...swapped.map(node => node.cloneNode(true)));
    else if (slot.orig == null) box.textContent = NO_PAIR;
    else box.innerHTML = lightHtml(slot.orig);
    v.made.set(box, { el, slot, state, sign });
    return box;
}

function put(v, el, box, align = getComputedStyle(el).textAlign) {
    if (align && align !== 'start' && align !== 'left') box.style.textAlign = align;
    if (box.classList.contains(BUBBLE) || el.tagName === 'LI') el.append(box); else el.after(box);
    v.dirty = true;
}

/** 늘 붙는 칸. 붙어 있던 칸의 내용이 그대로면 떼지 않는다(다른 기능이 칸 안에 단 꾸밈이 남게) */
function fix(v, job, state, el, slot, align) {
    const sign = [state.mode, state.kept.has(el) ? state.key : '', slot.at, slot.pair, slot.orig].join('\u0000');
    const had = fixedOf(el), made = had && v.made.get(had);
    if (made?.sign === sign && job.old.has(had)) {
        job.old.delete(had);
        Object.assign(made, { el, slot, state });
        return;
    }
    put(v, el, makeBox(v, state, el, slot, 'fixed', sign), align);
}

/** 화면 문단마다 자리를 찾는다. 원문으로 바꿔 둔 문단은 들고 있는 번역 마디의 글로 */
function slotsOf(data, els, texts) {
    const ats = alignTo(texts, data.translation), slots = new Map();
    els.forEach((el, i) => slots.set(el, slotFor(data, ats[i], texts[i], el)));
    return slots;
}

/**
 * 원문으로 그려진 본문(번역을 받기 전 그대로인 화면)의 문단마다 자리. 화면 글을 원문 문단에 맞추고, 그 원문 문단과 짝인 번역 문단의 자리로 둔다.
 * 자리의 글(own)은 번역 문단의 글이다: 번역 문단을 원문으로 바꿔 둔 것과 같은 꼴이 되어, 누르기 · 칸 · 되돌리기를 그대로 쓴다.
 * 한 원문 문단이 화면 요소 여럿(목록 항목들)으로 그려졌거나 번역 문단 여럿과 짝이면 어느 요소에 어느 번역이 가는지 알 수 없다: null
 */
function sourceSlots(data, els, texts) {
    const pairs = alignTo(texts, data.source), slots = new Map(), seen = new Set();
    for (const [i, el] of els.entries()) {
        const pair = pairs[i];
        const ats = pair < 0 ? [] : data.map.flatMap((src, at) => (src === pair ? [at] : []));
        if (ats.length > 1 || (pair >= 0 && seen.has(pair))) return null;
        seen.add(pair);
        const at = ats[0] ?? -1, own = at < 0 ? texts[i] : data.translation[at];
        const same = at >= 0 && lettersOf(own) === lettersOf(texts[i]);
        slots.set(el, { at, pair, own, orig: at < 0 || same ? null : data.source[pair], same });
    }
    return slots;
}

/** 원문이 그려진 문단에 번역 마디를 들려 둔다: 원문으로 바꿔 둔 문단과 같은 상태(글은 그대로, 되돌리면 번역) */
function keepTranslation(v, state, el, slot) {
    const html = v.api.clean && /<[a-z]/i.test(slot.own) ? v.api.clean(richHtml(slot.own)) : lightHtml(slot.own);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    state.kept.set(el, [...holder.childNodes]);
    el.dataset.btrSwapped = '';
}

const textOf = (state, el) => (state?.kept.has(el) ? state.kept.get(el).map(node => node.textContent).join('') : ownText(el));

function closeActs(v) {
    if (!v.acts) return;
    v.acts.row.remove();
    delete v.acts.box.dataset.on;
    v.acts = null;
}

function closeOpen(v) {
    closeActs(v);
    if (!v.open) return;
    v.open.box.remove();
    delete v.open.el.dataset.btrView;
    v.open = null;
}

/** 화면 맨 위쪽에 보이는 문단. 맨 위 점이 문단 사이나 메시지 머리에 걸리면 조금씩 아래를 더 본다(메시지 칸을 잡으면 그 안에 칸이 붙어도 자리가 안 변해 못 지킨다) */
function topParagraph(host) {
    const frame = host.getBoundingClientRect();
    let first = null;
    for (const down of [8, 28, 56, 96]) {
        const hit = document.elementFromPoint(frame.left + frame.width / 2, frame.top + down);
        if (!hit || !host.contains(hit)) continue;
        first ??= hit;
        const para = hit.closest(`.${BOX}`)?.parentElement ?? hit.closest('p, li, h1, h2, h3, blockquote');
        if (para && host.contains(para) && para !== host) return para;
    }
    return first;
}

/** 읽는 자리 지키기: 바닥을 보고 있었으면 바닥에, 아니면 화면 맨 위에 보이던 문단이 같은 자리에 있게 */
function placeKeeper(host) {
    const atBottom = host.scrollHeight > host.clientHeight && host.scrollHeight - host.scrollTop - host.clientHeight < 2;
    const anchor = topParagraph(host), top = anchor?.getBoundingClientRect().top;
    return () => {
        if (atBottom) { host.scrollTop = host.scrollHeight; return; }
        if (!anchor?.isConnected) return;
        const moved = anchor.getBoundingClientRect().top - top;
        if (Math.abs(moved) > 0.5) host.scrollTop += moved;
    };
}

/** 글과 보기 방식이 그대로이고 붙여 둔 칸도 그대로인가 */
function fresh(v, { body, data }, mode) {
    const state = v.painted.get(body);
    if (!state || !data) return !state && !data;
    return state.key === data.key && state.mode === mode && marksIn(body) === state.marks;
}

/** 떼기: 눌러서 뜬 칸, 원문으로 바꾼 문단. 늘 붙는 칸은 다시 쓸 수 있게 두고 적어만 둔다 */
function strip(v, job) {
    const { body } = job, state = v.painted.get(body);
    if (v.open && body.contains(v.open.el)) closeOpen(v);
    if (v.acts && body.contains(v.acts.row)) closeActs(v);
    if (state) unswap(v, state);
    job.old = new Set(body.querySelectorAll(`.${FIXED}`));
    if (job.data) wrapLoose(body, v.skip);
}

/** 읽기: 문단 요소, 글, 정렬. 정렬은 붙이기 전에 한꺼번에 읽는다(칸을 하나 넣고 읽으면 그때마다 화면 전체의 모양을 다시 계산한다) */
function measure(v, job, view) {
    job.els = proseIn(job.body, v.skip);
    job.texts = job.els.map(ownText);
    job.aligns = view.when === 'every' || view.when === 'said' ? job.els.map(el => getComputedStyle(el).textAlign) : [];
}

function dropOld(v, job) {
    for (const box of job.old) { box.remove(); v.dirty = true; }
}

/** 붙이기. job.slots 가 있으면 본문이 원문으로 그려져 있어 글은 바꾸지 않는다(sourceSlots) */
function dress(v, job, view, mode) {
    const { body, data } = job;
    if (!data) { dropOld(v, job); v.painted.delete(body); return; }
    const drawnSource = Boolean(job.slots);
    const state = { key: data.key, mode, data, kept: new Map(), slots: job.slots ?? slotsOf(data, job.els, job.texts), marks: 0 };
    job.els.forEach((el, i) => {
        const slot = state.slots.get(el);
        if (slot.orig == null) return;
        if (drawnSource) keepTranslation(v, state, el, slot);
        else if (view.main === 'src') swap(v, state, el, slot.orig);
        if (isFixedWhen(view, slot.own)) fix(v, job, state, el, slot, job.aligns[i]);
    });
    dropOld(v, job);
    state.marks = marksIn(body);
    v.painted.set(body, state);
}

function flush(v) {
    cancelAnimationFrame(v.frame);
    v.frame = 0;
    for (const body of v.painted.keys()) if (!body.isConnected) v.painted.delete(body);
    const view = v.api.view(), mode = `${view.main}/${view.when}`;
    const jobs = [...v.waiting.values()].filter(job => job.body.isConnected && !v.api.busy?.(job.body) && !fresh(v, job, mode));
    v.waiting.clear();
    if (!jobs.length) return;
    const keep = jobs.every(job => job.still) ? null : placeKeeper(v.host);
    v.dirty = false;
    for (const job of jobs) strip(v, job);
    for (const job of jobs) if (job.data) measure(v, job, view);
    for (const job of jobs) dress(v, job, view, mode);
    if (v.dirty) keep?.();
}

/**
 * 원문 먼저 보기에서 번역이 막 붙은 본문: 실리태번이 번역문으로 다시 그리게 하지 않고, 지금 그려진 원문 그대로에 붙인다(글 · 높이가 바뀌지 않는다).
 * 화면 문단이 원문 문단과 하나씩 맞지 않으면 붙이지 않는다(false: 부르는 쪽이 평소처럼 다시 그린다)
 */
function paintDrawn(v, body, data) {
    const view = v.api.view();
    if (view.main !== 'src' || !data || !body.isConnected || v.api.busy?.(body)) return false;
    wrapLoose(body, v.skip);
    const els = proseIn(body, v.skip), texts = els.map(ownText), slots = sourceSlots(data, els, texts);
    if (!slots) return false;
    v.waiting.delete(body);
    const job = { body, data, els, texts, slots, old: new Set(body.querySelectorAll(`.${FIXED}`)) };
    job.aligns = view.when === 'every' || view.when === 'said' ? els.map(el => getComputedStyle(el).textAlign) : [];
    const state = v.painted.get(body);
    if (state) unswap(v, state);
    v.dirty = false;
    const keep = placeKeeper(v.host);
    dress(v, job, view, `${view.main}/${view.when}`);
    if (v.dirty) keep();
    return true;
}

function queue(v, body, data, { still = false } = {}) {
    v.waiting.set(body, { body, data, still });
    v.frame ||= requestAnimationFrame(() => flush(v));
}

/** 누른 곳의 문단. 메시지가 다시 그려져 요소가 새것이면 자리를 다시 찾는다 */
function paragraphAt(v, target) {
    const el = proseOf(target);
    let body = el;
    while (body && body !== v.host && !v.painted.has(body)) body = body.parentElement;
    const state = v.painted.get(body);
    if (!state || v.api.busy?.(body)) return null;
    if (!state.slots.has(el)) {
        const els = proseIn(body, v.skip);
        state.slots = slotsOf(state.data, els, els.map(each => textOf(state, each)));
    }
    const slot = state.slots.get(el);
    return slot && lettersOf(slot.own) ? { el, state, slot } : null;
}

/** 문단을 누름: 다른 쪽 글을 그 아래에(말풍선 방식이면 말풍선으로). 한 번에 하나, 다시 누르면 닫는다 */
function toggle(v, { el, state, slot }) {
    const mine = v.open?.el === el;
    closeOpen(v);
    if (mine || fixedOf(el) || slot.same) return;
    const box = makeBox(v, state, el, slot, v.api.view().when === 'bubble' ? 'bubble' : 'peek');
    put(v, el, box);
    el.dataset.btrView = 'picked';
    v.open = { el, box };
}

/**
 * 칸을 누름: 버튼 줄을 그 아래에 띄운다. 문단을 누르는 것만으로는 뜨지 않는다(원문만 보고 싶은 사람에게 버튼이 끼어들지 않게).
 * 이미 떠 있으면 그대로 둔다(한 번 더 누를 때 거두면 눌렀는데 아무것도 안 뜨는 때가 생긴다). 거두는 것은 칸 밖을 누를 때.
 */
function showActs(v, box) {
    const { slot } = v.made.get(box);
    if (v.acts?.box === box || slot.at < 0) return;
    closeActs(v);
    if (v.open && v.open.box !== box) closeOpen(v);
    const row = document.createElement('aside');
    row.className = ACTS;
    row.innerHTML = EDIT + (v.api.onRedo && isDialogue(slot.own) ? REDO : '');
    box.dataset.on = '';
    if (box.classList.contains(BUBBLE)) box.append(row); else box.after(row);
    v.acts = { box, row };
}

function act(v, button) {
    const { el, slot, state } = v.made.get(v.acts.box);
    const tell = button.dataset.act === 'redo' ? v.api.onRedo : v.api.onEdit;
    let body = el;
    while (body && !v.painted.has(body)) body = body.parentElement;
    closeActs(v);
    tell?.({ body, el, at: slot.at, pair: slot.pair, source: slot.orig ?? '', translation: state.data.translation[slot.at] ?? '' });
}

function click(v, event) {
    const target = event.target instanceof Element ? event.target : null;
    // 글자를 끌어 고른 뒤의 누름은 고른 글을 쓰는 쪽의 몫이다
    if (!target || event.defaultPrevented || !getSelection()?.isCollapsed) return;
    const button = target.closest(`.${ACTS} button`);
    if (button && v.acts) { act(v, button); return; }
    const box = target.closest(`.${BOX}`);
    if (box && v.made.has(box)) { if (!target.closest(BUSY)) showActs(v, box); return; }
    const hit = target.closest(BUSY) ? null : paragraphAt(v, target);
    if (hit) toggle(v, hit); else closeOpen(v);
}

function clearAll(v) {
    closeOpen(v);
    for (const [body, state] of v.painted) {
        unswap(v, state);
        body.querySelectorAll(`.${FIXED}`).forEach(box => box.remove());
    }
    v.painted.clear();
}

export function mount(host, api) {
    const v = { host, api, skip: api.skip || SKIP, painted: new Map(), waiting: new Map(), made: new WeakMap(), open: null, acts: null, frame: 0, dirty: false };
    const onClick = event => click(v, event);
    host.classList.add('btr-view');
    host.addEventListener('click', onClick);
    return {
        paint: (body, data, options) => queue(v, body, data, options),
        paintDrawn: (body, data) => paintDrawn(v, body, data),
        flush: () => flush(v),
        refresh() {
            for (const [body, state] of v.painted) v.waiting.set(body, { body, data: state.data, still: false });
            flush(v);
        },
        close() {
            cancelAnimationFrame(v.frame);
            v.waiting.clear();
            clearAll(v);
            host.removeEventListener('click', onClick);
            host.classList.remove('btr-view');
        },
    };
}
