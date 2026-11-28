// 이 채팅의 번역을 한 번에 지운다: 메시지마다, 넘겨 둔 스와이프 사본까지. 원문(mes)과 번역 기억은 건드리지 않는다.
// 지우는 칸은 메시지 하나 지우기와 같다(store/message.js detach). 저장은 끝에 한 번.
// 되돌릴 수 없어서 화면은 count() 로 몇 개인지 보여 주고 확인을 받은 뒤 run() 을 부른다.
//
// 실리태번을 직접 부르지 않는다. deps 꼴:
//   chat() → object[]            지금 채팅의 메시지들
//   busy() → boolean             번역하는 중인가(줄에 선 일 · 채팅 전부 번역 · 답이 끝나길 기다리는 예약)
//   redraw(ids: number[])        번역을 지운 메시지들을 다시 그리기
//   save() → Promise             채팅 저장

import { viewOf, detach } from '../store/message.js';

/** 번역이 붙은 칸들: 메시지의 extra 와 스와이프 사본마다의 extra(지금 보는 것이 아닌 스와이프도) */
function translatedExtras(message) {
    const copies = Array.isArray(message?.swipe_info) ? message.swipe_info.map(info => info?.extra) : [];
    return [message?.extra, ...copies].filter(extra => extra && typeof extra === 'object' && viewOf({ extra }) !== 'none');
}

/** 번역이 붙은 메시지들: [{ id, extras }] */
function translatedIn(chat) {
    const out = [];
    (chat || []).forEach((message, id) => {
        const extras = translatedExtras(message);
        if (extras.length) out.push({ id, extras });
    });
    return out;
}

const sizeOf = found => ({ messages: found.length, copies: found.reduce((sum, item) => sum + item.extras.length, 0) });

/**
 * @param {{ chat: () => object[], busy: () => boolean, redraw: (ids: number[]) => void, save: () => Promise<any> }} deps
 */
export function createClear(deps) {
    return {
        /**
         * 지울 것의 수(아무것도 바꾸지 않는다).
         * @returns {{ messages: number, copies: number, busy: boolean }}
         *   messages = 번역이 붙은 메시지 수, copies = 번역이 든 칸 수(메시지 + 스와이프 사본), busy = 번역하는 중이라 지금은 못 지움
         */
        count: () => ({ ...sizeOf(translatedIn(deps.chat())), busy: Boolean(deps.busy()) }),
        /**
         * 지운다. 번역하는 중이면 시작하지 않는다.
         * @returns {Promise<{ ok: boolean, reason?: 'busy', messages: number, copies: number }>}
         */
        async run() {
            if (deps.busy()) return { ok: false, reason: 'busy', messages: 0, copies: 0 };
            const found = translatedIn(deps.chat());
            if (!found.length) return { ok: true, messages: 0, copies: 0 };
            for (const { extras } of found) for (const extra of extras) detach({ extra });
            deps.redraw(found.map(item => item.id));
            await deps.save();
            return { ok: true, ...sizeOf(found) };
        },
    };
}
