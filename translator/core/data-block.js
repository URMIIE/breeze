// 문단 안의 JSON 자료(카드 화면이 읽어 그리는 자료)를 번역 뒤 원문 틀로 되돌린다. 글만 다룬다.
//
// 왜: JSON 은 가리지 않고 본문과 같이 보낸다(rules/frame.js: 가리면 자리표 수백 개가 섞여 모델이 헷갈렸다).
//   그런데 모델은 키 이름까지 옮겨 돌려준다(실제 답 셋에서 원문 키 199 · 260 · 225개 가운데 남은 것 0).
//   카드 화면은 원문 키 · 이름 칸으로 자료를 찾으므로 키가 바뀌면 화면이 비거나 깨진다.
//   요청 지시를 늘리지 않고, 받은 뒤 원문 JSON 과 번역 JSON 을 나란히 걸어 글자 값만 번역을 쓴다.
// 되돌리는 법:
//   - 틀은 늘 원문 글 그대로다(키 · 차례 · 들여쓰기 · 한 줄로 쓴 항목). 원문 글 안의 글자 값 자리만 번역 값으로 바꿔 끼운다.
//   - 번역이 키 이름을 옮겼으면 키 개수가 같을 때 차례대로 짝짓는다. 개수가 다르면 그 묶음은 원문.
//   - 목록 개수가 원문과 다르면(모델이 항목을 합치거나 지어냄) 그 목록만 원문, 나머지 번역은 살린다.
//   - 카드가 사람 · 종류를 확인하는 칸(KEEP_KEYS)과 이모티콘 항목의 이름은 원문 값: 카드가 그 글자로 인물 · 그림을 찾는다.
//     이름 칸은 늘 원문 값을 쓰므로, 용어집의 한국어 이름이 들어와도 따로 되돌릴 것이 없다.
//   - 값이 비었거나 옮길 글자가 없는 값(날짜 · 숫자 · 기호)은 원문 값.
//   - 번역 JSON 이 파싱되지 않으면(따옴표가 깨짐) 그 블록만 원문: 깨진 JSON 은 카드 화면을 멈춘다.

// 카드가 사람 · 종류를 확인하는 칸. 이 칸의 글자가 바뀌면 프로필 그림 · 말풍선 주인 · 항목 종류를 못 찾는다
const KEEP_KEYS = new Set(['机主', '角色', '发送人', '成员', '聊天对象', '回复给', '主播', '类型', '状态', '标签', '赛制', '胜方', '主队', '客队', '战队', '会话ID', 'name', 'status', 'amount', 'duration']);
// 이모티콘 항목: 종류 칸이 이 값이면 내용 칸은 그림 이름이다
const STICKER = { typeKey: '类型', type: '表情', nameKey: '内容' };
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LETTER = /\p{L}/u;
const KEY_MARK = /"\s*:/;

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 따옴표로 시작하는 자리에서 그 글자 묶음의 끝(닫는 따옴표 다음 자리). 안 닫혔으면 글 끝 */
function stringEnd(text, start) {
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') return i + 1;
    }
    return text.length;
}

/** 원문의 JSON 자료: 맨 바깥 { … } 가운데 파싱되고 키가 있는 것 → [{ start, end, value }] */
function sourceSpans(text) {
    const out = [];
    for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
        const end = closingOf(text, i, true);
        if (end < 0) continue;
        const value = parsed(text.slice(i, end));
        if (isRecord(value) && KEY_MARK.test(text.slice(i, end))) { out.push({ start: i, end, value }); i = end - 1; }
    }
    return out;
}

/**
 * 번역의 JSON 자리: 맨 바깥 { … } 가운데 키 꼴이 든 것. 파싱은 보지 않는다(깨진 블록도 자리는 짝지어야 원문으로 되돌린다).
 * 괄호만 센다: 번역 값 안의 따옴표가 깨지면 글자 묶음 경계를 믿을 수 없어서
 */
function outputSpans(text) {
    const out = [];
    for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
        const end = closingOf(text, i, false);
        if (end < 0) break;
        if (KEY_MARK.test(text.slice(i, end))) { out.push({ start: i, end }); i = end - 1; }
    }
    return out;
}

/** start 의 { 와 짝인 } 다음 자리. 없으면 -1. quoted: 글자 묶음 안의 괄호를 건너뛴다 */
function closingOf(text, start, quoted) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (quoted && text[i] === '"') { i = stringEnd(text, i) - 1; continue; }
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return i + 1;
    }
    return -1;
}

function parsed(text) {
    try { return JSON.parse(text); } catch { return undefined; }
}

// ── 나란히 걷기 ──

/** 원문 글자 값 하나에 쓸 값 */
function pickString(orig, tr, key, parent, movable) {
    if (KEEP_KEYS.has(key)) return orig;
    if (key === STICKER.nameKey && parent?.[STICKER.typeKey] === STICKER.type) return orig;
    if (!movable.test(orig)) return orig;
    if (typeof tr !== 'string' || !tr.trim()) return orig;
    return tr;
}

/** 목록: 개수가 다르면 그 목록만 원문 */
function mergeList(orig, tr, key, parent, movable) {
    if (!Array.isArray(tr) || tr.length !== orig.length) return orig;
    return orig.map((item, i) => merge(item, tr[i], key, parent, movable));
}

/** 묶음: 원문 키가 다 있으면 이름으로, 키가 옮겨졌으면 개수가 같을 때 차례로 짝짓는다 */
function mergeFields(orig, tr, movable) {
    if (!isRecord(tr)) return orig;
    const keys = Object.keys(orig), got = Object.keys(tr);
    const byName = keys.every(k => Object.hasOwn(tr, k));
    if (!byName && got.length !== keys.length) return orig;
    const out = {};
    keys.forEach((k, i) => { out[k] = merge(orig[k], byName ? tr[k] : tr[got[i]], k, orig, movable); });
    return out;
}

/** 원문 모양 그대로, 글자 값만 번역에서 고른 값 */
function merge(orig, tr, key, parent, movable) {
    if (typeof orig === 'string') return pickString(orig, tr, key, parent, movable);
    if (Array.isArray(orig)) return mergeList(orig, tr, key, parent, movable);
    if (isRecord(orig)) return mergeFields(orig, tr, movable);
    return orig;
}

// ── 원문 글에 값 끼우기 ──

const COLON_AFTER = /\s*:/y;
const followedByColon = (text, at) => { COLON_AFTER.lastIndex = at; return COLON_AFTER.test(text); };

/** 원문 JSON 글의 글자 값마다 { path, start, end }(키는 빼고). path 는 키 · 차례 번호의 줄 */
function valueSlots(text) {
    const slots = [], stack = [];
    for (let i = 0; i < text.length; i++) {
        const c = text[i], top = stack.at(-1);
        if (c === '"') {
            const end = stringEnd(text, i);
            if (top?.key === null && followedByColon(text, end)) top.key = JSON.parse(text.slice(i, end));
            else slots.push({ path: stack.map(e => (e.list ? e.index : e.key)), start: i, end });
            i = end - 1;
        } else if (c === '{') stack.push({ list: false, key: null });
        else if (c === '[') stack.push({ list: true, index: 0 });
        else if (c === '}' || c === ']') stack.pop();
        else if (c === ',' && top) { if (top.list) top.index++; else top.key = null; }
    }
    return slots;
}

const at = (value, path) => path.reduce((v, step) => v?.[step], value);

/** 원문 글에서 바뀐 글자 값 자리만 새 값으로 바꾼다: 틀(키 · 차례 · 줄 모양)은 원문 글 그대로 */
function writeBack(text, orig, merged) {
    let out = '', from = 0;
    for (const slot of valueSlots(text)) {
        const next = at(merged, slot.path);
        if (typeof next !== 'string' || next === at(orig, slot.path)) continue;
        out += text.slice(from, slot.start) + JSON.stringify(next);
        from = slot.end;
    }
    return out + text.slice(from);
}

/** 원문 블록 하나와 그 자리의 번역 글 → 되돌린 글 */
function rebuild(sourceText, value, outputText) {
    const tr = parsed(outputText);
    if (tr === undefined) return sourceText;
    const movable = CJK.test(sourceText) ? CJK : LETTER;
    return writeBack(sourceText, value, merge(value, tr, '', null, movable));
}

/**
 * 번역 문단의 JSON 자료를 원문 틀로 되돌린다. 원문에 JSON 자료가 없거나, 원문과 번역의 JSON 블록 수가 달라 짝지을 수 없으면 번역 그대로.
 * @param {string} source 보낸 원문 문단  @param {string} output 받은 번역 문단
 * @returns {string}
 */
export function restoreData(source, output) {
    const src = String(source ?? ''), out = String(output ?? '');
    const from = sourceSpans(src);
    if (!from.length) return out;
    const to = outputSpans(out);
    if (to.length !== from.length) return out;
    let text = out;
    for (let k = to.length - 1; k >= 0; k--) {
        const block = rebuild(src.slice(from[k].start, from[k].end), from[k].value, out.slice(to[k].start, to[k].end));
        text = text.slice(0, to[k].start) + block + text.slice(to[k].end);
    }
    return text;
}
