// 같은 일을 하는 쪽이 누구인지 찾기: 쉬는 중 표시에 '누가'를 채운다.
// 이름은 코드에 적지 않고 실행 중에 읽는다(확장은 그 폴더의 manifest.json display_name, 테마는 지금 테마 이름).
// 돌려주는 값: { kind: 'ext' | 'theme' | 'core' | 'unknown', name }. 못 찾으면 unknown(스크립트가 화면만 바꾼 경우 흔적이 안 남음).
const OWN = decodeURIComponent(import.meta.url.match(/\/third-party\/([^/]+)\//)?.[1] || 'breeze');
const UNKNOWN = { kind: 'unknown', name: '' };

const names = new Map();
export function extensionName(folder, builtIn = false) {
    const key = (builtIn ? 'core:' : '') + folder;
    if (!names.has(key)) {
        const url = builtIn ? `/scripts/extensions/${encodeURIComponent(folder)}/manifest.json` : `/scripts/extensions/third-party/${encodeURIComponent(folder)}/manifest.json`;
        names.set(key, fetch(url).then(r => (r.ok ? r.json() : null)).then(m => m?.display_name || folder).catch(() => folder));
    }
    return names.get(key);
}

// 파일 주소 하나 → 누구 것인지. breeze 자신은 null(건너뜀)
async function fromUrl(url) {
    const path = String(url || '').replace(/^https?:\/\/[^/]+/, '');
    const third = path.match(/\/scripts\/extensions\/third-party\/([^/]+)\//);
    if (third) {
        const folder = decodeURIComponent(third[1]);
        return folder === OWN ? null : { kind: 'ext', name: await extensionName(folder) };
    }
    const built = path.match(/\/scripts\/extensions\/([^/]+)\//);
    if (built) return { kind: 'ext', name: await extensionName(decodeURIComponent(built[1]), true) };
    if (/^\/(css\/|style\.css|scripts\/|script\.js|lib\/)/.test(path)) return { kind: 'core', name: '' };
    return undefined;   // 주소로는 모름
}

// 부른 코드의 파일 주소(오류 스택)에서 breeze 가 아닌 가장 가까운 쪽
export async function fromStack(stack) {
    for (const m of String(stack || '').matchAll(/(https?:\/\/[^\s)]+?\.js)/g)) {
        const who = await fromUrl(m[1]);
        if (who) return who;
    }
    return UNKNOWN;
}

export function theme() {
    const name = String(SillyTavern.getContext().powerUserSettings?.theme || '').normalize('NFC');
    return { kind: 'theme', name };
}

// 스타일시트 하나 → 누구 것인지: 테마 CSS(#custom-style) · 확장 파일(주소) · 실리태번 자체 · 그 밖(스크립트가 넣은 <style>)은 unknown
export async function fromSheet(sheet) {
    const node = sheet?.ownerNode;
    if (node?.id === 'custom-style') return theme();
    if (sheet?.href) return (await fromUrl(sheet.href)) ?? UNKNOWN;
    return UNKNOWN;
}

const ours = (sheet) => { const n = sheet?.ownerNode; return !!(n && ((n.id || '').startsWith('etk-') || (sheet.href || '').includes(`/third-party/${OWN}/`))); };
function* rulesOf(list) {
    for (const r of list) {
        if (r instanceof CSSStyleRule) yield r;
        if (r.cssRules) yield* rulesOf(r.cssRules);
    }
}

// el 에 prop 을 거는 CSS 규칙이 어느 스타일시트에 있는지(breeze 것은 뺌). 인라인 style 이면 스크립트가 건 것이라 unknown.
// test(값)을 주면 그 값일 때만. 창이 열릴 때처럼 가끔 한 번씩만 부를 것(시트를 다 훑음)
export async function styledBy(el, prop, test = (v) => !!v) {
    if (!el) return UNKNOWN;
    if (test(el.style?.getPropertyValue(prop))) return UNKNOWN;
    for (const sheet of [...document.styleSheets].reverse()) {
        if (ours(sheet)) continue;
        let list;
        try { list = sheet.cssRules; } catch { continue; }   // 다른 주소의 시트는 못 읽음
        for (const rule of rulesOf(list)) {
            if (!test(rule.style.getPropertyValue(prop))) continue;
            let hit = false;
            try { hit = el.matches(rule.selectorText); } catch { /* 브라우저가 모르는 선택자 */ }
            if (hit) return fromSheet(sheet);
        }
    }
    return UNKNOWN;
}

// 확장이 등록한 슬래시 명령의 주인(실리태번이 등록할 때 적어 둔 폴더 이름)
export async function commandOwner(cmd) {
    const src = String(cmd?.source || '');
    if (!src) return UNKNOWN;
    if (src.endsWith('.js')) return { kind: 'core', name: '' };
    if (src === OWN) return null;
    return { kind: 'ext', name: await extensionName(src) };
}
