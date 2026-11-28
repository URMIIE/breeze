// 번역에 보내지 않고 제자리에 원문 그대로 둘 글의 규칙을 모은다.
//
// 차례: 사용자가 넣은 규칙(모든 채팅 → 이 캐릭터) → 그 답의 화면용 정규식에서 나온 규칙(rules/kept.js 고른 정규식 · 화면에서 지우는 정규식,
// rules/frame.js 틀) → 기본 규칙.
// 엔진(core/split.js)은 규칙에 맞은 구간을 글 앞쪽부터 고르고, 같은 자리에서 시작하면 긴 것을 고른다. 그래서 차례가 결과를 바꾸는 일은
// 같은 자리 · 같은 길이일 때뿐이지만, 그때도 사용자 규칙이 이기도록 앞에 둔다.
//
// 기본 규칙: 실리태번이 생각으로 다루는 글, 이야기 글이 아닌 블록의 태그 이름 목록(NOT_STORY), 그림 · 영상 · 소리, 그림 표시.
// 그 답의 화면용 정규식이 블록을 지우거나 그리면 rules/kept.js · rules/frame.js 가 먼저 가린다. 이름 목록은 정규식이 없거나
// 답을 만든 프리셋의 정규식이 없어진 답을 위한 것이다(정규식에만 맡겼더니 그런 답에서 자료 갱신 · 계획 블록이 번역에 갔다).
// 목록은 답 수천 개에서 이 블록들이 걸린 것을 세어 정했다(정규식이 없는 답에서도 이 목록 전의 규칙과 가리는 구간이 같다).
//
// 넣지 않는 것: 칸 이름(Location:) · 【…】 같은 꼴. 모양만 보고 가리면 이야기 속 목록 · 물건 이름까지 원문으로 남았다.
// 화면용 정규식이 실제로 찾는 칸 이름 · 【…】만 가려야 하고, 그것은 정규식을 읽는 rules/frame.js 가 맡는다.
// 대괄호로 싼 짧은 표시([重要] · [STATEMENT] · [/TAG])는 모양으로 가린다: 정규식 · 화면 코드가 글자 그대로 찾는 표시라 번역되면 못 찾았다.
// HTML 주석 · <script> · <style> 은 엔진이 늘 가리므로 여기 없다.

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const either = names => names.join('|');

/**
 * 화면에 보이는 이야기 글이 아닌 블록의 태그 이름과 그 꼴.
 *   thought      생각. 여는 태그 ~ 닫는 태그 통째, 그리고 여는 태그를 빼먹고 답 맨 앞부터 닫는 태그까지 쓴 꼴
 *   plan         장면 계획. 여는 태그 ~ 닫는 태그 통째
 *   data         표 · 변수를 고치는 자료 블록과 모델에게 주는 안내 블록. 여는 태그 ~ 닫는 태그 통째
 *   placeholder  화면 코드가 상태창으로 바꿔 끼우는 홀로 쓰인 자리표(<이름/>)
 */
const NOT_STORY = {
    think: 'thought', thinking: 'thought', reasoning: 'thought', ECoT: 'thought',
    scene_plan: 'plan', scene_reasoning: 'plan',
    tableEdit: 'data', UpdateVariable: 'data', disclaimer: 'data', finish: 'data',
    StatusPlaceHolderImpl: 'placeholder',
};
// 본문을 싸는 흔한 태그: 답 머리의 생각은 이 태그가 열리기 전에 끝난다(이것을 넘어 닫는 태그까지 가리면 본문이 빠진다)
const BODY_TAGS = ['content', 'prose'];
const namesOf = (...kinds) => Object.keys(NOT_STORY).filter(name => kinds.includes(NOT_STORY[name]));
// 따옴표 속 '>' 에 끊기지 않는 태그 속성들
const TAG_REST = String.raw`(?:"[^"]*"|'[^']*'|[^'">])*`;
// 여는 태그와 닫는 태그 사이를 통째로: 안의 글은 화면에 글자로 나오지 않는다
const MEDIA_BLOCKS = ['video', 'audio', 'svg', 'iframe', 'picture', 'object', 'canvas', 'autopic'];
// 홀로 쓰이는 태그(바로 뒤에 닫는 태그가 붙어 있으면 그것까지). pic · autopic 은 그림 확장이 그림으로 바꾸는 요청 표시(core/picture.js 가 바꿔 끼운다)
const MEDIA_TAGS = ['img', 'pic', 'source', 'embed', 'video', 'audio', 'iframe'];

/** 이 이름들 가운데 하나로 열고 같은 이름으로 닫는 블록 */
const pairedBlock = names => new RegExp(String.raw`<(${either(names)})\b${TAG_REST}>[\s\S]*?<\/\1\s*>`, 'gi');

/**
 * 여는 표시 없이 닫는 표시만 있는 생각: 답 맨 앞부터 첫 닫는 표시까지. 그 앞에 여는 표시가 있으면 맞지 않는다(위의 짝 규칙이 맡는다).
 * 모델이 여는 표시를 빼먹고 생각부터 쓰는 일이 흔하다.
 */
const headUntil = (open, close) => new RegExp(String.raw`^(?:(?!${open})[\s\S])*?${close}`, 'i');

/** 실리태번 설정의 생각 머리말 · 꼬리말(답에서 생각을 떼어 낼 때 쓰는 것). 떼어 내지 못하고 본문에 남은 생각을 가린다 */
function reasoningRules(context) {
    const { prefix, suffix } = context?.powerUserSettings?.reasoning ?? {};
    const open = String(prefix ?? '').trim(), close = String(suffix ?? '').trim();
    if (!open || !close) return [];
    return [new RegExp(`${escape(open)}[\\s\\S]*?${escape(close)}`, 'g'), headUntil(escape(open), escape(close))];
}

/** 이야기 글이 아닌 블록의 규칙(NOT_STORY 의 꼴마다) */
function notStoryRules() {
    const thought = either(namesOf('thought'));
    return [
        pairedBlock(namesOf('thought', 'plan', 'data')),
        headUntil(String.raw`<\/?(?:${thought}|${either(BODY_TAGS)})\b`, String.raw`<\/(?:${thought})\s*>`),
        new RegExp(String.raw`<(?:${either(namesOf('placeholder'))})\s*\/?>`, 'gi'),
    ];
}

const BASE = [
    ...notStoryRules(),
    // 그림 · 영상 · 소리
    pairedBlock(MEDIA_BLOCKS),
    new RegExp(String.raw`<(${either(MEDIA_TAGS)})\b${TAG_REST}>(?:\s*<\/\1\s*>)?`, 'gi'),
    /!\[[^\]\n]*\]\([^)\s]+\)/g,
    /\{\{img::[^}\r\n]*\}\}/g,
    // 태그 없이 글에 박힌 그림 자료(data: 주소)
    /\bdata:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z\d+/]{16,}={0,2}/gi,
    // 대괄호로 싼 짧은 표시와 기호만 든 태그(<@> · <#>)
    /\[\/?[^\]\s|]{1,10}\]|\[\/?[A-Z][A-Z0-9_]{2,}\]/g,
    /<[^\w\s<>]{1,3}>/g,
];

const literal = text => new RegExp(escape(text), 'gi');
// 정규식으로 읽을 줄: 이스케이프(\) · 반복(* + ? 중괄호) · 갈래(|)가 있거나 ^ 로 시작하거나 $ 로 끝난다
const looksLikeRegex = text => /[\\*+?{|]/.test(text) || text.startsWith('^') || text.endsWith('$');
/** 빈 글에 맞는 규칙은 글 전체를 쪼개므로 버린다 */
const usable = rule => (rule.test('') ? null : (rule.lastIndex = 0, rule));

/**
 * '번역에서 뺄 글' 한 줄을 정규식으로.
 *   /본문/깃발 꼴: 정규식. 깃발을 안 적었으면 gi, 적었으면 거기에 g 를 더한다. 못 읽으면 null
 *   슬래시 없는 줄: 글자 그대로가 먼저다([OOC] 를 정규식으로 읽으면 글자 O · C 를 하나씩 가린다).
 *     정규식 글자가 든 줄만 정규식으로 읽고, 그것도 못 읽으면(**Scene Plan**) 글자 그대로
 */
export function parsePattern(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const slashed = /^\/(.*?)\/([a-z]*)$/.exec(text);
    try {
        if (slashed) return usable(new RegExp(slashed[1], withGlobal(slashed[2] || 'gi')));
        return usable(looksLikeRegex(text) ? new RegExp(text, 'gi') : literal(text));
    } catch {
        return slashed ? null : literal(text);
    }
}

const withGlobal = flags => (flags.includes('g') ? flags : flags + 'g');

/** 캐릭터 전용 규칙 한 줄: 저장 꼴은 { source, flags }(옛 번역 확장의 '찾게 하기'가 적은 것). 글 줄이면 위의 읽는 법으로 */
function parseCharRule(rule) {
    if (typeof rule === 'string') return parsePattern(rule);
    if (!rule || typeof rule.source !== 'string' || !rule.source) return null;
    try {
        return usable(new RegExp(rule.source, withGlobal(String(rule.flags ?? ''))));
    } catch {
        return null;
    }
}

/** 지금 채팅의 캐릭터 열쇠(그룹은 group:id). 캐릭터 전용 규칙을 찾는 데 쓴다 */
export function characterKey(context) {
    if (context?.groupId) return `group:${context.groupId}`;
    return context?.characters?.[context?.characterId]?.avatar || '';
}

/** 사용자가 넣은 규칙: 모든 채팅 것 → 이 캐릭터 것 */
function userRules(settings, context) {
    const own = settings.charRules?.[characterKey(context)];
    const all = (settings.userRules || []).map(parsePattern);
    const mine = (Array.isArray(own) ? own : []).map(parseCharRule);
    return [...all, ...mine].filter(Boolean);
}

/**
 * @param {{ userRules?: string[], charRules?: Record<string, (string | { source: string, flags?: string })[]> }} settings store/settings.js 가 읽은 것
 * @param {object} context 실리태번 getContext()(powerUserSettings.reasoning 의 생각 머리말 · 꼬리말도 읽는다)
 * @param {RegExp[]} [kept] 그 답의 화면용 정규식에서 나온 규칙(rules/kept.js keptRules, rules/frame.js frameRules)
 * @returns {RegExp[]} 새 정규식들(lastIndex 를 나눠 쓰지 않게 매번 새로). 차례: 사용자 규칙 → 정규식에서 나온 규칙 → 기본 규칙
 */
export function holdRules(settings, context, kept = []) {
    const base = [...reasoningRules(context), ...BASE].map(rule => new RegExp(rule.source, rule.flags));
    return [...userRules(settings, context), ...kept, ...base];
}

/** 규칙에 맞은 글을 뺀 글(원문 언어를 가릴 때: 보내지 않는 덩이의 영어 낱말이 중국어 답을 영어로 보이게 했다) */
export function withoutHeld(text, rules) {
    return rules.reduce((left, rule) => left.replace(new RegExp(rule.source, withGlobal(rule.flags)), ' '), String(text ?? ''));
}
