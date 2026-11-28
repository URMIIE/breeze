// 다른 채팅에 가 있는 동안의 번역. 번역은 채팅이 바뀌어도 그만두지 않는다(멈추는 것은 멈추기 버튼뿐이다).
//
// 1. 붙잡아 두기(pinChat): 번역을 누를 때(채팅 전부 번역은 시작할 때) 그 채팅의 정보를 붙잡아 둔다.
//    다른 채팅에 가 있는 동안 시작하는 번역은 이것으로 재료를 만든다(job/run.js translateMessage 의 pinned):
//    채팅 배열(실리태번은 같은 배열을 비우고 새 채팅으로 채우므로 사본), 채팅 id, 이름 매크로의 이름.
//    쓰는 곳 셋의 사람 · 이름 · 규칙과 답마다의 뺄 글 규칙은 부르는 쪽(app.js)이 같이 붙잡는다.
// 2. 적어 두기(store/later.js): 다른 채팅에 있는 동안 끝난 번역은 문단 번역 기억에 남고, '그 채팅을 열면 붙일 답'으로 적힌다.
// 3. 돌아오면 붙이기(createReturn): 그 채팅을 열면 적어 둔 답을 붙인다. 요청을 보내지 않는다.
//    먼저 받은 번역 그대로(keepAnswer 가 기억 저장소에 둔 것)를 붙인다. 문단 기억만으로는 모자라서다: 확인에 걸린 문단 · 원문과 같은 문단은
//    문단 기억에 안 들어가(job/engine.js remember), 그런 문단이 하나라도 있는 답은 돌아와도 붙지 않고 번역을 다시 눌러야 했다.
//    받은 번역 그대로가 없으면(옛 줄, 저장소에서 밀려남) 문단 기억으로 만든다. 문단이 기억에 다 있는 답만 붙인다.
//    못 받은 문단이 있는 답은 그대로 두고 목록에서 뺀다: 번역을 누르면 받은 문단은 기억에서 쓰고 남은 것만 보낸다.
//    그새 지워졌거나 글 · 스와이프가 바뀐 답, 이미 번역이 붙은 답은 붙이지 않고 목록에서 뺀다.
//    저장은 다 붙인 뒤 한 번 한다(답마다 저장하면 긴 채팅에서는 앞 저장이 끝나기 전에 뒤 저장이 겹친다). 저장한 뒤에 목록에서 뺀다:
//    붙이는 도중에 또 채팅을 옮기면 저장되지 않은 답은 목록에 남아 다음에 다시 붙는다.
// 실리태번을 직접 부르지 않는다.

import { translateOnce } from './run.js';
import { remembered } from './engine.js';
import { requestsFor } from './estimate.js';
import { attach, viewOf } from '../store/message.js';
import { hashOf } from '../store/memory.js';
import { replaceBanned } from '../core/banned.js';

/**
 * 채팅 이름: 그룹 · (그룹이 아니면) 캐릭터 파일 · 채팅 id. 새로고침 뒤에도 같은 채팅을 가리키게 캐릭터는 번호가 아니라 파일 이름으로 적는다
 * (번호는 캐릭터를 더하거나 지우면 바뀐다).
 */
export function chatName(context) {
    const group = context.groupId ?? null;
    const card = group === null ? context.characters?.[context.characterId]?.avatar ?? null : null;
    return JSON.stringify([group, card, context.getCurrentChatId?.() ?? context.chatId ?? null]);
}

/** 지금 채팅을 붙잡아 둔 context. 매크로는 이름을 안 넘기면 붙잡을 때의 이름으로 푼다 */
export function pinChat(context) {
    const chatId = context.getCurrentChatId?.() ?? context.chatId ?? '';
    const { name1, name2 } = context;
    return {
        ...context,
        chat: [...(context.chat || [])],
        getCurrentChatId: () => chatId,
        substituteParams: (text, user = name1, char = name2, ...rest) => context.substituteParams(text, user, char, ...rest),
    };
}

/** 다시 연 채팅에서 그 답을 찾는다: 같은 객체, 아니면 같은 자리의 같은 날짜 · 같은 글, 아니면 날짜 · 글이 같은 답. 없으면 null */
export function findAgain(chat, message, index) {
    const list = chat || [];
    if (list.includes(message)) return message;
    const same = other => !!other && other.send_date === message.send_date && other.mes === message.mes && !other.is_system;
    return same(list[index]) ? list[index] : list.find(same) ?? null;
}

/** 적어 둘 줄(store/later.js add 의 꼴): 붙잡은 답의 자리와 글, 번역할 때의 설정 지문 */
export function rowOf(guard, plan) {
    const { index, sent, swipe, mes } = guard.note();
    return { index, sent, swipe, hash: hashOf(mes), mark: plan.memory.mark };
}

// 받은 번역 그대로를 두는 열쇠: 문단 열쇠와 겹치지 않게 앞머리를 다르게, 답의 자리 · 날짜 · 스와이프 · 원문 지문으로
const keptKey = row => hashOf(`away\u0000${row.index}\u0000${row.sent}\u0000${row.swipe}\u0000${row.hash}`);

/** 다른 채팅에 있는 동안 받은 번역 그대로(text · 문단 짝)를 기억 저장소에 둔다. memory: store/memory.js createMemory 의 것 */
export async function keepAnswer(memory, row, out) {
    if (!memory || typeof out?.text !== 'string') return;
    memory.put(keptKey(row), JSON.stringify({ text: out.text, pairs: out.pairs ?? null }));
    await memory.flush();
}

/** 둔 번역 그대로 → { text, pairs } 또는 null */
export async function keptAnswer(memory, row) {
    if (!memory) return null;
    try {
        const saved = JSON.parse((await memory.get(keptKey(row))) ?? 'null');
        return typeof saved?.text === 'string' ? saved : null;
    } catch { return null; }
}

/** 붙였거나 버린 줄의 번역 그대로를 지운다 */
export async function forgetKept(memory, rows) {
    if (memory && rows.length) await memory.forget(rows.map(keptKey));
}

/** 이 재료의 문단이 기억에 다 있으면 요청 없이 번역문을 만든다. 하나라도 없으면 null */
async function fromMemory(plan) {
    const have = await remembered(plan);
    if (!have.size || requestsFor(plan, piece => !have.has(piece.src))) return null;
    const never = async () => '';
    const out = await translateOnce(plan, { send: never, notify: () => {} });
    return out.failed.length ? null : out;
}

/**
 * @param {object} deps
 * @param {() => object} deps.context 실리태번 getContext
 * @param {ReturnType<import('../store/later.js').createLater>} deps.later
 * @param {() => Promise<any>} deps.ready 쓰는 곳 셋을 다 읽기를 기다린다
 * @param {(message: object) => object | null} deps.planFor 그 답의 번역 재료(job/run.js prepare 의 값)
 * @param {(message: object) => boolean} deps.busy 그 답을 지금 번역하는 중인가
 * @param {(text: string) => string | number} deps.hash 원문 해시(getStringHash)
 * @param {(id: number, message: object) => void} [deps.onAttached] 번역을 붙인 뒤(다시 그리기)
 * @param {(row: object) => Promise<{ text: string, pairs: object | null } | null>} [deps.kept] 그 줄의 받은 번역 그대로(keptAnswer)
 * @param {(rows: object[]) => Promise<any>} [deps.forgetKept] 목록에서 뺀 줄의 받은 번역 그대로를 지운다
 * @returns {() => Promise<number>} 지금 채팅에 적어 둔 답을 붙인다 → 붙인 수. 도는 중에 또 부르면 끝난 뒤 한 번 더 돈다
 */
export function createReturn(deps) {
    let running = null, again = false;

    /** @returns {Promise<'attached' | 'wait' | 'drop'>} wait = 아직 받는 중이라 목록에 둔다 */
    async function one(chat, row) {
        const list = deps.context().chat || [];
        const message = list[row.index]?.send_date === row.sent ? list[row.index] : list.find(m => m?.send_date === row.sent && !m.is_system);
        if (!message || hashOf(message.mes) !== row.hash || (message.swipe_id ?? null) !== row.swipe) return 'drop';
        if (deps.busy(message)) return 'wait';
        if (viewOf(message) !== 'none') return 'drop';
        const plan = deps.planFor(message);
        const out = plan ? (await deps.kept?.(row)) ?? await fromMemory({ ...plan, memory: { ...plan.memory, mark: row.mark } }) : null;
        // 기억을 읽는 사이 채팅이 바뀌었거나 그 답에 다른 일이 생겼으면 이번에는 두고 다음에 본다
        const id = chatName(deps.context()) === chat ? (deps.context().chat || []).indexOf(message) : -1;
        if (out && (id < 0 || viewOf(message) !== 'none' || deps.busy(message))) return 'wait';
        if (!out) return 'drop';
        attach(message, { text: replaceBanned(out.text), pairs: out.pairs, hash: String(deps.hash(plan.original)) });
        deps.onAttached?.(id, message);
        return 'attached';
    }

    async function pass() {
        const chat = chatName(deps.context()), attached = [], gone = [];
        if (!deps.later.list(chat).length) return 0;
        await deps.ready();
        for (const row of deps.later.list(chat)) {
            if (chatName(deps.context()) !== chat) break;
            const end = await one(chat, row);
            if (end === 'attached') attached.push(row);
            if (end === 'drop') gone.push(row);
        }
        deps.later.drop(chat, gone);
        await deps.forgetKept?.(gone);
        if (!attached.length || chatName(deps.context()) !== chat) return 0;
        await deps.context().saveChat();
        deps.later.drop(chat, attached);
        await deps.forgetKept?.(attached);
        return attached.length;
    }

    return function attachReturned() {
        if (running) { again = true; return running; }
        running = (async () => {
            let count = 0;
            do { again = false; count += await pass(); } while (again);
            return count;
        })().catch(error => { console.warn('[번역] 다른 채팅에 있는 동안 받은 번역을 붙이지 못했어요', error); return 0; }).finally(() => { running = null; });
        return running;
    };
}
