// 화면 글자 번역 기록(캐릭터마다 하나). 글만 다룬다: 읽고 쓰는 곳은 넘겨받는다.
//
// { v: 1, lines: { 열쇠: 번역 | [조각 번역 …] }, strings: { 글: 번역 }, hand: [손으로 고친 열쇠], tried: [해 봤지만 그대로 온 열쇠] }
//   lines: 줄(열쇠 = 글자 · 숫자만 + '#조각 수'). strings: 글 조각 하나(스크립트가 만든 글 · "{0}" 틀).

import { keyOf } from './lines.js';

const lineKey = line => `${line.key}#${line.nodes.length}`;

export function open(data) {
    const d = data && typeof data === 'object' && data.v === 1 ? data : {};
    const lines = new Map(Object.entries(d.lines || {})), strings = new Map(Object.entries(d.strings || {}));
    const hand = new Set(d.hand || []), tried = new Set(d.tried || []);
    let dirty = false;
    return {
        strings,
        /** 이 줄의 번역(없으면 undefined) */
        line: line => lines.get(lineKey(line)),
        /** 모델이 준 번역을 적는다. 손으로 고친 것은 덮지 않는다 */
        learn(line, record) { const k = lineKey(line); if (hand.has(k)) return; lines.set(k, record); tried.delete(k); dirty = true; },
        learnString(text, value) { if (hand.has(`s:${text}`)) return; strings.set(text, value); tried.delete(`s:${text}`); dirty = true; },
        /** 손으로 고친 번역. 늘 이긴다 */
        fix(line, record) { const k = lineKey(line); lines.set(k, record); hand.add(k); dirty = true; },
        fixString(text, value) { strings.set(text, value); hand.add(`s:${text}`); dirty = true; },
        /** 보냈는데 원문 그대로 돌아온 것. 다시 보내지 않는다 */
        gaveUp(line) { tried.add(lineKey(line)); dirty = true; },
        gaveUpString(text) { tried.add(`s:${text}`); dirty = true; },
        /** 번역을 요청해야 하는가 */
        wants: line => !lines.has(lineKey(line)) && !tried.has(lineKey(line)),
        wantsString: text => !strings.has(text) && !tried.has(`s:${text}`),
        /** 옛 기록(글 조각 → 번역)을 처음 한 번 읽어 온다. 이미 있는 것은 두고, 조각 하나짜리 줄과 글 조각 양쪽에 넣는다 */
        adopt(old) {
            for (const [text, value] of Object.entries(old || {})) {
                if (typeof value !== 'string' || !value) continue;
                const k = `${keyOf(text)}#1`;
                if (keyOf(text) && !lines.has(k)) { lines.set(k, value); dirty = true; }
                if (!strings.has(text)) { strings.set(text, value); dirty = true; }
            }
        },
        get dirty() { return dirty; },
        /** 저장할 꼴 */
        data() { dirty = false; return { v: 1, lines: Object.fromEntries(lines), strings: Object.fromEntries(strings), hand: [...hand], tried: [...tried] }; },
        size: () => lines.size + strings.size,
    };
}
