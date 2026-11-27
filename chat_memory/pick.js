// 이 채팅 기억: 꾸민 고르기 칸(버튼을 누르면 그 자리에서 목록이 펼쳐짐).
import { tr } from './shared.js';

/**
 * 꾸민 고르기 칸: 버튼(지금 값 ⌄)를 누르면 아래(자리가 모자라면 위)로 목록이 펼쳐짐: 기본 select 대신.
 * items: [{ v, label, sub?, sep? }] (sep: 그 줄 위에 가는 선), value: 지금 v, onPick(v)
 */
export let openPick = null;   // 지금 펼친 고르기 칸의 닫기: 한 번에 하나만 펼침
export function makePick({ items, value, onPick, empty = '—' }) {
    const wrap = document.createElement('div');
    wrap.className = 'cpm-pick';
    const cur = items.find(x => x.v === value);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cpm-pick-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="cpm-pick-val"></span><span class="cpm-pick-sub"></span><i class="fa-solid fa-chevron-down cpm-pick-arrow" aria-hidden="true"></i>';
    btn.querySelector('.cpm-pick-val').textContent = cur?.label ?? empty;
    btn.querySelector('.cpm-pick-sub').textContent = cur?.sub ?? '';
    btn.title = cur?.label ?? '';
    const pop = document.createElement('div');
    pop.className = 'cpm-pick-pop';
    pop.hidden = true;
    const list = document.createElement('div');
    list.className = 'cpm-pick-list';
    list.setAttribute('role', 'listbox');
    if (items.length > 8) {
        const q = document.createElement('input');
        q.type = 'search';
        q.className = 'text_pole cpm-pick-search';
        q.placeholder = tr`Search`;
        q.addEventListener('input', () => { const t = q.value.trim().toLowerCase(); opts.forEach(o => { o.hidden = !!t && !o.textContent.toLowerCase().includes(t); }); move(0, true); });
        pop.append(q);
    }
    const opts = items.map(x => {
        const o = document.createElement('div');
        o.className = 'cpm-pick-opt' + (x.sep ? ' cpm-pick-sep' : '');
        o.setAttribute('role', 'option');
        o.setAttribute('aria-selected', String(x.v === value));
        o.innerHTML = '<i class="fa-solid fa-check cpm-pick-check" aria-hidden="true"></i><span class="cpm-pick-label"></span><span class="cpm-pick-sub"></span>';
        o.querySelector('.cpm-pick-label').textContent = x.label;
        o.querySelector('.cpm-pick-sub').textContent = x.sub ?? '';
        o.title = x.label;
        o.addEventListener('click', () => choose(x));
        o.addEventListener('pointermove', () => setActive(o));
        return o;
    });
    list.append(...opts);
    pop.append(list);
    wrap.append(btn, pop);

    let active = null;
    const setActive = o => { active?.classList.remove('cpm-active'); active = o; o?.classList.add('cpm-active'); };
    const shown = () => opts.filter(o => !o.hidden);
    const move = (d, reset) => {
        const s = shown();
        if (!s.length) return setActive(null);
        let i = reset ? 0 : s.indexOf(active) + d;
        i = Math.max(0, Math.min(s.length - 1, i));
        setActive(s[i]);
        s[i].scrollIntoView({ block: 'nearest' });
    };
    const outside = ev => { if (!wrap.contains(ev.target)) close(); };
    function open() {
        if (!pop.hidden) return;
        openPick?.();
        openPick = close;
        pop.hidden = false;
        wrap.classList.add('cpm-open');
        btn.setAttribute('aria-expanded', 'true');
        // 창(스크롤 칸) 안에서 아래 자리가 모자라면 위로 펼침
        const pane = wrap.closest('.popup-content') || document.documentElement;
        const r = btn.getBoundingClientRect(), pr = pane.getBoundingClientRect();
        const below = pr.bottom - r.bottom - 12, above = r.top - pr.top - 12;
        const up = below < 200 && above > below;
        wrap.classList.toggle('cpm-up', up);
        list.style.maxHeight = `${Math.max(120, Math.min(300, (up ? above : below) - (pop.querySelector('.cpm-pick-search') ? 52 : 12)))}px`;
        const sel = opts.find(o => o.getAttribute('aria-selected') === 'true');
        setActive(sel || shown()[0]);
        sel?.scrollIntoView({ block: 'nearest' });
        (pop.querySelector('.cpm-pick-search') || list).focus({ preventScroll: true });
        document.addEventListener('pointerdown', outside, true);
    }
    function close(focus) {
        if (pop.hidden) return;
        if (openPick === close) openPick = null;
        pop.hidden = true;
        wrap.classList.remove('cpm-open', 'cpm-up');
        btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', outside, true);
        if (focus) btn.focus();
    }
    function choose(x) {
        close(true);
        if (x.v !== value) onPick(x.v);
    }
    list.tabIndex = -1;
    btn.addEventListener('click', () => (pop.hidden ? open() : close()));
    btn.addEventListener('keydown', ev => { if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); open(); } });
    pop.addEventListener('keydown', ev => {
        // Esc 는 목록만 닫음 (ⓘ 창 자체가 취소되지 않게)
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(true); }
        else if (ev.key === 'ArrowDown') { ev.preventDefault(); move(1); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(-1); }
        else if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); const i = opts.indexOf(active); if (i >= 0) choose(items[i]); }
        else if (ev.key === 'Tab') close();
    });
    return wrap;
}
