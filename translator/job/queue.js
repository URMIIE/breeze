// 번역 일을 한 줄로 세운다. 한 번에 하나만 돌고(요청이 겹쳐 나가지 않게), 진행을 알리고, 멈춘다.
// 메시지 번역은 전부 이 줄을 지난다: 그래서 진행 한 줄 · 멈추기가 어디서 시작한 번역이든 똑같이 된다.
// 실리태번을 모른다. 일은 { holds, run } 으로 받는다.

/**
 * @typedef {object} Job
 * @property {(item: any) => boolean} holds 이 일이 그 대상의 것인가(같은 대상에 일이 두 번 서지 않게, 멈출 일을 찾게)
 * @property {(signal: AbortSignal, notify: (info: object) => void) => Promise<any>} run
 */

export function createQueue() {
    const waiting = [], listeners = new Set();
    let running = null;   // { job, resolve, done, controller }

    const tell = (type, job, info = {}) => {
        for (const fn of listeners) {
            try { fn({ type, job, ...info }); } catch (error) { console.warn('[번역] 진행 알림 오류', error); }
        }
    };

    async function next() {
        if (running || !waiting.length) return;
        const entry = waiting.shift(), { job, resolve } = entry;
        const controller = new AbortController();
        running = { ...entry, controller };
        tell('start', job);
        let outcome;
        try {
            outcome = { result: await job.run(controller.signal, info => tell('progress', job, { info })) };
        } catch (error) {
            outcome = { error };
        }
        running = null;
        tell('end', job, outcome);
        resolve(outcome);
        next();
    }

    return {
        /** 줄에 세운다. 같은 대상의 일이 이미 있으면 그 일의 결과를 기다린다. @returns {Promise<{ result?: any, error?: any }>} */
        add(job, item) {
            const same = [running, ...waiting].find(entry => entry && entry.job.holds(item));
            if (same) return same.done;
            let resolve;
            const done = new Promise(r => { resolve = r; });
            waiting.push({ job, resolve, done });
            tell('wait', job);
            next();
            return done;
        },
        /** 그 대상의 일을 멈춘다: 돌고 있으면 끊고, 기다리는 중이면 줄에서 뺀다. @returns {boolean} 멈춘 일이 있었나 */
        stop(item, reason = Object.assign(new Error('번역을 멈췄어요.'), { name: 'AbortError', stopped: true })) {
            if (running?.job.holds(item)) { running.controller.abort(reason); return true; }
            const at = waiting.findIndex(entry => entry.job.holds(item));
            if (at < 0) return false;
            const [entry] = waiting.splice(at, 1);
            tell('end', entry.job, { error: reason });
            entry.resolve({ error: reason });
            return true;
        },
        /** 그 대상의 일(돌거나 기다리는 것) */
        find: item => (running?.job.holds(item) ? running.job : waiting.find(entry => entry.job.holds(item))?.job ?? null),
        running: () => running?.job ?? null,
        size: () => waiting.length + (running ? 1 : 0),
        /** @returns {() => void} 듣기를 그만두는 함수 */
        listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
}
