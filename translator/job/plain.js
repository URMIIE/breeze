// 이야기 답이 아닌 글 하나를 옮긴다: 내가 보내는 글, 입력창에 쓴 글.
// 답의 번역과 다른 점: 답의 꼴이 번호뿐이다(대사 주인 표시 없음). 사람 줄 · 이름 줄 · 내 규칙을 넣지 않는다(한국어로 옮길 때 쓰는 재료다).
//   이미 한국어인 문단도 보낸다(옮길 글이 그 문단이다). 번역 기억을 쓰지 않는다.
// 같은 것: 요청 한 번, 흘려 받기, 번역용 연결 프로필과 고른 모델(job/sources.js), 글에 맞춘 최대 출력 토큰(send/room.js), 프리필, 거절 거르기,
//   뺄 글 규칙(그림 · 생각 덩이는 보내지 않고 제자리에 둔다).

import { translate } from '../run/translate.js';
import { PLAIN_SHAPE } from '../core/request.js';
import { sentBodies } from '../core/refusal.js';
import { readSettings, connectionMark } from '../store/settings.js';
import { holdRules } from '../rules/hold.js';
import { prefillSender } from '../send/prefill.js';
import { refusalFilter } from './run.js';
import { gather } from './sources.js';

/** 글자의 절반 넘게가 한글인가(한국어로 쓴 글을 다른 언어로 옮기는 요청인지 가린다) */
function mostlyHangul(text) {
    const letters = (text.match(/\p{L}/gu) || []).length, hangul = (text.match(/\p{Script=Hangul}/gu) || []).length;
    return hangul * 2 > letters;
}

/** 지금 번역에 쓰는 설정(고른 연결 프로필을 덮은 것) */
async function settingsNow(context, layers) {
    const base = readSettings(context.extensionSettings);
    return layers ? (await gather(context, layers, base)).settings : base;
}

/** 번역하는 동안 바뀌면 멈춰야 하는 것의 지문: 연결 · 모델 */
export function connectionNow(context, layers) {
    return () => connectionMark(readSettings(context.extensionSettings)) + (layers ? '|' + layers.mark() : '');
}

/**
 * @param {object} o
 * @param {object} o.context 실리태번 getContext()
 * @param {object} [o.layers] store/layers.js createLayers 의 것(있으면 고른 연결 프로필을 쓴다)
 * @param {string} o.text 옮길 글  @param {string} o.method 옮기는 법(매크로를 푼 프롬프트)
 * @param {string} [o.earlier] 참고로 넣을 앞 대화 글  @param {AbortSignal} [o.signal]
 * @param {(prompt: string, o: object) => Promise<string>} [o.send] 보내기 함수(시험에서 바꿔 끼운다)
 * @returns {Promise<{ text: string, sent: number, failed: number, requests: number }>}
 *   sent: 보낸 조각 수(0 이면 옮길 글이 없어 요청하지 않았다)  failed: 못 받아 쓴 글 그대로 둔 조각 수
 */
export async function translatePlain({ context, layers, text, method, earlier = '', signal, send }) {
    const settings = await settingsNow(context, layers);
    // 프리필은 번역 요청이면 종류를 가리지 않고 싣는다(send/prefill.js). 꺼져 있으면 연결 프로필로 보내는 함수 그대로다
    const out = send ?? refusalFilter(prefillSender(context, settings));
    let sent = 0, requests = 0;
    const result = await translate({
        text, signal, hold: holdRules(settings, context), shape: PLAIN_SHAPE, repair: false,
        lang: mostlyHangul(text) ? 'ko' : undefined,
        parts: () => ({ method, rules: '', context: earlier, notes: [], people: '', terms: '' }),
        onEvent: event => { if (event.type === 'start') sent = event.sending; },
        // 보낼 조각이 하나도 없으면 요청하지 않는다(엔진은 빈 묶음도 한 번 보낸다)
        send: (full, options) => {
            if (!sentBodies(full).length) return '';
            requests++;
            return out(full, options);
        },
    });
    return { text: result.text, sent, failed: result.failed.length, requests };
}
