// breeze — 설정 창과 기능 불러오기. 기능 코드는 features/ 아래 파일마다 하나씩.
import { koMatch } from './lib/ko-match.js';
import { saveUserFile } from './lib/files.js';
import { FEATURES, GROUPS, BUNDLES, SERVER_FEATURES } from './features.js';
import { onThemeCss } from './lib/theme-css.js';

const KEY = 'breeze';
const BASE = new URL('.', import.meta.url).href;
const running = new Map();   // id → 불러온 모듈

function ctx() { return SillyTavern.getContext(); }

// 이름을 바꾸기 전(everyday-toolkit) 설정 · 브라우저 저장을 한 번 옮김 — 켜 둔 기능 · 세부 설정 · 읽던 자리가 그대로 남게
const OLD_KEY = 'everydayToolkit';
try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k?.startsWith('everyday-toolkit.')) continue;
        const nk = 'breeze.' + k.slice('everyday-toolkit.'.length);
        if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k));
        localStorage.removeItem(k);
    }
} catch { /* 저장소 막힘 */ }

function settings() {
    const ext = ctx().extensionSettings;
    if (ext[OLD_KEY] && !ext[KEY]) { ext[KEY] = ext[OLD_KEY]; delete ext[OLD_KEY]; ctx().saveSettingsDebounced(); }
    ext[KEY] ??= {};
    ext[KEY].enabled ??= {};
    ext[KEY].options ??= {};
    return ext[KEY];
}

// 실리태번은 설정을 통째로 저장해서, 옛 설정을 들고 열려 있던 다른 탭(다른 기기 포함)이 저장하면 여기서 바꾼 값이 사라졌음.
//   그래서 이 확장 설정을 작은 파일에도 남기고, 켤 때 파일 쪽이 더 최근이면 그걸 씀. 파일에 쓸 땐 그사이 다른 탭이 쓴 것과 합침.
const STORE = 'breeze-settings.json';
let storeBase = null, storeT = 0, storing = Promise.resolve();
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
function merge3(base, local, remote) {
    if (same(local, remote) || same(remote, base)) return local;
    if (same(local, base)) return remote;
    if (!isObj(local) || !isObj(remote)) return local;   // 둘 다 바꿨으면 이 탭 것
    const out = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
        const v = merge3(isObj(base) ? base[k] : undefined, local[k], remote[k]);
        if (v !== undefined) out[k] = v;
    }
    return out;
}
// 기능들이 설정 객체(options[id])를 붙들고 쓰므로 객체를 갈아 끼우지 않고 안을 고침
function applyInPlace(target, next) {
    for (const k of Object.keys(target)) if (!(k in next)) delete target[k];
    for (const [k, v] of Object.entries(next)) {
        if (isObj(target[k]) && isObj(v)) applyInPlace(target[k], v);
        else target[k] = clone(v);
    }
}
async function readStore() {
    const res = await fetch(`/user/files/${STORE}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    return isObj(body?.data) ? body.data : null;
}
async function writeStore() {
    const s = settings();
    const remote = await readStore();
    if (remote && storeBase && !same(remote, storeBase)) {
        const merged = merge3(storeBase, clone(s), remote);
        if (!same(merged, s)) applyInPlace(s, merged);
    }
    s.savedAt = Date.now();
    const data = clone(s);
    await saveUserFile(STORE, JSON.stringify({ data }));
    storeBase = data;
    ctx().saveSettingsDebounced();
}
async function loadStore() {
    const s = settings();
    const file = await readStore().catch(() => null);
    if (file && (file.savedAt || 0) > (s.savedAt || 0)) { applyInPlace(s, file); ctx().saveSettingsDebounced(); }
    storeBase = file ? clone(file) : null;
    if (!file || (s.savedAt || 0) > (file.savedAt || 0)) save();
}

function save() {
    ctx().saveSettingsDebounced();
    clearTimeout(storeT);
    storeT = setTimeout(() => { storing = storing.then(writeStore).catch(error => console.warn('[Breeze] 설정 파일 저장', error)); }, 800);
}

// 기능 파일에 넘기는 도구. 기능마다 자기 옵션 칸을 하나씩 가진다.
// 기능 상태 표시: 쉬는 중(다른 쪽이 같은 일을 함) · 일부 쉼 · 물러남(부딪침) · 오류.
// 기능은 api.rest('same' | 'part' | 'clash' | null, { saw, who, back })로 알림: saw = 무엇을 보고 알아챘는지, who = 누가({kind,name} 또는 그 Promise, lib/who.js), back = 언제 다시 맡는지
const STATE_PILL = { same: '쉬는 중', part: '일부 쉼', clash: '물러남', error: '오류' };
const STATE_HEAD = { same: '쉬는 중: 다른 쪽이 이미 같은 일을 하고 있어요', part: '일부 쉼: 겹치는 부분만 다른 쪽에 맡겼어요', clash: '물러남: 다른 쪽과 부딪쳐서 손을 뗐어요', error: '오류가 나서 멈췄어요. 껐다 켜거나 새로고침해 주세요.' };
const STATE_BACK = { same: '그쪽을 끄면 breeze가 다시 맡아요.', part: '그쪽을 끄면 새로고침 뒤에 breeze가 다시 맡아요.', clash: '그쪽을 끄고 새로고침하면 다시 해요.' };
const featureState = new Map();   // id → 'same' | 'part' | 'clash' | 'error'
const featureInfo = new Map();    // id → { saw, who, back }
function setState(id, st, info) {
    // 이미 찾아 둔 이름은 이어받음(같은 알림이 다시 올 때마다 '이름은 알 수 없어요'로 돌아갔다 다시 찾지 않게)
    const had = featureInfo.get(id);
    if (info?.whoLater && had?.whoAsked && had.who && had.who.kind !== 'unknown') info = { ...info, who: had.who, whoAsked: true };
    const same = (featureState.get(id) || null) === (st || null) && JSON.stringify(featureInfo.get(id) || null) === JSON.stringify(info || null);
    if (same && !(info?.who instanceof Promise)) return;
    if (st) featureState.set(id, st); else featureState.delete(id);
    if (st && info) featureInfo.set(id, { ...info }); else featureInfo.delete(id);
    if (info?.who instanceof Promise) {
        const keep = featureInfo.get(id);
        info.who.then(w => { if (featureInfo.get(id) === keep) { keep.who = w; paintState(id); } }).catch(() => { if (featureInfo.get(id) === keep) keep.who = null; });
        if (keep) keep.who = null;   // 찾는 동안은 '누가' 줄을 비워 둠
    }
    paintState(id);
}
const shownState = (id) => (settings().enabled[id] ? featureState.get(id) : null);
function whoText(w) {
    if (!w) return '';
    if (w.kind === 'ext') return `확장 '${w.name}'`;
    if (w.kind === 'theme') return w.name ? `지금 테마 '${w.name}'` : '지금 테마';
    if (w.kind === 'core') return '실리태번 자체';
    return '다른 확장이나 스크립트 (이름은 알 수 없어요)';
}
function pillHtml(id) { const st = shownState(id); return st ? `<span class="etk-pill etk-state-${st}">${STATE_PILL[st]}</span>` : ''; }
function stateHtml(id) {
    const st = shownState(id);
    if (!st) return '';
    const info = featureInfo.get(id) || {};
    // 이름을 찾는 데 품이 드는 경우(whoLater): 이유를 화면에 보여 줄 때 한 번만 찾아서, 찾으면 '누가' 줄을 고쳐 그림
    if (info.whoLater && !info.whoAsked && (!info.who || info.who.kind === 'unknown')) {
        info.whoAsked = true;
        Promise.resolve(info.whoLater()).then(w => { if (w && w.kind !== 'unknown' && featureInfo.get(id) === info) { info.who = w; paintState(id); } }).catch(() => { });
    }
    if (st === 'error') return `<div class="etk-card-state etk-state-error"><b>${esc(STATE_HEAD.error)}</b></div>`;
    const lines = [whoText(info.who) && `누가: ${esc(whoText(info.who))}`, info.saw && `본 것: ${esc(info.saw)}`, esc(info.back || STATE_BACK[st])].filter(Boolean);
    return `<div class="etk-card-state etk-state-${st}"><b>${esc(STATE_HEAD[st])}</b>${lines.map(l => `<div>${l}</div>`).join('')}</div>`;
}
function paintState(id) {
    const root = dialog();
    if (!root) return;
    // 줄은 통째로 다시 그림: 상태가 생기거나 없어지면 표시뿐 아니라 '눌러서 이유 보기'(자세히 ›)도 같이 바뀜. 묶음에 든 기능이면 묶음 줄도
    const me = FEATURES.find(x => x.id === id);
    if (me) for (const row of root.querySelectorAll(`.etk-row[data-id="${id}"]`)) row.outerHTML = rowHtml(me, row.classList.contains('etk-row-sub'));
    if (me?.bundle) for (const row of root.querySelectorAll('.etk-row[data-bundle]')) if (row.dataset.bundle === me.bundle) row.outerHTML = bundleRowHtml(me.bundle, row.classList.contains('etk-opened'));
    for (const box of root.querySelectorAll(`.etk-detail[data-id="${id}"]`)) {
        box.querySelector(':scope > .etk-card-state')?.remove();
        (box.querySelector(':scope > .etk-detail-desc') || box.querySelector(':scope > .etk-detail-on'))?.insertAdjacentHTML('afterend', stateHtml(id));
    }
}
// breeze 기능 파일에서 난 오류는 그 기능 칸에 표시(어느 기능인지는 오류가 난 파일 이름으로)
const errorOwner = (err) => { const st = String(err?.stack || ''); const i = st.indexOf(`${BASE}features/`); return i < 0 ? undefined : st.slice(i + BASE.length).match(/^features\/(\w+)\.js/)?.[1]; };
window.addEventListener('error', (e) => { const id = errorOwner(e.error); if (id && running.has(id)) setState(id, 'error'); });
window.addEventListener('unhandledrejection', (e) => { const id = errorOwner(e.reason); if (id && running.has(id)) setState(id, 'error'); });

function makeApi(id) {
    return {
        ctx,
        options() { const s = settings(); s.options[id] ??= {}; return s.options[id]; },
        save,
        rest(kind, info) { if (featureState.get(id) !== 'error') setState(id, kind || null, kind ? info : null); },
    };
}

async function startFeature(id) {
    if (running.has(id)) return;
    let mod;
    try {
        mod = await import(`${BASE}features/${id}.js`);
    } catch (e) {
        console.error(`[Breeze] ${id} 불러오기 실패`, e);
        setState(id, 'error');   // 파일을 못 읽어도(실리태번 판이 달라 가져올 것이 없음) 켜진 것처럼 보이지 않게
        return;
    }
    running.set(id, mod);
    try { await mod.start?.(makeApi(id)); } catch (e) { console.error(`[Breeze] ${id} 시작 실패`, e); setState(id, 'error'); }
}

async function stopFeature(id) {
    const mod = running.get(id);
    if (!mod) return true;
    if (typeof mod.stop !== 'function') return false;   // 새로고침해야 꺼짐
    let left = false;   // 실리태번 공용 함수에 끼운 것을 못 뺌(우리 뒤에 다른 확장이 또 끼움) → 새로고침해야 완전히 꺼짐
    try { left = (await mod.stop()) === false; } catch (e) { console.error(`[Breeze] ${id} 끄기 실패`, e); }
    running.delete(id);
    featureState.delete(id); featureInfo.delete(id);   // 끄면 쉬는 중 · 오류 표시도 지움(다시 켜면 새로 판단)
    if (left) return false;
    return true;
}

// ───────── 설정 창 ─────────
// 확장 설정 목록에는 ‘설정 열기’ 한 줄만 두고, 설정은 따로 뜨는 작은 창에서 한다: 위에 갈래 버튼 다섯, 그 아래 고른 갈래의 기능만 한 줄씩.
// 묶음 줄은 그 자리에서 펼쳐 안의 기능을 하나씩 켜고 끔. 세부 설정은 같은 창 안에서 넘어가 보고 ← 로 돌아옴(PC 는 오른쪽 칸).
// 뒤를 가리지 않는 창(PC 는 위 줄을 끌어 옮김 · 자리 기억, 휴대폰은 아래에서 올라오고 손잡이로 높이 조절). 바깥을 눌러도 닫히지 않음(다른 일을 하다 닫히지 않게)
const LOGO = '';
const SERVER_TAB = '서버 플러그인';
// 목록 줄 전부: breeze 기능 + 서버 플러그인 기능(features.js 순서 그대로)
const ALL = [...FEATURES, ...SERVER_FEATURES];
const isServer = (f) => !!f?.server;
const serverOn = (v) => v !== 'off' && !String(v).startsWith('off (');
// 마지막으로 본 화면(목록 · 기능) · 고른 갈래 · 목록 스크롤 · 창 자리(PC) · 창 높이(휴대폰, 화면 높이에 대한 비율)는 브라우저에 기억
const UI_KEY = 'breeze.ui';
const uiSaved = (() => { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { return {}; } })();
const ui = {
    view: typeof uiSaved.view === 'string' ? uiSaved.view : null,
    tab: GROUPS.some(g => g.name === uiSaved.tab) ? uiSaved.tab : GROUPS[0].name,
    open: new Set(),   // 펼친 묶음(창을 닫았다 열면 접힘)
    query: '', quickOpen: new Set(uiSaved.quickOpen || []), scroll: uiSaved.scroll || 0, pos: uiSaved.pos || null, sheet: uiSaved.sheet || null, size: uiSaved.size || null,
    split: uiSaved.split > 0 && uiSaved.split < 1 ? uiSaved.split : null,   // 두 칸일 때 왼쪽 칸 폭(창 안쪽 폭에 대한 비율). null = 기본
};
const rememberUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify({ view: ui.view, tab: ui.tab, quickOpen: [...ui.quickOpen], scroll: ui.scroll, pos: ui.pos, sheet: ui.sheet, size: ui.size, split: ui.split })); } catch { /* 저장소 막힘 */ } };
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dialog = () => document.getElementById('etk_dialog');
// 드롭다운에 꺼내 둔 기능(자주 켜고 끄는 것)
const quick = () => (settings().quick ??= []);
const onCount = () => FEATURES.filter(f => settings().enabled[f.id]).length;

// ── 입력창 옆 마법봉 메뉴(#extensionsMenu)에 두는 줄
// 설정 wandMenu = 줄을 둘 것의 id 목록: 'breeze' 는 설정 창을, 기능 id 는 그 기능의 세부 설정을 엶. 칸이 없으면(옛 설정) 줄도 없음. 꺼진 기능은 줄을 두지 않음
const WAND_SELF = 'breeze';
// 그 메뉴에 자기 줄을 스스로 넣는 기능: 같은 기능에 줄이 둘 생기지 않게 여기서는 줄도 버튼도 두지 않음
const OWN_WAND_ROW = new Set(['theme_fit']);
// 줄을 둘 수 있는 기능: 쓰다가 자주 여는 화면이 있는 것만. 한 번 정하면 다시 안 여는 설정에까지 체크칸이 붙어 있으니 쓸데없는 곳에 다 있다는 지적을 받았다(나머지는 breeze 줄로 설정 창을 열어서 간다)
const WAND_FEATURES = new Set(['translator', 'done_sound', 'prompt_groups', 'chat_memory']);
const canWand = (f) => WAND_FEATURES.has(f.id) && !!f.hasOptions && !isServer(f) && !OWN_WAND_ROW.has(f.id);
const inWand = (id) => !!settings().wandMenu?.includes(id);
function wandRows() {
    const s = settings(), list = s.wandMenu || [];
    const self = list.includes(WAND_SELF) ? [{ id: WAND_SELF, icon: 'wind', name: 'breeze' }] : [];
    return self.concat(FEATURES.filter(f => canWand(f) && s.enabled[f.id] && list.includes(f.id)));
}
// 마법봉 줄을 눌렀을 때: 기능이 자기 화면을 따로 가졌으면(openFromWand) 그것을, 아니면 breeze 창의 그 기능 세부 설정을 연다
async function openFromWand(id) {
    try {
        const mod = await import(`${BASE}features/${id}.js`);
        if (typeof mod.openFromWand === 'function' && await mod.openFromWand() !== false) return;
    } catch (e) { console.warn('[Breeze] 마법봉 줄', id, e); }
    openOptions(id);
}
function wandRowEl(r) {
    const el = document.createElement('div');
    el.className = 'list-group-item flex-container flexGap5 interactable etk-wand-row';
    el.dataset.wand = r.id;
    el.tabIndex = 0;
    el.innerHTML = `<div class="fa-solid fa-${esc(r.icon)} extensionsMenuExtensionButton"></div>${esc(r.name)}`;
    el.addEventListener('click', () => { globalThis.jQuery?.('#extensionsMenu').hide(); r.id === WAND_SELF ? openDialog() : openFromWand(r.id); });
    return el;
}
// 메뉴의 우리 줄을 설정과 같게 맞춤: 이미 같으면 아무것도 안 건드림(그래서 아래 감시가 우리가 넣은 것에 다시 불려도 거기서 멈춤)
// 줄이 하나라도 있을 때만 그 메뉴 한 곳의 자식 목록을 지켜봄: 다른 쪽이 메뉴를 비우거나 다시 그려 줄이 사라지면 다시 넣음
let wandWatch = null;
function syncWand() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    const want = wandRows(), have = [...menu.querySelectorAll('.etk-wand-row')];
    if (have.length !== want.length || want.some((r, i) => have[i].dataset.wand !== r.id)) {
        for (const el of have) el.remove();
        menu.append(...want.map(wandRowEl));
    }
    if (want.length && !wandWatch) { wandWatch = new MutationObserver(syncWand); wandWatch.observe(menu, { childList: true }); }
    if (!want.length && wandWatch) { wandWatch.disconnect(); wandWatch = null; }
}
function toggleWand(id) {
    const list = (settings().wandMenu ??= []), at = list.indexOf(id);
    if (at < 0) list.push(id); else list.splice(at, 1);
    save();
    syncWand();
    // 같은 체크가 설정 창과 확장 목록 칸 두 곳에 떠 있을 수 있어 둘 다 맞춤
    for (const el of document.querySelectorAll(`[data-wand-check="${id}"]`)) el.checked = at < 0;
}
// 기능의 세부 설정 본문에 끼우는 체크 줄: '확장 창에도 보이기' 체크와 그 설명 바로 아래, 그 체크가 없는 기능은 본문 맨 위. 모양도 그 줄과 같게
// 본문을 통째로 다시 그리는 기능이 있어서, 열려 있는 그 본문 하나의 자식 목록만 지켜보다 줄이 사라지면 다시 끼움
const wandCheckWatched = new WeakSet();
function addWandCheck(box, id) {
    const f = FEATURES.find(x => x.id === id);
    if (!f || !canWand(f)) return;
    placeWandCheck(box, f);
    if (wandCheckWatched.has(box)) return;
    wandCheckWatched.add(box);
    new MutationObserver(() => { if (!box.querySelector(':scope > .etk-wand-check')) placeWandCheck(box, f); }).observe(box, { childList: true });
}
function placeWandCheck(box, f) {
    const id = f.id;
    box.querySelectorAll(':scope > .etk-wand-check').forEach(el => el.remove());
    const label = document.createElement('label'), note = document.createElement('small');
    label.className = 'checkbox_label etk-wand-check';
    label.innerHTML = `<input type="checkbox" data-wand-check="${esc(id)}"${inWand(id) ? ' checked' : ''}><span>마법봉 메뉴에도 보이기</span>`;
    note.className = 'etk-wand-check';
    note.textContent = `켜면 마법봉 메뉴에도 ‘${f.name}’ 줄이 생겨요.`;
    label.firstElementChild.addEventListener('change', () => toggleWand(id));
    const above = box.querySelector(':scope > label:has([data-k="separate"])');
    const after = above?.nextElementSibling?.tagName === 'SMALL' ? above.nextElementSibling : above;
    if (after) after.after(label, note); else box.prepend(label, note);
}
function openOptions(id) {
    const f = FEATURES.find(x => x.id === id);
    if (!f) return;
    ui.tab = f.group; ui.query = '';
    if (f.bundle) ui.open.add(f.bundle);
    ui.view = hasMore(f) ? id : null;
    if (dialog()) renderDialog(); else openDialog();
}
// 세부 설정이 없는 기능도 쉬는 중 · 일부 쉼 · 물러남 · 오류면 눌러서 그 이유를 볼 수 있게(이유는 세부 설정 화면에만 나옴)
const stateOf = (f) => shownState(f.id) || null;
const hasMore = (f) => (isServer(f) ? !!f.hasOptions && serverOf(f).have : !!(f.hasOptions || f.hasAction || stateOf(f)));
const sheet = () => matchMedia('(max-width: 700px)').matches;
// PC(아래에서 올라오는 창이 아니고, 넓힐 자리가 있을 때): 세부 설정 · 서버 화면을 열면 창을 넓혀 왼쪽 목록 · 오른쪽 칸 두 칸으로
const NARROW_W = 460, WIDE_W = 900;
const twoPane = () => !sheet() && innerWidth - 16 >= 760;
const wide = () => twoPane() && !!ui.view;
const viewOf = (id) => ALL.find(x => x.id === id) || null;

// ── 서버 플러그인 상태: 한 번 물어 두고 줄 · … 버튼 · 서버 화면이 같이 씀. undefined = 아직 모름, null = 플러그인 없음
let serverData;
let serverAsking = null;
let serverNew = false;
function askServer(force = false) {
    if (serverAsking && !force) return serverAsking;
    serverAsking = fetch('/api/plugins/breeze-server/status', { headers: ctx().getRequestHeaders() })
        .then(res => (res.ok ? res.json() : null)).catch(() => null)
        .then((d) => { setServer(d?.features ? d : null); return serverData; });
    return serverAsking;
}
// 다시 켜야 적용되는 게 있는지(바꿔 둔 새 판 · 켜고 끈 서버 기능)와 새 판이 있는지
function serverNews(d) {
    const f = d?.features;
    if (!f) return { restart: false, newer: false };
    const flipped = Object.entries(d.wanted || {}).some(([k, want]) => k in f && (want !== false) !== serverOn(f[k]));
    return { restart: pv(d.updated || 0) > pv(d.plugin || 0) || flipped, newer: newPlugin(d) };
}
function setServer(d) {
    serverData = d;
    const { restart, newer } = serverNews(d);
    serverNew = restart || newer;
    const root = dialog();
    if (!root) return;
    root.querySelector('.etk-more')?.classList.toggle('etk-has-new', serverNew);
    // 줄에 보이는 서버 기능(켜짐 · 없음 · 다시 켜면)을 새 상태로
    if (root.querySelector('.etk-row[data-id^="srv:"], .etk-row[data-bundle]')) rerenderList();
}
// 서버 기능 줄 하나의 상태: have = 이 서버에 그 기능이 있음, can = 켜고 끌 수 있는 판, pending = 서버를 다시 켜야 바뀜
function serverOf(f) {
    if (serverData === undefined) return { ready: false };
    const feats = serverData?.features;
    const names = feats ? f.server.filter(k => k in feats) : [];
    if (!names.length) return { ready: true, have: false };
    const wanted = serverData.wanted;
    const wants = names.map(k => (wanted ? wanted[k] !== false : serverOn(feats[k])));
    const on = wants.some(Boolean);
    return { ready: true, have: true, on, can: !!wanted, names, pending: !!wanted && names.some((k, i) => wants[i] !== serverOn(feats[k])) };
}
const isOn = (f) => (isServer(f) ? !!serverOf(f).on : !!settings().enabled[f.id]);
const usable = (f) => !isServer(f) || !!serverOf(f).can;
// 서버 기능 켜고 끄기: 서버 화면이 하던 그대로 기능 하나씩 POST(서버 주소는 기능 하나씩 받음). 바뀐 건 서버를 다시 켜야 적용
async function setServerNames(names, on) {
    try {
        for (const name of names) {
            const res = await fetch('/api/plugins/breeze-server/features', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ name, on }) });
            if (!res.ok) throw new Error(String(res.status));
        }
    } catch (e) { console.warn('[Breeze] 서버 기능 켜고 끄기', e); toastr.error('서버 플러그인 설정을 바꾸지 못했어요.', 'breeze'); }
    await askServer(true);
}

// 새로 생긴 기능 N: features.js 의 added(그 기능이 들어온 판)가 기준 판보다 높고 아직 안 열어 본 것. 그 줄 · 묶음 줄 · 갈래 버튼에 표시, 세부 화면을 열거나 켜고 끄면 사라짐.
// 기준 판(newBase)은 처음 한 번 정함: 이미 쓰던 사람은 마지막으로 본 내역 판(seenLog), 처음 설치한 사람은 지금 있는 기능 중 가장 새 판(설치할 때 있던 기능은 NEW 아님)
const verNum = (v) => String(v || '').split('.').slice(0, 3).reduce((a, n) => a * 1000 + (Number(n) || 0), 0);
function newBase() {
    const s = settings();
    if (s.newBase == null) {
        const used = Object.keys(s.enabled).length > 0 || !!s.seenLog;
        s.newBase = used ? (s.seenLog || '1.1.0') : FEATURES.reduce((m, f) => (verNum(f.added) > verNum(m) ? f.added : m), '0');
        save();
    }
    return s.newBase;
}
const isNewFeature = (f) => !!f.added && verNum(f.added) > verNum(newBase()) && !(settings().seenNew || []).includes(f.id);
function markSeen(id) {
    const f = FEATURES.find(x => x.id === id);
    if (!f || !isNewFeature(f)) return;
    (settings().seenNew ??= []).push(id);
    save();
}
const newBadge = (on) => (on ? '<span class="etk-new-badge" title="새 기능">N</span>' : '');
const iconHtml = (name) => `<i class="fa-solid fa-${esc(name)} etk-row-icon" aria-hidden="true"></i>`;
// 오른쪽 작은 동그라미 체크: 보이는 건 18px, 누르는 곳은 둘레 칸 전체(40px 넘게). 안의 체크칸은 투명하게 덮어 눌림을 받음
const tickHtml = (on, label, disabled) => `<label class="etk-tick"><input type="checkbox" class="etk-check"${on ? ' checked' : ''}${disabled ? ' disabled' : ''} aria-label="${esc(label)}"><span class="etk-tick-mark" aria-hidden="true"></span></label>`;
const moreHtml = (text, icon) => `<span class="etk-row-more">${esc(text)}<i class="fa-solid fa-chevron-${icon}"></i></span>`;

// 목록 한 줄: 아이콘 · 이름 · 설명 한 줄 · (세부 설정이 있으면) '설정 ›' · 체크
function rowDesc(f) {
    if (!isServer(f)) return f.desc;
    const st = serverOf(f);
    if (!st.ready) return '서버 플러그인을 확인하고 있어요';
    if (!st.have) return '서버 플러그인을 넣으면 쓸 수 있어요';
    return st.pending ? `서버를 다시 켜면 ${st.on ? '켜져요' : '꺼져요'}` : f.desc;
}
function rowHtml(f, sub = false) {
    const on = isOn(f), missing = isServer(f) && serverOf(f).ready && !serverOf(f).have;
    const cls = ['etk-row', on ? '' : 'etk-row-off', sub ? 'etk-row-sub' : '', missing ? 'etk-row-missing' : '', wide() && ui.view === f.id ? 'etk-row-current' : ''].filter(Boolean).join(' ');
    const tail = hasMore(f) ? moreHtml(f.hasOptions || f.hasAction ? '설정' : '자세히', 'right') : '';
    return `<div class="${cls}" data-id="${esc(f.id)}" tabindex="0">${iconHtml(f.icon)}
        <div class="etk-row-text"><div class="etk-row-name">${esc(f.name)}${newBadge(isNewFeature(f))}</div><div class="etk-row-desc">${esc(rowDesc(f))}</div></div>
        ${pillHtml(f.id)}${tail}${tickHtml(on, f.name, !usable(f))}</div>`;
}
const bundleMembers = (name) => ALL.filter(x => x.bundle === name);
// 묶음이 켜짐 = 켜고 끌 수 있는 안쪽 기능이 전부 켜짐
const bundleOn = (members) => { const can = members.filter(usable); return can.length > 0 && can.every(isOn); };
function bundleRowHtml(name, open) {
    const b = BUNDLES[name], members = bundleMembers(name), on = bundleOn(members), part = !on && members.some(isOn);
    return `<div class="etk-row etk-bundle${on ? '' : ' etk-row-off'}${open ? ' etk-opened' : ''}" data-bundle="${esc(name)}" tabindex="0" aria-expanded="${open}">${iconHtml(b.icon)}
        <div class="etk-row-text"><div class="etk-row-name">${esc(name)}${newBadge(members.some(isNewFeature))}${part ? '<small class="etk-row-part">일부만 켜짐</small>' : ''}</div><div class="etk-row-desc">${esc(b.desc)}</div></div>
        ${members.map(m => pillHtml(m.id)).find(Boolean) || ''}${moreHtml(`${members.length}개`, open ? 'up' : 'down')}${tickHtml(on, name, !members.some(usable))}</div>`;
}
// 묶음 덩어리: 묶음 줄 + (펼쳤으면) 안쪽 줄. shown = 찾는 중에 맞은 안쪽 기능만 보일 때
function bundleHtml(name, open, shown) {
    const inner = open ? `<div class="etk-inner">${(shown || bundleMembers(name)).map(m => rowHtml(m, true)).join('')}</div>` : '';
    return `<div class="etk-unit" data-unit="${esc(name)}">${bundleRowHtml(name, open)}${inner}</div>`;
}
// 한 갈래의 줄들(묶음은 첫 기능 자리에). 찾는 중이면 맞는 것만, 안쪽 기능만 맞은 묶음은 펼쳐서 그것만
const hit = (text, q) => koMatch(text, q);
function unitsHtml(list, q) {
    const out = [], seen = new Set();
    for (const f of list) {
        if (!f.bundle) { if (!q || hit(`${f.name} ${f.desc} ${f.alias || ''}`, q)) out.push(rowHtml(f)); continue; }
        if (seen.has(f.bundle)) continue;
        seen.add(f.bundle);
        const b = BUNDLES[f.bundle];
        if (!q || hit(`${f.bundle} ${b.desc} ${b.alias || ''}`, q)) { out.push(bundleHtml(f.bundle, ui.open.has(f.bundle))); continue; }
        const found = bundleMembers(f.bundle).filter(m => hit(`${m.name} ${m.desc} ${m.alias || ''}`, q));
        if (found.length) out.push(bundleHtml(f.bundle, true, found));
    }
    return out.join('');
}
// 찾는 중이 아니면 고른 갈래만, 찾는 중이면 갈래와 상관없이 전부에서(갈래 이름을 머리로)
function listHtml() {
    const q = ui.query.trim();
    if (!q) return unitsHtml(ALL.filter(f => f.group === ui.tab), '');
    const parts = GROUPS.map((g) => {
        const html = unitsHtml(ALL.filter(f => f.group === g.name), q);
        return html && `<div class="etk-find-group">${iconHtml(g.icon)}${esc(g.name)}</div>${html}`;
    }).join('');
    return parts || '<div class="etk-empty">맞는 기능이 없어요</div>';
}
function tabsHtml() {
    const q = ui.query.trim();
    return GROUPS.map(g => `<div class="etk-tab interactable${!q && g.name === ui.tab ? ' etk-on' : ''}" role="tab" tabindex="0" data-tab="${esc(g.name)}" aria-selected="${!q && g.name === ui.tab}">
        ${iconHtml(g.icon)}<span>${esc(g.name)}${newBadge(ALL.some(f => f.group === g.name && isNewFeature(f)))}</span></div>`).join('');
}
function renderList(body) {
    const paused = settings().paused;
    const note = paused?.length ? `<div class="etk-paused-note">breeze 기능 ${paused.length}개를 잠시 꺼 뒀어요. 서버 플러그인 기능은 새로고침해야 꺼져요.</div>` : '';
    // 안쪽 칸: 두 단은 높이가 정해지지 않은 칸에서만 위아래로 고르게 나뉨(굴리는 칸에 바로 걸면 옆으로 단이 계속 생겼음)
    body.innerHTML = `${note}<div class="etk-list-cols">${listHtml()}</div>`;
    dialog().querySelector('.etk-tabs').innerHTML = tabsHtml();
}
// 목록이 그려진 칸(두 칸이면 왼쪽, 한 칸이면 목록 화면일 때만)
function listBox() {
    const root = dialog();
    if (!root) return null;
    return root.querySelector('.etk-pane-list') || (!ui.view ? root.querySelector('.etk-main') : null);
}
// 목록만 다시 그림(창 머리 · 오른쪽 칸은 그대로), 보던 자리 유지
function rerenderList() {
    const box = listBox();
    if (!box) return;
    const top = box.scrollTop;
    renderList(box);
    box.scrollTop = top;
}
function pickTab(name) {
    ui.tab = name; ui.query = ''; ui.scroll = 0;
    const input = dialog()?.querySelector('.etk-search input');
    if (input) input.value = '';
    const box = listBox();
    if (box) { renderList(box); box.scrollTop = 0; }
    rememberUi();
}
function toggleBundle(name) {
    if (ui.open.has(name)) ui.open.delete(name);
    else { ui.open.add(name); for (const m of bundleMembers(name)) markSeen(m.id); }
    rerenderList();
}
// 서버 화면의 줄에서: 그 기능이 있는 갈래로(묶음이면 펼쳐서)
function jumpTo(group, bundle) {
    ui.tab = group; ui.query = ''; ui.scroll = 0;
    if (bundle) ui.open.add(bundle);
    go(null);
}

function renderDetail(body, f) {
    if (isServer(f)) return renderServerDetail(body, f);
    const on = !!settings().enabled[f.id];
    body.innerHTML = `<div class="etk-detail" data-id="${f.id}">
        <label class="etk-detail-on"><input type="checkbox" class="etk-check" ${on ? 'checked' : ''} aria-label="${esc(f.name)}"><span>${on ? '켜짐' : '꺼짐'}</span></label>
        ${f.desc ? `<div class="etk-detail-desc">${esc(f.desc)}</div>` : ''}${stateHtml(f.id)}
        ${f.hasOptions ? (on ? `<div class="etk-options" data-options="${f.id}" data-title="${esc(f.name)}"></div>` : '<div class="etk-empty-line">켜면 세부 설정을 바꿀 수 있어요</div>') : ''}
    </div>`;
    if (on && f.hasOptions) renderOptions(f.id);
}
// 서버 기능의 세부 설정(지금은 브라우저 탭 그림만): 켜고 끄기 + 그림 고르기 칸. 그림은 서버 쪽 기능이 켜져 돌 때만 바꿀 수 있음
function renderServerDetail(body, f) {
    const st = serverOf(f), on = !!st.on, running = serverData?.features?.tab_icon === 'on';
    const tools = f.id !== 'srv:tab_icon' ? '' : running ? tabIconHtml() : '<div class="etk-empty-line">켜고 실리태번 서버를 다시 켜면 그림을 고를 수 있어요</div>';
    body.innerHTML = `<div class="etk-detail" data-id="${esc(f.id)}">
        <label class="etk-detail-on"><input type="checkbox" class="etk-check" ${on ? 'checked' : ''}${st.can ? '' : ' disabled'} aria-label="${esc(f.name)}"><span>${on ? '켜짐' : '꺼짐'}</span></label>
        <div class="etk-detail-desc">${esc(f.desc)}</div>${st.pending ? `<div class="etk-detail-desc etk-server-pending">서버를 다시 켜면 ${on ? '켜져요' : '꺼져요'}</div>` : ''}${tools}
    </div>`;
    wireTabIcon(body);
}

// … 버튼 목록: 전부 잠시 끄기(또는 다시 켜기) · 모두 켜기 · 서버 플러그인 · 업데이트 내역
function serverMenuNote() {
    if (serverData === undefined) return '';
    if (!serverData) return '설치하는 법';
    const { restart, newer } = serverNews(serverData);
    if (restart) return '서버를 다시 켜야 바뀐 게 적용돼요';
    if (newer) return '새 버전이 있어요';
    return serverData.paused ? '잠시 꺼 뒀어요' : '작동 중';
}
function menuHtml() {
    const paused = settings().paused?.length;
    const items = [
        paused ? { act: 'pause', icon: 'play', name: '다시 켜기' } : { act: 'pause', icon: 'pause', name: '전부 잠시 끄기', note: '문제가 breeze 때문인지 볼 때' },
        !paused && onCount() < FEATURES.length && { act: 'all-on', icon: 'check-double', name: '모두 켜기' },
        { act: 'server', icon: 'server', name: '서버 플러그인', note: serverMenuNote(), isNew: serverNew },
        { act: 'log', icon: 'clock-rotate-left', name: '업데이트 내역' },
    ].filter(Boolean);
    return items.map(x => `<div class="etk-menu-item interactable" role="menuitem" tabindex="0" data-act="${x.act}"><i class="fa-solid fa-${x.icon}"></i>
        <span class="etk-menu-text"><span>${esc(x.name)}${newBadge(x.isNew)}</span>${x.note ? `<small>${esc(x.note)}</small>` : ''}</span></div>`).join('');
}
function toggleMenu() {
    const menu = dialog()?.querySelector('.etk-menu');
    if (!menu) return;
    if (!menu.hidden) return closeMenu();
    menu.innerHTML = menuHtml();
    menu.style.top = `${dialog().querySelector('.etk-top').offsetHeight - 4}px`;
    menu.hidden = false;
}
function closeMenu() {
    const menu = dialog()?.querySelector('.etk-menu');
    if (menu) menu.hidden = true;
}
async function menuAction(act) {
    closeMenu();
    if (act === 'pause') return togglePause();
    if (act === 'all-on') { for (const f of FEATURES) if (!settings().enabled[f.id]) await setEnabled(f.id, true); return renderDialog(); }
    if (act === 'server') return go(SERVER_TAB);
    if (act === 'log') return showChangelog();
}

function renderDialog({ keepList = false } = {}) {
    const root = dialog();
    if (!root) return;
    takeListScroll();
    if (ui.view && ui.view !== SERVER_TAB && !viewOf(ui.view)) ui.view = null;
    const f = viewOf(ui.view), main = root.querySelector('.etk-main');
    const two = wide();
    root.classList.toggle('etk-in-detail', !!ui.view && !two);
    root.classList.toggle('etk-two', two);
    placeWindow();
    const input = root.querySelector('.etk-search input');
    if (input.value !== ui.query) input.value = ui.query;
    // 두 칸: 왼쪽 목록(보던 자리 그대로) · 오른쪽 세부 설정(맨 위에 이름 · 도구 · 닫기)
    let body = main, list = null;
    if (two) {
        if (!main.querySelector(':scope > .etk-pane-list')) main.innerHTML = '<div class="etk-pane-list"></div><div class="etk-split"></div><div class="etk-pane-detail"><div class="etk-pane-head"><b class="etk-pane-title"></b><div class="etk-top-tools"></div><div class="etk-pane-close fa-solid fa-xmark interactable" tabindex="0" title="오른쪽 칸 닫기"></div></div><div class="etk-pane-body"></div></div>';
        list = main.querySelector('.etk-pane-list'); body = main.querySelector('.etk-pane-body');
        applySplit(main);
        main.querySelector('.etk-pane-title').textContent = ui.view === SERVER_TAB ? SERVER_TAB : f?.name || '';
    } else if (main.querySelector(':scope > .etk-pane-list')) main.innerHTML = '';
    root.querySelector('.etk-title').textContent = ui.view === SERVER_TAB ? SERVER_TAB : f?.name || '';
    root.querySelector('.etk-top > .etk-top-tools').innerHTML = '';
    const tools = (two ? main : root).querySelector(two ? '.etk-pane-head .etk-top-tools' : '.etk-top > .etk-top-tools');
    tools.innerHTML = f && !isServer(f) ? `${f.hasAction ? `<div class="menu_button etk-run"${settings().enabled[f.id] ? '' : ' disabled'} title="${settings().enabled[f.id] ? '지금 실행' : '켜면 실행 가능'}"><i class="fa-solid fa-play"></i>실행</div>` : ''}<div class="etk-tool etk-star fa-star ${quick().includes(f.id) ? 'fa-solid etk-on' : 'fa-regular'}" tabindex="0" title="확장 설정 목록의 breeze 칸에 꺼내 두기"></div>` : '';
    root.querySelector('.etk-more').classList.toggle('etk-has-new', serverNew);
    // 두 칸에서 다른 기능만 고른 거면 왼쪽 목록은 다시 그리지 않고 고른 줄 표시만 옮김(목록을 통째로 다시 그려 바꿀 때마다 더 걸렸음)
    if (list && keepList && list.firstElementChild) list.querySelectorAll('.etk-row').forEach(r => r.classList.toggle('etk-row-current', r.dataset.id === ui.view));
    else if (list) { renderList(list); list.scrollTop = ui.scroll; }
    if (!ui.view) { renderList(body); body.scrollTop = ui.scroll; }
    else if (ui.view === SERVER_TAB) {
        const fresh = body.cloneNode(false);
        fresh.innerHTML = '<div class="etk-server">확인하고 있어요</div>';
        body.replaceWith(fresh);
        showServerStatus();
    } else {
        // 굴림 자리를 0 으로 쓰면 그 자리에서 화면 전체 계산을 한 번 치러서(12~19ms), 새 칸으로 바꿔 끼움(새 칸은 처음부터 맨 위)
        const fresh = body.cloneNode(false); body.replaceWith(fresh); renderDetail(fresh, f);
    }
    rememberUi();
}
let listScrolled = null;
function takeListScroll() { if (listScrolled) { if (listScrolled.isConnected) ui.scroll = listScrolled.scrollTop; listScrolled = null; } }
function go(view) {
    if (view) markSeen(view);
    const body = dialog()?.querySelector('.etk-main');
    if (!ui.view && body) ui.scroll = body.scrollTop;   // 목록에서 떠날 때 보던 자리(두 칸일 땐 왼쪽 목록을 굴릴 때마다 적어 둠)
    const keep = wide() && !!view;   // 두 칸 그대로 오른쪽만 바뀜
    ui.view = view;
    renderDialog({ keepList: keep && wide() });
}

// 서버 플러그인도 잠시 끄기 · 다시 켜기. 플러그인이 없거나 이 주소를 모르는 옛 판이면 false(안내하지 않음)
async function pauseServer(on) {
    try {
        const res = await fetch('/api/plugins/breeze-server/pause', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ on }) });
        if (!res.ok) return false;
        const d = await res.json();
        setServer(d?.features ? d : serverData);
        return true;
    } catch { return false; }
}

async function togglePause() {
    const s = settings();
    if (s.paused?.length) {
        const ids = s.paused;
        delete s.paused; save();
        for (const id of ids) await setEnabled(id, true);
        if (await pauseServer(false)) toastr.info('서버 플러그인 기능은 새로고침하면 다시 켜져요. 나머지는 바로 켜졌어요.', 'breeze');
    } else {
        const ids = FEATURES.filter(f => s.enabled[f.id]).map(f => f.id);
        if (!ids.length) return;
        s.paused = ids; save();
        let reload = 0;
        for (const id of ids) if (!(await setEnabled(id, false))) reload++;
        const server = await pauseServer(true);
        if (reload || server) toastr.info([server ? '서버 플러그인 기능은 새로고침해야 꺼져요.' : '', reload ? `${reload}개도 새로고침해야 완전히 꺼져요.` : '', '나머지는 새로고침 없이 바로 꺼졌어요.'].filter(Boolean).join(' '), 'breeze', { timeOut: 9000 });
    }
    renderDialog();
}

// 펼쳐 둔 기능의 세부 설정 칸을 그린다(그 기능 파일이 options(box, api) 를 내보냄).
function renderOptions(id) {
    const box = dialog()?.querySelector(`[data-options="${id}"]`);
    if (!box) return;
    box.replaceChildren();
    const mod = running.get(id);
    if (mod?.options && settings().enabled[id]) { mod.options(box, makeApi(id)); addWandCheck(box, id); }
}

async function setEnabled(id, on) {
    markSeen(id);
    settings().enabled[id] = !!on;
    save();
    let stopped = true;
    if (on) await startFeature(id);
    else stopped = await stopFeature(id);
    renderDialog();
    refreshLauncher();
    syncWand();
    return stopped;
}
// 묶음 체크: 안의 것을 전부 같은 쪽으로(서버 기능은 켜고 끌 수 있을 때만)
async function setBundle(name, on) {
    const members = bundleMembers(name).filter(usable);
    let needsReload = false;
    for (const f of members.filter(m => !isServer(m))) if (isOn(f) !== on && !(await setEnabled(f.id, on))) needsReload = true;
    const srv = members.filter(m => isServer(m) && isOn(m) !== on);
    if (srv.length) await setServerNames(srv.flatMap(m => serverOf(m).names), on);
    if (needsReload) toastr.info(`‘${name}’은(는) 새로고침해야 완전히 꺼져요.`, 'breeze');
    renderDialog();   // 바뀐 기능이 없었어도 줄 모양(체크 · '일부만 켜짐')을 지금 상태로
}
async function onCheck(box) {
    const holder = box.closest('.etk-row, .etk-detail');
    if (holder?.dataset.bundle) return setBundle(holder.dataset.bundle, box.checked);
    const f = viewOf(holder?.dataset.id);
    if (!f) return;
    if (isServer(f)) { await setServerNames(serverOf(f).names, box.checked); return renderDialog(); }
    if (!(await setEnabled(f.id, box.checked))) toastr.info(`‘${f.name}’은(는) 새로고침해야 완전히 꺼져요.`, 'breeze');
}
// 목록 줄을 눌렀을 때: 체크는 켜고 끄기(change 에서), 묶음은 펼치기, 세부 설정이 있으면 그 화면, 없으면 켜고 끄기.
// 서버 플러그인이 없어 못 쓰는 줄은 어디를 눌러도 서버 플러그인 화면(넣는 법)
function onRowClick(row, target) {
    const f = viewOf(row.dataset.id);
    if (row.classList.contains('etk-row-missing')) return go(SERVER_TAB);
    if (target.closest('.etk-tick')) return;
    if (row.dataset.bundle) return toggleBundle(row.dataset.bundle);
    if (!f) return;
    // 세부 설정은 '설정 ›' 을 눌렀을 때만 연다: 줄 아무 데나 눌러도 넘어가면 이름을 읽다가 잘못 들어가게 된다. 줄의 나머지는 눌러도 그대로
    // 두 칸일 때 이미 오른쪽에 열린 기능의 '설정 ›' 을 다시 누르면 오른쪽을 닫음
    if (hasMore(f)) { if (target.closest('.etk-row-more')) go(wide() && ui.view === f.id ? null : f.id); return; }
    const box = row.querySelector('.etk-check');
    if (!box.disabled) box.click();
}
function onStar(star) {
    const f = FEATURES.find(x => x.id === ui.view);
    if (!f) return;
    const list = quick(), at = list.indexOf(f.id), pinned = at < 0;
    pinned ? list.push(f.id) : list.splice(at, 1);
    star.classList.toggle('fa-solid', pinned); star.classList.toggle('fa-regular', !pinned); star.classList.toggle('etk-on', pinned);
    save(); refreshLauncher();
}
async function onDialogClick(e, close) {
    const t = e.target;
    if (!t.closest('.etk-menu, .etk-more')) closeMenu();
    if (t.closest('.etk-close')) return close();
    if (t.closest('.etk-back, .etk-pane-close')) return go(null);
    if (t.closest('.etk-more')) return toggleMenu();
    const item = t.closest('.etk-menu-item');
    if (item) return menuAction(item.dataset.act);
    const tab = t.closest('.etk-tab');
    if (tab) return pickTab(tab.dataset.tab);
    const use = t.closest('.etk-use, .etk-part-go');
    if (use) return use.dataset.fold ? toggleUse(use.dataset.fold) : jumpTo(use.dataset.group, use.dataset.bundleTo);
    if (t.closest('.etk-use-plain')) return;
    const star = t.closest('.etk-star');
    if (star) return onStar(star);
    const f = FEATURES.find(x => x.id === ui.view);
    if (f && t.closest('.etk-run')) { if (settings().enabled[f.id]) running.get(f.id)?.open?.(); return; }
    const row = t.closest('.etk-row');
    if (row) onRowClick(row, t);
}

function openDialog() {
    if (dialog()) return;
    const root = document.createElement('div');
    root.id = 'etk_dialog';
    root.className = 'etk-settings';
    root.innerHTML = `
    <div class="etk-window" role="dialog" aria-label="breeze 설정">
        <div class="etk-top">
            <div class="etk-handle" aria-hidden="true"></div>
            <i class="fa-solid fa-grip-vertical etk-grip" title="끌어서 옮기기" aria-hidden="true"></i>
            <div class="etk-back fa-solid fa-arrow-left interactable" tabindex="0" title="목록으로"></div>
            <div class="etk-brand">${LOGO}<b class="etk-brand-name">breeze</b></div>
            <b class="etk-title"></b>
            <div class="etk-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" placeholder="기능 찾기 (번역, ㅂㅇ)"></div>
            <div class="etk-top-tools"></div>
            <div class="etk-more fa-solid fa-ellipsis interactable" tabindex="0" title="더 보기" aria-haspopup="menu"></div>
            <div class="etk-close fa-solid fa-xmark interactable" tabindex="0" title="닫기"></div>
        </div>
        <div class="etk-tabs" role="tablist"></div>
        <div class="etk-main"></div>
        <div class="etk-menu" role="menu" hidden></div>
        <div class="etk-rz etk-rz-w" data-rz="w"></div><div class="etk-rz etk-rz-e" data-rz="e"></div><div class="etk-rz etk-rz-s" data-rz="s"></div><div class="etk-rz etk-rz-sw" data-rz="sw"></div><div class="etk-rz etk-rz-se" data-rz="se" title="끌어서 창 크기 바꾸기"></div>
    </div>`;
    document.body.append(root);
    const main = root.querySelector('.etk-main');
    placeWindow();
    renderDialog();
    askServer();
    main.addEventListener('scroll', () => { if (!ui.view) ui.scroll = main.scrollTop; }, { passive: true });
    // 두 칸의 왼쪽 목록 굴림(굴림 신호는 위로 안 올라와서 먼저 받기로)
    //   굴릴 때 바로 읽으면 화면 계산을 그 자리에서 치르는 때가 있어서, 굴렸다는 것만 적고 다음에 그리기 전에 읽음
    main.addEventListener('scroll', (e) => { if (e.target.classList?.contains('etk-pane-list')) listScrolled = e.target; }, { passive: true, capture: true });
    // 창 크기가 바뀌어 두 칸이 되거나 풀리면 그에 맞게 다시 그림
    let wasTwo = wide();
    const onResize = () => { if (wide() !== wasTwo) { wasTwo = wide(); renderDialog(); } else placeWindow(); };
    const close = () => { takeListScroll(); rememberUi(); root.remove(); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); };
    // Esc: … 목록이 열려 있으면 그것만 닫고, 아니면 창을 닫음
    const onKey = (e) => {
        if (e.key !== 'Escape' || e.target.closest?.('.popup') || document.querySelector('dialog[open]')) return;
        e.stopPropagation();
        const menu = root.querySelector('.etk-menu');
        if (!menu.hidden) closeMenu(); else close();
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    // 실리태번은 열린 패널(확장 · 설정 등) 바깥을 누르면 그 패널을 닫는데(html 의 mousedown · touchstart), 이 창은 화면을 덮지 않아
    //   창 안을 누르는 것도 바깥으로 잡혀 열어 둔 패널이 닫혔음 → 창 안에서 누른 건 html 까지 올라가지 않게
    for (const k of ['mousedown', 'touchstart']) root.addEventListener(k, (e) => e.stopPropagation());
    wireMove(root);
    wireResize(root);
    wireSplit(root);
    root.querySelector('.etk-search input').addEventListener('input', (e) => { ui.query = e.target.value; ui.scroll = 0; renderDialog(); });
    root.addEventListener('click', (e) => onDialogClick(e, close));
    root.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const el = e.target.closest('.etk-row, .etk-tab, .etk-menu-item, .etk-back, .etk-pane-close, .etk-close, .etk-more, .etk-star, .etk-part-go');
        if (!el || e.target !== el) return;
        e.preventDefault();
        // 줄에서 Enter: 세부 설정은 '설정 ›' 을 눌러야만 열리므로, 키보드로는 그 줄의 '설정 ›' 을 대신 누른다(없으면 줄 그대로)
        (el.classList.contains('etk-row') ? el.querySelector('.etk-row-more') || el : el).click();
    });
    root.addEventListener('change', (e) => { if (e.target.classList.contains('etk-check')) onCheck(e.target); });
}
// 옮기기: PC 는 위 줄을 끌어 창 자리를, 휴대폰은 위 줄(손잡이)을 끌어 창 높이를. 글 입력칸 · 버튼에서 누른 건 빼고
function wireMove(root) {
    const win = root.querySelector('.etk-window');
    root.querySelector('.etk-top').addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('input, .interactable, .menu_button, .etk-tool')) return;
        e.preventDefault();
        const top = e.currentTarget, x0 = e.clientX, y0 = e.clientY, l0 = win.offsetLeft, t0 = win.offsetTop, h0 = win.offsetHeight;
        top.setPointerCapture(e.pointerId);
        win.classList.add('etk-dragging');
        const move = (ev) => {
            if (sheet()) ui.sheet = (h0 - (ev.clientY - y0)) / innerHeight;
            else ui.pos = { x: narrowX(l0 + ev.clientX - x0), y: t0 + ev.clientY - y0 };
            placeWindow();
        };
        const up = () => { top.removeEventListener('pointermove', move); win.classList.remove('etk-dragging'); placeWindow(true); rememberUi(); };
        top.addEventListener('pointermove', move);
        top.addEventListener('pointerup', up, { once: true });
        top.addEventListener('pointercancel', up, { once: true });
    });
}
// 두 칸의 폭 나누기: 끌어 정한 비율이 있으면 그 비율로(없으면 style.css 의 기본). 비율로 두어 창 크기를 바꿔도 그대로 따라가고,
//   왼쪽 260px, 오른쪽 300px 아래로는 줄지 않게 CSS 가 막음
const SPLIT_MIN_LEFT = 260, SPLIT_MIN_RIGHT = 300;
function applySplit(main) {
    if (ui.split) main.style.setProperty('--etk-split', `clamp(${SPLIT_MIN_LEFT}px, ${(ui.split * 100).toFixed(2)}%, calc(100% - ${SPLIT_MIN_RIGHT}px))`);
    // 끌어 정한 폭이 없으면 왼쪽 목록은 창이 좁을 때의 폭 그대로: 세부 설정을 열 때 목록이 좁아지며 글이 다시 접히면 창이 넓어지는 것과 겹쳐 덜컥거려 보였다
    else { const { nw, w } = winWidths(); main.style.setProperty('--etk-split', `${Math.max(SPLIT_MIN_LEFT, Math.min(nw, w - SPLIT_MIN_RIGHT))}px`); }   // 폭을 숫자로 못 박는다: 창 폭에 대한 식이면 창이 넓어지는 동안 목록이 같이 늘었다 줄며 오른쪽 체크가 흔들렸다
}
// 가운데 선을 끌어 두 칸 폭 조절, 두 번 누르면 기본으로. 두 칸은 다시 그릴 때마다 새로 만들어져서 창에 한 번만 걸어 둠
function wireSplit(root) {
    const win = root.querySelector('.etk-window'), main = root.querySelector('.etk-main');
    main.addEventListener('pointerdown', (e) => {
        const bar = e.target.closest?.('.etk-split');
        if (!bar || e.button !== 0) return;
        e.preventDefault();
        bar.setPointerCapture(e.pointerId);
        win.classList.add('etk-dragging');   // 끄는 동안 글이 선택되지 않게
        const move = (ev) => {
            const r = main.getBoundingClientRect();
            const left = Math.max(SPLIT_MIN_LEFT, Math.min(ev.clientX - r.left, r.width - SPLIT_MIN_RIGHT));
            ui.split = Math.min(.99, Math.max(.01, left / r.width));
            applySplit(main);
        };
        const up = () => { bar.removeEventListener('pointermove', move); win.classList.remove('etk-dragging'); rememberUi(); };
        bar.addEventListener('pointermove', move);
        bar.addEventListener('pointerup', up, { once: true });
        bar.addEventListener('pointercancel', up, { once: true });
    });
    main.addEventListener('dblclick', (e) => { if (!e.target.closest?.('.etk-split')) return; ui.split = null; applySplit(main); rememberUi(); });
}
// 크기 바꾸기(PC): 왼쪽 · 오른쪽 · 아래 가장자리와 아래 두 모서리를 끌어서. 넓히면 목록이 두 단, 크기는 기억
function wireResize(root) {
    const win = root.querySelector('.etk-window');
    for (const rz of root.querySelectorAll('.etk-rz')) rz.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || sheet()) return;
        e.preventDefault(); e.stopPropagation();
        const k = rz.dataset.rz, x0 = e.clientX, y0 = e.clientY, l0 = win.offsetLeft, w0 = win.offsetWidth, h0 = win.offsetHeight, W = innerWidth, key = wide() ? 'ww' : 'w', min = wide() ? MIN_WW : MIN_W;
        rz.setPointerCapture(e.pointerId);
        win.classList.add('etk-dragging');
        const move = (ev) => {
            const dx = ev.clientX - x0, size = ui.size ??= {};
            if (/[ew]/.test(k)) {
                const nwid = Math.max(Math.min(min, W - 16), Math.min(k.includes('w') ? w0 - dx : w0 + dx, k.includes('w') ? l0 + w0 - 8 : W - 8 - l0));
                size[key] = nwid;
                (ui.pos ??= { x: l0, y: win.offsetTop }).x = narrowX(k.includes('w') ? l0 + w0 - nwid : l0);
            }
            if (k.includes('s')) size.h = Math.max(MIN_H, Math.min(h0 + ev.clientY - y0, innerHeight - 8 - win.offsetTop));
            placeWindow();
        };
        const up = () => { rz.removeEventListener('pointermove', move); win.classList.remove('etk-dragging'); placeWindow(true); rememberUi(); };
        rz.addEventListener('pointermove', move);
        rz.addEventListener('pointerup', up, { once: true });
        rz.addEventListener('pointercancel', up, { once: true });
    });
}
// 창 폭: 목록만 있을 땐 nw(가장자리를 끌어 바꾼 폭 size.w), 세부 설정을 열어 두 칸일 땐 w(size.ww). 화면보다 크면 화면에 맞춤
const MIN_W = 300, MIN_WW = 620, MIN_H = 320;
function winWidths() {
    const W = innerWidth, fit = (v, min) => Math.max(Math.min(min, W - 16), Math.min(v, W - 16));
    const nw = fit(ui.size?.w ?? NARROW_W, MIN_W);
    return { nw, w: wide() ? fit(ui.size?.ww ?? WIDE_W, MIN_WW) : nw };
}
// 넓힌 창을 끌어 옮길 때 그 자리를 좁은 창 기준으로 바꿔 적음(넓힐 때 쓴 방향을 거꾸로)
function narrowX(x) {
    const W = innerWidth, { nw, w } = winWidths();
    if (w <= nw) return x;
    const right = x + w - nw;   // 왼쪽으로 넓힌 거라면 좁은 창 자리
    return right + nw / 2 > W / 2 ? right : x;
}
// 창 자리 · 크기. 위치는 위 · 왼쪽 기준 px 로 직접 넣음(실리태번이 html 에 transform 을 걸어 고정 창의 기준이 높이 0 인 html 이 되므로 bottom 은 못 씀)
function placeWindow(keep) {
    const win = dialog()?.querySelector('.etk-window');
    if (!win) return;
    const W = innerWidth, H = innerHeight;
    if (sheet()) {
        const h = Math.round(Math.min(H * 0.92, Math.max(Math.min(240, H * 0.5), (ui.sheet || 0.62) * H)));
        if (keep) ui.sheet = h / H;
        Object.assign(win.style, { left: '0px', top: `${H - h}px`, width: `${W}px`, height: `${h}px` });
        win.style.removeProperty('--etk-final-w');
        return;
    }
    // 자리는 좁은 창 기준(ui.pos)으로 기억하고, 두 칸으로 넓힐 땐 창이 화면 오른쪽 반에 있으면 왼쪽으로 · 왼쪽 반이면 오른쪽으로 넓힘
    const { nw, w } = winWidths(), h = Math.max(Math.min(MIN_H, H - 16), Math.min(ui.size?.h ?? 600, H - 16));
    const nx = Math.max(8, Math.min(ui.pos?.x ?? W - nw - 24, W - nw - 8)), y = Math.max(8, Math.min(ui.pos?.y ?? 64, H - h - 8));
    const x = Math.max(8, Math.min(w > nw && nx + nw / 2 > W / 2 ? nx + nw - w : nx, W - w - 8));
    if (keep && ui.pos) ui.pos = { x: nx, y };
    Object.assign(win.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    // 창 폭이 부드럽게 바뀌는 동안 한 칸 목록이 넓은 창을 따라 늘었다 줄지 않게, 다 바뀐 뒤의 폭을 알려 둔다
    win.style.setProperty('--etk-final-w', `${w}px`);
}

// 이름 옆 알약 = 확장 버전(manifest.json) 그대로(1.0.0)
let version = null;
async function showVersion(el) {
    if (!el) return;
    if (version === null) {
        try { version = String((await (await fetch(`${BASE}manifest.json`, { cache: 'no-cache' })).json()).version || ''); } catch { version = ''; }
    }
    el.textContent = version;
    el.hidden = !version;
    el.title = '업데이트 내역';
    // 새 판의 내역을 아직 안 봤으면 NEW 표시 — 한 번 열어 보면 사라짐(본 판은 설정 seenLog 에 적음)
    el.classList.toggle('etk-new', !!version && settings().seenLog !== version);
    if (!el.dataset.log) {
        el.dataset.log = '1';
        // 알약은 접는 줄 안에 있어서, 누르면 줄이 펼쳐지지 않게 막고 내역만 띄움
        el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showChangelog(); });
    }
}

// 업데이트 내역(CHANGELOG.json: 판마다 날짜와 바뀐 것)
async function showChangelog() {
    let log = [];
    try { log = await (await fetch(`${BASE}CHANGELOG.json`, { cache: 'no-cache' })).json(); } catch { /* 아래에서 알림 */ }
    if (!Array.isArray(log) || !log.length) return toastr.info('업데이트 내역을 읽지 못했어요.', 'breeze');
    // 판마다 items(한 목록) 또는 groups(기능별로 접는 묶음: {title, items})
    const list = items => `<ul>${(items || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
    const body = v => Array.isArray(v.groups)
        ? v.groups.map(g => `<details class="etk-cl-group"><summary>${esc(g.title)}<small>${(g.items || []).length}</small></summary><div class="etk-cl-body">${list(g.items)}</div></details>`).join('')
        : list(v.items);
    // 창엔 마지막으로 내역을 본 판 뒤에 나온 판 전부(여러 판을 건너 받은 사람은 최신 판만 보면 그 사이 바뀐 것을 모름).
    //   그보다 지난 판은 아래 링크(GitHub 전체 내역)로. 처음 깔았거나 이미 다 본 사람은 최신 판만.
    //   기준은 화면을 연 뒤 처음 내역을 볼 때의 값으로 잡아 둠: 한 번 보면 seenLog 가 최신으로 바뀌어, 새로고침 전 다시 열어도 같은 판들이 보이게
    showChangelog.base ??= settings().seenLog || '';
    const missed = showChangelog.base ? log.filter(x => verNum(x.version) > verNum(showChangelog.base)) : [];
    const shown = missed.length ? missed : [log[0]];
    const html = `<div class="etk-changelog"><h3>breeze 업데이트 내역</h3>${shown.length > 1 ? `<div class="etk-cl-note">${esc(showChangelog.base)} 뒤에 나온 ${shown.length}개 판의 내역이에요.</div>` : ''}<div class="etk-cl-scroll">${shown.map(v => `<section class="etk-cl-ver"><div class="etk-cl-head"><b>${esc(v.version)}</b><small>${esc(v.date || '')}</small></div>${body(v)}</section>`).join('')}</div><a class="etk-cl-all" href="https://github.com/URMIIE/breeze/blob/main/CHANGELOG.md" target="_blank" rel="noopener">지난 내역 전체 보기</a></div>`;
    if (version && settings().seenLog !== version) { settings().seenLog = version; save(); }
    if (!showChangelog.wired) {
        showChangelog.wired = true;
        document.addEventListener('click', foldChangelog, true);
    }
    document.querySelectorAll('.etk-launch-count.etk-new').forEach(x => x.classList.remove('etk-new'));
    ctx().callGenericPopup(html, ctx().POPUP_TYPE.TEXT, '', { wide: false, allowVerticalScrolling: true });
}

// 내역 창의 접는 묶음: 그냥 details 는 한 번에 툭 열리고 닫혀서, 높이를 부드럽게 늘이고 줄이며 열고 닫음
function foldChangelog(e) {
    const summary = e.target instanceof Element && e.target.closest('.etk-changelog summary');
    const d = summary?.parentElement, b = d?.querySelector(':scope > .etk-cl-body');
    if (!b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    e.preventDefault();
    b.getAnimations().forEach(a => a.cancel());
    const from = d.open ? b.offsetHeight : 0;
    const closing = d.open && !d.classList.contains('etk-cl-closing');
    if (closing) {
        d.classList.add('etk-cl-closing');
        const a = b.animate([{ height: `${from}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 200, easing: 'cubic-bezier(.4,0,.2,1)' });
        a.onfinish = () => { d.open = false; d.classList.remove('etk-cl-closing'); };
    } else {
        d.classList.remove('etk-cl-closing');
        d.open = true;
        b.animate([{ height: `${from}px`, opacity: from ? 1 : 0 }, { height: `${b.scrollHeight}px`, opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
}

// 확장 설정 목록에 두는 칸: 다른 확장처럼 접는 줄. 펼치면 맨 위에 전체 설정 열기, 그 아래 ★ 로 꺼내 둔 기능의 스위치가 바로 나온다.
function refreshLauncher() {
    const root = document.getElementById('etk_settings');
    if (!root) return;
    showVersion(root.querySelector('.etk-launch-count'));
    const s = settings();
    root.querySelector('.etk-wand-self input').checked = inWand(WAND_SELF);
    const rows = quick().map(id => FEATURES.find(f => f.id === id)).filter(Boolean).map(f => {
        const on = !!s.enabled[f.id], open = on && ui.quickOpen.has(f.id);
        return `
        <div class="etk-quick-row" data-id="${f.id}">
            <label class="checkbox_label"><input type="checkbox" ${on ? 'checked' : ''}><span>${esc(f.name)}</span></label>
            ${f.hasOptions && on ? `<div class="etk-quick-more fa-solid ${open ? 'fa-chevron-up' : 'fa-chevron-down'} interactable" tabindex="0" title="세부 설정 ${open ? '접기' : '펼치기'}"></div>` : ''}
        </div>
        ${open ? `<div class="etk-options etk-quick-options" data-quick-options="${f.id}"></div>` : ''}`;
    }).join('');
    const kept = new Map([...root.querySelectorAll('[data-quick-options]')].map(el => [el.dataset.quickOptions, el]));
    root.querySelector('.etk-quick').innerHTML = rows || '<small class="etk-quick-empty">자주 쓰는 기능은 설정 창에서 ☆ 를 눌러 여기에 꺼내 두기</small>';
    // 펼친 세부 설정은 이 칸 안에 바로 그림(설정 창을 열지 않고 고치기). 이미 그려 둔 칸은 그대로 다시 끼움
    for (const box of root.querySelectorAll('[data-quick-options]')) {
        const id = box.dataset.quickOptions, mod = running.get(id), old = kept.get(id);
        if (old) { box.replaceWith(old); continue; }
        if (mod?.options) { mod.options(box, makeApi(id)); addWandCheck(box, id); }
    }
}
// 확장 목록의 이름은 테마 글꼴을 따라 굵기 500 으로 그리는데, 글꼴에 500 이 없으면 400 으로 내려가 가늘게 보임.
//   그럴 때만 글자 테두리를 얇게 더해 중간 굵기처럼 보이게 함. 웹글꼴은 선언된 굵기로, 깔린 글꼴은 400 · 500 폭이 같은지로 판단.
function fitBrandWeight() {
    const el = document.querySelector('#etk_settings .etk-brand-name');
    if (!el) return;
    const cs = getComputedStyle(el), family = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    const faces = [...document.fonts].filter(f => f.family.replace(/^["']|["']$/g, '') === family);
    let lacks500;
    if (faces.length) {
        lacks500 = !faces.some(f => { const [lo, hi = lo] = String(f.weight).split(/\s+/).map(w => (w === 'normal' ? 400 : w === 'bold' ? 700 : Number(w))); return lo <= 500 && 500 <= hi; });
    } else {
        const c = document.createElement('canvas').getContext('2d');
        const width = (w) => { c.font = `${cs.fontStyle} ${w} 40px ${cs.fontFamily}`; return c.measureText('breeze').width; };
        lacks500 = width(400) === width(500) && width(400) !== width(700);
    }
    el.classList.toggle('etk-weight-fill', lacks500);
}

function addLauncher() {
    if (document.getElementById('etk_settings')) return;
    document.getElementById('extensions_settings2')?.insertAdjacentHTML('beforeend', `
    <div id="etk_settings" class="etk-settings etk-launcher">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b class="etk-brand">${LOGO}<span class="etk-brand-name">breeze<i class="etk-brand-wave" aria-hidden="true"></i></span><span class="etk-launch-count"></span></b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="etk-open interactable" tabindex="0" role="button"><span class="etk-open-face"><i class="fa-solid fa-sliders"></i>전체 설정 열기</span></div>
                <label class="checkbox_label etk-wand-self"><input type="checkbox"><span>마법봉 메뉴에서도 열기</span></label>
                <div class="etk-quick"></div>
            </div>
        </div>
    </div>`);
    const root = document.getElementById('etk_settings');
    // 한 번 더 누르면 닫힘(창이 떠 있으면 그 창의 닫기를 누른 것과 같게)
    root.querySelector('.etk-open').addEventListener('click', () => { const d = dialog(); if (d) d.querySelector('.etk-close')?.click(); else openDialog(); });
    root.addEventListener('change', async (e) => {
        if (e.target.closest('.etk-wand-self')) return void toggleWand(WAND_SELF);
        const row = e.target.closest('.etk-quick-row');
        if (!row || e.target.type !== 'checkbox') return;
        if (!(await setEnabled(row.dataset.id, e.target.checked))) toastr.info(`‘${FEATURES.find(f => f.id === row.dataset.id)?.name}’은(는) 새로고침해야 완전히 꺼져요.`, 'breeze');
    });
    root.addEventListener('click', (e) => {
        const more = e.target.closest('.etk-quick-more');
        if (!more) return;
        const id = more.closest('.etk-quick-row').dataset.id;
        const box = root.querySelector(`[data-quick-options="${id}"]`);
        if (box) {
            // 닫기: 높이를 줄인 뒤에 지움
            ui.quickOpen.delete(id);
            more.classList.replace('fa-chevron-up', 'fa-chevron-down');
            box.animate([{ height: `${box.offsetHeight}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 180, easing: 'ease-in' }).onfinish = () => refreshLauncher();
            return;
        }
        ui.quickOpen.add(id);
        rememberUi();
        refreshLauncher();
        const opened = root.querySelector(`[data-quick-options="${id}"]`);
        opened?.animate([{ height: '0px', opacity: 0 }, { height: `${opened.offsetHeight}px`, opacity: 1 }], { duration: 220, easing: 'ease-out' });
    });
    refreshLauncher();
}


// ───────── 서버 플러그인 화면 ─────────
// 맨 위 한 줄 = 지금 상태(작동 중 · 새 버전 · 다시 켜야 함 · 없음)와 그때 누를 버튼 하나, 그 아래 '서버 플러그인이 하는 일'(누르면 그 기능이 있는 갈래로).
// 서버 기능 켜고 끄기는 목록의 줄에서(빨리 열기 묶음 안 · 꾸미기의 브라우저 탭 그림)

// 탭 아이콘 칸(브라우저 탭 그림의 세부 설정): 지금 아이콘 보여 주기 · 그림 고르기 · 원래대로
const tabIconHtml = () => '<div class="etk-tab-icon-tools"><img class="etk-tab-icon-now" alt="지금 탭 그림"><div class="menu_button etk-tab-icon-pick"><i class="fa-solid fa-image"></i> 그림 고르기</div><div class="menu_button etk-tab-icon-reset" hidden>원래대로</div></div><small class="etk-tab-icon-note">고른 그림은 탭과 홈 화면 아이콘으로 써요. 바뀌기까지 시간이 걸릴 수 있어요.</small>';
async function wireTabIcon(el) {
    const box = el.querySelector('.etk-tab-icon-tools');
    if (!box) return;
    const { setTabIcon, resetTabIcon, hasTabIcon } = await import('./lib/tab-icon.js');
    const { pickFile } = await import('./lib/files.js');
    const refresh = async () => {
        box.querySelector('.etk-tab-icon-now').src = `/favicon.ico?v=${Date.now()}`;
        box.querySelector('.etk-tab-icon-reset').hidden = !(await hasTabIcon());
    };
    box.querySelector('.etk-tab-icon-pick').addEventListener('click', async () => {
        const file = await pickFile('image/*');
        if (!file) return;
        try { await setTabIcon(file); toastr.success('탭 아이콘을 바꿨어요.'); } catch (e) { toastr.error(String(e.message || e)); }
        refresh();
    });
    box.querySelector('.etk-tab-icon-reset').addEventListener('click', async () => { await resetTabIcon(); refresh(); });
    refresh();
}

// 서버 플러그인 설치 명령: 설치 스크립트(server-plugin/install.mjs · install.ps1)를 지금 이 실리태번 서버에서 받아 바로 실행.
//   명령에 다 적으면 열 줄이 넘어 붙여 넣기 겁났음 → 한 줄. 스크립트가 실리태번 폴더를 스스로 찾아서 터미널을 어느 폴더에서 열었든 됨
const INSTALL_BASE = new URL('./server-plugin/', import.meta.url).href;
// 윈도우도 같은 한 줄(node 는 실리태번이 도는 곳이면 늘 있음): PowerShell 스크립트는 .bat 로 켠 경우만 폴더를 찾았음
const NODE_INSTALL = () => `node -e "fetch(process.argv[1]+'install.mjs').then(r=>r.ok?r.text():Promise.reject(r.status)).then(t=>import('data:text/javascript,'+encodeURIComponent(t)),e=>console.log('실리태번 주소에서 설치 파일을 못 받았어요(로그인 · 주소 확인)',e))" ${INSTALL_BASE} ${Number(location.port) || 8000}`;
const INSTALL_CMD = { unix: NODE_INSTALL, win: NODE_INSTALL };
// 터미널 여는 법(처음 하는 사람용): 고른 기기 칸에 맞춰 보임. 첫 줄은 1단계 글, 나머지는 그 아래 작은 글
const INSTALL_HOW = {
    unix: ['맥: 터미널 앱을 열어요.', '안드로이드: Termux 나, 실리태번을 켜 주는 앱의 명령 창을 열어요.', '폴더는 어디든 괜찮아요. 실리태번 서버는 켜 둔 채로 해요.'],
    win: ['시작 버튼을 오른쪽 클릭 › ‘터미널’을 눌러요.', '윈도우 10 은 ‘Windows PowerShell’이에요.', '폴더는 어디든 괜찮아요. 실리태번 서버는 켜 둔 채로 해요.'],
};
// 명령어를 못 쓰는 사람(터미널이 낯설거나 막힌 곳)을 위한 다른 길: 폴더를 손으로 옮기기. 자주 쓰는 길이 아니라 한 줄로 접어 두고 누르면 그 자리에서 펼침
const FOLDER_HOW = `<details class="etk-fold"><summary>다른 방법: 폴더를 직접 옮기기<i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
    <div class="etk-step"><i>1</i><div>breeze 확장 폴더 안의 <code>server-plugin/breeze-server</code> 폴더를 실리태번 폴더의 <code>plugins</code> 폴더 안에 복사해요.<small>같은 이름의 폴더가 이미 있으면 덮어써요.</small></div></div>
    <div class="etk-step"><i>2</i><div>실리태번 폴더의 <code>config.yaml</code> 을 메모장으로 열어 <code>enableServerPlugins: false</code> 를 <code>true</code> 로 바꾸고 저장해요.<small>이미 true 면 그대로 둬요.</small></div></div>
    <div class="etk-step"><i>3</i><div>실리태번 서버를 껐다 켜요.</div></div></details>`;
const installHtml = () => `<div class="etk-sec-label">넣는 법</div><div class="etk-install">
    <div class="etk-install-os"><span class="etk-os-tab interactable" tabindex="0" data-os="unix">맥, 리눅스, 안드로이드</span><span class="etk-os-tab interactable" tabindex="0" data-os="win">윈도우</span></div>
    <div class="etk-step"><i>1</i><div class="etk-install-how"></div></div>
    <div class="etk-step"><i>2</i><div>아래 한 줄을 붙여 넣고 엔터를 눌러요.<pre class="etk-install-cmd"></pre><div class="etk-sbtn etk-install-copy interactable" tabindex="0"><i class="fa-solid fa-copy"></i>복사</div></div></div>
    <div class="etk-step"><i>3</i><div>실리태번 서버를 껐다 켜요.</div></div>${FOLDER_HOW}</div>`;
function wireInstall(el) {
    const pre = el.querySelector('.etk-install-cmd');
    if (!pre) return;
    const how = el.querySelector('.etk-install-how');
    const pick = (os) => {
        pre.textContent = INSTALL_CMD[os]();
        const [first, ...rest] = INSTALL_HOW[os];
        how.innerHTML = `${esc(first)}${rest.map(t => `<small>${esc(t)}</small>`).join('')}`;
        el.querySelectorAll('.etk-os-tab').forEach(t => t.classList.toggle('etk-on', t.dataset.os === os));
    };
    el.querySelectorAll('.etk-os-tab').forEach(t => t.addEventListener('click', () => pick(t.dataset.os)));
    // 처음 펼칠 칸: 이 화면을 보는 기기로 짐작. 안드로이드(Termux)도 리눅스 명령이라 같은 칸
    pick(/Win/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent) ? 'win' : 'unix');
    el.querySelector('.etk-install-copy').addEventListener('click', async (e) => {
        const text = pre.textContent;
        // 보안 연결이 아닌 주소(같은 공유기의 다른 기기)에서는 복사 기능이 없어서 글 상자를 골라 복사
        try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
        const ic = e.currentTarget.querySelector('i'); ic.classList.replace('fa-copy', 'fa-check'); setTimeout(() => ic.classList.replace('fa-check', 'fa-copy'), 1500);
    });
}

// 버전은 breeze 와 같은 꼴(1.2.0). 예전 플러그인은 숫자(3 · 4)라 '예전 버전'으로 보이고 늘 더 낮게 견줘짐
const pv = (v) => (typeof v === 'number' ? v : verNum(v));
const pvText = (v) => (typeof v === 'string' && v.includes('.') ? v : '예전 버전');
const newPlugin = (d) => !!d && (!d.plugin || pv(d.available) > Math.max(pv(d.plugin), pv(d.updated || 0)));
// 서버 플러그인 판마다 달라진 것(… 의 N 을 보고 들어왔을 때 무엇이 새로운지 보이게: 기능 줄이 늘지 않는 판은 목록만 봐서는 알 수 없었음)
const SERVER_NOTES = { '1.2.3': '‘전부 잠시 끄기’를 누르면 서버 플러그인 기능도 같이 쉬어요.', '1.2.4': '서버 플러그인 화면의 ‘서버 다시 켜기’ 버튼으로 실리태번 서버를 다시 켤 수 있어요.' };
const notesBetween = (from, to) => Object.entries(SERVER_NOTES).filter(([v]) => pv(v) > pv(from) && pv(v) <= pv(to)).map(([, t]) => t);
const SERVER_NAMES = Object.fromEntries(SERVER_FEATURES.flatMap(f => f.server.map(k => [k, f.name])));
// 다시 켜면 달라지는 것: 바꿔 둔 새 판의 바뀐 내용 + 켜고 끈 서버 기능(목록 줄 이름으로, 같은 줄은 한 번)
// 다시 켰을 때 올라갈 판: 바꿔 둔 판과 받아 둔 새 판 가운데 높은 쪽(서버는 켜질 때 가장 높은 판을 올린다). 한 단계씩만 보이면 그만큼만 오르는 것처럼 읽혔다
const nextVersion = (d) => (pv(d.available || 0) > pv(d.updated || 0) ? d.available : d.updated);
function restartChanges(d) {
    const to = nextVersion(d);
    const lines = to && pv(to) > pv(d.plugin || 0) ? notesBetween(d.plugin || 0, to) : [];
    const said = new Set();
    for (const [k, want] of Object.entries(d.wanted || {})) {
        if (!(k in d.features) || (want !== false) === serverOn(d.features[k]) || !SERVER_NAMES[k] || said.has(SERVER_NAMES[k])) continue;
        said.add(SERVER_NAMES[k]);
        lines.push(`${SERVER_NAMES[k]}${josaIga(SERVER_NAMES[k])} ${want !== false ? '켜져요' : '꺼져요'}`);
    }
    return lines;
}
// 이름 끝 글자에 받침이 있으면 '이', 없으면 '가'
const josaIga = (word) => { const c = word.charCodeAt(word.length - 1) - 0xAC00; return c >= 0 && c <= 11171 && c % 28 ? '이' : '가'; };
const STAT_ICON = { ok: 'check', new: 'arrow-up', again: 'rotate', no: 'plug' };
const statHtml = (kind, text, note = '', button = '') => `<div class="etk-stat"><i class="etk-stat-dot etk-stat-${kind} fa-solid fa-${STAT_ICON[kind]}" aria-hidden="true"></i><span class="etk-stat-text"><b>${text}</b>${note ? `<small>${note}</small>` : ''}</span>${button}</div>`;
const sbtn = (cls, text) => `<div class="etk-sbtn ${cls} interactable" role="button" tabindex="0">${text}</div>`;
const whatHtml = (title, ver, lines) => (lines.length ? `<div class="etk-what"><b>${title}${ver ? `<small>${ver}</small>` : ''}</b>${lines.length > 1 ? `<ul>${lines.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : `<div>${esc(lines[0])}</div>`}</div>` : '');
const autoHtml = (d) => `<label class="checkbox_label etk-update-auto"><input type="checkbox"${d.autoUpdate ? ' checked' : ''}><span>자동 업데이트 (실리태번 서버를 켤 때)</span></label>`;
const verStep = (from, to) => `${esc(pvText(from))} → ${esc(pvText(to))}`;
// 맨 위 상태 한 줄(+ 그 아래 상자). 서버 다시 켜기 버튼은 다시 켜야 적용되는 게 있을 때만, 그 주소가 있는 판(1.2.4)부터
function serverTopHtml(d) {
    if (!d) return statHtml('no', '아직 안 넣었어요', '넣으면 실리태번과 채팅이 더 빨리 열려요') + installHtml();
    if (!d.plugin) return statHtml('new', '한 번 다시 넣어야 해요', '지금은 업데이트 기능이 없는 예전 버전이에요. 다시 넣은 다음부터는 여기서 버튼으로 업데이트해요') + installHtml();
    const { restart, newer } = serverNews(d);
    if (restart) {
        const canRestart = pv(d.plugin || 0) >= pv('1.2.4');
        const to = nextVersion(d), ver = to && pv(to) > pv(d.plugin) ? verStep(d.plugin, to) : '';
        return statHtml('again', '서버를 다시 켜면 적용돼요', canRestart ? '' : '서버 창에서 껐다 켜 주세요', canRestart ? sbtn('etk-server-restart', '서버 다시 켜기') : '')
            + whatHtml('적용되는 것', ver, restartChanges(d)) + autoHtml(d);
    }
    if (newer) return statHtml('new', '새 버전이 있어요', verStep(d.plugin, d.available), sbtn('etk-update-now', '업데이트')) + whatHtml('바뀐 것', verStep(d.plugin, d.available), notesBetween(d.plugin, d.available)) + autoHtml(d);
    if (d.paused) return statHtml('no', '잠시 꺼 뒀어요', '… 버튼의 다시 켜기로 켜요') + autoHtml(d);
    return statHtml('ok', '작동 중', `버전 ${esc(pvText(d.plugin))}`) + autoHtml(d);
}
// '서버 플러그인이 하는 일' 줄: 줄을 누르면 그 기능이 있는 갈래로. onlyResting = 쉴 때만 보이는 받침 기능
const SERVER_USES = [
    { name: '빨리 열기', icon: 'forward-fast', group: '속도', bundle: '빨리 열기', members: SERVER_FEATURES.filter(f => f.bundle === '빨리 열기').flatMap(f => f.server) },
    { name: '브라우저 탭 그림', icon: 'icons', group: '꾸미기', members: ['tab_icon'] },
    { name: '옛 답 모양 지키기', icon: 'thumbtack', group: '채팅', members: ['regex_hook'] },
    { name: '로딩 화면', icon: 'hourglass-half', group: '꾸미기', members: ['loading_screen'], onlyResting: true },
];
const REST_NOTE = '‘휴식’으로 보이는 기능은 실리태번이 업데이트되면서 기능이 들어갈 자리가 바뀌어 멈춘 상태예요. 그 기능만 빠지고 실리태번과 나머지 기능은 그대로 돌아가요.';
// 묶음 안에 든 서버 기능 하나하나의 이름(펼친 안쪽 줄에 보임). 여기 없는 기능은 서버가 알려 준 이름 그대로
const SERVER_PART_NAMES = { lazy_load: '프리셋과 테마를 쓸 때만 불러오기', folder_cache: '바뀌지 않은 설정 폴더는 다시 읽지 않기', settings_once: '설정 묶음 한 번만 받기', no_local_compression: '같은 컴퓨터에서는 압축 없이 보내기',
    light_chat_open: '채팅을 열 때 캐릭터 칸 가볍게 채우기', early_message_frames: '상태창 먼저 띄우기', near_message_frames: '먼 상태창은 가까워질 때 그리기', chat_cache: '바뀌지 않은 채팅은 다시 읽지 않기' };
const REST_WHY = '실리태번이 업데이트되면서 기능이 들어갈 자리가 바뀌어 멈춘 상태예요.';
const ST_TEXT = { ok: '작동 중', rest: '휴식', off: '꺼짐' };
// 펼쳐 둔 '하는 일' 줄(이름). 화면을 닫으면 잊음
const usesOpen = new Set();
// 서버 기능 하나의 상태: ok 작동 중, rest 켜 뒀지만 자리가 안 맞아 쉼, off 꺼짐. note = 그 까닭이나 서버를 다시 켜면 바뀔 것
function partState(d, k) {
    const v = d.features[k], want = d.wanted ? d.wanted[k] !== false : serverOn(v);
    if (want && String(v).startsWith('mismatch')) return { kind: 'rest', note: REST_WHY };
    if (want !== serverOn(v)) return { kind: want ? 'off' : 'ok', note: `서버를 다시 켜면 ${want ? '켜져요' : '꺼져요'}` };
    return { kind: want ? 'ok' : 'off', note: '' };
}
// 상태 글: 작동 중은 초록 점, 휴식은 강조색, 꺼짐은 흐리게(색은 style.css). arrow = 펼치는 줄의 화살표
const stHtml = (kind, arrow = '') => `<span class="etk-st etk-st-${kind}">${ST_TEXT[kind]}${arrow ? `<i class="fa-solid fa-chevron-${arrow}" aria-hidden="true"></i>` : ''}</span>`;
const partHtml = (d, k) => { const st = partState(d, k); return `<div class="etk-part"><div class="etk-part-text">${esc(SERVER_PART_NAMES[k] || k)}${st.note ? `<small>${esc(st.note)}</small>` : ''}</div>${stHtml(st.kind)}</div>`; };
// 하는 일 한 줄. 안에 든 기능이 여럿이면 누를 때 그 자리에서 펼쳐 하나하나의 상태를 보이고, 켜고 끄는 갈래로 가는 길은 펼친 맨 아래에 둠.
//   하나뿐이면 펼칠 것이 없어 상태만 보이고 누르면 그 갈래로 감
function useRowHtml(u, d) {
    const names = u.members.filter(k => k in d.features);
    if (!names.length) return '';
    const kinds = names.map(k => partState(d, k).kind);
    const kind = kinds.includes('rest') ? 'rest' : kinds.includes('ok') ? 'ok' : 'off';
    if (u.onlyResting && kind !== 'rest') return '';
    const fold = names.length > 1, open = fold && usesOpen.has(u.name);
    const row = `<div class="etk-row etk-use${kind === 'rest' ? ' etk-use-rest' : ''}${open ? ' etk-opened' : ''}" tabindex="0" data-group="${esc(u.group)}" data-bundle-to="${esc(u.bundle || '')}"${fold ? ` data-fold="${esc(u.name)}" aria-expanded="${open}"` : ''}>${iconHtml(u.icon)}
        <div class="etk-row-text"><div class="etk-row-name">${esc(u.name)}</div><div class="etk-row-desc">${esc(u.group)}</div></div>${stHtml(kind, fold ? (open ? 'up' : 'down') : '')}</div>`;
    if (!open) return row;
    return `<div class="etk-unit">${row}<div class="etk-inner etk-parts">${names.map(k => partHtml(d, k)).join('')}
        <div class="etk-part-go" role="button" tabindex="0" data-group="${esc(u.group)}" data-bundle-to="${esc(u.bundle || '')}">${esc(u.group)}에서 켜고 끄기<i class="fa-solid fa-chevron-right" aria-hidden="true"></i></div></div></div>`;
}
// 서버는 알려 주는데 위 목록에 없는 기능(플러그인이 breeze 보다 새 판일 때): 맨 아래에 한 줄씩, 상태만
function extraUsesHtml(d) {
    const known = new Set(SERVER_USES.flatMap(u => u.members));
    return Object.keys(d.features).filter(k => !known.has(k)).map(k => `<div class="etk-row etk-use-plain">${iconHtml('plug')}<div class="etk-row-text"><div class="etk-row-name">${esc(k)}</div></div>${stHtml(partState(d, k).kind)}</div>`).join('');
}
function usesHtml(d) {
    const rows = SERVER_USES.map(u => useRowHtml(u, d)).join('') + extraUsesHtml(d);
    return `<div class="etk-uses"><div class="etk-sec-label">서버 플러그인이 하는 일</div>${rows}${rows.includes('etk-use-rest') ? `<div class="etk-card-desc etk-note">${REST_NOTE}</div>` : ''}</div>`;
}
// 하는 일 줄을 펼치거나 접기: 서버에 다시 묻지 않고 그 칸만 다시 그림(누른 줄에 초점을 돌려줌)
function toggleUse(name) {
    usesOpen.has(name) ? usesOpen.delete(name) : usesOpen.add(name);
    const box = dialog()?.querySelector('.etk-uses');
    if (!box || !serverData) return;
    box.outerHTML = usesHtml(serverData);
    [...dialog().querySelectorAll('.etk-use[data-fold]')].find(r => r.dataset.fold === name)?.focus({ preventScroll: true });
}

// 서버 다시 켜기: 묻고 → 서버에 시킴 → 새 서버가 대답할 때까지 기다렸다가 화면을 새로고침(다시 켜진 서버는 이 화면의 로그인 표를 모름)
async function restartServer() {
    const c = ctx();
    const ok = await c.callGenericPopup('실리태번 서버를 다시 켤까요?<br><small>답을 받는 중이면 끊겨요. 다시 켜진 뒤에는 서버 창에서 Ctrl+C 로 꺼지지 않을 수 있어요(창을 닫으면 꺼져요). 켜지면 이 화면은 저절로 새로고침돼요.</small>', c.POPUP_TYPE.CONFIRM, '', { okButton: '다시 켜기', cancelButton: '취소' });
    if (!ok) return;
    let old = 0;
    try {
        const res = await fetch('/api/plugins/breeze-server/restart', { method: 'POST', headers: c.getRequestHeaders(), body: '{}' });
        if (!res.ok) throw new Error(String(res.status));
        old = (await res.json()).boot || 0;
    } catch (e) { toastr.error('서버를 다시 켜지 못했어요. 서버 창에서 직접 껐다 켜 주세요.', 'breeze'); return; }
    toastr.info('서버를 다시 켜는 중이에요. 켜지면 새로고침할게요.', 'breeze', { timeOut: 0, extendedTimeOut: 0 });
    // 새 서버인지는 서버가 켜진 때(boot)가 바뀐 것으로 앎: 옛 서버가 아직 대답하는 동안 새로고침하면 곧 끊긴 화면이 됨
    for (let i = 0; i < 150; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
            const r = await fetch('/api/plugins/breeze-server/status', { cache: 'no-store' });
            if (r.ok) { const boot = (await r.json()).boot; if (boot && boot !== old) { location.reload(); return; } }
            else if (r.status === 401 || r.status === 403) { location.reload(); return; }   // 새 서버가 이 화면의 로그인 표를 모름 = 새 서버
        } catch { /* 아직 안 켜짐 */ }
    }
    toastr.clear();
    toastr.error('서버가 대답하지 않아요. 서버 창을 확인해 주세요.', 'breeze', { timeOut: 0 });
}
async function postUpdate(body) {
    const res = await fetch('/api/plugins/breeze-server/update', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
}
function wireUpdate(el) {
    el.querySelector('.etk-update-now')?.addEventListener('click', async () => {
        try { const d = await postUpdate({ apply: true }); toastr.info(d.updated ? `새 버전(${pvText(d.updated)})으로 바꿔 두었어요. 실리태번 서버를 다시 켜면 적용돼요.` : '바꿀 새 버전이 없어요.', 'breeze'); }
        catch (e) { console.warn('[Breeze] 서버 플러그인 업데이트', e); toastr.error('서버 플러그인을 업데이트하지 못했어요.', 'breeze'); }
        showServerStatus();
    });
    el.querySelector('.etk-update-auto input')?.addEventListener('change', async (e) => {
        try { await postUpdate({ auto: e.target.checked }); } catch { toastr.error('설정을 바꾸지 못했어요.', 'breeze'); }
        showServerStatus();
    });
}
async function showServerStatus() {
    const el = dialog()?.querySelector('.etk-server');
    if (!el) return;
    const d = await askServer(true);
    if (!dialog()?.contains(el)) return;
    el.innerHTML = serverTopHtml(d) + (d?.plugin ? usesHtml(d) : '');
    wireInstall(el);
    wireUpdate(el);
    el.querySelector('.etk-server-restart')?.addEventListener('click', restartServer);
}

// 다른 코드(시험 · 다른 확장)가 기능을 켜고 끄거나 세부 설정을 열 수 있게
globalThis[Symbol.for('breeze.api')] = {
    features: () => FEATURES.map(f => f.id),
    isOn: (id) => !!settings().enabled[id],
    set: (id, on) => setEnabled(id, on),
    openSettings: openDialog,
    openOptions,
};

jQuery(async () => {
    onThemeCss(() => requestAnimationFrame(fitBrandWeight));
    await loadStore().catch(error => console.warn('[Breeze] 설정 파일 읽기', error));
    const s = settings();
    await Promise.all(FEATURES.filter(f => s.enabled[f.id]).map(f => startFeature(f.id)));
    import(`${BASE}lib/chat_jump_resume.js`).then(m => m.start()).catch(e => console.warn('[Breeze] 메시지로 이동 고침', e));   // 목록에 없는 고침: /chat-jump 가 중간에 멈추지 않게
    addLauncher();
    syncWand();
    fitBrandWeight();
});
