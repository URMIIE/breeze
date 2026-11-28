// 메시지 하나를 번역해 붙이는 일. 줄(job/queue.js)이 이 일을 하나씩 돌린다.
//
// 흐름: 재료 모으기(원문 · 뺄 글 규칙 · 원문 언어 · 프롬프트(앞 대화 자리가 있으면 그 자리에 앞 대화) · 쓰는 곳 셋의 사람 · 이름 · 규칙) → 엔진(job/engine.js)으로 번역 → 대상이 그대로인지 보고 붙이기 → 저장 한 번.
// 글이 오다 멈추면(send/profile.js 의 idle) 받은 문단은 번역 기억에 남아 있으니, 정해 둔 횟수까지 남은 부분만 다시 보낸다.
// 끝내 못 받은 문단이 있으면 받은 데까지는 붙이고(원문 그대로 둔 문단과 함께), 못 받은 수와 이어 받는 데 드는 요청 수를 알린다.
// 실리태번 모듈을 직접 불러오지 않는다(getContext 로 받은 것만 쓴다). 그래서 거절 거르기는 브라우저 없이 시험한다.
// 재료(prepare)와 엔진 한 번(translateOnce)은 다시 번역(job/redo.js)과 채팅 전부 번역(job/batch.js)도 같은 것을 쓴다.
// 다른 채팅으로 가도 요청을 끊지 않고 끝까지 받는다. 그 채팅이 열려 있지 않으면 붙이지 않고 '그 채팅을 열면 붙일 답'으로 알린다(keep):
// 받은 문단은 번역 기억에 있어서, 그 채팅을 열면 요청 없이 붙는다(job/away.js).
// 그 메시지를 스와이프로 넘겨 새 답을 받는 중이어도 끊지 않는다. 끝나면 번역하던 스와이프의 사본에 적어, 그 스와이프로 돌아오면 요청 없이 보인다(placeOnSwipe).

import { run as engine } from './engine.js';
import { gather } from './sources.js';
import { earlier, hasSlot, fillSlot, contextOptions } from './earlier.js';
import { requestsFor } from './estimate.js';
import { sourceLanguage } from '../core/lang.js';
import { dropShort, notAnAnswer, sentBodies } from '../core/refusal.js';
import { swapPictures } from '../core/picture.js';
import { replaceBanned } from '../core/banned.js';
import { record } from '../store/pairs.js';
import { readSettings, connectionMark } from '../store/settings.js';
import { attach, attachToSwipe, viewOf } from '../store/message.js';
import { createMemory, ramStore, setupMark } from '../store/memory.js';
import { holdRules, withoutHeld } from '../rules/hold.js';
import { prefillSender, prefillMark } from '../send/prefill.js';
import { spacedSender } from '../rules/spacer.js';
import { withBilingualRule } from '../rules/bilingual.js';
import { watch, cancelled } from './guard.js';
import { tellClosed, tell } from './closed.js';

// 목표어가 한국어인 프롬프트일 때만 이미 한국어인 문단을 보내지 않는다(한국어를 다른 말로 옮기는 프롬프트에서는 그 문단이 옮길 글이다)
const KOREAN_TARGET = /(?:to|into)\s+korean|한국어로|한글로/i;

const refusedError = message => Object.assign(new Error(message), { refused: true });

// 기억을 넘겨받지 못했을 때(시험) 쓰는 메모리 기억. 멈춘 뒤 남은 부분만 다시 보내려면 받은 문단을 어딘가 적어 둬야 한다
let spare = null;
const spareMemory = () => (spare ??= createMemory(ramStore()));

/** 글자의 절반 넘게가 한글인가(한국어로 쓴 글을 다른 말로 옮기는 요청: 길이 기준은 한국어로 옮길 때 잰 것이라 보지 않는다) */
const mostlyHangul = text => { const all = (text.match(/\p{L}/gu) || []).length; return all > 0 && (text.match(/\p{Script=Hangul}/gu) || []).length * 2 > all; };

/**
 * 보내기 함수에 답 꼴 확인을 씌운다(core/refusal.js). 번역이 아닌 조각(긴 원문에 아주 짧은 답)은 답에서 빼서 엔진이 '안 온 조각'으로 보고 원문 그대로 둔다.
 * 문단 머리가 하나도 없는 답은 번역이 아니라 오류로 끝낸다(받은 글의 첫 줄을 까닭으로).
 * 그렇게 뺀 조각만 다시 묻는 요청은 보내지 않는다: 같은 글을 같은 모델이 또 같은 답을 낸다.
 */
export function refusalFilter(send) {
    const refusedBodies = new Set();
    return async (prompt, o = {}) => {
        const bodies = sentBodies(prompt), source = bodies.join('\n');
        if (bodies.length && bodies.every(body => refusedBodies.has(body))) return '';
        const lang = mostlyHangul(source) ? 'ko' : sourceLanguage(source);
        const onText = o.onText && (raw => o.onText(dropShort(raw, bodies, lang, false).text));
        const raw = await send(prompt, { ...o, onText });
        const why = notAnAnswer(raw, bodies.length);
        if (why) throw refusedError(`번역이 아닌 답이 왔어요: ${why}`);
        const out = dropShort(raw, bodies, lang, true);
        for (const id of out.dropped) refusedBodies.add(bodies[id - 1]);
        if (out.dropped.length) console.info(`[번역] 원문보다 너무 짧게 온 문단 ${out.dropped.length}개는 번역이 아닌 것으로 보고 원문 그대로 둬요`);
        return out.text;
    };
}

/** 캐릭터와 페르소나만 든 사람 목록(쓰는 곳 셋을 넘겨받지 못했을 때) */
function castOnly(context) {
    const people = [{ id: 'char', names: [context.name2] }, { id: 'user', names: [context.name1] }].filter(p => p.names[0]);
    return { people, always: people.map(p => p.id), names: [], rules: '' };
}

/**
 * 프롬프트(나 내 규칙 글)의 앞 대화 자리에 넣을 글. 그 글에 자리가 없으면 만들지 않는다('').
 * 번역할 메시지의 앞에서 고른다. 번역할 메시지는 빼는 설정을 꺼 두면 그 메시지까지 넣는다(옛 설정 칸의 뜻 그대로).
 * @param {{ context: object, message: object, template: string, hold: RegExp[] | ((message: object) => RegExp[]) }} o
 *   hold: 앞 답에서 뺄 글의 규칙. 함수면 답마다 그 답의 규칙을 받는다(화면에서 지워지는 블록은 답마다 글자가 다르다)
 */
function earlierFor({ context, message, template, hold }) {
    const at = context.chat?.indexOf(message) ?? -1;
    if (at < 0 || !hasSlot(template)) return '';
    const options = contextOptions(context.extensionSettings);
    return earlier(context.chat, options.excludeLast ? at : at + 1, hold, options);
}

/**
 * 번역 재료(보내기는 빼고). 원문이 비었으면 null.
 * @param {object} o
 * @param {object} o.context 실리태번 getContext()
 * @param {object} o.settings store/settings.js readSettings 의 값(고른 프로필 · 프롬프트를 덮은 것)
 * @param {object} o.message 번역할 메시지
 * @param {object} [o.picked] job/sources.js gather 의 값(없으면 사람 줄 · 이름 · 규칙 없이 캐릭터 · 페르소나만)
 * @param {object} [o.memory] 문단 번역 기억(store/memory.js createMemory 의 것)
 * @param {(message: object) => RegExp[]} [o.holdFor] 그 메시지의 뺄 글 규칙(사용자가 고른 화면용 정규식의 블록까지 든 것). 없으면 설정의 규칙만
 * @param {string} [o.mes] 번역할 글(매크로를 풀기 전). 그 메시지의 다른 스와이프가 보이는 중일 때 번역하던 스와이프의 글을 준다. 안 주면 message.mes
 * @returns {{ original, hold, lang, method, promptTitle, keepKorean, people, always, names, rules, memory } | null}
 *   method: 매크로를 푼 프롬프트. 프롬프트에 앞 대화 자리가 있으면 그 자리에 앞 대화가 든 글이다
 */
export function prepare({ context, settings, message, picked, memory, holdFor, mes = message.mes }) {
    const original = context.substituteParams(mes, context.name1, message.name);
    if (!String(original ?? '').trim()) return null;
    // 뺄 글 규칙은 번역할 글로 만든다(다른 스와이프가 보이는 중이면 그 글을 든 사본으로)
    const hold = holdFor ? holdFor(mes === message.mes ? message : { ...message, mes }) : holdRules(settings, context);
    // 원문 언어는 보내는 글로만 가린다
    const lang = sourceLanguage(withoutHeld(original, hold));
    const prompt = settings.prompt(lang);
    // 대사 뒤 괄호의 다른 언어 글을 빼는 규칙은 켜 둔 때에만 프롬프트에 붙는다(rules/bilingual.js)
    const template = withBilingualRule(prompt.text, context.extensionSettings);
    // 앞 대화 자리를 비운 프롬프트: 기억의 열쇠와 목표어 판정에 쓴다. 앞 대화가 열쇠에 들면 답마다 열쇠가 달라져 기억이 하나도 맞지 않는다
    const bare = context.substituteParams(fillSlot(template));
    const before = earlierFor({ context, message, template, hold: holdFor ?? hold });
    // 앞 대화를 넣은 뒤에 매크로를 푼다: 앞 답의 글에 든 이름 매크로도 화면에 보이는 이름으로 간다
    const method = before ? context.substituteParams(fillSlot(template, before)) : bare;
    const { people, always, names, rules } = picked ?? castOnly(context);
    // 내 규칙 글도 프롬프트처럼 앞 대화 자리를 채우고 매크로를 푼다(규칙에 적은 {{user}} · {{char}} 가 글자 그대로 가지 않게).
    // 기억의 열쇠에는 풀기 전의 규칙 글을 쓴다: 자리에 든 앞 대화가 열쇠에 들지 않게
    const houseRules = rules ? context.substituteParams(fillSlot(rules, earlierFor({ context, message, template: rules, hold: holdFor ?? hold }))) : '';
    // 기억의 열쇠에 드는 것: 모든 문단에 걸리는 설정(프롬프트, 연결과 모델, 내 규칙). 사람 · 용어는 문단마다 그 문단에 걸린 것만 열쇠에 더한다(job/engine.js keysOf):
    //   전에는 사람 · 용어 전부를 이 지문에 넣어서, 말투 한 줄을 고치면 모든 문단의 기억이 한꺼번에 안 맞았다.
    // oldMark: 그렇게 만들던 옛 지문. 바꾸기 전에 넣은 기억을 한 판 동안 이것으로도 찾는다.
    // 프리필은 켜 둔 때에만 열쇠에 글이 붙는다(꺼져 있으면 빈 글이라 열쇠가 그대로다)
    const model = connectionMark(settings) + prefillMark(context.extensionSettings);
    const mark = setupMark({ prompt: bare, model, rules: [rules] });
    const oldMark = setupMark({ prompt: bare, model, rules: [rules, JSON.stringify(people), JSON.stringify(names)] });
    return {
        original, hold, lang, method, promptTitle: prompt.title ?? '',
        keepKorean: settings.keepKorean && KOREAN_TARGET.test(bare),
        people, always, names, rules: houseRules,
        memory: { store: memory ?? spareMemory(), mark, oldMark, chat: context.getCurrentChatId?.() ?? '' },
    };
}

/**
 * 엔진으로 한 번 번역한다. 글이 오다 멈추면 정해 둔 횟수까지 남은 부분만 다시(받은 문단은 기억에 있다).
 * @param {object} plan prepare 의 값
 * @param {object} o
 * @param {(prompt: string, o: object) => Promise<string>} o.send  @param {AbortSignal} o.signal  @param {(info: object) => void} o.notify
 * @param {number} [o.stallRetries]
 * @param {string} [o.text] 번역할 글(없으면 원문 전체)  @param {string[]} [o.notes] 이번에만 붙일 조건 줄
 * @param {string[]} [o.always] 사람 줄에 더 넣을 사람 id  @param {boolean} [o.fresh] 기억을 쓰지 않고 새로
 * @param {object} [o.extras] 본문 요청에 같이 실어 보낼 글(상태창 글)
 * @param {boolean} [o.redo] 다시 번역  @param {string} [o.guidance] 이번에 지킬 말투나 부탁  @param {(src: string) => string} [o.previous] 문단 원문 → 같이 보낼 앞 번역문
 * @param {{ src: string, lead: string, who: string }[]} [o.fixed] 사용자가 바로잡은 대사 주인(그 원문 문단과 이름)
 * @param {Function} [o.engine] 엔진 입구(시험에서 바꿔 끼운다)
 * @returns {Promise<{ text: string, pairs: object | null, failed: number[], got: number, requests: number }>} requests = 실제로 나간 요청 수
 */
export async function translateOnce(plan, o) {
    const onProgress = stage => { if (stage?.stage === 'segments') o.notify({ type: 'pieces', done: stage.done, total: stage.total }); };
    const text = o.text ?? plan.original;
    // 괄호로 싼 알림 줄을 옮기라는 문장은 붙이지 않는다: 붙여도 짧은 괄호 머리줄은 그대로 영어로 돌아왔다(gemini-3.8-flash 로 견줌)
    const notes = o.notes ?? [];
    const args = {
        text, hold: plan.hold, keepKorean: plan.keepKorean, method: plan.method,
        people: plan.people, always: [...plan.always, ...(o.always ?? [])], names: plan.names, rules: plan.rules,
        notes, memory: plan.memory, send: o.send, signal: o.signal, onProgress, extras: o.extras ?? undefined,
        redo: o.redo, guidance: o.guidance, previous: o.previous, fixed: o.fixed,
    };
    let sent = 0;
    for (let tries = 0; ; tries++) {
        const report = {};
        try {
            // 멈춘 뒤 다시 보낼 때는 새로 받기를 끈다: 앞 시도에서 받은 문단을 기억에서 읽어 남은 부분만 보내게
            const text = await (o.engine ?? engine)({ ...args, report, fresh: Boolean(o.fresh) && tries === 0 });
            const got = (report.translatedParagraphs || 0) + (report.reusedParagraphs || 0);
            sent += report.requests ?? 0;
            return { text, pairs: report.pairs ?? null, failed: report.failed ?? [], got, requests: sent, names: report.names ?? [] };
        } catch (error) {
            const again = error?.stall === 'idle' && tries < (o.stallRetries ?? 0) && !o.signal?.aborted;
            if (!again) throw error;
            o.notify({ type: 'retry', count: tries + 1, of: o.stallRetries });
        }
    }
}

/** 못 받은 조각을 이어 받는 데 드는 요청 수 */
export function retryRequests(plan, failed) {
    const left = new Set(failed);
    return left.size ? requestsFor(plan, (_, i) => left.has(i)) : 0;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 같은 채팅을 다시 읽는 중이면 끝날 때까지 잠깐 기다리고, 대상이 그대로인지 본다. @returns 지금의 메시지 객체 */
export async function stillThere(guard) {
    for (let i = 0; i < 50 && !guard.settled(); i++) await pause(100);
    if (!guard.valid()) throw cancelled(guard.why());
    return guard.target();
}

/**
 * 대상이 그대로면 번역을 붙이고 저장한다. 번역하는 동안 그림 표시만 바뀌었으면 그 자리만 새 것으로.
 * redraw(번호, 메시지, { fromSource }): 붙인 답을 화면에 다시 그리는 쪽(app.js). 없으면 실리태번의 메시지 다시 그리기만 한다.
 *   fromSource = 붙이기 전 화면이 원문을 그리고 있었고 원문도 그대로다(원문 먼저 보기는 다시 그리지 않고 그대로 쓸 수 있다)
 */
async function place(context, guard, plan, out, hash, redraw) {
    const target = await stillThere(guard);
    const fromSource = viewOf(target) !== 'shown' && target.mes === guard.source();
    let text = out.text, source = plan.original, pairs = out.pairs;
    if (target.mes !== guard.source()) {
        source = context.substituteParams(target.mes, context.name1, target.name);
        text = swapPictures(text, plan.original, source);
        if (text === null) throw cancelled('text');
        pairs = null;   // 짝 기록은 번역할 때의 원문 자리로 적혀 있어 그림 글자 수가 바뀌면 맞지 않는다
    }
    attach(target, { text: replaceBanned(text), pairs, hash: String(hash(source)) });
    guard.acceptShown();
    if (redraw) redraw(guard.index(), target, { fromSource });
    else context.updateMessageBlock(guard.index(), target);
    await context.saveChat();
    // prompt: 이 번역에 쓴 프롬프트 이름(번역 끝 신호에 실어 다른 기능이 읽는다: api.js)
    return { failed: out.failed.length, retryRequests: retryRequests(plan, out.failed), requests: out.requests ?? 0, prompt: plan.promptTitle };
}

/** 오류로 끝났어도 받은 조각이 있으면 붙인다(멈추기 · 그만두기는 붙이지 않는다: 받은 문단은 기억에 남아 다시 누르면 나머지만 보낸다) */
async function keepPartial(context, guard, plan, error, hash, redraw) {
    const partial = error?.partial;
    if (error?.cancelled || error?.stopped || error?.name === 'AbortError' || !partial) return error;
    if (!partial.pieces.some(piece => piece.from)) return error;
    try {
        const out = { text: partial.text, pairs: record(plan.original, partial.pieces), failed: partial.failed };
        error.kept = await place(context, guard, plan, out, hash, redraw);
    } catch { /* 붙이지 못하면 오류만 알린다 */ }
    return error;
}

/**
 * 멈춤 신호를 잇고, 번역하는 동안 대상과 연결이 그대로인지 지켜보며 일을 한다. 끊겼으면 끊은 까닭(멈추기 · 그만두기)을 던진다.
 * @param {{ guard: object, signal: AbortSignal, connection: () => string, stay?: boolean }} o stay: 다른 채팅으로 가도 끊지 않는다
 * @param {(signal: AbortSignal) => Promise<any>} work
 */
export async function watched({ guard, signal, connection, stay = false }, work) {
    const controller = new AbortController();
    const forward = () => controller.abort(signal.reason);
    signal.addEventListener('abort', forward, { once: true });
    const stopWatch = watch(guard, controller, { connection, stay });
    try {
        return await work(controller.signal);
    } catch (error) {
        const reason = controller.signal.aborted && controller.signal.reason;
        throw reason ? Object.assign(reason, { partial: error?.partial }) : error;
    } finally {
        stopWatch();
        signal.removeEventListener('abort', forward);
    }
}

/**
 * 상태창 글을 실어 보낸 요청에 답이 오면 알린다(답에서 빠진 글을 못 받은 글로 적게: extras.onAnswer(요청 글, 답, 본문 조각 수)).
 * 실어 보낸 요청인지는 요청 글의 맨 뒤 조각들이 그 글들인지로 안다(이어 받기 · 고쳐 받기 요청에는 실리지 않는다).
 * 답이 왔을 때 그 채팅이 열려 있지 않으면 알리지 않는다: 못 받은 글을 적는 기록은 지금 열린 채팅의 것이다.
 */
function withExtras(send, extras, guard) {
    if (!extras?.onAnswer) return send;
    const count = extras.bodies.length;
    return async (prompt, o) => {
        const bodies = sentBodies(prompt), tail = bodies.slice(-count);
        const carried = tail.length === count && tail.every((body, i) => body === extras.bodies[i]);
        const raw = await send(prompt, o);
        if (carried && !guard.away?.()) extras.onAnswer(prompt, raw, bodies.length - count);
        return raw;
    };
}

/**
 * 번역 재료를 어느 채팅의 것으로 만들지 고른다. 그 채팅이 열려 있으면 지금 것, 다른 채팅에 가 있으면 붙잡아 둔 것(o.pinned).
 * 쓰는 곳 셋을 읽는 사이 채팅이 바뀌었을 수 있어 읽은 뒤에 다시 본다. 붙잡아 둔 것이 없으면 그만둔다.
 * @returns {Promise<{ away: boolean, context: object, picked: object | null, holdFor?: Function, spacersFor?: Function }>}
 */
async function materials(o) {
    const { guard, layers } = o;
    const base = readSettings(o.context.extensionSettings);
    const picked = !guard.away?.() && layers ? await gather(o.context, layers, base) : null;
    if (!guard.away?.()) return { away: false, context: o.context, picked, holdFor: o.holdFor, spacersFor: o.spacersFor };
    if (!o.pinned?.picked) throw cancelled('chat');
    const { context, picked: kept, holdFor, spacersFor } = o.pinned;
    return { away: true, context, picked: kept, holdFor, spacersFor };
}

/** 번역하는 동안 바뀌면 멈출 값의 지문: 연결 · 모델과 그 채팅의 사람 · 이름 · 규칙. 다른 채팅에 간 뒤로는 떠나기 전의 사람 · 이름 · 규칙으로 둔다(지금 열린 채팅의 것은 남의 것이다) */
function connectionOf(context, guard, layers) {
    let own = layers ? layers.mark() : '', left = Boolean(guard.away?.());
    return () => {
        left ||= Boolean(guard.away?.());
        if (layers && !left) own = layers.mark();
        return connectionMark(readSettings(context.extensionSettings)) + '|' + own;
    };
}

/**
 * @param {object} o
 * @param {object} o.context 실리태번 getContext()
 * @param {object} o.guard job/guard.js capture 의 것
 * @param {AbortSignal} o.signal 줄이 주는 멈춤 신호
 * @param {(info: object) => void} o.notify 진행: { type: 'pieces', done, total } · { type: 'retry', count, of }
 * @param {(text: string) => string | number} o.hash 원문 해시(실리태번 getStringHash)
 * @param {object} [o.layers] store/layers.js createLayers 의 것. 있으면 고른 프로필 · 프롬프트 · 사람 줄 · 이름 · 규칙을 쓴다
 * @param {object} [o.memory] 문단 번역 기억(store/memory.js createMemory 의 것)
 * @param {(id: number) => Promise<object | null>} [o.extrasFor] 그 메시지의 아직 번역 없는 상태창 글(screen/start.js extrasFor).
 *   본문 요청에 같이 실어 보낸다: 따로 물으면 답 하나에 요청이 두 번 나간다. 그 채팅이 열려 있지 않으면 싣지 않는다(화면에서 모으는 글이다)
 * @param {{ context: object, picked: object | null, holdFor: Function, spacersFor: Function }} [o.pinned] 번역을 누를 때 붙잡아 둔 그 채팅의 정보.
 *   다른 채팅에 가 있는 동안 시작하면 이것으로 재료를 만든다(context: job/away.js pinChat, picked: job/sources.js gatherNow 의 값)
 * @param {(message: object) => boolean} [o.writing] 그 메시지에 지금 답이 써지는 중인가(써지는 중이면 저장하지 않는다)
 * @param {(id: number, message: object, o: { fromSource: boolean }) => void} [o.redraw] 붙인 답을 화면에 다시 그린다(place). 없으면 실리태번의 메시지 다시 그리기만
 * @param {(names: { id: string, ko: string }[]) => void} [o.onNames] 이번 답에서 정해진 이름 표기(그 채팅이 열려 있을 때만 부른다)
 * @param {(guard: object, plan: object, out?: object) => void} [o.keep] 다 받았는데 그 채팅이 열려 있지 않을 때: 그 채팅을 열면 붙일 답으로 적어 둔다.
 *   out = 받은 번역(translateOnce 의 값: text · pairs). 붙이지 않은 채로 끝났을 때만 넘긴다
 * @returns {Promise<{ failed: number, retryRequests: number, requests: number, prompt: string, away?: true } | null>} null = 번역할 글이 없음.
 *   away = 받았지만 그 채팅이 열려 있지 않아 붙이지 않았다. swiped = 다른 스와이프가 보이는 중이라 번역하던 스와이프의 사본에 적었다
 */
export async function translateMessage(o) {
    const { guard, signal, notify, hash, memory, keep } = o;
    const { away, context, picked, holdFor, spacersFor } = await materials(o);
    const settings = picked?.settings ?? readSettings(context.extensionSettings);
    // 줄에서 기다리는 사이 스와이프로 넘겼으면 붙잡은 스와이프의 글로 재료를 만든다
    const mes = guard.otherSwipe?.() ? guard.source() : undefined;
    const plan = prepare({ context, settings, message: guard.target(), picked, memory, holdFor, mes });
    if (!plan) return null;
    const extras = away || mes !== undefined ? null : await o.extrasFor?.(guard.index()).catch(() => null) ?? null;
    // 받는 동안 다 받은 문단을 화면에 알린다(job/closed.js). 메시지 자리가 바뀌었으면 알리지 않는다
    const id = guard.index(), idNow = () => (guard.index() === id ? id : -1);
    // 보내기 한 줄에 감기는 차례(안쪽부터): 프리필을 싣고 답 머리의 되풀이를 뗀다 → 거절을 가린다(되풀이를 뗀 글로) →
    // 같이 실은 상태창 글의 답 알림 → 다 받은 문단 알림
    const guarded = refusalFilter(spacedSender(prefillSender(context, settings), spacersFor?.(guard.target()) ?? []));
    const send = tellClosed(withExtras(guarded, extras, guard), plan, idNow);
    // 번역하는 동안 연결 · 모델이나 이 채팅의 사람 · 이름 · 규칙이 바뀌면 멈춘다(바뀐 뒤의 결과와 섞이지 않게)
    const connection = connectionOf(context, guard, o.layers);
    // 이번에 정해진 이름 표기는 번역 일이 다 끝난 뒤에 넘긴다: 사람을 저장하면 '번역하는 동안 사람이 바뀌면 멈춘다'에 이 일 스스로 걸린다
    let names = [];
    const result = await watched({ guard, signal, connection, stay: true }, async inner => {
        try {
            const out = await translateOnce(plan, { send, signal: inner, notify, stallRetries: settings.stallRetries, extras });
            names = out.names ?? [];
            if (out.failed.length && !out.got) throw refusedError('번역을 하나도 받지 못했어요.');
            if (guard.away?.()) return setAside(keep, guard, plan, out);
            if (guard.otherSwipe?.()) return await placeOnSwipe(o, context, plan, out);
            const placed = await place(context, guard, plan, out, hash, o.redraw);
            if (extras?.sent) extras.finish?.();
            // 붙인 번역이 저장되기 전에 채팅이 바뀌었을 수 있다: 붙일 답으로도 적어 둔다(돌아왔을 때 이미 붙어 있으면 목록에서만 빠진다)
            if (guard.away?.()) keep?.(guard, plan);
            return placed;
        } catch (error) {
            // 끊긴 것이면 끊은 까닭으로 판단한다(멈추기 · 그만두기는 받은 조각을 붙이지 않는다)
            const why = inner.aborted && inner.reason ? Object.assign(inner.reason, { partial: error?.partial }) : error;
            throw await keepPartial(context, guard, plan, why, hash, o.redraw);
        } finally {
            if (id >= 0) tell({ type: 'end', id });
        }
    });
    if (names.length && !away && !guard.away?.()) o.onNames?.(names);
    return result;
}

/**
 * 다 받았는데 그 메시지의 다른 스와이프가 보이는 중이다(새 답을 받는 중일 수도 있다): 번역하던 스와이프의 사본에만 적는다.
 * 메시지의 글 · 화면은 건드리지 않는다. 답이 써지는 중이면 저장도 하지 않는다: 답이 끝날 때 실리태번이 저장하면서 같이 적힌다.
 */
async function placeOnSwipe(o, context, plan, out) {
    const { guard, hash } = o, target = guard.target(), swipe = guard.note().swipe ?? 0;
    const done = attachToSwipe(target, swipe, { text: replaceBanned(out.text), pairs: out.pairs, hash: String(hash(plan.original)) });
    if (!done) throw cancelled('swipe');
    if (!o.writing?.(target)) await context.saveChat();
    return { swiped: true, failed: out.failed.length, retryRequests: retryRequests(plan, out.failed), requests: out.requests ?? 0, prompt: plan.promptTitle };
}

/** 다 받았는데 그 채팅이 열려 있지 않다: 붙이지 않고 적어 둔다(문단은 엔진이 번역 기억에 넣었다) */
function setAside(keep, guard, plan, out) {
    keep?.(guard, plan, out);
    return { away: true, failed: out.failed.length, retryRequests: 0, requests: out.requests ?? 0, prompt: plan.promptTitle };
}
