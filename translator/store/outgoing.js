// 내 글을 다른 언어로 옮기는 두 기능의 설정: 보낼 때 번역해 보내기, 입력창에 쓴 글을 그 자리에서 번역하기.
// 옛 번역 확장의 설정 칸의 열쇠를 그대로 읽고 쓴다(저장 꼴을 바꾸지 않는다):
// 그 확장이나 같은 뿌리의 확장을 쓰던 사람의 값이 손대지 않아도 그대로 먹는다.
//
// 켜고 끄는 값(send_translate)은 옛 확장에서 채팅마다 · 캐릭터마다 따로 둘 수 있었다. 그 값도 읽는다:
//   이 채팅   chat_metadata.llmt_chat = { scoped, groups, values }   groups 에 'send' 가 있을 때(groups 가 없으면 전부)
//   이 캐릭터 char_scopes[아바타 파일 이름] = 같은 꼴(그룹 채팅에는 없다)
//   모든 채팅 llmt_common_values.send_translate(옛 확장이 전용 값을 설정에 덮어 둔 동안 치워 둔 공통 값) → send_translate
// 바꿀 때는 지금 값이 나온 그 자리에 적는다.

import { SETTINGS_KEY } from './settings.js';
import { mark } from './pairs.js';

// 보내는 글 번역의 기본 글. 자리 이름 {{languageRules}} · [Reference] 는 코드가 채우는 이름이다(job/outgoing.js sendMethod, job/outgoing-reference.js)
export const SEND_PROMPT_DEFAULT = `Put the message under [Text to translate] into the language set below. It is one side of a roleplay chat.
{{languageRules}}
Say what the writer says, the way they say it: casual stays casual, polite stays polite. Leave quotation marks, *asterisks*, markdown, line breaks and emoji where they are.
[Reference], when present, only shows how this chat writes names, terms and speech. Do not translate it.`;

// 손대지 않은 옛 기본 글의 지문(store/pairs.js mark: 길이 + 해시). 저장된 글이 이것이면 사용자가 고친 글이 아니라 지금 기본 글로 읽는다.
//   옛 기본 글 둘(언어 규칙 자리가 있는 것 · 언어 하나만 적던 처음 것). 글 자체는 두지 않는다
const OLD_DEFAULTS = new Set(['362:1t8wn1x', '364:1w4i4u7']);


const DISPLAYS = [
    { value: 'original', label: '내가 쓴 글' },
    { value: 'sent', label: '번역해서 보낸 글' },
];

/**
 * 설정 칸의 목록. 화면은 이것으로 칸을 그리고 getOutgoing · setOutgoing 으로 읽고 쓴다.
 * key: 화면이 쓰는 이름, old: 저장 열쇠, kind: 'switch' | 'text' | 'pick' | 'prompt', fallback: 저장된 값이 없을 때의 값
 */
export const OUTGOING_FIELDS = [
    { key: 'on', old: 'send_translate', kind: 'switch', fallback: false, label: '내 글도 번역해서 보내기', hint: '보내기를 누르면 내 글을 아래 언어로 옮겨서 보내요.' },
    { key: 'lang', old: 'send_target_language', kind: 'text', fallback: 'English', label: '옮길 언어', hint: '영어 이름으로 적어요. 예: English, Japanese' },
    { key: 'dialogueLang', old: 'send_dialogue_language', kind: 'text', fallback: '', label: '대사만 다른 언어로', hint: '따옴표 안의 대사를 옮길 언어예요. 비우면 위 언어와 같아요.' },
    { key: 'display', old: 'send_display', kind: 'pick', fallback: 'original', options: DISPLAYS, label: '내 화면에 보일 글', hint: '' },
    { key: 'refChar', old: 'send_ctx_char', kind: 'switch', fallback: true, label: '캐릭터 설정 같이 보내기', hint: '이름과 말투를 맞추는 데만 쓰여요. 같이 보낼수록 요청이 길어져요.' },
    { key: 'refPersona', old: 'send_ctx_persona', kind: 'switch', fallback: false, label: '페르소나 같이 보내기', hint: '' },
    { key: 'refWorld', old: 'send_ctx_wi', kind: 'switch', fallback: false, label: '월드인포 같이 보내기', hint: '' },
    { key: 'refNote', old: 'send_ctx_note', kind: 'switch', fallback: false, label: '작가 노트 같이 보내기', hint: '' },
    { key: 'refRecent', old: 'send_ctx_history', kind: 'switch', fallback: false, label: '최근 대화 같이 보내기', hint: '' },
    { key: 'prompt', old: 'llm_prompt_send', kind: 'prompt', fallback: SEND_PROMPT_DEFAULT, label: '보내는 글 번역 프롬프트', hint: '{{languageRules}} 자리에 위에서 고른 언어 규칙이 들어가요.' },
    { key: 'showButton', old: 'show_input_translate_button', kind: 'switch', fallback: false, label: '입력창 옆에 번역 버튼 보이기', hint: '누르면 내 글 번역을 켜고 꺼요. 길게 누르면 입력창에 쓴 글을 바로 번역해요.' },
];

const FIELD = Object.fromEntries(OUTGOING_FIELDS.map(field => [field.key, field]));
const listeners = new Set();

const oldBox = context => (context.extensionSettings[SETTINGS_KEY] ??= {});
const avatarOf = context => (context.groupId ? '' : context.characters?.[context.characterId]?.avatar || '');

/** 그 전용 설정이 켜고 끄는 값을 맡고 있나 */
function ownsSwitch(scope) {
    if (!scope?.scoped || !scope.values || typeof scope.values.send_translate !== 'boolean') return false;
    return !Array.isArray(scope.groups) || scope.groups.includes('send');
}

/** 켜고 끄는 값이 지금 나오는 자리 → { place: 'chat' | 'card' | 'all', box: 그 값이 든 객체 } */
function switchPlace(context) {
    const chat = context.getCurrentChatId?.() ? context.chatMetadata?.llmt_chat : null;
    if (ownsSwitch(chat)) return { place: 'chat', box: chat.values };
    const card = oldBox(context).char_scopes?.[avatarOf(context)];
    if (ownsSwitch(card)) return { place: 'card', box: card.values };
    const kept = oldBox(context).llmt_common_values;
    return { place: 'all', box: kept && 'send_translate' in kept ? kept : oldBox(context) };
}

function readField(context, field) {
    if (field.key === 'on') return switchPlace(context).box.send_translate === true;
    const value = oldBox(context)[field.old];
    if (field.kind === 'switch') return typeof value === 'boolean' ? value : field.fallback;
    const text = String(value ?? '').trim();
    if (field.key === 'prompt') return text && !OLD_DEFAULTS.has(mark(text)) ? String(value) : field.fallback;
    if (field.kind === 'prompt') return text ? String(value) : field.fallback;
    if (field.kind === 'pick') return field.options.some(option => option.value === text) ? text : field.fallback;
    return text || field.fallback;
}

/** 지금 값 하나 */
export function getOutgoing(context, key) {
    return readField(context, FIELD[key]);
}

/** 지금 값 전부 → { on, lang, dialogueLang, display, refChar, …, where } where: 켜고 끄는 값이 나온 자리 */
export function readOutgoing(context) {
    const out = Object.fromEntries(OUTGOING_FIELDS.map(field => [field.key, readField(context, field)]));
    // 대사 언어가 옮길 언어와 같으면 따로 정하지 않은 것이다
    if (out.dialogueLang.toLowerCase() === out.lang.toLowerCase()) out.dialogueLang = '';
    out.where = switchPlace(context).place;
    return out;
}

function writeSwitch(context, value) {
    const { place, box } = switchPlace(context);
    box.send_translate = value;
    // 공통 값을 치워 둔 칸에 적었으면 설정의 값도 같이 맞춘다(같은 뿌리의 다른 확장은 그쪽을 읽는다)
    if (place === 'all') oldBox(context).send_translate = value;
    if (place === 'chat') context.saveMetadata?.(); else context.saveSettingsDebounced?.();
}

/**
 * 값을 바꾸고 저장한다. 바뀐 것을 듣는 쪽(입력창 버튼)에 알린다.
 * @param {object} context 실리태번 getContext()  @param {string} key OUTGOING_FIELDS 의 key  @param {boolean | string} value
 */
export function setOutgoing(context, key, value) {
    const field = FIELD[key];
    if (key === 'on') writeSwitch(context, value === true);
    else {
        oldBox(context)[field.old] = field.kind === 'switch' ? value === true : field.kind === 'prompt' ? String(value ?? '') : String(value ?? '').trim();
        context.saveSettingsDebounced?.();
    }
    for (const fn of listeners) fn(key);
}

/** 값이 바뀔 때마다 부른다. @returns {() => void} 듣기를 그만두는 함수 */
export function onOutgoingChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** 화면에 보일 언어 이름: 'English' 또는 'English, 대사는 Japanese' */
export const languageLabel = s => (s.dialogueLang ? `${s.lang}, 대사는 ${s.dialogueLang}` : s.lang);
