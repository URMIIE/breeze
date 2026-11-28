// 그림 표시만 바뀐 글 다루기. 글만 다룬다.
// 그림 생성 확장은 답이 끝난 뒤 그림 요청 태그를 그림 태그로 바꾼다. 번역하는 동안 그 일이 일어나도 이야기 글은 그대로라
// 번역을 멈출 까닭이 없다. 그림 태그는 번역에 보내지 않고 원문 그대로 번역문에 남으므로(rules/hold.js), 끝날 때 그 자리만 새 것으로 바꾼다.

const PICTURE = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>|<pic\b(?:[^>"']|"[^"]*"|'[^']*')*>(?:\s*<\/pic>)?|<autopic\b[^>]*>[\s\S]*?<\/autopic\s*>/gi;

const pictures = text => String(text ?? '').match(PICTURE) || [];
const withoutPictures = text => String(text ?? '').replace(PICTURE, '');

/** 두 글이 그림 표시만 다른가(같은 글이면 false) */
export function picturesOnly(before, after) {
    return before !== after && withoutPictures(before) === withoutPictures(after);
}

/**
 * 번역문 속 옛 그림 표시를 새 것으로 차례대로 바꾼다. 개수가 다르거나 번역문에서 못 찾으면 null(부르는 쪽이 멈춘다).
 * @returns {string | null}
 */
export function swapPictures(translation, before, after) {
    const olds = pictures(before), news = pictures(after);
    if (olds.length !== news.length) return null;
    let out = String(translation ?? ''), from = 0;
    for (let i = 0; i < olds.length; i++) {
        const at = out.indexOf(olds[i], from);
        if (at < 0) return null;
        out = out.slice(0, at) + news[i] + out.slice(at + olds[i].length);
        from = at + news[i].length;
    }
    return out;
}
