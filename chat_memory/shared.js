// 이 채팅 기억: 여러 파일이 같이 쓰는 것(설정 칸 · 화면 글 · 알림 · 지금 도는 일의 상태).
// 설정은 extension_settings.chatPresetMemory 에 둔다(따로 깔아 쓰던 때의 칸 그대로라 쓰던 값이 이어진다).
import { promptManager } from '../../../../openai.js';

export const MODULE = 'chatPresetMemory';
export const LOG = '[Chat Preset Memory]';
// 버튼 순서 = 두 묶음: 프롬프트 · 연결 · 정규식 | 월드인포 · 페르소나 AU · 캐릭터 AU
export const KINDS = ['toggles', 'connection', 'regex', 'world', 'persona', 'card'];
export const KIND_GROUPS = [['toggles', 'connection', 'regex'], ['world', 'persona', 'card']];
export const DEFAULTS = Object.freeze({ enabled: true, restorePreset: true, charDefault: true, notify: true, byChar: {}, pending: {}, showBar: true, barPos: 'top', kinds: { toggles: true, world: false, regex: false, connection: false, persona: false, card: false } });
export const ctx = () => SillyTavern.getContext();
// 이 확장 알림은 하나하나에 닫기 X 를 붙임(toastr 전체 설정은 다른 확장 알림까지 바뀌어서 건드리지 않음)
export const toast = Object.fromEntries(['info', 'success', 'warning', 'error'].map(k => [k, (msg, title, opts) => toastr[k](msg, title, { closeButton: true, toastClass: 'toast cpm-toast', ...opts })]));
export const nfc = (s) => String(s ?? '').normalize('NFC');


export let KO = {};
/** 화면 글 사전(영어 열쇠 → 한국어)을 읽음 */
export async function loadKo() {
    try { KO = await (await fetch(new URL('ko.json', import.meta.url))).json(); } catch { KO = {}; }
}
export function tr(strings, ...values) {
    const key = strings.reduce((r, s, i) => r + s + (values[i] !== undefined ? `\${${i}}` : ''), '');
    return (KO[key] ?? key).replace(/\$\{(\d+)\}/g, (m, i) => values[i]);
}

export function settings() {
    const all = ctx().extensionSettings;
    // 같은 객체를 그대로 씀(부를 때마다 새로 만들면, 한 줄에서 두 번 부를 때 앞 객체에 쓴 값이 사라짐)
    if (!all[MODULE] || typeof all[MODULE] !== 'object') all[MODULE] = {};
    for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in all[MODULE])) all[MODULE][k] = structuredClone(v);
    if (!all[MODULE].byChar || typeof all[MODULE].byChar !== 'object') all[MODULE].byChar = {};
    if (!all[MODULE].byCharTrimmed) {   // 예전에 쌓인 캐릭터별 마지막 설정도 한 번 줄임
        for (const [k, v] of Object.entries(all[MODULE].byChar)) all[MODULE].byChar[k] = trimChar(v);
        all[MODULE].byCharTrimmed = true;
    }
    if (!all[MODULE].pending || typeof all[MODULE].pending !== 'object') all[MODULE].pending = {};
    if (!Array.isArray(all[MODULE].files)) all[MODULE].files = [];   // 기억 파일이 있는 캐릭터 · 그룹 키: 주인이 없어진 파일을 지우려고
    // '켜기' · '마지막 프리셋으로도 바꾸기'는 설정 칸에서 뺌: 늘 켬 (확장 전체는 실리태번 확장 관리에서 끔)
    all[MODULE].enabled = true; all[MODULE].restorePreset = true;
    // '프롬프트 목록 위에도 설정 보이기' 기본값이 꺼짐이던 때 저장된 값은 한 번만 켬
    if (!all[MODULE].showBarSet) { all[MODULE].showBar = true; all[MODULE].showBarSet = true; }
    all[MODULE].kinds = { ...DEFAULTS.kinds, ...(all[MODULE].kinds || {}) };
    // 알림: 켜고 끄기(notify) + 알림에 보일 종류(notifyKinds): 예전 알림 모양(notifyMode) 값에서 한 번 이어받음
    if (!all[MODULE].notifyKinds || typeof all[MODULE].notifyKinds !== 'object') {
        const m = all[MODULE].notifyMode;
        if (m === 'off') all[MODULE].notify = false;
        all[MODULE].notifyKinds = Object.fromEntries(KINDS.map(k => [k, m !== 'plain']));
        delete all[MODULE].notifyMode;
    }
    all[MODULE].notifyKinds = { ...Object.fromEntries(KINDS.map(k => [k, true])), ...all[MODULE].notifyKinds };
    return all[MODULE];
}

/** Only for Chat Completion with an open chat */
export function usable() {
    const c = ctx();
    return settings().enabled && c.mainApi === 'openai' && !!c.getCurrentChatId() && !!promptManager?.activeCharacter;
}

export function charKey() {
    const c = ctx();
    if (c.groupId) return 'group:' + c.groupId;
    return c.characters?.[c.characterId]?.avatar || null;
}

/** 캐릭터별 마지막 설정은 새 채팅을 열 때만 쓰므로 최근에 쓴 프리셋 3개의 토글만 남김
 *  (예전엔 쓴 적 있는 프리셋 토글을 전부 들고 있어 설정 파일이 캐릭터 하나에 수백 KB까지 커졌음) */
export const CHAR_PRESETS = 3;
export function trimChar(m) {
    const keys = Object.keys(m?.byPreset || {});
    if (keys.length <= CHAR_PRESETS) return m;
    // 넣은 순서가 쓴 순서(merged 가 지금 프리셋을 맨 뒤에 다시 넣음): 지금 프리셋은 늘 남김
    const keep = new Set(keys.slice(-CHAR_PRESETS));
    for (const k of keys) if (nfc(k) === nfc(m.preset)) keep.add(k);
    return { ...m, byPreset: Object.fromEntries(keys.filter(k => keep.has(k)).map(k => [k, m.byPreset[k]])) };
}

// 지금 도는 일의 상태(여러 파일이 같이 읽고 씀).
// ready · readyChat: 기억을 시작한 채팅. 실리태번이 '지금 채팅'을 먼저 바꾸고 '채팅 바뀜' 신호는 늦게 보내서, 그 틈에 앞 채팅 상태가 새 채팅 기억으로 들어가지 않게 한다.
// restoring: 기억한 설정으로 맞추는 중, switching: 프리셋을 바꾸는 중(둘 다 그동안은 기억하지 않는다: 다른 채팅 · 다른 프리셋 상태가 섞이지 않게).
// lastEntries: 미리 읽어 둔 로어북 항목 켜짐 상태, lastToggleChanges: 방금 맞추며 바꾼 토글 이름(알림에서 펼쳐 봄)
export const S = { ready: false, readyChat: null, restoring: false, switching: false, seq: 0, running: Promise.resolve(), saveTimer: null, lastEntries: null, lastToggleChanges: { on: [], off: [] } };
