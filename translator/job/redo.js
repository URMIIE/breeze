// 다시 번역: 글 전체 · 고른 대사, 누구 말인지 바로잡기, 되돌리기. 일은 줄(job/queue.js)에 세울 꼴({ holds, run })로 내준다.
//
// 글 전체: 이 답을 처음부터 새로 받는다. 이번에 지킬 말투나 부탁은 요청의 [Additional guidance] 로, 사용자가 바로잡은 대사 주인은
//   그 문단 머리에 사람 표의 글자로 미리 적어 보내고(job/engine.js knownSpeakers), 새 짝 기록에도 옮겨 적는다(덮이지 않게).
// 다시 번역 프롬프트(deps.redoPrompt, store/redo-prompts.js)를 적어 두었으면 긴 번역 프롬프트 자리에 그 글이 대신 들어간다. 비어 있으면 평소 번역 프롬프트 그대로다.
//   바뀌는 것은 그 자리의 글뿐이다: 원문 · 사람 · 용어 · 내 규칙 · 조건 줄 · (골랐으면) 앞 번역문은 그대로 붙는다. 번역기 글의 시작에 '다시 번역'이라는 한 줄이 더해진다.
// 앞 번역문을 같이 보낼지는 사용자가 고른다(choice.withBefore, 기본은 안 보냄): 보내면 [Previous translation] 에 원문과 같은 번호로 싣는다
//   (어느 문단의 초안인지 모델이 맞추지 않게). 글 전체면 짝 기록으로 문단마다 지금 번역문을 찾고, 기록이 없는 예전 번역은 통째로 한 덩이.
//   고른 대사면 고른 문단의 지금 번역문. 번역에 보내지 않는 블록은 뺀 글이다. 요청 수는 그대로 한 번이다.
// 고른 대사: 고른 원문 문단만 이어 요청 한 번 → 돌아온 문단 수가 같을 때만 그 문단 자리에 끼운다. 나머지 번역은 그대로.
//   바로잡은 주인과 고른 대사의 주인은 늘 사람 줄에 넣는다
//   (사람 줄은 보내는 글에 이름이 나오는 사람만 들어가서, 이름 없는 대사만 골라 보내면 그 사람 말투가 빠졌다).
//   번역을 다 받지 못했거나 그 사이 번역문이 바뀌었으면 바꾸지 않는다.
// 바꾸기 전 번역은 메시지에 하나 보관해(store/before.js) 되돌리기가 그 문단들만 앞 번역으로 바꾼다. 한 번 더 누르면 다시 새 번역으로.
//
// 실리태번을 직접 부르지 않는다. deps 꼴:
//   prepare(message) → plan | null      번역 재료(job/run.js 의 prepare 가 내는 것 그대로: 사람 · 이름 · 규칙 · 앞 대화 · 기억까지)
//   send(prompt, o) → Promise<string>   보내기(거절 거르기까지 씌운 것: job/run.js refusalFilter)
//   save(message) → Promise             메시지를 다시 그리고 채팅을 저장
//   hash(text) → string | number        원문 해시(getStringHash)
//   saveTone?(name, tone) → Promise     이번 말투를 그 사람 말투로 적어 두기
//   redoPrompt?() → string              사용자가 적어 둔 다시 번역 프롬프트(매크로를 푼 글). 비었으면 평소 번역 프롬프트로 보낸다
//   substitute?(text) → string          매크로 풀기(이번 말투 칸에 적은 {{user}} · {{char}} 가 글자 그대로 가지 않게)
//   stallRetries?: number               글이 오다 멈췄을 때 남은 부분만 다시 보낼 횟수(기본 0)
//   connection?() → string              연결 설정의 지문(번역하는 동안 바뀌면 멈춤)
//   engine?                             엔진 입구(기본 job/engine.js run, 시험에서 바꿔 끼운다)

import { translateOnce, retryRequests, stillThere, watched } from './run.js';
import { setWho, reusable, mark } from '../store/pairs.js';
import { attach, translationOf } from '../store/message.js';
import { keepBefore, readBefore, writePairs } from '../store/before.js';
import { swapPictures } from '../core/picture.js';
import { replaceBanned } from '../core/banned.js';
import { resolve, recordOf } from '../core/people.js';
import { cancelled } from './guard.js';
import { readRows, paragraphs } from './redo-rows.js';
import { withoutHeld } from '../rules/hold.js';
import { requestsFor } from './estimate.js';

const failure = (text, more = {}) => Object.assign(new Error(text), more);
const clone = value => (value == null ? value : structuredClone(value));
const nameOfPerson = person => person.ko || person.names?.[0] || '';

/** 새 글을 옛 문단 자리에 끼울 꼴로: 앞뒤 빈칸은 옛 문단의 것 */
const fit = (old, text) => /^\s*/.exec(old)[0] + String(text).trim() + /\s*$/.exec(old)[0];

const LEAD_MARKS = /^(?:\s|<[^<>]*>|[*_~`"'“”‘’「『])+/u;

/**
 * 요청 글에서 그 문단을 가리킬 글: 문단 첫머리의 태그 · 꾸밈 기호 · 여는 따옴표를 떼고, 다음 태그나 줄 끝 앞까지에서 첫 낱말 몇 개.
 * 모델이 받는 문단은 감싼 태그가 벗겨지고 태그 속성이 짧은 표시로 줄어 있어서(core/protect.js), 원문 첫 글자들을 그대로 따면 요청 글에 없는 글이 된다.
 */
export function pointerOf(lead) {
    const run = /^[^<\n]*/.exec(String(lead ?? '').replace(LEAD_MARKS, ''))[0];
    return run.trim().split(/\s+/).slice(0, 6).join(' ').slice(0, 40).trim();
}

/** 이번 말투 칸에 적은 글(비었으면 '') */
const guidanceOf = (deps, choice) => typedTone(deps, choice);

/**
 * 앞 번역문(사용자가 같이 보내기를 골랐을 때만): 보내는 문단 원문 → 그 문단의 지금 번역문. 통째로만 알면 글 하나.
 * @param {object} choice  @param {(src: string) => string | undefined} bySource  @param {string} whole 문단으로 못 나눌 때의 앞 번역문 전체
 */
function previousOf(choice, bySource, whole = '') {
    if (!choice.withBefore) return undefined;
    return bySource ?? (String(whole).trim() ? String(whole).trim() : undefined);
}

/** 이번 말투 칸에 적은 글(매크로를 풀고 한 줄로) */
function typedTone(deps, choice) {
    const typed = String(choice.tone ?? '').trim().replace(/\s+/g, ' ');
    return typed ? String(deps.substitute?.(typed) ?? typed).trim() : '';
}

/** 다시 번역 프롬프트를 적어 두었으면 번역 프롬프트 자리를 그 글로 바꾼 재료 */
function withRedoPrompt(deps, plan) {
    const method = String(deps.redoPrompt?.() ?? '').trim();
    return method ? { ...plan, method } : plan;
}

/** 바로잡은 주인: 엔진이 그 문단 머리에 사람 표의 글자로 적어 보낸다(job/engine.js knownSpeakers) */
const fixedOf = (rows, owners) => rows.filter(row => fixedWho(row, owners)).map(row => ({ src: row.src.body, lead: pointerOf(row.lead), who: fixedWho(row, owners) }));

/**
 * @param {object} message 다시 번역할 메시지
 * @param {object} deps 맨 위 주석의 꼴
 * @returns {{ data: () => object, onWho: (ats: number[], who: string) => Promise<boolean>, job: (choice: object, guard: object) => object }}
 */
export function openRedo(message, deps) {
    const owners = new Map();   // 이번 판에서 바로잡은 주인(at → 이름). 기록이 없는 예전 번역은 여기만 남는다(이번 다시 번역에만 쓰임)

    const read = target => {
        const plan = deps.prepare(target);
        if (!plan) return null;
        const people = plan.people ?? [];
        const names = [...new Set(people.map(nameOfPerson).filter(Boolean))];
        const built = readRows(target, { source: plan.original, translation: translationOf(target), hold: plan.hold, people, names });
        return { plan, people, names, ...built };
    };
    const whoOf = row => (owners.has(row.at) ? [owners.get(row.at)] : row.who);

    return {
        /** 판에 줄 자료(ui/panel/redo.js 의 data 꼴) + even(고를 문단을 내놓을 수 있나) */
        data() {
            const state = read(message);
            if (!state) return { rows: [], names: [], tones: {}, wholeRequests: 0, even: false };
            const tones = {};
            for (const person of state.people) if (person.style && nameOfPerson(person)) tones[nameOfPerson(person)] = person.style;
            return {
                rows: state.rows.map(row => ({ at: row.at, said: row.said, who: whoOf(row), text: row.text })),
                names: state.names, tones, guessed: state.guessed, even: state.even,
                // 받은 뒤 확인에 걸린 대사 문단(job/redo-rows.js doubt): 판이 처음 열릴 때 골라 둔다
                picked: state.rows.filter(row => row.doubt && row.said).map(row => row.at),
                wholeRequests: Math.max(1, requestsFor(state.plan)),
            };
        },
        /** 누구 말인지 바로잡기: 기록이 있으면 그 문단에 '사용자가 바로잡음'으로 적고 저장. @returns {Promise<boolean>} 기록에 적었나 */
        async onWho(ats, who) {
            const state = read(message), saved = message.extra?.llmt_pairs;
            if (!state || !who) return false;
            let wrote = false;
            for (const row of state.rows.filter(r => ats.includes(r.at))) {
                owners.set(row.at, who);
                if (row.unit >= 0 && setWho(saved, row.unit, recordOf(state.people, who))) wrote = true;
            }
            if (!wrote) return false;
            writePairs(message, saved);
            await deps.save(message);
            return true;
        },
        /** 줄에 세울 일. choice = 판의 onGo 꼴 { whole, ats, tone, keepTone } */
        job(choice, guard) {
            return {
                guard, redo: true,
                holds: item => guard.holds(item),
                run: (signal, notify) => runRedo({ deps, guard, choice, signal, notify, read, owners }),
            };
        },
    };
}

/** 줄이 돌리는 일: 대상 · 연결이 바뀌는지 지켜보며(job/run.js watched) 글 전체나 고른 대사를 다시 받는다 */
function runRedo(o) {
    const { deps, guard, choice, signal } = o;
    return watched({ guard, signal, connection: deps.connection ?? (() => '') }, async inner => {
        if (choice.keepTone && choice.tone?.trim()) await keepTone(deps, choice.keepTone, choice.tone.trim());
        const work = { ...o, signal: inner };
        return choice.whole ? redoWhole(work) : redoPicked(work);
    });
}

/** 말투 적어 두기는 번역보다 먼저(요청이 실패해도 사용자가 적은 말투는 남게). 못 적어도 번역은 한다 */
async function keepTone(deps, name, tone) {
    try { await deps.saveTone?.(name, tone); } catch (error) { console.warn('[번역] 말투를 적어 두지 못했어요', error); }
}

/** 다시 번역은 늘 새로 받는다(fresh: 이 글의 번역 기억을 쓰지 않는다). 엔진 한 번과 멈춤 다시 보내기는 번역 버튼과 같은 것 */
const freshOnce = ({ deps, signal, notify }, plan, more) => translateOnce(plan, {
    ...more, fresh: true, send: deps.send, signal, notify, stallRetries: deps.stallRetries ?? 0, engine: deps.engine,
});

/**
 * 고른 대사의 주인을 사람 줄에 늘 넣게 한 재료: 사람 목록에 있으면 그 사람을, 없는 이름(사용자가 방금 적은 이름)은 이름만 든 사람으로 더한다.
 * @returns {{ plan: object, always: string[] }}
 */
function withSpeakers(plan, names) {
    const people = [...(plan.people ?? [])], always = [];
    for (const name of names) {
        let person = resolve(people, name);
        if (!person) { person = { id: `speaker:${name}`, names: [name] }; people.push(person); }
        always.push(person.id);
    }
    return { plan: { ...plan, people }, always };
}

/** 바로잡은 주인: 이번 판에서 고른 것 → 기록에 바로잡음으로 적힌 것 */
const fixedWho = (row, owners) => owners.get(row.at) ?? (row.fixed ? row.who[0] ?? '' : '');

// ── 글 전체 ──

async function redoWhole(work) {
    const { deps, guard, choice, read, owners } = work;
    const state = read(guard.target());
    if (!state) return null;
    const fixed = fixedOf(state.rows, owners);
    const sent = withSpeakers(withRedoPrompt(deps, state.plan), fixed.map(f => f.who));
    const plan = sent.plan, now = translationOf(guard.target());
    // 앞 번역문: 짝 기록이 있으면 보내는 조각마다(원문 조각 지문 → 그 조각의 지금 번역문), 없으면 통째로
    const kept = reusable(guard.target().extra?.llmt_pairs, now, plan.hold);
    const bySource = kept.size ? src => { const text = kept.get(mark(src)); return text === undefined ? '' : withoutHeld(text, plan.hold).trim(); } : null;
    const previous = previousOf(choice, bySource, withoutHeld(now, plan.hold));
    const out = await freshOnce(work, plan, { redo: true, guidance: guidanceOf(deps, choice), fixed, previous, always: sent.always });
    if (out.failed.length && !out.got) throw failure('번역을 하나도 받지 못했어요.', { refused: true });

    const target = await stillThere(guard);
    const before = translationOf(target), beforePairs = clone(target.extra?.llmt_pairs ?? null);
    let text = out.text, source = plan.original, pairs = out.pairs;
    if (target.mes !== guard.source()) {
        // 번역하는 동안 그림 표시만 바뀌었으면 그 자리만 새 것으로(짝 기록은 원문 자리가 어긋나 버린다)
        source = deps.prepare(target)?.original ?? source;
        text = swapPictures(text, plan.original, source);
        if (text === null) throw cancelled('text');
        pairs = null;
    }
    if (pairs) carryFixes(pairs, state.rows, owners, state.people);
    text = replaceBanned(text);
    attach(target, { text, pairs, hash: String(deps.hash(source)) });
    if (before) keepBefore(target, text, { text: before, pairs: beforePairs });
    guard.acceptShown();
    await deps.save(target);
    return { failed: out.failed.length, retryRequests: retryRequests(plan, out.failed), requests: out.requests ?? 0, prompt: plan.promptTitle };
}

/** 사용자가 바로잡은 주인을 새 짝 기록의 같은 원문 자리 문단에 옮겨 적는다 */
function carryFixes(pairs, rows, owners, people = []) {
    for (const row of rows) {
        const who = fixedWho(row, owners);
        if (!who) continue;
        const unit = pairs.units.findIndex(([from, to]) => from === row.src.start && to === row.src.end);
        if (unit >= 0) setWho(pairs, unit, recordOf(people, who));
    }
}

// ── 고른 대사 ──

/** 고른 문단과 그 원문을 모은다. 고를 수 없으면 오류 */
function pickRows(state, ats) {
    const wanted = new Set(ats);
    const rows = state.rows.filter(row => wanted.has(row.at));
    if (!state.even || !rows.length || rows.length !== wanted.size) throw failure('고른 문단을 이 번역에서 찾지 못했어요. 판을 다시 열어 주세요.');
    const source = rows.map(row => row.src.body).join('\n\n');
    if (paragraphs(source, state.plan.hold).length !== rows.length) throw failure('이 문단들은 따로 번역할 수 없어요. 글 전체를 재번역해 주세요.');
    return { rows, source };
}

async function redoPicked(work) {
    const { deps, guard, choice, read, owners } = work;
    const state = read(guard.target());
    if (!state) return null;
    const { rows, source } = pickRows(state, choice.ats ?? []);
    const translation = translationOf(guard.target());
    const speakers = [...new Set(rows.flatMap(row => (owners.has(row.at) ? [owners.get(row.at)] : row.who)).filter(Boolean))];
    const sent = withSpeakers(withRedoPrompt(deps, state.plan), speakers);
    // 앞 번역문: 고른 문단마다 그 문단의 지금 번역문(문단 원문으로 찾는다)
    const before = new Map(rows.map(row => [row.src.body.trim(), withoutHeld(row.text, state.plan.hold).trim()]));
    const previous = previousOf(choice, src => before.get(String(src).trim()) ?? '');
    const out = await freshOnce(work, sent.plan, { text: source, redo: true, guidance: guidanceOf(deps, choice), fixed: fixedOf(rows, owners), previous, always: sent.always });
    if (out.failed.length) throw failure('이번에도 번역을 다 받지 못해서 바꾸지 않았어요.');
    const got = paragraphs(out.text, state.plan.hold);
    if (got.length !== rows.length) throw failure(`보낸 문단은 ${rows.length}개인데 ${got.length}개로 돌아와서 바꾸지 않았어요. 다시 해 주세요.`);

    const target = await stillThere(guard);
    if (translationOf(target) !== translation) throw failure('그 사이 번역문이 바뀌어서 붙이지 않았어요.', { cancelled: true, reason: 'display' });
    const swapped = swapParagraphs(translation, rows.map(row => row.part), got.map(part => replaceBanned(part.body)));
    if (paragraphs(swapped.text, state.plan.hold).length !== paragraphs(translation, state.plan.hold).length) throw failure('번역 답을 문단에 맞춰 넣지 못했어요.');
    const pairs = clone(target.extra?.llmt_pairs ?? null);
    const units = pairs ? renewUnits(pairs, rows, out.pairs) : [];
    attach(target, { text: swapped.text, pairs, hash: target.extra.original_text_hash });
    keepBefore(target, swapped.text, { paras: swapped.paras, units });
    guard.acceptShown();
    await deps.save(target);
    return { failed: 0, retryRequests: 0, changed: rows.length, requests: out.requests ?? 0, prompt: state.plan.promptTitle };
}

/**
 * 문단 자리(차례대로, 겹치지 않음)에 새 글을 끼운다.
 * @returns {{ text: string, paras: [number, number, string][] }} paras = 새 글에서의 자리와 그 자리의 옛 글(되돌리기용)
 */
export function swapParagraphs(text, parts, bodies) {
    const order = parts.map((part, k) => [part, bodies[k]]).sort((a, b) => a[0].start - b[0].start);
    let out = '', at = 0;
    const paras = [];
    for (const [part, body] of order) {
        out += text.slice(at, part.start);
        const old = text.slice(part.start, part.end), next = part.fit === false ? body : fit(old, body);
        paras.push([out.length, out.length + next.length, old]);
        out += next;
        at = part.end;
    }
    return { text: out + text.slice(at), paras };
}

/**
 * 바꾼 문단의 짝 기록 줄을 새 번역의 것으로: 번역 문단 지문과 누가 말했는지(사용자가 바로잡은 주인은 그대로).
 * @returns {[number, any[]][]} 바꾸기 전 줄(되돌리기용)
 */
function renewUnits(pairs, rows, fresh) {
    const before = rows.filter(row => row.unit >= 0).map(row => [row.unit, clone(pairs.units[row.unit])]);
    const got = fresh?.units?.filter(([from]) => from >= 0) ?? [];
    if (got.length !== rows.length) return before;   // 새 기록의 문단 수가 다르면 지문은 두고, 짝은 앞뒤 문단 사이 개수로 찾게 둔다
    rows.forEach((row, k) => {
        const unit = pairs.units[row.unit];
        if (!unit) return;
        unit[2] = got[k][2];
        if (unit[3]?.[2]) return;
        if (got[k][3]) unit[3] = got[k][3]; else unit.length = 3;
    });
    return before;
}

// ── 되돌리기 ──

/** 되돌리기 상태: null = 보관한 것 없음, 'undo' = 앞 번역으로 되돌릴 수 있음, 'redo' = 되돌린 뒤라 다시 새 번역으로 */
export function undoState(message) {
    const saved = readBefore(message);
    return saved ? (saved.undone ? 'redo' : 'undo') : null;
}

/**
 * 보관한 앞 번역과 지금 번역을 맞바꾼다(바뀐 문단만). 한 번 더 부르면 다시 돌아온다. 저장은 부르는 쪽이 한다.
 * @returns {boolean} 바꿨나
 */
export function undoRedo(message) {
    const saved = readBefore(message);
    if (!saved) return false;
    const now = translationOf(message), pairs = clone(message.extra?.llmt_pairs ?? null);
    const hash = message.extra.original_text_hash;
    if (typeof saved.text === 'string') {
        attach(message, { text: saved.text, pairs: clone(saved.pairs), hash });
        keepBefore(message, saved.text, { text: now, pairs, undone: !saved.undone });
        return true;
    }
    const parts = saved.paras.map(([start, end]) => ({ start, end, fit: false }));
    const swapped = swapParagraphs(now, parts, saved.paras.map(p => p[2]));
    const units = [];
    for (const [unit, row] of saved.units || []) {
        if (!pairs?.units?.[unit]) continue;
        units.push([unit, pairs.units[unit]]);
        pairs.units[unit] = row;
    }
    attach(message, { text: swapped.text, pairs, hash });
    keepBefore(message, swapped.text, { paras: swapped.paras, units, undone: !saved.undone });
    return true;
}
