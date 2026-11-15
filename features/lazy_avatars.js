// 프로필 사진은 보일 때 불러오기.
// 캐릭터 목록 · 페르소나 목록 · 즐겨찾기 줄은 화면에 안 보이는 줄의 사진까지 한꺼번에 불러와, 목록이 길면 열 때 요청이 몰린다.
// 목록에 새로 붙는 사진 중 화면 밖인 것은 주소를 잠깐 떼어 두었다가, 굴려서 가까이 오면 붙인다.
// 다른 확장 · 테마가 이미 늦게 불러오게 해 둔 사진(loading="lazy" 이거나 주소가 비어 있음)은 건드리지 않는다.
const LISTS = ['#rm_print_characters_block', '#user_avatar_block', '#rm_group_members', '#rm_group_add_members', '#HotSwapWrapper', '#persona_connections_list'];
const HOLD = 'data-etk-src';
let observers = [], viewer = null, api = null, clashed = false;

// 부딪침 점검(기다리지 않고 그때그때): 우리가 주소를 떼어 둔 사진에 다른 쪽이 주소를 다시 넣었거나, 붙인 주소가 깨진 주소면
// 다른 확장도 같은 사진의 주소를 만지는 것 — 떼어 둔 사진을 전부 돌려놓고 이 기능은 쉼(둘이 겹치면 사진이 안 뜸)
function clash() {
    if (clashed) return;
    clashed = true;
    api?.rest('clash');
    viewer?.disconnect();
    document.querySelectorAll(`img[${HOLD}]`).forEach(restore);
}

function restore(img) {
    const src = img.getAttribute(HOLD);
    if (src === null) return;
    img.removeAttribute(HOLD);
    if (!src || src === 'null') return;   // 예전 판이 남긴 망가진 주소는 붙이지 않음
    if (img.getAttribute('src')) { clash(); return; }   // 떼어 둔 사이 다른 쪽이 주소를 넣음
    img.src = src;
}

// 자리를 다 잰 뒤에 한꺼번에 떼어 냄 — 하나씩 재고 떼면 뗄 때마다 화면 계산을 다시 해서 목록이 길면 수백 ms 멈췄음
// 같은 사진이 여러 변화 기록에 겹쳐 두 번 들어오면, 두 번째에서 이미 떼어 둔(빈) 주소를 'null' 로 덮어써 사진이 영영 안 떴음 — 한 번씩만, 떼기 직전에 다시 확인
function holdAll(imgs) {
    if (clashed) return;
    const far = [];
    let byOthers = 0, seen = 0;
    for (const img of new Set(imgs)) {
        if (!img.isConnected || img.hasAttribute(HOLD) || img.complete) continue;
        seen++;
        if (img.loading === 'lazy' || !img.getAttribute('src') || /\/null$/.test(img.getAttribute('src'))) { byOthers++; continue; }   // 다른 쪽이 이미 늦게 불러오게 해 둠
        const r = img.getBoundingClientRect();
        // 화면 안 · 가까운 것은 그대로 불러옴. 안 보이는 창(크기 0) 안의 사진은 떼어 둠
        if (r.width && r.bottom > -200 && r.top < innerHeight + 200) continue;
        far.push(img);
    }
    // 새로 붙은 사진이 전부 다른 쪽 방식으로 늦게 불러와지고 있으면 같은 일을 하는 쪽이 있는 것
    if (seen >= 3 && byOthers === seen) api?.rest('same'); else if (far.length) api?.rest(null);
    for (const img of far) {
        const src = img.getAttribute('src');
        if (!src || img.hasAttribute(HOLD)) continue;
        img.setAttribute(HOLD, src);
        img.removeAttribute('src');
        viewer.observe(img);
    }
}

export function start(a) {
    api = a; clashed = false;
    viewer = new IntersectionObserver(entries => {
        for (const e of entries) if (e.isIntersecting) { viewer.unobserve(e.target); restore(e.target); }
    }, { rootMargin: '300px' });
    for (const sel of LISTS) {
        const list = document.querySelector(sel);
        if (!list) continue;
        const mo = new MutationObserver(records => {
            // 읽기(자리 재기)를 한데 모아 한 번에 — 줄마다 재고 고치면 줄마다 화면 계산을 다시 함
            const imgs = [];
            for (const r of records) {
                // 우리가 떼어 둔 사진의 주소를 다른 쪽이 바꿈 → 부딪침
                if (r.type === 'attributes' && r.target.hasAttribute?.(HOLD) && r.target.getAttribute('src')) { clash(); return; }
            }
            for (const r of records) for (const n of r.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (n.tagName === 'IMG') imgs.push(n); else imgs.push(...n.querySelectorAll('img'));
            }
            if (imgs.length) requestAnimationFrame(() => holdAll(imgs));
        });
        mo.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
        observers.push(mo);
    }
}

export function stop() {
    for (const mo of observers) mo.disconnect();
    observers = [];
    viewer?.disconnect(); viewer = null;
    document.querySelectorAll(`img[${HOLD}]`).forEach(restore);
}
