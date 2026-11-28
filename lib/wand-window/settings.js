// 요술봉 앱 서랍 설정: 처음 값, 예전 메뉴 꾸미기 확장 설정 옮기기, 화면 너비별 자리.
import { saveUserFile } from '../files.js';

// 창 모양 둘: a = 유리 + 색 아이콘, b = 짙은 유리 + 둥근 단색 버튼. 바탕 · 글자색은 테마 색을 따름(흰 유리 · 흰 글자는 밝은 테마에서 안 읽혔음).
// 투명하게를 안 고쳤으면 모양마다 이 값. 창 색을 고르면 테마 바탕색 대신 그 색
//   가는 뒤의 채팅 글이 비쳐 보이게 바탕색을 8% 만 섞음
export const LOOKS = {
    a: { clear: 92 },
    b: { clear: 45 },
};
// 모양 가의 아이콘 색: c3 = 반투명 흰 타일에 그림만 테마 강조색, c4 = 아이콘마다 두 색이 섞이는 연한 그라데이션
export const TONES = ['c3', 'c4'];
export const LIMITS = {
    clear: { min: 0, max: 95, step: 1, unit: '%' },
    blur: { min: 0, max: 30, step: 1, unit: '' },
    icon: { min: 36, max: 64, step: 2, unit: '' },
    font: { min: 8, max: 16, step: 0.5, unit: '' },
};
const DEFAULTS = { look: 'a', tone: 'c4', color: null, clear: null, blur: 4, icon: 48, font: 10.5, pinned: false };
export const FOLDER_PREFIX = 'folder:';

// 색 4 의 두 색: 아이콘마다 번호를 하나씩 주고 번호에서 색을 만든다(색 짝 목록을 되풀이하면 아홉 번째부터 같은 색이 다시 나왔음).
//   색상 각도는 황금각(137.5도)씩 돌려 이웃한 번호끼리 계열이 크게 다르게.
//   각도만 바꾸면 34번 차이가 5도 차이라 같은 색으로 보였음(45개에서 가장 가까운 쌍 OKLab 0.01) → 밝기 · 진하기도 네 단계를 번호 차례로 돌림.
//   34 · 21 · 13 번 차이(각도가 가까워지는 차이)는 넷으로 나눠 떨어지지 않아 그런 쌍은 늘 다른 단계가 된다.
//   단계 값은 시험 스크립트로 고름(가장 가까운 쌍이 가장 멀고, 흰 그림 대비가 지금보다 낮아지지 않는 조합): out/wand/colors.png
//   두 번째 색은 같은 단계에서 조금 밝고 조금 덜 진하게, 각도 38도 비켜 그라데이션.
const GOLDEN = 137.5, SECOND = 38;
const STEPS = [[0.60, 0.16], [0.65, 0.20], [0.70, 0.16], [0.60, 0.20]];
// 노랑 각도대(60~125도)는 밝기를 낮추면 올리브 · 겨자처럼 탁해져서 그 각도대만 밝은 단계로(흰 그림 대비는 다른 각도대보다 낮아지지 않게 고름)
const YELLOW = { from: 60, to: 125, steps: [[0.66, 0.21], [0.70, 0.21], [0.66, 0.15], [0.70, 0.18]] };
const stepOf = (n, h) => (h >= YELLOW.from && h <= YELLOW.to ? YELLOW.steps : STEPS)[n % STEPS.length];
export function tintColors(n) {
    const h = (n * GOLDEN) % 360, h2 = (h + SECOND) % 360;
    const [L, C] = stepOf(n, h);
    return [`oklch(${L.toFixed(2)} ${C.toFixed(2)} ${h.toFixed(1)})`, `oklch(${(L + 0.02).toFixed(2)} ${(C - 0.01).toFixed(2)} ${h2.toFixed(1)})`];
}

/**
 * 아이콘 칸 두 색. 고른 색이 있으면 그 한 색으로.
 * 번호는 그 줄이 처음 그려질 때 차례대로 정해 적어 둔다(o.tints): 끌어 옮기거나 다른 것을 숨겨도 그 아이콘의 색이 안 바뀐다
 */
export function colorPair(o, key, picked) {
    if (picked) return [picked, picked];
    if (!Number.isInteger(o.tints[key])) o.tints[key] = o.tintNext++;
    return tintColors(o.tints[key]);
}

const clamp = (v, { min, max }) => Math.min(max, Math.max(min, Number(v)));
const num = (v, lim, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? clamp(v, lim) : fallback);

/** 모자란 칸을 채운 설정(o 를 그 자리에서 고침) */
export function fill(o) {
    for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in o)) o[k] = v;
    if (!TONES.includes(o.tone)) o.tone = DEFAULTS.tone;
    o.order = Array.isArray(o.order) ? o.order : [];
    o.hidden = Array.isArray(o.hidden) ? o.hidden : [];
    o.names = o.names && typeof o.names === 'object' ? o.names : {};
    o.icons = o.icons && typeof o.icons === 'object' ? o.icons : {};
    o.tints = o.tints && typeof o.tints === 'object' ? o.tints : {};
    o.tintNext = Number.isInteger(o.tintNext) ? o.tintNext : Object.keys(o.tints).length;
    o.folders = Array.isArray(o.folders) ? o.folders.filter(f => f && typeof f.id === 'string' && Array.isArray(f.items)) : [];
    o.dock = o.dock && typeof o.dock === 'object' ? o.dock : {};
    o.dock.on = !!o.dock.on;
    o.dock.items = Array.isArray(o.dock.items) ? o.dock.items : [];
    o.dock.meta = o.dock.meta && typeof o.dock.meta === 'object' ? o.dock.meta : {};
    o.place = o.place && typeof o.place === 'object' ? o.place : {};
    return o;
}

/** 모양만 처음 값으로(모양 · 색 · 투명도 · 흐림 · 아이콘과 글자 크기). 숨긴 것 · 차례 · 폴더 · 이름 · 아이콘 그림 · 고정 줄은 건드리지 않는다 */
export function resetLook(o) {
    for (const [k, v] of Object.entries(DEFAULTS)) if (k !== 'pinned') o[k] = v;
    return o;
}

/** 창 바탕색: 고른 색, 없으면 테마 바탕색 */
export const colorOf = (o) => o.color || 'var(--SmartThemeBlurTintColor)';
export const clearOf = (o) => (o.clear ?? LOOKS[o.look]?.clear ?? LOOKS.a.clear);

// ── 예전 메뉴 꾸미기 확장의 설정을 처음 값으로 ──
// 우리 설정이 비어 있을 때 한 번만 읽는다. 그 확장의 설정은 고치지도 지우지도 않음
const OLD_KEY = 'app-menu';
const OLD_ICONS = 'st_app_menu_custom_icons';

function fromOld(o, old) {
    if (Array.isArray(old.appOrder)) o.order = old.appOrder.filter(k => typeof k === 'string');
    if (Array.isArray(old.hiddenApps)) o.hidden = old.hiddenApps.filter(k => typeof k === 'string');
    if (old.appNames && typeof old.appNames === 'object') o.names = { ...old.appNames };
    if (Array.isArray(old.folders)) {
        o.folders = old.folders.filter(f => f && typeof f.id === 'string' && Array.isArray(f.appIds))
            .map(f => ({ id: f.id, name: String(f.name || '새 폴더').slice(0, 40), items: f.appIds.filter(k => typeof k === 'string') }));
    }
    // 그 확장의 불투명도 · 흐림은 배경 그림을 깔았을 때만 쓰이는 값이라, 그림이 없으면 옮기지 않음(옮기면 쓰던 모양과 달라짐).
    //   불투명도(0~1)는 '투명하게'의 반대
    if (old.bgImage) {
        const opacity = Number(old.bgOpacity);
        if (Number.isFinite(opacity)) o.clear = clamp(Math.round((1 - opacity) * 100), LIMITS.clear);
        o.blur = num(old.bgBlur, LIMITS.blur, o.blur);
    }
    o.font = num(old.fontSize, LIMITS.font, o.font);
    const scale = Number(old.scale);
    if (Number.isFinite(scale) && scale > 0) o.icon = clamp(Math.round(48 * scale / 100 / 2) * 2, LIMITS.icon);
    // 그 확장의 frameColor(창 바탕색, 기본 거의 검정)는 옮기지 않음: 우리 창은 글자색이 테마를 따라서, 짙은 바탕이 되면 밝은 테마에서 글자가 안 읽힘
    if (typeof old.autoClose === 'boolean') o.pinned = !old.autoClose;
    if (old.pos && Number.isFinite(old.pos.left) && Number.isFinite(old.pos.top)) {
        o.place[bucket()] = { x: old.pos.left / innerWidth, y: old.pos.top / innerHeight };
    }
}

function oldIcons() {
    try {
        const saved = JSON.parse(localStorage.getItem(OLD_ICONS) || 'null');
        return saved?.icons && typeof saved.icons === 'object' ? saved.icons : {};
    } catch { return {}; }
}

// 그 확장은 아이콘 그림을 이 브라우저 저장소에 dataURL 로 두었음 → 서버 사용자 파일로 올려 다른 기기에서도 같게
async function moveOldIcons(o, save) {
    const entries = Object.entries(oldIcons()).filter(([, v]) => typeof v === 'string' && v.startsWith('data:image/'));
    if (!entries.length) return;
    let n = 0;
    for (const [key, data] of entries) {
        try {
            const blob = await (await fetch(data)).blob();
            const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/g, '').slice(0, 4) || 'png';
            const url = await saveUserFile(`breeze-wand-icon-${Date.now().toString(36)}-${n++}.${ext}`, blob);
            o.icons[key] = { ...(o.icons[key] || {}), img: url };
        } catch (e) { console.warn('[Breeze] 아이콘 그림 옮기기', key, e); }
    }
    save();
}

/** 우리 설정이 비어 있으면 예전 설정을 읽어 처음 값으로. 옮겼으면 true */
export function importOld(o, ext, save) {
    if (o.v) return false;
    o.v = 1;
    const old = ext?.[OLD_KEY];
    if (old && typeof old === 'object') {
        fromOld(o, old);
        moveOldIcons(o, save);
    }
    save();
    return !!old;
}

/** 예전 메뉴 꾸미기 확장이 지금 켜져 있는지(같이 켜면 메뉴가 두 번 꾸며짐) */
export function oldIsOn(ext) {
    const off = ext?.disabledExtensions || [];
    if (off.includes(`third-party/${OLD_KEY}`)) return false;
    return !!document.getElementById('iphone-menu-container') || !!ext?.[OLD_KEY];
}

// ── 자리 · 크기: 넓은 화면(PC)과 좁은 화면(휴대폰)을 따로 ──
// breeze 설정 창과 같은 너비에서 휴대폰으로 봄
export const bucket = () => (matchMedia('(max-width: 700px)').matches ? 'narrow' : 'wide');
