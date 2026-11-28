// 번역을 메시지에 붙이고 떼기. 화면(ui/)은 이 함수들만 부른다.
//
// 꼴은 옛 번역기와 같다(같은 채팅을 옛 번역기 · 다른 확장이 읽는다):
//   extra.display_text               화면에 보이는 글. 실리태번이 mes 대신 이것을 그린다
//   extra.original_translation_backup 원문을 보는 동안 치워 둔 번역문(있으면 '원문 보는 중')
//   extra.llmt_pairs                 문단 짝 기록(store/pairs.js)
//   extra.original_text_hash         번역한 원문의 해시(원문이 바뀌었는지 알려고)
// 지금 스와이프의 사본(swipe_info[swipe_id].extra)에도 똑같이 둔다: 스와이프를 넘겼다 돌아오면 실리태번이 사본에서 되살린다.
// 저장(saveChat)은 부르는 쪽이 번역 한 번에 한 번 한다.

const FIELDS = ['display_text', 'original_translation_backup', 'llmt_pairs', 'original_text_hash'];
// 번역을 지울 때 같이 지우는 우리 칸: 다시 번역 전의 번역(store/before.js). 번역이 없어지면 되돌릴 것도 없다
const WITH_TRANSLATION = ['llmt_before'];
// 옛 번역기가 번역마다 함께 적던 칸. 번역을 새로 붙이거나 지우면 같이 뗀다. 옛 번역기로 돌아갔을 때를 따져 본 까닭:
//   translation_source  '이 원문 해시 · 이 번역 해시'의 기록. 옛 번역기는 둘 다 지금 글과 맞을 때만 믿고, 안 맞으면 스스로 뗀다.
//                       번역이 바뀌면 어차피 안 맞는 기록이라 남겨도 쓰이지 않고 스와이프 사본마다 자리만 차지한다.
//   translation_edited  '이 원문의 번역은 사용자가 직접 고친 것'이라는 표시(원문 해시). 남겨 두면 옛 번역기가 모델이 새로 준 번역을
//                       직접 고친 번역으로 알고 낱말 손질과 다시 번역을 건너뛴다.
//   llmt_spans · original_text_for_translation  옛 번역기도 보는 대로 지우는 예전 기록.
// 새로 적어 주지는 않는다(옛 번역기는 곧 없앨 것이라 그 꼴로 쓰는 코드를 늘리지 않는다). 그래서 옛 번역기로 돌아가면
// 태그가 든 번역의 '번역 고치기'는 제 기록을 못 찾고(옛 번역기의 번역 기억에도 없다), 그 답은 옛 번역기로 다시 번역해야 고칠 수 있다.
const STALE = ['translation_source', 'translation_edited', 'llmt_spans', 'original_text_for_translation'];

/** 메시지와 지금 스와이프 사본의 extra 들 */
export function extras(message) {
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    const copy = message.swipe_info?.[message.swipe_id ?? 0];
    const out = [message.extra];
    if (copy && typeof copy === 'object') {
        if (!copy.extra || typeof copy.extra !== 'object') copy.extra = {};
        out.push(copy.extra);
    }
    return out;
}

/** 지금 상태: 'none' 번역 없음 · 'shown' 번역이 보임 · 'original' 원문이 보임 */
export function viewOf(message) {
    const extra = message?.extra;
    if (typeof extra?.display_text !== 'string' || !extra.display_text) return 'none';
    return typeof extra.original_translation_backup === 'string' ? 'original' : 'shown';
}

/** 붙은 번역문(원문을 보는 중이면 치워 둔 번역문). 없으면 '' */
export function translationOf(message) {
    const extra = message?.extra;
    if (typeof extra?.original_translation_backup === 'string') return extra.original_translation_backup;
    return typeof extra?.display_text === 'string' ? extra.display_text : '';
}

/**
 * 번역을 붙인다.
 * @param {object} message
 * @param {{ text: string, pairs?: object | null, hash: string }} t hash: 번역한 원문의 해시(getStringHash)
 */
export function attach(message, { text, pairs = null, hash }) {
    for (const extra of extras(message)) {
        for (const key of STALE) delete extra[key];
        delete extra.original_translation_backup;
        extra.display_text = text;
        extra.original_text_hash = hash;
        if (pairs) extra.llmt_pairs = pairs; else delete extra.llmt_pairs;
    }
}

/**
 * 지금 보이지 않는 스와이프의 사본(swipe_info[swipe].extra)에만 번역을 적는다. 메시지의 extra 와 화면은 건드리지 않는다
 * (지금 보이는 것은 다른 스와이프다). 그 스와이프로 돌아오면 실리태번이 사본에서 되살려 번역이 보인다.
 * @returns {boolean} 적었나(그 스와이프의 사본이 없으면 적지 않는다)
 */
export function attachToSwipe(message, swipe, { text, pairs = null, hash }) {
    const copy = message.swipe_info?.[swipe];
    if (!copy || typeof copy !== 'object') return false;
    const extra = copy.extra && typeof copy.extra === 'object' ? copy.extra : (copy.extra = {});
    for (const key of STALE) delete extra[key];
    delete extra.original_translation_backup;
    extra.display_text = text;
    extra.original_text_hash = hash;
    if (pairs) extra.llmt_pairs = pairs; else delete extra.llmt_pairs;
    return true;
}

/** 원문으로 바꾼다: 번역문을 치워 두고 보이는 글을 원문으로. original = 매크로를 푼 원문 */
export function showOriginal(message, original) {
    if (viewOf(message) !== 'shown') return false;
    const text = message.extra.display_text;
    for (const extra of extras(message)) {
        extra.original_translation_backup = text;
        extra.display_text = original;
    }
    return true;
}

/** 번역으로 바꾼다: 치워 둔 번역문을 되돌린다 */
export function showTranslation(message) {
    if (viewOf(message) !== 'original') return false;
    const text = message.extra.original_translation_backup;
    for (const extra of extras(message)) {
        extra.display_text = text;
        delete extra.original_translation_backup;
    }
    return true;
}

/** 번역을 지운다 */
export function detach(message) {
    for (const extra of extras(message)) for (const key of [...FIELDS, ...WITH_TRANSLATION, ...STALE]) delete extra[key];
}
