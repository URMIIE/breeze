// 아래 한 줄: 번역하는 동안 "번역 중 21/38" + 멈추기, 끊겼을 때 "8문단을 못 받았어요" + 이어서.
// 글을 가리지 않게 입력 칸 바로 위에 내용만큼의 작은 알 모양으로 뜬다. 휴대폰은 채팅 칸 가운데, PC 는 채팅 칸 오른쪽 안쪽(시안 가).
// 다른 답을 읽으러 올라가도 그 자리에 있고, 알을 누르면 번역 중인 답으로 간다.
// 자리는 보일 때와 창 크기가 바뀔 때만 잰다(잦은 신호에 걸지 않는다).

const STORE_KEY = 'breeze.translator.progressPos';
const SLOTS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const DRAG_START = 6;
const EDGE = 12;

let bar = null, onJump = null, onAction = null, measuring = false;
let corr = { x: 0, y: 0 };   // 테마가 fixed 의 기준을 옮겼을 때 화면 기준 좌표에 더해 줄 값
let drag = null, dragged = false;

const isPhone = () => window.innerWidth <= 768;

function readSlots() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
}

/** 지금 화면 종류(휴대폰 · PC)에 기억된 자리 이름. 없으면 기본 자리. */
function currentSlot() {
    const saved = readSlots()[isPhone() ? 'phone' : 'pc'];
    return SLOTS.includes(saved) ? saved : (isPhone() ? 'bottom-center' : 'bottom-right');
}

function saveSlot(slot) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...readSlots(), [isPhone() ? 'phone' : 'pc']: slot })); } catch { /* 저장소를 못 쓰면 이번만 기억 안 함 */ }
}

function build() {
    bar = document.createElement('div');
    bar.className = 'btr-bar';
    bar.hidden = true;
    bar.innerHTML = '<i class="btr-bar-dot"></i><i class="btr-bar-icon fa-solid fa-triangle-exclamation"></i><span class="btr-bar-text"></span>'
        + '<button type="button" class="btr-bar-action"></button>';
    bar.addEventListener('click', event => {
        if (dragged) { dragged = false; return; }   // 끌고 난 뒤의 손 뗌은 누름이 아니다
        if (event.target.closest('.btr-bar-action')) { event.stopPropagation(); onAction?.(); return; }
        onJump?.();
    });
    document.body.append(bar);
    window.addEventListener('resize', () => { if (!bar.hidden) measure(); });
}

/** 자리 이름의 왼쪽 위 좌표(화면 기준). 위는 위쪽 메뉴 줄 아래, 아래는 입력 칸 위, 좌우는 채팅 칸 안쪽 가장자리. */
function slotPoint(slot, size) {
    const chat = document.getElementById('chat')?.getBoundingClientRect();
    const form = document.getElementById('send_form')?.getBoundingClientRect();
    if (!chat || !form) return null;
    const topBar = document.getElementById('top-bar')?.getBoundingClientRect();
    const [v, h] = slot.split('-');
    const x = h === 'left' ? chat.left + EDGE : h === 'right' ? chat.right - EDGE - size.w : chat.left + (chat.width - size.w) / 2;
    const y = v === 'top' ? (topBar?.bottom ?? chat.top) + 8 : form.top - 8 - size.h;
    return { x, y };
}

function place(x, y) {
    bar.style.left = `${x + corr.x}px`;
    bar.style.top = `${y + corr.y}px`;
}

/**
 * 기억된 자리에 놓는다. 테마가 html · body 에 transform 을 걸면 position: fixed 의 기준이 화면이 아니라 그 상자가 된다(휴대폰 테마에서 표시가 화면 위로 나갔다).
 * 그래서 0,0 에 놓아 실제로 어디 놓이는지 재고, 그 차이를 corr 로 두어 화면 기준 좌표에 더한다.
 */
function measure() {
    if (measuring) return;
    measuring = true;
    requestAnimationFrame(() => {
        measuring = false;
        if (drag?.active) return;
        const chat = document.getElementById('chat')?.getBoundingClientRect();
        if (!chat) return;
        // 내용만큼의 폭: 먼저 맨 왼쪽에 두고 크기를 잰다
        Object.assign(bar.style, { maxWidth: `${chat.width - 2 * EDGE}px`, left: '0px', top: '0px', bottom: 'auto', right: 'auto' });
        const placed = bar.getBoundingClientRect();
        corr = { x: -placed.left, y: -placed.top };
        const size = { w: bar.offsetWidth, h: bar.offsetHeight };
        const point = slotPoint(currentSlot(), size);
        if (point) place(point.x, point.y);
    });
}

/** 표시를 눌러 6px 넘게 끌면 손가락을 따라 움직이고, 놓으면 가장 가까운 자리에 붙는다. 멈춤 · 이어서 버튼은 끌기에서 뺀다. */
function onPointerDown(event) {
    if (event.button > 0 || event.target.closest('.btr-bar-action')) return;
    const rect = bar.getBoundingClientRect();
    drag = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: rect.left - corr.x, oy: rect.top - corr.y, active: false };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerEnd);
    document.addEventListener('pointercancel', onPointerEnd);
}

function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.sx, dy = event.clientY - drag.sy;
    if (!drag.active) {
        if (Math.hypot(dx, dy) <= DRAG_START) return;
        drag.active = true;
        bar.classList.add('btr-bar-dragging');
        bar.style.transition = 'none';
        try { bar.setPointerCapture(drag.id); } catch { /* 이미 사라진 포인터 */ }
    }
    event.preventDefault();
    place(drag.ox + dx, drag.oy + dy);
}

function onPointerEnd(event) {
    if (!drag || event.pointerId !== drag.id) return;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerEnd);
    document.removeEventListener('pointercancel', onPointerEnd);
    const wasDrag = drag.active;
    const { ox, oy, sx, sy } = drag;
    drag = null;
    bar.classList.remove('btr-bar-dragging');
    if (!wasDrag) return;
    dragged = event.type === 'pointerup';
    snap(ox + event.clientX - sx, oy + event.clientY - sy);
}

/** 놓은 자리에서 가장 가까운 자리로 옮겨 붙고, 그 이름을 기억한다. */
function snap(x, y) {
    const size = { w: bar.offsetWidth, h: bar.offsetHeight };
    let best = null, bestDist = Infinity;
    for (const slot of SLOTS) {
        const point = slotPoint(slot, size);
        if (!point) continue;
        const dist = Math.hypot(point.x - x, point.y - y);
        if (dist < bestDist) { best = { slot, point }; bestDist = dist; }
    }
    if (!best) return;
    saveSlot(best.slot);
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    bar.style.transition = smooth ? 'left 0.18s ease, top 0.18s ease' : 'none';
    place(best.point.x, best.point.y);
    if (smooth) setTimeout(() => { if (!drag) bar.style.transition = ''; }, 220);
}

function paint({ text, count = '', action, warn, jump, act }) {
    if (!bar) build();
    bar.classList.toggle('btr-bar-warn', Boolean(warn));
    const label = bar.querySelector('.btr-bar-text');
    label.textContent = text;
    if (count) {
        const span = document.createElement('span');
        span.className = 'btr-bar-count';
        span.textContent = count;
        label.append(span);
    }
    // 번역 중에는 동그란 멈춤 버튼(글자 없이 아이콘 + 이름), 끊겼을 때는 글자 버튼
    const button = bar.querySelector('.btr-bar-action');
    button.classList.toggle('btr-bar-stop', !warn);
    button.replaceChildren();
    if (warn) button.textContent = action;
    else {
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-stop';
        button.append(icon);
    }
    button.setAttribute('aria-label', action);
    onJump = jump ?? null;
    onAction = act ?? null;
    if (bar.hidden) {
        bar.hidden = false;
        bar.addEventListener('pointerdown', onPointerDown);
    }
    measure();   // 글이 바뀌면 폭이 달라지므로(번역 중 → 끊김) 보일 때마다 다시 놓는다
}

/**
 * 번역하는 동안. 답 하나면 "번역 중 12/56"(받은 문단 / 전체 문단), 채팅 전부 번역이면 "번역 중 답 2/5 문단 12/56".
 * @param {{ done?: number, total?: number, answers?: { at: number, total: number }, onStop: () => void, onJump?: () => void }} o
 *   done · total 문단 수(아직 모르면 비움), answers 채팅 전부 번역에서 지금 답이 몇 번째인지
 */
export function showRunning({ done, total, answers, onStop, onJump: jump }) {
    const parts = [];
    if (answers?.total > 0) parts.push(`답 ${answers.at}/${answers.total}`);
    if (Number.isFinite(total) && total > 0) parts.push(`${answers ? '문단 ' : ''}${done ?? 0}/${total}`);
    paint({ text: '번역 중', count: parts.join(' '), action: '멈추기', act: onStop, jump });
}

/**
 * 끊겼거나 일부를 못 받았을 때. requests 가 있으면 '이어서 (요청 n번)', 없으면 '다시 번역'.
 * @param {{ text: string, requests?: number, onAction: () => void, onJump?: () => void }} o
 */
export function showProblem({ text, requests = 0, onAction: act, onJump: jump }) {
    paint({ text, action: requests > 0 ? `이어서 (요청 ${requests}번)` : '재번역', warn: true, act, jump: jump ?? hide });
}

export function hide() {
    if (!bar) return;
    bar.hidden = true;
    bar.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerEnd);
    document.removeEventListener('pointercancel', onPointerEnd);
    drag = null;
    onJump = onAction = null;
}
