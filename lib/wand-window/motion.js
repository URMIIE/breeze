// 화면이 바뀌는 곳(칸 펼침 · 폴더 열기 · 꾸미기 들고 나기)의 짧은 움직임. 창 여닫기와 같은 결: opacity · transform 만, 140ms.
// 배치를 다시 계산하게 하는 값(높이 · 너비 · 자리)은 움직이지 않는다. 기기의 '동작 줄이기'가 켜져 있으면 움직임 없이 바로.
const DURATION = 140;
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 나타나기. from = 처음 transform(예: 'translateY(-4px)', 'scale(.94)') */
export function softIn(el, from = 'translateY(-4px)') {
    if (!el || reduced()) return;
    el.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: DURATION, easing: 'ease-out' });
}

/** 사라진 뒤 done(지우기 등). 동작 줄이기면 바로 done */
export function softOut(el, done, to = 'translateY(-4px)') {
    if (!el || reduced()) return done();
    el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: to }], { duration: DURATION, easing: 'ease-in' }).finished.then(done, done);
}
