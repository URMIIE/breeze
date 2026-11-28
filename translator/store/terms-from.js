// 다른 캐릭터 · 그룹의 용어집(정해 둔 번역어와 사람)을 읽는다: 지금 채팅으로 가져오려고(store/terms-move.js planImport · applyImport).
// 지금 채팅을 열 때와 같은 길로 읽는다: 캐릭터마다의 파일(store/layers.js cardFile)이 있으면 그것, 없거나 못 읽으면 옛 번역기 자료로 만든
// 처음 값(store/old-layers.js oldLayer). 옛 자료는 설정에 이미 있어 요청이 없다.
// 파일은 있는 것만 받는다: 있는지는 한 번의 요청으로 묻고(exists), 있는 파일만 몇 개씩 나눠 받는다.
// 캐릭터가 수백이어도 요청이 캐릭터 수만큼 한꺼번에 나가지 않게.
// 읽기만 한다: 아무것도 저장하지 않는다. 실리태번을 모른다: 파일을 묻고 읽는 손은 넘겨받는다.

import { cardFile } from './layers.js';
import { oldLayer } from './old-layers.js';
import { ownerOf } from '../job/sources.js';

/** 한 번에 받는 파일 수 */
const AT_ONCE = 6;

const usable = data => Boolean(data) && typeof data === 'object' && data.v === 1;

/** 고를 수 있는 캐릭터 · 그룹(store/layers.js 가 쓰는 열쇠 꼴: 캐릭터는 아바타, 그룹은 group:id) */
function ownersOf(context) {
    const cards = (context.characters ?? []).filter(c => c?.avatar && c.avatar !== 'none')
        .map(c => ({ key: String(c.avatar), name: c.name || c.avatar, avatar: c.avatar }));
    const groups = (context.groups ?? []).filter(g => g?.id).map(g => {
        const members = (g.members ?? []).map(String).filter(Boolean);
        return { key: `group:${g.id}`, name: g.name || '그룹', group: true, members, avatar: members[0] ?? '' };
    });
    return [...cards, ...groups];
}

/** 옛 용어집의 이름 항목을 사람의 표기로 읽을 때 쓰는 이름들(지금 채팅을 열 때처럼 그 캐릭터들과 지금 페르소나) */
function castFor(owner, context) {
    const names = owner.group ? owner.members.map(avatar => context.characters?.find(c => c?.avatar === avatar)?.name) : [owner.name];
    return [...new Set([...names, context.name1].filter(Boolean))].map(name => ({ name }));
}

/** 사람 가운데 가져올 것이 있는 사람(한글 표기 · 말투가 적힌 사람) */
const meaningful = person => Boolean(person?.ko || person?.style || person?.to?.length);

/** 쓰는 곳 하나의 값 → 가져올 것 { names: [{ src, dst }], people } */
export function bookOf(layer) {
    const names = (layer?.names ?? []).filter(n => n?.src && n?.dst).map(n => ({ src: n.src, dst: n.dst }));
    const people = (layer?.people ?? []).filter(meaningful).map(({ place, places, ...person }) => ({ ...person, to: person.to ?? [] }));
    return { names, people };
}

/** 있는 파일만 나눠 받는다 → 파일 이름 → 내용(못 읽으면 null) */
async function loadSome(names, load) {
    const out = new Map();
    for (let i = 0; i < names.length; i += AT_ONCE) {
        const part = names.slice(i, i + AT_ONCE);
        const got = await Promise.all(part.map(name => Promise.resolve().then(() => load(name)).catch(() => null)));
        part.forEach((name, k) => out.set(name, got[k]));
    }
    return out;
}

/**
 * 용어집이 있는 다른 캐릭터 · 그룹(지금 것은 뺀다). 이름 차례.
 * @param {object} context 실리태번 getContext()
 * @param {{ exists: (names: string[]) => Promise<Set<string>>, load: (name: string) => Promise<object | null> }} hands
 * @returns {Promise<{ key: string, name: string, avatar: string, group: boolean, book: { names: object[], people: object[] } }[]>}
 */
export async function otherBooks(context, hands) {
    const now = ownerOf(context)?.key;
    const owners = ownersOf(context).filter(owner => owner.key !== now);
    const files = owners.map(cardFile);
    const have = await hands.exists(files).catch(() => new Set());
    const loaded = await loadSome(files.filter(name => have.has(name)), hands.load);
    const es = context.extensionSettings ?? {};
    const old = es['llm-translator-custom'] ?? {}, styles = es.llmt ?? {};
    return owners.map((owner, i) => {
        const data = loaded.get(files[i]);
        const layer = usable(data) ? data : oldLayer('card', { old, styles, owner, cast: castFor(owner, context) });
        return { key: owner.key, name: owner.name, avatar: owner.avatar, group: Boolean(owner.group), book: bookOf(layer) };
    }).filter(row => row.book.names.length || row.book.people.length)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
