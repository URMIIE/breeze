// 문단 번역 기억(하나). 같은 첫 메시지 다시 쓰기, 끊긴 번역 이어 받기, 다시 보내기가 전부 이것을 쓴다.
// 열쇠 = 문단 지문(원문 문단 + 번역을 바꾸는 설정의 지문). 값 = 그 문단의 번역. 크기 상한을 넘으면 오래 안 쓴 것부터 지운다.
// 글만 다룬다: 저장소는 넘겨받는다(브라우저는 store/memory-idb.js, 시험은 가짜).
//
// 저장소 꼴(store)
//   index(): Promise<{ key, size, time, chats }[]>     줄마다 작은 기록(글은 빼고). 처음 한 번 읽어 메모리에 둔다
//   read(keys): Promise<Map<key, text>>
//   write(rows): Promise<void>    rows: { key, size, time, chats, text? }[]  text 가 없으면 작은 기록만 바꾼다(쓴 시각)
//   remove(keys): Promise<void>
//   wipe(): Promise<void>
//
// 부르는 쪽이 지킬 것(옛 번역기의 사고에서): 거절된 답 · 원문 그대로 온 조각은 넣지 않는다. '다시 번역'은 기억을 읽지 않는다(새로 받고 덮어쓴다).

// 상한. AI 답 16,382개가 원문 47.5MB(답 하나 약 2,900자, 11-26 잼)라, 번역 200만 자는 답 700개쯤이다.
//   쓰는 곳(같은 첫 메시지, 지금 답 이어 받기, 최근 답 다시 보내기)은 최근 답 몇십 개면 되고, 브라우저 저장소로는 약 4MB.
//   줄 수 상한은 짧은 문단이 많을 때 작은 기록(메모리에 두는 것)이 커지지 않게
export const LIMITS = Object.freeze({ chars: 2000000, rows: 20000 });
const CHATS_PER_ROW = 4;   // 한 문단을 쓴 채팅을 이만큼까지 적는다(이 채팅 것 비우기용)

/** 글의 지문: 길이 + 64비트 해시 둘(FNV 두 갈래). 같은 글인지만 가린다 */
export function hashOf(text) {
    const s = String(text ?? '');
    let a = 0x811c9dc5, b = 0x050c5d1f;
    for (let i = 0; i < s.length; i++) {
        const ch = s.charCodeAt(i);
        a = Math.imul(a ^ ch, 0x01000193) >>> 0;
        b = Math.imul(b ^ ch, 0x5bd1e995) >>> 0;
    }
    return `${s.length}:${a.toString(36)}${b.toString(36)}`;
}

/**
 * 번역을 바꾸는 설정의 지문. 무엇을 넣을지는 부르는 쪽이 정한다(프롬프트 · 모델 · 규칙).
 * @param {{ prompt?: string, model?: string, rules?: string | string[] }} setup
 */
export const setupMark = ({ prompt = '', model = '', rules = '' } = {}) => hashOf(JSON.stringify([String(prompt), String(model), [rules].flat().map(String)]));

/** 문단 지문(기억의 열쇠) */
export const paragraphKey = (paragraph, mark) => hashOf(`${mark}\u0000${paragraph}`);

/**
 * @param {object} store 위의 꼴
 * @param {{ chars?: number, rows?: number, now?: () => number }} [options]
 */
export function createMemory(store, { chars = LIMITS.chars, rows = LIMITS.rows, now = Date.now } = {}) {
    const meta = new Map();   // key → { key, size, time, chats }
    let loading = null;
    const queued = new Map();   // key → 쓸 줄(글 있음 또는 작은 기록만)

    const ready = () => (loading ??= store.index().then(list => { for (const m of list || []) meta.set(m.key, m); }).catch(() => { /* 저장소를 못 씀: 이번엔 메모리에만 */ }));

    /** 쓴 것으로 적는다(채팅도) */
    function use(m, chat) {
        m.time = now();
        if (chat && m.chats[0] !== chat) m.chats = [chat, ...m.chats.filter(c => c !== chat)].slice(0, CHATS_PER_ROW);
        if (!queued.has(m.key)) queued.set(m.key, { ...m });
        else Object.assign(queued.get(m.key), { time: m.time, chats: m.chats });
    }

    return {
        ready,
        /** 여러 문단을 한 번에 찾는다 → Map(열쇠 → 번역). 찾은 것은 쓴 것으로 적는다 */
        async getMany(keys, { chat } = {}) {
            await ready();
            const want = [...new Set(keys)].filter(k => meta.has(k));
            const found = new Map();
            for (const k of want) if (typeof queued.get(k)?.text === 'string') found.set(k, queued.get(k).text);
            const rest = want.filter(k => !found.has(k));
            if (rest.length) {
                let got = new Map();
                try { got = await store.read(rest); } catch { /* 못 읽으면 없는 것으로 */ }
                for (const [k, text] of got) if (typeof text === 'string') found.set(k, text);
            }
            for (const k of found.keys()) use(meta.get(k), chat);
            return found;
        },
        async get(key, options) { return (await this.getMany([key], options)).get(key); },
        /** 넣는다(같은 열쇠는 덮어쓴다). 저장은 flush 때 한 번에 */
        put(key, text, { chat } = {}) {
            if (typeof text !== 'string' || !text.trim()) return;
            const old = meta.get(key);
            const m = { key, size: text.length, time: now(), chats: old ? [...old.chats] : [] };
            meta.set(key, m);
            use(m, chat);
            queued.get(key).text = text;
            queued.get(key).size = text.length;
        },
        /** 모아 둔 것을 저장하고, 상한을 넘었으면 오래 안 쓴 것부터 지운다 */
        async flush() {
            await ready();
            const rowsOut = [...queued.values()];
            queued.clear();
            const drop = overflow(meta, chars, rows);
            for (const k of drop) meta.delete(k);
            const gone = new Set(drop), keep = rowsOut.filter(r => !gone.has(r.key));
            try {
                if (keep.length) await store.write(keep);
                if (drop.length) await store.remove(drop);
            } catch { /* 저장소를 못 씀: 메모리에 있는 동안만 쓴다 */ }
            return { wrote: keep.length, dropped: drop.length };
        },
        /** 이 문단들을 잊는다(다시 번역을 시작할 때: 새로 받기 전의 번역이 이어 받기에 섞이지 않게) */
        async forget(keys) {
            await ready();
            const known = [...new Set(keys)].filter(k => meta.has(k));
            for (const k of known) { meta.delete(k); queued.delete(k); }
            try { if (known.length) await store.remove(known); } catch { /* 못 지움: 메모리에서는 지워졌다 */ }
            return known.length;
        },
        /** 비우기: chat 을 주면 그 채팅이 쓴 문단만, 안 주면 전부 → 지운 수 */
        async clear({ chat } = {}) {
            await ready();
            if (!chat) {
                const n = meta.size;
                meta.clear(); queued.clear();
                try { await store.wipe(); } catch { /* 못 지움 */ }
                return n;
            }
            const keys = [...meta.values()].filter(m => m.chats.includes(chat)).map(m => m.key);
            for (const k of keys) { meta.delete(k); queued.delete(k); }
            try { if (keys.length) await store.remove(keys); } catch { /* 못 지움 */ }
            return keys.length;
        },
        stats() { let size = 0; for (const m of meta.values()) size += m.size; return { rows: meta.size, chars: size }; },
    };
}

/** 상한을 넘는 줄: 최근에 쓴 것부터 남기고 글자 수 · 줄 수를 넘는 것 */
function overflow(meta, chars, rows) {
    let total = 0;
    for (const m of meta.values()) total += m.size;
    if (total <= chars && meta.size <= rows) return [];
    const order = [...meta.values()].sort((a, b) => b.time - a.time);
    const drop = [];
    let kept = 0, used = 0;
    for (const m of order) {
        if (kept >= rows || used + m.size > chars) { drop.push(m.key); continue; }
        kept++; used += m.size;
    }
    return drop;
}

/** 메모리에만 두는 저장소(브라우저 저장소를 못 쓰는 곳 · 시험). 위의 저장소 꼴 그대로 */
export function ramStore() {
    const rows = new Map();
    return {
        index: async () => [...rows.values()].map(({ text, ...m }) => m),
        read: async keys => new Map(keys.filter(k => rows.has(k)).map(k => [k, rows.get(k).text])),
        write: async list => { for (const row of list) rows.set(row.key, { ...rows.get(row.key), ...row }); },
        remove: async keys => { for (const k of keys) rows.delete(k); },
        wipe: async () => rows.clear(),
    };
}
