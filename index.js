// breeze — 설정 창과 기능 불러오기. 기능 코드는 features/ 아래 파일마다 하나씩.
import { koMatch } from './lib/ko-match.js';
import { embedFiles, restoreFiles, downloadText, pickFile, saveUserFile } from './lib/files.js';
import { FEATURES, GROUPS, BUNDLES } from './features.js';
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
    if (st === 'error') return `<div class="etk-card-state etk-state-error"><b>${esc(STATE_HEAD.error)}</b></div>`;
    const lines = [whoText(info.who) && `누가: ${esc(whoText(info.who))}`, info.saw && `본 것: ${esc(info.saw)}`, esc(info.back || STATE_BACK[st])].filter(Boolean);
    return `<div class="etk-card-state etk-state-${st}"><b>${esc(STATE_HEAD[st])}</b>${lines.map(l => `<div>${l}</div>`).join('')}</div>`;
}
const restCount = (g) => FEATURES.filter(f => f.group === g && shownState(f.id) && shownState(f.id) !== 'error').length;
function paintState(id) {
    const root = dialog();
    if (!root) return;
    for (const row of root.querySelectorAll(`.etk-row[data-id="${id}"]`)) {
        row.querySelector(':scope > .etk-pill')?.remove();
        row.querySelector(':scope > .etk-row-text')?.insertAdjacentHTML('afterend', pillHtml(id));
    }
    for (const box of root.querySelectorAll(`.etk-detail[data-id="${id}"]`)) {
        box.querySelector(':scope > .etk-card-state')?.remove();
        (box.querySelector(':scope > .etk-detail-desc') || box.querySelector(':scope > .etk-detail-on'))?.insertAdjacentHTML('afterend', stateHtml(id));
    }
    const f = FEATURES.find(x => x.id === id);
    const rest = f && root.querySelector(`.etk-section[data-fold="${CSS.escape(f.group)}"] .etk-sec-rest`);
    if (rest) { const n = restCount(f.group); rest.textContent = n ? `쉬는 중 ${n}` : ''; }
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
// 확장 설정 목록에는 ‘설정 열기’ 한 줄만 두고, 설정은 따로 뜨는 작은 창에서 한다: 기능을 한 줄씩 늘어놓고, 세부 설정은 같은 창 안에서 넘어가 보고 ← 로 돌아옴.
// 예전엔 화면을 덮는 큰 창이라 열어 둔 채 채팅 · 다른 메뉴를 쓸 수 없었고, 휴대폰과 PC 의 구조도 달랐음 →
// 뒤를 가리지 않는 창(PC 는 위 줄을 끌어 옮김 · 자리 기억, 휴대폰은 아래에서 올라오고 손잡이로 높이 조절). 바깥을 눌러도 닫히지 않음(다른 일을 하다 닫히지 않게)
const LOGO = '';
const SERVER_TAB = '서버 플러그인';
const SERVER_NAMES = { lazy_load: '프리셋 · 테마를 쓸 때만 불러오기', folder_cache: '바뀌지 않은 설정 폴더는 다시 읽지 않기', chat_cache: '바뀌지 않은 채팅은 다시 읽지 않기',
    no_local_compression: '같은 컴퓨터에서는 압축 없이 보내기', regex_hook: '메시지별 정규식 유지용 연결 지점', tab_icon: '브라우저 탭 아이콘 바꾸기', loading_screen: '로딩 화면 파일 읽기', light_chat_open: '채팅을 열 때 캐릭터 칸 가볍게 채우기', early_message_frames: '상태창 먼저 띄우기 (태번 헬퍼 4.8.15 이상)', near_message_frames: '먼 상태창은 가까워질 때 그리기', settings_once: '설정 묶음 한 번만 받기' };
// 서버 기능은 화면에 묶음으로 보임: 하나씩 골라 끌 일이 없고 이름이 비슷해 헷갈렸음. 켜고 끄기는 묶음째, 안에 든 것은 펼쳐서 보기만.
// 서버 플러그인 쪽은 기능마다 따로 켜고 쉬는 그대로(묶음은 화면에서만)
const SERVER_GROUPS = [
    { name: '실리태번을 처음 열 때 로딩 줄이기', desc: '실리태번 화면을 열거나 새로고침할 때 받아 오는 양을 줄여요.', members: ['lazy_load', 'folder_cache', 'settings_once', 'no_local_compression'] },
    { name: '채팅 빨리 열기', desc: '채팅을 열면 보이는 상태창부터 띄우고, 먼 상태창은 가까워질 때 그려요.', members: ['light_chat_open', 'early_message_frames', 'near_message_frames', 'chat_cache'] },
    { name: '브라우저 탭 아이콘 바꾸기', members: ['tab_icon'] },
];
// 다른 기능이 쓰는 받침이라 줄에 안 보이고 늘 켜 둠(쉬는 중일 때만 보임)
const SERVER_HIDDEN = ['regex_hook', 'loading_screen'];
const serverOn = (v) => v !== 'off' && !String(v).startsWith('off (');
/** 화면에 보일 줄: 묶음(이 서버에 있는 기능만) + 묶음에 없는 새 기능은 한 줄씩 */
function serverRows(features) {
    const grouped = new Set([...SERVER_GROUPS.flatMap(g => g.members), ...SERVER_HIDDEN]);
    return [...SERVER_GROUPS.map(g => ({ ...g, members: g.members.filter(k => k in features) })).filter(g => g.members.length),
        ...Object.keys(features).filter(k => !grouped.has(k)).map(k => ({ name: SERVER_NAMES[k] || k, members: [k] }))];
}
// 마지막으로 본 화면(목록 · 기능) · 목록 스크롤 · 창 자리(PC) · 창 높이(휴대폰, 화면 높이에 대한 비율)는 브라우저에 기억
const UI_KEY = 'breeze.ui';
const uiSaved = (() => { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { return {}; } })();
const ui = { view: typeof uiSaved.view === 'string' ? uiSaved.view : null, query: '', quickOpen: new Set(uiSaved.quickOpen || []), fold: new Set(uiSaved.fold || []), scroll: uiSaved.scroll || 0, pos: uiSaved.pos || null, sheet: uiSaved.sheet || null, size: uiSaved.size || null };
const rememberUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify({ view: ui.view, quickOpen: [...ui.quickOpen], fold: [...ui.fold], scroll: ui.scroll, pos: ui.pos, sheet: ui.sheet, size: ui.size })); } catch { /* 저장소 막힘 */ } };
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dialog = () => document.getElementById('etk_dialog');
// 드롭다운에 꺼내 둔 기능(자주 켜고 끄는 것)
const quick = () => (settings().quick ??= []);
const onCount = (g) => FEATURES.filter(f => (!g || f.group === g) && settings().enabled[f.id]).length;
const hasMore = (f) => !!(f.hasOptions || f.hasAction);
const sheet = () => matchMedia('(max-width: 700px)').matches;
const touchOnly = () => matchMedia('(hover: none)').matches;
// PC(아래에서 올라오는 창이 아니고, 넓힐 자리가 있을 때): 세부 설정을 열면 창을 넓혀 왼쪽 목록 · 오른쪽 세부 설정 두 칸으로(목록으로 돌아갔다 다시 들어가지 않게)
const NARROW_W = 460, WIDE_W = 900;
const twoPane = () => !sheet() && innerWidth - 16 >= 760;
// ui.inPlace: 오른쪽 칸이 닫혀 목록만 있을 때 아래 '서버'를 누르면 창을 넓히지 않고 그 자리에서 서버 화면으로(뒤로 가기로 목록)
const wide = () => twoPane() && !!ui.view && !ui.inPlace;

// 서버 플러그인 칸 숫자(작동 중 / 전체): 서버에 물어봐야 알아서 한 번 받아 두고 칸에 채움, 없으면 ‘없음’
let serverCount = '', serverCountAsked = false;
let serverNew = false, serverNewWhy = '';
function setServerCount(features, data) {
    const rows = features ? serverRows(features) : [];
    serverCount = features ? `${rows.filter(g => g.members.some(k => features[k] === 'on')).length} / ${rows.length}` : '없음';
    // 아래 줄 '서버' 옆 NEW: 새 판이 있거나, 서버를 다시 켜야 적용되는 게 있을 때(바꿔 둔 새 판 · 켜고 끈 서버 기능). 서버 화면에 안 들어가도 알게
    const restart = !!features && (pv(data?.updated || 0) > pv(data?.plugin || 0)
        || Object.entries(data?.wanted || {}).some(([k, want]) => k in features && (want !== false) !== (features[k] !== 'off' && !String(features[k]).startsWith('off ('))));
    serverNew = !!features && (newPlugin(data) || restart);
    serverNewWhy = restart ? '서버를 다시 켜야 바뀐 게 적용돼요' : '서버 플러그인 새 버전이 있어요';
    dialog()?.querySelectorAll('.etk-server-count').forEach(el => { el.textContent = serverCount; });
    dialog()?.querySelectorAll('.etk-foot-server').forEach(el => { el.classList.toggle('etk-has-new', serverNew); el.title = serverNew ? serverNewWhy : '서버 플러그인'; });
}
async function askServerCount() {
    if (serverCountAsked) return; serverCountAsked = true;
    try { const res = await fetch('/api/plugins/breeze-server/status', { headers: ctx().getRequestHeaders() }); const d = res.ok ? await res.json() : null; setServerCount(d?.features || null, d); } catch { setServerCount(null); }
}

// 목록의 한 줄: 체크칸 · 이름 · (세부 설정이 있으면) ›. 설명까지 두 줄로 두면 기능이 늘수록 목록이 길어져, 설명은 마우스를 올리면 · 세부 설정 화면에서
// 새로 생긴 기능 NEW: features.js 의 added(그 기능이 들어온 판)가 기준 판보다 높고 아직 안 열어 본 것. 그 줄과 그 묶음 제목에 표시, 세부 화면을 열거나 켜고 끄면 사라짐.
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
// 목록 한 줄 = 기능 하나 또는 묶음 하나(묶음은 첫 기능 자리에)
function unitsOf(list) {
    const out = [], seen = new Set();
    for (const f of list) {
        if (!f.bundle) { out.push({ f }); continue; }
        if (seen.has(f.bundle)) continue;
        seen.add(f.bundle);
        out.push({ bundle: f.bundle, members: list.filter(x => x.bundle === f.bundle) });
    }
    return out;
}
const unitOn = (u) => (u.f ? !!settings().enabled[u.f.id] : u.members.every(m => settings().enabled[m.id]));
// 묶음도 안에 든 기능에 세부 설정이 있으면 줄을 눌러 세부 설정 화면으로(안에 든 기능마다 켜고 끄기 · 설정이 차례로 보임)
const bundleAsFeature = (name) => { const members = FEATURES.filter(x => x.bundle === name); return { id: `bundle:${name}`, name, desc: BUNDLES[name] || '', members, hasOptions: members.some(hasMore) }; };
const viewOf = (id) => FEATURES.find(x => x.id === id) || (typeof id === 'string' && id.startsWith('bundle:') && BUNDLES[id.slice(7)] ? bundleAsFeature(id.slice(7)) : null);
function bundleRowHtml(u) {
    const on = unitOn(u), some = u.members.some(m => settings().enabled[m.id]), pill = u.members.map(m => pillHtml(m.id)).find(Boolean) || '';
    const more = u.members.some(hasMore);
    return `<div class="etk-row${on ? '' : ' etk-row-off'}${more ? ' etk-has-more' : ''}${wide() && ui.view === `bundle:${u.bundle}` ? ' etk-row-current' : ''}" data-id="bundle:${esc(u.bundle)}" data-bundle="${esc(u.bundle)}" tabindex="0" title="${esc(BUNDLES[u.bundle] || '')}">
        <input type="checkbox" class="etk-check" ${on ? 'checked' : ''} title="${on ? '누르면 끄기' : '누르면 켜기'}" aria-label="${esc(u.bundle)}">
        <div class="etk-row-text"><div class="etk-row-name">${esc(u.bundle)}${u.members.some(isNewFeature) ? '<span class="etk-new-badge" title="새 기능">N</span>' : ''}${!on && some ? '<small class="etk-row-part">일부만 켜짐</small>' : ''}</div></div>${pill}
        ${more ? '<i class="fa-solid fa-chevron-right etk-row-go" title="세부 설정"></i>' : ''}
    </div>`;
}
function rowHtml(f) {
    const on = !!settings().enabled[f.id];
    return `<div class="etk-row${on ? '' : ' etk-row-off'}${hasMore(f) ? ' etk-has-more' : ''}${wide() && ui.view === f.id ? ' etk-row-current' : ''}" data-id="${f.id}" tabindex="0"${f.desc ? ` title="${esc(f.desc)}"` : ''}>
        <input type="checkbox" class="etk-check" ${on ? 'checked' : ''} title="${on ? '누르면 끄기' : '누르면 켜기'}" aria-label="${esc(f.name)}">
        <div class="etk-row-text"><div class="etk-row-name">${esc(f.name)}${isNewFeature(f) ? '<span class="etk-new-badge" title="새 기능">N</span>' : ''}${quick().includes(f.id) ? '<i class="fa-solid fa-star etk-row-star" title="확장 설정 목록의 breeze 칸에 꺼내 둠"></i>' : ''}</div></div>${pillHtml(f.id)}
        ${hasMore(f) ? '<i class="fa-solid fa-chevron-right etk-row-go" title="세부 설정"></i>' : ''}
    </div>`;
}
function renderList(body) {
    const q = ui.query.trim().toLowerCase();
    const show = (f) => !q || koMatch(`${f.name} ${f.desc} ${f.bundle ? `${f.bundle} ${BUNDLES[f.bundle] || ''}` : ''}`, q);
    const paused = settings().paused;
    const note = paused?.length ? `<div class="etk-paused-note">breeze 기능 ${paused.length}개를 잠시 꺼 뒀어요.</div>` : '';
    const html = GROUPS.map(g => {
        const all = FEATURES.filter(f => f.group === g), items = all.filter(show);
        if (!items.length) return '';
        const full = onCount(g) === all.length, folded = !q && ui.fold.has(g);
        // 묶음 제목을 누르면 접고 펼침(접은 묶음은 기억). 찾는 중에는 접은 묶음 안까지 보임
        return `<div class="etk-group"><div class="etk-section interactable${folded ? ' etk-folded' : ''}" data-fold="${esc(g)}" tabindex="0"><i class="fa-solid fa-chevron-down etk-fold-icon"></i><span>${esc(g)}</span>${all.some(isNewFeature) ? '<span class="etk-new-badge" title="새로 생긴 기능이 있어요">N</span>' : ''}${q ? '' : `<span class="etk-sum-all interactable" data-group="${esc(g)}" data-on="${full ? 0 : 1}" tabindex="0">${full ? '모두 끄기' : '모두 켜기'}</span>`}<small>${unitsOf(all).filter(unitOn).length} / ${unitsOf(all).length}</small><small class="etk-sec-rest">${restCount(g) ? `쉬는 중 ${restCount(g)}` : ''}</small></div>${folded ? '' : unitsOf(items).map(u => (u.f ? rowHtml(u.f) : bundleRowHtml(u))).join('')}</div>`;
    }).join('');
    // 안쪽 칸: 두 단은 높이가 정해지지 않은 칸에서만 위아래로 고르게 나뉨(굴리는 칸에 바로 걸면 옆으로 단이 계속 생겼음)
    body.innerHTML = note + (html ? `<div class="etk-list-cols">${html}</div>` : '<div class="etk-empty">맞는 기능이 없어요</div>');
}
function renderDetail(body, f) {
    if (f.members) {   // 묶음: 설명 한 줄 + 안에 든 기능마다 이름 · 켜고 끄기 · 설정
        body.innerHTML = `${f.desc ? `<div class="etk-detail-desc etk-bundle-desc">${esc(f.desc)}</div>` : ''}${f.members.map(m => { const on = !!settings().enabled[m.id]; return `<div class="etk-detail etk-bundle-part" data-id="${m.id}">
        <label class="etk-detail-on"><input type="checkbox" class="etk-check" ${on ? 'checked' : ''} aria-label="${esc(m.name)}"><span>${esc(m.name)}</span></label>
        ${m.desc ? `<div class="etk-detail-desc">${esc(m.desc)}</div>` : ''}${stateHtml(m.id)}
        ${m.hasOptions ? (on ? `<div class="etk-options" data-options="${m.id}" data-title="${esc(m.name)}"></div>` : '<div class="etk-empty-line">켜면 세부 설정을 바꿀 수 있어요</div>') : ''}
    </div>`; }).join('')}`;
        for (const m of f.members) if (m.hasOptions && settings().enabled[m.id]) renderOptions(m.id);
        return;
    }
    const on = !!settings().enabled[f.id];
    body.innerHTML = `<div class="etk-detail" data-id="${f.id}">
        <label class="etk-detail-on"><input type="checkbox" class="etk-check" ${on ? 'checked' : ''} aria-label="${esc(f.name)}"><span>${on ? '켜짐' : '꺼짐'}</span></label>
        ${f.desc ? `<div class="etk-detail-desc">${esc(f.desc)}</div>` : ''}${stateHtml(f.id)}
        ${f.hasOptions ? (on ? `<div class="etk-options" data-options="${f.id}" data-title="${esc(f.name)}"></div>` : '<div class="etk-empty-line">켜면 세부 설정을 바꿀 수 있어요</div>') : ''}
    </div>`;
    if (on && f.hasOptions) renderOptions(f.id);
}
// 아래 줄(목록에서만): 전부 잠시 끄기 · 모두 켜기 · 내보내기 · 불러오기 · 서버 플러그인
function footHtml() {
    const paused = settings().paused?.length;
    return `${paused ? '<div class="menu_button etk-pause-btn"><i class="fa-solid fa-play"></i>다시 켜기</div>' : '<div class="menu_button etk-pause-btn" title="문제가 breeze 때문인지 볼 때 써요"><i class="fa-solid fa-pause"></i>전부 잠시 끄기</div>'}
        ${!paused && onCount() < FEATURES.length ? '<div class="menu_button etk-all-on"><i class="fa-solid fa-check-double"></i>모두 켜기</div>' : ''}
        <span class="etk-foot-gap"></span>
        <i class="fa-solid fa-file-export etk-all-export interactable" tabindex="0" title="설정 내보내기(켜 둔 기능 · 기능마다 고른 설정 전부)"></i>
        <i class="fa-solid fa-file-import etk-all-import interactable" tabindex="0" title="설정 불러오기"></i>
        <span class="etk-foot-server interactable${serverNew ? ' etk-has-new' : ''}" tabindex="0" title="${serverNew ? esc(serverNewWhy) : '서버 플러그인'}">서버 <span class="etk-server-count">${esc(serverCount)}</span></span>`;
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
    // 두 칸: 왼쪽 목록(보던 자리 그대로) · 오른쪽 세부 설정(맨 위에 이름 · 도구 · 닫기)
    let body = main, list = null;
    if (two) {
        if (!main.querySelector(':scope > .etk-pane-list')) main.innerHTML = '<div class="etk-pane-list"></div><div class="etk-pane-detail"><div class="etk-pane-head"><b class="etk-pane-title"></b><div class="etk-top-tools"></div><div class="etk-pane-close fa-solid fa-xmark interactable" tabindex="0" title="세부 설정 닫기"></div></div><div class="etk-pane-body"></div></div>';
        list = main.querySelector('.etk-pane-list'); body = main.querySelector('.etk-pane-body');
        main.querySelector('.etk-pane-title').textContent = ui.view === SERVER_TAB ? SERVER_TAB : f?.name || '';
    } else if (main.querySelector(':scope > .etk-pane-list')) main.innerHTML = '';
    root.querySelector('.etk-title').textContent = ui.view === SERVER_TAB ? SERVER_TAB : f?.name || '';
    root.querySelector('.etk-top > .etk-top-tools').innerHTML = '';
    const tools = (two ? main : root).querySelector(two ? '.etk-pane-head .etk-top-tools' : '.etk-top > .etk-top-tools');
    tools.innerHTML = f && !f.members ? `${f.hasAction ? `<div class="menu_button etk-run"${settings().enabled[f.id] ? '' : ' disabled'} title="${settings().enabled[f.id] ? '지금 실행' : '켜면 실행 가능'}"><i class="fa-solid fa-play"></i>실행</div>` : ''}<div class="etk-tool etk-star fa-star ${quick().includes(f.id) ? 'fa-solid etk-on' : 'fa-regular'}" tabindex="0" title="확장 설정 목록의 breeze 칸에 꺼내 두기"></div>` : '';
    askServerCount();
    // 두 칸에서 다른 기능만 고른 거면 왼쪽 목록은 다시 그리지 않고 고른 줄 표시만 옮김(목록을 통째로 다시 그려 바꿀 때마다 더 걸렸음)
    if (list && keepList && list.firstElementChild) list.querySelectorAll('.etk-row').forEach(r => r.classList.toggle('etk-row-current', r.dataset.id === ui.view));
    else if (list) { renderList(list); list.scrollTop = ui.scroll; }
    if (!ui.view) { renderList(body); body.scrollTop = ui.scroll; }
    else if (ui.view === SERVER_TAB) { body.innerHTML = '<div class="etk-server">확인 중…</div>'; body.scrollTop = 0; showServerStatus(); }
    else if (list) {
        // 두 칸 오른쪽: 굴림 자리를 0 으로 쓰면 그 자리에서 화면 전체 계산을 한 번 치러서(12~19ms), 새 칸으로 바꿔 끼움(새 칸은 처음부터 맨 위)
        const fresh = body.cloneNode(false); body.replaceWith(fresh); renderDetail(fresh, f);
    } else { renderDetail(body, f); body.scrollTop = 0; }
    if (!keepList) root.querySelector('.etk-foot').innerHTML = ui.view && !two ? '' : footHtml();   // 두 칸에서 기능만 바꿀 땐 아래 줄도 그대로
    root.querySelector('.etk-hint').hidden = true;
    rememberUi();
}
// 창 아래 설명 줄(손가락 기기): 고른 줄 표시 · 설명 글. 목록 · 세부 설정 화면을 바꾸면 내림
function showHint(f) {
    const root = dialog();
    if (!root) return;
    root.querySelectorAll('.etk-row-picked').forEach(r => r.classList.remove('etk-row-picked'));
    const hint = root.querySelector('.etk-hint');
    if (!f) { hint.hidden = true; return; }
    root.querySelector(`.etk-row[data-id="${f.id}"]`)?.classList.add('etk-row-picked');
    hint.innerHTML = `<b>${esc(f.name)}</b><span>${esc(f.desc || '')}</span>`;
    hint.hidden = false;
}
let listScrolled = null;
function takeListScroll() { if (listScrolled) { if (listScrolled.isConnected) ui.scroll = listScrolled.scrollTop; listScrolled = null; } }
function go(view) {
    if (view && view !== SERVER_TAB) for (const m of viewOf(view)?.members || [{ id: view }]) markSeen(m.id);
    const inPlace = view === SERVER_TAB && twoPane() && !ui.view;
    const body = dialog()?.querySelector('.etk-main');
    if (!ui.view && body) ui.scroll = body.scrollTop;   // 목록에서 떠날 때 보던 자리(두 칸일 땐 왼쪽 목록을 굴릴 때마다 적어 둠)
    const keep = wide() && !!view;   // 두 칸 그대로 오른쪽만 바뀜
    ui.view = view; ui.inPlace = inPlace;
    renderDialog({ keepList: keep && wide() });
}

// 전체 설정 내보내기 · 불러오기. 그림 · 글꼴 같은 사용자 파일은 파일 안에 함께 넣고,
// 테마 전용 스크립트가 켜는 태번 헬퍼 스크립트도 내용째 넣어 다른 컴퓨터에서도 그대로 돌게 함
function linkedHelperScripts() {
    const th = window.TavernHelper;
    const ids = new Set((settings().options.theme_scripts?.rules || []).flatMap(r => (r.th || []).map(x => x.id)));
    if (!th?.getScriptTrees || !ids.size) return [];
    let trees = []; try { trees = th.getScriptTrees({ type: 'global' }) || []; } catch { return []; }
    return trees.flatMap(t => t.type === 'folder' ? t.scripts || [] : [t]).filter(x => ids.has(x.id)).map(({ name, content, info, button, data }) => ({ name, content, info, button, data }));
}
async function exportAll() {
    const s = settings();
    const data = await embedFiles({ kind: 'breeze-settings', enabled: s.enabled, options: s.options, quick: s.quick || [], helperScripts: linkedHelperScripts() });
    downloadText('breeze-settings.json', JSON.stringify(data, null, 1));
}
async function importAll() {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    let data = null;
    try { data = JSON.parse(await file.text()); } catch { /* 아래에서 알림 */ }
    if (data?.kind !== 'breeze-settings' || typeof data.enabled !== 'object') return toastr.warning('breeze 설정 파일이 아니에요.', 'breeze');
    const c = ctx();
    const on = FEATURES.filter(f => data.enabled[f.id]).length;
    const r = await c.callGenericPopup(`<h3>breeze 설정을 불러올까요?</h3>지금 설정이 파일의 것으로 바뀌어요(켜는 기능 ${on}개).`, c.POPUP_TYPE.CONFIRM, '', { okButton: '불러오기', cancelButton: '취소' });
    if (r !== c.POPUP_RESULT.AFFIRMATIVE) return;
    try { data = await restoreFiles(data); } catch (e) { console.error('[Breeze] 설정 파일 올리기', e); return toastr.error('그림 · 글꼴 파일을 올리지 못했어요.', 'breeze'); }
    // 테마 전용 스크립트가 켜는 태번 헬퍼 스크립트: 같은 이름이 없으면 꺼진 채로 만듦(규칙은 이름으로 다시 찾음)
    const th = window.TavernHelper;
    if (th?.updateScriptTreesWith && Array.isArray(data.helperScripts) && data.helperScripts.length) {
        let have = new Set();
        try { have = new Set((th.getScriptTrees({ type: 'global' }) || []).flatMap(t => t.type === 'folder' ? t.scripts || [] : [t]).map(x => x.name)); } catch { /* 없음 */ }
        const add = data.helperScripts.filter(x => x?.name && !have.has(x.name)).map(x => ({ type: 'script', enabled: false, name: x.name, id: crypto.randomUUID(), content: String(x.content || ''), info: String(x.info || ''), button: x.button || { enabled: true, buttons: [] }, data: x.data || {}, export_with: { data: true, button: true } }));
        if (add.length) { try { await th.updateScriptTreesWith(t => [...t, ...add], { type: 'global' }); } catch (e) { console.warn('[Breeze] 태번 헬퍼 스크립트 만들기', e); } }
    }
    // 켜진 기능은 껐다가 새 설정으로 다시 켬(끌 수 없는 기능은 새로고침해야 새 설정이 먹음)
    let reload = 0;
    for (const f of FEATURES) if (running.has(f.id) && !(await stopFeature(f.id))) reload++;
    const s = settings();
    s.enabled = Object.fromEntries(FEATURES.map(f => [f.id, !!data.enabled[f.id]]));
    s.options = data.options && typeof data.options === 'object' ? data.options : {};
    // 규칙에 적힌 스크립트 id 는 내보낸 컴퓨터의 것 — 이름으로 이 컴퓨터의 id 를 찾아 바꿔 둠(안 바꾸면 규칙을 고칠 때 같은 스크립트를 하나 더 만듦)
    try {
        const now = new Map((th?.getScriptTrees?.({ type: 'global' }) || []).flatMap(t => t.type === 'folder' ? t.scripts || [] : [t]).map(x => [x.name, x.id]));
        for (const r of s.options.theme_scripts?.rules || []) {
            const own = (r.th || []).find(x => x.id === r.thOwn);
            for (const ref of r.th || []) if (now.has(ref.name)) ref.id = now.get(ref.name);
            if (own) r.thOwn = own.id;
        }
    } catch { /* 이름으로 다시 찾음 */ }
    s.quick = Array.isArray(data.quick) ? data.quick.filter(id => FEATURES.some(f => f.id === id)) : [];
    delete s.paused;
    save();
    for (const f of FEATURES) if (s.enabled[f.id]) await startFeature(f.id);
    renderDialog(); refreshLauncher();
    toastr.success(reload ? `불러왔어요. ${reload}개는 새로고침해야 새 설정이 먹어요.` : '불러왔어요.', 'breeze');
}

async function togglePause() {
    const s = settings();
    if (s.paused?.length) {
        const ids = s.paused;
        delete s.paused; save();
        for (const id of ids) await setEnabled(id, true);
    } else {
        const ids = FEATURES.filter(f => s.enabled[f.id]).map(f => f.id);
        if (!ids.length) return;
        s.paused = ids; save();
        let reload = 0;
        for (const id of ids) if (!(await setEnabled(id, false))) reload++;
        if (reload) toastr.info(`${reload}개는 새로고침해야 완전히 꺼져요.`, 'breeze');
    }
    renderDialog();
}

// 펼쳐 둔 기능의 세부 설정 칸을 그린다(그 기능 파일이 options(box, api) 를 내보냄).
function renderOptions(id) {
    const box = dialog()?.querySelector(`[data-options="${id}"]`);
    if (!box) return;
    box.replaceChildren();
    const mod = running.get(id);
    if (mod?.options && settings().enabled[id]) mod.options(box, makeApi(id));
}

async function setEnabled(id, on) {
    markSeen(id);
    settings().enabled[id] = !!on;
    save();
    let stopped = true;
    if (on) await startFeature(id);
    else stopped = await stopFeature(id);   // 열어 둔 세부 설정은 끄기 전에 접혀 있음(change 처리에서), 열어 둔 표시는 남김
    renderDialog();
    refreshLauncher();
    return stopped;
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
            <div class="etk-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" placeholder="기능 찾기 (ㅊㅌ, 채팅...)"></div>
            <div class="etk-top-tools"></div>
            <div class="etk-close fa-solid fa-xmark interactable" tabindex="0" title="닫기"></div>
        </div>
        <div class="etk-main"></div>
        <div class="etk-hint" hidden></div>
        <div class="etk-foot"></div>
        <div class="etk-rz etk-rz-w" data-rz="w"></div><div class="etk-rz etk-rz-e" data-rz="e"></div><div class="etk-rz etk-rz-s" data-rz="s"></div><div class="etk-rz etk-rz-sw" data-rz="sw"></div><div class="etk-rz etk-rz-se" data-rz="se" title="끌어서 창 크기 바꾸기"></div>
    </div>`;
    document.body.append(root);
    const win = root.querySelector('.etk-window'), main = root.querySelector('.etk-main');
    placeWindow();
    renderDialog();
    main.addEventListener('scroll', () => { if (!ui.view) ui.scroll = main.scrollTop; }, { passive: true });
    // 두 칸의 왼쪽 목록 굴림(굴림 신호는 위로 안 올라와서 먼저 받기로)
    //   굴릴 때 바로 읽으면 화면 계산을 그 자리에서 치르는 때가 있어서, 굴렸다는 것만 적고 다음에 그리기 전에 읽음
    main.addEventListener('scroll', (e) => { if (e.target.classList?.contains('etk-pane-list')) listScrolled = e.target; }, { passive: true, capture: true });
    // 창 크기가 바뀌어 두 칸이 되거나 풀리면 그에 맞게 다시 그림
    let wasTwo = wide();
    const onResize = () => { if (wide() !== wasTwo) { wasTwo = wide(); renderDialog(); } else placeWindow(); };
    const close = () => { takeListScroll(); rememberUi(); root.remove(); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); };
    const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest?.('.popup') && !document.querySelector('dialog[open]')) { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    // 실리태번은 열린 패널(확장 · 설정 등) 바깥을 누르면 그 패널을 닫는데(html 의 mousedown · touchstart), 이 창은 화면을 덮지 않아
    //   창 안을 누르는 것도 바깥으로 잡혀 열어 둔 패널이 닫혔음 → 창 안에서 누른 건 html 까지 올라가지 않게
    for (const k of ['mousedown', 'touchstart']) root.addEventListener(k, (e) => e.stopPropagation());
    // 옮기기: PC 는 위 줄을 끌어 창 자리를, 휴대폰은 위 줄(손잡이)을 끌어 창 높이를. 글 입력칸 · 버튼에서 누른 건 빼고
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
    // 크기 바꾸기(PC): 왼쪽 · 오른쪽 · 아래 가장자리와 아래 두 모서리를 끌어서. 넓히면 목록이 두 단, 크기는 기억
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
    root.querySelector('.etk-search input').addEventListener('input', (e) => { ui.query = e.target.value; ui.scroll = 0; renderDialog(); });
    root.addEventListener('click', async (e) => {
        if (e.target.closest('.etk-close')) return close();
        if (e.target.closest('.etk-back, .etk-pane-close')) return go(null);
        if (e.target.closest('.etk-pause-btn')) return togglePause();
        if (e.target.closest('.etk-all-on')) { for (const f of FEATURES) if (!settings().enabled[f.id]) await setEnabled(f.id, true); return renderDialog(); }
        if (e.target.closest('.etk-all-export')) return exportAll();
        if (e.target.closest('.etk-all-import')) return importAll();
        if (e.target.closest('.etk-foot-server')) return go(SERVER_TAB);
        // 묶음 제목 줄의 '모두 켜기 · 끄기': 처음 설치하면 전부 꺼져 있어서 하나씩 누르지 않게
        const all = e.target.closest('.etk-sum-all');
        if (all) { const on = all.dataset.on === '1'; for (const f of FEATURES.filter(x => x.group === all.dataset.group)) if (!!settings().enabled[f.id] !== on) await setEnabled(f.id, on); return renderDialog(); }
        const fold = e.target.closest('.etk-section[data-fold]');
        if (fold && !ui.query.trim()) { const g = fold.dataset.fold, body = dialog().querySelector('.etk-main'); ui.scroll = body.scrollTop; ui.fold.has(g) ? ui.fold.delete(g) : ui.fold.add(g); return renderDialog(); }
        const f = FEATURES.find(x => x.id === ui.view);
        if (f && e.target.closest('.etk-star')) {
            const list = quick(), at = list.indexOf(f.id);
            at >= 0 ? list.splice(at, 1) : list.push(f.id);
            const star = e.target.closest('.etk-star'), pinned = at < 0;
            star.classList.toggle('fa-solid', pinned); star.classList.toggle('fa-regular', !pinned); star.classList.toggle('etk-on', pinned);
            save(); refreshLauncher();
            return;
        }
        if (f && e.target.closest('.etk-run')) { if (settings().enabled[f.id]) running.get(f.id)?.open?.(); return; }
        // 목록 줄: 체크칸은 켜고 끄기(change 에서), 나머지를 누르면 세부 설정이 있는 기능은 그 화면으로, 없는 기능은 켜고 끄기
        const row = e.target.closest('.etk-row');
        if (!row || e.target.closest('.etk-check')) return;
        const rf = FEATURES.find(x => x.id === row.dataset.id) || (row.dataset.bundle ? bundleAsFeature(row.dataset.bundle) : null);
        // 손가락 기기는 마우스를 올려 설명을 볼 수 없어서, 줄을 누르면 창 아래 설명 줄에 그 기능 설명을 띄움(목록 길이는 그대로).
        //   같은 줄을 다시 누르면 내림, 세부 설정은 › 로
        if (touchOnly() && !e.target.closest('.etk-row-go')) { showHint(row.classList.contains('etk-row-picked') ? null : rf); return; }
        // 두 칸일 때 이미 오른쪽에 열린 기능을 다시 누르면 오른쪽을 닫음
        if (hasMore(rf)) go(wide() && ui.view === rf.id ? null : rf.id); else row.querySelector('.etk-check').click();
    });
    root.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const el = e.target.closest('.etk-row, .etk-section[data-fold], .etk-back, .etk-pane-close, .etk-close, .etk-sum-all, .etk-foot-server, .etk-all-export, .etk-all-import, .etk-star');
        if (!el || e.target !== el) return;
        e.preventDefault(); el.click();
    });
    root.addEventListener('change', async (e) => {
        if (!e.target.classList.contains('etk-check')) return;
        const bundle = e.target.closest('[data-bundle]')?.dataset.bundle;
        if (bundle) {   // 묶음: 안에 든 기능을 전부 같은 쪽으로
            let needsReload = false;
            for (const f of FEATURES.filter(x => x.bundle === bundle)) if (!!settings().enabled[f.id] !== e.target.checked && !(await setEnabled(f.id, e.target.checked))) needsReload = true;
            if (needsReload) toastr.info(`‘${bundle}’은(는) 새로고침해야 완전히 꺼져요.`, 'breeze');
            renderDialog();   // 바뀐 기능이 없었어도 줄 모양(체크 · '일부만 켜짐')을 지금 상태로
            return;
        }
        const id = e.target.closest('[data-id]')?.dataset.id;
        if (!id) return;
        if (!(await setEnabled(id, e.target.checked))) toastr.info(`‘${FEATURES.find(f => f.id === id)?.name}’은(는) 새로고침해야 완전히 꺼져요.`, 'breeze');
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
        return;
    }
    // 자리는 좁은 창 기준(ui.pos)으로 기억하고, 두 칸으로 넓힐 땐 창이 화면 오른쪽 반에 있으면 왼쪽으로 · 왼쪽 반이면 오른쪽으로 넓힘
    const { nw, w } = winWidths(), h = Math.max(Math.min(MIN_H, H - 16), Math.min(ui.size?.h ?? 600, H - 16));
    const nx = Math.max(8, Math.min(ui.pos?.x ?? W - nw - 24, W - nw - 8)), y = Math.max(8, Math.min(ui.pos?.y ?? 64, H - h - 8));
    const x = Math.max(8, Math.min(w > nw && nx + nw / 2 > W / 2 ? nx + nw - w : nx, W - w - 8));
    if (keep && ui.pos) ui.pos = { x: nx, y };
    Object.assign(win.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
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
    // 창엔 이번 판만, 지난 판은 아래 링크(GitHub 전체 내역)로: 지난 판을 창에도 접어 두니 링크와 겹쳐 쓸데없었음
    const v = log[0];
    const html = `<div class="etk-changelog"><h3>breeze 업데이트 내역</h3><div class="etk-cl-scroll"><section><div class="etk-cl-head"><b>${esc(v.version)}</b><small>${esc(v.date || '')}</small></div>${body(v)}</section></div><a class="etk-cl-all" href="https://github.com/URMIIE/breeze/blob/main/CHANGELOG.md" target="_blank" rel="noopener">지난 내역 전체 보기</a></div>`;
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

// 확장 설정 목록에 두는 칸: 다른 확장처럼 접는 줄. 펼치면 ★ 로 꺼내 둔 기능의 스위치가 바로 나오고, 맨 아래에 전체 설정 열기.
function refreshLauncher() {
    const root = document.getElementById('etk_settings');
    if (!root) return;
    showVersion(root.querySelector('.etk-launch-count'));
    const s = settings();
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
        if (mod?.options) mod.options(box, makeApi(id));
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
                <div class="etk-quick"></div>
                <div class="menu_button etk-open"><i class="fa-solid fa-sliders"></i>전체 설정 열기</div>
            </div>
        </div>
    </div>`);
    const root = document.getElementById('etk_settings');
    // 한 번 더 누르면 닫힘(창이 떠 있으면 그 창의 닫기를 누른 것과 같게)
    root.querySelector('.etk-open').addEventListener('click', () => { const d = dialog(); if (d) d.querySelector('.etk-close')?.click(); else openDialog(); });
    root.addEventListener('change', async (e) => {
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

// 짝 서버 플러그인 상태: 있으면 기능마다 작동 중 · 휴식 · 꺼짐, 없으면 넣는 법
// 탭 아이콘 칸: 지금 아이콘 보여 주기 · 그림 고르기 · 원래대로
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

// 서버 플러그인 설치 명령: 설치 스크립트(server-plugin/install.sh · install.ps1)를 지금 이 실리태번 서버에서 받아 바로 실행.
//   명령에 다 적으면 열 줄이 넘어 붙여 넣기 겁났음 → 한 줄. 스크립트가 실리태번 폴더를 스스로 찾아서 터미널을 어느 폴더에서 열었든 됨
const INSTALL_BASE = new URL('./server-plugin/', import.meta.url).href;
const INSTALL_CMD = {
    unix: () => `curl -fsSL ${INSTALL_BASE}install.sh | sh -s ${Number(location.port) || 8000}`,
    win: () => `irm ${INSTALL_BASE}install.ps1 | iex`,
};
// 터미널 여는 법(처음 하는 사람용): 고른 기기 칸에 맞춰 보임
const INSTALL_HOW = {
    unix: ['맥: 터미널 앱을 열어요.', '안드로이드: Termux 를 새로 열어요.', '폴더는 어디든 괜찮아요. 실리태번 서버는 켜 둔 채로 해요.'],
    win: ['시작 버튼을 오른쪽 클릭 › ‘터미널’을 눌러요.', '윈도우 10 은 ‘Windows PowerShell’이에요.', '폴더는 어디든 괜찮아요. 실리태번 서버는 켜 둔 채로 해요.'],
};
const installBoxHtml = () => `<div class="etk-install"><div class="etk-install-os"><span class="etk-os-tab interactable" tabindex="0" data-os="unix">맥 · 리눅스 · 안드로이드(Termux)</span><span class="etk-os-tab interactable" tabindex="0" data-os="win">윈도우 (PowerShell)</span></div><pre class="etk-install-cmd"></pre><div class="etk-install-foot"><div class="menu_button etk-install-copy"><i class="fa-solid fa-copy"></i> 복사</div></div></div>`;
function wireInstall(el) {
    const pre = el.querySelector('.etk-install-cmd');
    if (!pre) return;
    const how = el.querySelector('.etk-install-how');
    // 단계 안내가 있는 화면: 기기 고르는 줄을 1단계 위로(1단계 글이 기기마다 달라서)
    if (how) el.querySelector('.etk-install-steps').before(el.querySelector('.etk-install-os'));
    const pick = (os) => { pre.textContent = INSTALL_CMD[os](); if (how) how.innerHTML = INSTALL_HOW[os].map(t => `<span>${t}</span>`).join(''); el.querySelectorAll('.etk-os-tab').forEach(t => t.classList.toggle('etk-on', t.dataset.os === os)); };
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

// 서버 플러그인 업데이트 칸: 확장을 업데이트해도 plugins 폴더의 사본은 그대로라 여기서 바꿔 넣음(사용자가 누를 때 · 또는 자동 업데이트)
// 버전은 breeze 와 같은 꼴(1.2.0). 예전 플러그인은 숫자(3 · 4)라 '예전 버전'으로 보이고 늘 더 낮게 견줘짐
const pv = (v) => (typeof v === 'number' ? v : verNum(v));
const pvText = (v) => (typeof v === 'string' && v.includes('.') ? v : '예전 버전');
const newPlugin = (d) => !!d && (!d.plugin || pv(d.available) > Math.max(pv(d.plugin), pv(d.updated || 0)));
function updateHtml(d) {
    if (!d.plugin) return `<div class="etk-card etk-update"><div class="etk-card-name">서버 플러그인 업데이트</div><div class="etk-card-desc">지금 플러그인은 업데이트 기능이 없는 예전 버전이에요. 이번 한 번만 아래 명령으로 다시 넣고 실리태번 서버를 다시 켜 주세요. 그다음부터는 여기서 버튼으로 업데이트해요.</div>${installBoxHtml()}</div>`;
    const line = d.updated ? `새 버전(${esc(pvText(d.updated))})으로 바꿔 두었어요. 실리태번 서버를 다시 켜면 적용돼요.` : pv(d.available) > pv(d.plugin) ? `새 버전이 있어요. 지금 ${esc(pvText(d.plugin))} → ${esc(pvText(d.available))}` : `최신 버전이에요 (${esc(pvText(d.plugin))})`;
    return `<div class="etk-card etk-update"><div class="etk-flex"><div class="etk-card-name">서버 플러그인 업데이트</div><span class="etk-foot-gap"></span>${newPlugin(d) ? '<div class="menu_button etk-update-now"><i class="fa-solid fa-download"></i> 지금 업데이트</div>' : ''}</div>
        <div class="etk-card-desc">${line}</div>
        <label class="checkbox_label etk-update-auto"><input type="checkbox"${d.autoUpdate ? ' checked' : ''}><span>자동 업데이트 (실리태번 서버를 켤 때)</span></label></div>`;
}
async function postUpdate(body) {
    const res = await fetch('/api/plugins/breeze-server/update', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
}
function wireUpdate(el) {
    wireInstall(el.querySelector('.etk-update') || el);
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
    let features = null, wanted = null, data = null;
    try {
        const res = await fetch('/api/plugins/breeze-server/status', { headers: ctx().getRequestHeaders() });
        if (res.ok) { data = await res.json(); features = data.features; wanted = data.wanted || null; }
    } catch { /* 없음 */ }
    if (!dialog()?.contains(el)) return;
    setServerCount(features, data);
    if (!features) {
        el.innerHTML = `<div class="etk-card"><div class="etk-card-name">서버 플러그인이 없어요</div><div class="etk-card-desc">없어도 다른 기능은 그대로 쓸 수 있어요.</div></div>
            <div class="etk-section">넣으면 추가되는 것</div>
            ${SERVER_GROUPS.map(g => `<div class="etk-server-row"><i class="fa-solid fa-plus"></i><span>${g.name}${g.desc ? `<small class="etk-server-desc">${g.desc}</small>` : ''}</span></div>`).join('')}
            <div class="etk-section">설치 방법 1 · 명령어 한 줄</div>
            <ol class="etk-steps etk-install-steps"><li><b>터미널 열기</b><small class="etk-install-how"></small></li><li><b>아래 명령을 복사해 붙여 넣고 Enter</b><small>실리태번 폴더를 알아서 찾아 설치해요.</small><small>못 찾으면 ‘실리태번 폴더를 못 찾았어요’라고 알려 주고 아무것도 바꾸지 않아요.</small></li></ol>
            ${installBoxHtml()}
            <div class="etk-section">설치 방법 2 · 폴더 직접 옮기기</div>
            <ol class="etk-steps etk-install-steps"><li><b>폴더 복사</b><small>breeze 확장 폴더 안의 <code>server-plugin/breeze-server</code> 폴더를</small><small>실리태번 폴더의 <code>plugins</code> 폴더 안으로 복사해요.</small></li><li><b>설정 한 줄 바꾸기</b><small>실리태번 폴더의 <code>config.yaml</code> 을 메모장으로 열어</small><small><code>enableServerPlugins: false</code> 를 <code>true</code> 로 바꿔요.</small></li></ol>
            <div class="etk-section">마지막 · 실리태번 서버를 끄고 다시 실행</div>
            <div class="etk-card-desc">이 창 아래 줄의 ‘서버 없음’이 숫자로 바뀌면 설치가 끝난 거예요.</div>`;
        wireInstall(el);
        return;
    }
    const stateOf = (v) => (v === 'on' ? '작동 중' : String(v).startsWith('mismatch') ? '쉬는 중' : String(v).startsWith('off (') ? `꺼짐 (${String(v).slice(5, -1)})` : '꺼짐');
    const row = (g) => {
        const k = g.members[0], v = features[k];
        const wants = g.members.map(m => (wanted ? wanted[m] !== false : serverOn(features[m])));
        const anyWant = wants.some(Boolean), resting = g.members.filter((m, i) => wants[i] && String(features[m]).startsWith('mismatch'));
        const label = !anyWant ? '꺼짐' : resting.length === g.members.length ? '쉬는 중' : resting.length ? '일부 쉬는 중' : wants.every(Boolean) ? '작동 중' : '일부 꺼짐';
        const tools = g.members.length === 1 && k === 'tab_icon' && v === 'on' ? '<div class="etk-tab-icon-tools" title="지금 탭 아이콘"><img class="etk-tab-icon-now" alt=""><div class="menu_button etk-tab-icon-pick" title="그림을 골라 탭 · 홈 화면 아이콘으로 써요. 바뀌기까지 시간이 걸릴 수 있어요"><i class="fa-solid fa-image"></i> 그림 고르기</div><div class="menu_button etk-tab-icon-reset" hidden>원래대로</div></div>' : '';
        // 앞의 동그라미 = 묶음째 켜고 끄기(서버를 다음에 켤 때 쓸지 — 플러그인 config.json). 서버 쪽 기능은 서버가 켜질 때 한 번 끼워서, 바꾸면 서버를 다시 켜야 먹음
        const icon = !anyWant ? 'fa-circle-minus' : resting.length ? 'fa-circle-pause etk-warn' : 'fa-circle-check etk-ok';
        const toggle = wanted ? ` etk-server-toggle interactable" tabindex="0" role="switch" aria-checked="${anyWant}" data-names="${esc(g.members.join(','))}" data-on="${anyWant}" title="${anyWant ? '누르면 끄기' : '누르면 켜기'}` : '';
        const pending = wanted && g.members.some((m, i) => wants[i] !== serverOn(features[m])) ? `<small class="etk-server-pending">서버를 다시 켜면 ${anyWant ? '켜져요' : '꺼져요'}</small>` : '';
        const inside = g.members.length > 1 ? `<details class="etk-server-inside"><summary>안에 든 기능 ${g.members.length}개</summary>${g.members.map(m => `<div><span>${SERVER_NAMES[m] || m}</span><small>${esc(stateOf(features[m]))}</small></div>`).join('')}</details>` : '';
        return `<div class="etk-server-row${tools || inside ? ' etk-has-tools' : ''}"><i class="fa-solid ${icon}${toggle}"></i><span>${g.name}${g.desc ? `<small class="etk-server-desc">${g.desc}</small>` : ''}</span><small>${esc(label)}</small>${pending}${inside}${tools}</div>`;
    };
    // 받침 기능은 쉬는 중일 때만 한 줄로(끄는 버튼 없음)
    const hiddenResting = SERVER_HIDDEN.filter(k => String(features[k] || '').startsWith('mismatch')).map(k => `<div class="etk-server-row"><i class="fa-solid fa-circle-pause etk-warn"></i><span>${SERVER_NAMES[k] || k}</span><small>쉬는 중</small></div>`).join('');
    // 다시 켜야 적용되는 게 있으면 맨 위에 글로(아래 줄 '서버' NEW 의 까닭 — 휴대폰은 마우스를 올려 볼 수 없어서 화면에 씀)
    const restartNote = serverNew && serverNewWhy.startsWith('서버를 다시') ? '<div class="etk-restart-note"><i class="fa-solid fa-rotate"></i> 실리태번 서버를 다시 켜야 바뀐 게 적용돼요.</div>' : '';
    el.innerHTML = `${restartNote}${updateHtml(data)}<div class="etk-card"><div class="etk-card-name">서버 플러그인 설치 완료</div><div class="etk-card-desc">아래 기능은 실리태번 서버 쪽에서 돌아가요.</div></div>
        ${serverRows(features).map(row).join('')}${hiddenResting}
        <div class="etk-card-desc etk-note">‘쉬는 중’으로 보이는 기능은 실리태번이 업데이트되면서 기능이 들어갈 자리가 바뀌어 멈춘 상태예요.<br>그 기능만 빠지고 실리태번과 나머지 기능은 그대로 돌아가요.</div>`;
    wireTabIcon(el);
    wireUpdate(el);
    el.querySelectorAll('.etk-server-toggle').forEach(cb => cb.addEventListener('click', async () => {
        try {
            for (const name of cb.dataset.names.split(',')) {   // 묶음 안 기능을 하나씩(서버 주소는 기능 하나씩 받음)
                const res = await fetch('/api/plugins/breeze-server/features', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ name, on: cb.dataset.on !== 'true' }) });
                if (!res.ok) throw new Error(String(res.status));
            }
        } catch (e) { console.warn('[Breeze] 서버 기능 켜고 끄기', e); toastr.error('서버 플러그인 설정을 바꾸지 못했어요.', 'breeze'); }
        showServerStatus();
    }));
}

// 다른 코드(시험 · 다른 확장)가 기능을 켜고 끄거나 세부 설정을 열 수 있게
globalThis[Symbol.for('breeze.api')] = {
    features: () => FEATURES.map(f => f.id),
    isOn: (id) => !!settings().enabled[id],
    set: (id, on) => setEnabled(id, on),
    openSettings: openDialog,
    openOptions(id) {
        const f = FEATURES.find(x => x.id === id);
        if (!f) return;
        ui.view = f.bundle && bundleAsFeature(f.bundle).hasOptions ? `bundle:${f.bundle}` : id; ui.query = '';
        if (dialog()) renderDialog(); else openDialog();
    },
};

jQuery(async () => {
    onThemeCss(() => requestAnimationFrame(fitBrandWeight));
    await loadStore().catch(error => console.warn('[Breeze] 설정 파일 읽기', error));
    const s = settings();
    await Promise.all(FEATURES.filter(f => s.enabled[f.id]).map(f => startFeature(f.id)));
    addLauncher();
    fitBrandWeight();
});
