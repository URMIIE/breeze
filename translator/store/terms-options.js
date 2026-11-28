// 정해 둔 번역어의 켜고 끄기와 목록 차례. 옛 번역 확장의 설정 칸의 그 열쇠를 그대로 읽고 쓴다:
//   glossary_enabled  거짓이면 정해 둔 번역어와 이름 표기를 요청에 싣지 않는다(열쇠가 없으면 켜짐)
//   glossary_sort     'dst' 번역어 가나다 차례(기본) | 'src' 원문 차례
// 같은 자리를 쓰던 사람의 값이 손대지 않아도 그대로 먹는다. 화면은 여기서 내준 것만 부른다.

import { SETTINGS_KEY } from './settings.js';

const own = extensionSettings => extensionSettings?.[SETTINGS_KEY] ?? {};

function write(context, key, value) {
    const es = context.extensionSettings;
    if (!es[SETTINGS_KEY] || typeof es[SETTINGS_KEY] !== 'object') es[SETTINGS_KEY] = {};
    es[SETTINGS_KEY][key] = value;
    context.saveSettingsDebounced();
}

/** 정해 둔 번역어를 쓰는 중인가 */
export const termsOn = extensionSettings => own(extensionSettings).glossary_enabled !== false;
/** @param {object} context 실리태번 getContext()  @param {boolean} on */
export const setTermsOn = (context, on) => write(context, 'glossary_enabled', Boolean(on));

/** 목록 차례: 'dst' | 'src' */
export const sortKey = extensionSettings => (own(extensionSettings).glossary_sort === 'src' ? 'src' : 'dst');
export const setSortKey = (context, key) => write(context, 'glossary_sort', key === 'src' ? 'src' : 'dst');

/**
 * 목록을 고른 차례로(넘겨받은 배열은 그대로 둔다). 번역어 칸의 이름은 dst 나 tr 어느 쪽이든 읽는다.
 * 같은 값끼리는 원문 차례.
 * @param {{ src: string, dst?: string, tr?: string }[]} rows  @param {'dst' | 'src'} key
 */
export function sorted(rows, key) {
    const of = row => String((key === 'src' ? row.src : row.dst ?? row.tr) ?? '');
    return [...rows].sort((a, b) => of(a).localeCompare(of(b), 'ko') || String(a.src).localeCompare(String(b.src), 'ko'));
}
