// 메시지별 정규식 유지: 답마다 그 답을 만든 프리셋의 정규식으로 그림.
// 화면에서는 더해서, 답이 만들어질 때 켜져 있던 정규식(전역 · 캐릭터 · 프리셋 전부)의 켜짐 · 꺼짐을 기억해 그대로 그림.
// 보낼 때는 지금 정규식을 따름(나중에 켠 토큰 줄이기 정규식이 예전 답에도 먹어야 해서).
// 프리셋마다 고유한 정규식(HUD · 상태창 그리기, 오래된 답 줄여 보내기)이 있는데, 채팅 중간에 프리셋을 바꾸면
// 예전 프리셋으로 만든 답이 날글로 보이고 줄이지 않은 채 AI에게 간다.
// → 메시지마다 그 답을 만든 프리셋을 적어 두고(extra.regex_preset), 지금 프리셋과 다르면
//   그 메시지에만 지금 프리셋 정규식 대신 만든 프리셋 정규식을 쓴다(화면 · 보내기 둘 다).
// 기록이 없는 예전 답은 프리셋 고유 정규식이 맞는지로 추측하고, 못 찾으면 가까운 답의 프리셋을 따른다.
// 화면 · 보내기 정규식을 바꾸는 데는 실리태번 regex/engine.js 의 setRegexScriptsProvider(본체에 넣은 연결 지점)가 필요하다.
// 연결 지점이 없는 실리태번에서도 새 답에 만든 프리셋을 적고, 번역기가 그 메시지의 카드 블록을 알아보는 데(scriptsFor)는 쓴다.
import { chat, chat_metadata, eventSource, event_types, main_api } from '../../../../../script.js';
import { getStringHash } from '../../../../utils.js';
import { extension_settings } from '../../../../extensions.js';
import { getPresetManager } from '../../../../preset-manager.js';
import { MessageFormatter, formatting_stage, hook_order } from '../../../../message-formatter.js';
import * as engine from '../../../regex/engine.js';
import { loadPresetRegex, onPresetRegexLoaded, presetRegexOf, wouldBlock } from '../lib/preset-regex.js';
import { promptManager } from '../../../../openai.js';

const API = 'openai';
const AI_OUTPUT = 2;
const nfc = (s) => String(s ?? '').normalize('NFC');

// 흔한 태그는 프리셋을 가리는 표시가 아님
const COMMON_TAGS = new Set(['div', 'span', 'p', 'br', 'hr', 'details', 'summary', 'font', 'b', 'i', 'u', 's', 'em', 'strong', 'img', 'style', 'script', 'thinking', 'think', 'content', 'a', 'ul', 'ol', 'li', 'q', 'code', 'pre', 'table', 'tr', 'td', 'th', 'small', 'center', 'blockquote', 'html', 'body', 'head', 'button', 'input', 'label', 'section', 'article', 'header', 'footer', 'sup', 'sub', 'svg', 'path', 'g', 'circle', 'rect', 'line', 'text', 'tbody', 'thead', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'iframe', 'canvas', 'video', 'audio', 'source', 'select', 'option', 'textarea', 'form', 'nav', 'main', 'aside', 'mark', 'del', 'ins', 'kbd', 'var', 'wbr', 'meta', 'link', 'title', 'noscript', 'template', 'slot', 'picture', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'abbr', 'cite', 'time', 'data', 'output', 'progress', 'meter', 'strike', 'tt', 'big', 'ruby', 'rt', 'rp']);
// 정규식 글에서: <이름 · <\/이름 · \[대문자_이름   메시지에서: <이름> · </이름> · [대문자_이름]
const SOURCE_MARK_RE = /<\\?\/?([A-Za-z_][\w-]*|[\u4e00-\u9fff]{1,8})|\\\[([A-Z][A-Z0-9_]{2,})/g;
const TEXT_MARK_RE = /<\/?([A-Za-z_][\w-]*|[\u4e00-\u9fff]{1,8})(?=[\s>/])|\[([A-Z][A-Z0-9_]{2,})\]/g;

function manager() {
    return main_api === API ? getPresetManager(API) : null;
}

function currentPreset() {
    return manager()?.getSelectedPresetName() ?? null;
}

function isAllowed(name) {
    const list = extension_settings?.preset_allowed_regex?.[API];
    return Array.isArray(list) && list.some(n => nfc(n) === nfc(name));
}

/** 프리셋 파일(불러온 값)에 든 정규식. 지금 프리셋은 고친 값이 반영된 실제 값. */
// 프리셋 정규식 목록도 한 번에 이어지는 호출 안에서는 이름마다 한 번만(지금 프리셋 이름을 화면에서 찾는 게 느려 메시지마다 하면 채팅 열기가 100ms 넘게 늘었음)
let presetScriptsCache = null;
function presetScripts(name) {
    if (!presetScriptsCache) { presetScriptsCache = new Map(); setTimeout(() => { presetScriptsCache = null; }, 0); }
    const k = nfc(name || '');
    if (!presetScriptsCache.has(k)) presetScriptsCache.set(k, presetScriptsRaw(name));
    return presetScriptsCache.get(k);
}
function presetScriptsRaw(name) {
    const pm = manager();
    if (!pm || !name) return null;
    if (nfc(name) === nfc(currentPreset())) {
        const live = pm.readPresetExtensionField({ path: 'regex_scripts' });
        return Array.isArray(live) ? live : [];
    }
    // 서버 표가 오기 전에, 읽으면 화면이 멈추는 프리셋은 건너뜀(표가 오면 다시 계산)
    if (wouldBlock(pm, name)) return null;
    return presetRegexOf(pm, name);
}

// ── 예전 답 추측 ─────────────────────────────────────────────

let signIndex = null; // { key, marks: Map<표시, 프리셋 이름[]> }

function marksOf(text, re) {
    const out = new Set();
    for (const m of String(text ?? '').matchAll(re)) {
        const name = (m[1] ?? m[2] ?? '').toLowerCase();
        if (name && !COMMON_TAGS.has(name)) out.add(name);
    }
    return out;
}

/** 프리셋마다 그 프리셋 정규식이 찾는 태그 · 표시 이름. 전역 정규식에도 있는 표시는 뺌. */
function buildSignIndex() {
    const pm = manager();
    if (!pm) return null;
    const allowed = (extension_settings?.preset_allowed_regex?.[API] ?? []).filter(Boolean);
    const { preset_names } = pm.getPresetList(API);
    const key = allowed.join('|') + '#' + Object.keys(preset_names ?? {}).length + '#' + currentPreset();
    if (signIndex?.key === key) return signIndex;

    const globalMarks = new Set();
    for (const s of extension_settings.regex ?? []) for (const m of marksOf(s.findRegex, SOURCE_MARK_RE)) globalMarks.add(m);
    const marks = new Map();
    const seen = new Set();
    for (const name of allowed) {
        if (seen.has(nfc(name))) continue;
        seen.add(nfc(name));
        const scripts = presetScripts(name);
        if (!scripts) continue;
        const own = new Set();
        for (const s of scripts) {
            if (s.disabled || !s.findRegex || !Array.isArray(s.placement) || !s.placement.includes(AI_OUTPUT)) continue;
            for (const m of marksOf(s.findRegex, SOURCE_MARK_RE)) if (!globalMarks.has(m)) own.add(m);
        }
        for (const m of own) {
            if (!marks.has(m)) marks.set(m, []);
            marks.get(m).push(name);
        }
    }
    signIndex = { key, marks };
    return signIndex;
}

function samePrefix(names) {
    const plain = names.map(n => nfc(n).replace(/[^\p{L}\p{N}]/gu, ''));
    const head = plain[0].slice(0, 4);
    return head.length >= 4 && plain.every(p => p.startsWith(head));
}

/** 메시지에 든 태그 · 표시를 정규식으로 찾는 프리셋. 드문 표시일수록 점수가 큼.
 *  지금 프리셋이 같은 점수면 지금 프리셋, 다른 계열끼리 같은 점수면 모름(null). */
function claim(text) {
    const index = buildSignIndex();
    if (!index || !text) return null;
    const score = new Map();
    for (const m of marksOf(text, TEXT_MARK_RE)) {
        const owners = index.marks.get(m);
        if (!owners) continue;
        for (const n of owners) score.set(n, (score.get(n) ?? 0) + 1 / owners.length);
    }
    if (!score.size) return null;
    const best = Math.max(...score.values());
    const winners = [...score].filter(([, v]) => Math.abs(v - best) <= 1e-9).map(([n]) => n);
    const cur = nfc(currentPreset());
    const mine = winners.find(n => nfc(n) === cur);
    if (mine) return mine;
    if (winners.length === 1 || samePrefix(winners)) return winners[winners.length - 1];
    return null;
}

/** 다른 확장이 그 답에 적어 둔 프리셋 이름 — 이 기록이 없는 옛 답도 원래 프리셋으로 그리려고.
 *  1) 답마다 extra.preset_stamp.preset 을 적는 꼴 (지금 스와이프의 swipe_info 먼저)
 *  2) chat_metadata.presetsBySwipeKey 에 ‘send_date(공백 빼고 소문자)_model_모델(소문자)’ 키로 프리셋 이름(글자) 또는 { genPreset } 을 적는 꼴 */
function stampedPreset(m) {
    const info = Array.isArray(m?.swipe_info) ? m.swipe_info[m.swipe_id ?? 0] : null;
    for (const st of [info?.extra?.preset_stamp, m?.extra?.preset_stamp]) if (st && typeof st.preset === 'string' && st.preset) return st.preset;
    const store = SillyTavern.getContext().chatMetadata?.presetsBySwipeKey;
    if (!store || typeof store !== 'object' || !m?.send_date) return null;
    const v = store[`${String(m.send_date).replace(/\s+/g, '').toLowerCase()}_model_${String(m.extra?.model || 'unknown').toLowerCase()}`];
    if (typeof v === 'string' && v) return v;
    return v && typeof v === 'object' && typeof v.genPreset === 'string' && v.genPreset ? v.genPreset : null;
}

let guessCache = new Map(); // index → { sig, value }

function claimAt(i) {
    const m = chat[i];
    if (!m || m.is_user || m.is_system) return null;
    if (m.extra?.regex_preset) return m.extra.regex_preset;
    const stamped = stampedPreset(m);
    if (stamped) return stamped;
    const sig = `${m.swipe_id ?? 0}:${m.mes?.length ?? 0}`;
    const hit = guessCache.get(i);
    if (hit && hit.sig === sig) return hit.value;
    const value = claim(m.mes);
    guessCache.set(i, { sig, value });
    return value;
}

/** 이 메시지를 만든 프리셋: 기록 → 고유 표시. 표시 없는 AI 답은 모름(지금 프리셋 그대로),
 *  기록 없는 내 글은 가까운 AI 답의 프리셋. */
function originOf(i) {
    const m = chat[i];
    if (!m || m.is_system) return null;
    if (m.extra?.regex_preset) return m.extra.regex_preset;
    if (!m.is_user) return claimAt(i);   // 다른 확장 기록 → 태그 짐작 순서 (claimAt)
    for (let d = 1; d < chat.length; d++) {
        for (const j of [i + d, i - d]) {
            const v = claimAt(j);
            if (v) return v;
        }
    }
    return null;
}

// ── 정규식 목록 바꾸기 ───────────────────────────────────────

let formattingId = null;
let opts = () => ({});   // 기능 설정(start 에서 이어 줌)

function findByText(raw) {
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.mes === raw) return i;
    }
    return null;
}

function provider(list, raw, placement, { isMarkdown, isPrompt, isEdit, depth }) {
    if (isEdit || !manager()) return null;
    const i = isMarkdown ? formattingId : isPrompt ? findByText(raw) : null;
    const base = scriptsFor(i);
    if (placement !== AI_OUTPUT) return base;
    // 한 답에 다른 프리셋의 상태창 · HUD 블록이 섞여 있으면(프리셋을 바꾼 뒤 AI 가 앞 답 형식을 따라 씀)
    // 화면에선 그 블록만 그 프리셋 정규식으로 그리고, 보낼 때는 지금 프리셋이 모르는 블록을 뺀다.
    if (isMarkdown) {
        const taken = [];
        const name = baseName(i);
        const snap = withSnapshot(i, base ?? list);
        const kept = withLooks(i, snap ?? base ?? list) ?? snap;
        const extra = [...foreignRenders(raw, name, taken), ...looseRenders(raw, kept ?? base ?? list, name, depth, taken)];
        return extra.length ? [...extra, ...(kept ?? base ?? list)] : (kept ?? base);
    }
    if (isPrompt) {
        const strip = opts().stripForeign === false ? null : foreignStripper(raw, currentPreset());
        return strip ? [...(base ?? list), strip] : base;
    }
    return base;
}

/** 이 메시지를 그리는 프리셋: 만든 프리셋(허용 목록에 있으면) 아니면 지금 프리셋 */
function baseName(i) {
    if (i === null || i === undefined || i < 0) return currentPreset();
    const origin = originOf(Number(i));
    return origin && isAllowed(origin) && presetScripts(origin) ? origin : currentPreset();
}

/** 이 메시지에 쓸 정규식 목록(만든 프리셋이 지금과 다를 때만), 아니면 null — 다른 확장도 같은 목록을 보게 */
function scriptsFor(i) {
    if (i === null || i === undefined || i < 0 || !manager()) return null;
    const origin = originOf(Number(i));
    if (!origin || nfc(origin) === nfc(currentPreset()) || !isAllowed(origin)) return null;
    const scripts = presetScripts(origin);
    if (!scripts) return null;
    const opts = { allowedOnly: true };
    return [
        ...engine.getScriptsByType(engine.SCRIPT_TYPES.GLOBAL, opts),
        ...scripts,
        ...engine.getScriptsByType(engine.SCRIPT_TYPES.SCOPED, opts),
    ];
}

// ── 답마다 그때 켜져 있던 정규식(화면에만) ───────────────────────
// 같은 켜짐 묶음은 채팅에 한 번만 적고(chat_metadata), 답에는 그 묶음 이름만 적음 — 답마다 목록을 적으면 채팅 파일이 커짐.
// 그때 있던 정규식은 그때 켜짐대로, 그 뒤에 새로 생긴 정규식은 그 답에 쓰지 않음. 지운 정규식은 되살리지 못하고, 내용을 고친 건 고친 대로.
const ON_KEY = 'regex_on_set';
const SETS_KEY = 'breeze_regex_sets';
const setCache = new Map();   // 묶음 이름 → { on: Set, off: Set }
function snapshotNow() {
    const on = [], off = [], names = [];
    for (const s of allowedScripts()) if (s?.id) { (s.disabled ? off : on).push(s.id); if (!s.disabled && s.scriptName) names.push(s.scriptName); }
    on.sort(); off.sort(); names.sort();
    const key = getStringHash(JSON.stringify([on, off])).toString(36);
    chat_metadata[SETS_KEY] ??= {};
    // 켜져 있던 정규식 이름도 적어 둠 — 정규식을 지웠다 다시 넣거나 다시 불러오면 id 가 바뀌어, id 만으로는 옛 메시지에서 꺼진 것으로 보였음
    chat_metadata[SETS_KEY][key] ??= { on, off, names };
    return key;
}
function snapshotOf(i) {
    const key = i === null || i === undefined ? null : chat[i]?.extra?.[ON_KEY];
    const raw = key && chat_metadata?.[SETS_KEY]?.[key];
    if (!raw) return null;
    let hit = setCache.get(key);
    if (!hit) setCache.set(key, hit = { on: new Set(raw.on || []), off: new Set(raw.off || []), names: new Set(raw.names || []) });
    return hit;
}
/** 그 답이 만들어질 때의 켜짐대로 바꾼 목록, 기록이 없거나 바꿀 게 없으면 null */
function withSnapshot(i, list) {
    const snap = snapshotOf(i);
    if (!snap || !Array.isArray(list)) return null;
    let changed = false;
    const out = list.map(s => {
        if (!s?.id) return s;
        const known = snap.on.has(s.id) || snap.off.has(s.id);
        const disabled = known ? !snap.on.has(s.id) : !snap.names.has(s.scriptName);   // 모르는 id: 그때 같은 이름이 켜져 있었으면(다시 넣은 정규식) 켜고, 아니면 그 뒤에 새로 생긴 정규식이라 끔
        if (!!s.disabled === disabled) return s;
        changed = true;
        return { ...s, disabled };
    });
    return changed ? out : null;
}

// 켜진 정규식 목록: 실리태번이 줄 때마다 지금 프리셋 이름을 화면에서 찾아(jQuery) 느려서, 한 번에 이어지는 호출(채팅을 열 때 메시지마다)은 한 번만 받아 씀
let allowedCache = null;
function allowedScripts() {
    if (!allowedCache) { allowedCache = engine.getRegexScripts({ allowedOnly: true }); setTimeout(() => { allowedCache = null; }, 0); }
    return allowedCache;
}

/** 다른 확장(번역기 문단 짝)용: 그 메시지를 실제로 그리는 목록 + 다른 프리셋 블록 자리 */
function displayScriptsFor(i) {
    const base = scriptsFor(i);
    const m = chat[i];
    if (!m || m.is_user) return base;
    const name = baseName(i);
    const snap = withSnapshot(i, base ?? allowedScripts());
    const list = snap ?? base ?? allowedScripts();
    const tags = foreignTags(m.mes, name);
    const taken = [];
    if (tags.size) foreignRenders(m.mes, name, taken);
    // 번역기에는 빌려 온 원래 정규식을 그대로 — 빈 상자로 넘기면 번역기가 그 칸의 글 자리(그룹)를 몰라 블록 전체를 번역 안 할 칸으로 두었다(머리줄 · 상태창이 원문 그대로)
    const loose = looseRenders(m.mes, list, name, chat.length - 1 - Number(i), taken).map(s => s.source ? { ...s.source, disabled: false, promptOnly: false, markdownOnly: true } : synthetic(s.findRegex, '<div></div>', { markdownOnly: true }));
    if (!tags.size && !loose.length) return snap ?? base;
    const all = [...tags.values()].flat();
    return [...list, ...(all.length ? [synthetic(blockRegex(all), '<div></div>', { markdownOnly: true })] : []), ...loose];
}

// ── 다른 프리셋 블록 ─────────────────────────────────────────
// ‘메타 블록’ = 그 프리셋이 스스로 오래된 답에서 지우는 태그(상태창 · HUD · 트래커). 이야기 본문 태그는 아님.

const SAMPLE = 'zqzq7';
let metaIndex = null; // { key, byPreset: Map<프리셋, Set<태그>> }

function parseRegex(src) {
    const m = String(src).trim().match(/^\/([\s\S]+)\/([a-z]*)$/i);
    return new RegExp(m ? m[1] : src, m ? m[2] : '');
}

// <(?:a|b|c) · <\/?(a|b) · <\s{0,8}(a|b) 처럼 묶음 안에 든 태그 이름도
const GROUP_MARK_RE = /<(?:\\?\/\??)?(?:\\s(?:\{[\d,]*\}|[*+?])?)?\((?:\?:)?([A-Za-z_][\w-]*(?:\|[A-Za-z_][\w-]*)+)\)/g;
function tagMarks(scripts) {
    const out = new Set();
    for (const s of scripts ?? []) {
        if (s?.disabled || !s?.findRegex) continue;
        const src = String(s.findRegex);
        for (const m of src.matchAll(SOURCE_MARK_RE)) if (m[1]) out.add(m[1].toLowerCase());
        for (const m of src.matchAll(GROUP_MARK_RE)) m[1].split('|').forEach(t => out.add(t.toLowerCase()));
    }
    return out;
}

/** 지금 캐릭터 카드 글이 쓰라고 한 태그(카드가 정한 블록은 프리셋 블록이 아님) */
function cardTags() {
    const ctx = globalThis.SillyTavern?.getContext?.();
    const ch = ctx?.characters?.[ctx?.characterId];
    const out = new Set();
    if (!ch) return out;
    const d = ch.data ?? ch;
    const text = [d.description, d.personality, d.scenario, d.first_mes, d.mes_example, d.system_prompt, d.post_history_instructions,
        ...(d.alternate_greetings ?? [])].filter(Boolean).join('\n');
    for (const m of text.matchAll(/<([A-Za-z_][\w-]*)(?=[\s>:/])/g)) out.add(m[1].toLowerCase());
    return out;
}

/** 프리셋이 보낼 때 지우는(내용을 없애는) 태그 — 매크로는 실행하지 않고 직접 맞춰 봄 */
function metaTagsOf(scripts) {
    const prompt = (scripts ?? []).filter(s => s && !s.disabled && s.promptOnly && s.findRegex
        && Array.isArray(s.placement) && s.placement.includes(AI_OUTPUT) && !/\{\{/.test(s.findRegex));
    const out = new Set();
    for (const tag of tagMarks(scripts)) {
        if (COMMON_TAGS.has(tag)) continue;
        const sample = `앞\n<${tag}>\n${SAMPLE}\n</${tag}>\n뒤`;
        for (const s of prompt) {
            let re;
            try { re = parseRegex(s.findRegex); } catch { continue; }
            const after = sample.replace(re, String(s.replaceString ?? '').replace(/\{\{[\s\S]*?\}\}/g, ''));
            if (!after.includes(SAMPLE) && after.includes('앞')) { out.add(tag); break; }
        }
    }
    return out;
}

function buildMetaIndex() {
    const pm = manager();
    if (!pm) return null;
    const allowed = (extension_settings?.preset_allowed_regex?.[API] ?? []).filter(Boolean);
    const key = allowed.join('|') + '#' + Object.keys(pm.getPresetList(API).preset_names ?? {}).length + '#' + currentPreset();
    if (metaIndex?.key === key) return metaIndex;
    const byPreset = new Map();
    const seen = new Set();
    for (const name of allowed) {
        if (seen.has(nfc(name))) continue;
        seen.add(nfc(name));
        const scripts = presetScripts(name);
        if (scripts) byPreset.set(name, { meta: metaTagsOf(scripts), known: tagMarks(scripts) });
    }
    metaIndex = { key, byPreset };
    return metaIndex;
}

/** 글에 든 다른 프리셋 메타 블록: Map<프리셋, 태그[]> — 기준 프리셋 · 전역 · 카드 정규식이 아는 태그는 뺌 */
function foreignTags(text, baseNameValue) {
    const index = buildMetaIndex();
    const out = new Map();
    if (!index || !text) return out;
    const present = new Set();
    for (const m of String(text).matchAll(/<([A-Za-z_][\w-]*)(?=[\s>:/])/g)) present.add(m[1].toLowerCase());
    if (!present.size) return out;
    const known = new Set([
        ...(index.byPreset.get(baseNameValue)?.known ?? tagMarks(presetScripts(baseNameValue))),
        ...tagMarks(extension_settings.regex),
        ...tagMarks(engine.getScriptsByType(engine.SCRIPT_TYPES.SCOPED, { allowedOnly: true })),
        ...cardTags(),
    ]);
    const claimed = new Set();
    for (const [name, { meta }] of index.byPreset) {
        if (nfc(name) === nfc(baseNameValue)) continue;
        const tags = [...meta].filter(t => present.has(t) && !known.has(t) && !claimed.has(t));
        if (!tags.length) continue;
        tags.forEach(t => claimed.add(t));
        out.set(name, tags);
    }
    return out;
}

// 실리태번 regexFromString 은 /…/ 안을 한 줄로만 읽으므로 줄바꿈도 \n 으로
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/[\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16));
const blockRegex = tags => `/<(${tags.map(escapeRe).join('|')})(?=[\\s>:/])[^>]*>[\\s\\S]*?<\\/\\1\\s*>/gi`;

function synthetic(findRegex, replaceString, flags) {
    return {
        id: 'preset-regex-keep', scriptName: '메시지별 정규식 유지: 다른 프리셋 블록', findRegex, replaceString,
        trimStrings: [], placement: [AI_OUTPUT], disabled: false, markdownOnly: false, promptOnly: false,
        runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null, ...flags,
    };
}

const renderCache = new Map();
/** 다른 프리셋 블록 덩어리(사이가 빈칸뿐인 블록은 한 덩어리)를 그 프리셋 화면 정규식으로 미리 그려 끼우는 정규식들 */
function foreignRenders(text, baseNameValue, taken = []) {
    const out = [];
    for (const [name, tags] of foreignTags(text, baseNameValue)) {
        const scripts = (presetScripts(name) ?? []).filter(s => s && !s.disabled && (!s.promptOnly || s.markdownOnly)   // 둘 다 켜진 정규식은 화면에도 적용됨
            && Array.isArray(s.placement) && s.placement.includes(AI_OUTPUT));
        const re = parseRegex(blockRegex(tags));
        const chunks = [];
        for (const m of text.matchAll(re)) {
            const last = chunks[chunks.length - 1];
            if (last && !text.slice(last.end, m.index).trim()) last.end = m.index + m[0].length;
            else chunks.push({ start: m.index, end: m.index + m[0].length });
        }
        for (const { start, end } of chunks) {
            taken.push({ start, end });
            const chunk = text.slice(start, end);
            const key = name + '\u0000' + chunk;
            let html = renderCache.get(key);
            if (html === undefined) {
                html = chunk;
                for (const s of scripts) html = engine.runRegexScript(s, html);
                if (renderCache.size > 200) renderCache.clear();
                renderCache.set(key, html);
            }
            // 바꿀 글의 $1 · $<이름> 은 실리태번이 묶음 자리로 읽으므로 $ 를 글자로
            out.push(synthetic(`/${escapeRe(chunk)}/`, html.replace(/\$(?=\d|<)/g, '&#36;'), { markdownOnly: true }));
        }
    }
    return out;
}

// ── 다른 프리셋 화면 정규식에 맞는 덩어리 ─────────────────────
// 메타 블록(보낼 때 지우는 태그)이 아닌 머리줄 · 상태창도 AI 가 앞 답 형식을 따라 쓰면 섞인다
// (태그 없는 ◆1◆ 꼴 머리줄 · 『…』 줄 등 — 그 프리셋은 화면에서만 그리고 보낼 때 안 지움).
// 답을 그리는 목록(만든 프리셋 · 전역 · 카드)이 건드리지 않은 자리에, 허용된 다른 프리셋의 ‘그리는’ 정규식
// (바꿀 글이 긴 HTML)이 맞으면 그 덩어리만 그 정규식으로 미리 그려 끼운다.
// 낱말 바꾸기 · 지우기 · 따옴표 색칠처럼 바꿀 글이 짧은 정규식, 매크로가 든 정규식, 본문 대부분을 감싸는 덩어리는 안 씀.

const DRAW_MIN = 150;      // ‘그리는’ 정규식으로 볼 바꿀 글 길이
const WHOLE_SHARE = 0.6;   // 덩어리가 답 글의 이만큼 넘으면 본문을 감싼 것으로 보고 안 씀
const CHUNK_MIN = 20;      // 빈칸 빼고 이보다 짧은 덩어리는 안 그림

function depthOk(s, depth) {
    if (typeof depth !== 'number') return true;
    if (s.minDepth !== null && s.minDepth !== undefined && !isNaN(s.minDepth) && s.minDepth >= -1 && depth < s.minDepth) return false;
    if (s.maxDepth !== null && s.maxDepth !== undefined && !isNaN(s.maxDepth) && s.maxDepth >= 0 && depth > s.maxDepth) return false;
    return true;
}

function shownOn(s, depth) {
    return s && !s.disabled && s.findRegex && (!s.promptOnly || s.markdownOnly) && Array.isArray(s.placement) && s.placement.includes(AI_OUTPUT) && depthOk(s, depth);
}

function compileAll(s) {
    let src = String(s.findRegex);
    if (Number(s.substituteRegex) && /\{\{/.test(src)) {
        const sub = globalThis.SillyTavern?.getContext?.()?.substituteParams;
        if (typeof sub !== 'function') return null;
        src = sub(src);
    }
    let re;
    try { re = engine.RegexProvider?.instance?.get(src) ?? parseRegex(src); } catch { return null; }
    if (!re) return null;
    return new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
}

function rangesOf(s, text) {
    const re = compileAll(s);
    if (!re) return [];
    const out = [];
    for (const m of text.matchAll(re)) {
        if (m[0]) out.push({ start: m.index, end: m.index + m[0].length });
        if (out.length > 200) break;
    }
    return out;
}

// 정규식이 맞으려면 글에 꼭 있어야 하는 글자(묶음 밖 · 생략 안 되는 글자 줄 중 가장 긴 것). 없거나 못 찾으면 null(늘 돌림).
// 다른 프리셋 정규식을 메시지마다 다 돌리면 긴 답 하나에 수십 ms 라, 이 글자가 없는 정규식은 건너뛴다.
const anchorMemo = new Map();
function anchorOf(findRegex) {
    const key = String(findRegex);
    if (anchorMemo.has(key)) return anchorMemo.get(key);
    const m = key.trim().match(/^\/([\s\S]+)\/([a-z]*)$/i);
    const src = m ? m[1] : key;
    const fold = /i/.test(m?.[2] ?? '');
    const runs = [];
    let run = '', depth = 0, cls = false, alt = false;
    const cut = () => { if (run.length >= 2) runs.push(run); run = ''; };
    for (let k = 0; k < src.length; k++) {
        const ch = src[k];
        if (cls) { if (ch === '\\') k++; else if (ch === ']') cls = false; continue; }
        if (ch === '\\') {
            const nx = src[++k];
            if (nx !== undefined && /[^\w]/.test(nx) && depth === 0) run += nx; else cut();
            continue;
        }
        if (ch === '[') { cut(); cls = true; continue; }
        if (ch === '(') { cut(); depth++; continue; }
        if (ch === ')') { depth = Math.max(0, depth - 1); cut(); continue; }
        if (ch === '|' && depth === 0) { alt = true; break; }
        if ('?*{'.includes(ch)) { run = run.slice(0, -1); cut(); continue; }
        if ('+.^$}'.includes(ch)) { cut(); continue; }
        if (depth === 0) run += ch; else cut();
    }
    cut();
    const best = alt || !runs.length ? null : runs.sort((a, b) => b.length - a.length)[0];
    const value = best ? (fold ? best.toLowerCase() : best) : null;
    anchorMemo.set(key, { value, fold });
    return anchorMemo.get(key);
}
function mayMatch(s, text, lower) {
    const { value, fold } = anchorOf(s.findRegex);
    return !value || (fold ? lower() : text).includes(value);
}

const overlaps = (a, list) => list.some(b => a.start < b.end && a.end > b.start);

const looseCache = new Map();
function looseRenders(text, baseList, baseNameValue, depth, taken) {
    const pm = manager();
    if (!pm || !text) return [];
    const allowed = (extension_settings?.preset_allowed_regex?.[API] ?? []).filter(Boolean);
    const key = `${baseNameValue}\u0000${depth}\u0000${taken.map(t => t.start + '-' + t.end).join(',')}\u0000${text}`;
    if (looseCache.has(key)) return looseCache.get(key);

    let low = null;
    const lower = () => (low ??= text.toLowerCase());
    // 먼저 다른 프리셋 그리는 정규식 중 이 글에 맞을 수 있는 것만 — 하나도 없으면 기준 목록도 안 돌림
    const baseSrcAll = new Set((baseList ?? []).map(s => String(s?.findRegex ?? '')));
    const seenName0 = new Set([nfc(baseNameValue)]);
    const candidates = [];
    const seen0 = new Set();
    for (const name of allowed) {
        if (seenName0.has(nfc(name))) continue;
        seenName0.add(nfc(name));
        for (const s of presetScripts(name) ?? []) {
            const src = String(s?.findRegex ?? '');
            if (!shownOn(s, depth) || /\{\{/.test(src) || baseSrcAll.has(src) || seen0.has(src)) continue;
            const rep = String(s.replaceString ?? '');
            if (rep.length < DRAW_MIN || !rep.includes('<')) continue;
            seen0.add(src);
            if (mayMatch(s, text, lower)) candidates.push(s);
        }
    }
    if (!candidates.length) { if (looseCache.size > 200) looseCache.clear(); looseCache.set(key, []); return []; }

    // 기준 목록이 아는 자리는 깊이 · 화면/보내기 상관없이 그쪽 몫 — 일부러 최근 몇 개에만 그리는 카드 정규식이
    // 오래된 답에서 쉬는 걸 다른 프리셋이 대신 그리지 않게
    // 전역 정규식은 안 봄: 지금 전역 정규식(줄 앞 공백 빼기처럼 블록 안 몇 글자만 고치는 것까지)이 그 자리를 가져가
    // 예전 답의 프리셋 꾸밈이 빠졌음. 지금 정규식이 그때 그린 모양을 정하면 안 됨
    const globalIds = new Set((extension_settings.regex ?? []).map(s => s?.id).filter(Boolean));
    const covered = [...taken];
    for (const s of baseList ?? []) {
        if (!s || globalIds.has(s.id) || s.disabled || !s.findRegex || !Array.isArray(s.placement) || !s.placement.includes(AI_OUTPUT) || !mayMatch(s, text, lower)) continue;
        covered.push(...rangesOf(s, text));
    }
    // 다만 전역 정규식이 그 자리를 통째로 지우는 것(바꿀 글이 빈 정규식이 블록의 절반 넘게 맞음: 생각 블록 지우기 등)이면 지우려는 뜻이 분명하므로
    // 다른 프리셋 꾸밈을 빌려 오지 않음 — 빌려 온 꾸밈이 먼저 돌아, 지워야 할 생각 블록이 다른 프리셋 모양의 상자로 그려졌음
    const erased = [];
    for (const s of baseList ?? []) {
        if (!s || !globalIds.has(s.id) || s.disabled || s.promptOnly || !s.findRegex || String(s.replaceString ?? '').trim() || !Array.isArray(s.placement) || !s.placement.includes(AI_OUTPUT) || !mayMatch(s, text, lower)) continue;
        erased.push(...rangesOf(s, text));
    }
    const wiped = (r) => erased.some(e => Math.min(e.end, r.end) - Math.max(e.start, r.start) > (r.end - r.start) / 2);
    const size = text.replace(/\s+/g, '').length;
    const out = [];
    for (const s of candidates) {
        for (const r of rangesOf(s, text)) {
            if (wiped(r)) continue;
            const chunk = text.slice(r.start, r.end);
            const solid = chunk.replace(/\s+/g, '').length;
            // 짧은 조각(끝 태그만 남은 것 등)은 빈 카드가 됨
            if (solid < CHUNK_MIN || solid > size * WHOLE_SHARE || overlaps(r, covered)) continue;
            const html = engine.runRegexScript(s, chunk);
            if (!html || html === chunk) continue;   // 따로 떼면 안 맞는 정규식(앞뒤 글을 보는 것)
            covered.push(r);
            out.push(synthetic(`/${escapeRe(chunk)}/`, html.replace(/\$(?=\d|<)/g, '&#36;'), { markdownOnly: true, source: s }));
        }
    }
    if (looseCache.size > 200) looseCache.clear();
    looseCache.set(key, out);
    return out;
}

/** 보낼 때: 지금 프리셋이 모르는 다른 프리셋 메타 블록을 지우는 정규식 */
function foreignStripper(text, currentName) {
    const tags = [...foreignTags(text, currentName).values()].flat();
    if (!tags.length) return null;
    return synthetic(blockRegex(tags).replace(/^\/</, '/[ \\t]*<').replace(/\/gi$/, '[ \\t]*\\n?/gi'), '', { promptOnly: true });
}

// ── 답마다 그린 꾸밈 ─────────────────────────────────────────
// 같은 태그를 다른 모양으로 그리는 꾸밈 정규식(선택지 · 요약 · 머리줄 모양 여러 개)은 둘 다 켜면 앞 순서 것이 모든 답을 가져가고,
// 하나만 켜면 다른 모양으로 받은 예전 답까지 바뀐다. → 답을 받을 때 실제로 그 답을 그린 꾸밈을 적어 두고(extra.regex_looks),
// 그 답을 그릴 때는 적어 둔 꾸밈을 (지금 꺼져 있어도) 다른 꾸밈보다 앞에 둬 먼저 가져가게 한다. 기록 없는 예전 답은 그대로.
const LOOKS_KEY = 'regex_looks';
function isLook(s) {
    return !!s?.id && s.markdownOnly && !s.promptOnly && Array.isArray(s.placement) && s.placement.includes(AI_OUTPUT) && String(s.replaceString ?? '').trim() !== '';
}
/** 이 글을 실제로 그리는 꾸밈들(켜진 것, 앞 순서가 먼저 가져감) */
function looksOf(text, scripts, depth) {
    const out = [], taken = [];
    let lower = null;
    const low = () => (lower ??= text.toLowerCase());
    for (const s of scripts || []) {
        if (!isLook(s) || !shownOn(s, depth) || !mayMatch(s, text, low)) continue;
        const ranges = rangesOf(s, text).filter(r => !overlaps(r, taken));
        if (!ranges.length) continue;
        out.push(s.id);
        taken.push(...ranges);
    }
    return out;
}
/** 적어 둔 꾸밈을 켜서 제자리에 두고, 그보다 앞에 있던 다른 꾸밈은 마지막 적어 둔 꾸밈 뒤로 미룬 목록, 바꿀 게 없으면 null.
 *  적어 둔 꾸밈을 통째로 앞당기면 그 앞의 지우기 정규식(생각 칸 지우기 등)보다 먼저 돌아,
 *  지워질 글 안의 같은 표시부터 잡아 칸이 부서졌음 — 지우기 순서는 그대로 두고 꾸밈끼리만 순서를 바꿈. */
function withLooks(i, list) {
    const ids = i === null || i === undefined ? null : chat[i]?.extra?.[LOOKS_KEY];
    if (!Array.isArray(ids) || !ids.length || !Array.isArray(list)) return null;
    const want = new Set(ids);
    let last = -1;
    list.forEach((s, idx) => { if (want.has(s?.id)) last = idx; });
    if (last < 0) return null;
    const out = [], moved = [];
    list.forEach((s, idx) => {
        if (want.has(s?.id)) out.push(s.disabled ? { ...s, disabled: false } : s);
        else if (idx < last && isLook(s)) moved.push(s);
        else out.push(s);
        if (idx === last) out.push(...moved);
    });
    return out;
}
function recordLooks(id, m) {
    try {
        const list = scriptsFor(id) ?? allowedScripts();   // regex_preset 을 먼저 적으므로 그 프리셋 목록
        const ids = looksOf(String(m.mes ?? ''), list, chat.length - 1 - id);
        if (ids.length) m.extra[LOOKS_KEY] = ids; else delete m.extra[LOOKS_KEY];
        return ids;
    } catch (error) {
        console.warn('[Breeze] 답 꾸밈 기록 실패', error);
        return null;
    }
}

// ── 토글을 켜면 짝 꾸밈도 켜기 ───────────────────────────────
// 머리줄 · 상태창 · 선택지 토글은 모델에게 쓸 꼴(태그)을 알려 주고, 그 꼴을 그리는 꾸밈 정규식은 따로 켜야 해서 하나만 켜면 날글로 보였다.
// 짝 찾기: 토글 글 안의 꼴 예시에 실제로 맞는 꾸밈(같은 프리셋 · 바꿀 글 있음). 이미 맞는 꾸밈이 켜져 있으면 그대로,
// 여럿이 맞으면 태그 모음이 토글과 가장 비슷한 것, 그래도 같으면(같은 꼴의 다른 모양) 목록에서 앞의 것. 끄는 쪽은 건드리지 않음(예전 답 모양 유지).
const TAG_SET_RE = /<\\?\/?([A-Za-z_][\w-]*|[\u4e00-\u9fff]{1,8})/g;
const tagSet = (text) => new Set([...String(text ?? '').matchAll(TAG_SET_RE)].map(m => m[1]).filter(t => !COMMON_TAGS.has(t.toLowerCase())));
/** 이 정규식이 꾸밈 자리 대부분(절반 넘게)을 차지하나 — 그 블록을 통째로 지우거나 그리는 것만 ‘이미 맡음’으로 봄.
 *  주석 지우기 · 표 구분선 지우기처럼 안쪽 일부만 건드리는 정규식은 아님 */
const covers = (rs, lookRanges) => rs.some(r => lookRanges.some(l => Math.min(r.end, l.end) - Math.max(r.start, l.start) >= (l.end - l.start) / 2));
function pairFor(content, scripts, others = [], declined = new Set()) {
    const text = String(content ?? '');
    if (!text.trim()) return null;   // 꼴은 태그만이 아님(`:::이름 |…` 같은 줄 꼴) — 맞는지는 정규식으로만 봄
    let low = null;
    const lower = () => (low ??= text.toLowerCase());
    const ranged = (s) => (s?.findRegex && Array.isArray(s.placement) && s.placement.includes(AI_OUTPUT) && (s.markdownOnly || !s.promptOnly) && mayMatch(s, text, lower)) ? rangesOf(s, text) : [];
    const looks = [];
    for (const s of scripts) { if (!isLook(s)) continue; const rs = ranged(s); if (rs.length) looks.push([s, rs]); }
    if (!looks.length) return null;
    const lookRanges = looks.flatMap(([, rs]) => rs);
    // 그 자리를 이미 맡은 켜진 정규식(프리셋 · 전역 · 카드 — 지우는 것 포함)이 있으면 그대로: 일부러 숨겨 둔 블록(생각 등)을 꾸밈으로 바꾸지 않게
    for (const s of [...scripts, ...others]) { if (!s || s.disabled) continue; const rs = ranged(s); if (rs.length && covers(rs, lookRanges)) return null; }
    const hits = looks.map(([s]) => s).filter(s => s.disabled && !declined.has(s.id));
    if (!hits.length) return null;
    const mine = tagSet(text);
    const score = (s) => { const q = tagSet(s.findRegex); let both = 0; for (const t of q) if (mine.has(t)) both++; return both / Math.max(1, new Set([...q, ...mine]).size); };
    let best = hits[0], top = score(best);
    for (const s of hits.slice(1)) { const v = score(s); if (v > top) { best = s; top = v; } }
    return best;
}
// 짝 켜기로 켠 꾸밈 · 그 뒤 사용자가 끈 꾸밈(다시 켜지 않음)을 프리셋별로 이 브라우저에 기억
const PAIR_STORE = 'ltp-pair-looks-v1';
function pairStore() { try { return JSON.parse(localStorage.getItem(PAIR_STORE) || '{}') || {}; } catch { return {}; } }
function savePairStore(v) { try { localStorage.setItem(PAIR_STORE, JSON.stringify(v)); } catch { /* 저장 못 함 */ } }
let pairing = false, pairSig = '';
// 토글을 눌러 껐을 때 짝 꾸밈도 끄려고, 프리셋마다 지난번에 켜져 있던 토글을 기억(이 탭에서만 — 새로고침 뒤 첫 번엔 아무것도 안 끔)
const lastEnabled = new Map();
const fits = (s, text) => { let low = null; return mayMatch(s, text, () => (low ??= text.toLowerCase())) && rangesOf(s, text).length > 0; };
/** 화면의 최근 답 가운데 꾸밈 기록이 없는 것(기록 있는 답은 꺼진 꾸밈도 답마다 켜서 그림) */
function unrecordedTexts() {
    const chat = globalThis.SillyTavern?.getContext?.()?.chat || [];
    return chat.slice(-40).filter(m => m && !m.is_user && !Array.isArray(m.extra?.regex_looks) && typeof m.mes === 'string').map(m => m.mes);
}
// 토글을 켤 때 정규식을 같이 켜는 일을 다른 확장도 할 수 있다. 이름으로 찾지 않고 실제로 한 일을 본다:
// 토글을 누른 순간 지금 프리셋 정규식의 켜짐 상태를 떠 두고, 잠깐 기다렸다가 그사이 누가 바꿨으면 이번엔 손대지 않음(두 쪽이 서로 켜고 끄지 않게)
const regexState = () => {
    try { return (manager()?.readPresetExtensionField({ path: 'regex_scripts' }) || []).map(x => (x?.disabled ? 0 : 1)).join(''); } catch { return ''; }
};
async function pairAfterClick() {
    const before = regexState();
    await new Promise(r => setTimeout(r, 400));
    if (regexState() !== before) { pairSig = ''; return; }
    pairLooks(true);
}
async function pairLooks(fromClick = false) {
    const pm = manager();
    if (pairing || !pm || !promptManager?.activeCharacter || opts().pairLooks === false) return;
    const name = currentPreset();
    if (!name || !isAllowed(name)) return;
    pairing = true;
    try {
        const scripts = pm.readPresetExtensionField({ path: 'regex_scripts' });
        if (!Array.isArray(scripts) || !scripts.length) return;
        const order = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter) || [];
        const store = pairStore();
        const mine = store[nfc(name)] ??= { paired: [], declined: [] };
        mine.offed ??= []; mine.kept ??= [];
        // 짝 켜기로 켰던 것을 사용자가 끄면 거절로 기억
        const byId = new Map(scripts.map(s => [s?.id, s]));
        let changed = false;
        for (const id of [...mine.paired]) {
            const s = byId.get(id);
            if (!s || s.disabled) { mine.paired = mine.paired.filter(x => x !== id); if (s && !mine.declined.includes(id)) mine.declined.push(id); changed = true; }
        }
        // 토글을 꺼서 같이 껐던 꾸밈을 사용자가 다시 켰으면, 그 꾸밈은 앞으로 끄지 않음
        for (const id of [...mine.offed]) {
            const s = byId.get(id);
            if (!s || !s.disabled) { mine.offed = mine.offed.filter(x => x !== id); if (s && !mine.kept.includes(id)) mine.kept.push(id); changed = true; }
        }
        const enabled = order.filter(e => e?.enabled).map(e => promptManager.getPromptById(e.identifier)).filter(p => p?.content);
        const before = lastEnabled.get(nfc(name));
        lastEnabled.set(nfc(name), new Set(order.filter(e => e?.enabled).map(e => e.identifier)));
        // 방금 눌러 끈 토글: 그 글의 꼴을 그리는 켜진 꾸밈은, 같은 꼴을 쓰는 다른 켜진 토글이 없고 화면에 기록 없는 그 꼴 답도 없으면 같이 끔
        const dropped = [];
        if (fromClick && before) {
            const justOff = order.filter(e => e && !e.enabled && before.has(e.identifier)).map(e => promptManager.getPromptById(e.identifier)).filter(p => p?.content);
            if (justOff.length) {
                const kept = new Set(mine.kept);
                let shown = null;
                for (const s of scripts) {
                    if (!isLook(s) || s.disabled || kept.has(s.id)) continue;
                    const owner = justOff.find(p => fits(s, p.content));
                    if (!owner || enabled.some(p => fits(s, p.content))) continue;
                    if ((shown ??= unrecordedTexts()).some(t => fits(s, t))) continue;
                    s.disabled = true;
                    dropped.push([owner.name || owner.identifier, s]);
                    mine.paired = mine.paired.filter(x => x !== s.id);
                    if (!mine.offed.includes(s.id)) mine.offed.push(s.id);
                    changed = true;
                }
            }
        }
        // 켜진 토글 · 그 글 · 정규식 켜짐이 지난번과 같으면 다시 맞춰 보지 않음
        const sig = nfc(name) + '\u0001' + enabled.map(p => p.identifier + ':' + p.content.length).join(',') + '\u0001' + scripts.map(s => (s?.disabled ? 0 : 1)).join('') + '\u0001' + mine.declined.join(',');
        if (sig === pairSig && !dropped.length) { if (changed) savePairStore(store); return; }
        pairSig = sig;
        const others = [...engine.getScriptsByType(engine.SCRIPT_TYPES.GLOBAL, { allowedOnly: true }), ...engine.getScriptsByType(engine.SCRIPT_TYPES.SCOPED, { allowedOnly: true })];
        const declined = new Set(mine.declined);
        const turned = [];
        for (const prompt of enabled) {
            const pick = pairFor(prompt.content, scripts, others, declined);
            if (!pick || !pick.disabled) continue;
            pick.disabled = false;
            turned.push([prompt.name || prompt.identifier, pick]);
            if (!mine.paired.includes(pick.id)) mine.paired.push(pick.id);
            mine.offed = mine.offed.filter(x => x !== pick.id);
            changed = true;
        }
        if (changed) savePairStore(store);
        if (!turned.length && !dropped.length) return;
        pairSig = '';   // 켠 뒤 상태로 다음에 다시 잼
        await pm.writePresetExtensionField({ path: 'regex_scripts', value: scripts });
        for (const [list, off] of [[turned, false], [dropped, true]]) for (const [, s] of list) { const box = document.querySelector(`#saved_preset_scripts [id="${CSS.escape(s.id)}"] .disable_regex`); if (box) box.checked = off; }
        renderCache.clear(); looseCache.clear();
        const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
        const say = (list) => list.map(([p, s]) => `${esc(p)} → ${esc(s.scriptName)}`).join('<br>');
        if (turned.length) globalThis.toastr?.info(say(turned), '짝 꾸밈 정규식도 켰어요', { escapeHtml: false, timeOut: 6000 });
        if (dropped.length) globalThis.toastr?.info(say(dropped), '짝 꾸밈 정규식도 껐어요', { escapeHtml: false, timeOut: 6000 });
    } catch (error) {
        console.warn('[Breeze] 짝 꾸밈 켜기 실패', error);
    } finally {
        pairing = false;
    }
}

// ── 새 답에 기록 ─────────────────────────────────────────────

// 프리셋을 쓴 시각 기록 — 답이 늦게 붙어도(백그라운드 답장이 다른 채팅에 갔다 오거나 프리셋을 바꾼 뒤 붙임)
// 그 답의 생성 시작 시각(gen_started)에 쓰던 프리셋으로 적음. 이 브라우저에 최근 50개.
const PRESET_TIMELINE = 'ltp-preset-timeline-v1';
function timeline() { try { const v = JSON.parse(localStorage.getItem(PRESET_TIMELINE) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function notePreset() {
    const name = currentPreset();
    if (!name) return;
    const list = timeline();
    if (list.at(-1)?.name === name) return;
    list.push({ at: Date.now(), name });
    try { localStorage.setItem(PRESET_TIMELINE, JSON.stringify(list.slice(-50))); } catch { /* 저장 못 함 */ }
}
/** 그 시각에 쓰던 프리셋, 모르면 null */
function presetAt(when) {
    const t = new Date(when ?? NaN).getTime();
    if (!Number.isFinite(t)) return null;
    const list = timeline();
    let hit = null;
    for (const e of list) if (e.at <= t) hit = e; else break;
    return hit?.name ?? null;
}

function record(id, type) {
    if (type === 'first_message') return;
    const m = chat[id];
    const started = m?.is_user ? null : (m?.swipe_info?.[m.swipe_id ?? 0]?.gen_started ?? m?.gen_started);
    const name = presetAt(started) ?? currentPreset();
    if (!m || m.is_system || !name) return;
    m.extra ??= {};
    m.extra.regex_preset = name;
    const onSet = snapshotNow();
    m.extra[ON_KEY] = onSet;
    const looks = m.is_user ? null : recordLooks(id, m);
    const swipe = m.swipe_info?.[m.swipe_id ?? 0];
    if (swipe) {
        swipe.extra ??= {};
        swipe.extra.regex_preset = name;
        swipe.extra[ON_KEY] = onSet;
        if (looks?.length) swipe.extra[LOOKS_KEY] = looks; else delete swipe.extra[LOOKS_KEY];
    }
    guessCache.delete(id);
}

let already = false, started = false;
// 다른 곳에서 같은 기능이 먼저 돌고 있으면(같은 이름표 Symbol.for('preset-regex-keep')) 그쪽에 맡김. 번역 확장이 이 이름표로 scriptsFor 를 찾아 씀
export function start(api) {
    opts = () => api.options();
    if (started) return;
    started = true;
    loadPresetRegex();
    onPresetRegexLoaded(() => { signIndex = null; metaIndex = null; renderCache.clear(); looseCache.clear(); guessCache = new Map(); });
    already = !!globalThis[Symbol.for('preset-regex-keep')];
    if (already) api.rest('same', { saw: '같은 기능이 먼저 돌고 있다는 표시(preset-regex-keep)가 있어요', who: { kind: 'unknown' }, back: '그쪽을 끄고 새로고침하면 breeze가 맡아요.' });
if (!already && typeof engine.setRegexScriptsProvider !== 'function') {
    console.info('[Breeze] 본체에 정규식 연결 지점이 없어 만든 프리셋 정규식으로 그리기는 쉬어요(기록만 해요). 짝 서버 플러그인을 넣으면 켜져요');
}
if (!already) {
    if (typeof engine.setRegexScriptsProvider === 'function') {
        engine.setRegexScriptsProvider(provider);
    MessageFormatter.addHook((mes, ctx) => {
        formattingId = ctx.messageId ?? null;
        return mes;
    }, { stage: formatting_stage.BEFORE_REGEX, order: hook_order.LATEST });
    MessageFormatter.addHook((mes) => {
        formattingId = null;
        return mes;
    }, { stage: formatting_stage.AFTER_REGEX, order: hook_order.EARLIEST });
    }
    eventSource.on(event_types.MESSAGE_RECEIVED, record);
    eventSource.on(event_types.MESSAGE_SENT, (id) => record(id));
    // 새 스와이프는 앞 스와이프의 extra(그 프리셋 기록)를 그대로 물려받아, 답이 다 올 때까지
    // 앞 프리셋 정규식으로 그려졌다(새 답이 앞 프리셋 정규식으로 날글로 보임). 생성 시작 때 메시지 기록만 지금 프리셋으로.
    // swipe_info 는 아직 앞 스와이프 자리일 수 있어 건드리지 않음 — 끝나면 MESSAGE_RECEIVED 가 둘 다 적고, 취소하면 원래대로 돌아옴.
    eventSource.on(event_types.GENERATION_STARTED, (type, _opts, dryRun) => {
        if (dryRun || type !== 'swipe') return;
        const id = chat.length - 1;
        const m = chat[id];
        const name = currentPreset();
        if (!m || m.is_user || m.is_system || !name) return;
        m.extra ??= {};
        m.extra.regex_preset = name;
        delete m.extra[LOOKS_KEY];   // 새 스와이프는 받은 뒤 그 답의 꾸밈으로 다시 적음
        delete m.extra[ON_KEY];
        guessCache.delete(id);
    });
    eventSource.on(event_types.CHAT_CHANGED, () => { guessCache = new Map(); setCache.clear(); notePreset(); });
    // 다른 스와이프를 보고 있을 때 붙은 답은 ‘답 받음’ 신호가 없어 기록이 비었음 — 넘겨 볼 때 그 답의 생성 시각으로 채움
    eventSource.on(event_types.MESSAGE_SWIPED, (id) => {
        const m = chat[Number(id)];
        const info = m?.swipe_info?.[m?.swipe_id ?? 0];
        if (!m || m.is_user || m.is_system || !info || info.extra?.regex_preset || !String(m.mes ?? '').trim()) return;
        const name = presetAt(info.gen_started ?? m.gen_started);
        if (!name) return;
        record(Number(id));
    });
    // 토글을 누른 뒤(실리태번이 목록을 다시 그린 다음) · 보내기 직전에 짝 꾸밈 확인
    document.addEventListener('click', (e) => { if (e.target?.closest?.('.prompt-manager-toggle-action')) pairAfterClick(); }, true);
    eventSource.on(event_types.GENERATION_STARTED, (type, _opts, dryRun) => { if (dryRun) return; notePreset(); if (type !== 'quiet') pairLooks(); });
    notePreset();
    eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => { notePreset(); pairSig = ''; });
    eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => { signIndex = null; metaIndex = null; renderCache.clear(); looseCache.clear(); guessCache = new Map(); });
}

if (!already) globalThis[Symbol.for('preset-regex-keep')] = { originOf, claim, provider, scriptsFor: displayScriptsFor, foreignTags, rebuild: () => { signIndex = null; metaIndex = null; renderCache.clear(); looseCache.clear(); guessCache = new Map(); } };
}

// 설정: 이 채팅의 예전 답을 지금 정규식으로 다시 그리기(기억해 둔 켜짐 · 그린 꾸밈 기록을 지움). 프리셋 기록은 남김
export function options(box, api) {
    box.innerHTML = '<label class="checkbox_label"><input type="checkbox" data-k="pairLooks"><span>프롬프트 토글을 켜고 끄면, 그 토글과 짝인 정규식도 같이 켜고 끄기</span></label>'
        + '<label class="checkbox_label"><input type="checkbox" data-k="stripForeign"><span>AI에게 보낼 때, 예전 프리셋의 상태창은 빼고 보내기</span></label>'
        + '<div class="etk-flex"><div class="menu_button etk-plk-redraw"><i class="fa-solid fa-rotate"></i>지금 정규식으로 다시 그리기</div><small>지금 연 채팅의 메시지를 전부 지금 켜진 정규식으로 그려요.</small></div>';
    for (const cb of box.querySelectorAll('[data-k]')) {
        const o = SillyTavern.getContext().extensionSettings.breeze.options.preset_look_keep ??= {};
        cb.checked = o[cb.dataset.k] !== false;
        cb.addEventListener('change', () => { o[cb.dataset.k] = cb.checked; api.save(); });
    }
    box.querySelector('.etk-plk-redraw').addEventListener('click', async () => {
        const c = SillyTavern.getContext();
        if (!c.chat?.length || (c.characterId === undefined && !c.groupId)) return toastr.info('먼저 채팅을 열어 주세요.', 'breeze');
        const ok = await c.callGenericPopup('지금 연 채팅의 메시지를 전부 지금 켜진 정규식으로 다시 그릴까요? 메시지마다 기억해 둔 정규식 켜짐 기록이 지워져요.', c.POPUP_TYPE.CONFIRM, '', { okButton: '다시 그리기', cancelButton: '취소' });
        if (ok !== c.POPUP_RESULT.AFFIRMATIVE) return;
        for (const m of c.chat) {
            for (const ex of [m?.extra, ...(m?.swipe_info || []).map(x => x?.extra)]) if (ex) { delete ex[ON_KEY]; delete ex[LOOKS_KEY]; }
        }
        delete c.chatMetadata[SETS_KEY];
        setCache.clear();
        await c.saveChat();
        await c.reloadCurrentChat();
        toastr.success('지금 정규식으로 다시 그렸어요.', 'breeze');
    });
}
