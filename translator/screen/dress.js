// 화면에 번역을 입힌다: 줄 길(줄의 글이 기록과 같음 · 구멍 든 틀의 고정 부분) → 문자열 길(글 조각 하나가 기록이나 "{0}" 틀과 맞음).
// 맞는 것이 없으면 그대로 두고, 아직 번역이 없는 줄을 돌려준다(부르는 쪽이 번역을 요청할지 정한다).

import { scan, isLetterRun, put, putFixed, keyOf } from './lines.js';
import { fill, readable } from './strings.js';

/**
 * @param {object} root 입힐 화면(요소)
 * @param {ReturnType<import('./records.js').open>} records
 * @param {{ skip?: (el: object) => boolean, frames?: { fixed: string[], pattern: RegExp }[], seen?: WeakMap<object, string> }} [options]
 *   frames: 이 화면에 걸린 정규식 틀의 구멍 든 줄들. seen: 조각 → 우리가 써 넣은 글(같은 글이면 다시 보지 않는다)
 * @returns {{ put: number, missing: object[] }} missing: 번역이 없어 그대로 둔 줄(piece 가 붙은 것은 줄이 아니라 글 조각 하나: 글 기록에 적는다)
 */
export function dress(root, records, { skip, frames = [], seen = new WeakMap() } = {}) {
    let count = 0;
    const missing = [];
    const mark = line => { for (const n of line.nodes) seen.set(n, n.nodeValue); };
    for (const line of scan(root, { skip })) {
        if (line.nodes.every(n => seen.get(n) === n.nodeValue)) continue;   // 이미 입힌 줄
        if (isLetterRun(line)) continue;
        const record = records.line(line);
        if (record !== undefined && put(line, record)) { mark(line); count++; continue; }
        const frame = frames.find(f => f.pattern.test(line.key));
        if (frame) {
            const dict = new Map(frame.fixed.map(p => [keyOf(p), records.strings.get(p)]).filter(([, v]) => v));
            // 틀의 고정 부분을 실제로 바꿨을 때만 이 줄을 끝낸다. 바꾼 것이 없으면 아래 길로 넘긴다:
            //   구멍이 큰 틀(「$1的$2」)의 식은 아무 줄에나 맞아서, 여기서 끝내면 상관없는 줄이 번역 대상에서 통째로 빠진다
            if (putFixed(line, dict, frame.fixed)) { mark(line); count++; continue; }
        }
        // 문자열 길: 조각마다
        // 조각 일부가 이미 번역된 글인 줄도 여기서 끝낸다(앞서 조각만 바꿔 둔 줄, 또는 화면이 번역된 본문으로 그려져 값만 한국어인 줄).
        //   그런 줄을 줄째로 물으면 값이 달라질 때마다 처음 보는 줄이 되어, 그 한 줄 때문에 요청이 따로 나갔다. 아직 원문인 조각만 하나씩 본다
        const filled = fillPieces(line, records, seen);
        if (filled || partlyDone(line, seen)) {
            if (filled) count++;
            missing.push(...unfilledPieces(line, records, seen));
            continue;
        }
        if (readable(line.text) && records.wants(line)) missing.push(line);
    }
    return { put: count, missing };
}

/** 조각이 여럿인 줄에서, 우리가 이미 써 넣은 조각이나 이미 한국어인 조각이 하나라도 있는가 */
function partlyDone(line, seen) {
    const korean = text => /\p{Script=Hangul}/u.test(text) && !readable(text);
    return line.nodes.length > 1 && line.nodes.some(n => seen.get(n) === n.nodeValue || korean(n.nodeValue));
}

/** 줄의 조각마다 글 기록("{0}" 틀 포함)에 맞는 것을 바꾼다 → 하나라도 바꿨나 */
function fillPieces(line, records, seen) {
    let any = false;
    for (const node of line.nodes) {
        if (seen.get(node) === node.nodeValue) continue;
        const translated = fill(node.nodeValue, records.strings);
        if (translated === null) continue;
        const value = node.nodeValue;
        node.nodeValue = value.match(/^\s*/)[0] + translated + value.match(/\s*$/)[0];
        seen.set(node, node.nodeValue);
        any = true;
    }
    return any;
}

/**
 * 조각 일부만 맞은 줄에서 아직 원문인 조각들. 줄째로는 다시 맞출 수 없어서(이미 일부가 바뀌었다) 하나씩 따로 달라고 한다.
 * piece 가 붙은 것은 줄이 아니라 글 조각 하나라는 표시다(글 기록에 적는다)
 */
function unfilledPieces(line, records, seen) {
    const out = [];
    for (const node of line.nodes) {
        const text = node.nodeValue.replace(/\s+/g, ' ').trim();
        const untouched = seen.get(node) !== node.nodeValue;
        if (untouched && readable(text) && records.wantsString(text)) out.push({ nodes: [node], text, key: keyOf(text), kind: 'one', piece: true });
    }
    return out;
}
