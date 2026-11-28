// 번역문에서 바꿀 낱말 목록. 모든 채팅에 쓴다.
// 저장 자리: 옛 번역 확장의 설정 칸.word_replacements = [{ find: '찾을 말', to: '바꿀 말' }, …]
// 처음엔 비어 있다. 바꾸는 일은 core/banned.js 가 하고, 여기는 목록을 읽고 쓰는 일과 그 목록을 거기에 이어 주는 일만 한다.
// 화면은 여기서 내준 것만 부른다.

import { SETTINGS_KEY } from './settings.js';
import { useWords } from '../core/banned.js';

export const WORDS_KEY = 'word_replacements';

const stored = extensionSettings => extensionSettings?.[SETTINGS_KEY]?.[WORDS_KEY];

const clean = row => ({ find: String(row?.find ?? '').trim(), to: String(row?.to ?? '').trim() });

/** 시작할 때 한 번: 번역문을 붙이는 길이 이 목록을 쓰게 한다. @param {object} context 실리태번 getContext() */
export function install(context) {
    useWords(() => stored(context.extensionSettings));
}

/** 지금 목록(사본). 찾을 말이 빈 줄은 뺀다. @returns {{ find: string, to: string }[]} */
export function wordRows(extensionSettings) {
    const rows = stored(extensionSettings);
    return (Array.isArray(rows) ? rows : []).map(clean).filter(row => row.find);
}

/** 목록을 통째로 바꾼다. 찾을 말이 비었거나 앞줄과 같은 줄은 뺀다. @returns {{ find: string, to: string }[]} 저장한 목록 */
export function setWordRows(context, rows) {
    const seen = new Set();
    const kept = (Array.isArray(rows) ? rows : []).map(clean).filter(row => row.find && !seen.has(row.find) && seen.add(row.find));
    const es = context.extensionSettings;
    if (!es[SETTINGS_KEY] || typeof es[SETTINGS_KEY] !== 'object') es[SETTINGS_KEY] = {};
    es[SETTINGS_KEY][WORDS_KEY] = kept;
    context.saveSettingsDebounced();
    return kept;
}

/**
 * 줄을 더한다. 같은 찾을 말이 이미 있으면 그 줄의 바꿀 말을 고친다.
 * @returns {{ ok: true, rows: object[] } | { ok: false, reason: 'empty' | 'same' }} empty 찾을 말이 빔, same 두 말이 같음
 */
export function addWord(context, find, to) {
    const row = clean({ find, to });
    const problem = wrong(row);
    if (problem) return { ok: false, reason: problem };
    const rows = wordRows(context.extensionSettings);
    const at = rows.findIndex(other => other.find === row.find);
    if (at < 0) rows.push(row); else rows[at] = row;
    return { ok: true, rows: setWordRows(context, rows) };
}

/**
 * index 번째 줄을 고친다(wordRows 의 차례).
 * @returns {{ ok: true, rows: object[] } | { ok: false, reason: 'empty' | 'same' | 'missing' | 'duplicate' }}
 *   missing 그 줄이 없음, duplicate 다른 줄에 같은 찾을 말이 있음
 */
export function changeWord(context, index, find, to) {
    const row = clean({ find, to });
    const rows = wordRows(context.extensionSettings);
    const problem = wrong(row) || (rows[index] ? '' : 'missing') || (rows.some((other, i) => i !== index && other.find === row.find) ? 'duplicate' : '');
    if (problem) return { ok: false, reason: problem };
    rows[index] = row;
    return { ok: true, rows: setWordRows(context, rows) };
}

/** index 번째 줄을 지운다. @returns {{ find: string, to: string }[]} 남은 목록 */
export function removeWord(context, index) {
    return setWordRows(context, wordRows(context.extensionSettings).filter((_, i) => i !== index));
}

function wrong(row) {
    if (!row.find) return 'empty';
    return row.find === row.to ? 'same' : '';
}

const ARROW = /\s*(?:→|->|=>)\s*/;

/** 목록을 한 줄에 하나씩 '찾을 말 → 바꿀 말' 꼴의 글로 */
export const toLines = rows => rows.map(row => `${row.find} → ${row.to}`).join('\n');

/** '찾을 말 → 바꿀 말' 줄들을 목록으로(화살표는 → · -> · => 어느 것이든). 화살표가 없는 줄은 뺀다 */
export function fromLines(text) {
    return String(text ?? '').split('\n').filter(line => ARROW.test(line)).map(line => {
        const [find, ...rest] = line.split(ARROW);
        return clean({ find, to: rest.join(' ') });
    }).filter(row => row.find);
}
