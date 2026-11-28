// 그 답을 그리는 화면용 정규식을 읽어, 정규식이 글자 그대로 찾는 글(틀)을 '번역에 보내지 않고 제자리에 둘 글'의 규칙으로 만든다.
//
// 왜: 화면용 정규식은 원문의 틀(여는 표시 · 구분 글자 · 칸 이름)을 글자 그대로 찾아 상태창 · 말풍선 · 버튼을 그린다.
//   틀이 번역되면 정규식이 맞지 않아 창이 안 그려지거나 빈칸이 된다(할 일 창의 제목 칸이 번역돼 깨짐, 칸 이름이 '날짜:'로 옮겨져 빈칸).
//
// 늘 가리는 것(구조 보호를 꺼도): 정규식의 찾는 식에 적힌 칸 이름(이름: · [이름|값]), 태그 사이의 정해진 낱말, 글자 그대로 찾는 【…】,
//   정규식이 그리는 화면 코드가 이름으로 찾는 칸.
//   모양만 보고 가리지 않는다: 정규식에 없는 '이름:' 줄(이야기 속 목록)과 【…】(물건 · 기술 이름)까지 원문으로 남았다.
// 구조 보호가 켜져 있을 때(extension_settings.llmt.structure) 더 가리는 것: 정규식이 잡는 블록의 틀.
//   - 바꿀 글에 화면 글자로 쓰이는 그룹이 없는 정규식: 맞은 글 통째(그려진 글자는 상태창 번역이 옮긴다)
//   - 그런 그룹이 있고 그 그룹이 아무 문장이나 받는 정규식: 그룹의 글은 본문과 같이 번역하고 그 밖의 틀만 가린다
//     (통째로 가리면 일기 · 게시판 같은 칸의 글이 본문 번역에서 빠졌다)
//   - 그룹이 문장을 못 받는 정규식(한자만 · 숫자 · 낱말 목록)과 사용자가 통째로 가리게 한 정규식: 맞은 글 통째
//   - JSON 자료가 든 블록: JSON 은 열어 두고 그 밖의 틀(머리표 · 닫는 표시)만 가린다(JSON 을 가리면 자리표 수백 개가 섞여 모델이 헷갈렸다)
// 실리태번을 모른다: 설정과 그 답에 걸리는 정규식 목록, 답의 글을 넘겨받는다. 글만 다룬다.

import { scriptKey } from './kept.js';

const AI_OUTPUT = 2, USER_INPUT = 1;   // 실리태번 정규식의 placement 값
const SETTINGS_KEY = 'llmt';
const THINK = /<(think|thinking|ECoT)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

const escape = text => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const longestFirst = set => [...set].sort((a, b) => b.length - a.length).map(escape).join('|');

/** 한 번 계산한 것을 글(찾는 식 · 바꿀 글)마다 기억한다 */
function cached(compute) {
    const memo = new Map();
    return key => {
        const text = String(key ?? '');
        if (!memo.has(text)) memo.set(text, compute(text));
        return memo.get(text);
    };
}

/** '보내는 글만'과 '화면만'이 둘 다 켜진 정규식은 실리태번이 화면에도 쓴다 */
const onScreen = script => !script.promptOnly || Boolean(script.markdownOnly);
const usable = script => Boolean(script) && !script.disabled && onScreen(script) && typeof script.findRegex === 'string' && Array.isArray(script.placement);

/** 찾는 식 → { source, flags }('/본문/깃발' 꼴이 아니면 글 전체가 본문) */
function partsOf(findRegex) {
    const slashed = /^\/([\s\S]+)\/([a-z]*)$/i.exec(findRegex.trim());
    return slashed ? { source: slashed[1], flags: slashed[2] } : { source: findRegex, flags: '' };
}

/** 전부 찾고 그룹 자리도 알려 주는 정규식과, 원래 처음 것만 바꾸는지. 못 읽으면 null */
const finderOf = cached(findRegex => {
    const { source, flags } = partsOf(findRegex);
    try {
        return { find: new RegExp(source, [...new Set(flags.replace(/y/g, '') + 'gd')].join('')), firstOnly: !flags.includes('g') };
    } catch {
        return null;
    }
});

// ── 찾는 식에서 읽는 이름들 ──

const LABEL_WORD = /^[\p{L}\p{N}][\p{L}\p{N} '&/.\-]{0,39}$/u;
// 칸 이름 뒤 구분자: 쌍점, 쌍점이나 세로줄이 든 문자 묶음([:：] · [-|]), 글자로 쓴 세로줄(\|)
const LABEL_END = /(?<!\\)\[[^\]]*[:：][^\]]*\]|(?<!\\)\[[^\]]*\|[^\]]*\]|[:：]|\\\|/g;
// 구분자 앞에 낀 빈칸 · 별표 꼴(\s* · [ \t]* · \*\* …)
const LABEL_PAD = /(?:\\s[*+?]?|\[ ?\\t\][*+?]?|\\\*(?:\{\d*,?\d*\}|[*+?])?|\*\{\d*,?\d*\}|[ ?*+])$/;
const PLAIN_WORD = /(?:[A-Za-z][A-Za-z0-9 '&/.\-]{0,38}|[㐀-鿿가-힣]{1,12})$/;

/** 정규식 문법 글자(\b · \s)를 빼고 이스케이프를 푼 낱말이 칸 이름으로 쓸 만하면 넣는다 */
function addLabel(out, word) {
    const text = word.replace(/\\[bBdDsSwW]/g, '').replace(/\\(.)/g, '$1').trim();
    if (LABEL_WORD.test(text) && /\p{L}/u.test(text) && (text.length >= 2 || /[^\x00-\x7f]/.test(text))) out.add(text);
}

/** 닫는 괄호로 끝나는 글에서 그 괄호 묶음의 안쪽(갈래로 나눌 수 있는 것만). 아니면 null */
function lastGroup(before) {
    let depth = 0, at = before.length - 1;
    for (; at >= 0; at--) {
        if (before[at - 1] === '\\') continue;
        if (before[at] === ')') depth++;
        else if (before[at] === '(' && --depth === 0) break;
    }
    let inner = before.slice(at + 1, -1).replace(/^\?(?::|<[^>]+>)/, '');
    while (/^\(\?:[\s\S]*\)$/.test(inner)) inner = inner.slice(3, -1);
    return /[()[\]]/.test(inner.replace(/\\[()[\]]/g, '')) ? null : inner;
}

/** 구분자 하나의 바로 앞에 적힌 칸 이름(들)을 넣는다 */
function labelsBefore(out, source, hit) {
    let before = source.slice(0, hit.index);
    if (hit[0].startsWith('[')) before = before.replace(/\(\?:$/, '');
    if (/\(\?$|\(\?<?[!=]?$/.test(before)) return;   // (?: · (?<= 같은 문법 자리
    for (let n = 0; n < 8 && LABEL_PAD.test(before); n++) before = before.slice(0, -LABEL_PAD.exec(before)[0].length);
    if (before.endsWith(')') && !before.endsWith('\\)')) {
        for (const alt of lastGroup(before)?.split('|') ?? []) addLabel(out, alt);
        return;
    }
    const word = PLAIN_WORD.exec(before);
    if (!word) return;
    // \bName 의 b 는 문법 글자
    addLabel(out, before[before.length - word[0].length - 1] === '\\' ? word[0].slice(1) : word[0]);
}

/** 찾는 식에 적힌 칸 이름: 구분자 바로 앞의 낱말, 또는 구분자 앞 묶음 (A|B|C) 의 낱말들 */
export const regexLabels = cached(findRegex => {
    const out = new Set();
    for (const hit of findRegex.matchAll(LABEL_END)) labelsBefore(out, findRegex, hit);
    return out;
});

/** 바꿀 글의 화면 코드(<script>)가 이름으로 찾는 칸: 코드 안의 짧은 한자 낱말(객체 열쇠 · 따옴표 글). 찾는 식에는 이 이름이 없다 */
export const scriptLabels = cached(replaceString => {
    const out = new Set();
    for (const [, code] of replaceString.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
        const body = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        for (const hit of body.matchAll(/(?:^|[{,\s])([㐀-鿿]{1,6})\s*:(?!\/)|['"`]([㐀-鿿]{1,6})['"`]/g)) out.add(hit[1] || hit[2]);
    }
    return out;
});

/** 태그 사이에 정해진 글자를 찾는 식(<Tag>Word<\/Tag> · <Tag>(A|B)Word<\/Tag>)의 그 글자 */
export const regexInnerWords = cached(findRegex => {
    const out = new Set();
    for (const hit of findRegex.matchAll(/>((?:\((?:\?:)?[A-Za-z0-9_ ]+(?:\|[A-Za-z0-9_ ]+)*\)|[A-Za-z0-9_ ])+)<\\?\//g)) {
        let words = [''];
        for (const part of hit[1].match(/\((?:\?:)?[^)]*\)|[^(]+/g)) {
            const alts = part.startsWith('(') ? part.replace(/^\((?:\?:)?|\)$/g, '').split('|') : [part];
            words = words.flatMap(word => alts.map(alt => word + alt));
            if (words.length > 20) break;
        }
        if (words.length <= 20) for (const word of words) if (/[A-Za-z]{2,}/.test(word)) out.add(word.trim());
    }
    return out;
});

/** 찾는 식이 글자 그대로 찾는 【…】. 【(.+?)】처럼 아무 글이나 받는 칸은 들지 않는다 */
export const regexBracketWords = cached(findRegex => {
    const out = new Set();
    for (const hit of findRegex.matchAll(/【([^】\\()[\]{}|*+?.^$]{1,12})】/g)) out.add(`【${hit[1]}】`);
    return out;
});

/** 칸 이름 · 정해진 낱말 · 【…】 규칙(구조 보호를 꺼도 쓴다). 차례: 【…】 → 칸 이름 → [이름|값] → 태그 사이 낱말 */
function nameRules(scripts) {
    const names = new Set(), inner = new Set(), marks = new Set();
    for (const script of scripts) {
        if (!script.placement.includes(AI_OUTPUT)) continue;
        for (const name of regexLabels(script.findRegex)) names.add(name);
        for (const name of scriptLabels(script.replaceString)) names.add(name);
        for (const word of regexInnerWords(script.findRegex)) inner.add(word);
        for (const mark of regexBracketWords(script.findRegex)) marks.add(mark);
    }
    const out = [];
    if (marks.size) out.push(new RegExp(longestFirst(marks), 'g'));
    if (names.size) {
        const alt = longestFirst(names);
        // 줄머리(또는 태그 바로 뒤)의 '이름:'. 뒤가 따옴표면 대사라서 뺀다
        out.push(new RegExp(String.raw`(?:^|(?<=>))[ \t]*(?:[-*•][ \t]+)?(?:\*\*)?(?:${alt})(?:\*\*)?[ \t]*[:：](?![ \t]*["“「『])`, 'gm'));
        out.push(new RegExp(String.raw`(?<=\[)[ \t]*(?:${alt})[ \t]*(?=[|\-])`, 'g'));
    }
    if (inner.size) out.push(new RegExp(String.raw`(?<=>)[ \t]*(?:${longestFirst(inner)})[ \t]*(?=<\/)`, 'g'));
    return out;
}

// ── 바꿀 글에서 화면 글자로 쓰이는 그룹 ──

const DATA_TAGS = ['script', 'style', 'textarea', 'template'];

/** 바꿀 글의 이 자리가 화면에 글자로 안 나오는 자리인가: 태그 속성 안, 코드 · 자료 태그 안, 숨긴 요소 안 */
function inDataSpot(lower, at) {
    const open = lower.lastIndexOf('<', at - 1);
    if (open > lower.lastIndexOf('>', at - 1)) return true;
    if (DATA_TAGS.some(tag => lower.lastIndexOf('<' + tag, at - 1) > lower.lastIndexOf('</' + tag, at - 1))) return true;
    const parent = open >= 0 ? /^<([a-z][\w-]*)([^>]*)>[^<]*$/.exec(lower.slice(open, at)) : null;
    return Boolean(parent) && /display\s*:\s*none|(?:^|\s)hidden(?=[\s=>/]|$)|application\/json/.test(parent[2]);
}

/** 바꿀 글에서 화면 글자 자리에만 쓰인 그룹($1 · $<name>). 주석 안과 자료 자리에 쓰인 그룹은 뺀다 */
export const textGroups = cached(replaceString => {
    const lower = replaceString.toLowerCase(), usage = new Map();
    for (const hit of replaceString.matchAll(/\$(\d{1,2})|\$<([^>]+)>/g)) {
        const key = hit[1] !== undefined ? Number(hit[1]) : `name:${hit[2]}`;
        const before = replaceString.slice(0, hit.index);
        if (key === 0 || before.lastIndexOf('<!--') > before.lastIndexOf('-->')) continue;
        const use = usage.get(key) ?? { data: false, text: false };
        if (inDataSpot(lower, hit.index)) use.data = true; else use.text = true;
        usage.set(key, use);
    }
    const nums = new Set(), names = new Set();
    for (const [key, use] of usage) {
        if (use.data || !use.text) continue;
        if (typeof key === 'number') nums.add(key); else names.add(key.slice(5));
    }
    return { nums, names };
});

// ── 찾는 식의 그룹이 번역된 한국어 문장도 받는가 ──

const PROBES = ['그가 웃으며 말했다, 오늘은 비가 온다.', '그는 잠깐 멈췄다'];
// 따옴표까지 그룹에 넣은 정규식은 맨 문장을 못 받아 틀로 가려졌고 대사가 원문 그대로 남았다: 감싼 꼴도 시험한다
const WRAPS = [['', ''], ['"', '"'], ['“', '”'], ['「', '」'], ['『', '』']];

/** 찾는 식의 잡는 그룹마다 그 안쪽 식 → { bodies: Map(번호 → 식), names: Map(이름 → 번호) } */
function captureBodies(source) {
    const bodies = new Map(), names = new Map(), stack = [];
    let count = 0, inClass = false;
    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (ch === '\\') { i++; continue; }
        if (inClass) { inClass = ch !== ']'; continue; }
        if (ch === '[') inClass = true;
        else if (ch === '(') stack.push(openGroup(source, i, () => ++count));
        else if (ch === ')') closeGroup(stack.pop(), source, i, bodies, names);
    }
    return { bodies, names };
}

function openGroup(source, at, next) {
    if (source[at + 1] !== '?') return { index: next(), name: null, from: at + 1 };
    const named = source[at + 2] === '<' && source[at + 3] !== '=' && source[at + 3] !== '!';
    if (!named) return { index: null };
    const end = source.indexOf('>', at);
    return { index: next(), name: source.slice(at + 3, end), from: end + 1 };
}

function closeGroup(group, source, at, bodies, names) {
    if (!group?.index) return;
    bodies.set(group.index, source.slice(group.from, at));
    if (group.name) names.set(group.name, group.index);
}

/** 아무 문장이나 받는 그룹 → { nums, names } */
export const looseGroups = cached(findRegex => {
    const { source, flags } = partsOf(findRegex);
    const { bodies, names } = captureBodies(source);
    const accepts = body => {
        try {
            const whole = new RegExp(`^(?:${body})$`, flags.replace(/[gyd]/g, ''));
            return WRAPS.some(([open, close]) => PROBES.every(probe => whole.test(open + probe + close)));
        } catch {
            return false;
        }
    };
    const nums = new Set([...bodies].filter(([, body]) => accepts(body)).map(([index]) => index));
    return { nums, names: new Set([...names].filter(([, index]) => nums.has(index)).map(([name]) => name)) };
});

// ── JSON 자료가 든 블록 ──

/** 글 안의 JSON 객체 구간 → [{ start, end, value }] */
function jsonSpans(text) {
    const out = [];
    for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
        const end = objectEnd(text, i);
        if (end < 0) continue;
        try { out.push({ start: i, end: end + 1, value: JSON.parse(text.slice(i, end + 1)) }); i = end; } catch { /* JSON 이 아님 */ }
    }
    return out;
}

/** i 에서 여는 중괄호의 짝 자리(문자열 안의 괄호는 세지 않는다). 없으면 -1 */
function objectEnd(text, from) {
    let depth = 0, inString = false;
    for (let j = from; j < text.length; j++) {
        const ch = text[j];
        if (inString) { if (ch === '\\') j++; else if (ch === '"') inString = false; continue; }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) return j;
    }
    return -1;
}

/** 값 가운데 옮길 글(한자 · 가나가 든 문자열)이 있는가 */
function hasForeignString(value) {
    if (typeof value === 'string') return CJK.test(value);
    return Boolean(value) && typeof value === 'object' && Object.values(value).some(hasForeignString);
}

// ── 블록의 틀 ──

/** 블록(맞은 글)에서 열어 둘 구간을 뺀 나머지 조각들 */
function outside(block, ranges) {
    const out = [];
    let at = 0;
    for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
        if (from > at) out.push(block.slice(at, from));
        at = Math.max(at, to);
    }
    out.push(block.slice(at));
    return out.filter(piece => piece.trim());
}

/** 이 맞은 글에서 본문과 같이 번역할 그룹의 구간(블록 안 자리). 없으면 [] */
function openRanges(script, hit) {
    const used = textGroups(script.replaceString), loose = looseGroups(script.findRegex), out = [];
    const take = range => { if (range) out.push([range[0] - hit.index, range[1] - hit.index]); };
    (hit.indices || []).forEach((range, index) => { if (index > 0 && used.nums.has(index) && loose.nums.has(index)) take(range); });
    for (const name of used.names) if (loose.names.has(name)) take(hit.indices?.groups?.[name]);
    return out;
}

/** 블록을 그리는 정규식인가: 바꿀 글에 태그가 있고, 맞은 글을 통째로 다시 쓰지 않고($& · $0), 매크로가 들어 글마다 달라지지 않는다 */
function drawsBlock(script) {
    const replace = String(script.replaceString ?? '');
    return Boolean(script.findRegex.trim()) && !script.findRegex.includes('{{')
        && (script.placement.includes(AI_OUTPUT) || script.placement.includes(USER_INPUT))
        && /<[a-z!]/i.test(replace) && !/\$&|\$0(?!\d)|\{\{match\}\}/i.test(replace);
}

/** 정규식 하나가 이 글에서 잡는 블록들의 틀 조각을 pieces 에 넣는다. @returns {boolean} JSON 자료 블록을 만났나 */
function collectFrames(script, text, thinks, whole, pieces) {
    const made = finderOf(script.findRegex);
    if (!made) return false;
    let data = false;
    made.find.lastIndex = 0;
    for (const hit of text.matchAll(made.find)) {
        if (!hit[0]) continue;
        const from = hit.index, to = from + hit[0].length;
        if (!thinks.some(([a, b]) => from < b && to > a)) {
            const spans = jsonSpans(hit[0]).filter(span => hasForeignString(span.value));
            const open = spans.length ? spans.map(span => [span.start, span.end]) : whole ? [] : openRanges(script, hit);
            data ||= spans.length > 0;
            for (const piece of outside(hit[0], open)) pieces.add(piece);
        }
        if (made.firstOnly) break;
    }
    return data;
}

/** 바꿀 글에 화면 글자 그룹이 하나도 없는 정규식: 맞는 글을 통째로 가리는 규칙. 못 읽거나 빈 글에 맞으면 null */
function wholeRule(script) {
    const used = textGroups(script.replaceString);
    if (used.nums.size || used.names.size) return null;
    const { source, flags } = partsOf(script.findRegex);
    try {
        const rule = new RegExp(source, [...new Set((flags + 'g').replace(/[dy]/g, ''))].join(''));
        return rule.test('') ? null : (rule.lastIndex = 0, rule);
    } catch {
        return null;
    }
}

/** 구조 보호가 켜져 있을 때의 규칙: 통째로 가릴 정규식들 → 이 글에서 찾은 틀 조각(글자 그대로) */
function blockRules(scripts, text, wholeKeys) {
    const thinks = [...text.matchAll(THINK)].map(hit => [hit.index, hit.index + hit[0].length]);
    const pieces = new Set(), out = [];
    for (const script of scripts.filter(drawsBlock)) {
        const data = collectFrames(script, text, thinks, wholeKeys.has(scriptKey(script)), pieces);
        const rule = data ? null : wholeRule(script);
        if (rule) out.push(rule);
    }
    if (pieces.size) out.push(new RegExp(longestFirst(pieces), 'g'));
    return out;
}

/**
 * @param {object} extensionSettings 실리태번 extension_settings(llmt.structure 구조 보호, llmt.wholeScripts 통째로 가릴 정규식)
 * @param {object[]} scripts 그 답에 걸리는 화면용 정규식(실리태번 정규식 꼴)
 * @param {string} text 그 답의 원문(매크로를 푼 글)
 * @returns {RegExp[]} 새 정규식들
 */
export function frameRules(extensionSettings, scripts, text) {
    const own = extensionSettings?.[SETTINGS_KEY];
    // 설정이 아직 없으면 켠 것으로 본다(옛 번역 확장이 처음 만드는 값이 켬이다)
    const structure = own ? Boolean(own.structure) : true;
    const list = (scripts || []).filter(usable), source = String(text ?? '');
    const wholeKeys = new Set(Array.isArray(own?.wholeScripts) ? own.wholeScripts : []);
    return [...nameRules(list), ...(structure && source ? blockRules(list, source, wholeKeys) : [])];
}
