// 번역기의 판을 연다: 판의 틀(frame.js)에 첫 화면(home.js)과 등록된 화면들(screens.js)을 끼운다.
//   번역 설정 판(메시지의 설정 버튼): 휴대폰은 한 칸(화면으로 들어가거나 그 줄 아래로 펴짐), PC 는 두 칸(왼쪽 첫 화면, 오른쪽에 누른 화면).
//   breeze 설정 창의 번역 칸(inline.js, mountInline): 연결과 번역 프롬프트만. 채팅을 열지 않아도 보인다.
//   따로 여는 판 둘: 채팅 전부 번역의 시작 전 확인(batch.js), 다시 번역(redo.js).
// 화면 파일은 불릴 때 스스로 등록한다(registerScreen). 여기서는 그 파일들을 부르기만 한다: 없는 파일이 있어도 판은 열린다.
// 한쪽에서 고치면(api.refresh) 열려 있는 자리를 모두 다시 그린다(다른 자리에 옛 값이 남지 않게).
// 떠 있는 판은 문서 밖 shadow root(#btr-panel-host) 안에 그린다(panelRoot 의 주석). 다른 화면 안의 칸(mountInline)은 문서에 그대로 그린다.
//
// usePanels(api) 의 api (화면에는 api.tools 로 그대로 간다)
//   layers                     쓰는 곳 셋(store/layers.js)
//   memory                     문단 번역 기억(store/memory.js)
//   status(key) → Promise<{ rec, save(), flush() }>   그 캐릭터의 상태창 번역(store/hands.js)
//   books() → Promise<…>       용어집이 있는 다른 캐릭터 · 그룹(store/hands.js, 용어집 화면의 '다른 캐릭터에서 가져오기')
//   batch.estimate() · batch.start({ from })          채팅 전부 번역
//   redo(message) → Promise<{ data(), onWho(ats, who), go(choice), undoState(), undo() }>   다시 번역에 줄 것(app.js)
//   clearAll?                  이 채팅의 번역 모두 지우기: count() · run()
//   onView?()                  보기 방식을 고친 뒤

import { mount as mountFrame } from './frame.js';
import { mount as mountInlinePart } from './inline.js';
import { mountHome } from './home.js';
import { screenOf, titleOf } from './screens.js';
import { wherePick } from './motion.js';
import { whereOf, headSub, hasChat, peopleOf } from './open-data.js';
import './connection.js';
import './prompts.js';
import { mount as mountBatch } from './batch.js';

const context = () => SillyTavern.getContext();
const notice = (text, kind = 'info') => globalThis.toastr?.[kind]?.(text, '', { timeOut: 3500 });
const RECT_KEY = 'breeze.translator.settingsRect', SMALL_RECT_KEY = 'breeze.translator.panelRect';
const STYLES = ['common', 'frame', 'inline', 'prompts', 'settings', 'more', 'terms', 'person', 'status', 'batch', 'redo', 'open'];   // common 이 먼저: 화면별 파일이 그 위에 제 배치를 얹는다
const SCREEN_FILES = ['settings', 'more', 'terms', 'fill', 'person', 'status'];   // 불릴 때 registerScreen 을 부르는 화면 파일
const PC_SIZE = { w: 812, h: 723 };   // 시안의 PC 창(왼쪽 칸 286)
const PHONE_LOW = 150;   // 내용이 짧은 판(다시 번역, 채팅 전부 번역)을 휴대폰에서 낮게 띄울 때의 위 끝(px)

const div = (cls, text) => Object.assign(document.createElement('div'), { className: cls, textContent: text ?? '' });
const button = (cls, text, onClick) => {
    const el = Object.assign(document.createElement('button'), { type: 'button', className: cls, textContent: text });
    el.addEventListener('click', onClick);
    return el;
};

// 판을 문서 밖(shadow root)에 그린다. 실리태번 페이지는 노드가 3만 개 가까이, 스타일시트가 190개 가까이라
// 판 안을 누를 때마다 문서 전체의 스타일과 배치를 다시 셈해 한 번에 130~200ms 멈췄다.
// shadow root 안이면 다시 셈하는 범위가 판 안으로 줄어든다. 색 · 글꼴 변수(테마 변수)는 shadow 를 넘어 이어받는다.
// 아이콘 글꼴(@font-face)은 문서 쪽에 이미 있어서, 아이콘 클래스만 실리태번이 쓰는 같은 css 를 shadow 안에 건다.
const HOST_ID = 'btr-panel-host';
const ICON_STYLES = ['css/fontawesome.min.css', 'css/solid.min.css'];
// shadow 안의 글칸에서 누른 키가 문서로 올라가면 실리태번은 그 키가 shadow 의 겉 칸에서 났다고 보고 글칸에 적는 중인 줄 모른다
// (입력창이 비어 있으면 좌우 화살표가 메시지 넘기기로 처리된다). 글칸에서 누른 키는 판 안에서 끝낸다
const TYPING = 'input, textarea, [contenteditable=""], [contenteditable="true"]';

const fileThere = new Map();      // css 주소 → 있는가(Promise). 없는 파일을 link 로 걸면 콘솔에 오류가 남아서 먼저 묻는다
const linkLoads = new WeakMap();  // 건 link → 다 읽혔을 때(Promise)
const cssHref = name => new URL(`./${name}.css`, import.meta.url).href;

function exists(href) {
    if (!fileThere.has(href)) fileThere.set(href, fetch(href, { method: 'HEAD' }).then(r => r.ok, () => false));
    return fileThere.get(href);
}

/** into(문서의 head 또는 shadow root)에 css 를 한 번만 건다. check: 있는 파일인지 먼저 묻는다(화면 파일은 짜이는 대로 늘어난다) */
function linkOnce(into, id, href, check) {
    const old = into.querySelector(`link#${id}`);
    if (old) return linkLoads.get(old) ?? Promise.resolve();
    const mark = Object.assign(document.createElement('link'), { id, rel: 'stylesheet' });
    into.append(mark);   // 자리를 먼저 잡는다(차례가 곧 우선순위)
    const loaded = (check ? exists(href) : Promise.resolve(true)).then(there => {
        if (!there) { mark.remove(); return; }
        // 다 읽힌 뒤에 그린다: 처음 열 때 모습 없는 판이 잠깐 보이지 않게
        return new Promise(done => { mark.onload = mark.onerror = done; mark.href = href; });
    });
    linkLoads.set(mark, loaded);
    return loaded;
}

/** 판 css 묶음을 into 에 건다(common 이 먼저: 화면별 파일이 그 위에 제 배치를 얹는다) */
const loadStyles = (into = document.head) => Promise.all(STYLES.map(name => linkOnce(into, `btr-panel-${name}`, cssHref(name), true)));

/**
 * 판이 열린 동안 실리태번 알림을 판 위로 올린다. 판은 다른 확장이 화면에 띄워 두는 버튼(z-index 200만 대까지 있다)보다 위에 있어야 해서
 * 알림 상자(999999)보다 높아졌다. 판이 열려 있다는 표시(겉 칸의 data-open)가 있을 때만 걸린다
 */
function raiseToasts() {
    if (document.getElementById(`${HOST_ID}-toast`)) return;
    const style = Object.assign(document.createElement('style'), { id: `${HOST_ID}-toast` });
    style.textContent = `body:has(> #${HOST_ID}[data-open]) #toast-container { z-index: 2147483647 !important; }`;
    document.head.append(style);
}
const markOpen = on => document.getElementById(HOST_ID)?.toggleAttribute('data-open', on);

/** 떠 있는 판을 그릴 shadow root. 한 번 만들어 두고 다시 쓴다(css 를 열 때마다 다시 읽지 않게) */
async function panelRoot() {
    let host = document.getElementById(HOST_ID);
    if (!host) {
        host = Object.assign(document.createElement('div'), { id: HOST_ID });
        host.style.display = 'contents';   // 겉 칸은 자리를 차지하지 않는다: 판은 안에서 fixed 로 뜬다
        host.attachShadow({ mode: 'open' }).addEventListener('keydown', event => { if (event.target.closest?.(TYPING)) event.stopPropagation(); });
        document.body.append(host);
        raiseToasts();
    }
    const root = host.shadowRoot;
    await Promise.all([
        ...ICON_STYLES.map((path, i) => linkOnce(root, `btr-panel-icons-${i}`, new URL(path, document.baseURI).href, false)),
        loadStyles(root),
    ]);
    return root;
}

let screensLoaded = null;
/** 화면 파일들을 한 번 부른다. 못 부른 파일은 그 화면만 비고 판은 열린다 */
function loadScreens() {
    screensLoaded ??= Promise.all(SCREEN_FILES.map(name => import(`./${name}.js`).catch(error => console.debug(`[번역] 화면 파일 ${name}.js 를 부르지 못했어요`, error))));
    return screensLoaded;
}

const savedRect = key => { try { return JSON.parse(localStorage.getItem(key)) || undefined; } catch { return undefined; } };
/** 창의 자리와 크기를 기억한다. rect 가 null 이면(처음 크기로 되돌림) 기억을 지운다 */
const keepRect = key => rect => {
    try {
        if (rect) localStorage.setItem(key, JSON.stringify(rect));
        else localStorage.removeItem(key);
    } catch { /* 자리 기억은 없어도 된다 */ }
};

let api = null, layers = null;
let watching = false, onClosed = null;

/** 떠 있는 판: 틀, 첫 화면, 지금 오른쪽 칸(휴대폰은 맨 위)에 보이는 화면 */
const floating = { frame: null, home: null, shown: null, shownArgs: undefined };
const inlines = new Set();      // 다른 화면 안의 칸들(mountInline)

/** 열려 있는 자리를 모두 지금 값으로 다시 그린다. 보이지 않는 칸은 다시 보일 때 그린다 */
function refreshAll() {
    floating.frame?.refresh();
    for (const spot of [...inlines]) {
        if (!spot.host.isConnected) dropInline(spot);
        else if (spot.seen) spot.part?.refresh();
        else spot.stale = true;
    }
}

/** 시작하는 곳이 한 번 부른다: 저장과 번역 일을 넘겨받는다(맨 위 주석의 꼴) */
export function usePanels(given) {
    api = given;
    layers = given.layers;
}

export function close() {
    if (!floating.frame) return;
    floating.frame.close();
    markOpen(false);
    Object.assign(floating, { frame: null, home: null, shown: null, shownArgs: undefined });
    onClosed?.();
    onClosed = null;
    layers.flush();
}

// 채팅이 바뀌면 판을 닫고(다른 채팅의 자료를 고치지 않게), 칸은 새 채팅의 것으로 다시 그린다
function onChatChanged() {
    close();
    for (const spot of [...inlines]) {
        if (!spot.host.isConnected) dropInline(spot);
        else if (spot.seen) draw(spot);
        else { spot.part?.close(); spot.part = null; spot.stale = true; }
    }
}

function listen() {
    if (watching) return;
    watching = true;
    const { eventSource, eventTypes } = context();
    eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
}

/** 판을 새로 연다(열려 있던 판은 닫는다). needChat: 채팅이 없으면 열지 않는다 */
async function show(page, options = {}, needChat = true) {
    if (needChat && !hasChat(context())) { notice('채팅을 먼저 열어 주세요.'); return false; }
    close();
    listen();
    const [into] = await Promise.all([panelRoot(), layers.ready(), api.memory.ready()]);
    floating.frame = mountFrame(into, { page: await page(), onClose: close, rect: savedRect(SMALL_RECT_KEY), onRect: keepRect(SMALL_RECT_KEY), ...options });
    markOpen(true);
    return true;
}

// ── 번역 설정 판: 첫 화면과 등록된 화면들 ──

/** context 는 부르거나(context().chat) 칸을 바로 읽거나(context.chat) 둘 다 된다 */
const contextBoth = new Proxy(context, { get: (_, key) => context()[key] });

/** 화면의 render 가 받는 것(screens.js 맨 위 주석) */
function screenApi(id, args, wide, setHead) {
    return {
        context: contextBoth, layers, memory: api.memory, tools: api, notice, args, wide, setHead,
        close, refresh: refreshAll, open: openScreen,
        where: (box, value, onPick, options = {}) => wherePick(box, value, onPick, { places: hasChat(context()) ? ['all', 'card', 'chat'] : ['all'], ...options }),
    };
}

/** render 가 돌려준 것(정리 함수, { refresh, close }, 없음)을 한 꼴로 */
const handleOf = out => (typeof out === 'function' ? { close: out } : out ?? {});

/** 등록된 화면을 box 에 그린다. 등록되지 않은 화면은 비워 두고 알린다 */
function renderScreen(id, args, box, wide, setHead) {
    const screen = screenOf(id);
    if (!screen?.render) { box.append(div('note', '이 화면을 불러오지 못했어요. 새로고침한 뒤 다시 열어 주세요.')); return {}; }
    try { return handleOf(screen.render(box, screenApi(id, args, wide, setHead))); } catch (error) {
        console.warn('[번역] 화면을 그리지 못했어요', id, error);
        box.append(div('note', '이 화면을 그리지 못했어요.'));
        return {};
    }
}

function screenPage(id, args) {
    return {
        id, args, title: titleOf(id, args) || '번역 설정',
        open: view => renderScreen(id, args, view.body, floating.frame?.isSplit() ?? false, view.setHead),
    };
}

/** 화면을 연다: PC 는 오른쪽 칸이 바뀌고, 휴대폰은 판 안의 다음 화면으로 들어간다 */
function openScreen(id, args) {
    if (!floating.frame || !floating.home) return;
    floating.frame.push(screenPage(id, args));
}

function homePage() {
    return {
        title: '번역 설정', sub: headSub(context()),
        open(view) {
            floating.home = mountHome(view.body, {
                layers, open: openScreen, refresh: refreshAll,
                wide: () => floating.frame?.isSplit() ?? false,
                shown: () => floating.shown,
                inside: (id, box) => renderScreen(id, undefined, box, false),
            });
            return floating.home;
        },
    };
}

/** 메시지의 설정 버튼. start: 처음부터 열어 둘 화면(PC 는 오른쪽 칸) */
export async function openSettings(start) {
    await loadScreens();
    screenOf('status')?.warm?.(screenApi('status', undefined, false));   // 상태창 기록은 처음 읽는 데 몇 초 걸려서, 판을 열 때 한가한 틈에 미리 읽어 둔다
    const opened = await show(async () => homePage(), {
        split: true, size: PC_SIZE, rect: savedRect(RECT_KEY), onRect: keepRect(RECT_KEY),
        onWide: () => openScreen(floating.shown ?? 'connection', floating.shownArgs),
        onShown: page => {
            if (page) { floating.shown = page.id; floating.shownArgs = page.args; }
            floating.home?.mark(page?.id ?? null, page?.args);
        },
    }, false);
    // 첫 화면은 틀이 다 서기 전에 그려진다: 한 칸인지 두 칸인지 정해진 지금 한 번 더 맞춘다
    if (opened) floating.frame.refresh();
    if (opened && start) openScreen(start);
    return opened;
}

// ── 다른 화면 안의 칸 ──

async function draw(spot) {
    const turn = ++spot.turn;
    spot.stale = false;
    spot.part?.close();
    spot.part = null;
    await Promise.all([loadStyles(), layers.ready()]);
    if (turn !== spot.turn || !spot.host.isConnected) return;   // 읽는 동안 채팅이 또 바뀌었거나 칸이 사라졌다
    spot.host.replaceChildren();
    spot.part = mountInlinePart(spot.host, {
        layers, notice, refresh: refreshAll, onDetail: () => openSettings(),
        chatName: () => { if (!hasChat(context())) return ''; const where = whereOf(context()); return where.group ?? where.card; },
    });
}

function dropInline(spot) {
    spot.watch.disconnect();
    spot.part?.close();
    inlines.delete(spot);
    layers.flush();
}

/**
 * 넘겨받은 칸에 모든 채팅에 쓰는 설정(연결, 번역 프롬프트)을 그린다(떠 있는 판을 열지 않고 그 자리에서 고친다).
 * 칸이 화면에 보일 때 그린다. 칸이 화면에서 떨어져 나가면 다음에 다시 그릴 때 스스로 치운다.
 * @param {HTMLElement} host  @returns {{ close(): void }}
 */
export function mountInline(host) {
    listen();
    const spot = { host, part: null, seen: false, stale: true, turn: 0, watch: null };
    spot.watch = new IntersectionObserver(entries => {
        spot.seen = entries.at(-1).isIntersecting;
        if (spot.seen && spot.stale) draw(spot);
    });
    spot.watch.observe(host);
    inlines.add(spot);
    return { close: () => dropInline(spot) };
}

// ── 채팅 전부 번역: 시작 전 확인 ──

/** 어림은 여는 때 한 번 센다(답마다 번역 기억을 찾아봐서 누를 때마다 세지 않는다) */
async function batchPage(onCancel) {
    const data = await api.batch.estimate();
    return {
        title: '채팅 전부 번역', whole: true,
        open(view) {
            return mountBatch(view.box, {
                data: () => data, setHead: view.setHead, onCancel,
                onStart: ({ from }) => { close(); api.batch.start({ from }); },
            });
        },
    };
}

// ── 다시 번역 ──

/** 다시 번역 판 위의 되돌리기 줄: 다시 번역으로 바꾼 것이 있을 때만 보인다 */
function undoRow(redo, refresh) {
    const state = redo.undoState();
    if (!state) return null;
    const label = state === 'undo' ? '앞 번역으로 되돌리기' : '새 번역으로 다시 바꾸기';
    return button('btr-open-undo', label, async () => { await redo.undo(); refresh(); });
}

async function redoPage(message, picked) {
    // 다시 번역 화면은 다른 파일 묶음이라 열 때 부른다(그 파일이 깨져 있어도 번역기는 뜬다)
    const [redo, { mount: mountRedo }] = await Promise.all([api.redo(message), import('./redo.js')]);
    return {
        title: '재번역', whole: true,
        open(view) {
            const top = div('btr-open-redotop'), host = div('btr-open-redohost');
            view.box.replaceChildren(top, host);
            view.box.classList.add('btr-open-redo');
            const handle = mountRedo(host, {
                data: () => { const d = redo.data(); return { ...d, picked: picked.length ? picked : d.picked ?? [] }; }, setHead: view.setHead,
                // 한 사람의 여러 이름을 한 버튼으로 모으려고 첫 화면 '나온 사람들'과 같은 사람 목록을 준다
                people: () => peopleOf(context(), layers.view()),
                onWho: async (ats, who) => { await redo.onWho(ats, who); handle.refresh(); },
                onGo: choice => { close(); redo.go(choice); },
            });
            const paintTop = () => top.replaceChildren(...[undoRow(redo, () => { paintTop(); handle.refresh(); })].filter(Boolean));
            paintTop();
            return { refresh: handle.refresh, close: handle.close };
        },
    };
}

/** 채팅 전부 번역의 시작 전 확인만 바로 열기 */
export const openBatch = () => show(() => batchPage(close), { phoneTop: PHONE_LOW });

/**
 * 다시 번역 판. picked = 처음부터 골라 둘 문단 번호(사용자가 누른 대사).
 * @param {object} message 번역이 붙은 메시지  @param {{ picked?: number[], onClosed?: () => void }} [o]
 */
export async function openRedo(message, { picked = [], onClosed: closed = null } = {}) {
    if (await show(() => redoPage(message, picked), { phoneTop: PHONE_LOW })) onClosed = closed;
}

export const isOpen = () => Boolean(floating.frame);
