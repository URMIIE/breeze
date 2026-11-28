// 채팅 전부 번역: 번역 안 된 AI 답을 차례로(처음부터 / 최근부터) 하나씩 번역한다.
//
// 한 답씩 줄(job/queue.js)에 세운다: 그래서 진행 한 줄 · 멈추기가 번역 버튼으로 시작한 번역과 똑같고, 요청이 겹쳐 나가지 않는다.
// 번역 기억에 문단이 다 있는 답은 같은 번역 길을 지나며 요청 없이 붙는다(기억은 엔진이 읽는다: job/engine.js).
// 시작 전에 새로 받을 답 수와 요청 수, 기억에서 붙일 답 수를 어림해 보여 준다.
// 실패한 답(거절 · 오류 · 일부만 받음)은 건너뛰고 끝에 몇 개를 못 했는지 알린다: 전엔 거절된 답 하나에서 멈추고, 다시 눌러도 같은 자리에서 또 멈췄다.
// 멈추기는 기본으로 지금 답이 끝난 뒤에 멈춘다(지금 답의 요청은 이미 값을 치렀으니 받은 번역을 버리지 않게). now 를 주면 지금 답도 끊는다.
// 다른 채팅으로 가도 남은 답을 계속 번역한다. 멈추는 것은 멈추기뿐이다. 시작할 때 그 채팅의 정보를 붙잡아 두고(deps.pin),
//   그 채팅이 열려 있지 않은 동안의 답은 붙잡아 둔 것으로 번역한다(deps.translateAway): 받은 번역은 번역 기억에 남고 그 채팅을 열면 요청 없이 붙는다(job/away.js).
//   그 채팅으로 돌아와 있으면 다시 읽힌 채팅에서 그 답을 찾아(deps.locate) 평소처럼 번역해 붙인다.
// 멈춘 뒤 다시 시작하면 남은 답만, 세던 수를 이어서 센다.
//
// 실리태번을 직접 부르지 않는다. deps 꼴:
//   chat() → object[]                         지금 채팅의 메시지 배열
//   chatKey() → string                        지금 채팅의 열쇠(이어서 할 때 같은 채팅인지, 시작한 채팅이 지금 열려 있는지)
//   translate(message) → Promise<{ result?, error? }>          그 답을 줄에 세운 번역(번역 버튼이 부르는 것과 같은 함수, queue.add 의 결과 꼴)
//   stop(message) → boolean                   줄에서 그 답의 번역을 멈추기(queue.stop)
//   pin?(messages) → object                   시작할 때 이 채팅의 정보를 붙잡아 둔 것(translateAway 에 그대로 넘긴다)
//   translateAway?(message, pin) → Promise<{ result?, error? }>   그 채팅이 열려 있지 않은 동안의 번역. result.away 면 받아서 적어 둔 것
//   locate?(message, index) → object | null   시작할 때의 답을 지금 열린 채팅에서 찾는다(다시 읽혀 새 객체가 됐을 수 있다). 없으면 null
//   prepare(message) → plan | null            번역 재료(요청 수 어림용, job/run.js 의 prepare 꼴)
//   using?() → { prompt, model }              시작 전 화면에 보일 프롬프트와 모델 이름
//   known?(plan) → Promise<Set<string>>       이 답의 문단 가운데 번역 기억에 있는 것(문단 원문). 어림에만 쓴다
//   onEvent?(event)                           { type: 'start' | 'message' | 'progress' | 'end', ... } 아래 tell 참고

import { viewOf } from '../store/message.js';
import { requestsFor } from './estimate.js';

/** 번역할 답인가: AI 답이고, 글이 있고, 아직 번역이 없고, 지금 써지는 중('...')이 아님 */
export function needsTranslation(message) {
    if (!message || message.is_user || message.is_system) return false;
    const mes = String(message.mes ?? '').trim();
    return Boolean(mes) && mes !== '...' && mes !== '…' && viewOf(message) === 'none';
}

/** 한 답의 끝을 나눈다: 'done' 번역됨(받아서 적어 둔 것도) · 'failed' 못 함 · 'skipped' 대상이 바뀜 · 'stopped' 멈춤 */
function outcomeOf({ result, error } = {}) {
    if (error?.stopped || error?.name === 'AbortError') return 'stopped';
    if (error?.cancelled) return 'skipped';
    if (error || result?.failed) return 'failed';
    return 'done';
}

export function createBatch(deps) {
    const tell = event => { try { deps.onEvent?.(event); } catch (error) { console.warn('[번역] 채팅 번역 알림 오류', error); } };
    let run = null;      // 도는 중: { key, list, done, total, failed, ... }
    let paused = null;   // 멈추거나 끊긴 것: { key, from, done, failed, reused }

    const pending = from => {
        const list = (deps.chat() || []).filter(needsTranslation);
        return from === 'last' ? list.reverse() : list;
    };

    /** 이어서 할 것이 있으면 그때 고른 차례, 없으면 처음 답부터 */
    const fromNow = () => (paused?.key === deps.chatKey() ? paused.from : 'first');

    /** 시작 전 어림(ui/panel/batch.js 의 data 꼴). 기억에 문단이 다 있는 답은 요청 없이 붙는 답으로 센다 */
    async function estimate() {
        const list = pending('first');
        let reuse = 0, freshRequests = 0;
        for (const message of list) {
            const plan = deps.prepare(message);
            if (!plan) continue;
            const have = await deps.known?.(plan) ?? new Set();
            const requests = requestsFor(plan, piece => !have.has(piece.src));
            if (!requests && have.size) reuse++;
            freshRequests += requests;
        }
        const using = deps.using?.() ?? {};
        return { left: list.length, fresh: list.length - reuse, freshRequests, reuse, prompt: using.prompt ?? '', model: using.model ?? '', from: fromNow() };
    }

    /** 시작(이어서 포함). @returns {Promise<object | null>} 끝난 뒤의 셈, 이미 돌고 있거나 할 것이 없으면 null */
    async function start({ from = 'first' } = {}) {
        if (run) return null;
        const key = deps.chatKey();
        const carry = paused?.key === key ? paused : null;
        const list = pending(carry?.from ?? from);
        if (!list.length) { paused = null; return null; }
        const done = carry?.done ?? 0, chat = deps.chat() || [];
        run = { key, from: carry?.from ?? from, list, done, total: done + list.length, failed: carry?.failed ?? 0, reused: carry?.reused ?? 0, skipped: 0, halt: false, current: null };
        // 다른 채팅에 가 있는 동안에도 이어 가려고 이 채팅의 정보와 답마다의 자리를 붙잡아 둔다
        Object.assign(run, { pin: deps.pin?.(list) ?? null, index: new Map(list.map(m => [m, chat.indexOf(m)])), kept: new Set() });
        paused = null;
        tell({ type: 'start', done: run.done, total: run.total, from: run.from, resumed: Boolean(carry) });
        try { return await loop(run); } finally { run = null; }
    }

    const home = job => deps.chatKey() === job.key;
    /** 그 답의 지금 객체: 시작한 채팅이 열려 있으면 그 채팅에서 찾은 것(없으면 null), 아니면 시작할 때의 것 */
    const liveOf = (job, message) => (home(job) && deps.locate ? deps.locate(message, job.index.get(message)) : message);

    async function loop(job) {
        let end = 'finished';
        for (const message of job.list) {
            if (job.halt) { end = 'stopped'; break; }
            if (await one(job, message) === 'stopped') { end = 'stopped'; break; }
        }
        // 남은 수: 받아서 적어 둔 답(그 채팅을 열면 붙는다)은 빼고 센다
        const left = end !== 'finished' ? job.list.filter(m => !job.kept.has(m) && needsTranslation(liveOf(job, m))).length : 0;
        if (left) paused = { key: job.key, from: job.from, done: job.done, failed: job.failed, reused: job.reused };
        // away: 끝났을 때 그 채팅이 열려 있지 않다. kept: 받아서 적어 둔 답 수
        const summary = { done: job.done, total: job.total, failed: job.failed, reused: job.reused, skipped: job.skipped, left, end, away: !home(job), kept: job.kept.size };
        tell({ type: 'end', ...summary });
        return summary;
    }

    /** 답 하나. 그 채팅이 열려 있으면 평소처럼, 아니면 붙잡아 둔 정보로 */
    async function one(job, message) {
        const here = home(job), target = liveOf(job, message);
        if (!needsTranslation(target)) return count(job, 'skipped');   // 그새 번역이 붙었거나 지워진 답
        tell({ type: 'message', at: job.done + 1, total: job.total, message: target });
        job.current = target;
        const end = await (here || !deps.translateAway ? deps.translate(target) : deps.translateAway(message, job.pin));
        job.current = null;
        const step = outcomeOf(end);
        if (end?.result?.away) job.kept.add(message);
        if (step === 'done' && end?.result?.requests === 0) job.reused++;
        return step === 'stopped' ? step : count(job, step);
    }

    function count(job, step) {
        job.done++;
        if (step === 'failed') job.failed++;
        if (step === 'skipped') job.skipped++;
        tell({ type: 'progress', done: job.done, total: job.total, failed: job.failed });
        return step;
    }

    return {
        estimate,
        start,
        /** 멈추기. now = 지금 답의 번역도 끊는다(받은 문단은 번역 기억에 남아 이어서 할 때 나머지만 보낸다) */
        stop({ now = false } = {}) {
            if (!run) return false;
            run.halt = true;
            if (now && run.current) deps.stop(run.current);
            return true;
        },
        /** 도는 중이면 { done, total, at }, 아니면 null */
        running: () => (run ? { done: run.done, total: run.total, at: Math.min(run.total, run.done + 1) } : null),
        /** 이 채팅에 이어서 할 것이 있나 */
        resumable: () => paused?.key === deps.chatKey() && pending(paused.from).length > 0,
        /** 이어서 할 것을 버린다(채팅을 새로 셀 때) */
        forget() { paused = null; },
    };
}
