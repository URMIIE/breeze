// 옛 번역기가 저장해 둔 자료로 '쓰는 곳' 하나의 처음 값을 만든다. 읽기만 한다: 옛 자리는 고치지도 지우지도 않는다.
// 새 자리에 아직 아무것도 없을 때 화면과 요청이 이 값을 쓰고, 사용자가 그 쓰는 곳을 처음 고칠 때 이 값을 바탕으로 새 자리에 저장한다.
//
// 옛 자리:
//   모든 채팅  옛 번역 확장의 설정 칸: glossary_entries(scope 'global'), connection_profile_id, translation_display_mode
//   캐릭터     같은 칸의 glossary_entries(scope = 아바타 파일 이름, 그룹은 'group:id'와 참가자들), char_scopes[아바타].values,
//              extension_settings.llmt.char_styles[아바타](말투 한 벌)
//   이 채팅    chat_metadata.llmt_style_profiles_v1(말투), llmt_chat_glossary_v1(용어), llmRulePrompt(규칙 글), llmt_chat.values(채팅 전용 설정)

import { fromOld } from './carry.js';
import { fold } from '../core/find.js';

const OLD_VIEW = {
    disabled: { main: 'tr', when: 'tap' },
    llmt_original: { main: 'src', when: 'tap' },
    llmt_side: { main: 'tr', when: 'every' },
    llmt_side_orig: { main: 'src', when: 'every' },
    llmt_dialogue: { main: 'tr', when: 'said' },
    llmt_hover: { main: 'tr', when: 'bubble' },
    llmt_hover_trans: { main: 'src', when: 'bubble' },
};

const MODES = new Set(['polite', 'casual', 'custom']);
const list = value => (Array.isArray(value) ? value : []);

/** 빈 쓰는 곳 */
export const emptyLayer = () => ({ v: 1, people: [], names: [], rules: [], settings: {}, ignore: [], prompts: {}, promptByLanguage: {} });

/**
 * 옛 연결 · 보기 값 → 새 설정 칸(없는 값은 넣지 않는다).
 * @param {string[] | null} [groups] 전용 설정에서 고른 묶음. 고른 묶음의 값만 읽는다: 고르지 않은 묶음의 값은 전용 설정을 켤 때 같이 적힌 것일 뿐이라
 *   읽으면 그 캐릭터 · 채팅에 고르지도 않은 연결이 먹는다. null 이면 전부(모든 채팅의 값)
 */
function settingsFrom(values, groups = null) {
    const out = {}, picked = name => !groups || groups.includes(name);
    if (picked('model') && values?.connection_profile_id) out.model = String(values.connection_profile_id);
    const view = OLD_VIEW[values?.translation_display_mode];
    if (picked('view') && view) out.view = { ...view };
    return out;
}

const SCOPE_GROUPS = ['view', 'send', 'model', 'prompt'];
/** 켜 둔 전용 설정({ scoped, groups, values })의 값. 묶음 목록이 없는 옛 꼴은 전부 고른 것으로 본다 */
function scopedSettings(scope) {
    if (!scope?.scoped) return {};
    return settingsFrom(scope.values, Array.isArray(scope.groups) ? scope.groups : SCOPE_GROUPS);
}

// 이 채팅에선 캐릭터 용어집을 쓰지 않는다는 표시(chat_metadata). 같은 캐릭터라도 설정이 다른 채팅은 이름 · 호칭 짝이 다르다
const NO_CARD_TERMS = 'llmt_chat_no_char_glossary';
export const skipsCardTerms = meta => meta?.[NO_CARD_TERMS] === true;

/** 캐릭터의 값에서 정해 둔 번역어(이름, 사람의 한글 표기)를 뺀 것. 말투는 남긴다(옛 표시가 끄던 것은 용어집뿐이다) */
export function withoutTerms(layer) {
    return { ...layer, names: [], people: layer.people.map(person => ({ ...person, ko: '' })) };
}

/** 옛 말투 지침 가운데 새 꼴로 읽을 수 있는 것 */
const profilesOf = value => list(value).filter(p => p?.speaker && MODES.has(p.mode) && typeof (p.note ?? '') === 'string');

/** 옛 용어집 항목 → 사람 줄 + 사람이 아닌 이름. 캐릭터 · 페르소나 이름만 있는 사람(표기도 말투도 없음)은 넣지 않는다: 요청 때 늘 더해진다 */
function peopleAndNames({ profiles = [], glossary = [], cast = [] }) {
    const out = fromOld({ profiles, glossary, cast });
    // 한글 이름만 적힌 사람은 그 이름이 표기가 되므로(carry.js) 표기가 이름과 같으면 적은 것이 없는 것으로 본다
    const people = out.people.filter(p => p.style || p.to.length || p.names.length > 1 || (p.ko && !p.names.includes(p.ko)));
    const names = out.terms.map(t => ({ id: fold(t.src), src: t.src, dst: t.dst }));
    return { people, names };
}

function allLayer(old) {
    const glossary = list(old.glossary_entries).filter(e => e?.scope === 'global');
    return { ...emptyLayer(), names: peopleAndNames({ glossary }).names, settings: settingsFrom(old) };
}

function cardLayer(old, styles, owner, cast) {
    const scopes = [owner.key, ...(owner.members || [])];
    const glossary = scopes.flatMap(key => list(old.glossary_entries).filter(e => e?.scope === key));
    const profiles = owner.group ? [] : profilesOf(styles?.char_styles?.[owner.key]);
    const scoped = old.char_scopes?.[owner.key];
    return { ...emptyLayer(), ...peopleAndNames({ profiles, glossary, cast }), settings: scopedSettings(scoped) };
}

function chatLayer(meta, cast) {
    const glossary = list(meta.llmt_chat_glossary_v1).filter(e => e?.src && e?.dst);
    const made = peopleAndNames({ profiles: profilesOf(meta.llmt_style_profiles_v1), glossary, cast });
    const rules = String(meta.llmRulePrompt ?? '').split('\n').map(t => t.trim()).filter(Boolean).map((text, i) => ({ id: `old-${i}`, text }));
    return { ...emptyLayer(), ...made, rules, settings: scopedSettings(meta.llmt_chat) };
}

/**
 * @param {'all' | 'card' | 'chat'} place
 * @param {object} o
 * @param {object} [o.old] 옛 번역 확장의 설정 칸
 * @param {object} [o.styles] extension_settings.llmt
 * @param {object} [o.meta] chat_metadata
 * @param {{ key: string, group?: boolean, members?: string[] } | null} [o.owner] 캐릭터(그룹) 열쇠
 * @param {{ name: string }[]} [o.cast] 캐릭터 · 페르소나(옛 용어집의 이름 항목을 그 사람의 표기로 읽으려고)
 */
export function oldLayer(place, { old = {}, styles = {}, meta = null, owner = null, cast = [] } = {}) {
    if (place === 'all') return allLayer(old);
    if (place === 'card') return owner?.key ? cardLayer(old, styles, owner, cast) : emptyLayer();
    return meta ? chatLayer(meta, cast) : emptyLayer();
}
