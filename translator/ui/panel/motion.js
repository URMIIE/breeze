// 펼침과 고르기의 움직임(시안의 방식 그대로): 누르는 것에 data-t="id", 펼쳐질 자리는 foldHtml(id, on, 안).
//   wire(root, onPick)      root 안의 data-t 누름 → 같은 id 의 .fold 를 펴고 접는다(누른 것에 .up). 고르는 목록(.picks)의 줄을 누르면 onPick(목록 id, 값, 줄)
//   selHtml / picksHtml     테두리 있는 고르기 칸과 그 아래로 펴지는 목록
//   wherePick(box, value, onPick, options)   쓰는 곳 셋 고르기(모든 채팅 / 이 캐릭터 / 지금 채팅만)
// 옛 화면이 쓰는 foldHtml(key, inner) · playOpen · playClose · playTurn 은 그 화면들이 새로 짜일 때까지 남긴다.

import { esc, SV, PLACE_NAME } from './text.js';

/** 펼쳐질 자리. 둘째 값이 글(옛 부름: foldHtml(key, inner))이면 옛 꼴로 그린다 */
export function foldHtml(id, on, inner) {
    if (typeof on === 'string' && inner === undefined) return `<div class="btr-fold" data-fold="${id}"><div class="btr-fold-in">${on}</div></div>`;
    return `<div class="fold${on ? ' on' : ''}" data-f="${esc(id)}"><div>${inner}</div></div>`;
}

/** 고르기 칸: 지금 값과 화살표. 누르면 같은 id 의 fold 가 펴진다. need: 골라야 하는 칸(강조색 테두리) */
export const selHtml = (id, text, { on = false, need = false, style = '' } = {}) =>
    `<div class="sel${on ? ' up' : ''}${need ? ' need' : ''}" data-t="${esc(id)}" role="button" tabindex="0" style="${style}"><span class="cutv" data-val="${esc(id)}">${esc(text)}</span>${SV('down')}</div>`;

/** 고르는 목록. items: [{ value, label, small? }], cur: 지금 값 */
export const picksHtml = (id, items, cur) => `<div class="picks" data-for="${esc(id)}">${items.map(it =>
    `<div class="rule" data-value="${esc(it.value)}" role="button" tabindex="0"><span>${esc(it.label)}${it.small ? `<small>${esc(it.small)}</small>` : ''}</span><i class="radio${it.value === cur ? ' on' : ''}"></i></div>`).join('')}</div>`;

const foldOf = (root, id) => [...root.querySelectorAll('.fold[data-f]')].find(f => f.dataset.f === id);

/** 펴고 접는다. on 을 주지 않으면 뒤집는다. 편 뒤 true */
export function setFold(root, id, on) {
    const fold = foldOf(root, id);
    if (!fold) return false;
    const next = on ?? !fold.classList.contains('on');
    fold.classList.toggle('on', next);
    for (const t of root.querySelectorAll('[data-t]')) if (t.dataset.t === id) t.classList.toggle('up', next);
    return next;
}

/** 지금 펴진 자리의 id 들(다시 그린 뒤 되살리려고) */
export const openFolds = root => [...root.querySelectorAll('.fold.on[data-f]')].map(f => f.dataset.f);

/**
 * root 안의 펼침과 고르기를 잇는다.
 * @param {(id: string, value: string, row: HTMLElement) => void} [onPick] 고르는 목록의 줄을 눌렀을 때
 * @param {(id: string, on: boolean) => void} [onFold] 펴거나 접은 뒤(펼 때 안을 채우려면)
 * @returns {() => void} 끊기
 */
export function wire(root, onPick, onFold) {
    root.setAttribute('data-wired', '');
    function onClick(event) {
        // 안쪽에 따로 이은 자리(다른 화면을 펴 그린 곳)의 누름은 그쪽이 맡는다
        if (event.target.closest('[data-wired]') !== root) return;
        const row = event.target.closest('.picks .rule');
        if (row && root.contains(row)) {
            const picks = row.closest('.picks'), id = picks.dataset.for;
            for (const mark of picks.querySelectorAll('.radio')) mark.classList.remove('on');
            row.querySelector('.radio')?.classList.add('on');
            setFold(root, id, false);
            onPick?.(id, row.dataset.value, row);
            return;
        }
        const t = event.target.closest('[data-t]');
        if (!t || !root.contains(t) || event.target.closest('input, textarea')) return;
        const on = setFold(root, t.dataset.t);
        onFold?.(t.dataset.t, on);
    }
    // 키보드: 버튼이 아닌 누르는 것도 Enter · 스페이스로 눌린다
    function onKey(event) {
        if ((event.key !== 'Enter' && event.key !== ' ') || !event.target.matches?.('[role="button"]') || event.target.closest('[data-wired]') !== root) return;
        event.preventDefault();
        event.target.click();
    }
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    return () => { root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); };
}

let whereCount = 0;
/**
 * 쓰는 곳 고르기를 box 에 그린다: '쓰는 곳' 줄(고르기 칸) + 그 아래로 펴지는 셋.
 * @param {'all' | 'card' | 'chat'} value 지금 값
 * @param {(place: string) => void} onPick
 * @param {{ label?: string, places?: string[] }} [options] label '' 이면 이름 없이 고르기 칸만. places: 고를 수 있는 곳(채팅이 없으면 ['all'])
 * @returns {{ set(value): void }}
 */
export function wherePick(box, value, onPick, { label = '쓰는 곳', places = ['all', 'card', 'chat'] } = {}) {
    const id = `where${++whereCount}`;
    const items = places.map(place => ({ value: place, label: PLACE_NAME[place] }));
    // 이름이 있으면 고르는 칸을 이름 바로 옆에 둔다(.btr-where): 최소 폭을 주면 글이 칸 오른쪽 끝으로 밀려 이름과 떨어진다
    const sel = selHtml(id, PLACE_NAME[value] ?? PLACE_NAME.all, { style: label ? '' : 'min-width:150px' });
    box.innerHTML = `${label ? `<div class="two r btr-where"><span>${esc(label)}</span>${sel}</div>` : sel}${foldHtml(id, false, picksHtml(id, items, value))}`;
    const off = wire(box, (_, place) => { set(place); onPick(place); });
    function set(place) {
        box.querySelector('.cutv').textContent = PLACE_NAME[place] ?? '';
        for (const row of box.querySelectorAll('.picks .rule')) row.querySelector('.radio').classList.toggle('on', row.dataset.value === place);
    }
    return { set, close: off };
}

// ── 옛 화면용(새로 짜이면 지운다) ──
export function playOpen(fold) { fold?.classList.add('btr-fold-opening'); }
export function playClose(fold) {
    if (!fold) return;
    fold.classList.add('btr-fold-closing');
    fold.inert = true;
    const run = fold.getAnimations?.()[0];
    if (run) run.finished.then(() => fold.remove(), () => fold.remove());
    else fold.remove();
}
export function playTurn(icon, opened) { icon?.classList.add(opened ? 'btr-turn-open' : 'btr-turn-close'); }
