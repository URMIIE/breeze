// 번역기 판의 틀(승인된 시안 t2-settings-plan.html 의 .page · .pop). 뿌리에 btr-plan phone fix 를 걸어 common.css 의 시안 모습을 입는다.
// 휴대폰은 아래에서 올라오는 판, PC 는 머리를 잡고 옮기고 모서리로 크기를, 옆 가장자리로 폭을 바꾸는 창이다.
// PC 창의 머리나 크기를 바꾸는 곳(옆 가장자리, 오른쪽 아래 모서리)을 두 번 누르면 처음 크기로 돌아간다.
// 머리(제목 또는 '뒤로', X)와 화면을 끼울 자리(스크롤되는 몸통 + 맨 아래 고정 버튼 줄)를 내준다.
// 판의 높이는 정해져 있고 내용은 안에서 스크롤한다. 내용이 늘어도 판 크기는 그대로다.
// 화면을 더 열면(push) 휴대폰과 좁은 창에서는 같은 판 안에서 바뀌고 '뒤로'로 돌아간다.
// api.split 을 준 판(번역 설정)은 넓은 PC 창(폭 600 이상)에서 두 칸이다: 첫 화면이 늘 왼쪽 칸(.lcol), 누른 화면이 오른쪽 칸(.rcol)에서 바뀐다(들어갔다 나오는 걸음 없음).
//   오른쪽 칸 맨 위의 화면 이름(.rt)은 틀이 그린다. 통짜 화면(whole)은 두 칸으로 두지 않는다.
// 틀은 그리기만 한다: 닫을지, 창 자리를 기억할지는 넘겨받은 쪽이 정한다.
//
// mount(host, api)
//   host: 판을 붙일 곳(번역 설정 판은 open.js 가 만든 shadow root, 받침 시험은 document.body)
//   api.page: Page            첫 화면
//   api.onClose(): void       X, 휴대폰 판 바깥의 어두운 곳, Esc 를 눌렀을 때. 틀은 스스로 닫지 않는다(넘겨받은 쪽이 close()를 부른다)
//   api.rect?: {x, y, w, h}   PC 창의 처음 자리와 크기(px). 없으면 api.size(없으면 폭 480, 높이 510)로 화면 가운데
//   api.size?: {w, h}         PC 창의 처음 크기. 두 번 눌러 돌아가는 크기도 이것
//   api.split?: boolean       넓은 PC 창에서 두 칸으로 둘지
//   api.onWide?(): void       두 칸인데 오른쪽 칸이 비었을 때(처음 열 때, 창을 넓혔을 때). 넘겨받은 쪽이 push 로 채운다
//   api.onShown?(page|null)   오른쪽 칸(휴대폰은 맨 위)에 보이는 화면이 바뀐 뒤. 첫 화면만 보이면 null
//   api.onRect?(rect): void   PC 창을 옮기거나 크기를 바꾼 뒤 한 번, 같은 꼴 {x, y, w, h}. 처음 크기로 되돌렸을 때는 null(기억한 것을 지우라는 뜻)
//   api.phone?: boolean       휴대폰 판으로 그릴지. 없으면 창 폭 768 이하일 때 휴대폰
//   api.phoneTop?: number     휴대폰 판의 위 끝(화면 맨 위에서 px). 없으면 44. 내용이 짧은 판(다시 번역, 채팅 전부 번역)을 낮게 띄울 때
// Page = { title: string, sub?: string, whole?: boolean, open(view): { refresh?(), close?() } | void }
//   title 은 머리 제목이자, 그 위에 열린 화면의 '뒤로' 글이 된다
//   view = { body: HTMLElement(스크롤 자리), foot: HTMLElement(맨 아래 고정 줄, 비어 있으면 안 보임), setHead }
//   whole 이 true 인 화면(통짜 화면)은 view = { box, setHead } 를 받는다. box 는 머리 아래를 다 차지하는 높이 고정 상자이고,
//   스크롤과 맨 아래 줄은 화면이 스스로 그린다. 통짜 화면은 PC 에서도 나란히 열지 않고 판 전체를 쓴다(나란히 보기는 화면이 스스로 한다)
//   setHead({ title, sub, back }): 머리 글을 바꾼다. title 이 빈 글이면 머리에 제목을 보이지 않는다.
//     back = { label, onBack } 이면 머리의 '뒤로'가 그 글로 보이고 onBack 을 부른다(화면 안쪽의 뒤로 가기).
//     back 이 없거나 null 이면 틀이 하던 대로 앞 화면으로 간다
// 돌려주는 값: { push(page), back(), refresh(), close() }
//   refresh(): 휴대폰/PC 를 다시 가리고 보이는 화면들의 refresh()를 부른다

import { esc, SV } from './text.js';

const SPLIT_MIN = 600;          // 이 폭 이상인 PC 창에서 두 화면을 나란히 둔다(시안 R 의 창 폭 640 이 들어가게)
const PC_DEFAULT = { w: 480, h: 510 };   // 짧은 판(다시 번역, 채팅 전부 번역)의 처음 크기
const PC_MIN = { w: 340, h: 360 };
const PHONE_MAX = 768;
const OUT_MS = 150;              // 닫힐 때 흐려지는 시간(frame.css 의 닫힘 움직임과 같은 값)
const CORNER = 18;              // 오른쪽 아래 모서리의 크기 바꾸는 곳(브라우저가 그리는 손잡이)의 한 변(px)

const SHELL = `
<div class="dim btr-frame-dim"></div>
<section class="btr-frame-panel inst tr" role="dialog" tabindex="-1">
  <div class="grip btr-frame-grip"></div>
  <header class="head btr-frame-head"></header>
  <div class="btr-frame-cols"></div>
  <div class="btr-frame-edge" data-edge="left"></div>
  <div class="btr-frame-edge" data-edge="right"></div>
</section>`;

function headHtml({ back, title, sub }) {
    const left = back
        ? `<button type="button" class="btr-frame-back" aria-label="${esc(back)}(으)로 돌아가기">${SV('left')}</button><div class="btr-frame-title"><b>${esc(title)}</b></div>`
        : `<div class="btr-frame-title"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
    return `${left}<button type="button" class="x btr-frame-x" aria-label="닫기">${SV('x')}</button>`;
}

/**
 * 두 칸의 오른쪽 칸 이름 줄. 화면이 안쪽 뒤로 가기를 맡았으면(setHead 의 back) 그 줄 앞에 뒤로 버튼을 둔다:
 * 두 칸에서는 판 머리가 첫 화면 것이라, 안쪽 화면의 뒤로 가기를 둘 곳이 이 줄뿐이다
 */
function paintColumnName(name, entry, right) {
    name.hidden = !right;
    const back = right && entry.back ? `<button type="button" class="btr-frame-back btr-frame-rtback" aria-label="${esc(entry.back.label)}(으)로 돌아가기">${SV('left')}</button>` : '';
    name.innerHTML = `${back}<span>${esc(entry.title ?? entry.page.title)}</span>`;
}

function viewElement(whole) {
    const el = document.createElement('div');
    el.className = whole ? 'btr-frame-view btr-frame-view-whole' : 'btr-frame-view';
    el.innerHTML = whole ? '<div class="btr-frame-box"></div>'
        : '<div class="btr-frame-scroll"><div class="rt" hidden><span></span></div><div class="btr-frame-body"></div></div><div class="btr-frame-foot"></div>';
    return el;
}

/** 머리에 보일 것: 두 칸이면 첫 화면의 제목, 한 칸이면 맨 위 화면의 제목(아래에 화면이 있으면 '뒤로'와 함께) */
function headOf(stack, split) {
    const first = stack[0], top = stack.at(-1);
    if (split || stack.length === 1) return { title: first.title ?? first.page.title, sub: first.page.sub };
    return { back: top.back?.label ?? stack.at(-2).page.title, title: top.title ?? top.page.title };
}

/** 창이 화면 밖으로 나가지 않게 자리와 크기를 줄인다 */
function clampRect({ x, y, w, h }) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(Math.max(w, PC_MIN.w), vw - 16);
    const height = Math.min(Math.max(h, PC_MIN.h), vh - 16);
    return { x: Math.min(Math.max(x, 8), vw - width - 8), y: Math.min(Math.max(y, 8), vh - height - 8), w: width, h: height };
}

function centerRect(size) {
    const { w, h } = size;
    return clampRect({ x: (window.innerWidth - w) / 2, y: (window.innerHeight - h) / 2, w, h });
}

export function mount(host, api) {
    const root = document.createElement('div');
    root.className = 'btr-frame btr-plan phone fix';
    root.innerHTML = SHELL;
    const panel = root.querySelector('.btr-frame-panel');
    const head = root.querySelector('.btr-frame-head');
    const cols = root.querySelector('.btr-frame-cols');
    const stack = [];               // 열린 화면들: { page, view, handle, title?, back? }(title, back 은 화면이 setHead 로 알린 것)
    let phone = false, rect = null, drag = null, rectTimer = 0;

    const size = api.size ?? PC_DEFAULT;
    let shownPage;
    // 판은 shadow root 안에 붙기도 한다: 그때 문서의 activeElement 는 shadow 의 겉 칸이라, 포커스는 판이 붙은 root 에서 읽는다
    const focused = () => root.getRootNode().activeElement ?? null;
    const hasFocus = () => root.contains(focused());

    // 두 칸: 넓은 PC 창에서만. 통짜 화면이 열려 있으면 그 화면이 판 전체를 쓴다
    const isSplit = () => Boolean(api.split) && !phone && !stack.some(entry => entry.page.whole) && panel.offsetWidth >= SPLIT_MIN;

    // 보이는 화면과 머리를 지금 상태에 맞춘다
    function layout(hadFocus = hasFocus()) {
        const split = isSplit(), top = stack.at(-1);
        root.classList.toggle('btr-frame-split', split);
        const shown = split ? [stack[0], ...(stack.length > 1 ? [top] : [])] : [top];
        for (const entry of stack) {
            const scroll = entry.view.querySelector('.btr-frame-scroll'), left = split && entry === stack[0], right = split && !left;
            entry.view.hidden = !shown.includes(entry);
            entry.view.classList.toggle('btr-frame-left', left);
            if (!scroll) continue;
            scroll.classList.toggle('lcol', left);
            scroll.classList.toggle('rcol', right);
            scroll.classList.toggle('body', !split);
            paintColumnName(scroll.querySelector(':scope > .rt'), entry, right);
        }
        const info = headOf(stack, split);
        head.classList.toggle('btr-frame-head-back', Boolean(info.back));
        head.innerHTML = headHtml(info);
        panel.setAttribute('aria-label', stack[0].page.title);
        // 누른 버튼이 숨거나 사라져도 판 안에 머물게 한다(Esc 로 닫기가 이어지게)
        const active = focused();
        if (hadFocus && (!root.contains(active) || active.closest('[hidden]'))) panel.focus({ preventScroll: true });
        const now = stack.length > 1 ? top.page : null;
        if (now !== shownPage) { shownPage = now; api.onShown?.(now); }
        if (split && stack.length === 1 && api.onWide) queueMicrotask(() => { if (root.isConnected && isSplit() && stack.length === 1) api.onWide(); });
    }

    function setMode() {
        phone = api.phone ?? window.innerWidth <= PHONE_MAX;
        root.classList.toggle('btr-frame-phone', phone);
        root.classList.toggle('btr-frame-pc', !phone);
        root.classList.toggle('pcwrap', !phone);
        panel.classList.toggle('page', phone);
        panel.classList.toggle('pop', !phone);
        if (phone) {
            panel.style.cssText = api.phoneTop ? `top: ${api.phoneTop}px` : '';
            return;
        }
        rect = clampRect(rect ?? api.rect ?? centerRect(size));
        placePanel();
    }

    function placePanel() {
        Object.assign(panel.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    }

    function openPage(page) {
        const view = viewElement(page.whole === true);
        cols.append(view);
        const entry = { page, view, handle: null, title: undefined, back: null };
        stack.push(entry);
        // 빈 제목은 머리에서만 감춘다(위에 열릴 화면의 '뒤로' 글과 판 이름은 원래 제목을 쓴다)
        const setHead = ({ title, sub, back } = {}) => {
            if (title) page.title = title;
            entry.title = title || undefined;
            page.sub = sub;
            entry.back = back?.onBack ? back : null;
            layout();
        };
        const parts = page.whole === true
            ? { box: view.querySelector('.btr-frame-box') }
            : { body: view.querySelector('.btr-frame-body'), foot: view.querySelector('.btr-frame-foot') };
        entry.handle = page.open({ ...parts, setHead }) || null;
    }

    function dropTop() {
        const entry = stack.pop();
        entry.handle?.close?.();
        entry.view.remove();
    }

    // PC 창을 머리로 옮긴다. 누르는 곳(버튼) 위에서는 시작하지 않는다.
    // 손을 뗄 때까지 머리가 포인터를 붙잡으므로 판 바깥으로 나가도 이어진다
    function startDrag(event) {
        if (phone || event.button !== 0 || !event.target.closest('.btr-frame-head') || event.target.closest('button')) return;
        drag = { id: event.pointerId, dx: event.clientX - rect.x, dy: event.clientY - rect.y };
        head.setPointerCapture(event.pointerId);
        event.preventDefault();
    }
    // 옆 가장자리를 끌어 폭만 바꾼다. 왼쪽을 끌면 오른쪽 끝은 제자리에 두고 왼쪽 끝이 움직인다
    function startEdge(event) {
        const edge = event.target.closest('.btr-frame-edge');
        if (phone || event.button !== 0 || !edge) return false;
        const right = rect.x + rect.w;
        // off: 잡은 곳과 그 가장자리 사이의 틈(끌기 시작할 때 가장자리가 손가락 쪽으로 튀지 않게)
        const off = edge.dataset.edge === 'right' ? right - event.clientX : event.clientX - rect.x;
        drag = { id: event.pointerId, edge: edge.dataset.edge, right, off };
        edge.setPointerCapture(event.pointerId);
        event.preventDefault();
        return true;
    }
    /** 가장자리를 끄는 동안의 자리와 폭: 가장 좁은 폭 아래로, 화면 밖으로는 가지 않는다 */
    function widened(pointerX) {
        if (drag.edge === 'right') {
            const most = window.innerWidth - 8 - rect.x;
            return { ...rect, w: Math.min(Math.max(pointerX + drag.off - rect.x, PC_MIN.w), most) };
        }
        const x = Math.min(Math.max(pointerX - drag.off, 8), drag.right - PC_MIN.w);
        return { ...rect, x, w: drag.right - x };
    }
    function onDown(event) {
        if (!startEdge(event)) startDrag(event);
    }
    function moveDrag(event) {
        if (!drag || event.pointerId !== drag.id) return;
        rect = drag.edge ? widened(event.clientX) : clampRect({ ...rect, x: event.clientX - drag.dx, y: event.clientY - drag.dy });
        placePanel();
        if (drag.edge) fitSplit();
    }
    function endDrag(event) {
        if (!drag || event.pointerId !== drag.id) return;
        drag = null;
        api.onRect?.({ ...rect });
    }

    // 폭이 바뀌어 나란히 둘지가 달라졌으면 다시 그린다
    function fitSplit() {
        if (root.classList.contains('btr-frame-split') === isSplit()) return;
        layout();
        for (const entry of stack) if (!entry.view.hidden) entry.handle?.refresh?.();   // 한 칸과 두 칸은 첫 화면의 줄 꼴이 다르다
    }

    const atCorner = event => {
        const box = panel.getBoundingClientRect();
        return box.right - event.clientX <= CORNER && box.bottom - event.clientY <= CORNER;
    };
    // 머리나 크기를 바꾸는 곳을 두 번 누르면 처음 크기로 돌아가고, 기억해 둔 자리와 크기를 지우게 알린다
    function onDouble(event) {
        if (phone || event.target.closest('button')) return;
        const grip = event.target.closest('.btr-frame-head, .btr-frame-edge') || atCorner(event);
        if (!grip) return;
        rect = clampRect({ ...rect, ...size });
        placePanel();
        fitSplit();
        clearTimeout(rectTimer);
        api.onRect?.(null);
    }

    // 모서리로 크기를 바꾸면 나란히 둘지 다시 가리고, 다 바꾼 뒤 한 번만 알린다
    const sizeWatch = new ResizeObserver(() => {
        if (phone) return;
        const w = panel.offsetWidth, h = panel.offsetHeight;
        if (Math.abs(w - rect.w) < 1 && Math.abs(h - rect.h) < 1) return;
        rect = { ...rect, w, h };
        fitSplit();
        clearTimeout(rectTimer);
        rectTimer = setTimeout(() => api.onRect?.({ ...rect }), 300);
    });

    function onClick(event) {
        if (event.target.closest('.btr-frame-x') || event.target === root.querySelector('.btr-frame-dim')) api.onClose();
        else if (event.target.closest('.btr-frame-back')) headBack();
    }
    // 머리의 '뒤로': 화면이 뒤로 가기를 맡았으면 그 화면에 넘기고, 아니면 앞 화면으로
    function headBack() {
        const top = stack.at(-1);
        if (top.back) top.back.onBack();
        else back();
    }
    function onKey(event) {
        if (event.key === 'Escape') { event.stopPropagation(); api.onClose(); }
    }

    /** 새로 보이는 화면이 미끄러져 들어오게 한다. toward: 'in' 더 안쪽 화면으로, 'inback' 앞 화면으로 */
    function slide(view, toward) {
        view.classList.remove('btr-frame-in', 'btr-frame-inback');
        void view.offsetWidth;      // 같은 움직임을 처음부터 다시 돌리려면 한 번 그려져야 한다
        view.classList.add(`btr-frame-${toward}`);
    }

    function back() {
        if (stack.length < 2) return;
        const hadFocus = hasFocus();
        dropTop();
        layout(hadFocus);
        if (!isSplit()) slide(stack.at(-1).view, 'inback');
        stack[stack.length - 1].handle?.refresh?.();
    }

    function push(page) {
        // 두 칸에서는 오른쪽 칸의 화면을 바꾼다(오른쪽에 쌓지 않는다)
        const hadFocus = hasFocus(), split = isSplit();
        if (split && !page.whole) while (stack.length > 1) dropTop();
        openPage(page);
        layout(hadFocus);
        if (!split) slide(stack.at(-1).view, 'in');
        const scroll = stack.at(-1).view.querySelector('.btr-frame-scroll');
        if (scroll) scroll.scrollTop = 0;
    }

    function refresh() {
        setMode();
        layout();
        for (const entry of stack) if (!entry.view.hidden) entry.handle?.refresh?.();
    }

    function close() {
        clearTimeout(rectTimer);
        sizeWatch.disconnect();
        root.removeEventListener('click', onClick);
        root.removeEventListener('keydown', onKey);
        root.removeEventListener('pointerdown', onDown);
        root.removeEventListener('dblclick', onDouble);
        root.removeEventListener('pointermove', moveDrag);
        root.removeEventListener('pointerup', endDrag);
        root.removeEventListener('pointercancel', endDrag);
        // 흐려지며 사라진 뒤에 치운다(그동안은 눌리지 않는다). 움직임을 줄여 둔 기기에서는 바로
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        root.classList.add('btr-frame-out');
        setTimeout(clear, still ? 0 : OUT_MS);
    }

    function clear() {
        while (stack.length) dropTop();
        root.remove();
    }

    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('dblclick', onDouble);
    root.addEventListener('pointermove', moveDrag);
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);

    host.append(root);
    setMode();
    openPage(api.page);
    layout();
    sizeWatch.observe(panel);
    panel.focus({ preventScroll: true });
    return { push, back, refresh, close, isSplit, depth: () => stack.length };
}
