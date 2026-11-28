// 새 번역기가 엔진(run/translate.js)을 부르는 하나뿐인 입구. 번역 버튼, 다시 번역, 채팅 전부 번역이 전부 여기로 들어온다.
// 번역은 나눠 보내지 않는다: 어떤 길이든 답 하나는 요청 한 번이다(엔진에 묶는 기준을 넘기지 않는다. 2026-11-26 사용자 결정).
//   답이 다 들어갈 출력 자리는 보내기가 글에 맞춰 싣는다(send/room.js). 요청이 더 나가는 것은 글이 오다 멈췄을 때(멈춤 감지)뿐이다. 끊긴 답은 받은 데까지만 쓴다.
// 재료를 새 꼴로 받는다: 사람(store/layers.js 의 사람), 사람이 아닌 이름, 내 규칙, 앞 대화(job/earlier.js), 이번에만 붙일 조건 줄.
//
// 문단 번역 기억(store/memory.js)을 여기서 읽고 쓴다. 기억은 이것 하나다:
//   끊긴 번역 이어 받기, 멈춘 뒤 남은 부분만 다시 보내기, 같은 글(같은 첫 메시지)을 다시 번역하지 않기가 전부 이 기억을 쓴다.
//   사용자가 번역을 손으로 고쳐 저장하면 바뀐 문단도 여기에 적는다(rememberEdited): 같은 문단이 다른 채팅에 나와도 고친 번역이 붙는다.
//   넣지 않는 것: 모델이 거절한 조각(보내기의 거절 거르기가 답에서 빼므로 여기 오지 않는다), 원문 그대로 돌아온 조각,
//                 모델이 빠뜨린 보호 글을 되돌려 붙인 조각(다시 받으면 제대로 올 수 있다), 받은 뒤 확인에 걸린 조각(core/checks.js).
//   fresh 면 기억을 읽지 않고 이 글의 문단 기억을 지운 뒤 새로 받는다: '다시 번역'은 늘 새로 받는다(기억이 남아 같은 번역이 다시 붙지 않게).
//   새로 받은 것은 적는다. 그래서 도중에 끊겨 이어 받을 때는(fresh 없이) 이번에 받은 문단만 기억에 있다.
//
// 한글 표기를 안 적어 둔 사람의 이름: 그 이름이 이번 원문에 나오면 이름만 든 문단 하나를 본문 뒤에 같이 실어 보낸다(namePassages).
//   모델이 그 문단에 적은 한글이 본문 번역에도 실제로 나올 때만 그 사람의 표기로 돌려준다(report.names). 저장은 부르는 쪽이 한다.
//   한 번 정해지면 사람 줄에 실려 다음 답부터 같은 표기로 나온다. 번역문만 보고 코드로 찾는 길은 재 보니 못 찾았다(이름이 '그'로 바뀌거나 빠진다).
//
// 원문을 고친 뒤 다시 번역할 때는 그 답에 붙어 있던 번역에서 글이 그대로인 문단의 번역을 그대로 쓴다(prior: store/pairs.js reusable 의 것).
//   기억보다 먼저 본다: 그 답에 붙어 있던 글이 그 답의 가장 새 번역이다.
//   그대로인 문단은 보내지 않으므로 문단을 지우기만 한 글은 요청 없이 끝난다. 새로 받기(fresh)에는 쓰지 않는다.

import { translate } from '../run/translate.js';
import { split, isSent } from '../core/split.js';
import * as people from '../core/people.js';
import * as terms from '../core/terms.js';
import { isKorean } from '../core/lang.js';
import { record, mark, reusable, dependsOf as recordedDepends } from '../store/pairs.js';
import { paragraphKey, hashOf } from '../store/memory.js';
import { sentBodies } from '../core/request.js';

/** 이름 → 짝 기록에 적을 것(사람 목록에 있으면 그 사람의 id, core/people.js recordOf) */
const recordName = cast => name => people.recordOf(cast, name);

// 번역 일(job/run.js)을 거치지 않고 넘겨받는 '그대로 쓸 번역': 그 답의 뺄 글 규칙 목록(엔진까지 같은 배열로 온다)에 달아 둔다
const offered = new WeakMap();

/**
 * 이 규칙 목록으로 번역할 답의 '그대로 쓸 번역'을 맡긴다(원문을 고친 답을 번역하기 직전에 app.js 가 부른다).
 * @param {RegExp[]} hold 그 답의 뺄 글 규칙(번역 재료의 hold 로 쓰일 배열)  @param {Map<string, { text: string, depends?: array }> | null} prior store/edited.js priorFor 의 값
 */
export function offerPrior(hold, prior) {
    if (prior?.size) offered.set(hold, prior);
    return hold;
}

/**
 * 그대로 쓸 번역에서 이 문단의 번역 · 말한 사람을 찾는 함수(앞뒤 빈칸은 지금 문단의 것으로 맞춘다). 새로 받을 때는 아무것도 찾지 않는다.
 * 짝 기록에 그 조각의 '걸린 것'이 적혀 있으면 지금 설정과 견줘, 사람 · 말투 · 용어가 바뀐 문단은 쓰지 않는다(다시 보낸다).
 * 걸린 것이 안 적힌 옛 기록은 견줄 것이 없어 그대로 쓴다.
 */
function fromPrior(p) {
    const prior = p.fresh ? null : p.prior ?? offered.get(p.hold) ?? null;
    return src => {
        const got = prior?.get(mark(src));
        if (typeof got?.text !== 'string' || (got.depends && !stillHolds(p, src, got.depends))) return undefined;
        return { text: /^\s*/.exec(src)[0] + got.text.trim() + /\s*$/.exec(src)[0], who: got.depends?.[0] ?? null };
    };
}

// 대사 따옴표: 말투 칸(speech · to X)은 대사에만 쓰인다
const SPOKEN = /["“”「」『』]/;

/**
 * 이 문단에 걸린 사람 · 용어의 지문. 이 가운데 하나라도 바뀐 문단만 기억 · 그대로 쓸 번역이 안 맞는다.
 *   대사가 있는 문단: 말한 사람과 이름이 나온 사람의 줄 전체(말투 포함). 말한 사람을 모르면(who 가 null) 늘 넣는 캐릭터 · 페르소나도 줄 전체:
 *     이름 없이 말하는 대사의 주인은 대개 늘 넣는 사람이라, 모르는 문단은 그 사람들 말투가 바뀌어도 다시 나가야 한다.
 *     말한 사람을 알면 그 사람만 줄 전체다: 늘 넣는 사람 전부를 넣었더니 한 사람 말투를 고치면 다른 사람만 말한 대사 문단까지 다 다시 나갔다
 *   그 밖의 사람(대사 없는 문단은 전부): 한글 표기 · 성별만(서술의 이름 표기 · 그/그녀에 쓰인다)
 *   그리고 이 문단에 실릴 용어 줄
 * @param {string[] | null} [who] 이 문단에서 말한 사람 id(speakerIds). null 은 모름
 */
export function paragraphMark(p, src, who = null, { listOrder = false } = {}) {
    const cast = p.people ?? [], always = p.always ?? [], spoken = SPOKEN.test(src);
    const named = new Set(people.pick(cast, { texts: [src] }));
    const whole = x => spoken && (named.has(x) || (who ? who.includes(x.id) : always.includes(x.id)));
    const list = people.pick(cast, { always, texts: [src] });
    for (const x of cast) if (who?.includes(x.id) && !list.includes(x)) list.push(x);
    const rows = list.map(x => (whole(x) ? people.line(x, cast) : `${x.id}=${x.ko || ''};${x.gender || ''}`));
    // 사람 목록의 차례는 지문에 넣지 않는다: 사람을 저장하거나 쓰는 곳을 옮기면 차례만 바뀌는데, 그때 그 사람이 걸린 문단이 전부 다시 나갔다
    if (!listOrder) rows.sort();
    const termLines = terms.pick(p.names ?? [], src, { skip: cast.flatMap(x => x.names || []) }).lines;
    return hashOf(JSON.stringify([rows, termLines]));
}

/**
 * 받은 조각에서 말한 사람의 id(엔진의 piece.speakers: 원문 이름표 + 모델이 머리에 적은 사람의 화면 이름).
 * 하나라도 사람 목록에서 못 찾거나 모델이 모른다고 했거나, 대사가 있는데 아무도 안 적혔으면 null(모름: 늘 넣는 사람 전부로 본다)
 * @returns {string[] | null}
 */
export function speakerIds(cast, piece) {
    const names = piece.speakers ?? [];
    if (!names.length) return null;
    const ids = names.map(name => (name ? people.resolve(cast, name)?.id : null));
    return ids.every(Boolean) ? [...new Set(ids)].sort() : null;
}

/**
 * 이 문단의 '걸린 것' 기록: [말한 사람 id 또는 null, 그때의 지문]. 기억 줄과 짝 기록에 같이 적어 두고, 쓸 때 지금 설정으로 다시 만든 지문과 견준다.
 * 기억 · 그대로 쓸 번역에서 채운 조각은 모델 답이 없어 그 줄에 적혀 있던 말한 사람을 쓴다(reused: 문단 원문 → 말한 사람)
 */
const dependsOf = (p, piece, reused = new Map()) => {
    const who = piece.from === 'model' ? speakerIds(p.people ?? [], piece) : reused.get(piece.src) ?? null;
    return [who, paragraphMark(p, piece.src, who)];
};
/** 적어 둔 '걸린 것'이 지금도 같은가 */
// 차례를 넣어 만든 옛 지문으로 적힌 줄도 읽는다(새로 적는 것은 차례 없는 지문)
const stillHolds = (p, src, [who, mark]) => paragraphMark(p, src, who) === mark || paragraphMark(p, src, who, { listOrder: true }) === mark;

/** 걸린 것을 적어 넣는 열쇠: 문단 원문 + 설정 지문(사람 · 용어는 값에 적은 지문으로 견준다) */
const dependKey = (p, src) => paragraphKey(src, `${p.memory.mark}|who`);

/**
 * 걸린 것을 따로 적지 않은 옛 기억 줄의 열쇠들(앞의 것부터). 읽기만 하고 새로 넣지 않는다.
 *   지문에 말한 사람을 모르는 문단과 같은 판정(늘 넣는 사람 전부)을 넣은 열쇠
 *   mark 만: '그 채팅을 열면 붙일 답' 줄(store/later.js)이 바꾸기 전에 적어 둔 지문(그때의 사람 · 용어 전부가 든 것)으로 찾을 때
 *   oldMark: 지금 사람 · 용어 전부로 만든 옛 꼴 지문. 사람 · 용어가 하나라도 바뀌면 지문이 달라 맞지 않는다(설정이 같을 때만 옛 기억을 쓴다)
 */
function oldKeysOf(p, src) {
    const { mark, oldMark } = p.memory;
    return [paragraphKey(src, `${mark}|${paragraphMark(p, src, null, { listOrder: true })}`), paragraphKey(src, mark), ...(oldMark ? [paragraphKey(src, oldMark)] : [])];
}

const keysOf = (p, src) => [dependKey(p, src), ...oldKeysOf(p, src)];

/** 걸린 것을 적은 기억 줄의 값 → { 번역, 말한 사람 }(지금 설정과 맞지 않거나 꼴이 다르면 undefined) */
function fromDependRow(p, src, value) {
    let row;
    try { row = JSON.parse(value); } catch { return undefined; }
    if (typeof row?.t !== 'string' || !Array.isArray(row.d)) return undefined;
    return stillHolds(p, src, row.d) ? { text: row.t, who: row.d[0] } : undefined;
}

/** 기억에서 이 글의 문단들을 미리 찾아 둔다(엔진은 문단마다 바로 답을 받아야 해서) → 문단 원문 → { 번역, 말한 사람(옛 줄은 null) } */
async function recall(p, skip) {
    const found = new Map();
    if (!p.memory) return found;
    const sources = split(p.text, { hold: p.hold, skip }).filter(isSent).map(piece => piece.src);
    const keys = sources.map(src => keysOf(p, src));
    // 새로 받을 때는 이 문단들의 옛 기억을 먼저 지운다: 도중에 끊겨 이어 받을 때 이번에 받은 것만 남아 있게
    if (p.fresh) { await p.memory.store.forget(keys.flat()); return found; }
    const got = await p.memory.store.getMany(keys.flat(), { chat: p.memory.chat });
    sources.forEach((src, i) => {
        const [first, ...old] = keys[i];
        const row = got.has(first) ? fromDependRow(p, src, got.get(first)) : undefined;
        const hit = row ? null : old.find(k => got.has(k));
        if (row) found.set(src, row);
        else if (hit) found.set(src, { text: got.get(hit), who: null });
    });
    return found;
}

/**
 * 이 재료(job/run.js prepare 의 값)의 문단 가운데 기억에 있는 것. 요청 수를 어림할 때 쓴다(엔진이 읽을 것과 같은 열쇠로 찾는다).
 * @returns {Promise<Set<string>>} 문단 원문
 */
export async function remembered(plan) {
    const found = await recall({ ...plan, text: plan.original }, plan.keepKorean ? isKorean : undefined);
    return new Set(found.keys());
}

/**
 * 이 재료의 문단 기억을 지운다(번역을 지울 때: 지운 뒤 번역을 누르면 요청 없이 같은 번역이 다시 붙지 않게).
 * @returns {Promise<void>}
 */
export async function forget(plan) {
    await recall({ ...plan, text: plan.original, fresh: true }, plan.keepKorean ? isKorean : undefined);
}

/** 이번에 모델에게 받은 문단을 기억에 적는다(끝까지 받았든 도중에 끊겼든) */
async function remember(p, pieces) {
    if (!p.memory) return;
    for (const piece of pieces ?? []) {
        if (piece.from !== 'model' || typeof piece.out !== 'string' || piece.patched || piece.doubt?.length) continue;
        if (piece.out.trim() === piece.src.trim()) continue;
        p.memory.store.put(dependKey(p, piece.src), JSON.stringify({ t: piece.out, d: dependsOf(p, piece) }), { chat: p.memory.chat });
    }
    await p.memory.store.flush();
}

// ── 표기가 빈 이름 ──

const HANGUL = /[가-힣]/;
const NAME_ANSWER = /^[가-힣][가-힣 ·]{0,19}$/;
// '위에 쓴 대로 적어라'만으로는 영어 이름을 원문 그대로 적었다(실제 요청 2개 중 0개가 한글): 한글로 적으라고 짚는다
const NAMES_NOTE = (from, to) => (from === to ? `Passage ${from} is a name: answer with the Hangul spelling you used for it above, no braces.` : `Passages ${from} to ${to} are names: answer each with the Hangul spelling you used for it above, no braces.`);

/**
 * 이번에 보낼 문단에 이름이 나오는데 한글 표기가 비어 있는 사람(이름이 이미 한글이면 물을 것이 없다).
 * 다시 번역에서는 묻지 않는다(표기는 처음 번역에서 정해진다). 보낼 문단이 없으면 아무도 없다: 이름 문단만 든 요청이 나가지 않게.
 * @param {(src: string) => unknown} kept 그 문단의 번역을 이미 갖고 있나
 */
function unnamed(p, skip, kept) {
    if (p.redo) return [];
    const sending = split(p.text, { hold: p.hold, skip }).filter(isSent).map(piece => piece.src).filter(src => kept(src) === undefined);
    if (!sending.length) return [];
    return people.pick(p.people ?? [], { texts: sending }).filter(x => !x.ko && x.names?.[0] && !HANGUL.test(x.names[0]));
}

/**
 * 본문 뒤에 같이 실을 글에 이름 문단을 더한다. 이름 문단이 상태창 글보다 앞이다:
 * 상태창 글의 답을 알리는 쪽(job/run.js withExtras)이 요청의 맨 뒤 문단들이 상태창 글인지로 실렸는지를 본다.
 * @param {object | undefined} extras 상태창 글(run/translate.js job.extras 꼴)  @param {object[]} asks 물을 사람  @param {Map<string, string>} answers 사람 id → 모델이 적은 글
 */
function withNamePassages(extras, asks, answers) {
    if (!asks.length) return extras;
    const more = extras?.bodies ?? [];
    return {
        bodies: [...asks.map(x => x.names[0]), ...more], optional: asks.length,
        note: (from, to) => [NAMES_NOTE(from, from + asks.length - 1), more.length ? extras.note(from + asks.length, to) : ''].filter(Boolean).join(' '),
        onExtra: (i, text) => (i < asks.length ? answers.set(asks[i].id, text) : extras.onExtra(i - asks.length, text)),
        set sent(value) { if (extras) extras.sent = value; },
        get sent() { return Boolean(extras?.sent); },
    };
}

/** 모델이 이름 문단에 적은 글 가운데 표기로 쓸 것: 한글 낱말 꼴이고, 이번에 받은 번역문에 실제로 나온 것만 → 사람 id → 표기 */
function learnedNames(answers, pieces) {
    const body = (pieces ?? []).filter(piece => piece.from === 'model').map(piece => piece.out ?? '').join('\n'), out = new Map();
    for (const [id, raw] of answers) {
        const ko = String(raw ?? '').trim();
        // 성까지 적은 이름은 본문에 이름만 나오는 일이 흔하다('레나토 크루즈'로 답하고 본문에는 '레나토'): 낱말 하나라도 본문에 나오면 받는다
        if (NAME_ANSWER.test(ko) && ko.split(/[ ·]+/).some(word => word.length >= 2 && body.includes(word))) out.set(id, ko);
    }
    return out;
}

/**
 * 사용자가 번역문을 손으로 고쳐 저장했을 때, 글이 바뀐 문단을 기억에 적는다(모델에게 받은 문단과 같은 열쇠 · 같은 꼴).
 * 고친 번역문에서 제 자리를 못 찾은 문단(문단을 합치거나 나눈 곳)은 적지 않는다.
 * @param {object} plan 그 답의 번역 재료(job/run.js prepare 의 값)  @param {object | null} saved 그 답의 문단 짝 기록
 * @param {string} before 고치기 전 번역문  @param {string} after 고친 번역문
 * @returns {Promise<number>} 적은 문단 수
 */
export async function rememberEdited(plan, saved, before, after) {
    if (!plan?.memory || !saved) return 0;
    const p = { ...plan, text: plan.original };
    const was = reusable(saved, before, p.hold), now = reusable(saved, after, p.hold), depends = recordedDepends(saved);
    const sources = split(p.text, { hold: p.hold, skip: plan.keepKorean ? isKorean : undefined }).filter(isSent).map(piece => piece.src);
    let count = 0;
    for (const src of sources) {
        const key = mark(src), text = now.get(key);
        if (typeof text !== 'string' || !text.trim() || text === was.get(key)) continue;
        const who = depends.get(key)?.[0] ?? null;
        const out = /^\s*/.exec(src)[0] + text.trim() + /\s*$/.exec(src)[0];
        p.memory.store.put(dependKey(p, src), JSON.stringify({ t: out, d: [who, paragraphMark(p, src, who)] }), { chat: p.memory.chat });
        count += 1;
    }
    if (count) await p.memory.store.flush();
    return count;
}

/**
 * @param {object} p
 * @param {string} p.text  @param {RegExp[]} p.hold  @param {boolean} p.keepKorean  @param {string} p.method 매크로를 푼 프롬프트
 * @param {object[]} p.people 사람(core/people.js 꼴)  @param {string[]} p.always 글에 이름이 없어도 사람 줄에 넣을 사람 id
 * @param {{ src: string, dst: string }[]} p.names 사람이 아닌 이름(먼저 온 것이 이긴다)
 * @param {string} [p.rules] 내 규칙 글  @param {string} [p.context] 앞 대화 글
 * @param {string[]} [p.notes] 이번 요청에만 붙일 조건 줄('- ' 로 시작하는 글)
 * @param {boolean} [p.redo] 다시 번역  @param {string} [p.guidance] 이번에 지킬 말투나 부탁(사용자 글)
 * @param {((src: string) => string) | string} [p.previous] 같이 보낼 앞 번역문: 문단 원문 → 그 문단의 것(없으면 ''), 또는 문단으로 못 나눈 글 하나
 * @param {{ src: string, lead: string, who: string }[]} [p.fixed] 사용자가 바로잡은 대사 주인: 그 원문 문단 · 문단 첫머리 · 이름
 * @param {boolean} [p.fresh] 이 글의 기억을 지우고 새로 받는다
 * @param {Map<string, { text: string, depends?: array }>} [p.prior] 이 답에 붙어 있던 번역에서 그대로 쓸 문단(문단 원문 지문 → 번역과 그때 걸린 것). 안 주면 offerPrior 로 맡겨 둔 것
 * @param {{ store: object, mark: string, chat?: string }} [p.memory] 문단 번역 기억(store/memory.js createMemory 의 것), 설정 지문, 채팅 id
 * @param {(text: string, o: object) => Promise<string>} p.send  @param {AbortSignal} [p.signal]
 * @param {object} [p.extras] 본문과 같은 요청에 실어 보낼 글(상태창 글): run/translate.js 의 job.extras 꼴. 실어 보냈으면 extras.sent 가 true 가 된다
 * @param {(stage: object) => void} [p.onProgress] { stage: 'segments', done, total }
 * @param {object} [p.report] 결과 칸: translatedParagraphs, reusedParagraphs, pairs, failed, requests, requestChars, names(이번에 정해진 한글 표기 [{ id, ko, names }])
 * @returns {Promise<string>}
 */
export async function run(p) {
    const cast = p.people ?? [], names = p.names ?? [], sizes = [];
    const skip = p.keepKorean ? isKorean : undefined;
    const have = await recall(p, skip), earlier = fromPrior(p), reused = new Map();
    const fill = src => { const got = earlier(src) ?? have.get(src); if (got) reused.set(src, got.who); return got?.text; };
    const parts = partsOf(p), asks = unnamed(p, skip, src => earlier(src) ?? have.get(src)), answers = new Map();
    // 전체 문단 수는 시작 알림에만 실려 온다(문단 하나를 받았다는 알림에는 받은 수만 있다): 시작 때 적어 두고 받을 때마다 같이 넘긴다.
    //   안 그러면 받은 알림부터는 전체 수가 비어 진행 표시에서 수가 사라졌다
    let total = 0;
    const onEvent = event => {
        if (event.type === 'start') total = event.total;
        if (event.type === 'start' || event.type === 'piece') p.onProgress?.({ stage: 'segments', done: event.done ?? event.ready, total });
    };
    let result;
    try {
        result = await translate({
            text: p.text, parts, signal: p.signal, onEvent, hold: p.hold, skip, extras: withNamePassages(p.extras ?? undefined, asks, answers),
            repair: false,   // 답 하나는 요청 한 번: 원문이 남은 문단을 다시 보내지 않는다(남은 문단은 다시 번역 버튼으로)
            keepHan: names.map(n => n.dst).filter(dst => /\p{Script=Han}/u.test(dst)),
            have: fill,
            send: (full, options) => sendIfAny(p.send, full, options, sizes),
        });
    } catch (error) {
        await remember(p, error?.partial?.pieces);
        throw error;
    }
    // 이번에 정해진 표기는 이 답의 기억 줄 · 짝 기록에도 든 것으로 적는다: 안 그러면 표기가 저장된 뒤 이 답의 그 사람 문단이 전부 '설정이 바뀐 문단'이 돼 다시 나간다
    const spelled = learnedNames(answers, result.pieces);
    const q = spelled.size ? { ...p, people: cast.map(x => (spelled.has(x.id) ? { ...x, ko: spelled.get(x.id) } : x)) } : p;
    await remember(q, result.pieces);
    if (p.report) {
        fillReport(p.report, result, sizes, record(p.text, result.pieces, recordName(q.people ?? []), piece => dependsOf(q, piece, reused)));
        p.report.names = [...spelled].map(([id, ko]) => ({ id, ko, names: cast.find(x => x.id === id)?.names ?? [] }));
    }
    console.info(`[번역] 요청 ${sizes.length}번(${sizes.join(' + ')}자), 못 받은 조각 ${result.failed.length}개`);
    return result.text;
}

/** 요청 글의 묶음들: 옮기는 법, 내 규칙, 조건 줄, 보내는 글에 나오는 사람과 용어(사람 · 용어 묶음은 어떤 프롬프트로 보내든 붙는다) */
function partsOf(p) {
    const cast = p.people ?? [], names = p.names ?? [];
    return ({ source, sources = [], marks = true }) => {
        const list = people.pick(cast, { always: p.always ?? [], texts: [source] });
        const table = people.letters(list);
        const known = marks ? knownSpeakers(sources, table, cast, p.fixed) : { heads: [], notes: [] };
        return {
            method: p.method, rules: p.rules ?? '', context: p.context ?? '',
            notes: [...(p.notes ?? []), ...known.notes], known: known.heads,
            people: people.block(list, cast, { withLetters: marks }), letters: table,
            terms: terms.block(terms.pick(names, source, { skip: cast.flatMap(x => x.names || []) })),
            redo: Boolean(p.redo), guidance: p.guidance ?? '',
            previous: typeof p.previous === 'function' ? sources.map(src => p.previous(src) ?? '') : p.previous ?? [],
        };
    };
}

/**
 * 보내는 쪽 문단 머리에 미리 적을 말한 사람(모델은 옮겨 적기만 한다): 원문의 이름표 줄(이름 | "대사")에서 읽은 사람, 사용자가 바로잡은 주인.
 * 사람 표에 있으면 그 글자, 없으면 이름. 바로잡은 주인의 문단을 보내는 조각에서 못 찾으면(조각 하나에 문단이 여럿) 문단 첫머리 글로 가리키는 문장.
 * @returns {{ heads: string[][], notes: string[] }}
 */
function knownSpeakers(sources, table, cast, fixed = []) {
    const letterOf = name => { const person = people.resolve(cast, name); return [...table].find(([, x]) => x === person)?.[0] ?? name; };
    const heads = sources.map(src => [...new Set(people.labeled(src).map(letterOf))]);
    const notes = [];
    for (const { src, lead, who } of fixed ?? []) {
        const at = sources.findIndex(s => s.trim() === String(src ?? '').trim()), letter = letterOf(who);
        if (at >= 0) heads[at] = [letter];
        else if (lead) notes.push(`The passage that begins with "${lead}" is spoken by ${letter}.`);
    }
    return { heads, notes };
}

/**
 * 보낼 조각이 하나도 없는 요청은 보내지 않는다. 문단이 전부 기억에 있으면 엔진(run/translate.js sendGroups)이 빈 묶음 하나로
 * 요청을 만들어 보낸다(묶는 기준을 넘기지 않을 때). 그 파일은 고치지 않는 파일이라 여기서 막는다.
 */
function sendIfAny(send, full, options, sizes) {
    if (!sentBodies(full).length) return '';
    sizes.push(full.length);
    return send(full, options);
}

function fillReport(report, result, sizes, pairs) {
    report.translatedParagraphs = result.pieces.filter(piece => piece.from === 'model').length;
    report.reusedParagraphs = result.pieces.filter(piece => piece.from === 'kept').length;
    report.failed = result.failed;
    report.requests = sizes.length;   // 실제로 나간 요청 수
    report.requestChars = sizes;
    report.pairs = pairs;
}
