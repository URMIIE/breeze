// 다시 번역 프롬프트 하나. 사용자가 적어 두면 다시 번역 때 긴 번역 프롬프트 자리에 이 글이 대신 들어간다(job/redo.js).
// 기본은 빈 글이다: 비어 있으면 다시 번역도 평소 번역 프롬프트로 보낸다.
// 쓰는 곳 셋(모든 채팅 / 이 캐릭터 / 지금 채팅만)을 따른다: 다른 설정처럼 좁은 곳의 값이 이긴다(store/layers.js 의 설정 redoPrompt).
//
//   readRedoPrompt(view)            → { text, from }  view = layers.view().  from 그 글이 적힌 쓰는 곳 'chat' | 'card' | 'all' | null(적힌 적 없음)
//   setRedoPrompt(layers, text)     → 적힌 쓰는 곳.  빈 글이면 그 쓰는 곳의 값을 비운다

const KEY = 'redoPrompt';

export function readRedoPrompt(view) {
    const text = view?.settings?.[KEY];
    return { text: typeof text === 'string' ? text : '', from: view?.from?.[KEY] ?? null };
}

export const setRedoPrompt = (layers, text) => layers.setSetting(KEY, String(text ?? ''));
