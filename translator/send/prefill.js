// 프리필: 켜 두면 번역 요청의 맨 끝에 모델의 말로 시작 글을 붙여 보낸다(모델이 그 글에 이어 답을 쓴다).
//
// 저장은 옛 번역 확장과 같은 자리 · 같은 열쇠: llm_prefill_toggle(기본 꺼짐) · llm_prefill_content.
// 번역 요청이면 종류를 가리지 않고 싣는다(첫 요청 · 끊긴 뒤 이어 받기 · 다시 번역 · 상태창 글): 옛 번역 확장도 번역 요청에는 전부 실었다.
// 요청에 싣는 것은 send/profile.js 가 한다(설정의 prefill 글을 보고). 여기서는 그 글을 설정에 얹고, 답 머리에 되풀이된 글을 뗀다.
// 떼는 까닭: 답은 줄 머리의 번호 표시로 문단을 읽는데(core/reply.js), 모델이 프리필 글을 되풀이하고 같은 줄에 첫 문단을 이어 쓰면
//   그 줄이 번호로 시작하지 않아 첫 문단이 안 온 것으로 읽힌다.
// 실리태번 모듈을 직접 불러오지 않는다.

import { SETTINGS_KEY } from '../store/settings.js';
import { profileSender } from './profile.js';

// 켜져 있는데 글이 비었을 때 쓰는 글(옛 번역 확장이 쓰던 것 그대로)
const WHEN_EMPTY = 'Understood. Here is my response:';

/** 저장된 값 → { on, text }. text 는 적어 둔 글 그대로(비었으면 '') */
export function prefillNow(extensionSettings) {
    const s = extensionSettings?.[SETTINGS_KEY] ?? {};
    return { on: s.llm_prefill_toggle === true, text: String(s.llm_prefill_content ?? '') };
}

/** 요청에 실을 글. 꺼져 있으면 '' */
export function prefillText(extensionSettings) {
    const now = prefillNow(extensionSettings);
    return now.on ? now.text || WHEN_EMPTY : '';
}

/** 번역 기억의 열쇠에 덧붙일 글: 꺼져 있으면 ''(열쇠가 그대로) */
export function prefillMark(extensionSettings) {
    const text = prefillText(extensionSettings);
    return text ? `|prefill:${text}` : '';
}

/**
 * 답 머리에 프리필 글이 되풀이됐으면 뗀다. 되풀이하지 않은 답은 그대로.
 * @param {string} raw 지금까지 온 답  @param {string} prefill 실어 보낸 글
 * @param {boolean} final 답이 끝났나. 오는 중이면 프리필 글의 앞부분만 온 것도 아직 되풀이하는 중으로 보고 비운다
 */
export function stripEcho(raw, prefill, final) {
    const text = String(raw ?? ''), head = String(prefill ?? '').trim();
    if (!head) return text;
    const body = text.trimStart();
    if (body.startsWith(head)) return body.slice(head.length).trimStart();
    if (!final && body && head.startsWith(body)) return '';
    return text;
}

/**
 * send/profile.js profileSender 와 같은 꼴의 보내기 함수. 프리필이 켜져 있으면 그 글을 실어 보내고 답 머리의 되풀이를 뗀다.
 * 꺼져 있으면 profileSender 그대로다.
 */
export function prefillSender(context, settings) {
    const prefill = prefillText(context.extensionSettings);
    if (!prefill) return profileSender(context, settings);
    const send = profileSender(context, { ...settings, prefill });
    return async (prompt, o = {}) => {
        const onText = o.onText && (raw => o.onText(stripEcho(raw, prefill, false)));
        return stripEcho(await send(prompt, { ...o, onText }), prefill, true);
    };
}

// ── 설정 화면이 부르는 것 ──

/** 켜고 끄기 */
export function setPrefillOn(context, on) {
    const s = (context.extensionSettings[SETTINGS_KEY] ??= {});
    s.llm_prefill_toggle = Boolean(on);
    context.saveSettingsDebounced?.();
}

/** 글 바꾸기 */
export function setPrefillText(context, text) {
    const s = (context.extensionSettings[SETTINGS_KEY] ??= {});
    s.llm_prefill_content = String(text ?? '');
    context.saveSettingsDebounced?.();
}
