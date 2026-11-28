// 상태창 · 카드 글자 번역을 화면에 붙이는 곳(브라우저에서만 돈다). 줄 뽑기 · 맞추기 · 기록은 옆의 순수 파일들이 하고,
// 여기는 화면 찾기 · 번역 요청 · 기록 파일 읽고 쓰기 · 입히는 때만 맡는다. 실리태번에 닿는 것은 전부 넘겨받는다(host).
//
// 견주는 동안은 옛 방식 옆에서 돈다: 이 브라우저에서 켰을 때만(localStorage llmt_screen2 = '1'), 옛 방식의 글자 모으기 · 입히기는 그때 한꺼번에 쉰다.

import { scan, ask, answer, holes, isLetterRun } from './lines.js';
import { stringsOf, valuesOf } from './strings.js';
import { open } from './records.js';
import { dress } from './dress.js';
import { ask as askModel, TOGETHER_NOTE } from './ask.js';
import { fromOld } from '../store/carry.js';
import * as people from '../core/people.js';
import * as terms from '../core/terms.js';

export const enabled = () => {
    if (globalThis.SillyTavern?.getContext?.().extensionSettings?.['llm-translator-custom']?.screen2 === true) return true;
    try { return localStorage.getItem('llmt_screen2') === '1'; } catch { return false; }
};

const books = new Map();      // 기록 이름 → { rec, ready(약속) }
const seen = new WeakMap();   // 글 조각 → 우리가 써 넣은 글
const watched = new WeakSet();   // 감시를 붙인 iframe 문서

/** 캐릭터의 기록. 처음 열 때 파일에서 읽고, 비어 있으면 옛 기록을 읽어 온다 */
function book(host) {
    const name = host.recordName();
    if (!books.has(name)) {
        const entry = { rec: open(null), ready: null };
        entry.ready = host.load(name)
            .then(data => { entry.rec = open(data); })
            .catch(() => { /* 파일이 없거나 못 읽음: 빈 기록으로 시작 */ })
            .then(() => { if (!entry.rec.size()) entry.rec.adopt(host.oldRecords()); });
        books.set(name, entry);
    }
    return books.get(name);
}
let saveTimer = 0;
function saveSoon(host, name, entry) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (entry.rec.dirty) host.save(name, entry.rec.data()).catch(() => {}); }, 1500);
}

/** 이 메시지의 화면들: 본문 칸과 그 안 iframe 의 문서 몸통 */
function roots(host, id) {
    const text = host.textOf(id);
    if (!text) return [];
    const out = [{ root: text, frame: false }];
    for (const frame of text.querySelectorAll('iframe')) {
        let doc = null;
        try { doc = frame.contentDocument; } catch { /* 다른 출처 */ }
        if (doc?.body) out.push({ root: doc.body, frame: true, doc });
    }
    return out;
}

/** 정규식 틀들을 읽어 줄 열쇠와 구멍 든 줄을 뽑는다(틀 글이 같으면 한 번만 읽는다) */
const frameMemo = new Map();
function readTemplates(templates) {
    const keys = new Set(), frames = [];
    for (const html of templates) {
        if (!frameMemo.has(html)) {
            const doc = new DOMParser().parseFromString(`<body>${html.replace(/```[a-z]*\n?|```/g, '')}</body>`, 'text/html'), own = { keys: [], frames: [] };
            for (const line of scan(doc.body)) { const h = holes(line.text); if (h) own.frames.push(h); else if (line.key) own.keys.push(line.key); }
            frameMemo.set(html, own);
        }
        const own = frameMemo.get(html);
        own.keys.forEach(k => keys.add(k)); frames.push(...own.frames);
    }
    return { keys, frames };
}

/** 기록만 입힌다(요청 없음). 본문 칸에서는 정규식 틀에서 나온 줄만 건드린다(본문 문단은 본문 번역의 몫) */
function paint(host, id, entry, tpl) {
    const missing = [];
    for (const r of roots(host, id)) {
        const result = dress(r.root, entry.rec, { skip: host.skip, frames: tpl.frames, seen });
        for (const line of result.missing) if (r.frame || tpl.keys.has(line.key)) missing.push(line);
        if (r.frame && r.doc && !watched.has(r.doc)) {
            watched.add(r.doc);
            // 눌러야 뜨는 화면 · 스크립트가 나중에 채우는 글: 새로 생기거나 바뀐 곳만 다시 입힌다
            let queued = false;
            new r.doc.defaultView.MutationObserver(() => {
                if (queued || host.busy()) return;
                queued = true;
                r.doc.defaultView.requestAnimationFrame(() => {
                    queued = false;
                    if (enabled() && r.doc.body) dress(r.doc.body, entry.rec, { skip: host.skip, frames: tpl.frames, seen });
                });
            }).observe(r.doc.body, { subtree: true, childList: true, characterData: true });
        }
    }
    return missing;
}

/** 화면(iframe 문서) 안에 숨어 있는 글: 숨긴 자료 칸의 값과 스크립트의 문자열. 눌러야 뜨는 화면의 글이 여기서 나온다 */
function hiddenTexts(doc) {
    const out = [];
    doc.querySelectorAll('[style*="display"], [hidden], script[type*="json"]').forEach(el => {
        const hidden = el.hasAttribute('hidden') || /display\s*:\s*none/i.test(el.getAttribute('style') || '') || el.tagName === 'SCRIPT';
        if (hidden) out.push(...valuesOf(el.textContent));
    });
    doc.querySelectorAll('script:not([src])').forEach(script => out.push(...stringsOf(script.textContent || '')));
    return out;
}

/**
 * 물어볼 것을 모은다: 지금 보이는데 번역이 없는 줄 먼저, 그다음 틀의 이름표와 숨은 글.
 * 숨은 글에 개수 상한은 없다: 글 하나가 평균 17자쯤이라 944개짜리 카드도 본문 답 반 개 분량이고, 기록이 캐릭터에 남아 한 번만 든다(11-24 잼)
 * @returns {{ lines: { line: object, text: string }[], strings: string[] }}
 */
function gather(host, id, entry, tpl, missing) {
    const asked = new Set(), lines = [], strings = [];
    for (const line of missing) {
        if (isLetterRun(line)) continue;
        const text = ask(line);
        if (asked.has(text)) continue;
        asked.add(text);
        lines.push({ line, text });
    }
    const addString = text => {
        if (asked.has(text) || !entry.rec.wantsString(text)) return;
        asked.add(text);
        strings.push(text);
    };
    for (const frame of tpl.frames) frame.fixed.forEach(addString);
    for (const r of roots(host, id)) if (r.frame) hiddenTexts(r.doc).forEach(addString);
    return { lines, strings };
}

const sameText = (a, b) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

/** 줄 하나의 답을 기록에 적는다 → 'learned' | 'unchanged'(원문 그대로 옴) | 'rejected'(조각 표시가 안 맞음). 못 쓴 답은 다시 묻지 않게 적어 둔다 */
function learnLine(rec, { line, text }, value) {
    const unchanged = sameText(value, text), record = unchanged ? null : answer(line, value);
    if (line.piece) {
        if (typeof record === 'string') rec.learnString(line.text, record); else rec.gaveUpString(line.text);
    } else if (record) rec.learn(line, record);
    else rec.gaveUp(line);
    return record ? 'learned' : unchanged ? 'unchanged' : 'rejected';
}

/** 글 하나("{0}" 틀 포함)의 답을 기록에 적는다. 값 자리가 그대로 돌아와야 쓴다 */
function learnString(rec, text, value) {
    const slotsKept = (text.match(/\{\d\}/g) || []).every(slot => value.includes(slot));
    if (value === text || !slotsKept) { rec.gaveUpString(text); return value === text ? 'unchanged' : 'rejected'; }
    rec.learnString(text, value);
    return 'learned';
}

/** 무엇을 물어 무엇을 받았는지 세는 것([받은 수, 물은 수]). 모델이 조각 표시 · 값 자리를 지켰는지 보려고 */
function tallyOf(lines, strings) {
    const pieced = lines.filter(x => x.line.nodes.length > 1).length, slotted = strings.filter(t => /\{\d\}/.test(t)).length;
    return { lines: [0, lines.length], pieced: [0, pieced], strings: [0, strings.length], slotted: [0, slotted], unchanged: 0 };
}

const NOTHING = Object.freeze({ put: 0, asked: 0, learned: 0 });

/**
 * 메시지가 그려졌을 때 부른다.
 * @param {object} p
 * @param {number} p.id 메시지 번호
 * @param {boolean} p.fresh 방금 번역을 누른 메시지인가(이때만 요청을 보낸다)
 * @param {boolean} p.pressed 번역을 누른 적이 있는 메시지인가(아니면 입히지도 않는다)
 * @param {string[]} p.templates 이 메시지에 걸린 정규식 틀(replaceString)
 * @param {object} p.host 실리태번 쪽 도구: textOf(id) · skip(el) · busy() · engine()({ send, sources }) · recordName() · load(name) · save(name, data) · oldRecords() · progress(id)
 * @returns {Promise<{ put: number, asked: number, learned: number, tally?: object }>}
 */
export async function rendered({ id, fresh, pressed, templates, host }) {
    if (!pressed) return NOTHING;
    const entry = book(host);
    await entry.ready;
    const tpl = readTemplates(templates);
    const missing = paint(host, id, entry, tpl);
    if (!fresh) return NOTHING;

    const { lines, strings } = gather(host, id, entry, tpl, missing);
    const units = [...lines.map(x => x.text), ...strings], engine = host.engine();
    if (!units.length || !engine) return NOTHING;

    // 저장 이름은 보내기 전에 구해 둔다: 답을 기다리는 사이 다른 캐릭터의 채팅으로 옮기면 그 캐릭터 이름으로 저장돼 기록이 섞인다
    const name = host.recordName();
    const tally = await requestAll({ host, id, entry, tpl, engine, lines, strings, units });
    paint(host, id, entry, tpl);
    saveSoon(host, name, entry);
    return { put: 0, asked: units.length, learned: tally.lines[0] + tally.strings[0], tally };
}

/** 글 하나의 답을 기록에 적고 곧 다시 입히는 함수(요청을 따로 보낼 때도, 본문 요청에 실어 보낼 때도 같이 쓴다) */
function learner({ host, id, entry, tpl, lines, strings, tally }) {
    let queued = false;
    const repaintSoon = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; paint(host, id, entry, tpl); });
    };
    return (i, value) => {
        const isLine = i < lines.length;
        const result = isLine ? learnLine(entry.rec, lines[i], value) : learnString(entry.rec, strings[i - lines.length], value);
        if (result === 'unchanged') tally.unchanged++;
        if (result === 'learned' && isLine) { tally.lines[0]++; if (lines[i].line.nodes.length > 1) tally.pieced[0]++; }
        if (result === 'learned' && !isLine) { tally.strings[0]++; if (/\{\d\}/.test(strings[i - lines.length])) tally.slotted[0]++; }
        repaintSoon();
    };
}

/**
 * 본문 번역을 보내기 전에 부른다: 이 메시지의 화면에서 아직 번역이 없는 글을 모아, 본문 요청에 같이 실을 수 있는 꼴로 돌려준다.
 * 모을 것이 없으면 null. 돌려준 것의 sent 가 true 가 되면 같이 보낸 것이다(따로 요청하지 않는다)
 */
export async function collect({ id, templates, host }) {
    const entry = book(host);
    await entry.ready;
    const tpl = readTemplates(templates);
    const { lines, strings } = gather(host, id, entry, tpl, paint(host, id, entry, tpl));
    const units = [...lines.map(x => x.text), ...strings];
    if (!units.length) return null;
    const tally = tallyOf(lines, strings);
    const name = host.recordName();   // 모을 때의 캐릭터 이름으로 저장한다(위 run 의 주석과 같은 까닭)
    return {
        bodies: units.map(unit => unit.replace(/\s*\n\s*/g, ' ')), note: TOGETHER_NOTE, sent: false, tally,
        onExtra: learner({ host, id, entry, tpl, lines, strings, tally }),
        finish() { paint(host, id, entry, tpl); saveSoon(host, name, entry); },
    };
}

/** 모은 글을 번역해 달라고 보내고, 글 하나의 답이 닫힐 때마다 적고 입힌다(끊겨도 받은 것은 남는다) */
async function requestAll({ host, id, entry, tpl, engine, lines, strings, units }) {
    // 이름 · 말투 · 용어는 본문 번역과 같은 재료에서(틀에 박힌 이름이 본문과 다른 표기로 번역되지 않게)
    const sources = engine.sources(), old = fromOld(sources), joined = units.join('\n');
    const cast = people.pick(old.people, { always: old.always, texts: [joined] });
    const tally = tallyOf(lines, strings);

    const onUnit = learner({ host, id, entry, tpl, lines, strings, tally });

    const end = host.progress(id);
    try {
        await askModel({
            units, send: engine.send, outputTokens: sources.outputTokens, onUnit,
            people: people.block(cast, old.people), terms: terms.block(terms.pick(old.terms, joined)),
        });
    } finally { end(); }
    return tally;
}

/** 시험 · 고치기 화면용: 지금 캐릭터의 기록 */
export const recordsFor = host => book(host).rec;
