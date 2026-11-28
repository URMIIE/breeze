// 번역 한 번. 실리태번도 화면도 모른다: 필요한 것은 전부 넘겨받는다.
//
// 흐름: 조각내기 → 이미 있는 번역 채우기 → 가리기 → 한도에 맞춰 묶기 → 보내고 받는 대로 풀기 → 잇기(끊긴 답은 이어 받지 않는다: 받은 데까지만)
// 답 하나는 요청 한 번이다: 원문이 남은 조각 · 끝이 끊긴 조각을 저절로 다시 보내지 않는다(남은 것은 다시 번역 버튼으로).
// 받은 조각은 버리지 않는다: 조각이 닫힐 때마다 onPiece 로 알리고(부르는 쪽이 적어 둔다), 실패해도 그때까지의 결과를 오류에 실어 보낸다.

import { split, join, isSent } from '../core/split.js';
import { mask, unmask, hasBody } from '../core/protect.js';
import { feed, finish, speakersOf, cutShort } from '../core/reply.js';
import { build, groups, SHAPE, PLAIN_SHAPE } from '../core/request.js';
import { doubts } from '../core/checks.js';
import { restoreData } from '../core/data-block.js';
import { labeled, needsMarks, lettersOfBlock } from '../core/people.js';
import { sourceLanguage } from '../core/lang.js';

/**
 * @param {object} job
 * @param {string} job.text 원문
 * @param {RegExp[]} [job.hold] 보내지 않고 제자리에 둘 글의 규칙
 * @param {RegExp[]} [job.cover] 조각 안에서 가릴 글의 규칙
 * @param {(body: string) => boolean} [job.skip] 보내지 않을 문단인가
 * @param {(src: string) => string | undefined} [job.have] 이 조각의 번역을 이미 갖고 있으면 그 글
 * @param {(info: { lang: string, bodies: string[], source: string, sources: string[] }) => object} job.parts
 *   요청에 넣을 것 { method, rules, people, terms, context, notes, letters?, redo?, guidance?, previous? }. 묶음마다 부른다(용어 · 사람은 그 묶음의 글로 고른다).
 *   sources: 보내는 조각의 원문(가리기 전). letters: 사람 묶음의 글자 → 사람(core/people.js letters). 안 주면 사람 묶음 글에서 글자 → 이름을 읽는다
 * @param {(text: string, o: { fixed: string, onText: (raw: string) => void, signal?: AbortSignal }) => Promise<string>} job.send
 *   요청을 보내고 답 전체를 돌려준다. onText 에는 지금까지 온 답 전체를 준다
 * @param {number} [job.outputTokens] 연결의 출력 한도(모르면 0)
 * @param {string} [job.lang] 원문 언어(안 주면 글에서 가린다)  @param {string} [job.shape] 답 형식(안 주면 대사 주인 표시까지 쓰는 본문용)
 * @param {{ bodies: string[], note: (from: number, to: number) => string, onExtra: (index: number, text: string) => void, sent?: boolean, optional?: number }} [job.extras]
 *   본문과 같은 요청에 실어 보낼 글(화면 글자). 실어 보냈으면 sent 를 true 로 적는다. optional: 앞에서부터 이 수만큼은 답이 안 와도 되는 글
 * @param {boolean} [job.whole] 글을 나누지 않고 한 조각으로 보낸다(원문과 기존 번역을 묶어 보내 고친 번역 하나를 받을 때). hold 는 그 조각 안에서 가린다
 * @param {(event: object) => void} [job.onEvent] 진행 신호: start · group · piece(text() = 지금까지의 글) · end
 * @param {(piece: { index: number, src: string, text: string }) => void} [job.onPiece] 조각이 닫힐 때마다
 * @param {AbortSignal} [job.signal]
 * @returns {Promise<{ text: string, lang: string, pieces: object[], failed: number[], requests: number, repaired: number }>}
 *   pieces[i]: { kind, src, out?, from?: 'model' | 'kept', speakers?, patched?, doubt?: string[] }  failed: 번역이 안 온 조각 번호(원문 그대로 둠). repaired 는 늘 0(다시 보내지 않는다)
 *   speakers: 그 조각에서 말한 사람. 표의 사람은 그 사람의 화면 이름(한글 표기, 없으면 첫 원문 이름) 하나로 모은다(같은 사람의 여러 표기가 한 사람),
 *   표에 없는 이름은 모델이 적은 그대로, 모름은 ''
 */
export async function translate(job) {
    const run = plan(job);
    const { pieces, todo, onEvent } = run;
    onEvent({ type: 'start', total: pieces.filter(isSent).length, ready: pieces.filter(p => p.from === 'kept').length, sending: todo.length });
    try {
        await sendGroups(run);
    } catch (error) {
        error.partial = snapshot(run);
        throw error;
    }
    const out = snapshot(run);
    onEvent({ type: 'end', failed: out.failed.length, requests: out.requests });
    return out;
}

/** 원문을 조각으로 나누고, 이미 번역이 있는 조각을 채우고, 보낼 조각을 가려 둔다 */
function plan(job) {
    const { text, hold = [], cover = [], skip, have = () => undefined, whole = false } = job;
    const pieces = whole ? [{ kind: 'text', src: text, holds: [], wrap: '' }] : split(text, { hold, skip }).map(piece => ({ ...piece }));
    const todo = [];
    pieces.forEach((piece, index) => {
        if (!isSent(piece)) return;
        const kept = have(piece.src);
        if (typeof kept === 'string') { piece.out = kept; piece.from = 'kept'; return; }
        const masked = whole ? mask(piece, hold, { shared: true }) : mask(piece, cover);
        if (hasBody(masked)) todo.push({ index, masked });
    });
    return {
        pieces, todo, lang: job.lang ?? sourceLanguage(text), shape: job.shape, extras: job.extras, requests: 0, repaired: 0,
        parts: job.parts, send: job.send, signal: job.signal, outputTokens: job.outputTokens ?? 0,
        onEvent: job.onEvent ?? (() => {}), onPiece: job.onPiece ?? (() => {}),
    };
}

/** 지금까지의 결과 */
function snapshot(run) {
    const done = new Map();
    run.pieces.forEach((piece, i) => { if (typeof piece.out === 'string') done.set(i, piece.out); });
    return {
        text: join(run.pieces, done), lang: run.lang, pieces: run.pieces,
        failed: run.todo.filter(item => !done.has(item.index)).map(item => item.index),
        requests: run.requests, repaired: run.repaired,
    };
}

const shownOf = person => person?.ko || person?.names?.[0] || '';

/** 그 조각에서 말한 사람: 원문의 이름표(이름 | "대사") + 모델이 문단 머리에 적은 글자 · 이름 */
function speakersIn(src, sent, got, table) {
    const said = speakersOf(got, table, sent);
    return [...new Set([...labeled(src), ...said.known.map(person => (typeof person === 'string' ? person : shownOf(person))).filter(Boolean), ...said.names, ...(said.unknown ? [''] : [])])];
}

/** 답 하나를 그 조각에 붙인다. 이미 번역이 붙은 조각은 그대로 둔다(받는 중에 붙인 것) */
function accept(run, item, got, table) {
    const piece = run.pieces[item.index];
    if (typeof piece.out === 'string') return;
    // 문단 안 JSON 자료는 원문 틀로 되돌린 글을 쓴다(core/data-block.js): 아래 확인 · 화면 · 번역 기억이 모두 이 글을 본다.
    //   받는 중에도 닫힌 문단만 여기 오므로 JSON 이 덜 닫힌 글을 다루지 않는다
    got = { ...got, text: restoreData(item.masked.body, got.text) };
    const back = unmask(got.text, item.masked);
    piece.out = item.masked.head + back.text + item.masked.tail;
    piece.from = 'model';
    piece.patched = back.patched;
    piece.speakers = speakersIn(piece.src, item.masked.body, got, table);
    // 확인 셋(core/checks.js): 걸린 조각은 붙이되 번역 기억에 넣지 않고(job/engine.js remember), 짝 기록에 표시해 다시 번역 판에서 먼저 골라 둔다
    piece.doubt = doubts(item.masked.body, got.text, { korean: run.shape !== PLAIN_SHAPE });
    if (got.cut) piece.doubt.push('cut');   // 끊긴 답의 마지막 조각(sendRound): 끝 모양은 멀쩡해도 다 받았는지 알 수 없다
    run.onPiece({ index: item.index, src: piece.src, text: piece.out });
    const done = run.pieces.filter(p => isSent(p) && typeof p.out === 'string').length;
    run.onEvent({ type: 'piece', index: item.index, done, text: () => snapshot(run).text });
}

/**
 * 조각 묶음 하나를 보내고 답을 붙인다. 끊긴 답 · 빠진 조각은 다시 받지 않는다(받은 데까지만).
 * @param {{ extras?: object }} [o] extras: 본문 조각 뒤에 같은 요청으로 실어 보내는 글(화면 글자). 번호는 본문 조각 뒤로 이어지고, 답은 extras.onExtra 로 넘긴다
 */
async function sendRound(run, items, { extras = null } = {}) {
    const own = items.map(item => item.masked.body), more = extras?.bodies ?? [];
    const bodies = [...own, ...more];
    const cells = items.map((item, i) => (run.pieces[item.index].kind === 'cell' ? i : -1)).filter(i => i >= 0);
    // 말한 사람을 적게 할지: 이름표 없는 대사 줄이 있을 때만(본문 꼴일 때). 사람 묶음의 글자도 이때만 싣는다
    const marks = (!run.shape || run.shape === SHAPE) && needsMarks(own);
    const filling = run.parts({ lang: run.lang, bodies: own, source: own.join('\n\n'), sources: items.map(item => run.pieces[item.index].src), marks });
    if (more.length) filling.notes = [...(filling.notes ?? []), extras.note(own.length + 1, bodies.length)];
    // 답의 글자를 풀 표: 넘겨받은 것, 없으면 사람 묶음 글에서 글자 → 이름(이름은 부르는 쪽이 사람으로 다시 찾는다)
    const table = filling.letters ?? lettersOfBlock(filling.people);
    const built = build({ ...filling, bodies, marks, cells, ...(run.shape ? { shape: run.shape } : {}) });
    run.requests++;

    // 받는 중: 닫힌 조각부터 붙인다
    let shown = 0;
    const onText = soFar => {
        const closed = feed(soFar, bodies.length);
        for (; shown < closed.length; shown++) take(shown, closed[shown]);
    };
    // 조각 번호가 본문 것이면 본문에 붙이고, 덧붙인 글이면 그쪽으로 넘긴다
    const take = (i, got) => {
        if (i < items.length) accept(run, items[i], got, table);
        else if (got?.text) extras.onExtra(i - items.length, got.text);
    };
    const done = finish(await run.send(built.text, { fixed: built.fixed, signal: run.signal, onText }), bodies.length);
    if (more.length) extras.sent = true;
    // 끝이 문장 중간에서 끊긴 조각은 붙이지 않는다(못 받은 조각으로 남아 다시 누르면 그것만 나간다): 끝 모양으로 본다(cutShort).
    //   답이 끊겼을 때 마지막으로 온 조각(받는 중에 이미 닫혀 붙은 것이 아니면)은 끝에 쓰다 만 자리표만 떼고 끝 모양을 본다.
    //   번역은 다 왔는데 그 뒤의 자리표만 쓰다 만 답이 있었다(출력 한도에 닿음): 그 조각을 버리면 번역이 왔는데도 원문이 남았다.
    //   끝 모양이 멀쩡하면 붙이되 의심으로 적는다(기억에 안 넣고 다시 번역 판에서 먼저 골라 둠). 빠진 자리표는 unmask 가 되돌린다.
    //   번호는 다 왔어도 맨 끝 조각의 끝 모양이 끊긴 꼴일 때도 붙이지 않는다(뒤에 덧붙인 글이 있으면 본문의 끝은 답의 끝이 아니다)
    //   안 와도 되는 덧붙인 글(extras.optional: 이름만 든 문단)만 빠진 답은 끊긴 답으로 보지 않는다: 모델이 그 문단을 안 적었을 뿐일 수 있어,
    //   본문의 끝은 번호가 다 온 답과 같이 끝 모양으로만 본다(안 그러면 그 문단을 빠뜨린 답마다 본문 마지막 문단이 원문으로 남는다)
    const last = items.length - 1, doubtful = new Set();
    const spared = done.cut && more.length === (extras?.optional ?? 0) && done.missing.every(i => i >= items.length);
    if (done.cut && !spared && done.suspect >= shown && done.suspect < items.length) {
        const got = done.pieces[done.suspect], trimmed = withoutHalfMark(got.text);
        // 끝 모양만으로는 모자라다: 여러 문장 문단은 문장 끝에서 끊겨도 멀쩡해 보인다(저장본 답 796곳을 잘라 보니 붙인 177개 가운데 129개가 덜 온 글).
        //   그래서 글 뒤의 것(자리표 · 다음 머리)을 쓰다 끊긴 때만, 곧 번역 글은 다 쓴 뒤에 끊긴 때만 붙인다
        if (trimmed && trimmed !== got.text.trimEnd() && !cutShort(items[done.suspect].masked.body, trimmed)) Object.assign(got, { text: trimmed, cut: true });
        else doubtful.add(done.suspect);
    }
    if ((spared || (!done.cut && !more.length)) && done.pieces[last] && cutShort(items[last].masked.body, done.pieces[last].text)) doubtful.add(last);
    done.pieces.forEach((got, i) => { if (got && !doubtful.has(i)) take(i, got); });
    return { cut: (done.cut && !spared) || doubtful.size > 0 };
}

// 답 끝에 쓰다 만 것: 자리표('[[' · '[[__VA' · '[[__VAR_0__]' 처럼 닫히지 않은 것. 다 쓴 '[[__VAR_0__]]' 는 맞지 않는다),
//   다음 문단 머리의 '¶' 만 쓴 줄(번호가 아직 안 와 새 문단으로 읽히지 않고 이 조각 끝에 붙는다)
const HALF_MARK = /\s*\[(?:\[_{0,2}|_{1,2})(?:V(?:A(?:R(?:_\d*(?:_{1,2}\]?)?)?)?)?)?$/;   // 홑 '[' 만으로는 떼지 않는다(자료 덩이의 '[' 가 끝에 올 수 있다)
const HALF_HEAD = /\n[ \t]*¶[ \t]*$/;
const withoutHalfMark = text => String(text ?? '').replace(HALF_HEAD, '').replace(HALF_MARK, '').trimEnd();

/** 출력 한도에 맞춰 묶어 차례로 보낸다. 못 받은 조각은 저절로 다시 보내지 않는다 */
async function sendGroups(run) {
    const order = groups(run.todo.map(item => item.masked.body), run.outputTokens, run.lang);
    if (order.length > 1) run.onEvent({ type: 'group', count: order.length });
    for (const [n, group] of order.entries()) {
        if (run.signal?.aborted) throw Object.assign(new Error('멈췄어요.'), { name: 'AbortError' });
        // 덧붙이는 글은 마지막 묶음에 한 번만 싣는다(보낼 본문 조각이 하나도 없으면 싣지 않는다: 부르는 쪽이 따로 보낸다)
        const extras = n === order.length - 1 && run.extras?.bodies.length ? run.extras : null;
        // 끊긴 답은 저절로 이어 받지 않는다: 받은 데까지만 쓰고, 남은 조각은 못 받은 것으로 남는다(다시 누르면 남은 것만 나간다)
        await sendRound(run, group.map(i => run.todo[i]), { extras });
    }
}
