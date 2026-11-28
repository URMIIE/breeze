// 받은 문단 하나를 본다(요청은 더 내지 않는다). 걸린 문단은 붙이되 번역 기억에 넣지 않고, 다시 번역 판에서 먼저 골라 둔다.
//   tags  원문의 태그 · 자리표가 번역에 그대로 있나(이름과 수. 속성은 짧은 표시로 보낸 것이라 이름만 본다)
//   hangul 한국어로 옮길 때 한글이 있나(옮길 글자가 있는 문단만)
//   same  원문과 글자까지 같지 않나(모델이 원문을 그대로 돌려준 문단)
// 용어가 지켜졌는지는 여기서 보지 않는다: 이미 번역된 답으로 재 보니 정한 한국어가 없는 문단이 26.3%였다(
//   옛 번역이 용어를 정하기 전 것이 섞여 있어 맞는 번역까지 걸린다). 그 비율로 기억에서 빼면 같은 문단이 다시 나간다.
// 한글 · 같음 확인은 옮길 글자가 10자 이상인 문단만 본다: 실제 답에서 '对' → 'VS', '{0} 比 {1}' → '{0} : {1}', 글꼴 이름처럼
//   짧은 화면 글은 한글 없이 옮기는 것이 맞았다(2026-11-27 flash 답 저장본 1,089문단, 10자 아래에서 걸린 것은 모두 맞는 번역).
// 글만 다룬다.

const LETTERS_MIN = 10;
const lettersIn = text => (String(text ?? '').replace(/<[^>]*>|\[\[__VAR_\d+__\]\]|\{\d+\}/g, '').match(/\p{L}/gu) || []).length;

const MARKS = /<\/?([A-Za-z][\w-]*)\b[^<>]*>|\[\[__VAR_(\d+)__\]\]/g;
/** 태그 이름 · 자리표 번호를 차례 없이 센 지문 */
const marksOf = text => [...String(text ?? '').matchAll(MARKS)].map(m => (m[1] ? `<${m[0][1] === '/' ? '/' : ''}${m[1].toLowerCase()}` : `v${m[2]}`)).sort().join(' ');

/**
 * @param {string} source 보낸 원문 조각  @param {string} output 받은 번역
 * @param {{ korean?: boolean }} [o] korean: 한국어로 옮기는 요청인가(한글 확인)
 * @returns {string[]} 걸린 까닭('tags' | 'hangul' | 'same'), 없으면 []
 */
export function doubts(source, output, { korean = true } = {}) {
    const src = String(source ?? ''), out = String(output ?? ''), why = [];
    if (marksOf(src) !== marksOf(out)) why.push('tags');
    const long = lettersIn(src) >= LETTERS_MIN;
    if (korean && long && !/\p{Script=Hangul}/u.test(out.replace(/<[^>]*>/g, ''))) why.push('hangul');
    if (long && out.trim() === src.trim()) why.push('same');
    return why;
}
