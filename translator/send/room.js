// 요청에 싣는 최대 출력 토큰. 사용자가 적는 칸이 아니라 번역할 글에 맞춰 번역기가 정한다: 짧은 글이면 작게, 긴 글이면 크게, 모델의 한도 안에서.
// (2026-11-26 사용자 결정) 번역은 나눠 보내지 않는다. 최대 출력 토큰은 내용에 맞춰 알아서 늘리고 줄이되 모델 한도를 넘는 값은 싣지 않는다.
// 필요한 자리가 모델 한도보다 크면(정말 긴 답) 한도만큼 싣는다. 답이 끊기면 받은 데까지만 쓴다(저절로 이어 받지 않는다).
// 주 채팅 연결의 최대 응답 길이나 옛 설정의 최대 토큰 칸 같은 고정 숫자는 싣지 않는다: 번역할 글과 상관없는 값이다.

import { sentBodies, markOf } from '../core/request.js';
import { sourceLanguage } from '../core/lang.js';

// 번역문 글자 수 / 원문 글자 수의 위쪽 값(95%). core/request.js 의 GROWTH 와 같은 값이다(이미 번역된 답 1,645개에서 잰 것.
// 그 파일은 값을 내주지 않고 고치지 않는 파일이라 여기 옮겨 적는다)
const GROWTH = { en: 0.6, zh: 1.5, ja: 1.3, ko: 2.8 };
// 번역문 글자 수 / 출력 토큰 수. 번역 요청 셋의 사용량으로 잰 값(gemini-3.8-flash):
//   7,945자에 5,210토큰(1.52), 9,710자에 6,388토큰(1.52), 3,630자에 2,463토큰(1.47). 가장 낮은 값보다 조금 아래로 잡는다.
//   다른 모델은 재지 못했다. 모자라면 아래 '끊겼을 때 늘리기'가 그 모델 · 언어의 자리를 늘린다
const CHARS_PER_TOKEN = 1.45;
// 여유. 늘어나는 비가 이미 95% 값이라 대부분의 답은 그 안에 들고, 답에 붙는 문단 표시와 말한 사람 글자 몫으로 1.3배를 둔다
const MARGIN = 1.3;
// 생각하는 모델은 생각도 이 자리에서 쓴다. 처음 실측(위 셋)에서는 생각 토큰이 0, 0, 7,289, 1,557 이라 8,192 를 두었는데,
//   2026-11-27 같은 모델(생각 수준 low) 번역 요청 27번에서 생각 토큰이 가장 많게 20,493 이었고, 우리 요청 8번 가운데 2번이
//   (출력 + 생각)이 이 자리를 넘어 출력 한도로 끊겼다(18,895 · 17,941: 뒤 문단 · 상태창 글이 안 옴, out/t2-vs-others-ours-080707).
//   가장 큰 값보다 조금 위로 둔다. 실어 보내는 값은 상한일 뿐이라 쓴 만큼만 든다.
//   생각 수준을 '최소'로 내리면 거절하는 모델이 있어 번역기가 생각을 끄지는 않는다
//   위 값들은 custom 연결에서 생각 수준이 모델에 닿지 않던 때(모델 기본 생각) 잰 것이다. 닿게 고친 뒤(send/profile.js) low 에서는
//   번역 요청 12번 모두 생각 0 이었다(out/t2-thinking-190453). 상한일 뿐이라 값은 그대로 둔다
const THINKING_ROOM = 24576;
// 답이 끊겼을 때 그 모델 · 언어의 자리를 늘리는 배수와 위쪽 끝(끝없이 늘지 않게)
const GROW_ON_CUT = 1.5, BOOST_MAX = 4;

// 모델이 낼 수 있는 출력 토큰. 공식 문서에서 확인한 것만 적는다(모르는 모델은 넣지 않는다: 거절 오류에서 배운다)
const CAPS = [
    // https://aistudio.google.com/docs/models/gemini-3.8-flash (2026-11-26 확인): 출력 65,536
    [/^gemini-3\.8-flash$/, 65536],
];

const LEARNED_KEY = 'breeze.translator.outputRoom';
const store = () => globalThis.localStorage ?? null;
const learned = () => { try { return JSON.parse(store()?.getItem(LEARNED_KEY) ?? '{}') || {}; } catch { return {}; } };
const learn = (key, value) => { try { store()?.setItem(LEARNED_KEY, JSON.stringify({ ...learned(), [key]: value })); return true; } catch { return false; } };
const nameOf = model => String(model ?? '').trim();
const boostKey = (model, lang) => `${nameOf(model)}|${lang}`;
const capKey = model => `${nameOf(model)}|cap`;
const boostOf = (model, lang) => Math.min(BOOST_MAX, Math.max(1, Number(learned()[boostKey(model, lang)]) || 1));

/** 그 모델의 출력 한도: 거절 오류에서 배운 값 → 표 → 모르면 0(한도 없이 계산한 값을 싣는다) */
export function capOf(model) {
    const known = Number(learned()[capKey(model)]) || 0;
    return known || CAPS.find(([pattern]) => pattern.test(nameOf(model)))?.[1] || 0;
}

/** 글자의 절반 넘게 한글인가. 언어를 가리는 쪽(core/lang.js)은 한국어를 내지 않아, 한국어 글을 다른 말로 옮기는 요청을 따로 알아본다 */
function mostlyKorean(text) {
    const letters = text.match(/\p{L}/gu) ?? [];
    const hangul = letters.filter(letter => /\p{Script=Hangul}/u.test(letter)).length;
    return hangul > 0 && hangul * 2 > letters.length;
}

/** 요청 글에서 보낸 조각과 그 언어 */
function sentOf(prompt) {
    const bodies = sentBodies(prompt);
    const source = bodies.length ? bodies.join('\n') : String(prompt ?? '');
    return { count: bodies.length, source, lang: mostlyKorean(source) ? 'ko' : sourceLanguage(source) };
}

/**
 * 이 요청에 실을 최대 출력 토큰: 보낸 글자 수 × 언어별 늘어나는 비 × 여유(끊긴 적이 있는 모델 · 언어는 더 넉넉히)를 토큰으로 바꾸고
 * 생각 몫을 더한 값. 그 모델의 한도를 알면 그보다 크게 싣지 않는다.
 * @param {string} prompt 요청 글(core/request.js build 의 것)  @param {string} [model] 번역에 쓰는 모델 이름
 */
export function outputRoom(prompt, model = '') {
    const { source, lang } = sentOf(prompt);
    const grow = GROWTH[lang] ?? GROWTH.zh;
    const need = Math.ceil(source.length * grow * MARGIN * boostOf(model, lang) / CHARS_PER_TOKEN) + THINKING_ROOM;
    const cap = capOf(model);
    return cap ? Math.min(cap, need) : need;
}

/**
 * 요청이 '최대 토큰이 너무 크다'로 거절됐으면 오류 글에서 한도를 읽어 그 모델의 한도로 적어 둔다(부르는 쪽이 그 값으로 한 번 다시 보낸다.
 * 거절된 요청은 값이 들지 않았다).
 * @param {string} model  @param {string} errorText  @param {number} sent 실어 보낸 값
 * @returns {number} 배운 한도(못 읽었으면 0)
 */
export function learnCap(model, errorText, sent) {
    const text = String(errorText ?? '');
    if (!/max[_ ]?(?:output[_ ]?|completion[_ ]?)?tokens|maxOutputTokens|maximum (?:output )?tokens/i.test(text)) return 0;
    // 오류 글의 숫자 가운데 보낸 값보다 작은 가장 큰 것이 한도다("… 100000 … at most 16384 …"). '미만'으로 적힌 한도는 하나 뺀다
    const numbers = (text.match(/\d[\d,]*/g) || []).map(n => Number(n.replace(/,/g, ''))).filter(n => n >= 256 && n < sent);
    if (!numbers.length) return 0;
    const cap = Math.max(...numbers) - (/exclusive|less than|미만/i.test(text) ? 1 : 0);
    if (!learn(capKey(model), cap)) return 0;
    console.info(`[번역] ${model} 의 출력 한도를 ${cap} 토큰으로 적어 둬요(요청이 한도를 넘어 거절됨)`);
    return cap;
}

/**
 * 답이 자리가 모자라 끊긴 것 같으면 그 모델 · 언어의 자리를 다음부터 더 넉넉히 잡게 적어 둔다.
 * 엔진이 남은 조각을 한 번 이어 받을 때도 이 값이 쓰여 더 큰 자리로 나간다.
 * 프로필 요청의 답에는 끝난 까닭(길이 한도)과 사용량이 실려 오지 않아 답의 꼴로 안다: 보낸 조각의 마지막 번호가 답에 없고,
 * 답의 길이가 실어 보낸 자리(생각 몫 빼고)의 절반을 넘었을 때. 그보다 훨씬 짧게 끝난 답은 연결이 끊겼거나 모델이 스스로 멈춘 것이라 늘리지 않는다.
 * @param {string} prompt 요청 글  @param {string} model  @param {string} answer 답 글  @param {number} room 실어 보낸 최대 출력 토큰
 * @returns {boolean} 늘려 적었나
 */
export function learnFromCut(prompt, model, answer, room) {
    const { count, lang } = sentOf(prompt), text = String(answer ?? '');
    if (count < 2 || !text.includes(markOf('')) || new RegExp(`^[ \\t]*${markOf(count)}(?!\\d)`, 'm').test(text)) return false;
    if (text.length / CHARS_PER_TOKEN < (room - THINKING_ROOM) / 2) return false;
    const next = Math.min(BOOST_MAX, boostOf(model, lang) * GROW_ON_CUT);
    if (!learn(boostKey(model, lang), next)) return false;
    console.info(`[번역] 답이 끊겨서 ${model} (${lang}) 의 출력 자리를 ${next}배로 늘려 적어요`);
    return true;
}
