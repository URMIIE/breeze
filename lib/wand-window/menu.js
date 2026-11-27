// 마법봉 메뉴(#extensionsMenu)의 줄을 읽고, 우리 창에서 누르면 원래 줄을 대신 눌러 준다.
// 원래 줄은 옮기거나 고치지 않는다: 확장들이 저마다 자기 줄에 클릭 처리를 붙여 두어서, 노드를 옮기면 그 처리가 엉키는 확장이 있다.

// 줄로 볼 요소. 줄 안에 또 든 것은 바깥 줄 하나로 본다(속 버튼만 따로 누르면 줄의 처리가 안 돎)
const ITEM = '.list-group-item, .extensionsMenuExtensionButton, button, a, [role="button"]';
// 줄 열쇠를 읽는 차례. 예전 메뉴 꾸미기 확장이 같은 차례로 열쇠를 저장해 두어서, 그 숨김 · 차례 설정을 그대로 옮길 수 있게 맞춤
const KEY_ATTRS = ['id', 'data-extension-name', 'data-name', 'data-module', 'data-i18n', 'title', 'aria-label'];
const TOGGLE_ICON = /^fa-toggle-(on|off)$/;

export const menuRoot = () => document.getElementById('extensionsMenu');

// 줄이 다른 확장 · 테마 때문에 안 보이는지. 메뉴 자체는 닫혀 있을 때도 읽어야 해서 메뉴는 빼고 본다.
// visibility 는 안 봄: 우리가 메뉴를 숨길 때 쓰지 않지만, 쓰는 테마가 있으면 메뉴 안 전부가 hidden 으로 읽혀 줄이 모두 사라짐
function hiddenInside(el, root) {
    for (let n = el; n && n !== root; n = n.parentElement) {
        if (getComputedStyle(n).display === 'none') return true;
    }
    return false;
}

// 괄호만 있는 글(켜짐 · 꺼짐 표시)은 이름이 아님: 그런 줄은 아이콘의 title 이 이름을 들고 있었음
const usable = (t) => !!t && !/^\(.*\)$/.test(t);
function labelOf(el) {
    const tries = [
        el.querySelector('.list-group-item-label, .menu_button, .menu-label, span')?.textContent,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.querySelector('[title]')?.getAttribute('title'),
        el.textContent,
    ];
    for (const t of tries) {
        const text = String(t || '').replace(/\s+/g, ' ').trim();
        if (usable(text)) return text;
    }
    return '';
}

function keyOf(el, label) {
    for (const attr of KEY_ATTRS) {
        const v = (el.getAttribute(attr) || '').trim();
        if (v) return v;
    }
    const href = (el.getAttribute('href') || '').trim();
    if (href && href !== '#') return href;
    return label;
}

// 글꼴 아이콘이면 그 클래스, 아니면 줄에 든 그림(svg · img)을 복제해 씀. 켜짐 · 꺼짐 스위치 아이콘은 줄 아이콘이 아님
function iconOf(el) {
    const cands = [el, ...el.querySelectorAll('[class*="fa-"]')];
    for (const c of cands) {
        const cls = [...c.classList].filter(k => k.startsWith('fa') && !TOGGLE_ICON.test(k));
        if (cls.some(k => k.startsWith('fa-') && !/^fa-(solid|regular|brands|fw)$/.test(k))) return { fa: cls.join(' ') };
    }
    const pic = el.querySelector('svg, img');
    return pic ? { node: pic } : { fa: 'fa-solid fa-cube' };
}

const isOn = (el) => !!el.querySelector('.fa-toggle-on, input[type="checkbox"]:checked');

/** 지금 메뉴에 보이는 줄 전부: { key, label, icon, on, el } */
export function readMenu() {
    const root = menuRoot();
    if (!root) return [];
    const out = [], seen = new Set();
    for (const el of root.querySelectorAll(ITEM)) {
        const outer = el.parentElement?.closest(ITEM);
        if (outer && root.contains(outer)) continue;
        if (hiddenInside(el, root)) continue;
        const label = labelOf(el);
        const key = keyOf(el, label);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({ key, label: label || key, icon: iconOf(el), on: isOn(el), el });
    }
    return out;
}

/** 줄이 바뀌었는지 견줄 글(열려 있는 동안 메뉴가 바뀌면 다시 그릴지 정함) */
export const signature = (items) => items.map(i => `${i.key}\u0001${i.label}\u0001${i.icon.fa || 'pic'}\u0001${i.on ? 1 : 0}`).join('\u0002');

// 줄을 대신 누르기 전에, 안 보이는 원래 메뉴를 그 줄이 우리 아이콘 자리에 오도록 잠깐 옮겨 둔다.
// 눌렀을 때 그 줄 옆에 작은 메뉴를 띄우는 확장(그림 생성)은 줄의 화면 자리를 보고 띄우는데, 숨긴 메뉴의 줄은 자리가 0 이라 화면 구석에 떴음
function placeOver(root, el, at) {
    const html = document.documentElement;
    html.style.setProperty('--bw-px', '0px');
    html.style.setProperty('--bw-py', '0px');
    html.classList.add('bw-probe');
    const m = root.getBoundingClientRect(), r = el.getBoundingClientRect();
    html.style.setProperty('--bw-px', `${Math.round(at.left - (r.left - m.left))}px`);
    html.style.setProperty('--bw-py', `${Math.round(at.top - (r.top - m.top))}px`);
}

// 옆 메뉴를 띄우는 확장의 자리 계산(Popper)은 한 박자 뒤에 끝나서, 두 프레임 뒤에 메뉴를 제자리로
const releaseProbe = () => requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('bw-probe')));

/** 열쇠로 원래 줄을 찾아 대신 누름. at = 우리 아이콘의 화면 자리 */
export function press(key, at) {
    const root = menuRoot();
    const item = readMenu().find(i => i.key === key);
    if (!root || !item) return false;
    if (at) placeOver(root, item.el, at);
    try {
        item.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } finally {
        if (at) releaseProbe();
    }
    return true;
}

export function clearProbe() {
    const html = document.documentElement;
    html.classList.remove('bw-probe');
    html.style.removeProperty('--bw-px');
    html.style.removeProperty('--bw-py');
}
