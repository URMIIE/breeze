// 사용자가 골라 둔 화면용 정규식을 '번역에 보내지 않고 제자리에 원문 그대로 둘 글'의 규칙(rules/hold.js 가 모으는 꼴)으로 바꾼다.
//
// 고른 목록은 설정 extension_settings.llmt 에 정규식의 열쇠(id, 없으면 이름, 없으면 찾을 글)로 적혀 있다:
//   keepScripts   원문으로 볼 정규식. 그 정규식이 그리는 블록은 번역된 답에서도 원문으로 보인다
//   wholeScripts  통째로 가릴 정규식. 블록 안 글을 번역했더니 정규식이 찾는 꼴에서 벗어나 칸이 덜 그려졌던 것
// 둘 다 새 번역기에서는 같은 일이 된다: 그 블록을 보내지 않으면 번역문의 그 자리에 원문 블록이 그대로 남고,
// 화면용 정규식이 원문일 때와 똑같이 그린다. 요청에 싣지 않으니 토큰도 들지 않는다.
//
// 처음 맞은 것 하나만 바꾸는 정규식(g 없음)은 화면에서도 첫 블록만 그린다. 규칙을 정규식 그대로 주면 뒤의 같은 꼴까지 원문으로 남으므로,
// 그 답의 글에서 첫 블록을 찾아 그 글자 그대로를 규칙으로 준다.
// 실리태번을 모른다: 설정과 그 답에 걸리는 정규식 목록, 답의 글을 넘겨받는다.

const AI_OUTPUT = 2;   // 실리태번 정규식의 placement 값: AI 답에 쓰는 정규식
const SETTINGS_KEY = 'llmt';

/** 정규식 한 줄의 열쇠(설정에 적힌 것과 견준다) */
export const scriptKey = script => script?.id || script?.scriptName || script?.findRegex || '';

const strings = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : []);

/** 설정에서 고른 정규식의 열쇠들. @returns {{ keep: string[], whole: string[] }} */
export function keptKeys(extensionSettings) {
    const own = extensionSettings?.[SETTINGS_KEY] ?? {};
    return { keep: strings(own.keepScripts), whole: strings(own.wholeScripts) };
}

/** AI 답의 화면을 바꾸는 정규식인가(꺼진 것, 보낼 때만 쓰는 것, 매크로가 들어 글마다 달라지는 것은 뺀다) */
function onScreen(script) {
    return Boolean(script) && !script.disabled && (!script.promptOnly || Boolean(script.markdownOnly))
        && typeof script.findRegex === 'string' && Boolean(script.findRegex.trim()) && !script.findRegex.includes('{{')
        && Array.isArray(script.placement) && script.placement.includes(AI_OUTPUT);
}

/** 찾을 글('/본문/깃발' 꼴이나 맨 글) → 전부 찾는 정규식과, 원래 처음 것만 바꾸는지. 못 읽거나 빈 글에 맞으면 null */
function finderOf(findRegex) {
    const raw = findRegex.trim(), slashed = /^\/([\s\S]+)\/([a-z]*)$/i.exec(raw), flags = slashed ? slashed[2] : '';
    try {
        const find = new RegExp(slashed ? slashed[1] : raw, [...new Set(flags.replace(/[dy]/g, '') + 'g')].join(''));
        return find.test('') ? null : { find, firstOnly: !flags.includes('g') };
    } catch {
        return null;
    }
}

const literal = text => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

/** 처음 맞은 블록의 글자 그대로를 찾는 규칙. 이 글에 그 블록이 없으면 null */
function firstBlock(find, text) {
    find.lastIndex = 0;
    const hit = find.exec(text);
    return hit?.[0].trim() ? literal(hit[0]) : null;
}

/**
 * 그 답의 깊이에서 도는 정규식인가. 실리태번이 화면을 그릴 때 보는 것과 같다(regex/engine.js):
 * minDepth 는 -1 이상일 때, maxDepth 는 0 이상일 때만 따지고, 깊이를 모르면(숫자가 아니면) 따지지 않는다.
 */
function atDepth(script, depth) {
    if (typeof depth !== 'number') return true;
    const { minDepth, maxDepth } = script;
    if (minDepth !== null && !isNaN(minDepth) && minDepth >= -1 && depth < minDepth) return false;
    return !(maxDepth !== null && !isNaN(maxDepth) && maxDepth >= 0 && depth > maxDepth);
}

/**
 * 그 답의 화면에서 글을 지우기만 하는 정규식인가: 화면을 그릴 때 돌고(markdownOnly), 그 답의 깊이에 걸리고, 바꿀 글이 비어 있다.
 * 두 표시가 다 꺼진 정규식은 답을 받을 때 원문을 바꾸고 화면을 그릴 때는 돌지 않는다: 그런 정규식에 맞는 글은 화면에 보이므로 번역에 보낸다.
 */
const erases = (script, depth) => Boolean(script.markdownOnly) && atDepth(script, depth) && !String(script.replaceString ?? '').trim();

/**
 * @param {object} extensionSettings 실리태번 extension_settings
 * @param {object[]} scripts 그 답에 걸리는 화면용 정규식(실리태번 정규식 꼴)
 * @param {string} [text] 그 답의 원문(매크로를 푼 글). 처음 것만 바꾸는 정규식의 첫 블록을 찾는 데 쓴다
 * @param {number} [depth] 그 답의 깊이(맨 끝 메시지가 0, 시스템 메시지는 세지 않는다: 실리태번 messageFormatting 과 같은 셈).
 *   화면에서 지우는 정규식의 깊이 조건을 보는 데 쓴다. 안 주면 깊이 조건을 보지 않는다
 * @returns {RegExp[]} 새 정규식들(lastIndex 를 나눠 쓰지 않게 매번 새로)
 */
export function keptRules(extensionSettings, scripts, text = '', depth = undefined) {
    const { keep, whole } = keptKeys(extensionSettings), picked = new Set([...keep, ...whole]), out = [], source = String(text ?? '');
    for (const script of scripts || []) {
        if (!onScreen(script)) continue;
        const made = finderOf(script.findRegex);
        if (!made) continue;
        if (!picked.has(scriptKey(script))) {
            if (erases(script, depth)) out.push(...erasedBlocks(made, source));
            continue;
        }
        const rule = made.firstOnly ? firstBlock(made.find, source) : made.find;
        if (rule) { rule.lastIndex = 0; out.push(rule); }
    }
    return out;
}

/**
 * 화면에서 지워지는 글 가운데 줄을 통째로 차지하는 블록(생각, 작업 기록 같은 것)을 그 글자 그대로의 규칙으로 준다.
 * 화면에 안 보이는 글이라 번역에 보내지 않는다: 보냈더니 모델이 그대로 돌려줘 원문이 남은 문단으로 잡혔고 토큰도 들었다.
 * 줄 안의 기호만 지우는 정규식의 맞은 글은 주지 않는다(그것까지 빼 두면 문장이 자리표로 잘게 쪼개진다).
 * 줄을 차지하는지는 맞은 글의 앞뒤 빈칸과 줄바꿈을 걷어 낸 알맹이로 본다: 정규식이 블록 뒤의 줄바꿈까지 먹거나 앞 줄바꿈부터 맞으면
 * 맞은 글의 끝이 다음 줄 머리에 놓여, 맞은 글 그대로 보면 줄 가운데에서 끝난 것으로 보였다. 규칙도 알맹이만 준다(문단 사이의 빈 줄은 남긴다).
 */
function erasedBlocks(made, text) {
    const out = [];
    made.find.lastIndex = 0;
    for (const hit of text.matchAll(made.find)) {
        const core = hit[0].trim();
        const from = hit.index + hit[0].indexOf(core), to = from + core.length;
        if (core && lineEdge(text.slice(0, from), true) && lineEdge(text.slice(to), false)) out.push(literal(core));
        if (made.firstOnly) break;
    }
    return out;
}

/** 맞은 글의 앞(before) 또는 뒤가 줄의 끝인가: 같은 줄에 빈칸 말고 다른 글자가 없다 */
function lineEdge(rest, before) {
    const line = before ? rest.slice(rest.lastIndexOf('\n') + 1) : rest.slice(0, (rest.indexOf('\n') + 1 || rest.length + 1) - 1);
    return !line.trim();
}
