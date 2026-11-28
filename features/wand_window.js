// 요술봉 앱 서랍: 마법봉 버튼을 누르면 원래 메뉴 대신 아이콘이 놓인 반투명 창을 띄운다. 옮기고 크기를 바꾸고 꾸밀 수 있다.
// 원래 메뉴는 그대로 두고 안 보이게만 한다. 우리 아이콘을 누르면 원래 줄을 대신 눌러 준다(lib/wand-window/menu.js).
// 창이 닫혀 있는 동안은 감시 · 타이머가 없다: 메뉴는 창을 열 때 한 번 읽고, 열려 있는 동안에만 메뉴가 바뀌는지 본다.
// 설정 칸(api.options()): look · color · clear · blur · icon · font · pinned · order · hidden · names · icons · folders · dock · place
import { WAND_WINDOW_NAME } from '../features.js';
import { menuRoot, readMenu, signature, press, clearProbe } from '../lib/wand-window/menu.js';
import { fill, importOld, oldIsOn, bucket, colorOf, clearOf, TONES } from '../lib/wand-window/settings.js';
import { paintGrid, esc } from '../lib/wand-window/grid.js';
import { CSS } from '../lib/wand-window/style.js';
import { dragWith, fit, MARGIN } from '../lib/wand-window/drag.js';
import * as edit from '../lib/wand-window/edit.js';
import * as dock from '../lib/wand-window/dock.js';

const S = { api: null, o: null, win: null, grid: null, sheet: null, items: [], sig: '', open: false, editing: false, folder: null, sheetMode: 'main' };
let style = null, observer = null, watchRaf = 0;
const REDUCED = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 보이는 값(창 색 · 투명하게 · 흐림 · 크기)은 CSS 변수로만: 슬라이더를 움직이는 동안 다시 그리지 않게 ──
function applyVars(el) {
    const o = S.o;
    el.style.setProperty('--bw-color', colorOf(o));
    el.style.setProperty('--bw-mix', `${100 - clearOf(o)}%`);
    el.style.setProperty('--bw-blur', `${o.blur}px`);
    el.style.setProperty('--bw-icon', `${o.icon}px`);
    el.style.setProperty('--bw-font', `${o.font}px`);
    el.classList.toggle('bw-look-b', o.look === 'b');
    for (const t of TONES) el.classList.toggle(`bw-tone-${t}`, o.look !== 'b' && o.tone === t);
}
const refreshLook = () => { if (S.win) applyVars(S.win); dock.applyLook(applyVars); };

function save() { S.api.save(); }

function hint(text) {
    S.win?.querySelector('.bw-hint')?.remove();
    S.win?.insertAdjacentHTML('beforeend', `<div class="bw-hint" role="status">${esc(text)}</div>`);
}

// ── 창 만들기 ──
function headHtml() {
    if (S.editing) return '<span></span><span class="bw-grip"></span><button type="button" class="bw-hbtn bw-done" data-act="done">완료</button>';
    const pin = S.o.pinned, row = S.o.dock.on;
    return '<span class="bw-hgroup">'
        + `<button type="button" class="bw-hbtn${pin ? ' bw-pin-on' : ''}" data-act="pin" aria-pressed="${pin}" aria-label="창 고정" title="창 고정"><i class="fa-solid fa-thumbtack"></i></button>`
        + `<button type="button" class="bw-hbtn${row ? ' bw-pin-on' : ''}" data-act="dock" aria-pressed="${row}" aria-label="늘 떠 있는 줄" title="늘 떠 있는 줄"><i class="fa-solid fa-ellipsis"></i></button>`
        + '</span><span class="bw-grip"></span>'
        + '<button type="button" class="bw-hbtn bw-hend" data-act="edit" aria-label="꾸미기" title="꾸미기"><i class="fa-solid fa-sliders"></i></button>';
}
const paintHead = () => { S.win.querySelector('.bw-head').innerHTML = headHtml(); };

function build() {
    const win = document.createElement('div');
    win.id = 'bw_win';
    win.className = 'bw-glass';
    win.hidden = true;
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', WAND_WINDOW_NAME);
    win.innerHTML = '<div class="bw-head"></div><div class="bw-grid"></div><div class="bw-sheet" hidden></div><div class="bw-rs bw-rs-x" data-axis="x" aria-hidden="true"></div><div class="bw-rs bw-rs-y" data-axis="y" aria-hidden="true"></div><div class="bw-rs" aria-hidden="true"></div>';
    document.body.append(win);
    S.win = win;
    S.grid = win.querySelector('.bw-grid');
    S.sheet = win.querySelector('.bw-sheet');
    win.addEventListener('click', onWinClick);
    win.addEventListener('keydown', onWinKey);
    win.querySelector('.bw-head').addEventListener('pointerdown', onHeadDown);
    for (const grip of win.querySelectorAll('.bw-rs')) grip.addEventListener('pointerdown', onResizeDown);
    S.grid.addEventListener('pointerdown', (e) => edit.onGridDown(S, H, e));
    win.addEventListener('pointerdown', (e) => edit.onPopDown(S, H, e));
    applyVars(win);
}

// 다시 그리기: 줄 · 설정이 바뀌었을 때만. 열려 있는 폴더는 같은 폴더로 다시 엶
function render({ sheet = true } = {}) {
    if (!S.win) return;
    paintHead();
    S.win.classList.toggle('bw-editing', S.editing);
    paintGrid(S.grid, S.o, S.items);
    edit.paintFolder(S, H);
    if (S.editing && sheet) edit.paintSheet(S, H);
}

// 기능 파일 밖(edit · dock)에서 부르는 것
const H = { render, save, hint, fitEdit: () => fitEdit(), refreshLook, applyVars, activate: (key, el) => activate(key, el), renderDock: () => dock.render(S, H), close: () => closeWin() };

// ── 자리 · 크기 ──
const place = () => (S.o.place[bucket()] ??= {});
// 처음 크기: PC · 휴대폰 모두 가로 3개 · 세로 3줄이 보이게(나머지는 창 안에서 스크롤). 아이콘 크기를 바꿨으면 그만큼 넓힘
function defaultSize() {
    const grow = (S.o.icon - 48) * 3;
    return { w: 228 + grow, h: 290 + grow };
}
function defaultSpot(w, h) {
    const b = document.getElementById('extensionsMenuButton')?.getBoundingClientRect();
    if (!b || !b.width) return { left: MARGIN, top: innerHeight - h - 80 };
    return { left: b.left, top: b.top - h - 10 };
}
const WIN_MIN = { w: 150, h: 160 };
function applyPlace() {
    const p = place(), d = defaultSize();
    const w = p.w || d.w, h = p.h || d.h;
    const spot = Number.isFinite(p.x) ? { left: p.x * innerWidth, top: p.y * innerHeight } : defaultSpot(w, h);
    const r = fit(spot.left, spot.top, w, h, WIN_MIN);
    Object.assign(S.win.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.w}px`, height: `${r.h}px`, transform: '' });
}
function rememberPlace() {
    const r = S.win.getBoundingClientRect(), p = place();
    p.x = r.left / innerWidth; p.y = r.top / innerHeight;
    p.w = Math.round(r.width); p.h = Math.round(r.height);
    save();
}

// 옮기기: 움직이는 동안은 transform 만 한 프레임에 한 번, 놓을 때 자리로 굳힘
function onHeadDown(e) {
    if (e.button > 0 || e.target.closest('button')) return;
    e.preventDefault();
    const start = S.win.getBoundingClientRect();
    S.win.classList.add('bw-moving');
    dragWith(e, (dx, dy) => {
        const r = fit(start.left + dx, start.top + dy, start.width, start.height, WIN_MIN);
        S.win.style.transform = `translate3d(${r.left - start.left}px, ${r.top - start.top}px, 0)`;
    }, (dx, dy) => {
        S.win.classList.remove('bw-moving');
        const r = fit(start.left + dx, start.top + dy, start.width, start.height, WIN_MIN);
        Object.assign(S.win.style, { left: `${r.left}px`, top: `${r.top}px`, transform: '' });
        if (dx || dy) rememberPlace();
    });
}
function onResizeDown(e) {
    if (e.button > 0) return;
    e.preventDefault();
    const start = S.win.getBoundingClientRect();
    // 오른쪽 가장자리는 폭만, 아래 가장자리는 높이만, 모서리는 둘 다
    const axis = e.currentTarget.dataset.axis, wide = axis !== 'y', tall = axis !== 'x';
    const size = (dx, dy) => ({
        w: Math.min(Math.max(WIN_MIN.w, start.width + (wide ? dx : 0)), innerWidth - start.left - MARGIN),
        h: Math.min(Math.max(WIN_MIN.h, start.height + (tall ? dy : 0)), innerHeight - start.top - MARGIN),
    });
    dragWith(e, (dx, dy) => {
        const s = size(dx, dy);
        Object.assign(S.win.style, { width: `${s.w}px`, height: `${s.h}px` });
    }, (dx, dy) => { if (dx || dy) rememberPlace(); });
}
function onViewport() { if (S.open) applyPlace(); }

// 꾸미는 동안: 저장된 크기에서 아래 칸(펼친 내용)이 다 보이고 아이콘도 두 줄은 보이게 창을 키움(저장 안 함, 완료하면 저장된 크기로).
//   작게 줄여 둔 창에서는 아래 칸이 아이콘을 다 가렸음. 화면이 더 작으면 화면 안까지만 키우고 아래 칸이 안에서 스크롤
const EDIT_MIN_W = 228, HEAD_H = 30;
function fitEdit() {
    if (!S.editing || !S.open) return;
    const p = place(), d = defaultSize();
    const base = { w: p.w || d.w, h: p.h || d.h };
    const rows = (S.o.icon + 34) * 2;
    const need = HEAD_H + rows + S.sheet.scrollHeight + 8;
    const r = S.win.getBoundingClientRect();
    const f = fit(r.left, r.top, Math.max(base.w, EDIT_MIN_W), Math.max(base.h, need), WIN_MIN);
    Object.assign(S.win.style, { left: `${f.left}px`, top: `${f.top}px`, width: `${f.w}px`, height: `${f.h}px` });
}

// ── 여닫기 ──
function onOutside(e) {
    if (S.o.pinned || S.editing) return;
    const t = e.target;
    if (S.win.contains(t) || t.closest?.('#extensionsMenuButton, #bw_dock')) return;
    closeWin();
}

// 열려 있는 동안만 메뉴가 바뀌는지 봄(누르면 줄이 바뀌는 확장). 메뉴 자신의 style 은 원래 메뉴가 열리고 닫히며 바꾸는 것이라 뺌
function watch() {
    const root = menuRoot();
    if (!root || observer) return;
    observer = new MutationObserver((list) => {
        if (list.every(m => m.target === root && m.type === 'attributes')) return;
        if (!watchRaf) watchRaf = requestAnimationFrame(reread);
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'title'] });
}
function unwatch() {
    observer?.disconnect(); observer = null;
    cancelAnimationFrame(watchRaf); watchRaf = 0;
}
function reread() {
    watchRaf = 0;
    if (edit.dragging()) { watchRaf = requestAnimationFrame(reread); return; }
    const items = readMenu(), sig = signature(items);
    S.items = items;
    if (sig === S.sig) return;
    S.sig = sig;
    render();
}

function openWin({ animate = true } = {}) {
    // 메뉴는 창을 붙이기 전에 읽음: 창을 먼저 붙이면 줄을 읽을 때 화면 전체 모양 계산을 한 번 더 기다림
    S.items = readMenu();
    if (!S.win) build();
    S.sig = signature(S.items);
    applyVars(S.win);   // 다른 기기 · 탭에서 바뀐 설정이 들어왔을 수 있어 열 때마다 맞춤(변수 몇 개라 가벼움)
    render();
    applyPlace();
    S.win.hidden = false;
    S.open = true;
    if (animate && !REDUCED()) S.win.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 140, easing: 'ease-out' });
    document.addEventListener('pointerdown', onOutside, true);
    addEventListener('resize', onViewport);
    watch();
    if (S.o.pinned && !place().open) { place().open = true; save(); }
}

function closeWin({ animate = true } = {}) {
    if (!S.open) return;
    S.open = false;
    document.removeEventListener('pointerdown', onOutside, true);
    removeEventListener('resize', onViewport);
    unwatch();
    if (S.editing) edit.exitEdit(S, H, { quiet: true });
    S.folder = null;
    S.win.classList.remove('bw-folder-open');
    S.win.querySelector('.bw-pop')?.remove();
    if (place().open) { place().open = false; save(); }
    const win = S.win;
    const hide = () => { if (!S.open) win.hidden = true; };
    if (!animate || REDUCED()) return hide();
    win.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 140, easing: 'ease-in' }).finished.then(hide, hide);
}

// 마법봉 버튼 누름을 가장 먼저(창 전체의 잡기 단계에서) 받아 원래 메뉴 쪽으로는 안 보냄.
//   보내면 원래 메뉴가 안 보이는 채로 서서히 나타나는 움직임을 돌려, 그 사이 프레임마다 화면 전체 모양 계산이 다시 돌았음(열 때 버벅임)
function onWandClick(e) {
    if (!e.target.closest?.('#extensionsMenuButton')) return;
    e.stopPropagation();
    S.open ? closeWin() : openWin();
}

// ── 누르기 ──
function activate(key, el) {
    const r = el?.querySelector('.bw-ic')?.getBoundingClientRect() || el?.getBoundingClientRect();
    if (!press(key, r ? { left: r.left, top: r.top } : null)) return hint('이 줄을 지금 메뉴에서 찾지 못했어요.');
    if (!S.o.pinned && S.open && !el?.closest('#bw_dock')) closeWin();
}

function togglePin() {
    S.o.pinned = !S.o.pinned;
    place().open = S.o.pinned && S.open;
    save();
    paintHead();
    hint(S.o.pinned ? '창 고정: 아이콘이나 창 밖을 눌러도 창이 남아요' : '고정 풀림: 아이콘을 누르면 창이 닫혀요');
}

function toggleDockRow() {
    S.o.dock.on = !S.o.dock.on;
    save();
    dock.render(S, H);
    paintHead();
    hint(S.o.dock.on ? '늘 떠 있는 줄을 켰어요' : '늘 떠 있는 줄을 껐어요');
}

function onWinClick(e) {
    // 원래 줄을 대신 누른 클릭이 문서까지 올라가면, 옆 메뉴를 띄운 확장이 '바깥을 눌렀다'고 보고 그 메뉴를 바로 닫았음
    e.stopPropagation();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'pin') return togglePin();
    if (act === 'dock') return toggleDockRow();
    if (act === 'edit') return edit.enterEdit(S, H);
    if (act === 'done') { edit.exitEdit(S, H); return applyPlace(); }
    if (S.editing) return edit.onEditClick(S, H, e);
    if (edit.onFolderClick(S, H, e)) return;
    const app = e.target.closest('.bw-app');
    if (app?.dataset.key) activate(app.dataset.key, app);
}
function onWinKey(e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.bw-app')) { e.preventDefault(); e.target.click(); }
}

// ── 켜고 끄기 ──
export function start(api) {
    S.api = api;
    S.o = fill(api.options());
    const ext = api.ctx().extensionSettings;
    importOld(S.o, ext, save);
    if (oldIsOn(ext)) toastr.warning(`같이 켜면 메뉴가 두 번 꾸며져요. 마법봉 메뉴를 아이폰처럼 바꾸는 다른 확장을 꺼 주세요.`, WAND_WINDOW_NAME, { timeOut: 10000 });
    style = Object.assign(document.createElement('style'), { id: 'bw-style', textContent: CSS });
    document.head.append(style);
    document.documentElement.classList.add('bw-on');
    window.addEventListener('click', onWandClick, true);
    dock.render(S, H);
    if (S.o.pinned && place().open) openWin({ animate: false });
}

export function stop() {
    closeWin({ animate: false });
    window.removeEventListener('click', onWandClick, true);
    edit.reset();
    dock.remove();
    S.win?.remove();
    S.win = S.grid = S.sheet = null;
    style?.remove(); style = null;
    document.documentElement.classList.remove('bw-on');
    clearProbe();
}
