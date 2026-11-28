// 다시 번역으로 바뀐 문단의 바로 앞 번역을 메시지에 하나만 보관한다(되돌리기용). 다시 번역할 때마다 덮어쓴다.
//
// 꼴: extra.llmt_before = { v: 1, after, paras?, units?, text?, pairs? }
//   after  보관할 때의 번역문 지문(store/pairs.js mark). 지금 번역문이 이것과 다르면(손으로 고침 · 새로 번역 · 지움) 보관한 것은 쓰지 않는다
//   paras  고른 문단만 바꿨을 때: [지금 번역문에서의 시작, 끝, 앞 번역 글][]
//   units  그 문단들의 짝 기록 줄(llmt_pairs.units 의 [번호, 줄])
//   text · pairs  글 전체를 바꿨을 때: 앞 번역문 전체와 그때의 짝 기록
// 메시지와 지금 스와이프 사본(swipe_info[swipe_id].extra)에 같이 둔다: 스와이프를 넘겼다 돌아오면 실리태번이 사본에서 되살린다.
// 저장(saveChat)은 부르는 쪽이 한다.

import { mark } from './pairs.js';
import { extras, translationOf } from './message.js';

export const BEFORE_FIELD = 'llmt_before';

/** 보관한다. after = 보관한 뒤의 번역문 */
export function keepBefore(message, after, slot) {
    const value = { v: 1, after: mark(after), ...slot };
    for (const extra of extras(message)) extra[BEFORE_FIELD] = structuredClone(value);
}

/** 지금 번역문에 쓸 수 있는 보관분. 없거나 낡았으면 null */
export function readBefore(message) {
    const saved = message?.extra?.[BEFORE_FIELD];
    if (!saved || saved.v !== 1) return null;
    const now = translationOf(message);
    return now && saved.after === mark(now) ? saved : null;
}

/** 짝 기록만 바꿔 적는다(누구 말인지 바로잡기) */
export function writePairs(message, pairs) {
    for (const extra of extras(message)) extra.llmt_pairs = structuredClone(pairs);
}
