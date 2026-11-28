// 번역 설정 화면들이 그릴 자료를 쓰는 곳 셋(store/layers.js)과 채팅에서 만든다: 판 머리 글, 연결 프로필, 나온 사람들과 그 그림.
// 실리태번 getContext() 의 값만 읽는다(저장하지 않는다).

import { ownerOf, castOf } from '../../job/sources.js';
import { seenSpeakers, spellingOwners } from '../../store/seen.js';
import { sourceLanguage } from '../../core/lang.js';
import { fold } from '../../core/find.js';
import { ID_MARK } from '../../core/people.js';


const isAnswer = m => m && !m.is_user && !m.is_system && String(m.mes ?? '').trim();
const lastAnswer = chat => [...(chat || [])].reverse().find(isAnswer);

/** 판 머리와 쓰는 곳 글에 쓸 이름 */
export function whereOf(context) {
    const owner = ownerOf(context);
    return owner?.group ? { group: owner.name } : { card: owner?.name || context.name2 || '' };
}

/** 지금 채팅의 답 언어(맨 끝 AI 답으로 가늠) */
const langNow = context => sourceLanguage(lastAnswer(context.chat)?.mes ?? '');

const hasChat = context => Boolean(context.getCurrentChatId?.());

/** 사람 하나 → 화면의 꼴 */
function personRow(person, people, spoken) {
    const nameOf = id => { const p = people.find(x => x.id === id); return p ? (p.ko || p.names?.[0] || '') : String(id ?? ''); };
    // 짝 기록에는 사람 id('@id', core/people.js recordOf)로도, 옛 기록은 이름으로도 적혀 있다
    const hits = [...new Set([`${ID_MARK}${person.id}`, ...(person.names || []), person.ko].filter(Boolean).map(fold))].map(k => spoken.get(k)).filter(Boolean);
    const tones = [...(person.style ? [{ to: '', how: person.style }] : []), ...(person.to || []).map(t => ({ to: nameOf(t.who), how: t.style }))];
    return {
        id: person.id, src: person.names?.[0] ?? '', name: person.ko || '',
        alts: (person.names || []).slice(1), tones, lines: hits.reduce((sum, h) => sum + h.lines, 0), said: hits.find(h => h.said)?.said ?? '',
        scope: person.place === 'chat' ? 'chat' : 'card', kind: 'person', used: new Set(hits.map(h => fold(h.name))),
    };
}

/**
 * 나온 사람들: 저장된 사람 + 캐릭터 · 페르소나 + 이 채팅의 번역 기록에서 말한 이름(사람 목록에 없으면 '새 이름'). 대사 많은 차례
 * @returns {object[]} settings.js 의 people 꼴에 person.js 가 쓰는 칸(alts, scope, kind, lines, seen)을 더한 것
 */
export function peopleOf(context, view) {
    const spoken = seenSpeakers(context.chat);
    const people = view.people.map(p => ({ ...p }));
    for (const { name } of castOf(context)) if (!people.some(p => (p.names || []).some(n => fold(n) === fold(name)))) people.push({ id: fold(name), names: [name], ko: '', style: '', to: [], place: 'card' });
    const rows = people.map(p => personRow(p, people, spoken));
    const taken = new Set(rows.flatMap(r => [...r.used]));
    // 지금 목록에 없는 사람의 id 는 이름이 아니다
    const fresh = [...spoken].filter(([key]) => !taken.has(key) && !view.ignore.has(key) && !key.startsWith(ID_MARK));
    const owners = ownersOf(context, rows, fresh);
    for (const [key, entry] of fresh) {
        const owner = rows.find(row => row.id === owners.get(key));
        if (owner) { joinSpelling(owner, entry); continue; }
        rows.push({ id: `new:${entry.name}`, src: '', name: entry.name, isNew: true, lines: entry.lines, said: entry.said, scope: 'card', kind: 'person', seen: [{ text: entry.name, times: entry.lines, paras: entry.lines }] });
    }
    return rows.sort((a, b) => b.lines - a.lines).map(({ used, guessLines, ...row }) => row);
}

/**
 * 새 이름 가운데 목록에 있는 사람의 표기로 볼 근거가 있는 것(store/seen.js spellingOwners): 접은 이름 → 사람 id.
 * 한글 표기가 이미 적힌 사람도 본다: 번역이 그 사람을 표기의 일부(성 없이 이름만 등)로 적으면 같은 사람이 새 이름으로 한 번 더 떴다
 */
function ownersOf(context, rows, fresh) {
    const known = rows.filter(row => row.src).map(row => ({ id: row.id, names: [row.src, ...row.alts] }));
    const spellings = fresh.map(([, entry]) => entry.name).filter(name => /[가-힣]/.test(name));
    const sourceOf = m => context.substituteParams?.(m.mes, context.name1, m.name) ?? m.mes;
    return spellingOwners(context.chat, known, spellings, sourceOf);
}

/**
 * 그 사람의 표기로 본 새 이름을 그 사람 줄에 합친다: 대사 수를 더하고, 대사가 가장 많은 표기를 한글 이름 칸의 후보로(guess).
 * 저장하지 않는다: 사람 화면에서 저장을 눌러야 표기가 된다.
 */
function joinSpelling(row, entry) {
    const before = row.guessLines ?? 0;
    row.lines += entry.lines;
    row.said ||= entry.said;
    // 한글 표기가 이미 정해진 사람은 대사 수만 합친다(정한 표기를 후보로 바꾸지 않는다)
    if (row.name && !row.guess) return;
    if (!row.guess || entry.lines > before) Object.assign(row, { name: entry.name, guess: true, guessLines: entry.lines });
}

/** 사람 화면에서 넘어온 것 → 저장할 사람(core/people.js 꼴) */
export function personFrom(draft, before, people) {
    const names = [draft.src, ...draft.alts].map(s => String(s ?? '').trim()).filter(Boolean);
    const ko = String(draft.name ?? '').trim();
    const idOf = name => people.find(p => p.ko === name || (p.names || []).includes(name))?.id ?? name;
    return {
        id: before?.id && !String(before.id).startsWith('new:') ? before.id : fold(names[0] || ko),
        names, ko, gender: before?.gender ?? '',
        style: draft.tones.find(t => !t.to)?.how ?? '',
        to: draft.tones.filter(t => t.to).map(t => ({ who: idOf(t.to), style: t.how })),
    };
}

/** 받침이 있으면 '과', 없으면 '와'. 한글로 끝나지 않으면 이름 그대로 */
function withParticle(name) {
    const code = name.charCodeAt(name.length - 1) - 0xAC00;
    return code < 0 || code > 11171 ? name : `${name}${code % 28 ? '과' : '와'}`;
}

/** 판 머리의 작은 글: 이 판이 어느 채팅의 것인지 */
export function headSub(context) {
    if (!hasChat(context)) return '';
    const where = whereOf(context), name = where.group ?? where.card;
    if (where.group) return `${name} 채팅은 지금 이렇게 번역돼요`;
    const joined = withParticle(name);
    return joined === name ? `${name} 채팅은 지금 이렇게 번역돼요` : `${joined}의 채팅은 지금 이렇게 번역돼요`;
}

/**
 * 연결 프로필: 목록과 지금 고른 것. 고른 것은 쓰는 곳 셋을 합친 값(없으면 옛 자리에서 고른 것).
 * @returns {{ profiles: { id: string, label: string, model: string, address: string }[], id: string, label: string, model: string }}
 *   label '' = 고른 프로필이 없음(또는 지워짐). model: 고른 프로필에 적힌 모델(모델 칸을 비워 두면 이것으로 보낸다)
 */
export function connectionOf(context, layers) {
    const es = context.extensionSettings;
    const profiles = (es.connectionManager?.profiles ?? []).map(p => {
        const name = p.name || p.id, model = String(p.model ?? '');
        return { id: p.id, label: model && !name.includes(model) ? `${name} (${model})` : name, model, address: `${p.api ?? ''} ${p['api-url'] ?? ''}` };
    });
    const id = layers.view().settings.model || es['llm-translator-custom']?.connection_profile_id || '';
    const chosen = profiles.find(p => p.id === id);
    return { profiles, id, label: chosen?.label ?? '', model: chosen?.model ?? '' };
}

/** 이 채팅에 나오는 캐릭터 · 그룹 멤버 · 페르소나의 그림 주소(이름 → 주소). 그림이 없는 이름은 없다 */
export function castFaces(context) {
    const faces = new Map(), put = (name, type, file) => { if (name && file && file !== 'none') faces.set(fold(name), `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`); };
    const group = context.groups?.find(g => g.id === context.groupId);
    const cards = group ? context.characters.filter(c => group.members?.includes(c.avatar)) : [context.characters?.[context.characterId]].filter(Boolean);
    for (const card of cards) put(card.name, 'avatar', card.avatar);
    const personas = context.powerUserSettings?.personas ?? {};
    for (const [file, name] of Object.entries(personas)) if (name === context.name1) put(name, 'persona', file);
    return faces;
}

export { langNow, lastAnswer, hasChat };
