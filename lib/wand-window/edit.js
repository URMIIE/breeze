// 꾸미기: 창 안에서 바로(설정 창을 따로 띄우지 않음). 아이콘 끌어 차례 바꾸기 · 겹쳐서 폴더로 묶기, 빼기 표시로 숨기기,
// 눌러서 이름 · 아이콘 바꾸기. 아래 칸은 버튼 넷(모양 · 크기 · 숨긴 것 · 더 보기)만 두고, 누른 것 하나만 그 아래에 펼친다
// (값 줄 · 버튼을 한꺼번에 늘어놓았더니 어지러웠음). 값은 움직이는 대로 창에 보이고(CSS 변수) 놓을 때 저장.
import { LIMITS, FOLDER_PREFIX, fill, resetLook, colorPair, clearOf } from './settings.js';
import { esc, appHtml, fillPictures, folderOf, folderToken, nameOf, settleOrder, moveBefore, topLevel } from './grid.js';
import { saveUserFile, pickFile, extOf } from '../files.js';
import { softIn, softOut } from './motion.js';

// 펼치는 칸: 버튼 이름 · 안에 든 값 줄
const TABS = [['look', '모양'], ['size', '크기'], ['hidden', '숨긴 것'], ['more', '더 보기']];
const SLIDER_NAMES = { clear: '투명하게', blur: '뒤 흐리게', icon: '아이콘', font: '글자' };
let drag = null, swallowClick = false, sheetBound = null;
export const dragging = () => !!drag?.moved;

const itemOf = (S, key) => S.items.find(i => i.key === key);
const folderById = (S, id) => S.o.folders.find(f => f.id === id);

// ── 들어가기 · 나오기 ──
// 들고 날 때 아래 칸이 뚝 생기고 사라지지 않게 짧게 나타나고 사라짐(창 크기 바뀜은 배치 값이라 움직이지 않음)
export function enterEdit(S, H) {
    S.editing = true;
    S.sheetMode = 'main';
    S.sheetTab = FIRST_TAB;
    S.sheet.hidden = false;
    bindSheet(S, H);
    H.render();
    softIn(S.sheet, 'translateY(6px)');
}
export function exitEdit(S, H, { quiet = false } = {}) {
    S.editing = false;
    S.folder = null;
    const clear = () => { if (!S.editing) { S.sheet.hidden = true; S.sheet.replaceChildren(); } };
    if (quiet) return clear();
    H.render();
    softOut(S.sheet, clear, 'translateY(6px)');
}
export function reset() { drag = null; pull = null; swallowClick = false; sheetBound = null; }

// ── 아래 칸 ──
function sliderHtml(o, k) {
    const lim = LIMITS[k];
    const v = k === 'clear' ? clearOf(o) : o[k];
    return `<label class="bw-sl"><span>${SLIDER_NAMES[k]}</span><input type="range" data-v="${k}" min="${lim.min}" max="${lim.max}" step="${lim.step}" value="${v}" aria-label="${SLIDER_NAMES[k]}"></label>`;
}
// 둘 중 하나 고르기 줄. off: 지금 고른 모양에서는 안 쓰는 줄(자리는 두고 흐리게: 줄이 없어지면 칸 높이가 바뀜)
function segHtml(label, options, off = false) {
    const btns = options.map(([act, text, on]) => `<button type="button" class="bw-seg-btn${on ? ' bw-sel' : ''}" data-do="${act}" aria-pressed="${on}"${off ? ' disabled' : ''}>${text}</button>`).join('');
    return `<div class="bw-seg${off ? ' bw-off' : ''}"><span>${label}</span>${btns}</div>`;
}
function lookPane(o) {
    return segHtml('모양', [['look-a', '색 아이콘', o.look !== 'b'], ['look-b', '단색 버튼', o.look === 'b']])
        + segHtml('아이콘 색', [['tone-c3', '테마 색', o.tone === 'c3'], ['tone-c4', '여러 색', o.tone === 'c4']], o.look === 'b')
        + sliderHtml(o, 'clear') + sliderHtml(o, 'blur');
}
const sizePane = (o) => sliderHtml(o, 'icon') + sliderHtml(o, 'font');
function hiddenPane(S) {
    const items = S.o.hidden.map(k => itemOf(S, k)).filter(Boolean);
    if (!items.length) return '<div class="bw-tip">숨긴 아이콘이 없어요.</div>';
    return `<div class="bw-tip">누르면 다시 보여요.</div><div class="bw-hidden-list">${items.map(i => appHtml(S.o, i)).join('')}</div>`;
}
function morePane(o, asking) {
    const swatch = `<span class="bw-swatch" style="background: ${esc(o.color || 'var(--SmartThemeBlurTintColor)')}"></span>`;
    return `<button type="button" class="bw-line" data-do="dock" role="switch" aria-checked="${o.dock.on}"><span>늘 떠 있는 줄</span><span class="bw-sw${o.dock.on ? ' bw-sw-on' : ''}"></span></button>`
        + `<button type="button" class="bw-line" data-do="color"><span>창 색</span>${swatch}</button>`
        + (o.color ? '<button type="button" class="bw-line" data-do="theme-color"><span>창 색을 테마 색으로</span><i class="fa-solid fa-rotate-left"></i></button>' : '')
        + (asking
            ? '<div class="bw-ask"><span>모양만 처음으로 돌릴까요?</span><div class="bw-row"><button type="button" class="bw-btn" data-do="reset-yes">되돌리기</button><button type="button" class="bw-btn" data-do="reset-no">취소</button></div></div>'
            : '<button type="button" class="bw-line" data-do="reset"><span>처음 모습으로 되돌리기</span><i class="fa-solid fa-rotate-left"></i></button>')
        + `<input type="color" class="bw-color-input" tabindex="-1" aria-hidden="true" value="${esc(o.color || '#888888')}">`;
}
const FIRST_TAB = 'look';
const PANES = { look: (S) => lookPane(S.o), size: (S) => sizePane(S.o), hidden: hiddenPane, more: (S) => morePane(S.o, S.askReset) };
function mainHtml(S) {
    const hiddenCount = S.o.hidden.filter(k => itemOf(S, k)).length;
    const tabs = TABS.map(([id, label]) => {
        const text = id === 'hidden' ? `${label} ${hiddenCount}` : label;
        const on = S.sheetTab === id;
        return `<button type="button" class="bw-tab${on ? ' bw-sel' : ''}" data-tab="${id}" aria-expanded="${on}">${text}</button>`;
    }).join('');
    const tip = '<div class="bw-tip bw-tip-center">끌어서 옮기고, 겹쳐서 폴더로 묶어요</div>';
    return `${tip}<div class="bw-tabs">${tabs}</div><div class="bw-pane">${PANES[S.sheetTab](S)}</div>`;
}
// 색 고르기 칸(input color)은 #rrggbb 만 받는데 자동 색은 oklch 라, 한 점 그려 읽어 바꿈
let paper = null;
function toHex(css) {
    paper ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
    paper.clearRect(0, 0, 1, 1);
    paper.fillStyle = '#000';
    paper.fillStyle = css;
    paper.fillRect(0, 0, 1, 1);
    const [r, g, b] = paper.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
function iconEditorHtml(S, key) {
    const o = S.o, item = itemOf(S, key), mine = o.icons[key] || {};
    const label = item?.label || key;
    return `<h4>${esc(label)}</h4>`
        + `<label class="bw-field"><span>이름</span><input type="text" data-f="name" value="${esc(o.names[key] || '')}" placeholder="${esc(label)}"></label>`
        + `<label class="bw-field"><span>아이콘</span><input type="text" data-f="fa" value="${esc(mine.fa || '')}" placeholder="예: palette"></label>`
        + '<div class="bw-tip">Font Awesome 아이콘 이름을 적거나 그림을 올려요.</div>'
        + `<div class="bw-row"><button type="button" class="bw-btn" data-do="pic">그림 올리기</button>${mine.img ? '<button type="button" class="bw-btn" data-do="pic-clear">그림 빼기</button>' : ''}</div>`
        + (o.look === 'b' || o.tone !== 'c4' ? '' : `<label class="bw-field"><span>색</span><input type="color" data-f="color" value="${esc(mine.color || toHex(colorPair(o, key)[0]))}"></label>`)
        + `<label class="bw-check"><input type="checkbox" data-f="dock"${o.dock.items.includes(key) ? ' checked' : ''}> 늘 떠 있는 줄에 두기</label>`
        + '<div class="bw-row"><button type="button" class="bw-btn" data-do="icon-reset">원래대로</button><button type="button" class="bw-btn" data-do="back">닫기</button></div>';
}
function folderEditorHtml(folder) {
    return '<h4>폴더</h4>'
        + `<label class="bw-field"><span>이름</span><input type="text" data-f="folder-name" value="${esc(folder.name)}"></label>`
        + '<div class="bw-tip">아이콘을 이 폴더 위에 겹쳐 넣어요. 꺼낼 땐 폴더 안 아이콘을 폴더 밖으로 끌어요.</div>'
        + '<div class="bw-row"><button type="button" class="bw-btn" data-do="folder-remove">폴더 풀기</button><button type="button" class="bw-btn" data-do="back">닫기</button></div>';
}
export function paintSheet(S, H) {
    const mode = S.sheetMode;
    let html;
    if (mode.startsWith('icon:')) html = `<div class="bw-pane">${iconEditorHtml(S, mode.slice(5))}</div>`;
    else if (mode.startsWith('folder:') && folderById(S, mode.slice(7))) html = `<div class="bw-pane">${folderEditorHtml(folderById(S, mode.slice(7)))}</div>`;
    else html = mainHtml(S);
    S.sheet.innerHTML = html;
    if (S.sheetTab === 'hidden') fillPictures(S.sheet, new Map(S.items.map(i => [i.key, i])));
    H?.fitEdit();
}
const setMode = (S, H, mode) => { S.sheetMode = mode; paintSheet(S, H); };

// 칸 안의 입력은 칸 하나에 이벤트를 한 번만 붙임(창은 꾸미기를 나왔다 들어가도 같은 칸)
function bindSheet(S, H) {
    if (sheetBound === S.sheet) return;
    sheetBound = S.sheet;
    S.sheet.addEventListener('input', (e) => onSheetInput(S, H, e));
    S.sheet.addEventListener('change', () => H.save());
}
function onSheetInput(S, H, e) {
    const t = e.target, o = S.o;
    if (t.dataset.v) {
        o[t.dataset.v] = Number(t.value);
        return H.refreshLook();
    }
    if (t.classList.contains('bw-color-input')) { o.color = t.value; return H.refreshLook(); }
    const key = S.sheetMode.slice(5);
    if (t.dataset.f === 'name') { if (t.value.trim()) o.names[key] = t.value.trim(); else delete o.names[key]; return repaintGrid(S, H); }
    if (t.dataset.f === 'fa') { setIcon(o, key, { fa: t.value.trim().replace(/^fa-/, '').toLowerCase() }); return repaintGrid(S, H); }
    if (t.dataset.f === 'color') { setIcon(o, key, { color: t.value }); return repaintGrid(S, H); }
    if (t.dataset.f === 'dock') return toggleDock(S, H, key, t.checked);
    if (t.dataset.f === 'folder-name') {
        const f = folderById(S, S.sheetMode.slice(7));
        if (f) f.name = t.value.slice(0, 40) || '새 폴더';
        repaintGrid(S, H);
    }
}
// 이름 · 아이콘을 적는 동안은 격자만 다시 그림(아래 칸을 다시 그리면 적던 칸에서 글쇠 자리가 빠짐)
function repaintGrid(S, H) {
    H.render({ sheet: false });
}
function setIcon(o, key, patch) {
    const next = { ...(o.icons[key] || {}), ...patch };
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    if (Object.keys(next).length) o.icons[key] = next; else delete o.icons[key];
}
function toggleDock(S, H, key, on) {
    const d = S.o.dock, item = itemOf(S, key);
    d.items = d.items.filter(k => k !== key);
    delete d.meta[key];
    if (on) {
        d.items.push(key);
        d.meta[key] = { label: item ? nameOf(S.o, item) : key, fa: item?.icon.fa || '' };
    }
    H.save();
    H.renderDock();
}

// ── 누르기 ──
export function onEditClick(S, H, e) {
    if (swallowClick) { swallowClick = false; return; }
    const t = e.target;
    const tab = t.closest('[data-tab]')?.dataset.tab;
    if (tab) return toggleTab(S, H, tab);
    const act = t.closest('[data-do]')?.dataset.do;
    if (act) return doAction(S, H, act);
    const back = t.closest('.bw-hidden-list .bw-app');
    if (back) return unhide(S, H, back.dataset.key);
    const app = t.closest('.bw-app');
    if (!app) return closeFolderIfOutside(S, H, t);
    if (t.closest('.bw-x')) return app.dataset.folder ? unfold(S, H, app.dataset.folder) : hide(S, H, app.dataset.key);
    if (app.dataset.folder) {
        S.folder = app.dataset.folder;
        setModeAndRender(S, H, `folder:${app.dataset.folder}`);
        return softIn(S.win.querySelector('.bw-pop'), 'scale(.94)');
    }
    setMode(S, H, `icon:${app.dataset.key}`);
}
// 버튼을 누르면 그 내용으로 바뀜. 늘 하나는 펴 둠(접힌 꼴이 있으면 아래 칸 높이가 달라짐)
function toggleTab(S, H, tab) {
    if (S.sheetTab === tab) return;
    S.sheetTab = tab;
    S.askReset = false;
    paintSheet(S, H);
    softIn(S.sheet.querySelector('.bw-pane'));
}
function setModeAndRender(S, H, mode) { S.sheetMode = mode; H.render(); }
function closeFolderIfOutside(S, H, t) {
    if (S.folder && !t.closest('.bw-pop, .bw-sheet, .bw-head')) { S.folder = null; setModeAndRender(S, H, 'main'); }
}

async function doAction(S, H, act) {
    const o = S.o;
    if (act === 'back') return setModeAndRender(S, H, 'main');
    if (act === 'look-a' || act === 'look-b') { o.look = act.slice(5); H.save(); H.refreshLook(); return H.render(); }
    if (act === 'tone-c3' || act === 'tone-c4') { o.tone = act.slice(5); H.save(); H.refreshLook(); return H.render(); }
    if (act === 'color') return S.sheet.querySelector('.bw-color-input')?.click();
    if (act === 'theme-color') { o.color = null; H.save(); H.refreshLook(); return paintSheet(S, H); }
    if (act === 'folder-remove') return unfold(S, H, S.sheetMode.slice(7));
    if (act === 'dock') { o.dock.on = !o.dock.on; H.save(); H.renderDock(); return paintSheet(S, H); }
    if (act === 'reset' || act === 'reset-no') { S.askReset = act === 'reset'; return paintSheet(S, H); }
    if (act === 'reset-yes') return resetAll(S, H);
    const key = S.sheetMode.slice(5);
    if (act === 'pic') return uploadPicture(S, H, key);
    if (act === 'pic-clear') { setIcon(o, key, { img: '' }); H.save(); return H.render(); }
    if (act === 'icon-reset') { delete o.icons[key]; delete o.names[key]; H.save(); return H.render(); }
}

function hide(S, H, key) {
    const o = S.o;
    if (!o.hidden.includes(key)) o.hidden.push(key);
    for (const f of o.folders) f.items = f.items.filter(k => k !== key);
    H.save(); H.render();
}
function unhide(S, H, key) {
    S.o.hidden = S.o.hidden.filter(k => k !== key);
    H.save(); H.render();
}
/** 폴더에서 꺼내 before 앞에 둔다. before 가 없으면 폴더 바로 뒤. 폴더 창은 닫는다 */
function takeOut(S, H, key, before) {
    const o = S.o, f = folderOf(o, key);
    if (!f) return;
    f.items = f.items.filter(k => k !== key);
    settleOrder(o, S.items);
    moveBefore(o, key, before ?? o.order[o.order.indexOf(folderToken(f.id)) + 1]);
    S.folder = null;
    S.sheetMode = 'main';
    H.save(); H.render();
}
// 폴더 풀기: 안의 아이콘은 폴더가 있던 자리에 그대로 놓임
function unfold(S, H, id) {
    const o = S.o, f = folderById(S, id);
    if (!f) return;
    settleOrder(o, S.items);
    const at = o.order.indexOf(folderToken(id));
    o.order = o.order.filter(k => k !== folderToken(id) && !f.items.includes(k));
    o.order.splice(Math.max(0, at), 0, ...f.items);
    o.folders = o.folders.filter(x => x !== f);
    if (S.folder === id) S.folder = null;
    H.save();
    setModeAndRender(S, H, 'main');
}
async function uploadPicture(S, H, key) {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
        const url = await saveUserFile(`breeze-wand-icon-${Date.now().toString(36)}.${extOf(file)}`, file);
        setIcon(S.o, key, { img: url });
        H.save(); H.render();
    } catch (err) {
        console.warn('[Breeze] 아이콘 그림 올리기', err);
        H.hint('그림을 올리지 못했어요.');
    }
}
// 창 자리와 크기 · 고정은 두고 나머지를 처음으로. 물음은 '더 보기' 칸의 그 줄에서 받음(화면을 덮는 확인 창은 안 띄움)
function resetAll(S, H) {
    S.askReset = false;
    // 모양만 되돌린다: 숨긴 것 · 차례 · 폴더 · 이름 · 아이콘 그림 · 고정 줄은 그대로(되돌리려다 정리해 둔 것까지 날아갔다)
    const o = resetLook(S.o);
    // 창 크기도 처음 크기로(PC · 휴대폰 둘 다). 옮겨 둔 자리는 그대로 둔다
    for (const spot of Object.values(o.place ?? {})) { delete spot.w; delete spot.h; }
    S.sheetTab = FIRST_TAB;
    H.save(); H.refreshLook(); H.renderDock(); H.fitEdit();
    setModeAndRender(S, H, 'main');
}

// ── 폴더 열기(꾸미기 밖에서도) ──
export function paintFolder(S) {
    S.win.querySelector('.bw-pop')?.remove();
    const f = S.folder && folderById(S, S.folder);
    S.win.classList.toggle('bw-folder-open', !!f);
    if (!f) { S.folder = null; return; }
    const hidden = new Set(S.o.hidden), byKey = new Map(S.items.map(i => [i.key, i]));
    const apps = f.items.filter(k => byKey.has(k) && !hidden.has(k)).map(k => appHtml(S.o, byKey.get(k))).join('');
    S.win.querySelector('.bw-sheet').insertAdjacentHTML('beforebegin',
        `<div class="bw-pop" role="group" aria-label="${esc(f.name)}"><h4>${esc(f.name)}</h4><div class="bw-grid">${apps || '<div class="bw-tip">비어 있어요.</div>'}</div></div>`);
    fillPictures(S.win.querySelector('.bw-pop'), byKey);
}
/** 꾸미기 밖에서 폴더를 누르거나 폴더 바깥을 누름. 처리했으면 true */
export function onFolderClick(S, H, e) {
    const t = e.target;
    const folder = t.closest('.bw-grid > .bw-folder');
    if (folder && !t.closest('.bw-pop')) {
        S.folder = folder.dataset.folder;
        paintFolder(S);
        softIn(S.win.querySelector('.bw-pop'), 'scale(.94)');
        return true;
    }
    if (S.folder && !t.closest('.bw-pop')) {
        const id = S.folder;
        softOut(S.win.querySelector('.bw-pop'), () => { if (S.folder === id) { S.folder = null; paintFolder(S); } }, 'scale(.94)');
        return true;
    }
    return false;
}

// ── 폴더 밖으로 끌어 꺼내기 ──
// 폴더 창 안의 아이콘을 창 밖으로 끌고 나가면 폴더 창이 비켜서 뒤의 격자가 보인다(폴더 창이 격자를 거의 다 덮고 있어, 안 비키면 놓을 자리가 없다).
// 한번 나간 뒤에는 어디에 놓든 폴더에서 나온다: 격자의 아이콘 위에 놓으면 그 앞에, 빈 곳이면 폴더 바로 뒤에.
// 나가지 않고 폴더 창 안에 놓으면 제자리로 돌아간다(폴더 안 차례는 바꾸지 않는다)
let pull = null;
export function onPopDown(S, H, e) {
    if (!S.editing || e.button > 0) return;
    const app = e.target.closest('.bw-pop .bw-app');
    if (!app || e.target.closest('.bw-x')) return;
    swallowClick = false;
    pull = { S, H, app, key: app.dataset.key, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false, left: false, over: null, raf: 0 };
    document.addEventListener('pointermove', onPullMove);
    document.addEventListener('pointerup', onPullEnd);
    document.addEventListener('pointercancel', onPullEnd);
}
function onPullMove(e) {
    pull.x = e.clientX; pull.y = e.clientY;
    if (!pull.moved && Math.hypot(pull.x - pull.sx, pull.y - pull.sy) < 6) return;
    pull.moved = true;
    pull.app.classList.add('bw-drag');
    if (!pull.raf) pull.raf = requestAnimationFrame(pullFrame);
}
function outsidePop(p) {
    const r = p.app.closest('.bw-pop').getBoundingClientRect();
    return p.x < r.left || p.x > r.right || p.y < r.top || p.y > r.bottom;
}
function pullFrame() {
    if (!pull) return;
    pull.raf = 0;
    pull.app.style.transform = `translate3d(${pull.x - pull.sx}px, ${pull.y - pull.sy}px, 0)`;
    if (!pull.left && outsidePop(pull)) { pull.left = true; pull.S.win.classList.add('bw-pulling'); }
    const at = pull.left ? document.elementFromPoint(pull.x, pull.y)?.closest('.bw-app') : null;
    const over = at && pull.S.grid.contains(at) ? at : null;
    if (over === pull.over) return;
    pull.over?.classList.remove('bw-drop');
    over?.classList.add('bw-drop');
    pull.over = over;
}
function onPullEnd() {
    document.removeEventListener('pointermove', onPullMove);
    document.removeEventListener('pointerup', onPullEnd);
    document.removeEventListener('pointercancel', onPullEnd);
    const p = pull;
    pull = null;
    if (!p?.moved) return;
    cancelAnimationFrame(p.raf);
    swallowClick = true;
    requestAnimationFrame(() => { swallowClick = false; });
    p.S.win.classList.remove('bw-pulling');
    p.over?.classList.remove('bw-drop');
    if (p.left) return takeOut(p.S, p.H, p.key, p.over?.dataset.key);
    p.app.classList.remove('bw-drag');
    p.app.style.transform = '';
}

// ── 끌어서 차례 바꾸기 · 폴더에 넣기 ──
// 손가락으로도 바로 끌리게 꾸미기 중엔 아이콘에 touch-action: none. 끄는 동안은 transform 만 한 프레임에 한 번.
// 격자 끝 가까이 가면 격자를 굴려 줌(아이콘이 많아 창 밖에 있는 자리로도 옮길 수 있게)
const EDGE = 28, STEP = 8;
export function onGridDown(S, H, e) {
    if (!S.editing || e.button > 0) return;
    const app = e.target.closest('.bw-app');
    if (!app || e.target.closest('.bw-x') || !S.grid.contains(app)) return;
    swallowClick = false;
    drag = { S, H, app, key: app.dataset.key, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, top: S.grid.scrollTop, moved: false, over: null, merge: false, raf: 0 };
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
}
function onDragMove(e) {
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.moved && Math.hypot(drag.x - drag.sx, drag.y - drag.sy) < 6) return;
    drag.moved = true;
    drag.app.classList.add('bw-drag');
    if (!drag.raf) drag.raf = requestAnimationFrame(dragFrame);
}
function dragFrame() {
    if (!drag) return;
    drag.raf = 0;
    const grid = drag.S.grid, g = grid.getBoundingClientRect();
    if (drag.y < g.top + EDGE) grid.scrollTop -= STEP;
    else if (drag.y > g.bottom - EDGE) grid.scrollTop += STEP;
    const dy = drag.y - drag.sy + (grid.scrollTop - drag.top);
    drag.app.style.transform = `translate3d(${drag.x - drag.sx}px, ${dy}px, 0)`;
    const over = document.elementFromPoint(drag.x, drag.y)?.closest('.bw-app');
    const next = over && grid.contains(over) && over !== drag.app ? over : null;
    const merge = !!next && dwelled(drag, next);
    if (next !== drag.over || merge !== drag.merge) {
        drag.over?.classList.remove('bw-drop', 'bw-merge');
        next?.classList.add(merge ? 'bw-merge' : 'bw-drop');
        drag.over = next; drag.merge = merge;
    }
    const nearEdge = drag.y < g.top + EDGE || drag.y > g.bottom - EDGE;
    if (nearEdge) drag.raf = requestAnimationFrame(dragFrame);
}
// 아이콘 그림의 가운데(가로 · 세로 가운데 60%)에 겹쳐 놓으면 폴더로 묶는다. 가장자리에 놓으면 자리만 바꾼다.
// 폴더를 다른 것에 겹치는 것은 묶지 않는다(폴더 안에 폴더는 없다).
// 가운데에 잠깐 머물러야 묶인다: 자리를 바꾸려고 아이콘 위에 바로 놓는 일이 흔해, 머무는 시간 없이는 놓을 때마다 폴더가 생긴다
const MERGE_ZONE = 0.6, MERGE_WAIT = 450;
function mergesInto(d, over) {
    if (d.key.startsWith(FOLDER_PREFIX)) return false;
    if (over.dataset.folder) return true;
    const r = over.querySelector('.bw-ic')?.getBoundingClientRect();
    if (!r) return false;
    const mx = r.width * (1 - MERGE_ZONE) / 2, my = r.height * (1 - MERGE_ZONE) / 2;
    return d.x >= r.left + mx && d.x <= r.right - mx && d.y >= r.top + my && d.y <= r.bottom - my;
}
/** 두 아이콘을 새 폴더로 묶어 놓인 쪽 아이콘의 자리에 둔다 */
function mergeToFolder(S, target, key) {
    const o = S.o, id = crypto.randomUUID?.() || `f${Date.now().toString(36)}`;
    settleOrder(o, S.items);
    for (const f of o.folders) f.items = f.items.filter(k => k !== key && k !== target);
    o.folders.push({ id, name: '새 폴더', items: [target, key] });
    const at = o.order.indexOf(target);
    o.order.splice(at < 0 ? o.order.length : at, 0, folderToken(id));
}
/** 그 아이콘의 가운데에 MERGE_WAIT 넘게 머물렀나. 손가락이 멈춰 있으면 움직임 신호가 안 오므로, 시간이 차는 때에 한 번 더 본다 */
function dwelled(d, over) {
    const inside = mergesInto(d, over);
    if (!inside || d.dwellOn !== over) {
        clearTimeout(d.dwellTimer);
        d.dwellOn = inside ? over : null;
        d.dwellAt = performance.now();
        if (inside) d.dwellTimer = setTimeout(() => { if (drag === d && !d.raf) d.raf = requestAnimationFrame(dragFrame); }, MERGE_WAIT + 10);
        return false;
    }
    return performance.now() - d.dwellAt >= MERGE_WAIT;
}
function onDragEnd() {
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragEnd);
    const d = drag;
    drag = null;
    clearTimeout(d?.dwellTimer);
    if (!d?.moved) return;
    cancelAnimationFrame(d.raf);
    // 끌기를 놓은 자리에서 따라오는 클릭은 누름이 아님. 클릭이 안 따라오는 경우도 있어 다음 프레임엔 풂(안 풀면 그다음 진짜 누름을 삼켰음)
    swallowClick = true;
    requestAnimationFrame(() => { swallowClick = false; });
    drop(d);
}
function drop({ S, H, key, over, merge }) {
    const o = S.o;
    const isFolder = key.startsWith(FOLDER_PREFIX);
    if (merge && over && !over.dataset.folder) {
        mergeToFolder(S, over.dataset.key, key);
    } else if (over?.dataset.folder && !isFolder) {
        for (const f of o.folders) f.items = f.items.filter(k => k !== key);
        folderById(S, over.dataset.folder).items.push(key);
    } else {
        settleOrder(o, S.items);
        const shown = topLevel(o, S.items);
        const from = shown.indexOf(key), to = over ? shown.indexOf(over.dataset.key) : -1;
        // 뒤로 옮길 땐 놓은 아이콘 뒤에(아이폰처럼 그 자리를 차지)
        const before = to < 0 ? null : (from < to ? shown[to + 1] ?? null : shown[to]);
        moveBefore(o, key, before);
    }
    H.save();
    H.render();
}
