// 문단 번역 기억(store/memory.js)의 브라우저 저장소: IndexedDB 하나에 칸 둘.
//   meta  { key, size, time, chats }  처음에 한 번 통째로 읽는다(글이 없어 작다)
//   text  { key, text }               찾을 때만 읽는다
// 옛 번역기의 저장소(LLMtranslatorDB · LLMtranslatorSegments · LLMtranslatorProgress)와 이름이 겹치지 않게 따로 둔다.

const DB = 'llmt-paragraph-memory', META = 'meta', TEXT = 'text';

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(META, { keyPath: 'key' });
            request.result.createObjectStore(TEXT, { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = request.onblocked = () => reject(new Error('번역 기억 저장소를 열지 못했어요'));
    });
}

/** 한 연결 · 한 트랜잭션으로 일을 하고 닫는다 */
async function run(stores, mode, work) {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(stores, mode);
            let out;
            Promise.resolve(work(tx)).then(value => { out = value; }, reject);
            tx.oncomplete = () => resolve(out);
            tx.onerror = tx.onabort = () => reject(tx.error || new Error('번역 기억 저장 실패'));
        });
    } finally { db.close(); }
}

const ask = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });

export const idbStore = {
    index: () => run([META], 'readonly', tx => ask(tx.objectStore(META).getAll())),
    read: keys => run([TEXT], 'readonly', async tx => {
        const store = tx.objectStore(TEXT), out = new Map();
        const rows = await Promise.all(keys.map(key => ask(store.get(key))));
        for (const row of rows) if (row) out.set(row.key, row.text);
        return out;
    }),
    write: rows => run([META, TEXT], 'readwrite', tx => {
        const meta = tx.objectStore(META), text = tx.objectStore(TEXT);
        for (const { text: body, ...m } of rows) {
            meta.put(m);
            if (typeof body === 'string') text.put({ key: m.key, text: body });
        }
    }),
    remove: keys => run([META, TEXT], 'readwrite', tx => {
        for (const key of keys) { tx.objectStore(META).delete(key); tx.objectStore(TEXT).delete(key); }
    }),
    wipe: () => run([META, TEXT], 'readwrite', tx => { tx.objectStore(META).clear(); tx.objectStore(TEXT).clear(); }),
};
