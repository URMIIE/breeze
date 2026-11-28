// 띄어쓰기 대신 다른 글자(예: $$)를 쓰게 하는 프리셋의 답 다루기.
//
// 그런 프리셋은 화면 · 프롬프트용 정규식으로 그 글자를 다시 띄어쓰기로 바꾼다. 저장된 글에는 그 글자가 그대로라
// 번역 요청에 수백 개가 같이 가고 번역문에도 남았다. 그래서 보내는 문단과 받은 답에서 같은 정규식으로 띄어쓰기로 바꾼다.
// 고르는 정규식: 그 답을 그리는 정규식 가운데 '찾은 것을 띄어쓰기로만 바꾸는' 것만(다른 프리셋 · 다른 채팅의 같은 글자는 건드리지 않는다).
// 바꾸는 자리는 요청이 나가는 맨 끝이다: 문단을 나누고 기억을 찾는 일은 저장된 원문 그대로 한다(기억의 열쇠가 바뀌지 않는다).
// 실리태번을 모른다: 그 답에 걸리는 정규식 목록을 넘겨받는다.

const AI_OUTPUT = 2;
const BODIES = '[Text to translate]\n';   // core/request.js build 가 보낼 문단들 앞에 두는 줄

/** 찾는 식('/본문/깃발' 꼴이나 맨 글) → 전부 찾는 정규식. 못 읽거나 빈 글 · 띄어쓰기에 맞으면 null */
function finderOf(findRegex) {
    const slashed = /^\/([\s\S]+)\/([a-z]*)$/i.exec(findRegex.trim());
    try {
        const find = new RegExp(slashed ? slashed[1] : findRegex, [...new Set(((slashed ? slashed[2] : '') + 'g').replace(/[dy]/g, ''))].join(''));
        if (find.test('') || find.test(' ')) return null;
        find.lastIndex = 0;
        return find;
    } catch {
        return null;
    }
}

const onlySpaces = script => typeof script.replaceString === 'string' && /^[ \t]+$/.test(script.replaceString);

/**
 * @param {object[]} scripts 그 답에 걸리는 정규식(실리태번 정규식 꼴)
 * @returns {RegExp[]} 띄어쓰기로 바꿀 글의 정규식들
 */
export function spacerRules(scripts) {
    const out = [];
    for (const script of scripts || []) {
        if (!script || script.disabled || !Array.isArray(script.placement) || !script.placement.includes(AI_OUTPUT)) continue;
        if (typeof script.findRegex !== 'string' || script.findRegex.includes('{{') || !onlySpaces(script)) continue;
        const find = finderOf(script.findRegex);
        if (find) out.push(find);
    }
    return out;
}

/** 규칙에 맞은 글을 띄어쓰기 하나로 */
export function spaced(text, rules) {
    return rules.reduce((left, rule) => left.replace(new RegExp(rule.source, rule.flags), ' '), String(text ?? ''));
}

/** 요청 글에서 보낼 문단들만 바꾼다(프롬프트 · 내 규칙 · 앞 대화에 든 같은 글자는 사용자가 적은 그대로 둔다) */
function spacedRequest(prompt, rules) {
    const text = String(prompt ?? ''), at = text.lastIndexOf(BODIES);
    if (at < 0) return text;
    const from = at + BODIES.length;
    return text.slice(0, from) + spaced(text.slice(from), rules);
}

/**
 * 보내기 함수를 싼다: 보낼 문단과 받은 답(받는 중의 글 포함)에서 그 글자를 띄어쓰기로. 규칙이 없으면 넘겨받은 함수 그대로.
 * 보내기의 맨 안쪽(연결로 보내는 함수 바로 바깥)에 감는다: 바깥의 것들(거절 가리기, 받는 중 알림)은 원문 그대로의 문단으로 요청 글을 읽는다.
 * @param {(prompt: string, o: object) => Promise<string>} send  @param {RegExp[]} rules spacerRules 의 값
 */
export function spacedSender(send, rules) {
    if (!rules?.length) return send;
    return async (prompt, o = {}) => {
        const onText = o.onText && (raw => o.onText(spaced(raw, rules)));
        return spaced(await send(spacedRequest(prompt, rules), { ...o, onText }), rules);
    };
}
