// 상태창 번역의 저장(캐릭터마다 파일 하나, 그룹은 그룹마다). 글만 다룬다: 파일을 읽고 쓰는 손은 넘겨받는다.
// screen/records.js 와 같은 함수(line · learn · fix · gaveUp · wants · adopt · strings · dirty · data · size)를 그대로 내주므로
// screen/dress.js 와 screen/live.js 가 이것을 그대로 쓸 수 있다. 더한 것: 줄마다 원문 · 원문이 있던 곳 · 마지막으로 나온 날, 상한, 목록 화면용 함수.
//
// 저장 꼴(v: 2)
//   { v: 2, rows: { 열쇠: 줄 }, taken?: [옛 채팅 기록을 받아 온 채팅 id] }
//   열쇠  'l:' + 줄 열쇠(글자 · 숫자만 + '#조각 수')  화면의 한 줄
//         's:' + 글                                   글 조각 하나(스크립트가 만든 글 · "{0}" 틀)
//   줄    { t: 번역 | [조각 번역 …] | null,   null = 보냈는데 원문 그대로 와서 다시 보내지 않는 줄
//           src: 원문 | [조각 원문 …],        모르면 ''(옛 꼴에서 온 줄: 다음에 화면에 나올 때 채운다)
//           seen: 마지막으로 나온 날(1970-01-01 부터 센 날 수, 0 = 모름),
//           at?: { kind: 'message' | 'regex' | 'worldinfo', chat?, mes?, name?, regex?, character? },  모르면 없음
//           hand?: 1  직접 고친 줄(모델 번역이 덮지 않고, 상한에도 안 지워진다)
//           redo?: 1  다시 번역받을 줄(번역은 그대로 보이고, 새 번역이 오면 바뀐다) }
// 옛 꼴(v: 1, screen/records.js)을 읽으면 새 꼴로 받아들이되 dirty 는 켜지 않는다(열자마자 저장하지 않는다).
//
// 파일 이름: 새 번역기는 translation-status-<해시>.json 에 쓴다. 옛 번역기가 쓰는 llmt-screen-<해시>.json 은 읽기만 한다
//   (새 파일이 아직 없을 때 처음 값으로). 같은 파일에 새 꼴로 쓰면 옛 번역기가 제 기록을 못 읽는다.

import { keyOf, answer } from '../screen/lines.js';
import { hashOf } from './layers.js';

/** 캐릭터 열쇠(아바타 파일 이름, 그룹은 'group:id') → 새 파일 이름 / 옛 번역기의 파일 이름(읽기만) */
export const statusFile = key => `translation-status-${hashOf(key || 'none')}.json`;
export const oldStatusFile = key => `llmt-screen-${hashOf(key || 'none')}.json`;

// 조각이 여럿인 줄(한 줄 안에서 태그로 나뉜 글)을 목록과 고치는 칸에서 한 줄로 보일 때 조각 사이에 두는 표시. 이것 하나만 쓴다
export const PIECE_GAP = ' | ';

const DAY = 86400000;
// 상한(줄 수). 정규식 틀 백여 개와 스크립트 백 개 가까이에서 나오는 번역 단위가 모두 3천 개 남짓이라,
//   한 캐릭터가 그것을 다 써도 남고 값이 바뀌는 줄(메시지마다 새로 나오는 상태창 줄)을 천 개쯤 더 담는다.
//   옛 기록 파일은 하나에 2MB · 1만 줄까지 컸는데 그 절반쯤이 모든 채팅의 옛 공용 기록을 통째로 받아 온 것이었다
export const LIMIT = 4000;

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const lineId = line => `l:${line.key}#${line.nodes.length}`;
const stringId = text => `s:${text}`;
const isTemplate = id => id.startsWith('s:') && /\{\d\}/.test(id);
const srcOf = line => (line.nodes.length > 1 ? line.nodes.map(n => squash(n.nodeValue)) : line.text);

/** 받은 자료 → 줄 모음(Map). 옛 꼴이면 바꿔 읽는다 */
function readRows(data) {
    if (data?.v === 2 && data.rows && typeof data.rows === 'object') return new Map(Object.entries(data.rows));
    if (data?.v === 1) return fromV1(data);
    return new Map();
}

/** 옛 꼴: lines(열쇠 → 번역) · strings(글 → 번역) · hand · tried. 줄 원문은 적혀 있지 않아, 같은 번역을 가진 글 조각이 있으면 그 글을 원문으로.
 *  나온 날은 모른다. 다만 줄 · 글 조각 양쪽에 같은 번역이 든 쌍은 옛 공용 기록을 통째로 받아 온 것(adopt)이라 0,
 *  그 밖의 줄은 이 캐릭터 화면에서 번역받은 것이라 1 로 둔다: 상한에 닿으면 받아 온 것부터 지워진다 */
function fromV1(d) {
    const rows = new Map(), hand = new Set(d.hand || []);
    const textOf = new Map(), paired = new Set();
    for (const [text, t] of Object.entries(d.strings || {})) textOf.set(`${keyOf(text)}#1`, { text, t });
    for (const [key, t] of Object.entries(d.lines || {})) {
        const twin = textOf.get(key), pair = twin && twin.t === t;
        if (pair) paired.add(twin.text);
        rows.set(`l:${key}`, { t, src: pair ? twin.text : '', seen: pair ? 0 : 1, ...(hand.has(key) ? { hand: 1 } : {}) });
    }
    for (const [text, t] of Object.entries(d.strings || {})) rows.set(stringId(text), { t, src: text, seen: paired.has(text) ? 0 : 1, ...(hand.has(`s:${text}`) ? { hand: 1 } : {}) });
    for (const key of d.tried || []) {
        const id = key.startsWith('s:') ? key : `l:${key}`;
        if (!rows.has(id)) rows.set(id, { t: null, src: key.startsWith('s:') ? key.slice(2) : '', seen: 0 });
    }
    return rows;
}

/** 글 조각 기록: 읽을 때마다 그 줄이 나온 것으로 적는 Map(screen/dress.js · strings.js 의 fill 이 get 으로 읽는다) */
class SeenMap extends Map {
    constructor(onGet) { super(); this.onGet = onGet; }
    get(key) { const value = super.get(key); if (value !== undefined) this.onGet(key); return value; }
}

/**
 * @param {object | null} data 파일에서 읽은 것(없으면 null)
 * @param {{ limit?: number, today?: () => number }} [options] today: 오늘의 날 수(시험용)
 */
export function open(data, { limit = LIMIT, today = () => Math.floor(Date.now() / DAY) } = {}) {
    const rows = readRows(data), taken = new Set(Array.isArray(data?.taken) ? data.taken : []);
    const shown = new Set();
    let dirty = false;
    const strings = new SeenMap(text => touch(stringId(text)));
    for (const [id, row] of rows) if (id.startsWith('s:') && row.t != null) Map.prototype.set.call(strings, id.slice(2), row.t);

    /** 줄이 화면에 나왔다: 날이 바뀌었을 때만 적는다(같은 날 여러 번 나와도 저장은 한 번) */
    function touch(id, line) {
        const row = rows.get(id);
        if (!row) return;
        shown.add(id);
        const day = today();
        if (row.seen !== day) { row.seen = day; dirty = true; }
        if (!row.src && line) { row.src = srcOf(line); dirty = true; }
    }
    function put(id, row) {
        rows.set(id, row);
        if (id.startsWith('s:')) { if (row.t == null) strings.delete(id.slice(2)); else Map.prototype.set.call(strings, id.slice(2), row.t); }
        dirty = true;
    }
    function drop(id) {
        if (!rows.delete(id)) return false;
        if (id.startsWith('s:')) strings.delete(id.slice(2));
        dirty = true;
        return true;
    }
    /** 모델 번역을 적는다. 직접 고친 줄은 다시 번역받기로 표시했을 때만 덮는다 */
    function learnRow(id, t, src, from) {
        const old = rows.get(id);
        if (old?.hand && !old.redo) return;
        put(id, clean({ t, src, seen: today(), at: from ?? old?.at }));
    }
    function giveUp(id, src, from) {
        const old = rows.get(id);
        if (old?.t != null) { if (old.redo) { delete old.redo; dirty = true; } return; }
        put(id, clean({ t: null, src, seen: today(), at: from ?? old?.at }));
    }
    const wanted = id => { const row = rows.get(id); return !row || !!row.redo; };

    const self = {
        strings,
        /** 이 줄의 번역(없으면 undefined). 나온 날도 적는다 */
        line(line) {
            const id = lineId(line), row = rows.get(id);
            if (row?.t == null) return undefined;
            touch(id, line);
            return row.t;
        },
        /** 모델이 준 번역. from: 원문이 있던 곳(placer 가 만든 것, 모르면 안 준다) */
        learn: (line, record, from) => learnRow(lineId(line), record, srcOf(line), from),
        learnString: (text, value, from) => learnRow(stringId(text), value, text, from),
        /** 손으로 고친 번역. 늘 이긴다 */
        fix: (line, record) => put(lineId(line), clean({ ...rows.get(lineId(line)), t: record, src: srcOf(line), seen: today(), hand: 1, redo: undefined })),
        fixString: (text, value) => put(stringId(text), clean({ ...rows.get(stringId(text)), t: value, src: text, seen: today(), hand: 1, redo: undefined })),
        /** 보냈는데 원문 그대로 돌아온 것. 다시 보내지 않는다 */
        gaveUp: (line, from) => giveUp(lineId(line), srcOf(line), from),
        gaveUpString: (text, from) => giveUp(stringId(text), text, from),
        /** 번역을 요청해야 하는가(없는 줄, 다시 번역받기로 표시한 줄) */
        wants: line => wanted(lineId(line)),
        wantsString: text => wanted(stringId(text)),
        /** 옛 기록(글 → 번역)을 받아들인다. 이미 있는 것은 둔다. 나온 날은 모름(0: 상한에 닿으면 먼저 지워진다) */
        adopt(old, from) {
            for (const [text, t] of Object.entries(old || {})) {
                if (typeof t !== 'string' || !t) continue;
                const src = squash(text), key = keyOf(src), lid = `l:${key}#1`;
                if (key && !rows.has(lid)) put(lid, clean({ t, src, seen: 0, at: from }));
                if (!rows.has(stringId(text))) put(stringId(text), clean({ t, src: text, seen: 0, at: from }));
            }
        },
        /** 옛 채팅 기록을 받아 온 채팅인가 / 받아 왔다고 적기 */
        took: chatId => taken.has(chatId),
        markTaken(chatId) { if (!taken.has(chatId)) { taken.add(chatId); dirty = true; } },
        get dirty() { return dirty; },
        /** 저장에 실패했을 때: 다음에 다시 저장하게 */
        keepDirty() { dirty = true; },
        /** 저장할 꼴. 상한을 넘었으면 오래 안 나온 줄부터 지운다 */
        data() {
            trim(rows, limit, drop);
            dirty = false;
            return { v: 2, rows: Object.fromEntries(rows), ...(taken.size ? { taken: [...taken] } : {}) };
        },
        size: () => rows.size,
        /** 지난 resetShown 뒤로 화면에 나온 줄 id(목록의 '지금 답') */
        shown: () => new Set(shown),
        resetShown: () => shown.clear(),
        ...listTools({ rows, put, drop, today }),
    };
    return self;
}

/** 값이 없는 칸은 저장하지 않는다 */
function clean(row) {
    for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
    return row;
}

/** 상한을 넘은 만큼, 직접 고친 줄과 "{0}" 틀을 빼고 오래 안 나온 줄부터 지운다(같은 날이면 먼저 들어온 줄부터).
 *  "{0}" 틀은 화면 글을 맞출 때 하나씩 읽지 않고 훑어보기만 해서(strings.js fill) 나온 날을 적을 수 없다. 수가 적어(수백 개) 남긴다 */
function trim(rows, limit, drop) {
    let over = rows.size - limit;
    if (over <= 0) return;
    const order = [...rows].filter(([id, row]) => !row.hand && !isTemplate(id)).sort((a, b) => (a[1].seen || 0) - (b[1].seen || 0));
    for (const [id] of order) { if (over-- <= 0) break; drop(id); }
}

// ── 목록 화면(ui/panel/status.js)용 ──

/** 옛 꼴에서 같은 번역을 줄 · 글 조각 양쪽에 넣어 둔 쌍: 목록에는 한 줄로 보이고, 고치기 · 지우기는 둘 다에 한다 */
function twinsOf(rows) {
    const twin = new Map();
    for (const [id, row] of rows) {
        if (!id.startsWith('s:')) continue;
        const lid = `l:${keyOf(squash(id.slice(2)))}#1`, line = rows.get(lid);
        if (line && line.t === row.t && line.t != null) twin.set(lid, id);
    }
    return twin;
}

/** 원문이 있던 곳 → 목록의 kind · name */
function placeName(at) {
    if (!at) return { kind: '', name: '' };
    if (at.kind === 'message') return { kind: 'message', name: at.chat ? `${at.chat} #${at.mes}` : '' };
    return { kind: at.kind, name: at.name || '' };
}

function item(id, row, isNow) {
    const pieces = Array.isArray(row.t);
    const src = Array.isArray(row.src) ? row.src.join(PIECE_GAP) : row.src || (id.startsWith('l:') ? id.slice(2).replace(/#\d+$/, '') : '');
    return clean({
        id, text: pieces ? row.t.join(PIECE_GAP) : row.t, src, ...placeName(row.at),
        regex: row.at?.kind === 'message' ? row.at.regex : undefined, character: row.at?.character,
        manual: !!row.hand, now: isNow, redo: row.redo ? true : undefined,
        pieces: pieces ? [...row.t] : undefined,
    });
}

/** 다시 번역받을 때 모델에 보낼 글(조각이 여럿이면 ⟪n⟫ 번호표: screen/lines.js 의 ask 와 같은 꼴) */
function askText(id, row) {
    if (Array.isArray(row.src)) return row.src.map((p, i) => `⟪${i + 1}⟫${p}`).join('');
    return row.src || '';
}

function listTools({ rows, put, drop, today }) {
    const withTwins = ids => {
        const twin = twinsOf(rows), out = new Set();
        for (const id of ids) { out.add(id); if (twin.has(id)) out.add(twin.get(id)); }
        return [...out];
    };
    /** 손으로 고친 번역 → 저장할 꼴. 조각이 여럿인 줄은 조각 배열이나 조각 사이를 '|' 로 나눈 글(목록에 보이는 꼴 그대로). 조각 수가 안 맞으면 null */
    const shapeEdit = (row, text) => {
        const n = Array.isArray(row.t) ? row.t.length : Array.isArray(row.src) ? row.src.length : 1;
        if (n === 1) return Array.isArray(text) ? (text.length === 1 ? String(text[0]) : null) : String(text);
        if (Array.isArray(text)) return text.length === n ? text.map(String) : null;
        const parts = String(text).split('|').map(part => part.trim());
        return parts.length === n ? parts : null;
    };
    return {
        /**
         * 목록: 번역이 있는 줄 전부(쌍은 한 줄로). now = 지금 답에 나온 줄 id.
         * onlySeen: 이 캐릭터 화면에 나온 적 없는 줄(나온 날 0: 옛 기록에서 통째로 받아 온 줄, 다른 캐릭터 글이 섞여 있었다)은 뺀다.
         *   지우지는 않는다: 그 글이 화면에 나오면 저장된 번역이 쓰이고 나온 날이 적혀 그때부터 보인다. 직접 고친 줄은 늘 보인다
         */
        list({ now = new Set(), onlySeen = false } = {}) {
            const twin = twinsOf(rows), hidden = new Set(twin.values()), out = [];
            const seen = (id, row) => row.hand || row.seen || rows.get(twin.get(id))?.seen;
            for (const [id, row] of rows) {
                if (row.t == null || hidden.has(id) || (onlySeen && !seen(id, row))) continue;
                out.push(item(id, row, now.has(id) || now.has(twin.get(id))));
            }
            return out;
        },
        /** 줄 고치기(직접 고침 표시) → 고쳤나 */
        edit(id, text) {
            const row = rows.get(id);
            if (!row || row.t == null) return false;
            const t = shapeEdit(row, text);
            if (t == null) return false;
            for (const each of withTwins([id])) put(each, clean({ ...rows.get(each), t: each === id ? t : [t].flat().join(' '), seen: today(), hand: 1, redo: undefined }));
            return true;
        },
        /** 줄 지우기(다음에 나오면 새로 번역) → 지운 줄 수(쌍은 하나로 센다) */
        remove(id) {
            if (!rows.has(id)) return 0;
            withTwins([id]).forEach(drop);
            return 1;
        },
        removeMany(ids) {
            const all = withTwins(ids);
            let n = 0;
            for (const id of ids) if (rows.has(id)) n++;
            all.forEach(drop);
            return n;
        },
        /** 전부 비우기. keepManual 이면 직접 고친 줄은 남긴다 → 지운 줄 수 */
        clear({ keepManual = false } = {}) {
            let n = 0;
            for (const [id, row] of [...rows]) if (!(keepManual && row.hand)) { drop(id); n++; }
            return n;
        },
        /** 다시 번역받을 줄 표시 → 보낼 글 [{ id, text }](원문을 모르는 줄은 빼고) */
        markRedo(ids) {
            const asks = [];
            for (const id of ids) {
                const row = rows.get(id), text = row && askText(id, row);
                if (!text) continue;
                if (!row.redo) put(id, { ...row, redo: 1 });
                asks.push({ id, text });
            }
            return asks;
        },
        /** 다시 번역받기로 표시된 줄 전부의 보낼 글 */
        redoAsks: () => [...rows].filter(([, row]) => row.redo).map(([id, row]) => ({ id, text: askText(id, row) })).filter(a => a.text),
        /** 다시 받은 답을 적는다 → 'learned' | 'unchanged' | 'rejected' */
        takeRedo(id, reply) {
            const row = rows.get(id);
            if (!row) return 'rejected';
            const n = Array.isArray(row.src) ? row.src.length : 1, sent = askText(id, row);
            if (squash(reply).replace(/\s/g, '') === sent.replace(/\s/g, '')) { put(id, clean({ ...row, redo: undefined })); return 'unchanged'; }
            const t = answer({ nodes: { length: n } }, reply);
            const slotsKept = (sent.match(/\{\d\}/g) || []).every(slot => String(reply).includes(slot));
            if (t == null || !slotsKept) return 'rejected';
            put(id, clean({ ...row, t, seen: today(), hand: undefined, redo: undefined }));
            return 'learned';
        },
    };
}

/**
 * 목록의 줄 가운데 이 글(지금 답의 화면 글자)에 나오는 것. 글자 · 숫자만 견준다. 줄마다(줄바꿈으로 나눈 조각마다) 견줘서
 * 한 글자짜리 줄이 긴 글 아무 데나 걸리지 않게 한다.
 * @param {string[]} ids 줄 열쇠('l:…#n' · 's:…')  @param {string} text
 * @returns {Set<string>}
 */
export function shownIn(ids, text) {
    const keys = new Set(String(text ?? '').split('\n').map(keyOf).filter(Boolean));
    const keyFor = id => (id.startsWith('s:') ? keyOf(id.slice(2)) : id.slice(2).replace(/#\d+$/, ''));
    return new Set(ids.filter(id => keys.has(keyFor(id))));
}

/**
 * 원문이 있던 곳을 가리는 함수를 만든다(메시지 하나를 그릴 때 한 번). 글자 · 숫자만 견준다(screen/lines.js keyOf).
 * 차례: 그 메시지에 걸린 정규식 틀에 있으면 정규식, 월드인포 항목 글에 있으면 월드인포, 메시지 글에 있으면 메시지, 어디에도 없으면 null(지어내지 않는다).
 * 월드인포 글은 화면에 직접 그려지지 않고 모델이 따라 써서 메시지에 들어오므로, 메시지보다 먼저 본다.
 * @param {object} p
 * @param {string} [p.chat] 채팅 이름  @param {number} [p.mes] 메시지 번호  @param {string} [p.message] 메시지 글
 * @param {{ name: string, text: string }[]} [p.regexes] 이 메시지에 걸린 정규식(이름, 바꿀 글)
 * @param {{ name: string, text: string }[]} [p.worldinfo] 이 채팅에 쓰이는 월드인포 항목(이름, 글)
 * @param {string} [p.character] 캐릭터 이름(그룹이면 그 메시지를 쓴 사람)
 * @returns {(text: string) => object | undefined}
 */
export function placer({ chat, mes, message = '', regexes = [], worldinfo = [], character } = {}) {
    // 태그 이름 · 속성도 글자라 견주기 전에 뺀다(빼지 않으면 '<span>消息</span>' 의 열쇠에 'span' 이 끼어 '消息发现' 이 안 맞는다)
    const letters = text => keyOf(String(text ?? '').replace(/<[^>]*>/g, ' '));
    const keyed = list => list.map(x => ({ name: x.name, key: letters(x.text) })).filter(x => x.key);
    const rx = keyed(regexes), wi = keyed(worldinfo), body = letters(message);
    const drawn = regexes[0]?.name;
    return text => {
        const key = keyOf(text);
        if (!key) return undefined;
        const at = (kind, extra) => clean({ kind, ...extra, character });
        const r = rx.find(x => x.key.includes(key));
        if (r) return at('regex', { name: r.name });
        const w = wi.find(x => x.key.includes(key));
        if (w) return at('worldinfo', { name: w.name });
        if (body.includes(key) && chat) return at('message', { chat, mes, regex: drawn });
        return undefined;
    };
}

/**
 * 바뀐 것을 모아 한 번에 저장한다.
 * @param {ReturnType<typeof open>} rec
 * @param {(data: object) => Promise<unknown>} save 파일에 쓰는 손
 * @param {{ wait?: number }} [options] wait: 마지막 바뀜 뒤 기다릴 ms
 * @returns {{ soon: () => void, flush: () => Promise<void> }}
 */
export function saver(rec, save, { wait = 1500 } = {}) {
    let timer = 0, chain = Promise.resolve();
    const flush = () => {
        clearTimeout(timer);
        chain = chain.then(() => (rec.dirty ? save(rec.data()) : undefined)).catch(() => rec.keepDirty());   // 못 쓰면 다음 저장 때 다시
        return chain;
    };
    return { soon() { clearTimeout(timer); timer = setTimeout(flush, wait); }, flush };
}
