// 이중언어 대사 괄호 빼기: 대사 뒤 괄호에 같은 말을 다른 언어로 한 번 더 적는 답(프리셋의 언어 설정으로 그렇게 나오는 채팅)일 때 켠다.
// 켜면 번역 프롬프트에 '그 괄호는 옮기지 말고 빼라'는 규칙 한 덩이를 붙인다. 번역문을 받은 뒤에 깎는 것이 아니라 모델에게 시키는 것이다.
// 프롬프트마다 박아 두지 않고 설정으로 켜는 까닭: 괄호가 붙는 것은 그런 채팅뿐이라, 늘 넣어 두면 다른 채팅의 괄호 글까지 빠진다.
// 저장은 옛 번역 확장과 같은 열쇠: bilingual_paren_omit(기본 꺼짐). 글만 다룬다.

import { SETTINGS_KEY } from '../store/settings.js';

const RULE = "- A dialogue line already written in the target language may be followed by its translation into another language in parentheses, such as \"…\"（…） or \"…\" (…). That parenthetical only restates the line before it: omit it in the output. Do not translate it, and do not add a second paraphrase of the line in parentheses.";
// 프롬프트에 이 규칙이 이미 들어 있는지 알아보는 글(예전에는 프롬프트 글에 직접 들어 있었다)
const ALREADY = 'That parenthetical only restates the line';
const BLOCK = `# Bilingual Dialogue\n${RULE}\n\n`;
// 프롬프트에 원문 자리 제목이 있으면 그 앞에 넣는다(규칙이 원문 뒤로 가지 않게)
const SOURCE_HEADING = '# Text to Translate';

export function bilingualOn(extensionSettings) {
    return extensionSettings?.[SETTINGS_KEY]?.bilingual_paren_omit === true;
}

/**
 * 켜져 있으면 프롬프트 글에 규칙을 붙인다. 꺼져 있거나, 글이 비었거나, 이미 그 규칙이 있으면 그대로.
 * @param {string} prompt 번역 프롬프트 글  @param {object} extensionSettings 실리태번 extension_settings
 */
export function withBilingualRule(prompt, extensionSettings) {
    const text = String(prompt ?? '');
    if (!bilingualOn(extensionSettings) || !text || text.includes(ALREADY)) return text;
    const at = text.lastIndexOf(SOURCE_HEADING);
    return at >= 0 ? text.slice(0, at) + BLOCK + text.slice(at) : `${text}\n\n${BLOCK}`;
}

/** 설정 화면이 부른다: 켜고 끄기 */
export function setBilingual(context, on) {
    const s = (context.extensionSettings[SETTINGS_KEY] ??= {});
    s.bilingual_paren_omit = Boolean(on);
    context.saveSettingsDebounced?.();
}
