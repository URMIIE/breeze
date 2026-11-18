// 월드인포 창 다시 짜기: 실리태번 월드인포 창 안에서 폴더 · 월드인포 고르기와 항목 편집을 한 번에.
// 월드인포가 많으면 고르기 칸 하나로는 무엇을 갖고 있는지 알기 어렵고, 항목이 많으면 편집 목록이 길다(휴대폰은 항목 하나가 화면의 1/4).
// ① 왼쪽 칸(휴대폰은 위쪽 접는 칸): 내가 만든 폴더 → 그 안의 월드인포. 누르면 실리태번 고르기 칸을 그 월드인포로 바꿔 편집 목록이 그대로 바뀜.
// ② 편집 목록: 실리태번 항목 칸을 그대로 쓰되 접힌 항목은 한 줄(스위치 · 제목 · 상태 · 토큰 · 표시), 펼치면 실리태번 편집 칸 전부.
//    위에 거르기(전체 · 켜짐 · 꺼짐 · 방금 발동 · 문제)와 내 묶음(묶음째 켜고 끄기), 여러 개 골라 켜기 · 끄기 · 묶음으로 · 다른 월드인포로 · 지우기.
// 실리태번 목록은 끌어서 순서를 바꾸는 목록이라 칸을 옮기지 않고 보이는 순서(CSS order)만 묶음대로 바꿈 → 저장 순서는 그대로.
// 묶음 · 거르기가 쪽을 넘어 보이도록 이 기능이 켜진 동안 한 쪽에 항목을 전부(쪽 크기를 1000으로, 끄면 원래 값). 항목이 많아도 '보이는 월드인포 항목만 그리기'가 화면 밖은 안 그림.
// 폴더 · 묶음은 breeze 설정에만 적고 월드인포 파일은 바꾸지 않음. 항목을 바꾸는 일은 실리태번 함수(loadWorldInfo · saveWorldInfo · moveWorldInfoEntry ·
// deleteWorldInfoEntry)로 해서 다른 정리 도구와 같은 파일을 봄. 연결 바꾸기 · 중복 · 백업 같은 정리는 다른 도구에 맡기고 넣지 않음.
import { world_names, selected_world_info, world_info, loadWorldInfo, saveWorldInfo, reloadEditor, moveWorldInfoEntry, deleteWorldInfoEntry, METADATA_KEY } from '../../../../world-info.js';
import { accountStorage } from '../../../../util/AccountStorage.js';
import { chat_metadata } from '../../../../../script.js';
import { power_user } from '../../../../power-user.js';

const PER_PAGE_KEY = 'WI_PerPage', PREV_KEY = 'breeze_WI_PerPage_before';
let api = null, offs = [], listObserver = null, split = null, side = null, bar = null, decorating = false, decoTimer = 0;
// 좁은 창의 '월드인포 고르기' 칸을 펼친 채 닫아도 다시 열면(새로고침 포함) 늘 접혀 있었음 → 이 기기에 펼침 상태를 적어 둠
const SIDE_KEY = 'breeze.wiSideOpen';
const savedSide = () => { try { return localStorage.getItem(SIDE_KEY) === '1'; } catch { return false; } };
let ui = { query: '', chip: 'all', selecting: false, picked: new Set(), pickBooks: false, pickedBooks: new Set(), sideOpen: savedSide() };
const fired = new Set();          // 방금 답에 들어간 항목: '월드인포|uid'
const tokenCache = new Map();
let summary = {};
const ctx = () => api.ctx();
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nfc = (s) => String(s ?? '').normalize('NFC');
const opts = () => { const o = api.options(); o.folders ??= []; o.groups ??= {}; o.autoCollapsed ??= {}; return o; };   // autoCollapsed: 연결별 폴더를 직접 접고 편 기록(누른 것만 적힘), 기록 없는 폴더는 펼침
const newId = () => Math.random().toString(36).slice(2, 10);
const fmt = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}만` : n >= 1000 ? n.toLocaleString() : String(n));
const narrow = () => document.getElementById('WorldInfo')?.classList.contains('etk-wip-narrow');
const list = () => document.getElementById('world_popup_entries_list');
const editorSelect = () => document.getElementById('world_editor_select');
const currentBook = () => { const v = editorSelect()?.value; const i = Number(v); return v !== '' && Number.isInteger(i) && i >= 0 ? world_names[i] : null; };

async function loadSummary() {
    try { const res = await fetch('/api/plugins/breeze-server/worldinfo-summary', { headers: ctx().getRequestHeaders() }); summary = res.ok ? await res.json() : {}; } catch { summary = {}; }
}
// 항목 줄 표시 뜻: 처음 한 번만 목록 위에 작게(× 로 닫으면 다시 안 뜸). 동그라미는 실리태번 상태 고르기 칸 그대로(🔵 상시 · 🟢 키워드 · 🔗 벡터)
const LEGEND_KEY = 'breeze.wiLegendSeen';
const legendSeen = () => { try { return localStorage.getItem(LEGEND_KEY) === '1'; } catch { return false; } };
const LEGEND = '<div class="etk-wip-legend"><span>🔵 늘 들어감</span><span>🟢 키워드가 나오면 들어감</span><span>🔗 비슷한 내용이면 들어감</span><span>오른쪽 숫자는 토큰 수</span><i class="fa-solid fa-xmark etk-wip-legend-x interactable" tabindex="0" title="닫기"></i></div>';
// 월드인포 목록 줄의 토큰 수: 켜진 항목 내용을 이어 붙여 한 번에 셈(항목마다 세면 요청이 수백 번). 파일 시각이 같으면 이 기기에 적어 둔 값
const BOOK_TOK_KEY = 'breeze.wiBookTokens';
let bookTok = null, tokQueue = [], tokBusy = false;
const loadBookTok = () => { if (!bookTok) { try { bookTok = JSON.parse(localStorage.getItem(BOOK_TOK_KEY) || '{}'); } catch { bookTok = {}; } } return bookTok; };
const bookTokOf = (n) => { const t = loadBookTok()[n], s = summary[n]; return t && s && t.m === s.mtime ? t.n : null; };
function queueBookTokens(names) {
    for (const n of names) if (summary[n] && bookTokOf(n) == null && !tokQueue.includes(n)) tokQueue.push(n);
    if (tokBusy) return;
    tokBusy = true;
    (async () => {
        let changed = false;
        while (tokQueue.length) {
            const n = tokQueue.shift();
            try {
                const data = await loadWorldInfo(n);
                const text = Object.values(data?.entries || {}).filter(e => !e?.disable).map(e => String(e?.content || '')).join('\n');
                const all = loadBookTok(); all[n] = { m: summary[n]?.mtime, n: await tokensOf(text) }; changed = true;
                const el = side?.querySelector(`.etk-wip-book[data-book="${CSS.escape(n)}"] .etk-wip-tokn`);
                if (el) el.textContent = ` · ${kTok(all[n].n)} 토큰`;
            } catch { /* 이 월드인포는 건너뜀 */ }
        }
        if (changed) { try { localStorage.setItem(BOOK_TOK_KEY, JSON.stringify(loadBookTok())); } catch { /* 이번만 */ } }
        tokBusy = false;
    })();
}
const kTok = (n) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
async function tokensOf(text) {
    const t = String(text || '');
    if (!t) return 0;
    if (tokenCache.has(t)) return tokenCache.get(t);
    let n = 0; try { n = await ctx().getTokenCountAsync(t); } catch { n = Math.ceil(t.length / 2); }
    if (tokenCache.size > 3000) tokenCache.clear();
    tokenCache.set(t, n);
    return n;
}

// ── ① 왼쪽 칸: 폴더 → 월드인포
function pickBook(name) {
    const i = world_names.indexOf(name);
    if (i < 0) return;
    ui.query = ''; ui.chip = 'all'; ui.selecting = false; ui.picked.clear();
    // 고른 월드인포를 다시 누르면 고르기 전(아무것도 안 고른 창)으로
    const unpick = name === currentBook();
    $('#world_editor_select').val(unpick ? '' : i).trigger('change');
    // 고르기를 풀면 고르기 목록은 열어 둠(닫으면 다시 고를 때 ▾ 를 또 눌러야 해서 막힌 것처럼 보였음)
    if (narrow()) ui.sideOpen = unpick;
    renderSide();
}

// 캐릭터에 걸린 월드인포(카드에 붙은 것 + 추가로 고른 것)
const charBooks = (ch, extra) => [ch?.data?.extensions?.world, ...(extra.get(String(ch?.avatar || '').replace(/\.[^.]+$/, '')) || [])].filter(Boolean);
// 월드인포 → 걸린 캐릭터들(목록 줄 사진용)
function charsByBook() {
    const extra = new Map((world_info?.charLore || []).map(x => [x.name, x.extraBooks || []])), out = new Map();
    for (const ch of ctx().characters || []) for (const n of charBooks(ch, extra)) { if (!out.has(n)) out.set(n, []); if (!out.get(n).some(x => x.avatar === ch.avatar)) out.get(n).push(ch); }
    return out;
}
// 처음엔 폴더를 일일이 만들 필요 없게: 월드인포가 어디에 걸려 있는지로 저절로 나눔(여러 곳에 걸려 있으면 먼저 나오는 묶음 한 곳에만)
// 내 폴더가 하나라도 있으면 그쪽을 먼저 보여 줌(사용자가 고른 보기는 저장)
const viewOf = (o) => o.view || (o.folders.length ? 'mine' : 'auto');
function autoSections(names) {
    const has = new Set(names), used = new Set(), out = [];
    const add = (key, name, books, closed, sub) => {
        // 한 월드인포는 한 곳에만(쓰는 캐릭터가 여럿이면 이번 주 · 이번 달처럼 여러 묶음에 똑같이 떠서 헷갈렸음) → 먼저 나오는 묶음(쓰는 중 → 태그 → 최근 대화 순)에만
        const b = [...new Set(books)].filter(n => has.has(n) && !used.has(n));
        b.forEach(n => used.add(n));
        if (b.length) out.push({ key, name, books: b, closed, sub });
    };
    const c = ctx(), chars = c.characters || [], curChar = chars[c.characterId];
    const extra = new Map((world_info?.charLore || []).map(x => [x.name, x.extraBooks || []]));
    const booksOf = (ch) => charBooks(ch, extra);
    // ① 지금 채팅에 들어가는 것: 모든 채팅에 켠 것 · 이 캐릭터 · 이 채팅 · 지금 페르소나
    add('now', '지금 채팅에 쓰는 중', [...(selected_world_info || []), ...booksOf(curChar), chat_metadata?.[METADATA_KEY], power_user?.persona_description_lorebook].filter(Boolean), false);
    // ② 캐릭터에 붙인 태그(실리태번 캐릭터 목록의 태그)별. 태그가 없는 캐릭터는 마지막 대화 시기별(이번 주 · 이번 달 · 그 전)
    //    (캐릭터 연결만으로 한 폴더에 모으면 거의 다 연결돼 있어 나눈 게 아니었고, 캐릭터마다 폴더를 두면 하나짜리 폴더가 줄줄이 생겼음)
    const DAY = 86400000, now = Date.now();
    const when = (ch) => { const t = Number(ch.date_last_chat) || 0, d = now - t; return t && d <= 7 * DAY ? ['recent:week', '이번 주에 대화', 1] : t && d <= 30 * DAY ? ['recent:month', '이번 달에 대화', 2] : ['recent:old', '그 전에 대화', 3]; };
    const tagName = new Map((c.tags || []).map(t => [t.id, t.name]));
    const groups = new Map(), who = new Map();
    for (const ch of chars) {
        const books = booksOf(ch);
        if (!books.length) continue;
        for (const n of books) { if (!who.has(n)) who.set(n, []); if (!who.get(n).includes(ch.name)) who.get(n).push(ch.name); }
        const tagged = (c.tagMap?.[ch.avatar] || []).map(id => tagName.get(id)).filter(Boolean);
        for (const [key, name, kind] of tagged.length ? tagged.map(t => [`tag:${t}`, t, 0]) : [when(ch)]) {
            if (!groups.has(key)) groups.set(key, { name, kind, books: [] });
            groups.get(key).books.push(...books);
        }
    }
    [...groups].sort(([, a], [, b]) => a.kind - b.kind || String(a.name).localeCompare(String(b.name)))
        .forEach(([key, g]) => add(key, g.name, g.books, g.kind !== 1, who));   // 이번 주 것만 펼쳐 둠
    const pd = power_user?.persona_descriptions || {};
    add('persona', '페르소나', Object.values(pd).map(d => d?.lorebook).filter(Boolean), true);
    add('none', '어디에도 안 걸림', names.filter(n => !used.has(n)), true);
    return out;
}

// 폴더 이름 칸: Enter · 칸 밖을 누르면 저장, Esc 는 그대로 두기(빈 이름이면 '새 폴더')
function focusFolderName() {
    const inp = side?.querySelector('.etk-wip-fname');
    if (!inp) return;
    inp.focus(); inp.select();
    let done = false;
    const finish = (save) => {
        if (done) return; done = true;
        const f = opts().folders.find(x => x.id === ui.editFolder);
        if (f && save) f.name = inp.value.trim() || f.name || '새 폴더';
        ui.editFolder = null; api.save(); inp.blur(); renderSide();   // 칸에서 초점을 빼야 다시 그림(치는 중엔 안 그리게 막아 둠)
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); e.stopPropagation(); });
    inp.addEventListener('blur', () => finish(true));
    // 치는 대로 이름에 넣어 둠(칸 밖을 눌러 끝낼 때 초점 빠짐 신호가 안 오는 경우에도 친 이름이 남게)
    let saveT = 0;
    inp.addEventListener('input', () => { const f = opts().folders.find(x => x.id === ui.editFolder); if (f && inp.value.trim()) { f.name = inp.value.trim(); clearTimeout(saveT); saveT = setTimeout(() => api.save(), 400); } });
}

// 월드인포를 끌어서 폴더에 넣기(내 폴더 보기에서): 마우스는 조금 움직이면, 손가락은 0.35초 눌렀다가 끌면 시작(그냥 밀면 목록이 스크롤)
// 놓은 자리의 폴더(또는 '폴더 없음')로 옮김. 끈 뒤 바로 오는 누르기는 무시(그 월드인포가 열리지 않게)
let dragBook = null;
function onBookPointerDown(e) {
    const row = e.target.closest?.('.etk-wip-book');
    if (!row || viewOf(opts()) !== 'mine' || ui.pickBooks || e.button > 0) return;
    const sx = e.clientX, sy = e.clientY, touch = e.pointerType !== 'mouse';
    let started = false, timer = 0, ghost = null, over = null;
    const begin = () => {
        started = true;
        ghost = document.createElement('div'); ghost.className = 'etk-wip-ghost'; ghost.textContent = row.dataset.book;
        document.body.append(ghost);
        row.classList.add('etk-dragging');
        try { row.setPointerCapture(e.pointerId); } catch { /* 이미 뗌 */ }
    };
    // 놓을 자리: 다른 월드인포 줄 위면 그 줄 앞 · 뒤(폴더 안 보는 순서), 폴더 제목 · 빈 곳이면 그 폴더 맨 끝
    let at = null, after = false;
    const mark = (x, y) => {
        ghost.style.transform = `translate(${x + 12}px, ${y + 8}px)`;
        const hitEl = document.elementFromPoint(x, y);
        const f = hitEl?.closest?.('.etk-wip-side .etk-wip-folder');
        const b = hitEl?.closest?.('.etk-wip-side .etk-wip-book');
        const nb = b && b !== row ? b : null, na = nb ? y > nb.getBoundingClientRect().top + nb.getBoundingClientRect().height / 2 : false;
        if (nb !== at || na !== after) { at?.classList.remove('etk-drop-before', 'etk-drop-after'); at = nb; after = na; at?.classList.add(after ? 'etk-drop-after' : 'etk-drop-before'); }
        if (f !== over) { over?.classList.remove('etk-drop'); over = f; over?.classList.add('etk-drop'); }
    };
    const move = (ev) => {
        if (!started) {
            const d = Math.hypot(ev.clientX - sx, ev.clientY - sy);
            if (touch) { if (d > 8) cleanup(); return; }
            if (d < 6) return;
            begin();
        }
        ev.preventDefault();
        mark(ev.clientX, ev.clientY);
    };
    const up = () => {
        if (started) {
            const o = opts(), n = row.dataset.book, to = over?.dataset.folder;
            if (over && !over.dataset.auto) {
                for (const f of o.folders) f.books = f.books.filter(x => x !== n);
                // 그 폴더에서 보이는 순서대로 다시 적고 놓은 자리에 끼움('폴더 없음'도 순서를 따로 기억)
                const shownOrder = [...over.querySelectorAll('.etk-wip-book')].map(x => x.dataset.book).filter(x => x !== n);
                let i = at && over.contains(at) ? shownOrder.indexOf(at.dataset.book) + (after ? 1 : 0) : shownOrder.length;
                if (i < 0) i = shownOrder.length;
                shownOrder.splice(i, 0, n);
                if (to) { const f = o.folders.find(x => x.id === to); f.books = shownOrder.filter(x => x === n || f.books.includes(x)); f.collapsed = false; }
                else { o.looseOrder = shownOrder; }
                api.save();
            }
            dragBook = { until: Date.now() + 400 };
        }
        cleanup();
        if (started) renderSide();
    };
    const cleanup = () => {
        clearTimeout(timer);
        document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true);
        document.removeEventListener('touchmove', noScroll, true); window.removeEventListener('blur', up);
        ghost?.remove(); over?.classList.remove('etk-drop'); at?.classList.remove('etk-drop-before', 'etk-drop-after'); row.classList.remove('etk-dragging');
    };
    // 손가락: 길게 눌러 끌기가 시작되면 화면 스크롤을 막아야 브라우저가 끌기를 가로채지 않음
    const noScroll = (te) => { if (started) te.preventDefault(); };
    // 신호는 문서에서 받음: 끄는 중에 왼쪽 목록이 다시 그려지면(설정 저장 신호 등) 잡은 줄이 사라져 놓기를 못 받고 끄는 모양이 남았음
    if (touch) { timer = setTimeout(() => { begin(); mark(sx, sy); navigator.vibrate?.(10); }, 350); document.addEventListener('touchmove', noScroll, { passive: false, capture: true }); }
    document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true); window.addEventListener('blur', up);
}

function renderSide() {
    if (!side) return;
    if (side.querySelector('.etk-wip-fname') === document.activeElement) return;   // 폴더 이름을 치는 중엔 다시 그리지 않음(다른 신호로 다시 그리면 친 글이 사라졌음)
    const o = opts(), names = [...world_names], cur = currentBook();
    for (const f of o.folders) f.books = f.books.filter(n => names.includes(n));
    const inFolder = new Set(o.folders.flatMap(f => f.books));
    if (!side.querySelector('.etk-wip-sidehead')) {
        // 휴대폰 맨 위 한 줄: 월드인포 고르기 · 더 보기(새 항목 + 는 ⋯ 안 실리태번 줄에)(실리태번 버튼 줄은 ⋯ 안으로)
        side.innerHTML = `<div class="etk-wip-top"><div class="etk-wip-now" tabindex="0"><i class="fa-solid fa-folder-open"></i><span></span><i class="fa-solid fa-chevron-down"></i></div><div class="menu_button etk-wip-more fa-solid fa-ellipsis" title="더 보기"></div></div>
            <div class="etk-wip-sidebody"><div class="etk-wip-sidehead"><input type="search" class="text_pole etk-wip-find" placeholder="월드인포 찾기"></div><div class="etk-wip-viewrow"><div class="etk-wip-views"><span class="etk-wip-view" data-view="auto" tabindex="0">연결별</span><span class="etk-wip-view" data-view="mine" tabindex="0">내 폴더</span></div><div class="menu_button etk-wip-newfolder fa-solid fa-folder-plus" tabindex="0" title="새 폴더"></div></div><div class="etk-wip-tree"></div></div>`;
    }
    const q = nfc(side.querySelector('.etk-wip-find')?.value || '').toLowerCase();
    const show = (n) => !q || nfc(n).toLowerCase().includes(q);
    const globalSet = new Set(selected_world_info || []), chatBook = chat_metadata?.[METADATA_KEY];
    const personaBooks = new Set(Object.values(power_user?.persona_descriptions || {}).map(d => d?.lorebook).filter(Boolean));
    const byBook = charsByBook(), c = ctx(), shownBooks = [];
    const thumb = (ch) => { try { return c.getThumbnailUrl('avatar', ch.avatar); } catch { return `/thumbnail?type=avatar&file=${encodeURIComponent(ch.avatar)}`; } };
    // 줄: 위는 이름(잘리지 않게 줄바꿈), 아래는 걸린 캐릭터 사진(셋 + n, 캐릭터가 없으면 어디에 켜 뒀는지) · 켜진 항목 / 전체 · 켜진 항목 토큰
    const bookRow = (n) => {
        const s = summary[n], on = n === cur, picked = ui.pickedBooks.has(n), chars = byBook.get(n) || [];
        shownBooks.push(n);
        const where = chars.length
            ? `<span class="etk-wip-avs" title="${esc(chars.map(x => x.name).join(', '))}">${chars.slice(0, 3).map(ch => `<img src="${esc(thumb(ch))}" alt="" loading="lazy">`).join('')}${chars.length > 3 ? `<b>+${chars.length - 3}</b>` : ''}</span>`
            : globalSet.has(n) ? '<span class="etk-wip-where">모든 채팅</span>' : chatBook === n ? '<span class="etk-wip-where">이 채팅</span>' : personaBooks.has(n) ? '<span class="etk-wip-where">페르소나</span>' : '';
        const tok = bookTokOf(n);
        const meta = s ? `<span class="etk-wip-bmeta">켜짐 ${s.enabled} / ${s.entries}<span class="etk-wip-tokn">${tok != null ? ` · ${kTok(tok)} 토큰` : ''}</span></span>` : '';
        return `<div class="etk-wip-book${on ? ' etk-on' : ''}${picked ? ' etk-picked' : ''}" data-book="${esc(n)}" tabindex="0">${ui.pickBooks ? `<input type="checkbox" tabindex="-1"${picked ? ' checked' : ''}>` : ''}<span class="etk-wip-bcol"><span class="etk-wip-bname">${esc(n)}</span>${where || meta ? `<span class="etk-wip-bsub">${where}${meta}</span>` : ''}</span></div>`;
    };
    const folder = (f, books, real, auto, sub) => {
        const shown = books.filter(n => show(n) || (sub?.get(n) || []).some(show));
        if (q && !shown.length) return '';
        const open = q || !f.collapsed || books.includes(cur);
        return `<div class="etk-wip-folder" data-folder="${real ? esc(f.id) : ''}"${auto ? ` data-auto="${esc(auto)}"` : ''}><div class="etk-wip-fhead" tabindex="0"><i class="fa-solid fa-chevron-${open ? 'down' : 'right'}"></i>${ui.pickBooks && shown.length ? `<input type="checkbox" class="etk-wip-fall" tabindex="-1" title="이 폴더 전부"${shown.every(n => ui.pickedBooks.has(n)) ? ' checked' : ''}>` : ''}${real && ui.editFolder === f.id ? `<input class="text_pole etk-wip-fname" value="${esc(f.name)}" maxlength="40">` : `<span>${esc(f.name)}</span>`}<small>${books.length}</small>${real && !ui.pickBooks ? '<i class="fa-solid fa-pencil etk-wip-frename" title="폴더 이름 바꾸기"></i><i class="fa-solid fa-trash-can etk-wip-fdel" title="폴더 지우기(월드인포는 그대로)"></i>' : ''}</div>${open ? shown.map(n => bookRow(n, sub)).join('') : ''}</div>`;
    };
    const view = viewOf(o);
    let tree;
    if (view === 'auto') {
        tree = autoSections(names).map(a => folder({ id: a.key, name: a.name, collapsed: o.autoCollapsed[a.key] ?? false }, a.books, false, a.key, a.sub)).join('');
    } else {
        const lr = new Map((o.looseOrder || []).map((n, i) => [n, i]));
        const loose = names.filter(n => !inFolder.has(n)).map((n, i) => [n, i]).sort((x, y) => (lr.get(x[0]) ?? 1e9) - (lr.get(y[0]) ?? 1e9) || x[1] - y[1]).map(x => x[0]);   // '폴더 없음'도 끌어서 정한 순서(새로 생긴 건 뒤)
        tree = o.folders.map(f => folder(f, f.books, true)).join('') + folder({ name: '폴더 없음', collapsed: o.looseCollapsed }, loose, false);
    }
    side.querySelectorAll('.etk-wip-view').forEach(b => b.classList.toggle('etk-on', b.dataset.view === view));
    // 폴더로 옮기기 · 끝내기는 아래 줄에(검색칸 옆에 두니 글자 길이대로 검색칸 폭이 바뀌었음)
    let foot = side.querySelector('.etk-wip-sidefoot');
    if (!foot) { foot = document.createElement('div'); foot.className = 'etk-wip-sidefoot'; side.querySelector('.etk-wip-sidebody').append(foot); }
    foot.innerHTML = ui.pickBooks
        ? `<span class="etk-wip-count">${ui.pickedBooks.size}개 선택</span><span class="etk-wip-gap"></span><div class="menu_button etk-wip-tofolder${ui.pickedBooks.size ? '' : ' disabled'}">옮길 폴더 고르기</div><div class="menu_button etk-wip-pickbooks">끝내기</div>`
        : `${view === 'mine' && o.folders.length ? '<small class="etk-wip-draghint">월드인포를 끌어서 폴더에 넣어요</small>' : ''}`;
    foot.hidden = !foot.innerHTML;   // 새 폴더 버튼은 보기 줄 옆 작은 버튼으로(아래 한 줄을 통째로 차지했음)
    side.querySelector('.etk-wip-now span').textContent = cur || '월드인포 고르기';
    const wi = document.getElementById('WorldInfo');
    wi?.classList.toggle('etk-wip-sheet', ui.sideOpen);
    if (savedSide() !== ui.sideOpen) try { localStorage.setItem(SIDE_KEY, ui.sideOpen ? '1' : '0'); } catch { /* 이번만 */ }
    wi?.classList.toggle('etk-wip-moreon', !!ui.moreOpen);
    const mb = side.querySelector('.etk-wip-more');
    if (mb) { mb.classList.toggle('etk-on', !!ui.moreOpen); mb.classList.toggle('fa-ellipsis', !ui.moreOpen); mb.classList.toggle('fa-xmark', !!ui.moreOpen); mb.title = ui.moreOpen ? '버튼 줄 닫기' : '실리태번 버튼 줄 · 정렬 · 다시 불러오기'; }
    side.classList.toggle('etk-open', ui.sideOpen);
    side.querySelector('.etk-wip-tree').innerHTML = tree;
    if (Object.keys(summary).length) queueBookTokens(shownBooks);   // 펼친 폴더에 보이는 것만 셈
}

// ── ② 편집 목록 꾸미기
function entryTitle(e) { return nfc(e.comment || (e.key || []).join(', ') || '(제목 없음)'); }
// 키워드로 켜지는 항목인데 키워드가 없으면 절대 켜지지 않음(내용이 빈 건 토큰 수로 보임)
function problemsOf(e) {
    return !e.constant && !e.vectorized && !(e.key || []).some(k => String(k).trim()) ? ['키워드 없음'] : [];
}

function scheduleDecorate() { clearTimeout(decoTimer); decoTimer = setTimeout(decorate, 60); }

// 실리태번은 항목 편집 칸을 펼칠 때 만들어서, 꾸미기 때 없으면 펼친 직후에 붙임
function addAdvButton(row) {
    const edit = row?.querySelector('.inline-drawer-content > .world_entry_edit');
    if (!edit || edit.querySelector(':scope > .etk-wip-advbtn')) return;
    const ab = document.createElement('div');
    ab.className = 'etk-wip-advbtn interactable'; ab.tabIndex = 0;
    ab.innerHTML = '<span>고급 설정</span><i class="fa-solid fa-chevron-down"></i>';
    edit.append(ab);
    // 재귀 체크 넷은 실리태번 틀에서 '내용' 줄 안에 있어 고급 설정을 펴면 내용 위에 나타났음 → 고급 설정 버튼 바로 아래로 옮김(칸째 옮겨서 체크 처리는 그대로)
    const recur = edit.querySelector('input[name="excludeRecursion"]')?.closest('label')?.parentElement?.parentElement;
    if (recur && !recur.classList.contains('etk-wip-recur')) { recur.classList.add('etk-wip-recur'); ab.after(recur); }
}
async function decorate() {
    const l = list(), book = currentBook();
    if (!l || !bar) return;
    if (!book) { bar.hidden = true; l.classList.remove('etk-wip-list'); return; }
    bar.hidden = false;
    const data = await loadWorldInfo(book);
    if (!data || currentBook() !== book) return;
    decorating = true;
    try {
        const o = opts(), entries = Object.values(data.entries || {});
        const g = (o.groups[book] ??= { list: [], of: {} });
        for (const uid of Object.keys(g.of)) if (!data.entries[uid]) delete g.of[uid];
        const toks = new Map(await Promise.all(entries.map(async e => [String(e.uid), await tokensOf(e.content)])));
        const probs = new Map(entries.map(e => [String(e.uid), problemsOf(e)]));
        const isFired = (e) => fired.has(`${book}|${e.uid}`);
        const counts = { all: entries.length, on: entries.filter(e => !e.disable).length, off: entries.filter(e => e.disable).length, fired: entries.filter(isFired).length, problem: entries.filter(e => probs.get(String(e.uid)).length).length };
        const pass = { all: () => true, on: e => !e.disable, off: e => e.disable, fired: isFired, problem: e => probs.get(String(e.uid)).length > 0 }[ui.chip] || (() => true);
        const q = nfc(ui.query).toLowerCase();
        const match = (e) => pass(e) && (!q || `${entryTitle(e)} ${(e.key || []).join(' ')}`.toLowerCase().includes(q));
        const filtering = !!q || ui.chip !== 'all';
        // 위 막대: 거르기 · 묶음 추가 · 선택(고르는 중엔 할 일). 찾기는 실리태번 찾기 칸(내용까지 찾음)을 그대로 씀
        const chip = (k, label) => `<span class="etk-wip-chip${ui.chip === k ? ' etk-on' : ''}" data-chip="${k}" tabindex="0">${label} ${counts[k]}</span>`;
        const n = ui.picked.size, dis = n ? '' : ' disabled';
        const typingNow = document.activeElement?.matches?.('.etk-wip-search');
        if (!typingNow) {
            bar.innerHTML = ui.selecting
                ? `<div class="etk-wip-row"><span class="etk-wip-count">${n}개 선택</span><span class="etk-wip-gap"></span><div class="menu_button etk-wip-pick">끝내기</div></div>`
                : `<div class="etk-wip-row"><div class="etk-wip-row etk-wip-chips">${chip('all', '전체')}${chip('on', '켜짐')}${chip('off', '꺼짐')}${chip('fired', '방금 발동')}${chip('problem', '키워드 없음')}</div><span class="etk-wip-gap"></span><div class="menu_button etk-wip-pick">항목 선택</div></div>${legendSeen() ? '' : LEGEND}`;
            // 할 일 버튼은 목록 뒤 칸에 두고 화면 아래에 붙임(목록 위에 있으면 고르다 매번 올려야 했음)
            let foot = l.parentElement.querySelector(':scope > .etk-wip-actfoot');
            if (ui.selecting) { if (!foot) { foot = document.createElement('div'); foot.className = 'etk-wip-actfoot'; l.after(foot); foot.addEventListener('click', onBarClick); } foot.innerHTML = `<div class="etk-wip-row etk-wip-acts"><div class="menu_button etk-wip-act${dis}" data-act="on">켜기</div><div class="menu_button etk-wip-act${dis}" data-act="off">끄기</div><div class="menu_button etk-wip-act${dis}" data-act="group">묶음으로</div><div class="menu_button etk-wip-act${dis}" data-act="move">다른 월드인포로</div><div class="menu_button etk-wip-act etk-wip-danger${dis}" data-act="delete">지우기</div></div>`; }
            else foot?.remove();
        } else bar.querySelector('.etk-wip-chips')?.replaceChildren(...$(`<div>${chip('all', '전체')}${chip('on', '켜짐')}${chip('off', '꺼짐')}${chip('fired', '방금 발동')}${chip('problem', '키워드 없음')}</div>`)[0].children);
        // 묶음 제목 줄(목록 안에 두고 보이는 순서만 정함)
        l.classList.add('etk-wip-list');
        l.querySelectorAll(':scope > .etk-wip-ghead').forEach(x => x.remove());
        const groups = [...g.list.map(x => ({ ...x, real: true })), { id: '', name: g.list.length ? '묶음 없음' : '', collapsed: g.looseCollapsed, real: false }];
        const ids = new Set(g.list.map(x => x.id));
        const groupOf = (uid) => (ids.has(g.of[uid]) ? g.of[uid] : '');
        const byUid = new Map(entries.map(e => [String(e.uid), e]));
        let base = 0;
        const orderOf = new Map();
        for (const grp of groups) {
            const members = entries.filter(e => groupOf(e.uid) === grp.id);
            orderOf.set(grp.id, base);
            if (grp.name) {
                const allOn = members.length && members.every(e => !e.disable);
                const sum = members.filter(e => !e.disable).reduce((a, e) => a + (toks.get(String(e.uid)) || 0), 0);
                const h = document.createElement('div');
                h.className = 'etk-wip-ghead';
                h.dataset.group = grp.id;
                h.style.order = String(base);
                h.hidden = filtering && !members.some(match);
                h.innerHTML = `<i class="fa-solid fa-chevron-${grp.collapsed && !filtering ? 'right' : 'down'} etk-wip-gfold"></i><span>${esc(grp.name)}</span><small>${members.length}개 · ${fmt(sum)} 토큰</small>
                    ${!ui.selecting && members.length ? `<label class="etk-wip-switch" title="묶음째 켜기 · 끄기"><input type="checkbox" class="etk-wip-gtoggle"${allOn ? ' checked' : ''}><span></span></label>` : ''}
                    ${grp.real && !ui.selecting ? '<i class="fa-solid fa-pencil etk-wip-grename" title="묶음 이름 바꾸기"></i><i class="fa-solid fa-trash-can etk-wip-gdel" title="묶음 지우기(항목은 그대로)"></i>' : ''}`;
                l.append(h);
            }
            base += 10000;
        }
        // 항목 칸마다: 표시 · 토큰 · 고르기 칸 · 보이는 순서 · 숨김
        const rows = [...l.querySelectorAll(':scope > .world_entry')];
        rows.forEach((row, i) => {
            const uid = row.getAttribute('uid'), e = byUid.get(uid);
            if (!e) return;
            const gid = groupOf(uid), grp = groups.find(x => x.id === gid);
            row.style.order = String(orderOf.get(gid) + 1 + i);
            row.classList.toggle('etk-wip-hide', !match(e) || (!filtering && !!grp?.collapsed && !!grp.name));
            row.classList.toggle('etk-wip-picked', ui.picked.has(uid));
            const head = row.querySelector('.world_entry_thin_controls');
            if (!head) return;
            let info = head.querySelector('.etk-wip-info');
            if (!info) { info = document.createElement('span'); info.className = 'etk-wip-info'; (head.querySelector('.WIEntryTitleAndStatus') || head).after(info); }
            const badges = [isFired(e) && '<span class="etk-wip-badge etk-fired">발동</span>', ...probs.get(uid).map(p => `<span class="etk-wip-badge">${p}</span>`)].filter(Boolean).join('');
            // 표시는 상태 동그라미 앞(제목 칸 안)에: 뒤에 두면 표시가 있는 줄만 동그라미가 왼쪽으로 밀려 줄마다 어긋났음
            const ts = head.querySelector('.WIEntryTitleAndStatus');
            let bx = ts?.querySelector(':scope > .etk-wip-badges');
            if (ts && !bx) { bx = document.createElement('span'); bx.className = 'etk-wip-badges'; const sel = ts.querySelector(':scope > select'); if (sel) sel.before(bx); else ts.append(bx); }
            if (bx) { if (bx.innerHTML !== badges) bx.innerHTML = badges; } 
            info.innerHTML = `${bx ? '' : badges}<small class="etk-wip-tok">${fmt(toks.get(uid) || 0)}</small>`;
            // 펼친 편집 칸: 자주 안 쓰는 칸은 '고급 설정' 아래로 접음(버튼은 내용 칸 바로 뒤)
            addAdvButton(row);
            let cb = head.querySelector(':scope > .etk-wip-check');
            if (ui.selecting && !cb) { cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'etk-wip-check'; cb.tabIndex = -1; head.prepend(cb); }
            if (!ui.selecting) cb?.remove(); else cb.checked = ui.picked.has(uid);
        });
        l.classList.toggle('etk-wip-selecting', ui.selecting);
        l.classList.toggle('etk-wip-adv', !!opts().advOpen);
    } finally { decorating = false; }
}

// ── 바꾸기: 매번 파일을 새로 읽고 바꾼 뒤 바로 저장, 편집 목록도 다시 그림
async function mutate(book, fn) {
    const data = await loadWorldInfo(book);
    if (!data) return;
    await fn(data);
    await saveWorldInfo(book, data, true);
    reloadEditor(book);
}
const NEW = '__etk_new__';   // 고르기 칸 값(HTML 속성이라 보이지 않는 글자는 바뀌어 버림)
async function choose(title, items, initial) {
    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = ctx();
    const sel = document.createElement('select');
    sel.className = 'text_pole';
    sel.innerHTML = items.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    const box = document.createElement('div');
    box.innerHTML = `<h3>${esc(title)}</h3>`;
    box.append(sel);
    if (initial !== undefined) sel.value = initial;
    const ok = await callGenericPopup(box, POPUP_TYPE.CONFIRM, '', { okButton: '확인', cancelButton: '취소' });
    return ok === POPUP_RESULT.AFFIRMATIVE ? sel.value : null;
}
const ask = async (title, value = '') => { const v = await ctx().Popup.show.input(title, '', value); return typeof v === 'string' && v.trim() ? v.trim() : null; };

async function act(kind) {
    const book = currentBook(), uids = [...ui.picked];
    const o = opts(), { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = ctx();
    if (!book || !uids.length) return;
    if (kind === 'on' || kind === 'off') {
        await mutate(book, (d) => { for (const u of uids) if (d.entries[u]) d.entries[u].disable = kind === 'off'; });
    } else if (kind === 'group') {
        const g = (o.groups[book] ??= { list: [], of: {} });
        let to = await choose('어느 묶음으로 옮길까요?', [...g.list.map(x => [x.id, x.name]), ['', '묶음 없음'], [NEW, '+ 새 묶음 만들기']], g.list.length ? undefined : NEW);
        if (to === null) return;
        if (to === NEW) { const n = await ask('새 묶음 이름'); if (!n) return; to = newId(); g.list.push({ id: to, name: n, collapsed: false }); }
        for (const u of uids) { if (to) g.of[u] = to; else delete g.of[u]; }
        api.save();
    } else if (kind === 'move') {
        const to = await choose('어느 월드인포로 옮길까요?', world_names.filter(n => n !== book).map(n => [n, n]));
        if (!to) return;
        for (const u of uids) await moveWorldInfoEntry(book, to, Number(u));
        const g = o.groups[book]; if (g) for (const u of uids) delete g.of[u];
        api.save();
        toastr.info(`${uids.length}개를 '${to}'(으)로 옮겼어요.`);
    } else if (kind === 'delete') {
        const ok = await callGenericPopup(`<h3>항목 ${uids.length}개를 지울까요?</h3><small>지우면 되돌릴 수 없어요.</small>`, POPUP_TYPE.CONFIRM, '', { okButton: '지우기', cancelButton: '취소' });
        if (ok !== POPUP_RESULT.AFFIRMATIVE) return;
        await mutate(book, async (d) => { for (const u of uids) await deleteWorldInfoEntry(d, Number(u), { silent: true }); });
    }
    ui.selecting = false; ui.picked.clear();
    await loadSummary(); renderSide();
    scheduleDecorate();
}

// 그 항목 열기(답 옆 표시에서): 월드인포 창을 열고 그 월드인포를 고른 뒤, 거르기 · 접은 묶음을 풀고 그 항목을 펼침
export async function openInEditor(book, uid) {
    if (!$('#WorldInfo').is(':visible')) $('#WIDrawerIcon').trigger('click');
    if (currentBook() !== book) { const i = world_names.indexOf(book); if (i < 0) return; $('#world_editor_select').val(i).trigger('change'); }
    ui.query = ''; ui.chip = 'all';
    const g = api && opts().groups[book];
    if (g && uid != null) { const grp = g.list.find(x => x.id === g.of[uid]); if (grp) grp.collapsed = false; else g.looseCollapsed = false; }
    if (uid == null) return;
    const sel = `#world_popup_entries_list .world_entry[uid="${uid}"]`;
    for (let i = 0; i < 60 && !document.querySelector(sel); i++) await new Promise(r => setTimeout(r, 100));
    if (api && bar) await decorate();
    const el = document.querySelector(sel);
    if (!el) return;
    if (el.querySelector('.inline-drawer-icon.down')) el.querySelector('.inline-drawer-toggle')?.click();
    el.scrollIntoView({ block: 'start' });
}

// ── 누르기
async function onSideClick(e) {
    const t = e.target, o = opts(), hit = (s) => t.closest(s);
    if (hit('.etk-wip-more')) { ui.moreOpen = !ui.moreOpen; return renderSide(); }
    if (hit('.etk-wip-now')) { ui.sideOpen = !ui.sideOpen; return renderSide(); }
    if (hit('.etk-wip-view')) { o.view = hit('.etk-wip-view').dataset.view; api.save(); return renderSide(); }
    // 새 폴더: 창을 띄우지 않고 '새 폴더'를 만들어 바로 이름 칸을 엶(내 폴더 보기로)
    if (hit('.etk-wip-newfolder')) { const id = newId(); o.folders.push({ id, name: '새 폴더', books: [], collapsed: false }); o.view = 'mine'; ui.editFolder = id; api.save(); renderSide(); focusFolderName(); return; }
    if (hit('.etk-wip-pickbooks')) { ui.pickBooks = !ui.pickBooks; ui.pickedBooks.clear(); return renderSide(); }
    if (hit('.etk-wip-tofolder')) {
        if (hit('.disabled')) return;
        // 폴더는 옮길 때만 필요해서 따로 '폴더 추가' 버튼을 두지 않고 여기서 만듦(버튼이 둘이면 오른쪽 묶음 버튼과 헷갈렸음)
        let to = await choose('어느 폴더로 옮길까요?', [...o.folders.map(f => [f.id, f.name]), ['', '폴더 없음'], [NEW, '+ 새 폴더 만들기']], o.folders.length ? undefined : NEW);
        if (to === null) return;
        if (to === NEW) { const n = await ask('새 폴더 이름'); if (!n) return; to = newId(); o.folders.push({ id: to, name: n, books: [], collapsed: false }); }
        for (const f of o.folders) f.books = f.books.filter(n => !ui.pickedBooks.has(n));
        if (to) o.folders.find(f => f.id === to).books.push(...ui.pickedBooks);
        ui.pickBooks = false; ui.pickedBooks.clear(); o.view = 'mine'; api.save();
        return renderSide();
    }
    const folder = hit('.etk-wip-folder');
    if (hit('.etk-wip-fname')) return;   // 이름 고치는 칸 안 누르기는 그대로
    if (hit('.etk-wip-frename')) { ui.editFolder = folder.dataset.folder; renderSide(); focusFolderName(); return; }
    if (hit('.etk-wip-fdel')) { o.folders = o.folders.filter(x => x.id !== folder.dataset.folder); api.save(); return renderSide(); }
    // 고르는 중 폴더 제목의 체크: 그 폴더(찾기로 걸러졌으면 보이는 것만) 월드인포를 한꺼번에(하나씩 누르기 번거로웠음)
    if (hit('.etk-wip-fall')) {
        const books = [...folder.querySelectorAll('.etk-wip-book')].map(x => x.dataset.book);
        const fold = folder.querySelector('.etk-wip-fhead i').classList.contains('fa-chevron-right');
        const names = books.length ? books : null;
        if (names) { const all = names.every(n => ui.pickedBooks.has(n)); names.forEach(n => all ? ui.pickedBooks.delete(n) : ui.pickedBooks.add(n)); }
        else if (fold) { const id = folder.dataset.folder, auto = folder.dataset.auto; if (auto) o.autoCollapsed[auto] = false; else if (id) o.folders.find(x => x.id === id).collapsed = false; else o.looseCollapsed = false; renderSide(); return onSideClick(e); }
        return renderSide();
    }
    if (hit('.etk-wip-fhead')) {
        const id = folder.dataset.folder, auto = folder.dataset.auto;
        // 지금 고른 월드인포가 든 폴더를 누르면 고르기를 풀고 접음(그 폴더는 고른 월드인포 때문에 늘 펼쳐져 있어 접을 수 없었음)
        const cur = currentBook();
        if (cur && folder.querySelector(`.etk-wip-book.etk-on`)) {
            if (auto) o.autoCollapsed[auto] = true; else if (id) o.folders.find(x => x.id === id).collapsed = true; else o.looseCollapsed = true;
            api.save(); ui.query = ''; ui.chip = 'all'; ui.selecting = false; ui.picked.clear();
            $('#world_editor_select').val('').trigger('change');
            ui.sideOpen = true;
            return renderSide();
        }
        if (auto) { const now = folder.querySelector('.etk-wip-fhead i').classList.contains('fa-chevron-down'); o.autoCollapsed[auto] = now; }
        else if (id) { const f = o.folders.find(x => x.id === id); f.collapsed = !f.collapsed; } else o.looseCollapsed = !o.looseCollapsed;
        api.save(); return renderSide();
    }
    const book = hit('.etk-wip-book');
    if (book && dragBook && Date.now() < dragBook.until) { dragBook = null; return; }
    if (book) {
        const n = book.dataset.book;
        if (ui.pickBooks) {
            // Shift 를 누른 채 누르면 앞서 누른 것부터 여기까지 한꺼번에
            const order = [...side.querySelectorAll('.etk-wip-book')].map(x => x.dataset.book);
            if (e.shiftKey && ui.lastPick && order.includes(ui.lastPick)) { const [i, j] = [order.indexOf(ui.lastPick), order.indexOf(n)].sort((x, y) => x - y); const on = !ui.pickedBooks.has(n); order.slice(i, j + 1).forEach(x => on ? ui.pickedBooks.add(x) : ui.pickedBooks.delete(x)); }
            else if (ui.pickedBooks.has(n)) ui.pickedBooks.delete(n); else ui.pickedBooks.add(n);
            ui.lastPick = n;
            return renderSide();
        }
        return pickBook(n);
    }
}
async function onBarClick(e) {
    const t = e.target, o = opts(), hit = (s) => t.closest(s), book = currentBook();
    if (hit('.etk-wip-legend-x')) { try { localStorage.setItem(LEGEND_KEY, '1'); } catch { /* 이번만 */ } hit('.etk-wip-legend')?.remove(); return; }
    if (hit('.etk-wip-pick')) { ui.selecting = !ui.selecting; ui.picked.clear(); document.activeElement?.blur?.(); return decorate(); }
    if (hit('.etk-wip-chip')) { ui.chip = hit('.etk-wip-chip').dataset.chip; document.activeElement?.blur?.(); return decorate(); }
    if (hit('.etk-wip-act')) { if (!hit('.disabled')) await act(hit('.etk-wip-act').dataset.act); return; }
}
async function onListClick(e) {
    const t = e.target, o = opts(), hit = (s) => t.closest(s), book = currentBook();
    if (hit('.inline-drawer-toggle')) { const r = hit('.world_entry'); setTimeout(() => addAdvButton(r), 0); setTimeout(() => addAdvButton(r), 300); }
    if (hit('.etk-wip-advbtn')) { o.advOpen = !o.advOpen; api.save(); list()?.classList.toggle('etk-wip-adv', o.advOpen); return; }
    const head = hit('.etk-wip-ghead');
    if (head) {
        const g = o.groups[book], id = head.dataset.group;
        if (hit('.etk-wip-switch')) return;
        if (hit('.etk-wip-grename')) { const it = g.list.find(x => x.id === id); const n = await ask('묶음 이름', it.name); if (n) { it.name = n; api.save(); decorate(); } return; }
        if (hit('.etk-wip-gdel')) { g.list = g.list.filter(x => x.id !== id); for (const [u, v] of Object.entries(g.of)) if (v === id) delete g.of[u]; api.save(); return decorate(); }
        const it = id ? g.list.find(x => x.id === id) : null;
        if (it) it.collapsed = !it.collapsed; else g.looseCollapsed = !g.looseCollapsed;
        api.save(); return decorate();
    }
    // 고르는 중: 항목 줄을 누르면 고르기(실리태번 펼치기 · 편집으로 가지 않게)
    const row = hit('.world_entry');
    if (ui.selecting && row && !hit('.inline-drawer-content')) {
        e.preventDefault(); e.stopPropagation();
        const uid = row.getAttribute('uid');
        if (ui.picked.has(uid)) ui.picked.delete(uid); else ui.picked.add(uid);
        return decorate();
    }
}
async function onListChange(e) {
    if (!e.target.matches('.etk-wip-gtoggle')) return;
    const book = currentBook(), id = e.target.closest('.etk-wip-ghead').dataset.group, g = opts().groups[book] || { list: [], of: {} };
    const ids = new Set(g.list.map(x => x.id));
    await mutate(book, (d) => { for (const en of Object.values(d.entries)) { const gid = ids.has(g.of[en.uid]) ? g.of[en.uid] : ''; if (gid === id) en.disable = !e.target.checked; } });
}
let typing = 0;
function onBarInput(e) {
    if (!e.target.matches('.etk-wip-search')) return;
    ui.query = e.target.value;
    clearTimeout(typing);
    typing = setTimeout(() => decorate(), 200);
}

// ── 켜고 끄기
export function start(a) {
    api = a;
    const popupEl = document.getElementById('world_popup'), l = list();
    if (!popupEl || !l) return;
    document.getElementById('WorldInfo')?.classList.add('etk-wip');
    // 좁은 창 배치는 화면 폭이 아니라 월드인포 창 폭으로(테마에 따라 PC 에서도 창이 좁음). 크기 감시는 화면 배치를 바꾸지 않음
    const holder = document.getElementById('wi-holder');
    if (holder) {
        const ro = new ResizeObserver(() => { const w = holder.clientWidth; if (!w) return; const wi = document.getElementById('WorldInfo'); const was = wi.classList.contains('etk-wip-narrow'); const now = was ? w <= 790 : w <= 760; if (now !== was) { wi.classList.toggle('etk-wip-narrow', now); renderSide(); } });
        ro.observe(holder); offs.push(() => ro.disconnect());
    }
    // 왼쪽 칸 + 실리태번 편집 칸을 나란히(편집 칸을 옮겨 담고, 끄면 제자리로)
    split = document.createElement('div');
    split.className = 'etk-wip-split';
    side = document.createElement('div');
    side.className = 'etk-wip-side';
    popupEl.before(split);
    split.append(side, popupEl);
    side.addEventListener('click', onSideClick);
    side.addEventListener('pointerdown', onBookPointerDown);
    side.addEventListener('input', (e) => { if (e.target.matches('.etk-wip-find')) renderSide(); });
    bar = document.createElement('div');
    bar.className = 'etk-wip-bar';
    bar.hidden = true;
    l.before(bar);
    bar.addEventListener('click', onBarClick);
    bar.addEventListener('input', onBarInput);
    l.addEventListener('click', onListClick, true);
    l.addEventListener('change', onListChange);
    // 한 쪽에 항목 전부(끄면 원래 쪽 크기)
    // 원래 쪽 크기는 같은 저장소에 따로 적어 둠(설정 파일 합치기에 휩쓸리지 않게)
    if (accountStorage.getItem(PREV_KEY) === null) accountStorage.setItem(PREV_KEY, accountStorage.getItem(PER_PAGE_KEY) ?? '');
    accountStorage.setItem(PER_PAGE_KEY, '1000');
    // 우리가 넣고 빼는 묶음 제목 줄의 변화는 무시(감시 콜백은 꾸미기가 끝난 뒤에 와서 '꾸미는 중' 표시로는 못 거름 → 다시 꾸미기가 끝없이 돌아 버튼이 계속 새로 그려졌음)
    const ours = (n) => n.nodeType === 1 && n.classList.contains('etk-wip-ghead');
    listObserver = new MutationObserver((records) => {
        if (records.every(r => [...r.addedNodes, ...r.removedNodes].every(ours))) return;
        scheduleDecorate();
    });
    listObserver.observe(l, { childList: true });
    // 다른 도구(월드인포 찾기 스크립트 등)가 고르기 칸을 바꿔도 거르기 · 고르는 중은 처음으로(전 월드인포의 거르기가 남아 항목이 숨어 보였음)
    // 고른 월드인포는 새로고침하면 실리태번이 비워서, 이름을 적어 두고 월드인포 창을 처음 열 때 다시 고름
    // (페이지를 열 때 바로 고르면 창을 안 열어도 그 월드인포 항목을 다 그려서 시작이 느려짐)
    let restored = false;
    $('#world_editor_select').on('change.etkwip', () => {
        ui.chip = 'all'; ui.selecting = false; ui.picked.clear(); renderSide(); scheduleDecorate();
        if (!restored) return;
        const o = opts(), now = currentBook() || '';
        if ((o.lastBook || '') !== now) { if (now) o.lastBook = now; else delete o.lastBook; api.save(); }
    });
    const restore = () => {
        if (restored) return;
        restored = true;
        const name = opts().lastBook, i = name ? world_names.indexOf(name) : -1;
        if (!currentBook() && i >= 0) $('#world_editor_select').val(i).trigger('change');
    };
    // 새 항목(+)은 '묶음 없음'에 들어가므로 그 묶음을 접어 두었으면 펼침(안 그러면 눌러도 안 생긴 것처럼 보였음)
    // (실리태번이 목록을 그릴 때마다 이 버튼의 click 처리를 통째로 갈아 끼워서 jQuery 로 걸면 지워짐 → 문서에 캡처로)
    const onNew = (e) => { if (!e.target.closest?.('#world_popup_new')) return; const b = currentBook(), g = b && opts().groups[b]; if (g?.looseCollapsed) { g.looseCollapsed = false; api.save(); } ui.chip = 'all'; };
    document.addEventListener('click', onNew, true);
    // 캐릭터 연결 · 모든 채팅 목록은 다른 창에서 바뀌어도 알림이 없는 경우가 있음 → 월드인포 창을 열 때 왼쪽 칸만 다시(가벼움)
    const onOpen = (e) => { if (e.target.closest?.('#WIDrawerIcon')) setTimeout(renderSide, 0); };
    // 창이 열리는 것 자체를 봄(테마 옆줄 · 단축키처럼 아이콘을 안 누르고 여는 길도 있어서)
    const wi = document.getElementById('WorldInfo');
    if (wi?.classList.contains('openDrawer')) restore();
    else if (wi) { const openWatch = new MutationObserver(() => { if (wi.classList.contains('openDrawer')) { openWatch.disconnect(); restore(); } }); openWatch.observe(wi, { attributes: true, attributeFilter: ['class'] }); offs.push(() => openWatch.disconnect()); }
    document.addEventListener('click', onOpen, true);
    offs.push(() => document.removeEventListener('click', onOpen, true));
    offs.push(() => document.removeEventListener('click', onNew, true));
    // 월드인포를 새로 만들거나 이름을 바꾸면 고르기 칸 목록이 바뀜 → 왼쪽 칸도
    const optWatch = new MutationObserver(() => renderSide());
    optWatch.observe(editorSelect(), { childList: true });
    offs.push(() => optWatch.disconnect());
    const { eventSource, eventTypes } = ctx();
    // '방금 발동': 마지막 답에 적힌 기록('답에 들어간 월드인포'가 답마다 적음)이 있으면 그걸로 셈. 없으면 실리태번 신호로.
    // 신호만 쓰니 ① 들어간 항목이 0개면 신호가 안 와서 그 전 답 목록이 남았고 ② 다른 확장의 숨은 생성(quiet)도 같은 신호를 보내 마지막 답과 달랐음
    // → 생성이 시작되면 비우고, 숨은 생성의 신호는 무시
    let genType = null;
    const fromLastReply = (clearIfNone) => {
        const chat = ctx().chat || [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const m = chat[i];
            if (!m || m.is_user || m.is_system) continue;
            const list = m.extra?.breeze_wi;
            if (Array.isArray(list)) { fired.clear(); for (const x of list) fired.add(`${x.w}|${x.u}`); return; }
            break;
        }
        if (clearIfNone) fired.clear();
    };
    const refreshFired = (clearIfNone) => { fromLastReply(clearIfNone); if (document.getElementById('WorldInfo')?.classList.contains('openDrawer')) scheduleDecorate(); };
    const onStart = (type, _o, dryRun) => { if (dryRun) return; genType = type; if (type !== 'quiet') fired.clear(); };
    const onFire = (entries) => { if (genType === 'quiet') return; fired.clear(); for (const e of entries || []) fired.add(`${e.world}|${e.uid}`); };
    let worldTimer = 0;
    const onWorld = () => { clearTimeout(worldTimer); worldTimer = setTimeout(async () => { await loadSummary(); renderSide(); scheduleDecorate(); }, 400); };
    // 캐릭터 편집 · 채팅 바꾸기 신호는 자주 옴(캐릭터 칸에 글자를 칠 때마다) → 월드인포 창이 닫혀 있으면 그리지 않고(창을 열 때 다시 그림), 열려 있으면 잠잠해진 뒤 한 번
    let sideTimer = 0;
    const onSettings = () => { clearTimeout(sideTimer); if (!document.getElementById('WorldInfo')?.classList.contains('openDrawer')) return; sideTimer = setTimeout(renderSide, 150); };
    const on = (n, fn) => { eventSource.on(n, fn); offs.push(() => eventSource.removeListener(n, fn)); };
    on(eventTypes.GENERATION_STARTED, onStart);
    on(eventTypes.WORLD_INFO_ACTIVATED, onFire);
    // 답이 붙은 뒤(기록은 같은 신호에서 적히니 한 박자 뒤에) · 스와이프 · 지우기 · 채팅 바꾸기에 마지막 답 기록으로 다시 맞춤
    on(eventTypes.MESSAGE_RECEIVED, () => setTimeout(() => refreshFired(false), 50));
    for (const n of ['MESSAGE_SWIPED', 'MESSAGE_DELETED', 'CHAT_CHANGED']) if (eventTypes[n]) on(eventTypes[n], () => setTimeout(() => refreshFired(true), 50));
    fromLastReply(false);
    on(eventTypes.WORLDINFO_UPDATED, onWorld);
    on(eventTypes.WORLDINFO_SETTINGS_UPDATED, onSettings);
    on(eventTypes.CHAT_CHANGED, onSettings);
    for (const n of ['CHARACTER_EDITED', 'CHARACTER_DELETED', 'CHARACTER_RENAMED', 'PERSONA_CHANGED']) if (eventTypes[n]) on(eventTypes[n], onSettings);
    loadSummary().then(() => { renderSide(); const b = currentBook(); if (b) reloadEditor(b); else scheduleDecorate(); });
    globalThis[Symbol.for('breeze.openWorldEntry')] = openInEditor;
}

export function stop() {
    offs.forEach(f => f()); offs = [];
    listObserver?.disconnect(); listObserver = null;
    $('#world_editor_select').off('change.etkwip');
    const popupEl = document.getElementById('world_popup');
    if (split && popupEl) split.after(popupEl);
    split?.remove(); split = null; side = null;
    bar?.remove(); bar = null;
    const l = list();
    if (l) {
        l.removeEventListener('click', onListClick, true);
        l.removeEventListener('change', onListChange);
        l.classList.remove('etk-wip-list', 'etk-wip-selecting');
        l.querySelectorAll('.etk-wip-ghead, .etk-wip-info, .etk-wip-badges, .etk-wip-check, .etk-wip-advbtn').forEach(x => x.remove());
        l.classList.remove('etk-wip-adv');
        l.parentElement?.querySelector(':scope > .etk-wip-actfoot')?.remove();
        l.querySelectorAll('.world_entry').forEach(x => { x.style.order = ''; x.classList.remove('etk-wip-hide', 'etk-wip-picked'); });
    }
    document.getElementById('WorldInfo')?.classList.remove('etk-wip', 'etk-wip-sheet', 'etk-wip-moreon', 'etk-wip-narrow');
    const prev = accountStorage.getItem(PREV_KEY);
    if (prev !== null) { if (prev === '') accountStorage.removeItem(PER_PAGE_KEY); else accountStorage.setItem(PER_PAGE_KEY, prev); accountStorage.removeItem(PREV_KEY); }
    const b = currentBook(); if (b) reloadEditor(b);
    delete globalThis[Symbol.for('breeze.openWorldEntry')];
}
