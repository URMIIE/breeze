// 늘 떠 있는 줄: 창을 닫아도 자주 쓰는 아이콘 몇 개를 작은 줄로 띄워 둔다. 왼쪽 손잡이로 끌어 옮김.
// 줄에 둔 아이콘의 이름 · 그림은 둘 때 적어 둠(meta): 실리태번을 연 직후엔 늦게 줄을 붙이는 확장이 있어 메뉴에서 아직 못 찾음
import { readMenu } from './menu.js';
import { appHtml, fillPictures } from './grid.js';
import { bucket } from './settings.js';
import { dragWith, fit } from './drag.js';

let el = null, S = null, H = null;

const place = () => ((S.o.place[bucket()] ??= {}).dock ??= {});

function itemsFor() {
    if (!S.items.length) S.items = readMenu();
    const byKey = new Map(S.items.map(i => [i.key, i]));
    return S.o.dock.items.map(k => byKey.get(k) || { key: k, label: S.o.dock.meta[k]?.label || k, icon: { fa: S.o.dock.meta[k]?.fa || 'fa-solid fa-cube' }, on: false });
}

function paint() {
    const items = itemsFor();
    const body = items.length
        ? items.map(i => appHtml(S.o, i)).join('')
        : '<div class="bw-dock-empty">꾸미기에서 아이콘을 눌러 줄에 둘 것을 골라요.</div>';
    el.innerHTML = `<div class="bw-dock-grip" aria-label="줄 옮기기"></div>${body}`;
    fillPictures(el, new Map(items.map(i => [i.key, i])));
    el.querySelector('.bw-dock-grip').addEventListener('pointerdown', onGripDown);
}

function applyPlace() {
    const r = el.getBoundingClientRect(), p = place();
    let left, top;
    if (Number.isFinite(p.x)) { left = p.x * innerWidth; top = p.y * innerHeight; } else {
        const form = document.getElementById('send_form')?.getBoundingClientRect();
        left = (innerWidth - r.width) / 2;
        top = (form?.top || innerHeight - 60) - r.height - 10;
    }
    const f = fit(left, top, r.width, r.height);
    Object.assign(el.style, { left: `${f.left}px`, top: `${f.top}px`, transform: '' });
}

function onGripDown(e) {
    if (e.button > 0) return;
    e.preventDefault();
    const start = el.getBoundingClientRect();
    dragWith(e, (dx, dy) => {
        const f = fit(start.left + dx, start.top + dy, start.width, start.height);
        el.style.transform = `translate3d(${f.left - start.left}px, ${f.top - start.top}px, 0)`;
    }, (dx, dy) => {
        const f = fit(start.left + dx, start.top + dy, start.width, start.height);
        Object.assign(el.style, { left: `${f.left}px`, top: `${f.top}px`, transform: '' });
        if (!dx && !dy) return;
        Object.assign(place(), { x: f.left / innerWidth, y: f.top / innerHeight });
        H.save();
    });
}

function onClick(e) {
    // 원래 줄을 대신 누른 클릭이 문서까지 올라가 옆 메뉴를 바로 닫지 않게(창과 같은 까닭)
    e.stopPropagation();
    const app = e.target.closest('.bw-app');
    if (app) H.activate(app.dataset.key, app);
}
const onViewport = () => { if (el) applyPlace(); };

export function render(state, helpers) {
    S = state; H = helpers;
    if (!S.o.dock.on) return remove();
    if (!el) {
        el = document.createElement('div');
        el.id = 'bw_dock';
        el.className = 'bw-glass';
        el.setAttribute('role', 'toolbar');
        el.addEventListener('click', onClick);
        document.body.append(el);
        addEventListener('resize', onViewport);
    }
    H.applyVars(el);
    paint();
    applyPlace();
}

export function applyLook(applyVars) { if (el) applyVars(el); }

export function remove() {
    el?.remove();
    el = null;
    removeEventListener('resize', onViewport);
}
