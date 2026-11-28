// 답을 조각별로 푼다. 받는 중(feed)과 끝난 뒤(finish)가 같은 풀이를 쓴다. 글만 다룬다.
//
// 답의 꼴(core/request.js SHAPE): 문단마다 줄 머리에 ¶번호, 말한 사람이 있으면 바로 뒤에 {A,B}(사람 표의 글자 · 표에 없는 이름 · 모름은 ?).
// 읽는 법: 다음에 올 번호를 알고 기다린다. 줄 머리가 ¶ 이고 번호가 지금까지 받은 것보다 크고 보낸 수 안일 때만 새 문단이다.
//   본문에 ¶ 가 우연히 나와도 번호가 안 맞으면 본문으로 남는다. 4 가 안 오고 5 가 오면 4 가 빠진 것이고 5 부터 다시 차례대로 읽는다.
//   그래서 괄호가 망가진 꼴을 받아 주는 식을 여럿 둘 까닭이 없다.
// 중괄호는 번호에 바로 붙은 것만 본다: 요청은 '¶3 글'(빈칸)로 보내므로, 글이 { 로 시작하는 문단(자료 덩이)을 말한 사람으로 읽지 않는다.

// 머리 뒤 빈칸은 하나만 뗀다(요청이 '¶3 글' 로 보낸 그 한 칸): 들여 쓴 본문 · 쌍점으로 시작하는 본문을 깎지 않게.
// 중괄호는 번호에 붙여 쓰기도 하고 한 칸 띄워 쓰기도 한다(실제 답: '¶3 {?} "…"' 꼴이 대부분이었다). 띄워 쓴 중괄호는 안의 것이
// 말한 사람 꼴(글자 · ? · 이름, 쉼표로 이음, 숫자로 시작하지 않음)일 때만 머리로 본다: 글이 { 로 시작하는 문단({0} 자리 · 자료 덩이)을 깎지 않게
const HEAD = /^[ \t]*¶[ \t]*(\d+)(?!\d)(?:(?:[ \t]?)\{([^{}\n"“”:：]{0,80})\})?[ \t]?/;
const WHO_LIST = /^\s*(?:[^\d\s,，、{}][^,，、{}]{0,40})(?:\s*[,，、]\s*[^\d\s,，、{}][^,，、{}]{0,40})*\s*$/;

/** 머리 한 줄을 읽는다 → { id, inner, length } 또는 null */
function headOf(line) {
    const hit = HEAD.exec(line);
    if (!hit) return null;
    if (hit[2] === undefined || WHO_LIST.test(hit[2])) return { id: Number(hit[1]), inner: hit[2], length: hit[0].length };
    // 중괄호 안이 말한 사람 꼴이 아니면 머리는 번호까지만(중괄호는 본문)
    const bare = /^[ \t]*¶[ \t]*(\d+)(?!\d)[ \t]?/.exec(line);
    return { id: Number(bare[1]), inner: undefined, length: bare[0].length };
}
const THINK = /<think>[\s\S]*?<\/think>/gi;

/** 중괄호 안 → 사람 글자 · 이름들('?' 는 모름: 빈 글로) */
const whoOf = inner => (inner == null ? [] : inner.split(/[,，、>]/).map(s => s.trim()).filter(Boolean).map(s => (s === '?' || s === '？' ? '' : s)));

/** 답 머리의 생각 블록 · 코드 울타리를 걷는다. 아직 생각 중이면 null */
function body(raw, final) {
    let text = String(raw ?? '').replace(/\r\n?/g, '\n').replace(THINK, '');
    if (/<think>/i.test(text)) { if (!final) return null; text = text.replace(/<think>[\s\S]*$/i, ''); }
    // 모델이 답 전체를 코드 울타리로 감쌌을 때만 걷는다. 여는 울타리가 없으면 끝의 울타리는 본문(코드 블록으로 끝나는 답)이다
    const wrapped = /^\s*```[a-z]*[ \t]*\n(?=\s*¶)/.exec(text);
    if (wrapped) {
        text = text.slice(wrapped[0].length);
        if (final) text = text.replace(/\n[ \t]*```\s*$/, '');
    }
    return text;
}

/**
 * 문단 머리로 가른다 → [{ id, who, lines, at }] (나온 차례대로, id 는 늘 커진다. at: 머리가 있던 줄 번호). before: 첫 머리 앞의 글자 수
 * @param {number} count 보낸 문단 수(그보다 큰 번호는 본문)
 */
export function passages(text, count) {
    const out = [];
    let before = 0;
    String(text ?? '').split('\n').forEach((line, at) => {
        const hit = headOf(line), id = hit ? hit.id : 0, last = out.at(-1)?.id ?? 0;
        if (hit && id > last && id <= count) out.push({ id, who: whoOf(hit.inner), lines: [line.slice(hit.length)], at });
        else if (out.length) out[out.length - 1].lines.push(line);
        else before += line.trim().length;
    });
    return Object.assign(out, { before });
}

const tidy = lines => lines.join('\n').replace(/^\n+|\s+$/g, '');
const piece = p => ({ text: tidy(p.lines), who: p.who });

/**
 * 받는 중: 지금까지 온 글에서 닫힌 조각만 내준다(다음 머리가 온 조각).
 * 마지막 조각은 아직 쓰는 중이라 내주지 않는다. 1번부터 빠짐없이 이어진 데까지만 센다(화면이 차례대로 붙인다).
 * @returns {{ text: string, who: string[] }[]}
 */
export function feed(raw, count) {
    const text = body(raw, false);
    if (text == null) return [];
    const found = passages(text, count), out = [];
    for (let i = 0; i < found.length - 1; i++) {
        if (found[i].id !== i + 1) break;
        out.push(piece(found[i]));
    }
    return out;
}

/**
 * 끝난 뒤: 조각마다 번역과 상태. 맞게 온 조각은 살리고, 안 온 조각만 표시한다.
 * @returns {{ pieces: ({ text: string, who: string[] } | null)[], missing: number[], cut: boolean, clean: boolean, suspect: number, marked: boolean }}
 *   pieces[i] 가 null 이면 그 조각은 안 왔다. cut: 뒤쪽이 통째로 안 왔다. clean: 1부터 하나씩 다 왔다.
 *   suspect: 끊겼을 때 마지막으로 온 조각 번호(없으면 -1). marked: 머리가 하나라도 있었다(없으면 번역이 아닌 답)
 */
export function finish(raw, count) {
    const text = body(raw, true) ?? '';
    const found = passages(text, count), pieces = Array.from({ length: count }, () => null);
    for (const p of found) { const got = piece(p); if (got.text) pieces[p.id - 1] = got; }
    const missing = pieces.map((p, i) => (p ? -1 : i)).filter(i => i >= 0);
    const last = pieces.reduce((n, p, i) => (p ? i : n), -1);
    const cut = missing.length > 0 && missing.every(i => i > last);
    const clean = found.length === count && missing.length === 0 && found.before === 0;
    return { pieces, missing, cut, clean, suspect: cut ? last : -1, marked: found.length > 0 };
}

// 앞뒤가 라틴 글자 · 숫자가 아닌 글자 하나. 한글은 막지 않는다: 글자를 이름처럼 쓰면 조사가 바로 붙는다(A가 · B는)
const alone = letter => new RegExp(`(?<![\\p{Script=Latin}\\p{N}])${letter}(?![\\p{Script=Latin}\\p{N}])`, 'gu');
const countOf = (text, letter) => (String(text ?? '').match(alone(letter)) || []).length;

/**
 * 답의 글자를 사람으로 푼다. 번역문 본문에 사람 글자가 원문보다 많이 홀로 나온 문단은 모델이 글자를 이름처럼 쓴 것이라 그 문단의 글자를 믿지 않는다(빈 목록).
 * 원문에 같은 글자가 있으면(Plan B, A 급) 번역에도 있는 것이 맞아 센 수에서 뺀다: 2026-11-27 실제 요청 3번에서 홀로 나온 글자 3개가 모두 원문에도 있던 것이었다.
 * @param {{ text: string, who: string[] }} got  @param {Map<string, any>} table 이 요청의 글자 → 사람(core/people.js letters)  @param {string} [source] 그 조각의 원문
 * @returns {{ known: any[], names: string[], unknown: boolean, leaked: boolean }} known: 표의 사람, names: 표에 없는 이름(모델이 적은 그대로), unknown: 모름이 있었다
 */
export function speakersOf(got, table, source = '') {
    const out = { known: [], names: [], unknown: false, leaked: false };
    if (!got?.who?.length) return out;
    out.leaked = [...table.keys()].some(letter => countOf(got.text, letter) > countOf(source, letter));
    if (out.leaked) return out;
    for (const token of got.who) {
        if (!token) out.unknown = true;
        else if (table.has(token)) out.known.push(table.get(token));
        else out.names.push(token);
    }
    return out;
}

// ── 마지막 조각이 문장 중간에서 끝났나 ──
// 연결에 따라 답이 끝난 까닭(안전 필터 · 출력 한도)이 전해지지 않아, 번호가 다 왔어도 마지막 조각은 글로 본다.
// 기준은 끝 모양뿐이다: 글자 · 숫자로 끝났거나 따옴표가 열린 채인데 원문은 그렇지 않을 때.
//   이미 번역된 문단 20,000쌍으로 잼: 정상 문단을 끊긴 것으로 잘못 봄 0.0%,
//   번역문을 20~90% 자리에서 자른 것을 잡음 93.2%. 길이 비(번역이 원문의 절반 아래 …)로 보는 기준은 잘못 봄 1.5% · 잡음 47.4% 라 뺐다
const tail = text => String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>|\[\[__VAR_\d+__\]\]/g, '').trimEnd();
const endsOnLetter = text => /[\p{L}\p{N}]$/u.test(tail(text));
const quoteLeftOpen = text => {
    const last = tail(text).split(/\n[\t ]*\n/).at(-1) ?? '';
    const more = (a, b) => last.split(a).length > last.split(b).length;
    return more('「', '」') || more('『', '』') || more('“', '”') || (last.split('"').length - 1) % 2 === 1;
};
/** 원문 조각에 견줘 번역이 중간에 끊긴 것으로 보이나 */
export function cutShort(source, output) {
    return (endsOnLetter(output) && !endsOnLetter(source)) || (quoteLeftOpen(output) && !quoteLeftOpen(source));
}
