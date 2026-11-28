// 그 채팅을 열면 붙일 답의 목록. 다른 채팅에 가 있는 동안 끝난 번역은 그 채팅이 열려 있지 않아 메시지에 붙이지 못한다.
// 받은 문단은 문단 번역 기억(store/memory.js)에 있으므로, 여기에는 '어느 채팅의 어느 답인지'만 적는다. 그 채팅을 열면 기억에서 붙인다(job/away.js).
// 새로고침해도 남게 브라우저 저장소(localStorage)에 둔다. 열려 있지 않은 채팅의 파일은 건드리지 않는다.
//
// 꼴: { [채팅 이름]: [자리, 보낸 날짜, 원문 지문, 스와이프, 기억의 설정 지문][] }
//   자리 · 날짜로 그 답을 찾고, 원문 지문 · 스와이프가 다르면(그새 고쳤거나 스와이프를 넘김) 붙이지 않는다.
//   설정 지문은 번역할 때의 것을 적어 둔다: 돌아왔을 때 설정이 달라져 있어도 그때 받은 번역을 기억에서 찾게.
// 상한: 채팅 전부 번역은 다른 채팅에 가 있는 동안 답 수만큼 쌓인다. 옛 번역기는 50개로 잘랐다가 돌아왔을 때 앞 답들이 안 붙어서
//   전부 번역 몫을 5,000개로 따로 뒀다. 여기서는 한데 5,000개로 두고 넘으면 가장 먼저 적은 채팅의 것부터 버린다.

const KEY = 'breeze.translator.attachLater';
const LIMIT = 5000;

const sameRow = (row, index, sent) => row[0] === index && row[1] === sent;

/**
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} [storage] 안 주면 localStorage
 */
export function createLater(storage = globalThis.localStorage) {
    function read() {
        try {
            const data = JSON.parse(storage.getItem(KEY) || '{}');
            return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        } catch { return {}; }
    }
    function write(data) {
        for (const chat of Object.keys(data)) if (!data[chat].length) delete data[chat];
        try { storage.setItem(KEY, JSON.stringify(trim(data))); } catch { /* 저장소를 못 쓰면 이번에는 적지 못한다(문단은 기억에 남아 번역을 누르면 요청 없이 붙는다) */ }
    }

    return {
        /** 적는다(같은 답은 새 것으로 바꾼다). row: { index, sent, hash, swipe, mark } */
        add(chat, { index, sent, hash, swipe, mark }) {
            const data = read(), rows = (data[chat] ?? []).filter(row => !sameRow(row, index, sent));
            data[chat] = [...rows, [index, sent, hash, swipe, mark]];
            write(data);
        },
        /** 그 채팅에 적어 둔 답들 */
        list(chat) {
            const rows = read()[chat];
            return (Array.isArray(rows) ? rows : []).map(([index, sent, hash, swipe, mark]) => ({ index, sent, hash, swipe, mark }));
        },
        /** 목록에서 뺀다 */
        drop(chat, rows) {
            const data = read();
            if (!Array.isArray(data[chat])) return;
            data[chat] = data[chat].filter(row => !rows.some(gone => sameRow(row, gone.index, gone.sent)));
            write(data);
        },
    };
}

/** 상한을 넘으면 가장 먼저 적은 채팅의 가장 먼저 적은 답부터 버린다 */
function trim(data) {
    let total = Object.values(data).reduce((sum, rows) => sum + rows.length, 0);
    for (const chat of Object.keys(data)) {
        if (total <= LIMIT) break;
        const cut = Math.min(data[chat].length, total - LIMIT);
        data[chat] = data[chat].slice(cut);
        total -= cut;
        if (!data[chat].length) delete data[chat];
    }
    return data;
}
