// 한글 찾기: 초성만(ㄹㄷ → 로딩), 치는 중인 글자(로디 → 로딩)도 맞게. 띄어쓰기 · 대소문자는 무시
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
function koCharMatch(qc, tc) {
    if (qc === tc) return true;
    const t = tc.charCodeAt(0) - 0xAC00;
    if (t < 0 || t > 11171) return false;
    if (CHO.includes(qc)) return CHO[Math.floor(t / 588)] === qc;
    const q = qc.charCodeAt(0) - 0xAC00;
    if (q < 0 || q > 11171 || q % 28) return false;   // 받침 없는 글자만: 쓰는 중(디 → 딩)
    return Math.floor(q / 28) === Math.floor(t / 28);
}
export function koMatch(text, query) {
    const t = [...text.toLowerCase().replace(/\s+/g, '')], q = [...query.toLowerCase().replace(/\s+/g, '')];
    if (!q.length) return true;
    for (let i = 0; i + q.length <= t.length; i++) if (q.every((c, k) => koCharMatch(c, t[i + k]))) return true;
    return false;
}
