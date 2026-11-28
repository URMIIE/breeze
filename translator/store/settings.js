// 번역 설정 읽기. 옛 번역 확장의 설정 칸에서 읽기만 한다(쓰지 않는다).
// 프롬프트는 여기서 읽은 것이 바탕이고, 새 번역기에서 고른 것 · 언어마다 정한 것 · 고친 글 · 새로 만든 것은 새 자리(store/layers.js 의 모든 채팅)에 적힌다.
// 화면이 부를 프롬프트 함수는 store/prompts.js.

export const SETTINGS_KEY = 'llm-translator-custom';
export const CHAT_PROMPT = 'llm_prompt_chat';

const finite = value => (Number.isFinite(value) ? value : null);
const count = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const strings = list => (Array.isArray(list) ? list.filter(item => typeof item === 'string' && item.trim()) : []);

/** id 로 프롬프트를 찾는다 → { title, text } | null. 'llm_prompt_chat' 은 기본 칸(채팅 번역 프롬프트) */
function promptById(s, id) {
    if (!id) return null;
    if (id === CHAT_PROMPT) return s.llm_prompt_chat ? { title: '채팅 번역 프롬프트', text: s.llm_prompt_chat } : null;
    const found = (s.customPrompts || []).find(p => p?.id === id);
    return found?.content?.trim() ? { title: found.title || '', text: found.content } : null;
}

/**
 * 옛 번역 확장의 저장 자리에 있는 프롬프트 목록(읽기만). 맨 앞은 기본 칸(채팅 번역 프롬프트), 그 뒤는 만들어 둔 프롬프트(글이 빈 것은 뺀다).
 * 이 자리는 같은 뿌리의 옛 번역 확장들이 함께 쓰던 칸이라, 그중 어느 것을 쓰던 사람이든 여기서 그대로 읽힌다.
 * source: 'old' 옛 저장 자리에서 읽은 것 | '' 기본 칸인데 옛 자리에 글이 없음
 * @returns {{ id: string, title: string, text: string, source: 'old' | '' }[]}
 */
export function promptsOf(extensionSettings) {
    const s = extensionSettings?.[SETTINGS_KEY] ?? {};
    const own = (s.customPrompts || []).filter(p => p?.id && p.content?.trim()).map(p => ({ id: String(p.id), title: p.title || '', text: p.content, source: 'old' }));
    const chat = String(s.llm_prompt_chat ?? '');
    return [{ id: CHAT_PROMPT, title: '채팅 번역 프롬프트', text: chat, source: chat ? 'old' : '' }, ...own];
}

/**
 * 옛 저장 자리에서 골라 둔 것(읽기만, id 가 가리키는 프롬프트가 있는지는 보지 않는다).
 * @returns {{ byLanguage: Record<string, string>, selected: string }} byLanguage: 원문 언어 → 프롬프트 id, selected: 골라 둔 프롬프트 id('' = 없음)
 */
export function oldPicks(extensionSettings) {
    const s = extensionSettings?.[SETTINGS_KEY] ?? {};
    const byLanguage = s.prompt_by_language && typeof s.prompt_by_language === 'object' ? s.prompt_by_language : {};
    return { byLanguage, selected: String(s.selected_translation_prompt_id ?? '') };
}

/** 이 언어에 옛 설정이 고른 프롬프트 id: 언어마다 정해 둔 것 → 골라 둔 것 → 기본 칸(옛 자리만 본다. 새 자리까지 본 값은 store/prompts.js) */
export function promptIdFor(extensionSettings, lang) {
    const s = extensionSettings?.[SETTINGS_KEY] ?? {};
    for (const id of [s.prompt_by_language?.[lang], s.selected_translation_prompt_id]) if (promptById(s, id)) return String(id);
    return CHAT_PROMPT;
}

/**
 * 이 언어의 답에 쓸 프롬프트: 언어마다 정해 둔 것 → 골라 둔 것 → 채팅 번역 프롬프트.
 * @param {'en' | 'zh' | 'ja'} lang
 */
function promptFor(s, lang) {
    return promptById(s, s.prompt_by_language?.[lang])
        || promptById(s, s.selected_translation_prompt_id)
        || { title: '채팅 번역 프롬프트', text: String(s.llm_prompt_chat ?? '') };
}

/**
 * @param {object} extensionSettings 실리태번 extension_settings
 * @returns {{ profileId: string, model: string, temperature: number | null, keepKorean: boolean,
 *   stallFirst: number, stallIdle: number, stallRetries: number, reasoning: string, userRules: string[], charRules: Record<string, string[]>, prompt: (lang: string) => { title: string, text: string } }}
 *   최대 토큰 칸은 읽지 않는다(요청마다 보내는 글에 맞춰 정한다: send/room.js). stallFirst · stallIdle 초, 0 이면 그 시계를 걸지 않음. reasoning '' = 프로필의 값 그대로
 */
// 멈춤으로 다시 보내는 횟수의 위쪽 한도. 다시 보낼 때마다 요청이 하나 더 나가므로(값을 잘못 적어 수십 번 나가지 않게) 막아 둔다
const STALL_RETRIES_MAX = 5;

export function readSettings(extensionSettings) {
    const s = extensionSettings?.[SETTINGS_KEY] ?? {};
    return {
        profileId: String(s.connection_profile_id || ''),
        model: String(s.profile_model || '').trim(),
        temperature: finite(parseFloat(s.profile_temperature)),
        keepKorean: s.keep_korean_source !== false,
        // 첫 글을 기다리는 한도(초). 기본은 걸지 않는다(0): 생각을 흘려 주지 않는 모델은 긴 답 앞에서 오래 조용한데,
        //   그것과 멈춘 서버를 가를 길이 없고 얼마나 조용한지 재 둔 값도 없다. 옛 번역기의 프로필 길도 글이 온 뒤에만 시계를 걸었다.
        //   멈춘 요청은 진행 표시의 멈추기로 끊는다
        stallFirst: count(s.stall_first, 0),
        stallIdle: count(s.stall_idle, 30),
        stallRetries: Math.min(STALL_RETRIES_MAX, count(s.stall_retries, 2)),
        // 생각 수준: 고른 적이 없으면 낮게(번역은 생각할 일이 적다. 모델에 맡기면 요청마다 생각 토큰이 0 ~ 12,000 으로 흔들리고 첫 글이 1분 넘게 늦었다, 2026-11-27 잼). '프리셋 그대로'(auto)를 고르면 싣지 않는다
        reasoning: (() => { const r = s.profile_reasoning || 'low'; return r === 'auto' ? '' : String(r); })(),
        userRules: strings(s.user_defined_regexes),
        charRules: s.char_protect && typeof s.char_protect === 'object' ? s.char_protect : {},
        prompt: lang => promptFor(s, lang),
    };
}

/** 번역 결과를 바꾸는 연결 설정의 지문. 번역하는 동안 이것이 바뀌면 멈춘다 */
export function connectionMark(settings) {
    return JSON.stringify([settings.profileId, settings.model, settings.temperature, settings.reasoning]);
}
