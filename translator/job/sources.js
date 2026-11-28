// 번역 한 번에 쓸 재료를 쓰는 곳 셋(store/layers.js)에서 모은다: 연결 프로필, 프롬프트, 사람 줄, 이름, 내 규칙.
// 앞 대화는 job/earlier.js. 실리태번 getContext() 로 받은 것만 쓴다.

import { promptFor } from '../store/prompts.js';
import { resolve } from '../core/people.js';
import { fold } from '../core/find.js';
import { termsOn } from '../store/terms-options.js';

/** 지금 채팅의 캐릭터(그룹) → layers 의 owner */
export function ownerOf(context) {
    if (context?.groupId) {
        const group = (context.groups || []).find(g => g?.id === context.groupId);
        const members = (group?.members || []).map(String).filter(Boolean);
        return { key: `group:${context.groupId}`, name: group?.name || '그룹', group: true, members };
    }
    const card = context?.characters?.[context?.characterId];
    return card?.avatar ? { key: String(card.avatar), name: card.name || context.name2 || '' } : null;
}

/** 캐릭터(그룹이면 참가자 전부)와 페르소나 */
export function castOf(context) {
    const names = [];
    if (context?.groupId) {
        const owner = ownerOf(context);
        for (const avatar of owner?.members || []) names.push(context.characters?.find(c => c?.avatar === avatar)?.name);
    } else names.push(context?.name2);
    names.push(context?.name1);
    return [...new Set(names.filter(Boolean))].map(name => ({ name }));
}

/** 고른 프롬프트 id(없거나 'auto' 면 언어마다 정해 둔 것) → { id, title, text }. 속은 store/prompts.js(화면이 부르는 것과 같은 길) */
export { promptFor };

/** 사람 목록에 캐릭터 · 페르소나를 더하고, 늘 넣을 사람 id 를 정한다(글에 이름이 없어도 누구인지 알게) */
export function withCast(list, cast) {
    const out = list.map(p => ({ ...p })), always = [];
    for (const { name } of cast) {
        let person = resolve(out, name);
        if (!person) { person = { id: fold(name), names: [name], ko: '', gender: '', style: '', to: [] }; out.push(person); }
        if (!always.includes(person.id)) always.push(person.id);
    }
    return { people: out, always };
}

/** 내 규칙 → 요청의 [House rules] 글 */
export const rulesText = rules => rules.map(r => `- ${String(r.text).trim()}`).filter(line => line.length > 2).join('\n');

/**
 * 지금 쓰는 곳 셋의 값으로 재료를 모은다(layers.ready() 가 끝난 뒤에 부른다).
 * @param {object} context 실리태번 getContext()
 * @param {ReturnType<import('../store/layers.js').createLayers>} layers
 * @param {object} base store/settings.js readSettings 의 값
 * @returns {{ settings: object, people: object[], always: string[], names: object[], rules: string }}
 *   settings: base 에 고른 연결 프로필과 프롬프트를 덮은 것
 */
export function gatherNow(context, layers, base) {
    const view = layers.view();
    const profileId = view.settings.model || base.profileId;
    // 다른 프로필을 고르면 옛 설정의 '모델 덮어쓰기'는 쓰지 않는다(그 프로필의 모델로 보낸다)
    const settings = { ...base, profileId, model: profileId === base.profileId ? base.model : '', prompt: lang => promptFor(context.extensionSettings, view, lang) };
    // 정해 둔 번역어를 꺼 두면 이름과 사람의 한글 표기를 싣지 않는다. 기억의 열쇠가 이 둘로 만들어져 꺼 둔 동안의 번역이 켠 때의 것과 섞이지 않는다
    const on = termsOn(context.extensionSettings);
    const { people, always } = withCast(view.people.map(strip).map(p => (on ? p : { ...p, ko: '' })), castOf(context));
    const names = on ? view.names.map(n => ({ src: n.src, dst: n.dst })) : [];
    return { settings, people, always, names, rules: rulesText(view.rules) };
}

/** 쓰는 곳 셋을 다 읽은 뒤 모은다 */
export async function gather(context, layers, base) {
    await layers.ready();
    return gatherNow(context, layers, base);
}

/** 합칠 때 붙인 자리 표시를 뗀 사람 */
const strip = ({ place, places, ...person }) => person;
