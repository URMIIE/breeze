// 사람(이름 표기 · 말투)과 정해 둔 번역어를 옮긴다.
//   같은 채팅 안에서 쓰는 곳 바꾸기: moveName(번역어). 사람은 layers.savePerson(person, 쓰는 곳)이 이미 옮긴다.
//   다른 캐릭터의 것을 지금 채팅으로: 그 캐릭터의 용어집을 읽어(store/terms-from.js) 가져온다(planImport → applyImport).
//   파일로 내보내고 그쪽에서 다시 고르는 길은 없앴다: 단계가 다섯이라 번거로웠다.
// 겹칠 때: 'keep' 이면 있던 것을 두고, 'update' 면 가져오는 것으로 바꾼다. 가져올 쓰는 곳보다 좁은 곳(이 채팅)에 같은 사람이 따로 적혀 있으면
// 어느 쪽이든 건드리지 않는다(그 채팅에만 쓰려고 적어 둔 값이 사라지지 않게).

import { fold } from '../core/find.js';
import { PLACES, samePerson } from './layers.js';

// ── 같은 채팅 안에서 ──

/** 번역어 한 줄의 쓰는 곳을 바꾼다. vid 는 layers.view().names 의 것 */
export function moveName(layers, vid, to) {
    const name = layers.view().names.find(n => n.vid === vid);
    if (!name || name.place === to) return false;
    layers.removeName(vid);
    layers.addName(to, name.src, name.dst);
    return true;
}

// ── 가져오기 ──

/** 가져올 사람 하나를 어떻게 할지: 'add' 새로 | 'update' 가져오는 것으로 | 'keep' 있던 것 그대로 */
function personStep(view, person, place, policy) {
    const narrower = PLACES.slice(0, PLACES.indexOf(place));
    if (narrower.some(p => view.byPlace[p].people.some(x => samePerson(x, person)))) return 'keep';
    const have = view.byPlace[place].people.find(x => samePerson(x, person));
    if (!have) return 'add';
    const shape = p => JSON.stringify([p.names, p.ko || '', p.gender || '', p.style || '', (p.to || []).map(t => [t.who, t.style])]);
    return policy === 'update' && shape(have) !== shape(person) ? 'update' : 'keep';
}

function nameStep(view, name, place, policy) {
    const have = view.byPlace[place].names.find(n => fold(n.src) === fold(name.src));
    if (!have) return 'add';
    return policy === 'update' && have.dst !== name.dst ? 'update' : 'keep';
}

/**
 * 가져오면 무엇이 바뀌는지 센다(저장하지 않는다).
 * @param {object} view layers.view()  @param {{ names: object[], people: object[] }} book 가져올 것(store/terms-from.js bookOf 의 꼴)
 * @param {{ place: 'chat' | 'card' | 'all', policy?: 'keep' | 'update' }} o
 * @returns {{ names: { add: number, update: number, keep: number }, people: { add: number, update: number, keep: number }, changed: boolean, steps: { names: string[], people: string[] } }}
 */
export function planImport(view, book, { place, policy = 'keep' }) {
    if (!PLACES.includes(place)) throw new Error('어디에 가져올지 골라 주세요.');
    if (!['keep', 'update'].includes(policy)) throw new Error('겹칠 때 어떻게 할지 골라 주세요.');
    const steps = { names: book.names.map(n => nameStep(view, n, place, policy)), people: book.people.map(p => personStep(view, p, place, policy)) };
    const tally = list => ({ add: list.filter(s => s === 'add').length, update: list.filter(s => s === 'update').length, keep: list.filter(s => s === 'keep').length });
    const names = tally(steps.names), people = tally(steps.people);
    return { names, people, steps, changed: names.add + names.update + people.add + people.update > 0 };
}

/**
 * 가져온다. 돌려주는 값은 planImport 와 같다(실제로 한 일).
 * @param {object} layers store/layers.js 의 것(layers.ready() 가 끝난 뒤)
 */
export function applyImport(layers, book, { place, policy = 'keep' }) {
    const view = layers.view(), plan = planImport(view, book, { place, policy });
    book.names.forEach((name, i) => { if (plan.steps.names[i] !== 'keep') layers.addName(place, name.src, name.dst); });
    // 가져오는 사람의 id 가 여기서는 다른 id 일 수 있다(같은 사람이 이미 있을 때): 상대별 말투의 상대도 여기 id 로 바꾼다
    const idHere = new Map(book.people.map(person => [person.id, view.people.find(x => samePerson(x, person))?.id ?? person.id]));
    book.people.forEach((person, i) => {
        if (plan.steps.people[i] === 'keep') return;
        const to = person.to.map(t => ({ ...t, who: idHere.get(t.who) ?? t.who }));
        layers.savePerson({ ...person, id: idHere.get(person.id), to }, place);
    });
    return plan;
}
