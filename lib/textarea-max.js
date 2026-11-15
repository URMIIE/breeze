// 글 칸(CSS · JS 등)에 실리태번 ‘편집기 크게’ 버튼을 칸 안 오른쪽 아래에 붙임.
// 실리태번 큰 편집기는 원래 칸에 jQuery 로만 input 을 알려서(addEventListener 로 단 처리기는 못 받음) 진짜 input 사건으로 한 번 더 알림.
let n = 0;
export function addMaximize(root) {
    for (const ta of root.querySelectorAll('textarea')) {
        if (ta.closest('.etk-ta-wrap')) continue;
        if (!ta.id) ta.id = `etk_ta_${Date.now().toString(36)}_${n++}`;   // 설정 창 · 확장 칸 두 곳에 그려져도 제 칸을 찾게
        const wrap = document.createElement('div');
        wrap.className = 'etk-ta-wrap';
        ta.replaceWith(wrap);
        wrap.append(ta);
        const btn = document.createElement('i');
        btn.className = 'editor_maximize fa-solid fa-maximize etk-ta-max';
        btn.dataset.for = ta.id;
        btn.dataset.tab = 'true';
        btn.title = '편집기 크게';
        wrap.append(btn);
        $(ta).on('input', e => { if (!e.originalEvent) ta.dispatchEvent(new Event('input', { bubbles: true })); });
    }
}
