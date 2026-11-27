// 글을 고르면 뜨는 버튼을 메뉴 하나로 모으기.
// 채팅 글을 고르면 여러 확장이 저마다 떠 있는 버튼 · 작은 창을 띄워 겹친다. 어느 확장인지 알 필요 없이,
// 글을 고른 동안 새로 나타난 떠 있는 요소(position fixed / absolute)를 모아 원래 것은 안 보이게 두고(코드는 그대로 돎),
// 고른 글 끝에 ⋯ 하나만 띄운다. 누르면 모은 버튼이 목록으로 나오고, 고르면 원래 버튼을 대신 눌러 준다.
// 새로 뜬 것인지는 조금 기다려 봐야 알 수 있어서, 그사이 원래 버튼이 잠깐 보였다 사라진다. 그래서 한 번 모은 버튼은 그 요소를 가리키는 이름(id 나 클래스)을
// 기억해 두고(옵션 known), 다음부터는 CSS 로 처음부터 안 보이게 한다. 처음 보는 버튼만 한 번 깜빡인다.
// 이 확장의 폴더 이름(설치한 주소에 따라 달라짐)
const OWN = decodeURIComponent(import.meta.url.match(/\/third-party\/([^/]+)\//)?.[1] || 'breeze');
const OURS = 'etk-sel';
let soon = 0, poll = 0, refill = 0, menuCount = 0;
let chip = null, menu = null, timer = 0, watcher = null, found = new Set(), active = false, api = null, knownStyle = null;
// 어느 확장이 띄운 버튼인지: 글을 고른 동안만 화면에 요소를 붙이는 함수를 한 겹 거쳐, 붙인 코드의 파일 주소(…/third-party/확장폴더/…)를 적어 둠.
// 고르기가 끝나면 원래대로 돌려놓음. 글을 고르기 전에 이미 붙어 있다가 보이기만 하는 버튼은 붙인 쪽을 볼 길이 없어 빈칸으로 남음(설정에 ‘알 수 없어요’)
const origins = new WeakMap();
// 붙인 코드의 파일 주소 중 breeze 자신(이 감싸는 함수)을 빼고 가장 가까운 확장을 적어 둠
function tag(nodes) {
    const stack = new Error().stack || '';
    const from = [...stack.matchAll(/\/third-party\/([^/]+)\//g)].map(m => decodeURIComponent(m[1])).find(f => f !== OWN) || '';
    if (!from) return;
    for (const n of nodes) if (n instanceof Element && !n.className?.toString().includes('etk-')) origins.set(n, from);
}
// 감쌀 함수와, 그 함수가 받는 것 중 붙는 요소(없으면 받은 것 전부)
const nodesOf = { appendChild: a => [a[0]], insertBefore: a => [a[0]], insertAdjacentElement: a => [a[1]] };
const slots = [[Element.prototype, 'append'], [Element.prototype, 'prepend'], [Node.prototype, 'appendChild'], [Node.prototype, 'insertBefore'], [Element.prototype, 'insertAdjacentElement']]
    .map(([proto, name]) => ({ proto, name, mine: null, under: null }));
let tagging = false;
const wrap = (name, under) => function (...args) { if (tagging) tag(nodesOf[name]?.(args) ?? args); return under.apply(this, args); };
function hookInsert() {
    tagging = true;
    for (const s of slots) {
        const now = s.proto[s.name];
        // 우리 것이 아직 걸려 있으면(맨 위에 있든, 다른 코드가 그 위에 한 겹 더 씌웠든) 또 씌우지 않음
        if (s.mine && now !== s.under) continue;
        s.under = now;
        s.mine = wrap(s.name, now);
        s.proto[s.name] = s.mine;
    }
}
// 지금 걸린 것이 우리 것일 때만 되돌림. 그사이 다른 코드가 위에 한 겹 더 씌웠으면 저장해 둔 함수로 덮어쓰지 않고(그 겹이 지워짐) 우리 겹은 하는 일 없이 지나가게만 둠
function unhookInsert() {
    tagging = false;
    for (const s of slots) if (s.mine && s.proto[s.name] === s.mine) { s.proto[s.name] = s.under; s.mine = null; }
}
// 확장 폴더 이름 → 확장 목록에 보이는 이름(그 확장의 manifest.json 의 display_name, 못 읽으면 폴더 이름). 한 번 읽으면 기억
const names = new Map();
async function extensionName(folder) {
    if (!names.has(folder)) {
        names.set(folder, fetch(`/scripts/extensions/third-party/${encodeURIComponent(folder)}/manifest.json`).then(r => (r.ok ? r.json() : null)).then(m => m?.display_name || folder).catch(() => folder));
    }
    return names.get(folder);
}
// 모은 버튼 묶음이 하는 일(설정 목록에 보일 이름): ⋯ 메뉴에 나오는 줄 이름을 그대로 쉼표로 이음.
// 전에는 버튼의 글만 따로 읽어서, 글이 title · aria-label 에만 있거나 버튼 꼴이 아닌 칸이면 이름을 못 읽고 무조건 색 고르기로 적었음
const UNNAMED = '이름 모를 버튼', COLORS = '색 고르기 버튼';
function doesOf(pop) {
    const { named, dots, isColors } = sortButtons(pop);
    const words = named.map(lineOf).filter(Boolean);
    if (isColors) words.push(COLORS);
    else if (dots.length && words.length) words.push(UNNAMED);
    return words.join(', ').slice(0, 60) || pop.title || pop.getAttribute('aria-label') || UNNAMED;
}
const info = () => (api.options().info ??= {});   // 요소 이름 → { does, from }

const known = () => (api.options().known ??= []);
// ✕ 로 뺀 버튼: 다시 모으지 않고 원래 자리에 둠(목록에서 지우기만 하면 다음에 글을 고를 때 저절로 다시 모임)
const skipped = () => {
    const o = api.options();
    o.skip ??= [];
    // 예전 판에서 ✕ 로 지운 버튼은 목록에서만 사라지고 기억(info)에는 남아 있음 — 한 번 ‘원래 자리에 두는 버튼’으로 되살림
    if (!o.skipFromInfo) {
        o.skipFromInfo = true;
        for (const sel of Object.keys(o.info || {})) if (!(o.known || []).some(l => selectorOf(l) === sel) && !o.skip.includes(sel)) o.skip.push(sel);
    }
    return o.skip;
};
const isSkipped = (el) => skipped().some(x => { try { return el.matches(x); } catch { return false; } });
// 아예 숨긴 버튼: ⋯ 메뉴에도 원래 자리에도 안 보임(CSS 로 감춤 — 그 확장 코드는 그대로 돎)
const gone = () => (api.options().gone ??= []);
const isGone = (el) => gone().some(x => { try { return el.matches(x); } catch { return false; } });
// 기억한 줄은 ‘요소 이름’ 또는 ‘요소 이름 = 메뉴에 보일 이름’
const selectorOf = (line) => line.split(' = ')[0].trim();
const labelFor = (el) => { for (const line of known()) { const [sel, name] = line.split(' = '); try { if (name && el.matches(sel.trim())) return name.trim(); } catch { /* 잘못 적힌 줄 */ } } return ''; };
// 요소를 다시 찾을 수 있는 이름: id 가 있으면 id, 없으면 태그 + 첫 클래스
function nameOf(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const cls = [...el.classList].find(c => !c.startsWith('etk-'));
    return cls ? `${el.tagName.toLowerCase()}.${CSS.escape(cls)}` : '';
}
function applyKnown() {
    const list = known().map(selectorOf).filter(x => { try { document.querySelector(x); return !!x; } catch { return false; } });
    knownStyle ??= Object.assign(document.createElement('style'), { id: 'etk-sel-known' });
    if (!knownStyle.isConnected) document.head.append(knownStyle);
    const hide = gone().filter(x => { try { document.querySelector(x); return !!x; } catch { return false; } });
    knownStyle.textContent = (list.length ? `:is(${list.join(', ')}) { opacity: 0 !important; pointer-events: none !important; }` : '')
        + (hide.length ? `:is(${hide.join(', ')}) { display: none !important; }` : '');
}
// 붙이는 순간을 못 본 버튼(글을 고르기 전부터 붙어 있던 것): 그 요소의 id · 클래스를 짚어 모양을 입힌 스타일 파일의 주소(…/third-party/확장폴더/…)로 찾는다
function fromStyles(el) {
    const marks = [el.id && `#${CSS.escape(el.id)}`, ...[...el.classList].map(c => `.${CSS.escape(c)}`)].filter(Boolean);
    if (!marks.length) return '';
    const hit = (rules) => {
        for (const rule of rules) {
            if (rule.cssRules && !rule.selectorText) { if (hit(rule.cssRules)) return true; continue; }
            const sel = rule.selectorText;
            if (!sel || !marks.some(m => sel.includes(m))) continue;
            try { if (el.matches(sel)) return true; } catch { /* 이 브라우저가 못 읽는 고르는 글 */ }
        }
        return false;
    };
    for (const sheet of document.styleSheets) {
        const folder = decodeURIComponent(String(sheet.href || '').match(/\/third-party\/([^/]+)\//)?.[1] || '');
        if (!folder || folder === OWN) continue;
        try { if (hit(sheet.cssRules)) return folder; } catch { /* 다른 곳에서 온 스타일 파일은 못 읽음 */ }
    }
    return '';
}
// 같은 틱에 여러 번 불려도 저장은 한 번
let saveQueued = false;
function saveSoon() {
    if (saveQueued) return;
    saveQueued = true;
    queueMicrotask(() => { saveQueued = false; api.save(); });
}
// 그 버튼을 띄운 쪽: 붙는 걸 본 기록 → 전에 적어 둔 것 → 모양을 입힌 스타일 파일
function fromOf(el, was) {
    return origins.get(el) || [...el.querySelectorAll('*')].map(x => origins.get(x)).find(Boolean) || (was.from !== OWN && was.from) || fromStyles(el);
}
function learn(list) {
    let fresh = false, changed = false;
    for (const el of list) {
        const n = nameOf(el);
        if (!n) continue;
        if (skipped().includes(n) || gone().includes(n)) continue;
        if (!known().some(line => selectorOf(line) === n)) { known().push(n); fresh = true; }
        const was = info()[n] || {};
        const from = fromOf(el, was), does = doesOf(el);
        if (was.from === from && was.does === does) continue;
        info()[n] = { does, from };
        // 보여 주기용 이름(does)만 달라진 것은 저장을 서두르지 않음: 상태에 따라 글이 바뀌는 버튼은 메뉴를 열 때마다 저장했음. 다음에 다른 까닭으로 저장할 때 같이 적힘
        changed ||= was.from !== from;
    }
    if (fresh) applyKnown();
    if (fresh || changed) saveSoon();
}

// 휴대폰은 ⋯ 를 손가락으로 누르는 순간 브라우저가 고른 글을 먼저 풀어 버려서, 고른 글이 없다고 보고 ⋯ 를 치워 누를 수가 없었음
//   → ⋯ · 메뉴를 누르기 시작한 뒤 잠깐(holdUntil)은 마지막으로 고른 글을 그대로 쓴다
let holdUntil = 0, lastPick = null;
function pickedRange() {
    const got = livePick();
    if (got) return (lastPick = got);
    return Date.now() < holdUntil && lastPick?.range ? lastPick : null;
}
function livePick() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    const mes = el?.closest?.('#chat .mes');
    if (!mes || el.closest('textarea, input, .mes_edit_buttons, .edit_textarea')) return null;
    return { range, mes };
}

const clickable = 'button, [role="button"], .interactable, .menu_button, a[href]';

// 떠 있는 버튼 · 작은 창으로 볼 것: 화면에 보이고, 위치가 떠 있고, 누를 것이 있고, 채팅 글 · 알림 · 우리 것이 아님
// 떠 있고 화면에 보이는 요소면 그 자리 · 크기를, 아니면 null
function shownRect(el) {
    if (!(el instanceof HTMLElement) || !el.isConnected || el.closest(`.${OURS}-chip, .${OURS}-menu, #toast-container, #chat .mes_text, .mes_buttons`)) return null;
    const cs = getComputedStyle(el);
    if (!/fixed|absolute/.test(cs.position) || cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    return r.width && r.height ? r : null;
}
function isPopup(el) {
    const r = shownRect(el);
    if (!r || r.width > innerWidth * 0.8) return false;
    // 버튼 줄만 모은다 — 결과 카드 · 설명 창처럼 글이 많거나 키 큰 것은 그 확장이 보여 주려는 내용이라 숨기면 안 됨
    if (r.height > 140 || (el.textContent || '').trim().length > 80) return false;
    if (el.matches(clickable) || el.querySelector(clickable)) return true;
    // 버튼을 div 로 만들고 손가락 모양(cursor: pointer)만 준 확장도 있음 — 안쪽 몇 개만 보고 판단
    return [...el.querySelectorAll('*')].slice(0, 40).some(c => getComputedStyle(c).cursor === 'pointer');
}

const skippedShown = () => skipped().some(sel => { try { return [...document.querySelectorAll(sel)].some(el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden'); } catch { return false; } });

function watchStart() {
    if (watcher) return;
    hookInsert();
    found = new Set();
    // 이미 아는 버튼(모은 것 · 원래 자리에 두는 것)이 뜨는 순간 ⋯ 도 같은 화면 그리기에 띄움 — 시간을 재서 띄우면 그 버튼보다 늦게 떴음
    const familiar = (el) => !String(el.className || '').includes(OURS) && (isSkipped(el) || known().some(l => { try { return el.matches(selectorOf(l)); } catch { return false; } }));
    watcher = new MutationObserver(records => {
        let hit = false;
        for (const r of records) {
            if (r.type === 'attributes') { if (r.target.nodeType === 1) { found.add(r.target); hit ||= familiar(r.target); } continue; }
            for (const n of r.addedNodes) if (n.nodeType === 1) { found.add(n); hit ||= familiar(n); }
        }
        // 원래 자리에 두는 버튼이 있으면 그 버튼이 실제로 보일 때까지 화면 그리기마다 확인(붙는 순간엔 아직 크기가 0이라 한 번만 보면 놓쳤음, 최대 30번 ≈ 0.5초)
        // ⋯ 메뉴를 이미 열어 둔 뒤에 늦게 뜬 버튼(처음 고를 때 늦게 준비되는 확장)도 메뉴에 들어가게 메뉴를 다시 만듦
        if (hit && menu && !refill) refill = requestAnimationFrame(() => { refill = 0; if (active && menu && pickedRange()) { const n = popups().length; if (n !== menuCount) { menu.remove(); menu = null; openMenu(); } } });
        if (hit && !menu && !soon) {
            let tries = 0;
            const step = () => {
                soon = 0;
                // 굴리는 동안(reshow)은 띄우지 않음: 숨김 표시를 떼는 것도 이 감시에 잡혀서, 굴릴 때마다 ⋯ 가 치워졌다 바로 다시 떴음
                if (!active || menu || reshow || !pickedRange()) return;
                if (!skipped().length || skippedShown() || ++tries > 30) { showChip(); return; }
                soon = requestAnimationFrame(step);
            };
            soon = requestAnimationFrame(step);
        }
    });
    watcher.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
}

function watchStop() {
    watcher?.disconnect(); watcher = null;
    unhookInsert();
}

// 모은 것 중 가장 바깥 떠 있는 요소만(안쪽 버튼이 따로 잡히지 않게)
function popups() {
    const remembered = known().map(selectorOf).flatMap(x => { try { return x ? [...document.querySelectorAll(x)] : []; } catch { return []; } });
    // 기억한 버튼은 이름만 맞으면 CSS 로 숨겨지므로, 보이기만 하면 메뉴에 넣음. 크기 · 글자 수는 처음 보는 것을 모을지 정할 때만 봄
    //   (좁은 화면에서 버튼 줄이 화면 폭을 거의 채우면 숨겨지기만 하고 메뉴엔 안 나왔음)
    const mine = new Set(remembered);
    const list = [...new Set([...found, ...remembered])].filter(el => (mine.has(el) ? shownRect(el) : isPopup(el)) && !isSkipped(el) && !isGone(el));
    return list.filter(el => !list.some(o => o !== el && o.contains(el)));
}

function press(btn) {
    const sel = getSelection();
    if (sel && sel.isCollapsed && lastPick?.range) { try { sel.removeAllRanges(); sel.addRange(lastPick.range); } catch { /* 지워진 글 */ } }
    const opt = { bubbles: true, cancelable: true, button: 0 };
    btn.dispatchEvent(new PointerEvent('pointerdown', opt));
    btn.dispatchEvent(new MouseEvent('mousedown', opt));
    btn.dispatchEvent(new PointerEvent('pointerup', opt));
    btn.dispatchEvent(new MouseEvent('mouseup', opt));
    btn.dispatchEvent(new MouseEvent('click', opt));
}

// 우리 버튼을 눌러도 고른 글이 풀리지 않게
// 다른 확장이 '바깥을 누르면 내 창 닫기'를 문서 단계(capture)에 걸어 두면, ⋯ 를 누르는 순간 모아 둔 그 창이 지워져 메뉴에서 빠졌음
//   → 우리 버튼을 누를 땐 창(window) 단계에서 먼저 막아 그 처리가 돌지 않게
let shieldOn = false;
function shieldEarly() {
    if (shieldOn) return;
    shieldOn = true;
    for (const t of ['pointerdown', 'mousedown', 'touchstart']) window.addEventListener(t, e => { if (e.target instanceof Element && e.target.closest(`.${OURS}-chip, .${OURS}-menu`)) { holdUntil = Date.now() + 1500; e.stopImmediatePropagation(); } }, true);
}
function shielded(el) {
    shieldEarly();
    for (const t of ['pointerdown', 'mousedown']) el.addEventListener(t, e => { e.preventDefault(); e.stopPropagation(); });
    for (const t of ['pointerup', 'mouseup', 'click', 'touchend']) el.addEventListener(t, e => e.stopPropagation());
}

function placeNear(el, rect) {
    const pad = 8, w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.min(Math.max(pad, rect.right - w / 2), innerWidth - w - pad)}px`;
    let top = rect.bottom + 6;
    if (top + h > innerHeight - pad) top = Math.max(pad, rect.top - h - 6);
    el.style.top = `${top}px`;
}

// ‘원래 자리에 두는 버튼’은 그 확장이 고른 글 끝에 그대로 띄워서 ⋯ 와 같은 자리에 겹쳤음 — 겹치면 ⋯ 를 그 버튼 옆(자리가 없으면 아래)으로 비킴.
// 그 버튼이 ⋯ 보다 조금 늦게 뜨기도 해서 잠깐 뒤에 두 번 더 봄
function dodge() {
    if (!chip?.isConnected) return;
    const pad = 8, gap = 6, c = chip.getBoundingClientRect();
    for (const sel of skipped()) {
        let els = [];
        try { els = document.querySelectorAll(sel); } catch { continue; }
        for (const el of els) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
            if (c.right <= r.left || c.left >= r.right || c.bottom <= r.top || c.top >= r.bottom) continue;
            // 그 버튼 왼쪽에 같은 높이로 붙임(오른쪽에 두면 고른 글에서 멀어지고, 아래에 두면 따로 떨어져 보였음). 왼쪽에 자리가 없으면 오른쪽
            chip.style.left = r.left - gap - c.width >= pad ? `${r.left - gap - c.width}px` : `${Math.min(r.right + gap, innerWidth - c.width - pad)}px`;
            chip.style.top = `${r.top + (r.height - c.height) / 2}px`;
            return;
        }
    }
}

// 우리가 안 보이게 한 원래 버튼들(되돌릴 때 문서 전체를 뒤지지 않게 들고 있음)
const hidden = new Set();
function hide(list) {
    for (const el of list) { el.classList.add(`${OURS}-hidden`); hidden.add(el); }
}
function hideAll() {
    if (!chip && !menu && !hidden.size) return;
    chip?.remove(); chip = null;
    menu?.remove(); menu = null;
    for (const el of hidden) el.classList.remove(`${OURS}-hidden`);
    hidden.clear();
}

function labelOf(b) {
    return (b.textContent || '').trim() || b.getAttribute('aria-label') || b.title || '';
}
// 메뉴 한 줄에 보일 이름(첫 줄만)
const lineOf = (b) => labelOf(b).split('\n')[0].trim().slice(0, 40);

function iconOf(b) {
    const i = b.matches('i, [class*="fa-"]') ? b : b.querySelector('i, [class*="fa-"]');
    if (!i) return '';
    const c = document.createElement('i');
    c.className = [...i.classList].filter(x => x.startsWith('fa')).join(' ');
    return c.outerHTML;
}

// 떠 있는 창 안의 누를 것: 버튼 꼴(button · role · interactable)이 없으면 손가락 모양(cursor: pointer) 칸 가운데 가장 바깥 것만
function pressables(pop) {
    if (pop.matches(clickable)) return [pop];
    const real = [...pop.querySelectorAll(clickable)];
    if (real.length) return real;
    const pointer = [...pop.querySelectorAll('*')].filter(c => getComputedStyle(c).cursor === 'pointer');
    return pointer.filter(c => !pointer.some(o => o !== c && o.contains(c)));
}

// 비치지 않는 바탕색(없으면 빈 글)
const solidBg = (b) => { const c = getComputedStyle(b).backgroundColor; return c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) ? c : ''; };
// 색 고르기로 볼 것: 바탕색이 서로 다른 버튼이 둘 이상
const isColorRow = (buttons) => new Set(buttons.map(solidBg).filter(Boolean)).size >= 2;
// 떠 있는 창의 버튼을 이름 있는 것(한 줄씩)과 글 없는 것(한 줄에 모음)으로 가름. 메뉴를 그릴 때와 이름을 기억할 때 같은 판단을 쓰게 한곳에 둠
function sortButtons(pop) {
    const buttons = pressables(pop);
    // 글자 없이 바탕색만 다른 동그라미(색 고르기)는 이름(title)이 붙어 있어도 한 줄에 모음 — 색마다 한 줄씩 나오면 메뉴가 길어졌음
    const bare = buttons.filter(b => !(b.textContent || '').trim() && solidBg(b));
    const colorRow = isColorRow(bare) ? new Set(bare) : new Set();
    const named = [], dots = [];
    for (const b of buttons) (labelOf(b) && !colorRow.has(b) ? named : dots).push(b);
    return { named, dots, isColors: isColorRow(dots) };
}

function openMenu() {
    if (!pickedRange()) return hideAll();
    menu = document.createElement('div');
    menu.className = `${OURS}-menu`;
    shielded(menu);
    // 메뉴 순서는 설정에 적힌 순서(처음 보는 것은 맨 뒤)
    const rank = (el) => { const i = known().findIndex(line => { try { return el.matches(selectorOf(line)); } catch { return false; } }); return i < 0 ? 1e9 : i; };
    const pops = popups();
    menuCount = pops.length;
    hide(pops);
    // ⋯ 를 띄울 때 적은 이름은 버튼이 덜 채워진 채 읽은 것일 수 있어서, 메뉴를 여는 지금 한 번 더 읽어 다르면 고쳐 적음(같으면 저장 안 함)
    learn(pops);
    for (const pop of pops.sort((x, y) => rank(x) - rank(y))) {
        const { named, dots, isColors } = sortButtons(pop);
        for (const b of named) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `${OURS}-item`;
            item.innerHTML = `${iconOf(b)}<span></span>`;
            item.querySelector('span').textContent = lineOf(b);
            item.addEventListener('click', () => { hideAll(); press(b); });
            menu.append(item);
        }
        // 글 없는 버튼(색 고르기 같은 동그라미)는 한 줄에 모아 원래 바탕색으로
        if (dots.length) {
            const row = document.createElement('div');
            row.className = `${OURS}-item ${OURS}-dots`;
            // 글 없는 버튼 줄의 이름: 사용자가 적어 둔 이름 → 그 요소의 title → 버튼들 바탕색이 서로 다르면 색 고르기 버튼 → 아니면 이름 모를 버튼(설정 목록과 같은 말)
            row.innerHTML = `${iconOf(pop) || `<i class="fa-solid ${isColors ? 'fa-palette' : 'fa-ellipsis'}"></i>`}<span></span>`;
            row.querySelector('span').textContent = labelFor(pop) || pop.title || pop.getAttribute('aria-label') || (isColors ? COLORS : UNNAMED);
            for (const b of dots) {
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.className = `${OURS}-dot`;
                dot.style.background = getComputedStyle(b).backgroundColor;
                dot.innerHTML = iconOf(b);
                if (labelOf(b)) dot.title = labelOf(b).split('\n')[0];
                dot.addEventListener('click', () => { hideAll(); press(b); });
                row.append(dot);
            }
            menu.append(row);
        }
    }
    if (!menu.children.length) menu.innerHTML = `<div class="${OURS}-empty">모은 버튼이 지금 화면에 없어요. 글을 다시 고르면 나와요.</div>`;
    document.body.append(menu);
    // 메뉴는 ⋯ 버튼과 왼쪽 끝을 맞춤(가운데 맞춤이면 메뉴가 버튼 왼쪽으로 삐져나와 어긋나 보였음)
    placeNear(menu, chip.getBoundingClientRect());
    menu.style.left = `${Math.min(Math.max(8, chip.getBoundingClientRect().left), innerWidth - menu.offsetWidth - 8)}px`;
}

function showChip() {
    const got = pickedRange();
    if (!got) return hideAll();
    const list = popups();
    // 모을 게 없으면 원래대로 둠. 다만 전에 모은 버튼이 있고 ‘원래 자리에 두는 버튼’이 이미 떠 있으면 ⋯ 를 먼저 띄움(모을 버튼은 조금 늦게 떠서, 기다리면 ⋯ 만 늦게 따라 떴음)
    if (!list.length && !(known().length && skipped().length && skippedShown())) return;
    hide(list);
    learn(list);
    if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `${OURS}-chip`;
        chip.title = '고른 글로 할 일';
        chip.setAttribute('aria-label', chip.title);
        chip.innerHTML = '<i class="fa-solid fa-ellipsis"></i>';
        shielded(chip);
        chip.addEventListener('click', () => (menu ? (menu.remove(), menu = null) : openMenu()));
        document.body.append(chip);
    }
    const rects = got.range.getClientRects();
    const last = rects[rects.length - 1] || got.range.getBoundingClientRect();
    placeNear(chip, last);
    // 손가락 기기: 휴대폰이 띄우는 자체 메뉴(복사하기 · 찾아보기 등)는 고른 글 바로 위나 바로 아래 줄에 떠서 ⋯ 를 덮었음.
    //   그 메뉴는 고른 글이 걸친 줄 높이에는 안 뜨므로, ⋯ 를 고른 글 마지막 줄 높이에 두고 그 줄 끝 오른쪽(자리가 없으면 화면 오른쪽 끝)에 둠.
    //   자체 메뉴도 그대로 남아서 복사 같은 건 원래대로 쓸 수 있음
    if (matchMedia('(pointer: coarse)').matches) {
        const w = chip.offsetWidth, h = chip.offsetHeight, pad = 8;
        chip.style.top = `${Math.max(pad, last.top + (last.height - h) / 2)}px`;
        chip.style.left = `${Math.min(last.right + 22, innerWidth - w - pad)}px`;
    }
    dodge(); setTimeout(dodge, 150); setTimeout(dodge, 450);
}

// 휴대폰은 길게 누르면 낱말 하나가 먼저 골라지고, 그 순간 다른 확장들이 그 낱말을 기억해 둠. 그 뒤 손잡이로 넓힌 건 화면 신호(손 뗌)가 없어서
//   확장들이 모름 → 메뉴에서 형광펜을 골라도 처음 낱말에만 칠해졌음. 고른 글이 바뀌고 잠깐 멈추면 그 끝에서 손을 뗀 것처럼 알려 다시 읽게 함
let resyncT = 0, resyncedKey = '';
function resyncTouchPick() {
    clearTimeout(resyncT);
    if (!matchMedia('(pointer: coarse)').matches) return;
    resyncT = setTimeout(() => {
        const got = livePick();
        if (!got) return;
        const key = `${got.range.startOffset}:${got.range.endOffset}:${got.range.toString().length}`;
        if (key === resyncedKey) return;
        resyncedKey = key;
        const rects = got.range.getClientRects(), r = rects[rects.length - 1];
        if (!r) return;
        const target = got.range.endContainer.nodeType === 1 ? got.range.endContainer : got.range.endContainer.parentElement;
        const at = { bubbles: true, cancelable: true, clientX: r.right - 1, clientY: r.top + r.height / 2 };
        try { target.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'touch' })); } catch { /* 없음 */ }
        target.dispatchEvent(new MouseEvent('mouseup', at));
        try { target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true })); } catch { /* 없음 */ }
    }, 450);
}

// 입력칸에 글자를 칠 때마다 오는 신호: 띄운 것도 지켜보는 것도 없고 고른 글도 없으면 할 일이 없음
const typingIdle = () => !chip && !menu && !watcher && !hidden.size && !!document.activeElement?.matches?.('textarea, input') && getSelection()?.isCollapsed !== false;
function onSelection() {
    if (!active || typingIdle()) return;
    resyncTouchPick();
    if (!pickedRange()) { if (!menu) { hideAll(); watchStop(); } return; }
    watchStart();
    clearTimeout(timer);
    // 먼저 금방 한 번(이미 떠 있는 버튼이 있으면 ⋯ 를 바로 띄움: 늘 0.4초를 기다리면 늦게 뜸), 늦게 뜨는 버튼(0.3초쯤)을 위해 한 번 더
    // ‘원래 자리에 두는 버튼’이 있으면 그 버튼이 뜰 때까지 ⋯ 를 미룸(그 버튼이 붙는 순간 감시 콜백이 같이 띄움) — 먼저 띄우면 ⋯ 만 덩그러니 떴다가 그 버튼이 뒤따라 떴음.
    // 그 버튼이 이번엔 안 뜨는 경우를 위해 0.4초 뒤에는 그냥 띄움
    timer = setTimeout(() => {
        if (!active || menu) return;
        if (!skipped().length || skippedShown()) showChip();
        timer = setTimeout(() => { if (active && !menu) showChip(); }, 320);
    }, 80);
    // 그 버튼이 보이는 바로 그 화면 그리기에 ⋯ 를 같이 띄움: 고른 뒤 0.5초 동안 그리기마다 직접 확인(버튼이 다른 칸에 싸여 붙으면 ‘붙는 순간’ 감시로는 못 잡았음)
    if (skipped().length && !chip) {
        cancelAnimationFrame(poll);
        let frames = 0;
        const step = () => {
            if (!active || menu || chip || ++frames > 30 || !pickedRange()) return;
            if (skippedShown()) { showChip(); if (chip) return; }   // 모을 버튼이 아직 안 떠서 ⋯ 를 못 띄웠으면 계속 확인
            poll = requestAnimationFrame(step);
        };
        poll = requestAnimationFrame(step);
    }
}

function onPointerDown(e) {
    if (menu && !menu.contains(e.target) && !chip?.contains(e.target)) { menu.remove(); menu = null; }
}
// 채팅을 굴리는 동안은 ⋯ 를 치우고, 멈추면 같은 고른 글 끝에 다시 띄움(전에는 치우기만 해서 고른 글을 바꾸기 전엔 다시 안 떴음).
// 멈춘 때: scrollend 신호. 그 신호가 없는 브라우저는 굴림 신호 없이 화면이 두 번 그려진 때
const hasScrollEnd = 'onscrollend' in window;
let reshow = false, quietFrames = 0, quietRaf = 0;
function onScroll() {
    if (chip || menu) { reshow = true; hideAll(); }
    if (!reshow || hasScrollEnd) return;
    quietFrames = 0;
    quietRaf ||= requestAnimationFrame(quietStep);
}
function quietStep() {
    quietRaf = 0;
    if (++quietFrames < 2) quietRaf = requestAnimationFrame(quietStep);
    else onScrollEnd();
}
function onScrollEnd() {
    if (!reshow || !active) return;
    const got = pickedRange();
    // 고른 글이 채팅 칸 밖으로 굴러 나갔으면 다시 들어와 멈출 때까지 그대로 둠
    if (got && !inChatView(got.range)) return;
    reshow = false;
    if (got && !menu) showChip();
}
function inChatView(range) {
    const box = document.getElementById('chat').getBoundingClientRect(), rects = range.getClientRects();
    const last = rects[rects.length - 1] || range.getBoundingClientRect();
    return last.bottom > box.top && last.top < box.bottom;
}

export function start(a) {
    api = a;
    active = true;
    applyKnown();
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('pointerdown', onPointerDown, true);
    const chat = document.getElementById('chat');
    chat?.addEventListener('scroll', onScroll, { passive: true });
    chat?.addEventListener('scrollend', onScrollEnd, { passive: true });
}

export function stop() {
    active = false;
    clearTimeout(timer); clearTimeout(resyncT);
    cancelAnimationFrame(quietRaf); quietRaf = 0; reshow = false;
    hideAll(); watchStop();
    knownStyle?.remove();
    document.removeEventListener('selectionchange', onSelection);
    document.removeEventListener('pointerdown', onPointerDown, true);
    const chat = document.getElementById('chat');
    chat?.removeEventListener('scroll', onScroll);
    chat?.removeEventListener('scrollend', onScrollEnd);
}

// 설정 줄의 아이콘 버튼(글이 없으므로 읽어 주는 이름을 붙임)
const iconButton = (cls, label) => `<div class="fa-solid ${cls} interactable" title="${label}" aria-label="${label}"></div>`;
// ‘메뉴 이름’은 글 없는 버튼들을 한 줄로 모은 줄의 이름으로만 쓰임 → 그런 줄(과 이미 이름을 적어 둔 줄)에만 이름 칸을 둠.
// 이름 있는 버튼이 여럿인 줄은 버튼마다 제 이름으로 한 줄씩 나와서 이름 하나를 쓸 자리가 없음
function takesName(sel, name) {
    if (name) return true;
    let live = null;
    try { live = document.querySelector(sel); } catch { /* 잘못 적힌 줄 */ }
    if (live && sortButtons(live).dots.length) return true;
    const does = info()[sel]?.does;
    return !does || does.includes(COLORS) || does.includes(UNNAMED);
}
// 줄마다 있는 아이콘이 하는 일을 목록 위 한 군데에(마우스를 올려야 보이는 설명은 휴대폰에서 못 봄)
function guide(o, anyName) {
    const item = (icons, text) => `<span style="display: inline-block; margin-right: 1.2em;">${icons.map(c => `<i class="fa-solid ${c}"></i>`).join(' ')} ${text}</span>`;
    const items = [];
    if (o.known.length > 1) items.push(item(['fa-chevron-up', 'fa-chevron-down'], '순서 바꾸기'));
    if (o.known.length || o.skip.length) items.push(item(['fa-eye-slash'], '메뉴에도 원래 자리에도 안 보이게 숨기기'));
    if (o.known.length) items.push(item(['fa-xmark'], '모으지 않고 원래 자리에 두기'));
    if (anyName) items.push(item([], '메뉴 이름 칸을 비워 두면 원래 이름으로 나와요'));
    return items.length ? `<small class="etk-known-guide">${items.join('')}</small>` : '';
}

export function options(box, a) {
    api ??= a;
    const o = a.options(); o.known ??= []; o.gone ??= [];
    const render = () => {
        const tops = [...box.querySelectorAll('.etk-known-list')].map(l => l.scrollTop);   // 다시 그려도 보던 자리 그대로
        skipped();
        const named = o.known.map(line => line.split(' = ')).map(([sel, name]) => takesName(sel.trim(), (name || '').trim()));
        box.innerHTML = `<div class="etk-sub">⋯ 메뉴에 모은 버튼</div><small>글을 고르면 ⋯ 하나만 뜨고, 누르면 아래 버튼들이 이 순서로 나와요.</small>${guide(o, named.includes(true))}`;
        const describe = (row, sel) => {
            const meta = info()[sel] || {};
            // 아직 정보가 없는 줄: 그 버튼이 지금 화면에 있으면 거기서 하는 일을 읽고, 없으면 띄우는 확장이 꺼졌거나 지워진 것
            let live = null;
            try { live = document.querySelector(sel); } catch { /* 잘못 적힌 줄 */ }
            const does = meta.does || (live ? doesOf(live) : '');
            row.querySelector('.etk-known-does').textContent = does || UNNAMED;   // 코드 이름(div.xx)은 화면에 보이지 않게
            const fromEl = row.querySelector('.etk-known-from');
            // 낸 확장 빈칸: 글을 고르는 동안 그 버튼이나 안의 것이 붙는 걸 못 본 경우(고르기 전부터 화면에 붙어 있던 버튼) → 다시 골라도 알 길이 없으니 그렇게 말함.
            //   아직 한 번도 적힌 적 없는 줄만 글을 고르면 찾아본다고 안내
            const noFrom = info()[sel] ? '어느 확장의 버튼인지 알 수 없어요' : '글을 한 번 고르면 어느 확장의 버튼인지 찾아봐요';
            fromEl.textContent = meta.from ? `${meta.from} 확장` : does ? noFrom : '지금 이 버튼을 띄우는 확장이 없어서(꺼졌거나 지워짐) 무슨 버튼인지 알 수 없어요. 필요 없으면 지워요';
            row.dataset.orphan = does ? '' : '1';
            if (meta.from) extensionName(meta.from).then(n => { fromEl.textContent = `${n} 확장`; });
        };
        const commit = () => { a.save(); if (active) applyKnown(); };
        // 줄이 많아도 설정 칸이 끝없이 길어지지 않게, 칸마다 줄을 스크롤되는 목록에 담음(칸 제목 다음에 처음 붙일 때 새 목록을 만듦)
        const listEl = () => { let l = box.lastElementChild; if (!l?.classList.contains('etk-known-list')) { l = document.createElement('div'); l.className = 'etk-known-list'; box.append(l); } return l; };
        o.known.forEach((line, i) => {
            const [sel0, name = ''] = line.split(' = ');
            const sel = sel0.trim();
            const row = document.createElement('div');
            row.className = 'etk-known-row';
            row.innerHTML = `<div class="etk-known-move">${iconButton('fa-chevron-up', '위로')}${iconButton('fa-chevron-down', '아래로')}</div>
                <div class="etk-known-text"><div class="etk-known-does"></div><small class="etk-known-from"></small></div>
                ${named[i] ? '<input class="text_pole" placeholder="메뉴 이름" aria-label="메뉴 이름" title="비워 두면 원래 이름으로 나와요">' : ''}${iconButton('fa-eye-slash etk-known-del etk-known-gone', '아예 숨기기')}${iconButton('fa-xmark etk-known-del etk-known-out', '모으지 않고 원래 자리에 두기')}`;
            describe(row, sel);
            const input = row.querySelector('input');
            if (input) input.value = name.trim();
            input?.addEventListener('change', () => { o.known[i] = input.value.trim() ? `${sel} = ${input.value.trim()}` : sel; commit(); });
            const move = (d) => { const j = i + d; if (j < 0 || j >= o.known.length) return; [o.known[i], o.known[j]] = [o.known[j], o.known[i]]; commit(); render(); };
            row.querySelector('.fa-chevron-up').addEventListener('click', () => move(-1));
            row.querySelector('.fa-chevron-down').addEventListener('click', () => move(1));
            row.querySelector('.etk-known-out').addEventListener('click', () => { o.known.splice(i, 1); if (!o.skip.includes(sel)) o.skip.push(sel); commit(); render(); });
            row.querySelector('.etk-known-gone').addEventListener('click', () => { o.known.splice(i, 1); if (!o.gone.includes(sel)) o.gone.push(sel); commit(); render(); });
            listEl().append(row);
        });
        if (!o.known.length) box.insertAdjacentHTML('beforeend', '<small>아직 없어요. 채팅 글을 한 번 고르면 저절로 채워져요.</small>');
        if (o.skip.length) {
            box.insertAdjacentHTML('beforeend', '<div class="etk-sub etk-skip-head">원래 자리에 두는 버튼</div><small>⋯ 메뉴로 모으지 않아서, 그 확장이 띄우는 자리에 따로 떠요.</small>');
            o.skip.forEach((sel, i) => {
                const row = document.createElement('div');
                row.className = 'etk-known-row etk-skip-row';
                row.innerHTML = `<div class="etk-known-text"><div class="etk-known-does"></div><small class="etk-known-from"></small></div><div class="menu_button etk-unskip" title="다시 ⋯ 메뉴에 모으기" aria-label="다시 ⋯ 메뉴에 모으기"><i class="fa-solid fa-arrow-up"></i> 다시 모으기</div>`;
                describe(row, sel);
                row.querySelector('.etk-unskip').addEventListener('click', () => { o.skip.splice(i, 1); if (!o.known.some(l => selectorOf(l) === sel)) o.known.push(sel); commit(); render(); });
                row.insertAdjacentHTML('beforeend', '<div class="menu_button etk-forget etk-skip-gone" title="아예 숨기기" aria-label="아예 숨기기"><i class="fa-solid fa-eye-slash"></i></div>');
                row.querySelector('.etk-skip-gone').addEventListener('click', () => { o.skip.splice(i, 1); if (!o.gone.includes(sel)) o.gone.push(sel); commit(); render(); });
                if (row.dataset.orphan) {   // 띄우는 확장이 없는 버튼은 목록에서 아예 지울 수 있게
                    row.insertAdjacentHTML('beforeend', '<div class="menu_button etk-forget etk-skip-trash" title="목록에서 지우기" aria-label="목록에서 지우기"><i class="fa-solid fa-trash-can"></i></div>');
                    row.querySelector('.etk-skip-trash').addEventListener('click', () => { o.skip.splice(i, 1); delete info()[sel]; commit(); render(); });
                }
                listEl().append(row);
            });
        }
        if (o.gone.length) {
            box.insertAdjacentHTML('beforeend', '<div class="etk-sub etk-skip-head">숨긴 버튼</div><small>글을 골라도 어디에도 안 떠요.</small>');
            o.gone.forEach((sel, i) => {
                const row = document.createElement('div');
                row.className = 'etk-known-row etk-skip-row';
                row.innerHTML = '<div class="etk-known-text"><div class="etk-known-does"></div><small class="etk-known-from"></small></div><div class="menu_button etk-unskip" title="다시 ⋯ 메뉴에 모으기" aria-label="다시 ⋯ 메뉴에 모으기"><i class="fa-solid fa-arrow-up"></i> 다시 모으기</div>';
                describe(row, sel);
                row.querySelector('.etk-unskip').addEventListener('click', () => { o.gone.splice(i, 1); if (!o.known.some(l => selectorOf(l) === sel)) o.known.push(sel); commit(); render(); });
                listEl().append(row);
            });
        }
        box.querySelectorAll('.etk-known-list').forEach((l, k) => { l.scrollTop = tops[k] || 0; });
    };
    render();
}
