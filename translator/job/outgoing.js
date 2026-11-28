// 내가 보내는 글을 번역해서 보낸다(설정이 켜져 있을 때).
//
// 때: 실리태번이 내 글을 채팅에 넣은 바로 뒤, 프롬프트를 만들기 전(MESSAGE_SENT). 실리태번은 이 신호를 받는 쪽이 끝날 때까지 기다리므로
//   번역이 끝난 뒤에 답 만들기가 이어진다.
// 메시지에 적는 것(옛 번역기와 같은 꼴: 이미 보낸 글의 기록을 그대로 읽는다):
//   mes                       번역문. AI 에게 가는 글이고 채팅 파일에 남는 글이다
//   extra.llmt_sent_original  내가 쓴 글. 이 칸이 있으면 이미 번역해서 보낸 글이라 다시 번역하지 않는다
//   extra.display_text        내 화면에 보일 글(store/message.js attach). 보일 글 설정에 따라:
//     original  내가 쓴 글을 적는다. 번역한 원문의 해시(original_text_hash)도 같이 적는다: 이 표시가 없으면 보이는 글이 지금 글의 것인지
//               알 길이 없어 다른 기능이 덮어쓰거나 수정 창을 열었다 닫기만 해도 지워졌다(옛 번역기의 사고)
//     sent      적지 않는다(번역문이 그대로 보인다)
// 못 하면: 쓴 글 그대로 보낸다(mes 를 건드리지 않는다). 멈추기를 누르면 번역을 끊는다. 번역하는 동안 채팅 · 그 글 · 번역 연결이 바뀌어도 끊는다.

import { translatePlain, connectionNow } from './plain.js';
import { buildReference } from './outgoing-reference.js';
import { watched, stillThere } from './run.js';
import { earlier, hasSlot, fillSlot, contextOptions } from './earlier.js';
import { readOutgoing, languageLabel } from '../store/outgoing.js';
import { readSettings } from '../store/settings.js';
import { attach } from '../store/message.js';
import { holdRules } from '../rules/hold.js';

// 참고로 넣는 최근 대화의 메시지 수: 옛 설정 칸(context_message_count)을 읽고, 없으면 옛 기본값
const RECENT_FALLBACK = 5;

/** 프롬프트의 {{languageRules}} 자리에 들어갈 글: 언어가 하나면 한 줄, 대사 언어를 따로 정했으면 서술과 대사의 규칙 */
export function languageRules(s) {
    if (!s.dialogueLang) return `- Write everything in ${s.lang}.`;
    // 서술과 대사가 한 줄에 같이 있는 문장이 흔해서 '한 줄에 두 언어를 섞지 마라'는 지킬 수 없는 말이다: 따옴표 안팎으로 가른다
    return [
        `- Narration and action (outside quotation marks): write in ${s.lang} only.`,
        `- Dialogue (inside quotation marks or 「」): write in ${s.dialogueLang} only.`,
        `- Keep each quotation mark as it is. Inside the marks use only ${s.dialogueLang}, outside them only ${s.lang}.`,
    ].join('\n');
}

/**
 * 보내는 글의 옮기는 법: 프롬프트의 자리를 채우고 참고 글을 붙인다.
 * 바꿔 넣을 글을 함수로 준다: 언어 칸에 적은 글의 $& · $' 가 바꾸기 기호로 읽혀 프롬프트가 깨진 적이 있다(옛 번역기의 사고).
 * 프롬프트에 앞 대화 자리({{llmContext}})가 있으면 그 자리에 앞 대화 글(before)을 넣는다. 참고 글의 최근 대화는 이것과 따로 붙는다(참고 글 설정이 정한다).
 */
export function sendMethod(s, reference, substitute = text => text, before = '') {
    const filled = fillSlot(s.prompt, before)
        .replace(/\{\{languageRules\}\}/g, () => languageRules(s))
        .replace(/\{\{targetLang\}\}/g, () => s.lang)
        .replace(/\{\{dialogueLang\}\}/g, () => s.dialogueLang || s.lang);
    return substitute(reference ? `${filled}\n\n${reference}` : filled);
}

/** 프롬프트의 앞 대화 자리에 넣을 글: 보내는 글 앞의 메시지들의 끝부분. 프롬프트에 그 자리가 없으면 만들지 않는다 */
function earlierFor(c, s, id) {
    if (!hasSlot(s.prompt)) return '';
    const hold = holdRules(readSettings(c.extensionSettings), c);
    return earlier(c.chat || [], id, hold, contextOptions(c.extensionSettings));
}

const stopped = () => Object.assign(new Error('번역을 멈췄어요. 쓴 글 그대로 보내요.'), { cancelled: true, stopped: true });

/**
 * @param {object} d
 * @param {() => object} d.context 실리태번 getContext
 * @param {object} d.guards job/guard.js createGuards 의 것(app.js 와 같은 것: 채팅이 바뀐 것을 같이 안다)
 * @param {object} [d.layers] store/layers.js createLayers 의 것
 * @param {(text: string) => string | number} d.hash 실리태번 getStringHash
 * @param {{ working(text: string): () => void, info(text: string): void, warn(text: string): void, error(text: string): void }} d.say 알림
 * @param {(on: boolean) => void} [d.busy] 번역하는 동안 켜지는 표시(입력창 옆 버튼)
 * @param {(message: object) => string} [d.shown] 그 메시지가 화면에 보이는 글(화면용 정규식을 거친 것)
 * @param {Function} [d.send] 보내기 함수(시험)
 */
export function createOutgoing(d) {
    const { context, guards, layers, hash, say, busy = () => {} } = d;

    /** 번역할 글이면 그 메시지, 아니면 null */
    function target(id, s) {
        const message = context().chat?.[id];
        if (!s.on || !message || !message.is_user || message.is_system) return null;
        if (message.extra?.llmt_sent_original !== undefined || !String(message.mes ?? '').trim()) return null;
        return message;
    }

    async function request(message, id, s, signal) {
        const c = context(), text = String(message.mes);
        const count = Number(c.extensionSettings?.['llm-translator-custom']?.context_message_count) || RECENT_FALLBACK;
        const reference = await buildReference(c, s, { text, at: id, count, shown: d.shown });
        if (signal.aborted) throw signal.reason;
        return translatePlain({ context: c, layers, text, method: sendMethod(s, reference, c.substituteParams, earlierFor(c, s, id)), signal, send: d.send });
    }

    /** 받은 번역을 메시지에 적는다 */
    function write(message, original, translated, s) {
        const c = context();
        if (!message.extra || typeof message.extra !== 'object') message.extra = {};
        message.extra.llmt_sent_original = original;
        message.mes = translated;
        if (s.display !== 'original') return;
        attach(message, { text: original, hash: String(hash(c.substituteParams(message.mes, c.name1, message.name))) });
    }

    function report(error) {
        if (error?.cancelled) { say.info(error.message); return; }
        console.warn('[번역] 내 글을 번역하지 못해 쓴 글 그대로 보내요:', error);
        say.error(`내 글을 번역하지 못해 쓴 글 그대로 보냈어요. (${String(error?.message ?? error).slice(0, 120)})`);
    }

    /** MESSAGE_SENT 가 부른다. 끝날 때까지 실리태번이 기다린다 */
    async function onSent(id) {
        const s = readOutgoing(context()), message = target(Number(id), s);
        if (!message) return;
        const original = String(message.mes), guard = guards.capture(message);
        const controller = new AbortController();
        // 다른 확장이 자기 생성을 멈출 때도 같은 신호를 보낸다(그때는 생성 id 글이 딸려 온다). 그것은 이 번역을 멈추라는 뜻이 아니다
        const onStop = generation => { if (!(typeof generation === 'string' && generation)) controller.abort(stopped()); };
        const { eventSource, eventTypes } = context();
        const close = say.working(`내 글을 번역해서 보내는 중이에요. (${languageLabel(s)})`);
        busy(true);
        eventSource.on(eventTypes.GENERATION_STOPPED, onStop);
        try {
            const out = await watched({ guard, signal: controller.signal, connection: connectionNow(context(), layers) }, signal => request(message, Number(id), s, signal));
            if (!out.sent) return;
            const translated = out.text.trim();
            if (out.failed >= out.sent || !translated) throw new Error('번역을 받지 못했어요');
            write(await stillThere(guard), original, translated, s);
            await context().saveChat();
            if (out.failed) say.warn(`${out.failed}문단은 번역하지 못해 쓴 글 그대로 보냈어요.`);
        } catch (error) {
            report(error);
        } finally {
            eventSource.removeListener(eventTypes.GENERATION_STOPPED, onStop);
            close();
            busy(false);
        }
    }

    return { onSent };
}
