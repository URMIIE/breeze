// 지금 테마 CSS(#custom-style) 감시 하나를 여러 기능이 같이 쓴다.
// 기능마다 따로 감시하면 테마를 바꿀 때마다 테마 CSS 전체를 여러 번 나눠 읽게 되고,
// #custom-style 은 설정을 불러올 때 늦게 생기므로 head 에 새로 생기는 것도 본다.
const listeners = new Set();
let started = false;
// 화면에 실제로 입혀진 테마 이름. 테마 파일을 불러오면 ‘지금 테마 이름’만 불러온 테마로 바뀌고 화면은 그대로라, 설정의 이름만 믿으면 안 입혀진 테마로 판정한다
let applied = null, importedAt = 0;
const settingName = () => String(globalThis.SillyTavern?.getContext().powerUserSettings?.theme ?? '');
export function appliedTheme() { return applied ?? settingName(); }

export function themeCss() {
    const css = document.getElementById('custom-style')?.textContent || '';
    const rules = [];
    for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
        const brace = rule.indexOf('{');
        if (brace >= 0) rules.push([rule.slice(0, brace), rule.slice(brace + 1)]);
    }
    return { css, rules };
}

function call(fn, info) {
    try { fn(info); } catch (error) { console.warn('[Breeze] 테마 판정', error); }
}

function watch() {
    started = true;
    let watched = null, t = 0;
    const run = () => {
        clearTimeout(t);
        t = setTimeout(() => { const info = themeCss(); for (const fn of listeners) call(fn, info); }, 100);
    };
    const obs = new MutationObserver(run);
    const attach = () => {
        const st = document.getElementById('custom-style');
        if (!st || st === watched) return;
        obs.disconnect();
        watched = st;
        obs.observe(st, { childList: true, characterData: true, subtree: true });
    };
    attach();
    new MutationObserver(() => { if (document.getElementById('custom-style') !== watched) { attach(); run(); } }).observe(document.head, { childList: true });
    // 테마를 고를 때도 한 번 더 알림: #custom-style 이 다른 곳에서 새로 만들어져 감시가 옛 요소에 남아 있으면 CSS 변화로는 못 알아챘음
    // (테마를 바꿔도 테마 전용 스크립트가 안 꺼짐). 다른 확장이 jQuery 로 일으킨 change 도 받게 jQuery 로 들음. 테마를 늦게 받아 오는 경우를 위해 조금 뒤 한 번 더
    const again = () => { attach(); run(); };
    applied = settingName();
    // 테마 파일을 불러오면 실리태번이 화면은 그대로 두고 저장된 테마 이름 · 드롭다운만 불러온 테마로 바꿔서, 다음 새로고침 때 그 테마로 넘어갔음 —
    // 불러오기가 이름을 바꾸면 지금 입혀진 테마로 바로 되돌림(불러온 테마는 목록에만 남음). 불러오기가 실패해 이름이 안 바뀌면 10초 뒤 그만 봄
    document.addEventListener('change', e => {
        if (e.target?.id !== 'ui_preset_import_file') return;
        importedAt = Date.now();
        const keep = appliedTheme();
        let n = 0;
        const t = setInterval(() => {
            const c = globalThis.SillyTavern?.getContext(), pu = c?.powerUserSettings;
            if (pu && keep && pu.theme !== keep) {
                clearInterval(t);
                pu.theme = keep;
                globalThis.jQuery?.('#themes').val(keep);
                c.saveSettingsDebounced();
            } else if (++n > 40) clearInterval(t);
        }, 250);
    }, true);
    globalThis.jQuery?.(document).on('change', '#themes', function () { importedAt = 0; applied = String(globalThis.jQuery('#themes').val() ?? settingName()); again(); setTimeout(again, 1200); });
    // 설정이 저장될 때 테마 이름이 달라져 있으면(다른 길로 테마가 바뀜) 알림
    try {
        const c = SillyTavern.getContext();
        let last = c.powerUserSettings?.theme;
        c.eventSource.on(c.eventTypes.SETTINGS_UPDATED, () => { const now = SillyTavern.getContext().powerUserSettings?.theme; if (now !== last) { last = now; if (Date.now() - importedAt < 300000) importedAt = 0; else applied = String(now ?? ''); again(); } });
    } catch { /* 신호를 못 걸어도 위 두 길로 */ }
}

/** fn 을 테마 CSS 가 바뀔 때마다 부른다. 부르면 바로 한 번. 돌려받은 함수를 부르면 그만 부름. */
export function onThemeCss(fn) {
    if (!started) watch();
    listeners.add(fn);
    call(fn, themeCss());
    return () => listeners.delete(fn);
}

/** 테마 이름 목록에서 지워진 테마를 뺌(실리태번 테마 고르기 칸 기준). 바뀌었으면 true */
export function dropGoneThemes(list) {
    const have = new Set([...document.querySelectorAll('#themes option')].map(o => o.value));
    if (!have.size || !Array.isArray(list)) return false;
    const keep = list.filter(t => have.has(t));
    if (keep.length === list.length) return false;
    list.splice(0, list.length, ...keep);
    return true;
}
