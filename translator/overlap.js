// 두 벌 겹침 막기: 같은 뿌리의 번역 확장이 이 화면에 이미 올라와 있으면 이쪽(breeze 의 번역)이 쉰다.
//
// 먼저 올라온 쪽이 돌고 뒤에 온 쪽이 쉰다. 같은 뿌리의 번역 확장들은 올라오면서 아래 두 표시 가운데 하나를 전역에 세우고,
// 올라올 때 그 표시가 이미 있으면 버튼 · 이벤트 · 명령을 달지 않는다. 그래서 이쪽도 올라오기 전에 표시를 보고, 없으면 세운다
// (뒤에 올라오는 같은 뿌리의 확장이 쉬게). 둘 다 돌면 답 하나를 두 번 번역해 요청이 두 번 나간다.
// 세운 표시는 시작하다 죽었을 때 물린다: 남겨 두면 뒤에 올라오는 같은 뿌리의 확장이 그 표시를 보고 쉬어, 번역하는 쪽이 하나도 없게 된다.

const ARCHIVE = Symbol.for('st.llm-translator.archive.v1');
const LOADED = '__blLlmTranslatorLoaded';

let mine = false;

/** 같은 뿌리의 다른 번역 확장이 이미 올라와 있나(이쪽이 세운 표시는 세지 않는다) */
export function shouldRest() {
    if (mine) return false;
    return Boolean(globalThis[ARCHIVE] || globalThis[LOADED]);
}

/** 이쪽이 맡는다고 표시한다. 다른 쪽이 이미 있으면 세우지 않고 false */
export function claim() {
    if (shouldRest()) return false;
    globalThis[LOADED] = true;
    mine = true;
    return true;
}

/** 이쪽이 세운 표시를 물린다(시작하다 실패했을 때) */
export function release() {
    if (!mine) return;
    delete globalThis[LOADED];
    mine = false;
}

/** breeze 에 알릴 글(api.rest('same', REST_INFO)). 표시만으로는 어느 확장인지 알 수 없다 */
export const REST_INFO = Object.freeze({
    saw: '같은 번역 확장이 먼저 켜져 있어요',
    who: { kind: 'unknown' },
    back: '그 확장을 끄고 새로고침하면 breeze가 맡아요.',
});
