// 요청 글 조립. 자리 순서가 여기 한 곳에 있다. 글만 다룬다.
//
//   번역 프롬프트 (사용자 글, 앞 대화는 프롬프트의 그 자리에)
//   [Rules] 내 규칙 (이 채팅 · 캐릭터에 걸린 것만. 지켜야 할 규칙이라는 머리 줄을 붙인다: 머리가 없으면 한글로 적은 짧은 줄이 지시인지 알 수 없다)
//   [People] · [Terms]                         이번 원문에 나온 사람 · 용어만(없으면 블록째 없음)
//   [Redo] · [Previous translation] · [Additional guidance]   다시 번역일 때만
//   [Format]                                   답의 꼴. 원문 바로 앞에 둔다(가까울수록 잘 지켜진다)
//   [Text to translate] + 번호 붙인 문단        머리 줄은 보내기 쪽이 이 줄로 원문 자리를 찾는다(rules/spacer.js, 보내는 글 프롬프트)
//
// 번역기가 얹는 지시 글은 옛 번역기의 것(답의 꼴 + 사람 묶음 설명, 약 340토큰)보다 길지 않게 둔다. 쓰이지 않는 지시는 싣지 않는다:
//   말한 사람 지시는 주인을 적을 문단이 있을 때만, 용어 지시는 용어 줄이 있을 때만.
// 문단 표시 ¶n: 답에서는 ¶n{A,B} 로 그 문단에서 말한 사람을 사람 표의 글자로 받는다(core/reply.js).
// 주인을 이미 아는 문단(이름표 줄, 사용자가 바로잡은 주인)은 보내는 쪽 머리에 ¶n{B} 로 적어 보낸다: 모델은 옮겨 적기만 한다.
// 표시는 요청과 답에만 있고 저장에는 남지 않는다(문단 기록은 자리와 지문만, 번역 기억의 열쇠에도 답의 꼴 글은 들지 않는다).

import { tokens } from './find.js';

export const MARK = '¶';
export const markOf = n => `${MARK}${n}`;
const BODIES = '[Text to translate]\n';

// 다시 번역에만 붙이는 덩이: 다시 번역 프롬프트가 '초안'을 고치라고 할 때 가리키는 것이 무엇인지와 돌려줄 범위
const REDO_HEAD = '[Redo]\nReturn every passage below, nothing else. [Previous translation], when given, is the draft the instructions above mean: keep what is right, change what they and [Additional guidance] ask.';

// 사용자가 적은 규칙 앞에 붙는 머리
const RULES_HEAD = '[Rules]\nFrom the user. Follow every line below when translating. Where a line differs from the instructions above, the line wins.';

const KEEP = 'Keep tags and [[__VAR_n__]] exactly as they are.\nWrite nothing else: no notes, no source text.';
// 본문(말한 사람까지), 본문(말한 사람 없음), 번호만(한국어가 아닌 글로 옮기는 것까지)
const FORMAT_SPEAKERS = `Each passage starts with ${MARK} and a number. Answer every passage, in order, none skipped or merged.\nStart each answer with the same ${MARK}number. If the passage has spoken lines, add in braces who speaks in it: the letter from [People] when the person is listed there, otherwise the name as written in the source ({?} if unclear). Then its Korean translation, on the same line as the marker.\nLike this: ${MARK}7{B} "번역한 대사." 번역한 지문.\n${KEEP}`;
const FORMAT_KOREAN = `Each passage starts with ${MARK} and a number. Answer every passage, in order, none skipped or merged.\nStart each answer with the same ${MARK}number, then its Korean translation.\nLike this: ${MARK}7 번역한 글.\n${KEEP}`;
const FORMAT_PLAIN = `Each passage starts with ${MARK} and a number. Answer every passage, in order, none skipped or merged.\nStart each answer with the same ${MARK}number, then its translation.\n${KEEP}`;

/** 답의 꼴 갈래: 본문용(말한 사람은 적을 문단이 있을 때만 묻는다) */
export const SHAPE = 'story';
/** 번호만 쓰는 꼴: 화면 글자 · 보내는 글 · 입력 번역처럼 이야기 대사를 가리지 않는 번역 */
export const PLAIN_SHAPE = 'plain';

// 이번 요청에만 붙는 문장([Format] 뒤에 이어 붙인다)
const KEEP_CELL = n => `Passage ${n} is a formatted block: keep its tags, line breaks and key names, translate only the readable words.`;

const section = (title, body) => (String(body ?? '').trim() ? `${title}\n${String(body).trim()}` : '');

/** 앞 번역문 덩이: 원문과 같은 번호로(어느 문단의 초안인지 모델이 맞추지 않게). 앞 번역이 없는 문단은 번호째 뺀다. 문단으로 못 나눈 앞 번역(글 하나)은 통째로 */
function previousBlock(previous) {
    if (typeof previous === 'string') return section('[Previous translation]\nDraft of the whole text, not text to translate.', previous);
    const lines = (previous ?? []).map((text, i) => (String(text ?? '').trim() ? `${markOf(i + 1)} ${String(text).trim()}` : '')).filter(Boolean);
    return lines.length ? `[Previous translation]\nDraft under the same markers, not text to translate.\n${lines.join('\n\n')}` : '';
}

/** 답의 꼴 글: 갈래 + 이번 요청에만 붙는 문장 */
function formatOf(shape, marks, notes) {
    const base = shape === PLAIN_SHAPE ? FORMAT_PLAIN : marks ? FORMAT_SPEAKERS : FORMAT_KOREAN;
    return `[Format]\n${[base, ...notes].join(' ')}`;
}

/**
 * @param {object} p
 * @param {string} p.method   옮기는 법(매크로는 이미 풀린 글)
 * @param {string} [p.rules]  내 규칙(사용자가 적은 글 · 이 채팅 규칙)
 * @param {string} [p.people] 사람 묶음(people.block)
 * @param {string} [p.terms]  용어 묶음(terms.block)
 * @param {string} [p.context] 참고로 싣는 글(보내는 글 번역의 앞 대화처럼 프롬프트에 자리가 없을 때). 이야기 번역의 앞 대화는 프롬프트 안에 있다
 * @param {string[]} [p.notes] 이번 요청에만 붙는 문장
 * @param {string[]} p.bodies 보낼 조각 글(가린 것)
 * @param {boolean} [p.marks] 말한 사람을 적게 할지(이름표 없는 대사 줄이 있을 때)
 * @param {string[][]} [p.known] 조각마다 이미 아는 말한 사람 글자(보내는 쪽 머리에 적는다)
 * @param {number[]} [p.cells] 구조 덩이인 조각의 차례(0부터)
 * @param {string} [p.shape] SHAPE(본문, 기본) | PLAIN_SHAPE(번호만)
 * @param {boolean} [p.redo] 다시 번역  @param {string} [p.guidance] 이번에 지킬 말투나 부탁(사용자 글)
 * @param {string[] | string} [p.previous] 다시 번역에서 같이 보내는 앞 번역문(bodies 와 같은 차례, 없는 문단은 ''. 문단으로 못 나눈 것은 글 하나)
 * @returns {{ fixed: string, rest: string, text: string, size: { fixed: number, rest: number, source: number } }}
 *   fixed: 요청마다 같은 앞부분(프롬프트)
 */
export function build({ method, rules = '', people = '', terms = '', context = '', notes = [], bodies, marks = true, known = [], cells = [], shape = SHAPE, redo = false, guidance = '', previous = [] }) {
    const fixed = String(method ?? '').trim();
    const speakers = shape !== PLAIN_SHAPE && marks;
    const head = i => markOf(i + 1) + (speakers && known[i]?.length ? `{${known[i].join(',')}}` : '');
    const source = bodies.map((body, i) => `${head(i)} ${body}`).join('\n\n');
    const rest = [
        section(RULES_HEAD, rules),
        people,
        terms,
        section('[Earlier messages, for reference only. Do not translate these.]', context),
        redo ? REDO_HEAD : '',
        previousBlock(previous),
        section('[Additional guidance]\nFrom the user, for this request only. It wins over [People].', guidance),
        formatOf(shape, speakers, [...notes, ...cells.map(i => KEEP_CELL(i + 1))].filter(Boolean)),
        `${BODIES}${source}`,
    ].filter(Boolean).join('\n\n');
    return { fixed, rest, text: `${fixed}\n\n${rest}`, size: { fixed: tokens(fixed), rest: tokens(rest) - tokens(source), source: tokens(source) } };
}

/** 요청 글에서 보낸 조각 원문을 읽는다('[Text to translate]' 뒤, 줄머리 ¶n 또는 ¶n{…}) */
export function sentBodies(request) {
    const text = String(request ?? '');
    const at = text.lastIndexOf(BODIES);
    if (at < 0) return [];
    const out = [], head = new RegExp(`^${MARK}(\\d+)(?:\\{[^{}\\n]*\\})? `);
    for (const line of text.slice(at + BODIES.length).split('\n')) {
        const hit = head.exec(line);
        if (hit && Number(hit[1]) === out.length + 1) out.push(line.slice(hit[0].length));
        else if (out.length) out[out.length - 1] += '\n' + line;
    }
    return out.map(body => body.replace(/\n+$/, ''));
}

/**
 * 번역문 글자 수 / 원문 글자 수(빈칸 뺌)의 위쪽 값. 이미 번역된 답 1,645개로 잼:
 * 영어 가운데 0.50 · 95% 0.59, 중국어 1.23 · 1.47, 일본어 채팅(서술 영어 + 대사 일본어) 0.54 · 1.28.
 * 예전 어림(번역문 길이 ≈ 원문 길이)은 영어에서는 두 배로 넉넉하고 중국어에서는 모자랐다.
 */
//   ko: 한국어로 쓴 글을 다른 언어로 보낼 때. 사용자의 보낸 글 4쌍에서 가운데 2.39 · 최대 2.81(쌍이 적어 최대에 맞춤)
const GROWTH = { en: 0.6, zh: 1.5, ja: 1.3, ko: 2.8 };
// 출력 토큰 하나에 한글 몇 자인지는 재지 못했다(모델 · 토크나이저마다 다름). 옛 번역기가 쓰던 1.2자를 그대로 둔다: 실제보다 작게 잡은 값이라 묶음이 작아질 뿐 답이 잘리지는 않는다
const CHARS_PER_TOKEN = 1.2;

/**
 * 출력 한도에 맞춰 조각을 묶는다: 묶음의 번역문 길이 어림(원문 글자 × 언어별 비)이 한도 안에 들게.
 * 한도를 모르면(0) 한 묶음. 조각 하나가 한도를 넘어도 그 조각은 쪼개지 않는다.
 * @param {string[]} bodies  @param {number} [outputTokens]  @param {'en' | 'zh' | 'ja'} [lang]
 * @returns {number[][]} 묶음마다 조각 차례
 */
export function groups(bodies, outputTokens = 0, lang = 'zh') {
    if (!(outputTokens > 0)) return [bodies.map((_, i) => i)];
    const limit = outputTokens * CHARS_PER_TOKEN, grow = GROWTH[lang] ?? GROWTH.zh, out = [];
    let group = [], size = 0;
    bodies.forEach((body, i) => {
        const expect = body.length * grow;
        if (group.length && size + expect > limit) { out.push(group); group = []; size = 0; }
        group.push(i); size += expect;
    });
    if (group.length) out.push(group);
    return out;
}
