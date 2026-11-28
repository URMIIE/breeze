// 사람, 사람이 아닌 이름, 내 규칙, 설정(프롬프트, 모델, 보기)을 '쓰는 곳' 셋에 읽고 쓴다.
//
//   all   모든 채팅            설정 파일의 작은 칸 extension_settings.story_translation (설정 파일은 크고 통째로 올라가니 작고 드물게 바뀌는 것만)
//   card  이 캐릭터의 채팅 전체  user/files/ 의 캐릭터마다 작은 파일(그룹 채팅은 그룹마다)
//   chat  이 채팅만             chat_metadata.story_translation
// 찾는 차례는 chat → card → all. 같은 사람은 위 쓰는 곳의 값이 이기고, 빈 칸만 아래에서 채운다.
//
// 한 쓰는 곳의 꼴: { v: 1, people: 사람[](core/people.js 꼴), names: [{ id, src, dst }], rules: [{ id, text }],
//                   settings: { prompt?, model?, view? }, ignore: [사람이 아니라고 뺀 이름], prompts: { 프롬프트 id: { text?, title?, made?, removed? } }(all 에만. 고친 글 · 바꾼 이름 · 새로 만든 것 · 목록에서 뺀 것),
//                   promptByLanguage: { en?, zh?, ja?: 프롬프트 id }(all 에만. 칸이 없는 언어는 옛 자리 것, 빈 글 = 정하지 않음) }
//
// 새 자리에 아직 아무것도 없으면 옛 번역기 자료로 만든 처음 값(store/old-layers.js)을 보여 주기만 한다.
// 사용자가 그 쓰는 곳을 처음 고칠 때 처음 값을 바탕으로 새 자리에 적는다(옛 자리는 건드리지 않는다).
// 읽기만으로는 아무것도 적지도 저장하지도 않는다: 채팅을 열기만 해도 채팅 파일이 저장되면 최근 채팅 차례(수정 시각)가 바뀐다.
// 저장은 한 번의 동작에서 바뀐 쓰는 곳마다 한 번(같은 틱 안의 고침을 모은다).
// 실리태번을 모른다: 읽고 저장하는 손은 넘겨받는다(브라우저 없이 시험하려고).

import { emptyLayer, oldLayer, skipsCardTerms, withoutTerms } from './old-layers.js';
import { fold } from '../core/find.js';

export const SLOT = 'story_translation';
export const PLACES = ['chat', 'card', 'all'];

/** 파일 이름에 쓰는 짧은 해시(캐릭터 열쇠 → 글자 몇 개) */
export const hashOf = text => { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0; return h.toString(36); };
/** 캐릭터(그룹)마다의 파일 이름 */
export const cardFile = owner => `translation-${owner.group ? 'group' : 'character'}-${hashOf(String(owner.key))}.json`;

const usable = data => Boolean(data) && typeof data === 'object' && data.v === 1;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 빠진 칸을 채운다(제자리에서) */
function fill(data) {
    for (const [key, value] of Object.entries(emptyLayer())) if (data[key] === undefined || typeof data[key] !== typeof value) data[key] = value;
    return data;
}

// ── 사람 합치기 ──

const keysOf = person => new Set((person.names || []).map(fold).filter(Boolean));
/** 같은 사람인가: id 가 같거나 원문 표기가 하나라도 같으면(한글 표기만 같은 것은 다른 사람일 수 있어 보지 않는다) */
export function samePerson(a, b) {
    if (a.id && a.id === b.id) return true;
    const mine = keysOf(a);
    return [...keysOf(b)].some(key => mine.has(key));
}

/** 위 쓰는 곳의 사람에 아래 사람의 빈 칸을 채운다 */
function mergeInto(top, low) {
    for (const name of low.names || []) if (!keysOf(top).has(fold(name))) top.names.push(name);
    for (const key of ['ko', 'gender', 'style']) if (!top[key] && low[key]) top[key] = low[key];
    if (!top.to?.length && low.to?.length) top.to = low.to.map(t => ({ ...t }));
    top.places.push(low.place);
}

function mergePeople(byPlace) {
    const out = [];
    for (const place of PLACES) {
        for (const person of byPlace[place].people) {
            const found = out.find(p => samePerson(p, person));
            if (found) mergeInto(found, { ...person, place });
            else out.push({ ...person, names: [...(person.names || [])], to: (person.to || []).map(t => ({ ...t })), place, places: [place] });
        }
    }
    return out;
}

/** 이름은 위 쓰는 곳이 이긴다(같은 원문 표기가 아래에 또 있으면 뺀다) */
function mergeNames(byPlace) {
    const taken = new Set(), out = [];
    for (const place of PLACES) {
        for (const n of byPlace[place].names) {
            const key = fold(n.src);
            if (!key || taken.has(key)) continue;
            taken.add(key);
            out.push({ ...n, place, vid: `${place}/${n.id}` });
        }
    }
    return out;
}

/** 설정은 칸마다 가장 위 쓰는 곳의 값. from 은 그 값이 있던 쓰는 곳 */
function mergeSettings(byPlace) {
    const settings = {}, from = {};
    for (const key of ['prompt', 'model', 'view', 'redoPrompt']) {
        const place = PLACES.find(p => byPlace[p].settings[key] !== undefined && byPlace[p].settings[key] !== '');
        if (place) { settings[key] = byPlace[place].settings[key]; from[key] = place; }
    }
    return { settings, from };
}

/**
 * @param {object} hands
 * @param {() => object} hands.settings 실리태번 extension_settings
 * @param {() => object | null} hands.meta 지금 채팅의 chat_metadata(채팅이 없으면 null)
 * @param {() => { key: string, name: string, group?: boolean, members?: string[] } | null} hands.owner 지금 캐릭터(그룹)
 * @param {() => { name: string }[]} [hands.cast] 캐릭터 · 페르소나(옛 자료를 읽을 때만)
 * @param {(name: string) => Promise<object | null>} hands.loadFile
 * @param {(name: string, data: object) => Promise<any>} hands.saveFile
 * @param {() => any} hands.saveSettings
 * @param {() => Promise<any>} hands.saveMeta
 * @param {(fn: () => void) => void} [hands.later] 모아 저장할 때(기본 queueMicrotask)
 */
export function createLayers(hands) {
    const files = new Map();      // 파일 이름 → { data, loaded: Promise, done: 다 읽었나 }
    const firsts = new WeakMap(); // 옛 자료로 만든 처음 값: 그 자료 객체 → { place → 값 }
    const dirty = new Map();      // 저장할 쓰는 곳 → 저장 때 견줄 것
    let queued = false, saving = Promise.resolve();
    const later = hands.later ?? (fn => queueMicrotask(fn));

    const ownerNow = () => hands.owner?.() ?? null;
    const fileNow = () => { const owner = ownerNow(); return owner?.key ? files.get(cardFile(owner)) : null; };

    function stored(place) {
        if (place === 'all') return usable(hands.settings()?.[SLOT]) ? hands.settings()[SLOT] : null;
        if (place === 'chat') { const meta = hands.meta(); return usable(meta?.[SLOT]) ? meta[SLOT] : null; }
        const file = fileNow();
        return usable(file?.data) ? file.data : null;
    }

    // 처음 값은 그 옛 자료 객체(설정, 채팅 자료, 파일)에 묶어 한 번만 만든다
    function first(place) {
        const anchor = place === 'chat' ? hands.meta() : place === 'card' ? fileNow() : hands.settings();
        if (!anchor) return emptyLayer();
        const book = firsts.get(anchor) ?? {};
        firsts.set(anchor, book);
        if (!book[place]) {
            const es = hands.settings() ?? {};
            book[place] = oldLayer(place, { old: es['llm-translator-custom'] ?? {}, styles: es.llmt ?? {}, meta: hands.meta(), owner: ownerNow(), cast: hands.cast?.() ?? [] });
        }
        return book[place];
    }

    /** 읽기: 저장된 것, 없으면 처음 값. 돌려준 것을 고치지 않는다 */
    const read = place => fill({ ...(stored(place) ?? first(place)) });

    /** 쓸 자리: 아직 없으면 처음 값을 베껴 새 자리에 둔다 */
    function writable(place) {
        const have = stored(place);
        if (have) return fill(have);
        const data = fill(structuredClone(first(place)));
        if (place === 'all') hands.settings()[SLOT] = data;
        else if (place === 'chat') {
            const meta = hands.meta();
            if (!meta) throw new Error('채팅을 먼저 열어 주세요.');
            meta[SLOT] = data;
        } else {
            // 파일을 다 읽기 전에 쓰면 파일에 있던 것을 덮는다
            const entry = fileNow();
            if (!entry?.done) throw new Error('캐릭터 자료를 아직 읽는 중이에요. 잠깐 뒤에 다시 해 주세요.');
            entry.data = data;
        }
        return data;
    }

    function markDirty(place) {
        const target = place === 'chat' ? hands.meta() : place === 'card' ? cardFile(ownerNow()) : 'all';
        dirty.set(place, target);
        if (queued) return;
        queued = true;
        later(() => { queued = false; flush(); });
    }

    /** 바뀐 쓰는 곳을 하나씩 저장한다 */
    function flush() {
        const jobs = [...dirty.entries()];
        dirty.clear();
        saving = saving.then(async () => {
            for (const [place, target] of jobs) {
                try {
                    if (place === 'all') await hands.saveSettings();
                    else if (place === 'chat') { if (hands.meta() === target) await hands.saveMeta(); else console.warn('[번역] 채팅이 바뀌어 이 채팅 설정을 저장하지 못했어요'); }
                    else await hands.saveFile(target, files.get(target)?.data);
                } catch (error) { console.warn('[번역] 저장하지 못했어요', place, error); }
            }
        });
        return saving;
    }

    /** 고친다: fn(그 쓰는 곳의 자료). 같은 틱 안의 고침은 쓰는 곳마다 한 번 저장된다 */
    function edit(place, fn) {
        const data = writable(place);
        const out = fn(data);
        markDirty(place);
        return out;
    }

    /** 지금 캐릭터(그룹)의 파일을 읽어 둔다. 없거나 못 읽으면 빈 것으로(그때는 옛 자료의 처음 값) */
    function ready() {
        const owner = ownerNow();
        if (!owner?.key) return Promise.resolve();
        const name = cardFile(owner);
        if (!files.has(name)) {
            const entry = { data: null, loaded: null, done: false };
            entry.loaded = Promise.resolve().then(() => hands.loadFile(name))
                .then(data => { entry.data = usable(data) ? data : null; }, () => { /* 없거나 못 읽음: 빈 것으로 */ })
                .then(() => { entry.done = true; });
            files.set(name, entry);
        }
        return files.get(name).loaded;
    }

    /** 세 쓰는 곳을 합친 지금 값 */
    function view() {
        const byPlace = Object.fromEntries(PLACES.map(place => [place, read(place)]));
        // 이 채팅이 캐릭터 용어집을 쓰지 않기로 한 채팅이면 캐릭터의 번역어는 합치지 않는다(목록 화면에 주는 byPlace 는 그대로)
        const used = skipsCardTerms(hands.meta()) ? { ...byPlace, card: withoutTerms(byPlace.card) } : byPlace;
        const rules = ['all', 'card', 'chat'].flatMap(place => byPlace[place].rules.map(r => ({ ...r, place, vid: `${place}/${r.id}` })));
        return {
            ...mergeSettings(byPlace), people: mergePeople(used), names: mergeNames(used), rules,
            ignore: new Set(PLACES.flatMap(place => byPlace[place].ignore.map(fold))),
            prompts: byPlace.all.prompts, promptByLanguage: byPlace.all.promptByLanguage, byPlace,
        };
    }

    /** 번역 결과를 바꾸는 값의 지문(번역하는 동안 바뀌면 멈추려고) */
    const mark = () => { const v = view(); return JSON.stringify([v.settings.model ?? '', v.settings.prompt ?? '', v.prompts, v.promptByLanguage, v.people, v.names, v.rules]); };

    return { read, edit, flush, ready, view, mark, saving: () => saving, ...actions(edit, view) };
}

// ── 화면이 부르는 고치기들 ──

const split = vid => { const at = String(vid).indexOf('/'); return [vid.slice(0, at), vid.slice(at + 1)]; };

function actions(edit, view) {
    return {
        /** 설정 한 칸: 지금 그 값이 있는 쓰는 곳에 적는다(없으면 모든 채팅). 그래서 'OO 전용'인 설정은 전용으로 남는다 */
        setSetting(key, value) {
            const place = view().from[key] ?? 'all';
            edit(place, data => { data.settings[key] = value; });
            return place;
        },
        setPromptText(id, text) { edit('all', data => { data.prompts[id] = { ...data.prompts[id], text: String(text) }; }); },
        /** 프롬프트 한 칸을 고친다(모든 채팅). patch 의 칸을 덮고, 값이 undefined 인 칸은 지운다. patch 가 null 이면 그 프롬프트의 칸을 통째로 지운다 */
        setPrompt(id, patch) {
            edit('all', data => {
                const next = patch ? { ...data.prompts[id], ...patch } : {};
                for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
                if (Object.keys(next).length) data.prompts[id] = next; else delete data.prompts[id];
            });
        },
        /** 이 언어의 답에 쓸 프롬프트(모든 채팅). id '' = 정하지 않음 */
        setLanguagePrompt(lang, id) { edit('all', data => { data.promptByLanguage[lang] = String(id ?? ''); }); },
        addRule(place, text) { edit(place, data => { data.rules.push({ id: newId(), text: String(text).trim() }); }); },
        removeRule(vid) {
            const [place, id] = split(vid);
            edit(place, data => { data.rules = data.rules.filter(r => r.id !== id); });
        },
        /** 쓰는 곳 옮기기: 옛 쓰는 곳에서 빼고 새 쓰는 곳 끝에 넣는다 */
        moveRule(vid, to) {
            const [from, id] = split(vid);
            if (from === to) return;
            const rule = view().rules.find(r => r.vid === vid);
            if (!rule) return;
            edit(from, data => { data.rules = data.rules.filter(r => r.id !== id); });
            edit(to, data => { data.rules.push({ id: rule.id, text: rule.text }); });
        },
        addName(place, src, dst) {
            edit(place, data => {
                data.names = data.names.filter(n => fold(n.src) !== fold(src));
                data.names.push({ id: fold(src), src: String(src).trim(), dst: String(dst).trim() });
            });
        },
        removeName(vid) {
            const [place, id] = split(vid);
            edit(place, data => { data.names = data.names.filter(n => n.id !== id); });
        },
        /** 사람 저장: 고른 쓰는 곳에 통째로 적고, 그보다 위 쓰는 곳(이 채팅)의 같은 사람은 뺀다(옮기기) */
        savePerson(person, place) {
            const above = PLACES.slice(0, PLACES.indexOf(place));
            for (const up of above) if (view().byPlace[up].people.some(p => samePerson(p, person))) edit(up, data => { data.people = data.people.filter(p => !samePerson(p, person)); });
            edit(place, data => {
                data.people = data.people.filter(p => !samePerson(p, person));
                data.people.push(person);
                data.ignore = data.ignore.filter(name => !person.names.concat(person.ko || []).some(n => fold(n) === fold(name)));
            });
        },
        /** 사람 지우기: 들어 있는 쓰는 곳 전부에서 */
        removePerson(person) {
            for (const place of PLACES) if (view().byPlace[place].people.some(p => samePerson(p, person))) edit(place, data => { data.people = data.people.filter(p => !samePerson(p, person)); });
        },
        /** 새 이름을 '이름이 아니에요'로 뺀다 */
        ignoreName(place, name) { edit(place, data => { if (!data.ignore.some(n => fold(n) === fold(name))) data.ignore.push(String(name)); }); },
    };
}
