// 내 글을 다른 언어로 옮기는 두 기능을 켠다: 보낼 때 번역해 보내기(job/outgoing.js), 입력창에 쓴 글을 그 자리에서 번역하기(job/input.js).
// 여기서 하는 일: 실리태번 신호에 잇기, 입력창 옆 버튼(button.js)을 설정에 맞춰 보이고 숨기기, 알림.
// 설정 값은 store/outgoing.js 가 읽고 쓴다. 설정 화면이 값을 바꾸면 그 파일이 알려 줘서 버튼과 줄이 따라 바뀐다.

import { createOutgoing } from '../../job/outgoing.js';
import { useInput, translateInput } from '../../job/input.js';
import { readOutgoing, setOutgoing, onOutgoingChange, languageLabel } from '../../store/outgoing.js';
import { inputButton } from './button.js';

const STYLE_ID = 'btr-input-style';
export const INPUT_ROW_ID = 'llm_translate_input_message';

const toast = (kind, text, options = { timeOut: 3500 }) => globalThis.toastr?.[kind]?.(text, '', options);

/** 알림. working 은 일이 끝날 때까지 떠 있고, 돌려준 함수를 부르면 닫힌다 */
const say = {
    info: text => toast('info', text),
    warn: text => toast('warning', text),
    error: text => toast('error', text, { timeOut: 8000 }),
    working(text) {
        const shown = toast('info', text, { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false });
        return () => { if (shown) globalThis.toastr?.clear(shown); };
    },
};

function loadStyle() {
    if (document.getElementById(STYLE_ID)) return;
    document.head.append(Object.assign(document.createElement('link'), { id: STYLE_ID, rel: 'stylesheet', href: new URL('./input.css', import.meta.url).href }));
}

/** 그 메시지가 채팅 화면에 보이는 글: 화면용 정규식을 실리태번이 그릴 때처럼 거친다. 정규식 기능을 못 불러왔으면 글 그대로 */
function shownText(context) {
    let engine = null;
    import('/scripts/extensions/regex/engine.js').then(module => { engine = module; }, () => {});
    return message => {
        if (!engine) return message.mes;
        const all = context().chat || [], at = all.indexOf(message);
        const placement = message.is_user ? engine.regex_placement.USER_INPUT : engine.regex_placement.AI_OUTPUT;
        return engine.getRegexedString(String(message.mes ?? ''), placement, { isMarkdown: true, isPrompt: false, depth: at < 0 ? undefined : all.length - 1 - at, characterOverride: message.name });
    };
}

/** 버튼을 눌러 켜고 끈다 */
function toggle(context) {
    const c = context(), on = !readOutgoing(c).on;
    setOutgoing(c, 'on', on);
    say.info(on ? `이제 내 글을 번역해서 보내요. (${languageLabel(readOutgoing(c))})` : '이제 내 글을 쓴 그대로 보내요.');
}

/**
 * 시작할 때 한 번 부른다(app.js).
 * @param {object} o
 * @param {() => object} o.context 실리태번 getContext  @param {object} o.guards app.js 의 것  @param {object} o.layers store/hands.js 의 layers
 * @param {(text: string) => string | number} o.hash 실리태번 getStringHash
 */
export function install({ context, guards, layers, hash }) {
    loadStyle();
    const button = inputButton({
        state: () => { const s = readOutgoing(context()); return { on: s.on, language: languageLabel(s) }; },
        onPress: () => toggle(context),
        onHold: () => translateInput(),
    });
    const busy = on => button.busy(on);
    const outgoing = createOutgoing({ context, guards, layers, hash, say, busy, shown: shownText(context) });
    useInput({ context, layers, say, busy });

    const sync = () => button.show(readOutgoing(context()).showButton);
    onOutgoingChange(sync);
    sync();

    const { eventSource, eventTypes } = context();
    eventSource.on(eventTypes.MESSAGE_SENT, id => outgoing.onSent(id));
    // 켜고 끄는 값은 채팅마다 · 캐릭터마다 다를 수 있어 채팅이 바뀌면 버튼을 다시 칠한다
    eventSource.on(eventTypes.CHAT_CHANGED, () => button.paint());
}
