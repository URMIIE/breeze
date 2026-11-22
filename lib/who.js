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

// 화면 요소에 남은 표시로 찾기(누가 바꿨는지는 바뀐 뒤엔 스택에 안 남지만, 붙여 둔 이름은 그쪽 것에만 있음).
//  ① 클래스: 그 요소 자신의 클래스 중 실리태번 CSS 에는 없고 확장 CSS 파일에만 있는 것 → 그 파일의 주인
//     (부모 클래스까지 보면 실리태번이 CSS 없이 쓰는 클래스 · body 에 붙은 클래스 때문에 엉뚱한 확장을 짚었음)
//  ② data-* 표시: 그 이름을 확장 스크립트(화면에 불러온 파일 + 그 파일이 바로 불러오는 파일)의 글에서 찾음
// 파일을 여럿 읽으므로 '누가'를 화면에 보여 줄 때 한 번만 부를 것(결과는 표시별로 기억)
const markHits = new Map();
const isCore = (sheet) => !!sheet.href && !/\/scripts\/extensions\//.test(sheet.href) && sheet.href.startsWith(location.origin);
function classOwner(el) {
    const classes = new Set();
    for (const c of el.classList || []) if (!c.startsWith('etk-')) classes.add(c);
    if (!classes.size) return null;
    const has = (text, c) => new RegExp(`\\.${CSS.escape(c)}(?![\\w-])`).test(text);
    const sheets = [...document.styleSheets].map(sheet => { try { return { sheet, text: [...rulesOf(sheet.cssRules)].map(r => r.selectorText).join('\n') }; } catch { return null; } }).filter(Boolean);
    const core = sheets.filter(x => isCore(x.sheet)), ext = sheets.filter(x => /\/scripts\/extensions\//.test(x.sheet.href || '') && !ours(x.sheet));
    for (const c of classes) {
        if (core.some(x => has(x.text, c))) continue;
        const hit = ext.find(x => has(x.text, c));
        if (hit) return hit.sheet;
    }
    return null;
}
async function scriptOwner(marks) {
    // data-ab-cd 는 코드에서 dataset.abCd 로도 쓰임
    const words = marks.flatMap(n => [n, n.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]);
    // 켜 둔 확장의 시작 파일(manifest 의 js)부터
    const { extensionNames } = await import('/scripts/extensions.js');
    const off = new Set(SillyTavern.getContext().extensionSettings.disabledExtensions || []);
    const first = (await Promise.all(extensionNames.filter(n => !off.has(n) && n !== `third-party/${OWN}`).map(async (n) => {
        try { const m = await (await fetch(`/scripts/extensions/${n}/manifest.json`)).json(); return m.js ? new URL(`/scripts/extensions/${n}/${m.js}`, location.origin).href : null; } catch { return null; }
    }))).filter(Boolean);
    const seen = new Set(first), queue = first.map(u => [u, 0]);
    let read = 0;
    while (queue.length && read < 200) {
        const [url, depth] = queue.shift();
        let text = '';
        try { text = await (await fetch(url, { cache: 'force-cache' })).text(); } catch { continue; }
        read++;
        if (words.some(w => text.includes(w))) { const who = await fromUrl(url); if (who) return who; }
        // 그 파일이 불러오는 파일도 두 단계까지(묶어 만든 확장은 본문이 조각 파일에 있음)
        if (depth < 2) for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) { const next = new URL(m[1], url).href; if (!seen.has(next)) { seen.add(next); queue.push([next, depth + 1]); } }
        await new Promise(r => setTimeout(r, 0));   // 파일 사이마다 화면에 차례를 넘김
    }
    return UNKNOWN;
}
export function fromMarks(el) {
    if (!el) return Promise.resolve(UNKNOWN);
    const marks = [...el.attributes].map(a => a.name).filter(n => n.startsWith('data-') && !n.startsWith('data-etk') && n.length >= 8).sort();
    const key = `${[...el.classList].join('.')}|${marks.join(' ')}|${el.parentElement?.className || ''}`;
    if (!markHits.has(key)) markHits.set(key, (async () => {
        const sheet = classOwner(el);
        if (sheet) return fromSheet(sheet);
        return marks.length ? scriptOwner(marks) : UNKNOWN;
    })());
    return markHits.get(key);
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
