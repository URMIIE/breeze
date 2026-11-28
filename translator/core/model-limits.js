// 모델 이름으로 알 수 있는 요청 값의 제한: 온도와 프리필(맨 끝에 붙이는 AI 의 말).
// 이름 앞에 다른 글이 붙은 모델 이름(연결 쪽이 붙인 머리)도 맞춘다. 목록에 없는 모델은 제한이 없는 것으로 본다.
//
// 온도
//   ignored   보내도 쓰지 않는다: Gemini 3.6 부터와 4(구글 문서)
//   rejected  보내면 요청을 거절한다: Claude Opus 4.7 부터 · Sonnet 5 부터 · Haiku 5.5 · Fable · Mythos(Anthropic 문서),
//             GPT-5 계열과 o 계열(1 이 아닌 값을 거절한다는 개발자 게시판 글. 공식 문서로는 확인하지 못했다)
// 프리필
//   changed   연결 쪽에서 그 말을 사용자 말로 바꾸거나 뒤에 사용자 말을 붙여 보내므로 '이어 쓰는 시작 글'로는 먹지 않는다: Gemini 3.6 Flash 부터 · 3.5 Flash-Lite · 4
//             (구글 발표 'What\'s new in Gemini 3.6 Flash and 3.5 Flash-Lite': 맨 끝이 모델의 말이면 400)
//   rejected  맨 끝이 AI 의 말인 요청을 거절한다: Claude Opus 4.6 부터 · Sonnet 4.6 부터 · Haiku 5.5 · Fable · Mythos(Anthropic 문서)

const GEMINI_NO_TEMPERATURE = /gemini-(?:4[-.]|3\.[6-9](?!\d))/i;
const GEMINI_NO_PREFILL = /gemini-(?:4[-.]|3\.[6-9](?!\d)|3\.5-flash-lite)/i;
const CLAUDE_NO_TEMPERATURE = /claude-(?:(?:fable|mythos)-|opus-(?:5|4[-.][78])|sonnet-5|haiku-5)/i;
const CLAUDE_NO_PREFILL = /claude-(?:(?:fable|mythos)-|opus-(?:5|4[-.][678])|sonnet-(?:5|4[-.]6)|haiku-5)/i;
const OPENAI_FIXED_TEMPERATURE = /(?:^|[^a-z0-9])(?:gpt-5|o[134](?:-|$))/i;

/**
 * @param {string} model 요청에 실릴 모델 이름
 * @returns {{ temperature: '' | 'ignored' | 'rejected', prefill: '' | 'changed' | 'rejected' }}
 */
export function limitsOf(model) {
    const name = String(model ?? '');
    const temperature = CLAUDE_NO_TEMPERATURE.test(name) || OPENAI_FIXED_TEMPERATURE.test(name) ? 'rejected' : GEMINI_NO_TEMPERATURE.test(name) ? 'ignored' : '';
    const prefill = CLAUDE_NO_PREFILL.test(name) ? 'rejected' : GEMINI_NO_PREFILL.test(name) ? 'changed' : '';
    return { temperature, prefill };
}
