// 아이콘 격자 그리기와 차례 · 폴더 · 숨김 계산.
import { colorPair, FOLDER_PREFIX } from './settings.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FA_NAME = /^[a-z0-9-]+$/;

export const folderToken = (id) => `${FOLDER_PREFIX}${id}`;
export const folderOf = (o, key) => o.folders.find(f => f.items.includes(key));
export const nameOf = (o, item) => o.names[item.key] || item.label;

/** 맨 위 격자에 놓일 것의 차례(열쇠 · 폴더 표시). 숨긴 것 · 폴더 안의 것은 빠짐. 차례에 없는 새 줄은 메뉴 차례대로 뒤에 */
export function topLevel(o, items) {
    const live = new Set(items.map(i => i.key));
    const inFolder = new Set(o.folders.flatMap(f => f.items));
    const folders = new Set(o.folders.map(f => folderToken(f.id)));
    const hidden = new Set(o.hidden);
    const shows = (k) => folders.has(k) || (live.has(k) && !inFolder.has(k) && !hidden.has(k));
    const out = [...new Set(o.order)].filter(shows);
    const placed = new Set(out);
    for (const k of [...items.map(i => i.key), ...folders]) if (!placed.has(k) && shows(k)) { out.push(k); placed.add(k); }
    return out;
}

/** 지금 보이는 차례를 저장할 차례로 굳힘(끌어서 옮기기 전에). 화면에 없는 열쇠(지금 꺼진 확장)는 원래 자리 근처에 남김 */
export function settleOrder(o, items) {
    const shown = topLevel(o, items);
    const shownSet = new Set(shown);
    const rest = o.order.filter(k => !shownSet.has(k));
    o.order = [...shown, ...rest];
}

export function moveBefore(o, from, to) {
    const list = o.order.filter(k => k !== from);
    const at = to ? list.indexOf(to) : -1;
    if (at < 0) list.push(from); else list.splice(at, 0, from);
    o.order = list;
}

// 아이콘 그림: 고른 그림 > 고른 글꼴 아이콘 > 줄의 아이콘(글꼴, 없으면 줄의 그림을 복제)
function iconInner(o, item) {
    const mine = o.icons[item.key] || {};
    if (mine.img) return `<img class="bw-full" alt="" src="${esc(mine.img)}">`;
    if (mine.fa && FA_NAME.test(mine.fa)) return `<i class="fa-solid fa-${mine.fa}"></i>`;
    if (item.icon.fa) return `<i class="${esc(item.icon.fa)}"></i>`;
    return '<span class="bw-pic"></span>';
}
function colorVars(o, key) {
    const [a, b] = colorPair(o, key, o.icons[key]?.color);
    return `--v1: ${esc(a)}; --v2: ${esc(b)}`;
}

export function appHtml(o, item) {
    const name = nameOf(o, item);
    return `<div class="bw-app${item.on ? ' bw-on' : ''}" role="button" tabindex="0" data-key="${esc(item.key)}" aria-label="${esc(name)}">`
        + '<span class="bw-x" role="button" aria-label="숨기기"><i class="fa-solid fa-minus"></i></span>'
        + `<div class="bw-ic" style="${colorVars(o, item.key)}">${iconInner(o, item)}</div>`
        + `<div class="bw-label">${esc(name)}</div></div>`;
}

// 폴더 타일 안의 작은 아이콘: 그 아이콘의 타일 그대로(색 · 그림), 넷까지. 숨긴 것 · 지금 메뉴에 없는 것은 뺌
const MINI_COUNT = 4;
function minisHtml(o, folder, byKey) {
    const hidden = new Set(o.hidden);
    const keys = folder.items.filter(k => byKey.has(k) && !hidden.has(k)).slice(0, MINI_COUNT);
    return keys.map(k => `<div class="bw-ic bw-mini" data-key="${esc(k)}" style="${colorVars(o, k)}">${iconInner(o, byKey.get(k))}</div>`).join('');
}

export function folderHtml(o, folder, byKey) {
    return `<div class="bw-app bw-folder" role="button" tabindex="0" data-key="${esc(folderToken(folder.id))}" data-folder="${esc(folder.id)}" aria-label="${esc(folder.name)}">`
        + '<span class="bw-x" role="button" aria-label="폴더 풀기"><i class="fa-solid fa-minus"></i></span>'
        + `<div class="bw-ic bw-fold">${minisHtml(o, folder, byKey)}</div>`
        + `<div class="bw-label">${esc(folder.name)}</div></div>`;
}

// 줄의 그림(svg · img)은 글로 옮기지 않고 노드를 복제해 넣음(글로 옮기면 그 그림에 붙은 속성을 다시 읽어야 함)
export function fillPictures(box, byKey) {
    for (const slot of box.querySelectorAll('.bw-pic')) {
        const key = slot.closest('[data-key]')?.dataset.key;
        const node = byKey.get(key)?.icon.node;
        if (node) slot.replaceWith(node.cloneNode(true)); else slot.replaceWith(Object.assign(document.createElement('i'), { className: 'fa-solid fa-cube' }));
    }
}

/** 격자 안을 지금 설정 · 줄로 다시 채움 */
export function paintGrid(grid, o, items) {
    const byKey = new Map(items.map(i => [i.key, i]));
    const html = topLevel(o, items).map(k => {
        if (k.startsWith(FOLDER_PREFIX)) {
            const f = o.folders.find(x => folderToken(x.id) === k);
            return f ? folderHtml(o, f, byKey) : '';
        }
        return appHtml(o, byKey.get(k));
    }).join('');
    grid.innerHTML = html;
    fillPictures(grid, byKey);
}
