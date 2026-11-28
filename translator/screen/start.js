// 새 번역기에서 상태창 번역(정규식 카드와 상태창의 글 번역, 한글 글꼴)을 켠다. 시작하는 곳(app.js)이 한 번 부른다.
// 엔진은 옆의 screen/live.js 그대로다. 여기는 그 엔진에 새 구조의 손을 넘겨준다:
//   보내기 send/profile.js(최대 출력 토큰은 실어 보내는 줄의 길이로 정해진다), 저장 store/status.js(새 파일), 사람 · 이름 store/layers.js.
// 흐름: 메시지 번역을 시작할 때 그 메시지의 아직 번역 없는 상태창 글을 모아 본문 요청에 같이 실어 보낸다(extrasFor: 답 하나에 요청 한 번).
//       답이 흘러오는 대로 본문 문단 뒤에 상태창 글이 차례로 입혀진다. 같이 보낸 답 뒤에는 따로 묻지 않는다.
//       같이 보내지 못한 메시지(본문이 전부 번역 기억에서 붙은 답 등)만 번역이 끝난 뒤 화면이 다 그려지기를 기다려 번역이 없는 줄을 한 번에 묻는다.
//       그 밖에 메시지가 다시 그려질 때는 저장된 번역만 입힌다(요청 없음). 번역이 보이는 메시지에만 입힌다:
//       원문으로 바꿔 보는 중이거나 번역을 지운 메시지는 다시 그려진 그대로 둔다.

import * as live from './live.js';
import { toOld, takeBack, noteSources, oldSources, markUnanswered, shared, putRedone } from './bridge.js';
import { redoLines } from './redo.js';
import { createFonts } from './font.js';
import { viewOf } from '../store/message.js';
import { open as openStatus, saver, statusFile, oldStatusFile, placer } from '../store/status.js';
import { readSettings } from '../store/settings.js';
import { gatherNow, castOf } from '../job/sources.js';
import { characterKey } from '../rules/hold.js';
import { profileSender } from '../send/profile.js';
import { prefillSender } from '../send/prefill.js';
import { screenWork } from '../api.js';

const BUSY = 'btr-screen-busy';
const textOf = id => document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
const generating = () => document.body?.dataset?.generating === 'true';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 숨긴 자료 칸 안인가: 숨긴 요소 가운데 다른 요소 없이 글만 든 것은 화면 스크립트가 읽는 자료라 바꾸면 안 된다(숨겨 둔 팝업 · 탭 화면은 요소가 들어 있어 번역한다) */
export function inHiddenData(el) {
    for (let e = el; e && e.nodeType === 1 && e.tagName !== 'BODY'; e = e.parentElement) {
        const hidden = e.hasAttribute('hidden') || /display\s*:\s*none/i.test(e.getAttribute('style') || '');
        if (hidden) return !e.firstElementChild;
    }
    return false;
}

/** 정규식 글('/식/깃발' 또는 식만) → 견줄 식 */
function regexOf(find) {
    const hit = find.trim().match(/^\/([\s\S]+)\/([a-z]*)$/i);
    return new RegExp(hit ? hit[1] : find, hit ? hit[2].replace(/[gy]/g, '') : '');
}

/**
 * 이 메시지의 iframe 이 다 그려질 때까지 기다린다: 불러오기가 끝나고, 스크립트가 글을 채운 뒤 잠깐 그대로일 때.
 * 아직 iframe 으로 바뀌지 않은 코드 칸(html 문서)이 화면에 보이면 계속 기다린다(바뀐 뒤 숨겨 둔 코드 칸은 세지 않는다). iframe 을 그리지 않는 메시지는 1.5초 뒤 끝낸다.
 */
async function waitForFrames(id, timeout = 8000) {
    const start = Date.now();
    let last = null, since = 0;
    while (Date.now() - start < timeout) {
        const text = textOf(id), frames = text ? [...text.querySelectorAll('iframe')] : [];
        const pendingCode = !!text && [...text.querySelectorAll('pre')].some(p => p.getClientRects().length > 0 && /html>|<head>|<body/.test(p.textContent || ''));
        const loaded = frame => { try { return frame.contentDocument?.readyState === 'complete' && !!frame.contentDocument.body; } catch { return true; } };
        if (frames.length && !pendingCode && frames.every(loaded)) {
            const sig = frames.map(f => { try { return (f.contentDocument.body.innerText || '').length; } catch { return 0; } }).join(',');
            if (sig !== last) { last = sig; since = Date.now(); } else if (Date.now() - since >= 400) return true;
        } else if (!frames.length && !pendingCode && Date.now() - start > 1500) return false;
        await pause(200);
    }
    return false;
}

/** 줄 열쇠('글자만#조각 수') → 엔진의 기록이 받는 줄 꼴 */
const lineOfKey = key => ({ key: key.replace(/#\d+$/, ''), nodes: { length: Number(/#(\d+)$/.exec(key)?.[1] || 1) } });

/**
 * 저장 기록에는 있는데 엔진과 주고받은 자료에는 없는 줄을, 엔진이 들고 있는 기록과 그 자료에 넣는다.
 * 주고받은 자료에도 넣어야 엔진이 다음에 저장하라고 줄 때 이 줄이 '새로 배운 줄'로 돌아와 원문 없이 다시 적히지 않는다(bridge.js takeBack).
 * @param {object} liveRec screen/records.js 꼴  @param {object} given 주고받은 자료(toOld 의 꼴)  @param {object} now 지금 저장 기록(toOld 의 꼴)
 * @returns {number} 넣은 줄 수
 */
function giveNew(liveRec, given, now) {
    let count = 0;
    for (const [key, t] of Object.entries(now.lines)) {
        if (Object.hasOwn(given.lines, key)) continue;
        liveRec.learn(lineOfKey(key), t);
        given.lines[key] = t; count++;
    }
    for (const [text, t] of Object.entries(now.strings)) {
        if (Object.hasOwn(given.strings, text)) continue;
        liveRec.learnString(text, t);
        given.strings[text] = t; count++;
    }
    return count;
}

/** user/files 의 파일을 읽고 쓰는 손(저장하는 손을 넘겨받지 못했을 때만 쓴다) */
function fileStatus(context) {
    const load = async name => { const res = await fetch(`/user/files/${encodeURIComponent(name)}`, { cache: 'no-store' }); return res.ok ? res.json() : null; };
    const save = async (name, data) => {
        const bytes = new TextEncoder().encode(JSON.stringify(data));
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const res = await fetch('/api/files/upload', { method: 'POST', headers: context().getRequestHeaders(), body: JSON.stringify({ name, data: btoa(text) }) });
        if (!res.ok) throw new Error(`파일을 저장하지 못했어요 (${res.status})`);
    };
    // 새 파일이 아직 없으면 옛 번역기의 기록 파일을 읽어 처음 값으로 삼는다(그 파일에는 쓰지 않는다)
    return async key => {
        const name = statusFile(key);
        const rec = openStatus(await load(name).catch(() => null) ?? await load(oldStatusFile(key)).catch(() => null));
        const keep = saver(rec, data => save(name, data));
        return { rec, save: keep.soon, flush: keep.flush };
    };
}

/**
 * live.js 에 넘길 손(host)을 만든다. 화면에 닿는 것은 넘겨받는다(브라우저 없이 시험하려고).
 * @param {object} o
 * @param {() => object} o.context 실리태번 getContext
 * @param {object} [o.layers] store/layers.js createLayers 의 것(없으면 캐릭터 · 페르소나만 사람으로 넣는다)
 * @param {(key: string) => Promise<{ rec: object, save: () => void }>} o.status 그 캐릭터의 상태창 번역 저장을 여는 손(store/hands.js 의 status 꼴)
 * @param {(id: number) => Element | null} o.textOf 메시지의 본문 칸  @param {() => boolean} o.busy 답이 써지는 중인가
 * @param {(id: number) => () => void} o.progress 요청이 나가 있는 동안의 표시(끝내는 함수를 돌려준다)
 * @param {(id: number) => { name: string, text: string }[]} [o.regexesOf] 그 메시지에 걸린 정규식(원문이 있던 곳을 적으려고)
 * @param {(context: object, settings: object) => Function} [o.sender] 보내기 함수를 만드는 것(시험에서 바꿔 끼운다)
 * @param {(host: object) => object} [o.recordsOf] 엔진이 들고 있는 기록(live.js recordsFor)
 */
export function createHost({ context, layers, status, textOf: text, busy, progress, regexesOf = () => [], sender = profileSender, recordsOf = live.recordsFor }) {
    const opened = new Map();   // 파일 이름 → { rec, save, given(live.js 와 주고받은 옛 꼴), sources(줄 id → 원문), place }
    const key = () => characterKey(context()) || 'none';
    const openRecord = shared(status);   // 설정 판(ui/panel/open.js)과 같은 기록을 쓴다

    /** 지금 쓰는 곳 셋의 연결 · 사람 · 이름 */
    function picked() {
        const c = context(), base = readSettings(c.extensionSettings);
        if (layers) return gatherNow(c, layers, base);
        return { settings: base, people: castOf(c).map(p => ({ id: p.name, names: [p.name] })), names: [] };
    }

    const host = {
        textOf: text, busy,
        skip: el => el.isContentEditable || el.hasAttribute?.('hidden') || el.classList?.contains(BUSY) || inHiddenData(el),
        recordName: () => statusFile(key()),
        /** 새 저장을 열어 live.js 가 읽는 꼴로 내준다 */
        async load(name) {
            const { rec, save } = await openRecord(key());
            const wasDirty = rec.dirty, given = toOld(rec.data());
            if (wasDirty) rec.keepDirty();   // data() 는 '저장했다'로 적는다: 읽으려고 부른 것이라 되돌린다
            opened.set(name, { rec, save, given, sources: new Map(), place: () => undefined });
            return structuredClone(given);
        },
        /** live.js 가 저장하라고 준 것에서 새로 생긴 줄만 새 저장에 적는다 */
        async save(name, data) {
            const entry = opened.get(name);
            if (!entry) return;
            const count = takeBack(entry.rec, data, entry.given, entry);
            entry.given = data;
            entry.sources.clear();
            if (count) entry.save();
        },
        // 옛 번역기의 채팅별 기록은 여기서 받아 오지 않는다: 저장을 여는 손(store/hands.js)이 저장 기록에 보태고, 그것이 load 와 sync 로 넘어온다
        oldRecords: () => ({}),
        /** 엔진이 지금 캐릭터의 기록을 읽어 갔는가 */
        loaded: () => opened.has(statusFile(key())),
        /**
         * 엔진은 기록을 캐릭터마다 한 번만 읽는다. 그 뒤 저장 기록에 생긴 줄(같은 캐릭터의 다른 채팅을 열어 보태진 옛 번역)을 엔진의 기록에도 넣는다.
         * 엔진이 기록을 다 읽은 뒤에 부른다. 저장하지 않는다. @returns {number} 넣은 줄 수
         */
        sync() {
            const entry = opened.get(statusFile(key()));
            if (!entry) return 0;
            const wasDirty = entry.rec.dirty, now = toOld(entry.rec.data());
            if (wasDirty) entry.rec.keepDirty();   // data() 는 '저장했다'로 적는다: 읽으려고 부른 것이라 되돌린다
            return giveNew(recordsOf(host), entry.given, now);
        },
        engine() {
            const c = context(), { settings, people, names } = picked(), send = sender(c, settings), entry = opened.get(statusFile(key()));
            return {
                // 답이 온 요청에서 빠진 글은 못 받은 글로 적어, 번역할 때마다 같은 글을 다시 묻지 않게 한다
                async send(prompt, o) {
                    if (entry) noteSources(prompt, entry.sources);
                    const raw = await send(prompt, o);
                    markUnanswered(recordsOf(host), prompt, raw);
                    return raw;
                },
                sources: () => oldSources({ people, names, cast: castOf(c) }),
            };
        },
        /** 고른 줄을 다시 번역받을 때 쓸 것: 저장, 보내는 함수(빠진 글을 못 받은 글로 적지 않는 맨 것), 사람 · 용어, live.js 와 주고받은 자료 */
        async again() {
            const c = context(), { settings, people, names } = picked(), { rec, save } = await openRecord(key());
            return { rec, save, send: sender(c, settings), sources: oldSources({ people, names, cast: castOf(c) }), given: opened.get(statusFile(key()))?.given };
        },
        progress(id) {
            const c = context(), message = c.chat?.[id], entry = opened.get(statusFile(key()));
            if (entry && message) entry.place = placer({ chat: c.getCurrentChatId?.(), mes: id, message: message.mes, regexes: regexesOf(id), character: message.name });
            return progress(id);
        },
    };
    return host;
}

/** 요청이 나가 있는 동안 그 메시지 본문 위에 두는 한 줄 */
function showBusy(id) {
    const el = Object.assign(document.createElement('div'), { className: BUSY, textContent: '상태창을 번역하고 있어요' });
    el.style.cssText = 'opacity:.65;font-size:.85em;margin-bottom:.4em';
    const paint = () => { const host = textOf(id); if (host && !el.isConnected) host.prepend(el); };   // 메시지가 다시 그려지면 다시 붙인다
    paint();
    const timer = setInterval(paint, 1000);
    return () => { clearInterval(timer); el.remove(); };
}

/**
 * @param {object} o
 * @param {() => object} o.context 실리태번 getContext
 * @param {{ listen: Function }} o.queue 번역 일 줄(job/queue.js): 끝 신호를 듣는다
 * @param {object} [o.layers] store/layers.js createLayers 의 것
 * @param {Function} [o.status] store/hands.js 의 status(없으면 여기서 파일을 직접 읽고 쓴다)
 */
export function startScreen({ context, queue, layers, status }) {
    const fonts = createFonts(context), scripts = new Map(), matched = new Map();
    let engine = null;

    /** 화면에 그려지는 정규식 가운데 이 메시지 글에 맞은 것 [{ name, text }](메시지 글이 그대로면 다시 견주지 않는다) */
    async function regexesOf(id) {
        const message = context().chat?.[id];
        if (!message) return [];
        const sources = [message.mes, message.extra?.display_text].filter(s => typeof s === 'string' && s), sig = sources.join('\u0000');
        if (matched.get(id)?.sig === sig) return matched.get(id).list;
        engine ??= await import('/scripts/extensions/regex/engine.js').catch(() => null);
        let all = [];
        try { all = engine?.getRegexScripts({ allowedOnly: true }) ?? []; } catch { /* 정규식 확장을 못 읽으면 틀 없이 */ }
        const place = message.is_user ? 1 : 2, list = [];
        for (const sc of all) {
            const drawn = sc && !sc.disabled && (!sc.promptOnly || sc.markdownOnly) && sc.placement?.includes(place);
            if (!drawn || !String(sc.findRegex ?? '').trim() || !/[^\P{L}\p{Script=Hangul}]/u.test(sc.replaceString || '')) continue;
            if (!scripts.has(sc.findRegex)) { try { scripts.set(sc.findRegex, regexOf(sc.findRegex)); } catch { scripts.set(sc.findRegex, null); } }
            if (sources.some(s => scripts.get(sc.findRegex)?.test(s))) list.push({ name: sc.scriptName ?? '', text: sc.replaceString });
        }
        matched.set(id, { sig, list });
        return list;
    }

    const host = createHost({
        context, layers, status: status ?? fileStatus(context), textOf, busy: generating, progress: showBusy,
        regexesOf: id => matched.get(id)?.list ?? [],
        sender: prefillSender,   // 프리필을 켜 둔 때에는 상태창 글 요청에도 싣는다(꺼져 있으면 profileSender 그대로다)
    });

    /** 메시지 하나에 입힌다. fresh 면 화면이 다 그려지기를 기다려 번역이 없는 줄을 묻는다 */
    async function show(id, fresh) {
        const message = context().chat?.[id];
        if (!message || viewOf(message) !== 'shown') return;
        await layers?.ready();
        if (fresh) await waitForFrames(id);
        if (context().chat?.[id] !== message || viewOf(message) !== 'shown') return;
        const templates = (await regexesOf(id)).map(r => r.text);
        watchFrames(id);
        // 방금 본문 요청에 같이 실어 보낸 메시지는 입히기만 한다(따로 묻지 않는다)
        const ask = fresh && !together.delete(message);
        const result = await live.rendered({ id, fresh: ask, pressed: true, templates, host });
        if (result.asked) console.info(`[번역] 메시지 ${id}: 상태창 글 ${result.asked}개를 물어 ${result.learned}개 받았어요`);
        return result;
    }
    /**
     * 본문 번역을 보내기 전에 부른다(job/run.js translateMessage): 그 메시지의 아직 번역 없는 상태창 글을 본문 요청에 실을 꼴로 준다. 없으면 null.
     * 답에서 빠진 글은 못 받은 글로 적는다(번역할 때마다 같은 글을 다시 묻지 않게).
     */
    async function extrasFor(id) {
        const message = context().chat?.[id];
        if (!message || !textOf(id)) return null;
        await layers?.ready();
        const templates = (await regexesOf(id)).map(r => r.text);
        const extras = await live.collect({ id, templates, host });
        if (!extras) return null;
        host.progress(id)();   // 원문이 있던 곳을 적을 준비만 한다(요청 중 표시는 본문 번역의 진행 표시가 맡는다)
        const finish = extras.finish;
        extras.finish = () => { together.add(message); finish(); };
        const records = live.recordsFor(host);   // 보낼 때의 캐릭터 기록에 적는다(답이 올 때는 다른 캐릭터의 채팅일 수 있다)
        extras.onAnswer = (prompt, raw, from) => markUnanswered(records, prompt, raw, from);
        return extras;
    }
    const together = new WeakSet();   // 본문 요청에 상태창 글을 같이 실어 보낸 메시지

    // 요청이 겹쳐 나가지 않게 한 줄로 돌린다
    let line = Promise.resolve();
    const later = (id, fresh) => (line = line.then(() => show(id, fresh)).catch(error => console.warn('[번역] 상태창 번역을 하지 못했어요', error)));

    // ── 상태창 번역 목록(ui/panel/open.js)이 부르는 것 ──

    /** 화면에 그려진 맨 끝 AI 답의 번호(없으면 -1) */
    function lastAnswerId() {
        const chat = context().chat ?? [];
        for (let id = chat.length - 1; id >= 0; id--) if (chat[id] && !chat[id].is_user && !chat[id].is_system && textOf(id)) return id;
        return -1;
    }
    /** 지금 답에 상태창이 있는가: 그 답에 걸린 화면용 정규식 틀이 있거나 iframe 이 그려져 있다 */
    const hasStatusNow = () => { const id = lastAnswerId(); return id >= 0 && (!!matched.get(id)?.list.length || !!textOf(id).querySelector('iframe')); };
    /** 요청 줄(line)에 세워 차례대로 돌리고 그 결과를 돌려준다 */
    const inLine = work => { const run = line.then(work); line = run.catch(() => {}); return run; };

    /** 메시지를 다시 그리게 한다: 이미 입힌 줄은 다시 보지 않으므로(live.js), 새 번역은 본문 칸이 새로 그려져야 입혀진다 */
    function redraw(id) {
        const c = context(), message = c.chat?.[id];
        if (!message || !textOf(id)) return;
        c.updateMessageBlock(id, message);
        c.eventSource?.emit(c.eventTypes.MESSAGE_UPDATED, id);   // 메시지 버튼과 보기 방식, iframe 을 그리는 쪽이 다시 그리게
    }

    /**
     * 다시 번역받기로 표시된 줄(store/status.js markRedo)을 요청 한 번으로 다시 받는다. 새 번역이 올 때까지 화면의 옛 번역은 그대로다.
     * @returns {Promise<{ asked: number, learned: number }>}
     */
    const redo = () => inLine(async () => {
        await layers?.ready();
        // 엔진이 기록을 다 읽기를 기다린다(없는 메시지 번호라 입히는 것은 없다)
        await live.rendered({ id: -1, fresh: false, pressed: true, templates: [], host });
        const { rec, save, send, sources, given } = await host.again();
        try {
            const result = await redoLines({ rec, send, sources });
            for (const { id, t } of result.put) putRedone(live.recordsFor(host), given, id, t);
            if (result.learned) redraw(lastAnswerId());
            return { asked: result.asked, learned: result.learned };
        } finally { save(); }
    });

    /**
     * 지금 답의 상태창 글 가운데 번역이 없는 것을 요청 한 번으로 묻는다.
     * @returns {Promise<{ asked: number, learned: number } | null>} 지금 답에 번역이 보이지 않으면 null
     */
    const askNow = () => inLine(async () => {
        const id = lastAnswerId(), message = context().chat?.[id];
        if (!message || viewOf(message) !== 'shown') return null;
        together.delete(message);   // 본문과 같이 보낸 답이어도 이번에는 묻는다
        const result = await show(id, true);
        return result ? { asked: result.asked, learned: result.learned } : null;
    });

    /** 늦게 불러와지는 iframe 과, 눌러야 뜨는 화면처럼 나중에 바뀌는 글: 그때 저장된 번역을 다시 입힌다 */
    const hooked = new WeakSet(), watched = new WeakSet();
    function watchFrames(id) {
        for (const frame of textOf(id)?.querySelectorAll('iframe') ?? []) {
            if (!hooked.has(frame)) { hooked.add(frame); frame.addEventListener('load', () => later(id, false)); }
            let doc = null;
            try { doc = frame.contentDocument; } catch { /* 다른 출처 */ }
            if (!doc?.body || watched.has(doc)) continue;
            watched.add(doc);
            let queued = false;
            new doc.defaultView.MutationObserver(() => {
                if (queued || generating()) return;
                queued = true;
                setTimeout(() => { queued = false; later(id, false); }, 150);
            }).observe(doc.body, { subtree: true, childList: true, characterData: true });
        }
    }

    // 메시지 번역이 끝났다(받은 데까지만 붙은 것도): 그 메시지의 상태창 번역을 잇는다.
    // 이 알림 안에서 바로 그 일을 적어 둔다(api.js screenWork): 번역 끝 신호를 받은 쪽이 상태창 번역까지 기다릴 수 있게
    queue.listen(({ type, job, result, error }) => {
        const id = type === 'end' && (result || error?.kept) ? job.guard?.index?.() : -1;
        if (id < 0) return;
        // 본문 번역에 요청이 나갔으면 상태창 글을 따로 묻지 않는다(답 하나에 요청 한 번): 화면이 다 그려진 뒤에야 나타난 줄 하나를 물으려고 요청이 한 번 더 나갔다.
        // 상태창 글을 실어 보낸 답은 extrasFor 의 finish 가 이미 표시하지만, 실을 글이 없던 답(extrasFor 가 null)은 여기서만 표시된다: 이 줄을 빼면 그 요청이 다시 나간다.
        // 늦게 나타난 줄은 어디에도 적지 않는다(못 받은 글로 적으면 다시 싣지 않는다): 번역 없는 줄로 남아, 그 줄이 화면에 있는 답(이 답을 지우고 다시 번역하거나
        // 같은 캐릭터의 다른 답)을 번역할 때 본문 요청에 같이 실린다(extrasFor 는 번역할 그 답의 화면에서만 모은다). 맨 끝 답이면 askNow 로도 묻는다.
        // 적힌 줄이 아니라서 상태창 번역 목록에는 나오지 않고, 고른 줄 다시 번역받기(redo)로는 받지 못한다
        const message = context().chat?.[id];
        if (message && (result?.requests > 0 || error?.kept)) together.add(message);
        screenWork(id, later(id, true));
    });

    // 본문 칸이 다시 그려진 메시지: 글꼴을 끼우고 저장된 번역을 입힌다. 콜백에서는 바뀐 메시지 번호만 모으고 0.3초 뒤 한 번에 한다
    const changed = new Set();
    let timer = 0;
    function flush() {
        timer = 0;
        const ids = [...changed], last = (context().chat?.length ?? 0) - 1;
        changed.clear();
        fonts.scan(ids);
        for (const id of ids) if (!(generating() && id === last)) later(id, false);
    }
    const ours = record => [...record.addedNodes, ...record.removedNodes].every(n => n.classList?.contains(BUSY));
    const chat = document.getElementById('chat');
    new MutationObserver(records => {
        for (const record of records) {
            const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
            if (el?.closest?.('.mes_text')) { if (!ours(record)) changed.add(Number(el.closest('.mes[mesid]')?.getAttribute('mesid'))); continue; }
            for (const n of record.addedNodes) if (n.nodeType === 1 && n.matches?.('.mes[mesid]')) changed.add(Number(n.getAttribute('mesid')));
        }
        if (changed.size && !timer) timer = setTimeout(flush, 300);
    }).observe(chat, { subtree: true, childList: true });

    // 이미 그려져 있는 메시지들
    for (const mes of chat.querySelectorAll('.mes[mesid]')) changed.add(Number(mes.getAttribute('mesid')));
    flush();
    /**
     * 채팅이 바뀌어 저장 기록에 그 채팅의 옛 번역이 보태진 뒤 부른다(app.js): 엔진의 기록에도 넣어, 새로고침 없이 그 줄이 입혀지게 한다.
     * 엔진이 이 캐릭터의 기록을 아직 읽지 않았으면 아무 일도 하지 않는다(읽을 때 보태진 것까지 같이 읽는다).
     */
    const takeChat = () => inLine(async () => {
        if (!host.loaded()) return 0;
        await live.rendered({ id: -1, fresh: false, pressed: true, templates: [], host });   // 엔진이 기록을 다 읽기를 기다린다(없는 메시지 번호라 입히는 것은 없다)
        return host.sync();
    });

    tools = { redo, askNow, hasStatusNow };
    return { extrasFor, takeChat, ...tools };
}

let tools = null;
/** 상태창 번역 목록이 쓸 것 { redo(), askNow(), hasStatusNow() }. 상태창 번역을 켜지 못했으면 null */
export const screenTools = () => tools;
