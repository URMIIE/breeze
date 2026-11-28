// 번역기 밖의 기능이 번역기에서 받아 쓰는 것을 내준다. 받는 쪽을 고치지 않아도 되게 이름과 꼴은 옛 번역기와 같다.
// 일을 새로 하지 않는다: 일 줄(job/queue.js)이 알리는 끝을 신호로 옮기고, 설정은 번역이 쓰는 함수로 읽는다.
//
// 내주는 것
//   1. 번역 끝 신호  eventSource 'EXTENSION_LLM_TRANSLATE_DONE'
//        { by: 'llmt', messageId, chatId, type: 'translation' | 'retranslation', translator: { model, api?, profile? } | null,
//          cached?: true, stopped?: true, outcome?: 'error', batch?: true }
//        cached   요청을 하나도 보내지 않고 번역 기억에서 붙였다(새로 끝난 일이 아니다)
//        stopped  사용자가 멈췄다(번역은 붙지 않았다)
//        outcome  'error' = 못 받은 문단이 있는 채로 받은 데까지만 붙였다
//        batch    채팅 전부 번역의 한 답이다
//        translator 는 요청을 보내 새로 받았을 때만 싣는다(받는 쪽이 '이 답을 번역한 모델'로 적어 두므로, 기억에서 붙인 번역에는 지금 모델을 싣지 않는다)
//      신호를 내지 않는 끝: 번역할 글이 없음, 채팅이나 대상이 바뀌어 그만둠, 아무것도 붙이지 못한 오류.
//   2. 상태창 번역까지 끝났는지 기다리는 통로  globalThis[Symbol.for('llmt.screen-work')].wait(메시지 번호)
//        본문 번역 뒤에 이어지는 일(상태창의 글 번역)을 screenWork(번호, 약속)으로 적어 두면 wait 가 그것이 끝날 때까지 기다린다.
//        받는 쪽은 번역 끝 신호를 받자마자 wait 를 부른다. 그래서 신호는 일 줄의 끝 알림을 다른 부분들이 다 받은 뒤에 낸다:
//        이어지는 일을 일 줄의 끝 알림 안에서 바로 적으면(나중에 적으면 안 된다) 듣는 차례와 상관없이 wait 가 그것을 기다린다.
//
// 내주지 않는 것: 옛 번역기의 기능 묶음(Symbol.for('llmt.api'))은 옛 번역기의 부분들만 썼고 밖에서 부르는 곳이 없어 만들지 않았다.

import { readSettings } from './store/settings.js';
import { gatherNow } from './job/sources.js';
import { modelOf } from './send/profile.js';

export const DONE = 'EXTENSION_LLM_TRANSLATE_DONE';
export const SCREEN_WORK = Symbol.for('llmt.screen-work');

// ── 상태창 번역 기다리기 ──

const screenJobs = new Map();   // 메시지 번호 → 그 답에 이어지는 일의 약속

/** 본문 번역 뒤에 이어지는 일을 적어 둔다. 끝나면(실패해도) 스스로 지워진다. @returns 넘겨받은 약속 */
export function screenWork(id, promise) {
    const key = Number(id);
    const mine = Promise.resolve(promise).catch(() => { /* 실패도 끝난 것이다 */ }).finally(() => { if (screenJobs.get(key) === mine) screenJobs.delete(key); });
    screenJobs.set(key, mine);
    return promise;
}

/** 그 답에 이어지는 일이 다 끝날 때까지(기다리는 사이 새로 적힌 것도) */
async function waitScreen(id) {
    for (let job; (job = screenJobs.get(Number(id)));) await job;
}

// ── 번역 끝 신호 ──

/** 번역에 쓴 연결: 번역이 요청 때 쓰는 것과 같은 함수로 읽는다. 모델을 모르면 null */
function translatorInfo(context, layers) {
    const base = readSettings(context.extensionSettings);
    let settings = base;
    try { if (layers) settings = gatherNow(context, layers, base).settings; } catch { /* 쓰는 곳을 못 읽으면 기본 설정의 연결 */ }
    const model = modelOf(context, settings);
    if (!model) return null;
    const profile = context.extensionSettings?.connectionManager?.profiles?.find(p => p.id === settings.profileId);
    return { model, ...(profile?.api ? { api: String(profile.api) } : {}), ...(profile?.name ? { profile: String(profile.name) } : {}) };
}

/**
 * 일 줄의 끝 알림 → 신호에 실을 것. 신호를 내지 않을 끝이면 null
 * @param {object} context 실리태번 getContext()
 * @param {object} job 줄에 섰던 일({ guard, redo? })
 * @param {{ result?: object | null, error?: any }} outcome
 * @param {{ layers?: object, inBatch?: () => boolean }} [o]
 */
export function detailOf(context, job, { result, error } = {}, { layers, inBatch } = {}) {
    const stopped = Boolean(error?.stopped || error?.name === 'AbortError');
    if (error?.cancelled || (error && !stopped && !error.kept)) return null;
    if (!error && !result) return null;
    const messageId = context.chat?.indexOf(job?.guard?.target?.()) ?? -1;
    if (messageId < 0) return null;
    const done = error?.kept ?? result;
    const cached = !stopped && done?.requests === 0;
    const detail = {
        by: 'llmt', messageId, chatId: context.getCurrentChatId?.() ?? context.chatId ?? '',
        type: job.redo ? 'retranslation' : 'translation',
        translator: stopped || cached ? null : translatorInfo(context, layers),
    };
    if (stopped) detail.stopped = true;
    if (cached) detail.cached = true;
    if (!stopped && (error?.kept || done?.failed)) detail.outcome = 'error';
    if (inBatch?.()) detail.batch = true;
    return detail;
}

let stop = null;

/**
 * 켠다(한 번만). 시작하는 곳(app.js)이 자기가 만든 것을 넘긴다.
 * @param {object} o
 * @param {{ listen: (fn: Function) => (() => void) }} o.queue 번역 일 줄(job/queue.js)
 * @param {() => object} o.context 실리태번 getContext
 * @param {object} [o.layers] 쓰는 곳 셋(store/layers.js). 있으면 채팅 · 캐릭터마다 고른 연결을 신호에 싣는다
 * @param {() => boolean} [o.inBatch] 채팅 전부 번역이 도는 중인가
 * @returns {() => void} 끄는 함수(시험용)
 */
export function start({ queue, context, layers, inBatch }) {
    if (stop) return stop;
    globalThis[SCREEN_WORK] = Object.freeze({ wait: waitScreen });
    const unlisten = queue.listen(({ type, job, result, error }) => {
        if (type !== 'end') return;
        try {
            const c = context();
            const detail = detailOf(c, job, { result, error }, { layers, inBatch });
            // 한 박자 늦게 낸다: 같은 끝 알림을 듣는 다른 부분이 이어지는 일을 먼저 적게(맨 위 2번)
            if (detail) Promise.resolve().then(() => c.eventSource.emit(DONE, detail)).catch(e => console.warn('[번역] 번역 끝 신호를 받은 쪽의 오류', e));
        } catch (e) { console.warn('[번역] 번역 끝 신호를 내지 못했어요', e); }
    });
    stop = () => { unlisten(); delete globalThis[SCREEN_WORK]; stop = null; };
    return stop;
}
