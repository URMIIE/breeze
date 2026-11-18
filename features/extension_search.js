import { koMatch } from '../lib/ko-match.js';
// ‘확장 관리’ 창(.extensions_info) 맨 위에 검색칸 — 이름 · 폴더 이름 · 설명 글자로 거름(NFC · 대소문자 무시).
// 맥 파일 이름에서 온 글자는 자모가 나뉜(NFD) 꼴이라 그대로 비교하면 완성형 검색어와 안 맞는다.
const norm = s => String(s || '').normalize('NFC').toLowerCase();
let observer = null, api = null;
// 다른 확장이 이미 이 창에 검색칸을 넣었는지: 우리 것이 아닌 글 입력칸이 창 맨 위 쪽(줄 목록 밖)에 있으면
const otherSearch = (root) => [...root.querySelectorAll('input[type="search"], input[type="text"]')].some(i => !i.closest('.etk-ext-search') && !i.closest('.extension_block'));

function add(root) {
    if (root.querySelector('.etk-ext-search')) return;
    if (otherSearch(root)) { api?.rest('same', { saw: '확장 관리 창 위쪽에 breeze 것이 아닌 검색칸이 이미 있어요', who: { kind: 'unknown' }, back: '그쪽을 끄면 다음에 확장 관리 창을 열 때 breeze가 맡아요.' }); return; }
    api?.rest(null);
    const box = document.createElement('div');
    box.className = 'etk-ext-search';
    box.innerHTML = '<input type="search" class="text_pole" placeholder="확장 검색…"><span class="etk-ext-count"></span>';
    root.prepend(box);
    const input = box.querySelector('input');
    const count = box.querySelector('.etk-ext-count');
    // 글자는 줄마다 한 번만 만들어 둠. 숨기며 줄마다 화면 값을 읽으면 그때마다 화면 계산을 다시 해서 한 글자에 몇 초씩 걸림
    const texts = new WeakMap();
    const textOf = b => { let x = texts.get(b); if (x === undefined) texts.set(b, x = norm(`${b.dataset.name} ${b.textContent}`)); return x; };
    input.addEventListener('input', () => {
        const q = norm(input.value).trim();
        // 거르는 동안은 창 높이를 처음 높이로 묶어 둠 — 줄이 줄면 창이 줄며 위치가 움직임
        if (q && !root.dataset.etkHold) { root.style.minHeight = `${root.getBoundingClientRect().height}px`; root.dataset.etkHold = '1'; }
        else if (!q && root.dataset.etkHold) { root.style.minHeight = ''; delete root.dataset.etkHold; }
        let shown = 0, total = 0;
        for (const b of root.querySelectorAll('.extension_block')) {
            const hit = !q || koMatch(textOf(b), q);   // 초성(ㅂㄹㅈ) · 치는 중 글자도
            const want = hit ? '' : 'none';
            if (b.style.display !== want) b.style.display = want;
            total++; if (hit) shown++;
        }
        count.textContent = q ? `${shown} / ${total}` : '';
    });
    setTimeout(() => input.focus({ preventScroll: true }), 50);
}

export function start(a) {
    api = a;
    // 새로 붙은 요소만 봄(채팅 글이 흘러 들어올 때 문서 전체를 다시 찾지 않게)
    observer = new MutationObserver(list => {
        for (const m of list) for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            // 우리 검색칸을 넣은 뒤 다른 확장이 검색칸을 또 넣으면 우리 것을 빼고 쉼(검색칸 두 개가 겹쳐 뜨지 않게)
            const host = n.closest?.('.extensions_info');
            if (host && host.querySelector('.etk-ext-search') && !n.closest('.etk-ext-search') && otherSearch(host)) { host.querySelector('.etk-ext-search').remove(); api?.rest('same', { saw: '확장 관리 창 위쪽에 breeze 것이 아닌 검색칸이 이미 있어요', who: { kind: 'unknown' }, back: '그쪽을 끄면 다음에 확장 관리 창을 열 때 breeze가 맡아요.' }); continue; }
            if (n.matches('.extensions_info')) add(n);
            else if (n.firstElementChild) n.querySelectorAll('.extensions_info').forEach(add);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

export function stop() {
    observer?.disconnect();
    observer = null;
    document.querySelectorAll('.etk-ext-search').forEach(b => b.remove());
}
