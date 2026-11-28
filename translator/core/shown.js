// 글에서 화면에 글자로 나오지 않는 부분을 뺀다. 글만 다룬다(화면용 정규식 목록은 넘겨받는다).
//
// 쓰는 곳:
//   shownText  문단 짝의 글을 화면 문단과 같은 꼴로 만들 때(원문 칸). 숨김 주석과, 정규식이 따로 그리거나 지우는 블록은
//              화면 문단에 글자로 나오지 않으므로 뺀다. 빼지 않으면 블록과 빈 줄 없이 붙은 다음 줄이 한 문단으로 묶여
//              그 줄의 원문 칸에 블록 원문이 날글로 나온다.
//   splitEnds  번역을 고치는 칸에 그려지는 글만 보일 때. 맨 앞, 맨 뒤의 안 그려지는 덩이를 떼어 두고 저장할 때 그대로 붙인다.
//
// 규칙의 꼴(ScreenRule):
//   find      RegExp  화면에 그릴 때 글을 바꾸는 정규식
//   hides     boolean 바꿀 글이 비어 있어 그 자리를 지우기만 하면 true
//   text      (number | string)[]  바꿀 글에서 화면 글자 자리에 들어가는 그룹(번호나 이름)
//   firstOnly boolean 처음 맞은 것 하나만 바꾸는 정규식이면 true
// screenRule(찾을 글, 바꿀 글)이 이 꼴을 만든다.

const DATA_BLOCK = /<(script|style|textarea|template)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const GROUP = /\$(\d{1,2})|\u0000([^\u0000]+)\u0000/g;

/** 글에 나오는 그룹마다 몇 번 나오는지 */
function groupCounts(text) {
    const counts = new Map();
    for (const hit of text.matchAll(GROUP)) {
        const key = hit[1] !== undefined ? Number(hit[1]) : hit[2];
        if (key !== 0) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

/** 바꿀 글에서 화면 글자 자리에만 들어가는 그룹. 속성, 스크립트, 주석 안에도 쓰인 그룹은 자료라서 뺀다 */
function textGroups(replace) {
    // $<이름> 은 태그처럼 생겨서, 태그를 걷어 내기 전에 다른 표시로 바꿔 둔다
    const whole = String(replace).replace(COMMENT, '').replace(/\$<([^>]+)>/g, '\u0000$1\u0000');
    const all = groupCounts(whole), drawn = groupCounts(whole.replace(DATA_BLOCK, '').replace(/<[^>]*>/g, ''));
    return [...drawn.keys()].filter(key => drawn.get(key) === all.get(key));
}

/**
 * 실리태번 정규식 한 줄(찾을 글, 바꿀 글)을 규칙으로. 화면 문단의 글에 영향이 없는 것은 null:
 * 글자만 바꾸는 정규식(바꿀 글에 태그가 없음)은 바뀐 글이 그대로 문단에 나온다.
 * @returns {{ find: RegExp, hides: boolean, text: (number | string)[], firstOnly: boolean } | null}
 */
export function screenRule(find, replace = '') {
    const raw = String(find ?? '').trim(), hides = !String(replace ?? '').trim();
    if (!raw || (!hides && !/<[a-z!]/i.test(replace))) return null;
    const slashed = /^\/([\s\S]+)\/([a-z]*)$/i.exec(raw), flags = slashed ? slashed[2] : '';
    try {
        const rule = new RegExp(slashed ? slashed[1] : raw, [...new Set(flags + 'g')].join(''));
        return { find: rule, hides, text: hides ? [] : textGroups(replace), firstOnly: !flags.includes('g') };
    } catch {
        return null;
    }
}

/** 숨김 주석을 뺀다. 닫히지 않은 끝 주석도(문단으로 나누면 주석 꼬리가 여러 문단에 걸쳐 글자로 나온다) */
export const withoutComments = text => String(text ?? '').replace(COMMENT, '');

/** 지우기만 하는 정규식이 줄 가운데의 낱말을 잡았나(줄의 처음도 끝도 아니고, 한 줄 안) */
function midLine(text, hit) {
    const end = hit.index + hit[0].length;
    return !hit[0].includes('\n') && hit.index > 0 && text[hit.index - 1] !== '\n' && end < text.length && text[end] !== '\n';
}

const BODY = /\n[ \t]*\n/;
/** 맞은 글에서 화면 글자 자리에 들어가는 그룹 가운데 빈 줄이 있는 것(여러 문단 = 이야기 본문) */
function bodiesIn(hit, rule) {
    return (rule.text || [])
        .map(key => (typeof key === 'number' ? hit[key] : hit.groups?.[key]))
        .filter(group => typeof group === 'string' && BODY.test(group.trim()));
}

/** 맞은 자리에 남길 글 */
function whatStays(text, hit, rule) {
    // 줄 가운데의 낱말을 지우는 것은 블록이 아니다: 그 글만 빼고 문단은 가르지 않는다.
    // 문단 경계로 바꾸면 그 낱말이 든 원문 문단만 둘로 갈리고(번역문에는 그 낱말이 없다) 그 뒤 짝이 한 칸씩 밀린다
    if (rule.hides && midLine(text, hit)) return '';
    // 본문을 통째로 감싸는 틀은 블록째 빼면 이야기 문단이 전부 사라진다: 본문은 문단으로 남긴다. 한 줄짜리 값(머리줄, 칸)은 뺀다
    const kept = bodiesIn(hit, rule);
    return kept.length ? `\n\n${kept.join('\n\n')}\n\n` : '\n\n';
}

function cutBy(text, rule) {
    let out = '', last = 0;
    for (const hit of text.matchAll(new RegExp(rule.find.source, [...new Set(rule.find.flags + 'g')].join('')))) {
        // 공백만 잡는 정규식(줄 앞 들여쓰기를 지우는 것 등)은 블록이 아니다: 문단 경계로 바꾸면 들여 쓴 줄마다 문단이 갈린다
        if (!hit[0].trim()) continue;
        out += text.slice(last, hit.index) + whatStays(text, hit, rule);
        last = hit.index + hit[0].length;
        if (rule.firstOnly) break;
    }
    return out + text.slice(last);
}

/** 정규식이 따로 그리거나 지우는 블록을 뺀다. 블록 자리는 문단 경계(빈 줄)가 된다 */
export function withoutBlocks(text, rules = []) {
    return rules.reduce(cutBy, String(text ?? ''));
}

/** 화면 문단에 글자로 나오는 글만 */
export const shownText = (text, rules = []) => withoutBlocks(withoutComments(text), rules);

/** 글에서 화면에 안 그려지는 구간들: 숨김 주석과, 지우기만 하는 정규식에 맞은 자리 */
function hiddenSpans(whole, rules) {
    const finds = [COMMENT, ...rules.filter(rule => rule.hides).map(rule => rule.find)];
    const spans = [];
    for (const find of finds) {
        for (const hit of whole.matchAll(new RegExp(find.source, [...new Set(find.flags + 'g')].join('')))) {
            if (hit[0]) spans.push([hit.index, hit.index + hit[0].length]);
        }
    }
    return spans;
}

const blank = (whole, at) => /\s/.test(whole[at] ?? '');

/** 맨 앞에서 안 그려지는 덩이가 끝나는 자리 */
function headEnd(whole, spans) {
    let start = 0;
    for (;;) {
        let at = start;
        while (at < whole.length && blank(whole, at)) at++;
        const hit = spans.find(([from, to]) => from <= at && at < to);
        if (!hit) return start;
        start = hit[1];
    }
}

/** 맨 뒤에서 안 그려지는 덩이가 시작하는 자리 */
function tailStart(whole, spans, start) {
    let end = whole.length;
    for (;;) {
        let at = end;
        while (at > start && blank(whole, at - 1)) at--;
        const hit = spans.find(([from, to]) => from < at && at <= to && from >= start);
        if (!hit) return end;
        end = hit[0];
    }
}

/**
 * 글의 맨 앞, 맨 뒤에서 화면에 안 그려지는 덩이를 떼어 낸다. 가운데에 있는 것은 그대로 둔다.
 * @returns {{ head: string, body: string, tail: string }} head + body + tail 은 늘 받은 글
 */
export function splitEnds(text, rules = []) {
    const whole = String(text ?? ''), spans = hiddenSpans(whole, rules);
    let start = headEnd(whole, spans), end = tailStart(whole, spans, start);
    // 뗀 덩이와 본문 사이의 빈 줄은 덩이 쪽에 붙인다(고치는 칸이 빈 줄로 시작하지 않게)
    if (start > 0) while (start < end && blank(whole, start)) start++;
    if (end < whole.length) while (end > start && blank(whole, end - 1)) end--;
    return { head: whole.slice(0, start), body: whole.slice(start, end), tail: whole.slice(end) };
}
