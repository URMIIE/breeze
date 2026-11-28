// 입력창에 쓴 글을 그 자리에서 번역해 바꾼다(보내지는 않는다). 입력창 옆 버튼을 길게 누르면 부른다.
// 옮기는 법은 번역해서 보낼 때와 같다: 같은 프롬프트, 같은 언어 칸(job/outgoing.js sendMethod). 참고 글은 붙이지 않는다.
//
// 번역하는 동안 입력창 글을 고치거나 다른 채팅으로 가면 그만둔다: 받은 번역으로 그사이 고친 글을 덮어쓰지 않는다.
// 한 번에 하나만 돈다. 되돌리기는 없다(옛 번역기에도 없었다): 번역 전 글은 돌려주는 값의 original 에 있다.
// 프롬프트에 앞 대화 자리({{llmContext}})가 있으면 그 자리에 앞의 메시지 몇 개의 끝부분을 넣는다(job/earlier.js). 자리가 없으면 앞 대화를 싣지 않는다.

import { translatePlain, connectionNow } from './plain.js';
import { earlier, hasSlot, contextOptions } from './earlier.js';
import { sendMethod } from './outgoing.js';
import { readOutgoing } from '../store/outgoing.js';
import { readSettings } from '../store/settings.js';
import { holdRules } from '../rules/hold.js';

let deps = null, running = false;

/**
 * 시작할 때 한 번 부른다.
 * @param {{ context: () => object, layers?: object, say: object, busy?: (on: boolean) => void, box?: () => HTMLTextAreaElement | null, send?: Function }} d
 *   say: 알림({ working, info, warn, error }), busy: 번역하는 동안 켜지는 표시, box: 입력창(안 주면 #send_textarea)
 */
export function useInput(d) {
    deps = d;
}

const cancelled = text => Object.assign(new Error(text), { cancelled: true });
// 그룹 채팅은 캐릭터 번호를 보지 않는다: 실리태번이 답을 만드는 동안 말하는 캐릭터로 바꿔 둔다
const chatKey = c => JSON.stringify([c.groupId ?? null, c.groupId ? null : c.characterId ?? null, c.getCurrentChatId?.() ?? null]);

/**
 * 프롬프트의 앞 대화 자리에 넣을 글: 채팅 끝의 메시지들의 끝부분.
 * 프롬프트에 그 자리가 없으면 만들지 않는다. 입력창 글은 아직 채팅에 없으니 채팅의 마지막 메시지까지 본다.
 */
function earlierFor(c, prompt) {
    if (!hasSlot(prompt) || !c.chat?.length) return '';
    const hold = holdRules(readSettings(c.extensionSettings), c);
    return earlier(c.chat, c.chat.length, hold, contextOptions(c.extensionSettings));
}

/**
 * 글 하나를 입력 번역 프롬프트와 언어 칸대로 번역한다(입력창은 건드리지 않는다).
 * @param {string} text  @param {{ prompt?: string, signal?: AbortSignal }} [o] prompt: 이번에만 쓸 프롬프트
 * @returns {Promise<string>} 번역문. 옮길 글이 없으면 받은 글 그대로
 */
export async function translateText(text, { prompt, signal } = {}) {
    if (!deps) throw new Error('번역기가 아직 켜지지 않았어요.');
    const c = deps.context(), source = String(text ?? '');
    if (!source.trim()) return '';
    const s = readOutgoing(c);
    if (prompt) s.prompt = String(prompt);
    const method = sendMethod(s, '', c.substituteParams, earlierFor(c, s.prompt));
    const out = await translatePlain({ context: c, layers: deps.layers, text: source, method, signal, send: deps.send });
    if (out.sent && out.failed >= out.sent) throw new Error('번역을 받지 못했어요');
    return out.text;
}

/** 번역하는 동안 지켜볼 것을 걸고, 그만둘 때 끊는 신호와 거두는 함수를 준다 */
function watchInput(c, box) {
    const controller = new AbortController(), key = chatKey(c), mark = connectionNow(c, deps.layers), was = mark();
    const edited = () => controller.abort(cancelled('입력창 글이 바뀌어 번역을 그만뒀어요.'));
    const check = () => {
        if (chatKey(deps.context()) !== key) controller.abort(cancelled('채팅이 바뀌어 번역을 그만뒀어요.'));
        else if (mark() !== was) controller.abort(cancelled('연결이나 모델이 바뀌어 번역을 그만뒀어요.'));
    };
    box.addEventListener('input', edited);
    const timer = setInterval(check, 500);
    return { signal: controller.signal, check, stop() { clearInterval(timer); box.removeEventListener('input', edited); } };
}

async function replaceBox(c, box) {
    const original = box.value, watch = watchInput(c, box);
    const close = deps.say.working('입력창에 쓴 글을 번역하는 중이에요.');
    deps.busy?.(true);
    try {
        const text = await translateText(original, { signal: watch.signal });
        watch.check();
        if (watch.signal.aborted) throw watch.signal.reason;
        if (!box.isConnected || box.value !== original) throw cancelled('입력창 글이 바뀌어 번역을 그만뒀어요.');
        watch.stop();
        box.value = text;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        return { text, original };
    } catch (error) {
        throw watch.signal.aborted ? watch.signal.reason : error;
    } finally {
        watch.stop();
        close();
        deps.busy?.(false);
    }
}

/**
 * 지금 입력창에 쓴 글을 번역해 바꾼다. 알림은 여기서 띄운다.
 * @returns {Promise<{ text: string, original: string } | null>} text: 입력창에 넣은 번역문, original: 번역 전 글. 하지 않았거나 못 했으면 null
 */
export async function translateInput() {
    if (!deps) throw new Error('번역기가 아직 켜지지 않았어요.');
    const c = deps.context(), box = deps.box ? deps.box() : document.getElementById('send_textarea');
    if (!box?.value?.trim()) { deps.say.warn('입력창에 글을 먼저 써 주세요.'); return null; }
    if (running) { deps.say.info('입력창에 쓴 글을 번역하는 중이에요.'); return null; }
    running = true;
    try {
        const out = await replaceBox(c, box);
        deps.say.info('입력창에 쓴 글을 번역했어요. 확인하고 보내세요.');
        return out;
    } catch (error) {
        if (error?.cancelled) { deps.say.info(error.message); return null; }
        console.warn('[번역] 입력창 글을 번역하지 못했어요:', error);
        deps.say.error(`입력창에 쓴 글을 번역하지 못했어요. (${String(error?.message ?? error).slice(0, 120)})`);
        return null;
    } finally {
        running = false;
    }
}
