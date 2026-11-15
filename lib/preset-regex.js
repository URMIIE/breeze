// 다른 프리셋의 정규식 목록 읽기.
// 프리셋을 ‘쓸 때만 받기’로 켜 두면(짝 서버 플러그인), 다른 프리셋을 읽을 때마다 그 프리셋 전체를 화면을 멈추고 받아서
// 켤 때 수십 번 멈췄다. 서버 플러그인이 있으면 모든 프리셋의 정규식만 한 번에(화면을 멈추지 않고) 받아 두고 그것을 쓴다.
// 없거나 아직 못 받았으면 예전처럼 프리셋 목록에서 읽는다(쓸 때만 받기가 꺼져 있으면 이미 다 받아져 있음).
const nfc = (s) => String(s ?? '').normalize('NFC');
let table = null;          // 프리셋 이름(NFC) → 정규식 목록
let loading = null;
const listeners = new Set();

export function loadPresetRegex() {
    loading ??= fetch('/api/plugins/breeze-server/preset-regex', { method: 'POST', headers: SillyTavern.getContext().getRequestHeaders(), body: '{}' })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
            if (!data || typeof data !== 'object') return;
            table = new Map(Object.entries(data).map(([k, v]) => [nfc(k), Array.isArray(v) ? v : []]));
            for (const fn of listeners) { try { fn(); } catch { /* 무시 */ } }
        })
        .catch(() => {});
    return loading;
}

/** 표가 들어오면 부를 것(기억해 둔 계산을 버리게) */
export function onPresetRegexLoaded(fn) { listeners.add(fn); if (table) fn(); }

/** 프리셋 하나의 정규식. 서버 표가 있으면 거기서, 없으면 프리셋 목록에서. 못 찾으면 null */
export function presetRegexOf(pm, name) {
    if (table) return table.has(nfc(name)) ? table.get(nfc(name)) : null;
    const { presets, preset_names } = pm.getPresetList('openai') || {};
    let idx = preset_names?.[name];
    if (idx === undefined) {
        const key = Object.keys(preset_names ?? {}).find(k => nfc(k) === nfc(name));
        idx = key === undefined ? undefined : preset_names[key];
    }
    if (idx === undefined) return null;
    const scripts = presets?.[idx]?.extensions?.regex_scripts;
    return Array.isArray(scripts) ? scripts : [];
}

/** 서버 표가 아직 없고, 쓸 때만 받기 때문에 읽으면 화면이 멈추는 프리셋인지 */
export function wouldBlock(pm, name) {
    if (table) return false;
    const { presets, preset_names } = pm.getPresetList('openai') || {};
    const key = Object.keys(preset_names ?? {}).find(k => nfc(k) === nfc(name));
    if (key === undefined) return false;
    const d = Object.getOwnPropertyDescriptor(presets, preset_names[key]);
    return !!d?.get;
}
