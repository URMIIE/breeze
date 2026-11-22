import { start as searchStart, stop as searchStop } from './extension_search.js';   // '확장 관리' 창 검색칸(예전엔 따로 켜는 기능이었음)
// 확장 창을 월드인포 창처럼: 왼쪽에 태그별 확장 목록, 오른쪽에 고른 확장 하나.
// 실리태번 확장 창은 확장마다 접힌 칸을 두 줄로 쭉 늘어놓아서, 확장이 많으면 접어 둬도 길고 찾기 어려웠음.
// 좁은 창(휴대폰)은 다른 화면으로 넘어가지 않음: 맨 위 '지금 보는 확장' 줄을 누르면 그 밑으로 목록이 펼쳐지고, 고르면 접히며 바로 아래에 그 확장.
// 즐겨찾기: 줄의 별을 누르면 맨 위 '즐겨찾기'에 늘 보임.
// 정리: '선택'으로 여러 개 골라 태그 붙이기 · 떼기 · 숨기기를 한꺼번에, 줄을 끌어 순서 바꾸기 · 다른 태그 묶음(또는 '숨김')으로 옮기기.
// 처음 켤 때 확장 이름의 낱말로 태그를 짐작해 붙여 두고, 새로 깐 확장도 같은 방식으로.
// 확장의 설정 칸은 옮기지 않음(확장은 자기 칸이 넣어 둔 자리에 있다고 보고 버튼을 찾거나 내용을 바꿈): 제자리에 두고 고른 것만 보이게, 나머지는 가림.
// 다른 도구가 숨겨 둔 확장은 목록에도 안 넣음. 나중에 끼어드는 확장도 들어옴. 끄면 원래 모양으로.
import { koMatch } from '../lib/ko-match.js';
import * as updates from './extension_panel_updates.js';   // 새 버전 표시 · 업데이트(설정에서 끌 수 있음)
let api = null, side = null, observer = null, resizer = null, timer = 0;
let units = [], opened = new Set(), dragging = null;
// edit: 이름 치는 중인 태그({ id } · 새 태그는 id 없음), confirm: 지울지 묻는 중인 태그 — 창을 띄우지 않고 그 자리에서
const ui = { query: '', picking: false, picked: new Set(), open: false, edit: null, confirm: null, iconFor: null, lastPick: null };

const NONE = '::none', HIDDEN = '::hidden', FAV = '::fav';
const panel = () => document.getElementById('rm_extensions_block');
const block = () => document.querySelector('#rm_extensions_block .extensions_block');
const cols = () => ['extensions_settings', 'extensions_settings2'].map(id => document.getElementById(id)).filter(Boolean);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nfc = (v) => String(v || '').normalize('NFC').toLowerCase();
const headOf = (d) => d.querySelector(':scope > .inline-drawer-toggle, :scope > .inline-drawer-header');
const opts = () => { const o = api.options(); o.tags ??= []; o.of ??= {}; o.order ??= []; o.hidden ??= []; o.collapsed ??= {}; o.seen ??= []; o.favs ??= []; o.icons ??= {}; o.colors ??= {}; o.off ??= []; return o; };
// 태그 앞에 붙일 모양: 테마 글자색을 따르는 한 가지 색 아이콘(Font Awesome, 실리태번에 이미 있음). 이모지는 색이 제각각이라 안 씀
const ICONS = ['circle', 'square', 'diamond', 'heart', 'star', 'bookmark', 'flag', 'folder', 'book', 'brain', 'language', 'volume-high', 'image', 'palette', 'puzzle-piece', 'comment', 'pen', 'wrench', 'music', 'wand-magic-sparkles', 'bolt', 'leaf', 'moon', 'gem'];
const isIcon = (v) => ICONS.includes(v);
// 모양 색: '' 은 테마 글자색. 어느 테마 바탕에서도 보이게 너무 밝거나 어둡지 않은 색만
const COLORS = ['', '#e5534b', '#e8883a', '#d9a520', '#57ab5a', '#2fa3a3', '#4f8fe0', '#9a6dd7', '#d76da8', '#8b8b8b'];
// 설정 창에서 뺄 수 있는 것(o.off): 'shape' 태그 모양과 색 · 'fav' 즐겨찾기 별 · 'hint' 아래 끌기 안내 글 · 'count' 묶음 옆 개수 · 'search' 확장 관리 창 검색칸
// 검색칸은 이 기능의 일부라, 다른 검색칸이 있어 쉬어도 '확장 창 정리' 전체를 쉬는 중으로 표시하지 않게 rest 를 막음(그땐 검색칸만 안 붙음)
const searchApi = (a) => ({ ...a, rest() {} });
// 숨김 = 우리가 숨긴 것 + 다른 도구가 숨긴 것(그쪽에서 다시 보이게 하면 여기서도 나옴)
const hiddenKeys = () => new Set([...opts().hidden, ...units.filter(u => u.outside).map(u => u.key)]);
const shows = (k) => !opts().off.includes(k);
const COLOR_NAMES = { '#e5534b': '빨강', '#e8883a': '주황', '#d9a520': '노랑', '#57ab5a': '초록', '#2fa3a3': '청록', '#4f8fe0': '파랑', '#9a6dd7': '보라', '#d76da8': '분홍', '#8b8b8b': '회색' };
// 테마 색: 값 대신 테마 변수 이름을 저장해 테마를 바꾸면 따라 바뀜
const THEME_COLORS = [['theme:quote', '--SmartThemeQuoteColor', '테마 인용 색'], ['theme:em', '--SmartThemeEmColor', '테마 기울임 색'], ['theme:underline', '--SmartThemeUnderlineColor', '테마 밑줄 색']];
const isColor = (v) => /^#[0-9a-f]{6}$/i.test(v || '') || THEME_COLORS.some(([k]) => k === v);   // 고른 색 · 직접 고른 색 · 테마 색
function colorCss(id) {
    const o = opts(), v = o.colors[id];
    if (isColor(v)) { const t = THEME_COLORS.find(([k]) => k === v); return t ? `var(${t[1]})` : v; }
    return '';
}
const iconOf = (id) => { const o = opts(); return isIcon(o.icons[id]) ? o.icons[id] : ''; };
const PH = ['확장 찾기 (ㅈㄱㅅ, 정규...)', '찾기 (ㅈㄱㅅ, 정규...)', 'ㅈㄱㅅ, 정규...'];   // 긴 것부터, 칸에 들어가는 첫 글
let fitter = null, fitCanvas = null, classWatch = null;
const narrow = () => panel()?.classList.contains('etk-xp-narrow');

// 태그 짐작: 확장 이름의 낱말로만(둘까지). 이름으로 모르면 '태그 없음'에 둠
// (설정 칸 글로도 짐작해 봤더니 '프롬프트' 같은 흔한 낱말 때문에 그림 확장이 프롬프트 묶음에 들어가는 식으로 자주 틀렸음)
const GUESS = [
    ['번역', /번역|한글화|translat|polyglot|언어/i],
    ['기억/요약', /기억|요약|memor|summar|lore|로어|벡터|vector|\brag\b/i],
    ['음성', /\btts\b|음성|voice|speech|낭독/i],
    ['그림', /그림|이미지|image|picture|diffusion|comfy|일러스트/i],
    ['프롬프트/프리셋', /프롬프트|prompt|프리셋|preset|정규식|regex/i],
    ['상태창/화면', /상태창|status|\bhud\b|테마|theme|화면|레이아웃/i],
    ['빠른 답장/스크립트', /빠른 답장|quick ?repl|\bqr\b|스크립트|script|헬퍼|helper/i],
    ['이야기 진행', /전개|진행|direction|plot|story|이야기/i],
];
function guess(u) { return GUESS.filter(([, re]) => re.test(u.title)).map(([t]) => t).slice(0, 2); }

// 칸이 펼쳐져 있는지: 실리태번이 펼칠 때 바꾸는 아이콘(up)으로 봄. 아이콘이 없을 때만 내용 칸의 inline 표시를 봄
// (계산된 스타일을 읽으면 그 자리에서 화면 전체 계산을 치러 누를 때마다 15~30ms 더 걸렸음)
function isOpen(d) {
    const icon = headOf(d)?.querySelector('.inline-drawer-icon');
    if (icon) return icon.classList.contains('up');
    const c = d.querySelector(':scope > .inline-drawer-content');
    return !!c && c.style.display !== 'none' && c.style.display !== '';
}
// 펼치기 · 접기는 실리태번 방식(머리 줄 누르기: 펼칠 때 안을 그리는 확장이 있어서)으로 하되, 미끄러지는 움직임은 끔
// (움직임이 칸 높이를 여러 번 재며 화면 계산을 되풀이해서, 고를 때마다 0.1초 넘게 걸렸음. 어차피 고른 칸 하나만 보여서 움직임은 안 보임)
function openNow(d) {
    const $ = window.jQuery, was = $?.fx?.off;
    if ($?.fx) $.fx.off = true;
    try { headOf(d)?.click(); } finally { if ($?.fx) $.fx.off = was; }
}
// 이름: 머리 줄 글에서 버전 표시(작은 글 · 끝의 숫자)를 뺌
function titleOf(d) {
    const h = headOf(d);
    if (!h) return '';
    const c = h.cloneNode(true);
    c.querySelectorAll('small, .badge, [class*="version" i], [class*="ver-" i], .inline-drawer-icon, style, script').forEach(x => x.remove());
    const t = (c.querySelector('b')?.textContent || c.textContent || '').replace(/\s+/g, ' ').trim();
    return t.replace(/\s*v?\d+\.\d+(\.\d+)*\s*$/i, '').trim() || t;
}

// 버전: 확장이 머리 줄 이름 옆에 적어 둔 것 그대로(1.2.1 · v2.10.0). 이름에서 떼어 낸 작은 글 · 끝의 숫자에서 찾음
function versionOf(d) {
    const h = headOf(d);
    if (!h) return '';
    const marks = [...h.querySelectorAll('small, .badge, [class*="version" i], [class*="ver-" i]')].map(x => x.textContent).join(' ');
    const c = h.cloneNode(true); c.querySelectorAll('style, script').forEach(x => x.remove());
    return (marks.match(/v?\d+\.\d+(\.\d+)*/i) || c.textContent.replace(/\s+/g, ' ').trim().match(/v?\d+\.\d+(\.\d+)*$/i) || [''])[0];
}

// 확장 하나 = 두 칸(#extensions_settings · 2) 바로 아래 덩어리 중 접히는 칸이 든 것. 이름표는 덩어리나 칸에 붙은 id(없으면 이름)
function scan() {
    const found = [];
    for (const col of cols()) for (const holder of col.children) {
        const d = holder.matches('.inline-drawer') ? holder : [...holder.querySelectorAll('.inline-drawer')].find(x => !x.parentElement.closest('.inline-drawer') && headOf(x));
        if (d && headOf(d)) found.push({ holder, drawer: d });
    }
    // 다른 도구(확장 순서를 정하는 확장 등)가 숨겨 둔 칸은 '숨김' 묶음에 넣음(outside): 우리 가림을 잠깐 풀고(표시 하나) 한꺼번에 읽음
    const p = panel();
    p?.classList.add('etk-xp-probe');
    const outside = new Set(found.filter(x => getComputedStyle(x.holder).display === 'none' || getComputedStyle(x.drawer).display === 'none').map(x => x.holder));
    p?.classList.remove('etk-xp-probe');
    units = found.map(x => ({ ...x, title: titleOf(x.drawer), ver: versionOf(x.drawer), key: x.holder.id || x.drawer.id || `name:${titleOf(x.drawer)}`, outside: outside.has(x.holder) })).filter(x => x.title);
    for (const u of units) u.holder.classList.toggle('etk-xp-out', u.outside);
    for (const x of found) x.holder.classList.toggle('etk-xp-unit', units.some(u => u.holder === x.holder));
    // 처음 보는 확장은 태그를 짐작해 붙임(처음 켤 때는 전부, 그 뒤엔 새로 깐 것만)
    const o = opts(), seen = new Set(o.seen);
    let changed = false;
    for (const u of units) {
        if (seen.has(u.key)) continue;
        const tags = o.of[u.key] ? [] : guess(u);
        if (tags.length) { o.of[u.key] = tags; for (const t of tags) if (!o.tags.includes(t)) o.tags.push(t); if (o.guessNote !== false) o.guessNote = true; }
        // 짐작으로 새로 생긴 태그 묶음은 가나다순으로(직접 만든 태그는 만든 자리)
        o.seen.push(u.key); changed = true;
    }
    if (changed) { if (!o.tagsSorted) { o.tags.sort((a, b) => a.localeCompare(b, 'ko')); o.tagsSorted = true; } api.save(); }
}

// 순서: 끌어서 정한 순서대로, 아직 안 정한 확장은 이름 가나다순으로 뒤에(실리태번 순서는 기본 확장이 먼저라 '정규식'이 늘 맨 위였음)
const sortKey = (t) => t.replace(/^[^\p{L}\p{N}]+/u, '');   // 이름 앞 그림 글자(🐘 · 🪄 등)는 빼고 견줌
const byName = (a, b) => sortKey(a.title).localeCompare(sortKey(b.title), 'ko', { sensitivity: 'base' });
function sorted() {
    const at = new Map(opts().order.map((k, i) => [k, i]));
    return [...units].sort((a, b) => (at.get(a.key) ?? 1e6) - (at.get(b.key) ?? 1e6) || byName(a, b));
}
const tagsOf = (k) => opts().of[k] || [];

function select(key, { fromUser = false } = {}) {
    const o = opts(), u = units.find(x => x.key === key);
    if (!u) return;
    if (o.last !== key) { o.last = key; api.save(); }
    for (const x of units) x.holder.classList.toggle('etk-xp-cur', x === u);
    // 고른 확장이 든 칸을 오른쪽 맨 위 자리로(다른 칸은 그 아래 빈 줄로, 안 그러면 빈 칸 높이만큼 아래로 밀렸음)
    for (const c of cols()) c.classList.toggle('etk-xp-curcol', c.contains(u.holder));
    // 접혀 있으면 실리태번 방식으로 펼침(펼칠 때 안을 그리는 확장이 있어서 직접 보이게 하지 않고 머리 줄을 누름)
    if (!isOpen(u.drawer)) { openNow(u.drawer); opened.add(u.drawer); }
    side?.querySelectorAll('.etk-wip-book').forEach(r => r.classList.toggle('etk-on', r.dataset.key === key));
    const now = side?.querySelector('.etk-wip-now span'); if (now) now.textContent = u.title;
    if (fromUser && narrow()) { ui.open = false; render(); u.holder.scrollIntoView({ block: 'nearest' }); }
}

// 찾기 글: 이름 + 이 확장(breeze) 칸은 한글 이름도(영어 이름이라 '브리즈'로 못 찾았음)
const OWN_PANEL = 'etk_settings';
const searchText = (u) => (u.key === OWN_PANEL ? `${u.title} 브리즈` : u.title);
function row(u, sec) {
    const o = opts(), picked = ui.picked.has(u.key);
    return `<div class="etk-wip-book${u.key === o.last ? ' etk-on' : ''}${picked ? ' etk-picked' : ''}" data-key="${esc(u.key)}" data-sec="${esc(sec)}" tabindex="0">${ui.picking ? `<span class="etk-xp-pickbox"><input type="checkbox" tabindex="-1"${picked ? ' checked' : ''}></span>` : ''}<span class="etk-wip-bcol"><span class="etk-wip-bname">${esc(u.title)}${u.ver ? `<small class="etk-xp-ver">${esc(u.ver)}</small>` : ''}</span>${u.outside ? '<small class="etk-xp-outside">다른 확장에서 숨김</small>' : ''}</span>${!ui.picking && shows('update') && updates.outdated(u) ? `<i class="etk-xp-up fa-solid ${updates.isUpdating(u) ? 'fa-spinner fa-spin' : 'fa-circle-arrow-up'} interactable" tabindex="0" title="새 버전 받기 (${esc(updates.extOf(u))})"></i>` : ''}${ui.picking || !shows('fav') ? '' : `<i class="etk-xp-star fa-star ${o.favs.includes(u.key) ? 'fa-solid etk-on' : 'fa-regular'} interactable" tabindex="0" title="${o.favs.includes(u.key) ? '즐겨찾기에서 빼기' : '즐겨찾기(맨 위에 늘 보임)'}"></i>`}</div>`;
}
function section(id, name, list, { real = false } = {}) {
    const o = opts(), q = nfc(ui.query);
    const shown = list.filter(u => !q || koMatch(searchText(u), ui.query));   // 초성(ㅂㄹㅈ) · 띄어쓰기 없이도 찾음(설정 창 찾기와 같은 방식)
    if (q && !shown.length) return '';
    // '태그 없음' · '숨김'은 비어도 둠(끌어다 놓아 태그 떼기 · 숨기기)
    const open = !!q || !(o.collapsed[id] ?? id === HIDDEN);
    return `<div class="etk-wip-folder" data-sec="${esc(id)}"><div class="etk-wip-fhead" tabindex="0"><i class="fa-solid fa-chevron-${open ? 'down' : 'right'}"></i>${ui.picking && shown.length ? `<input type="checkbox" class="etk-wip-fall" tabindex="-1" title="이 묶음 전부"${shown.every(u => ui.picked.has(u.key)) ? ' checked' : ''}>` : ''}${id === FAV ? '<i class="fa-solid fa-star etk-xp-favstar"></i>' : ''}${real && ui.edit?.id === id ? `<input class="text_pole etk-wip-fname etk-xp-tagname" value="${esc(name)}" maxlength="30">` : `<span>${real && shows('shape') && iconOf(id) ? `<i class="fa-solid fa-${iconOf(id)} etk-xp-ticon"${colorCss(id) ? ` style="color:${colorCss(id)};opacity:1"` : ''}></i>` : ''}${esc(name)}${shows('update') && list.some(updates.outdated) ? '<sup class="etk-xp-updot" title="새 버전이 있는 확장이 들어 있어요">UP</sup>' : ''}</span>`}${real && ui.confirm === id
        ? '<small class="etk-xp-ask" title="확장은 그대로 남아요">지울까요?</small><span class="etk-xp-tag etk-xp-delok interactable" tabindex="0">지우기</span><span class="etk-xp-tag etk-xp-delno interactable" tabindex="0">취소</span>'
        : `${shows('count') ? `<small>${list.length}</small>` : ''}${real && !ui.picking && ui.edit?.id !== id ? (shows('shape') ? '<i class="fa-solid fa-shapes etk-xp-ficon" title="앞에 붙일 모양과 색"></i>' : '') + '<i class="fa-solid fa-pencil etk-wip-frename" title="태그 이름 바꾸기"></i><i class="fa-solid fa-trash-can etk-wip-fdel" title="태그 지우기(확장은 그대로)"></i>' : ''}`}</div>${real && ui.iconFor === id && shows('shape') ? `<div class="etk-xp-palette"><div class="etk-xp-colors">${COLORS.map(c => `<span class="etk-xp-color interactable${(isColor(o.colors[id]) ? o.colors[id] : '') === c ? ' etk-on' : ''}" tabindex="0" data-color="${c}" title="${c ? COLOR_NAMES[c] : '글자색 그대로'}"${c ? ` style="--c:${c}"` : ''}></span>`).join('')}${THEME_COLORS.map(([k, v, n]) => `<span class="etk-xp-color etk-xp-themecolor interactable${o.colors[id] === k ? ' etk-on' : ''}" tabindex="0" data-color="${k}" title="${n}" style="--c:var(${v})"></span>`).join('')}${(() => { const own = /^#[0-9a-f]{6}$/i.test(o.colors[id] || '') && !COLORS.includes(o.colors[id]) ? o.colors[id] : ''; return `<label class="etk-xp-color etk-xp-custom${own ? ' etk-on' : ''}" title="색 직접 고르기"${own ? ` style="--c:${own}"` : ''}><input type="color" value="${own || '#888888'}"></label>`; })()}</div><div class="etk-xp-shapes">${['', ...ICONS].map(c => `<span class="etk-xp-pick interactable${(isIcon(o.icons[id]) ? o.icons[id] : '') === c ? ' etk-on' : ''}" tabindex="0" data-icon="${c}">${c ? `<i class="fa-solid fa-${c}"></i>` : '없음'}</span>`).join('')}</div></div>` : ''}${open ? shown.map(u => row(u, id)).join('') : ''}</div>`;
}

// 태그 묶음 순서: 가나다순, 묶음을 끌어 옮긴 적이 있으면(manualTags) 옮겨 둔 순서(o.tags 순서, 새 태그는 맨 뒤)
const tagOrder = () => { const o = opts(); return o.manualTags ? [...o.tags] : [...o.tags].sort((a, b) => a.localeCompare(b, 'ko')); };
// 태그 묶음째 끌어 순서 바꾸기: 묶음 머리 줄을 끌어 다른 태그 묶음 위 · 아래에 놓음(손가락은 길게 눌러서)
function startFolderDrag(e, head) {
    const folder = head.closest('.etk-wip-folder'), id = folder.dataset.sec, sx = e.clientX, sy = e.clientY, touch = e.pointerType !== 'mouse';
    let started = false, t = 0, ghost = null, at = null, after = false, lastX = sx, lastY = sy, roll = 0;
    const real = (f) => f && opts().tags.includes(f.dataset.sec);
    const begin = () => {
        started = true;
        ghost = document.createElement('div'); ghost.className = 'etk-wip-ghost'; ghost.textContent = id;
        document.body.append(ghost); folder.classList.add('etk-dragging');
        const tree = side?.querySelector('.etk-wip-tree');
        roll = setInterval(() => { if (!tree) return; const b = tree.getBoundingClientRect(), edge = 36; const dy = lastY < b.top + edge ? -Math.ceil((b.top + edge - lastY) / 3) : lastY > b.bottom - edge ? Math.ceil((lastY - (b.bottom - edge)) / 3) : 0; if (dy) { tree.scrollTop += dy; mark(lastX, lastY); } }, 16);
    };
    const mark = (x, y) => {
        ghost.style.transform = `translate(${x + 12}px, ${y + 8}px)`;
        const f = document.elementFromPoint(x, y)?.closest?.('.etk-xp-side .etk-wip-folder'), nf = real(f) && f !== folder ? f : null;
        const na = nf ? y > nf.getBoundingClientRect().top + nf.getBoundingClientRect().height / 2 : false;
        if (nf !== at || na !== after) { at?.classList.remove('etk-fdrop-before', 'etk-fdrop-after'); at = nf; after = na; at?.classList.add(after ? 'etk-fdrop-after' : 'etk-fdrop-before'); }
    };
    const move = (ev) => {
        if (!started) { const d = Math.hypot(ev.clientX - sx, ev.clientY - sy); if (touch) { if (d > 8) cleanup(); return; } if (d < 6) return; begin(); }
        lastX = ev.clientX; lastY = ev.clientY; ev.preventDefault(); mark(ev.clientX, ev.clientY);
    };
    const up = () => {
        if (started && at) {
            const o = opts(), list = tagOrder().filter(x => x !== id);
            list.splice(list.indexOf(at.dataset.sec) + (after ? 1 : 0), 0, id);
            o.tags = list; o.manualTags = true; api.save();
        }
        if (started) dragging = { until: Date.now() + 400 };
        cleanup();
        if (started) render();
    };
    const noScroll = (te) => { const p = te.touches[0]; if (started) { if (te.cancelable) te.preventDefault(); if (p) { lastX = p.clientX; lastY = p.clientY; mark(p.clientX, p.clientY); } } else if (p && Math.hypot(p.clientX - sx, p.clientY - sy) > 8) cleanup(); };
    const cleanup = () => {
        clearTimeout(t); clearInterval(roll);
        document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true);
        document.removeEventListener('touchmove', noScroll, true); document.removeEventListener('touchend', up, true); document.removeEventListener('touchcancel', up, true); window.removeEventListener('blur', up);
        ghost?.remove(); at?.classList.remove('etk-fdrop-before', 'etk-fdrop-after'); folder.classList.remove('etk-dragging');
    };
    if (touch) {
        t = setTimeout(() => { begin(); mark(sx, sy); navigator.vibrate?.(10); }, 350);
        document.addEventListener('touchmove', noScroll, { passive: false, capture: true });
        document.addEventListener('touchend', up, true); document.addEventListener('touchcancel', up, true);
    } else { document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true); }
    window.addEventListener('blur', up);
}

// 태그 모양 높이: 테마 글꼴마다 글자 잉크가 기준선에서 뜨는 높이가 달라 고정값으로는 1~2px씩 어긋났음.
// 그 글꼴로 '기억' 과 아이콘(동그라미)을 그려 본 크기(canvas, 화면 계산 없음)로 두 가운데를 맞춤. 글꼴이 바뀔 때만 다시 잼
let alignKey = '', alignRaf = 0;
function alignIcons() {
    alignRaf = 0;
    const sp = side?.querySelector('.etk-wip-fhead span'); if (!sp) return;
    const st = getComputedStyle(sp), key = `${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
    if (key === alignKey) return;
    const c = (fitCanvas ??= document.createElement('canvas').getContext('2d'));
    c.font = key; const t = c.measureText('가');
    const size = parseFloat(st.fontSize) * 0.9;
    c.font = `900 ${size}px "Font Awesome 6 Free"`; const i = c.measureText('\uf111');
    if (!i.actualBoundingBoxAscent) return;   // 아이콘 글꼴이 아직 안 읽혔으면 다음에
    const mid = (m) => (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    side.style.setProperty('--etk-xp-ticon-va', `${(mid(t) - mid(i)).toFixed(2)}px`);
    alignKey = key;
}
function render() {
    if (!alignRaf) alignRaf = requestAnimationFrame(alignIcons);
    if (!side) return;
    if (side.querySelector('.etk-xp-tagname') === document.activeElement) return;   // 이름 치는 중엔 다시 그리지 않음(친 글이 사라짐)
    const o = opts(), list = sorted(), hidden = hiddenKeys();
    for (const t of Object.keys(o.collapsed)) if (t !== NONE && t !== HIDDEN && !o.tags.includes(t)) delete o.collapsed[t];
    const live = list.filter(u => !hidden.has(u.key));
    // 태그 묶음은 가나다순(짐작 · 직접 만든 것 모두)
    // 즐겨찾기: 별을 누른 확장, 늘 맨 위(태그 묶음에도 그대로 있음). 비어 있으면 안 보임
    const favs = o.favs.map(k => live.find(u => u.key === k)).filter(Boolean);
    let tree = favs.length && shows('fav') ? section(FAV, '즐겨찾기', favs) : '';
    tree += tagOrder().map(t => section(t, t, live.filter(u => tagsOf(u.key).includes(t)), { real: true })).join('');
    tree += section(NONE, o.tags.length ? '태그 없음' : '전체', live.filter(u => !tagsOf(u.key).length));
    tree += section(HIDDEN, '숨김', list.filter(u => hidden.has(u.key)));
    // 새 태그 이름 칸은 목록 맨 위에
    if (ui.edit && !ui.edit.id) tree = '<div class="etk-xp-newrow"><i class="fa-solid fa-tag"></i><input class="text_pole etk-wip-fname etk-xp-tagname" placeholder="새 태그 이름" maxlength="30"></div>' + tree;
    // 새 버전 줄: 몇 개인지 · 모두 업데이트 · 지금 확인. 목록에 줄이 없는 확장(설정 칸이 없는 확장)은 이름을 적어 줌
    if (shows('update')) {
        const pend = updates.pending(), rest = pend.filter(x => !x.listed);
        tree = `<div class="etk-xp-upline${pend.length ? ' etk-has' : ''}"><span class="etk-xp-upcount">${updates.isChecking() ? '새 버전 확인 중…' : pend.length ? `새 버전 ${pend.length}개` : '새 버전 없음'}</span><span class="etk-wip-gap"></span>${pend.length ? '<span class="etk-xp-tag etk-xp-upall interactable" tabindex="0"><i class="fa-solid fa-circle-arrow-up"></i> 모두 업데이트</span>' : ''}<i class="etk-xp-check fa-solid fa-rotate${updates.isChecking() ? ' fa-spin' : ''} interactable" tabindex="0" title="새 버전 지금 확인"></i>${rest.length ? `<small class="etk-xp-uprest">목록에 없는 확장: ${rest.map(x => esc(x.display)).join(', ')}</small>` : ''}</div>` + tree;
    }
    side.querySelector('.etk-wip-tree').innerHTML = tree;
    if (ui.edit) focusTagName();
    const note = side.querySelector('.etk-xp-note');
    note.hidden = !o.guessNote;
    const foot = side.querySelector('.etk-wip-sidefoot');
    const n = ui.picked.size;
    foot.innerHTML = ui.picking
        ? `<span class="etk-wip-count">${n}개 선택</span><span class="etk-wip-gap"></span>${shows('update') && pickedOld().length ? `<div class="menu_button etk-xp-uppick" tabindex="0"><i class="fa-solid fa-circle-arrow-up"></i> 고른 ${pickedOld().length}개 업데이트</div>` : ''}<div class="menu_button etk-wip-pick">끝내기</div>`
            + `<div class="etk-xp-tags">${o.tags.map(t => { const all = n && [...ui.picked].every(k => tagsOf(k).includes(t)); return `<span class="etk-xp-tag interactable${all ? ' etk-on' : ''}${n ? '' : ' disabled'}" tabindex="0" data-tag="${esc(t)}">${esc(t)}</span>`; }).join('')}<span class="etk-xp-tag etk-xp-newtag interactable" tabindex="0"><i class="fa-solid fa-plus"></i> 새 태그</span>${n ? `<span class="etk-xp-tag etk-xp-hide interactable" tabindex="0">${[...ui.picked].every(k => hidden.has(k)) ? '<i class="fa-solid fa-eye"></i> 다시 보이기' : '<i class="fa-solid fa-eye-slash"></i> 숨기기'}</span>` : ''}</div>`
        : !shows('hint') ? '' : `<small class="etk-wip-draghint">${matchMedia('(pointer: coarse)').matches ? '길게 눌러 끌면' : '끌어서'} 순서를 바꾸거나 다른 태그로 옮겨요</small>`;   // 손가락은 길게 눌러야 끌기가 시작됨(그냥 밀면 목록이 굴러감)
    side.querySelector('.etk-xp-pickbtn').classList.toggle('etk-on', ui.picking);
    // 모두 접기 · 펴기: 하나라도 펼쳐져 있으면 접기, 다 접혀 있으면 펴기
    const anyOpen = !!side.querySelector('.etk-wip-folder .etk-wip-book'), fb = side.querySelector('.etk-xp-foldall');
    fb.classList.toggle('fa-angles-up', anyOpen); fb.classList.toggle('fa-angles-down', !anyOpen); fb.title = anyOpen ? '묶음 모두 접기' : '묶음 모두 펴기';
    side.classList.toggle('etk-open', ui.open);
    const cur = units.find(x => x.key === o.last);
    side.querySelector('.etk-wip-now span').textContent = cur?.title || '확장 고르기';
}

// '선택'으로 고른 확장 가운데 새 버전이 있는 것(몇 개만 골라 업데이트)
const pickedOld = () => units.filter(u => ui.picked.has(u.key) && updates.outdated(u));
// 고른 확장들에 태그 붙이기 · 떼기 · 숨기기
function toggleTag(t) {
    const o = opts(), keys = [...ui.picked], all = keys.every(k => tagsOf(k).includes(t));
    for (const k of keys) { const cur = tagsOf(k).filter(x => x !== t); if (!all) cur.push(t); if (cur.length) o.of[k] = cur; else delete o.of[k]; }
}
// 태그 이름 칸: Enter · 칸 밖을 누르면 저장, Esc 는 취소
function focusTagName() {
    const inp = side?.querySelector('.etk-xp-tagname');
    if (!inp) return;
    inp.focus(); inp.select();
    let done = false;
    const finish = (save) => {
        if (done) return; done = true;
        const o = opts(), edit = ui.edit, name = inp.value.trim();
        ui.edit = null; inp.blur();
        if (save && name) {
            if (!edit.id) {
                if (!o.tags.includes(name)) o.tags.push(name);
                if (ui.picked.size && ![...ui.picked].every(k => tagsOf(k).includes(name))) toggleTag(name);   // 고른 게 있으면 바로 붙임
            } else if (name !== edit.id) {
                const id = edit.id;
                o.tags = o.tags.map(t => (t === id ? name : t)).filter((t, i, a) => a.indexOf(t) === i);
                for (const k of Object.keys(o.of)) o.of[k] = [...new Set(o.of[k].map(t => (t === id ? name : t)))];
                if (id in o.collapsed) { o.collapsed[name] = o.collapsed[id]; delete o.collapsed[id]; }
                if (o.icons[id]) { o.icons[name] = o.icons[id]; delete o.icons[id]; }
                if (o.colors[id]) { o.colors[name] = o.colors[id]; delete o.colors[id]; }
            }
            api.save();
        }
        render();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } e.stopPropagation(); });
    inp.addEventListener('blur', () => finish(true));
}

async function onClick(e) {
    if (dragging && Date.now() < dragging.until) return;
    const o = opts();
    if (e.target.closest('.etk-wip-now')) { ui.open = !ui.open; return render(); }
    if (e.target.closest('.etk-xp-check')) return void updates.check(true);
    if (e.target.closest('.etk-xp-uppick')) return void updates.update(pickedOld().map(updates.extOf));
    if (e.target.closest('.etk-xp-upall')) return void updates.update(updates.pending().map(x => x.name));
    const up = e.target.closest('.etk-xp-up');
    if (up) { const u = units.find(x => x.key === up.closest('.etk-wip-book').dataset.key); if (u) updates.update([updates.extOf(u)]); return; }
    if (e.target.closest('.etk-xp-keep')) { o.guessNote = false; api.save(); return render(); }
    if (e.target.closest('.etk-xp-clear')) { o.of = {}; o.tags = []; o.guessNote = false; api.save(); return render(); }
    if (e.target.closest('.etk-xp-pickbtn, .etk-wip-pick')) { ui.picking = !ui.picking; ui.picked.clear(); return render(); }
    if (e.target.closest('.etk-xp-newtag')) { ui.edit = {}; ui.confirm = null; return render(); }
    if (e.target.closest('.etk-xp-foldall')) {
        const close = !!side.querySelector('.etk-wip-folder .etk-wip-book');
        for (const id of [FAV, ...o.tags, NONE, HIDDEN]) o.collapsed[id] = close;
        if (close) ui.iconFor = null;
        api.save(); return render();
    }
    if (e.target.closest('.etk-xp-tagname')) return;
    if (e.target.closest('.etk-xp-hide')) {
        const show = [...ui.picked].every(k => o.hidden.includes(k));
        o.hidden = show ? o.hidden.filter(k => !ui.picked.has(k)) : [...new Set([...o.hidden, ...ui.picked])];
        ui.picked.clear(); api.save(); return render();
    }
    const tag = e.target.closest('.etk-xp-tag[data-tag]');
    if (tag) { if (!ui.picked.size) return; toggleTag(tag.dataset.tag); api.save(); return render(); }
    const pick = e.target.closest('.etk-xp-pick');
    if (pick) { const id = pick.closest('.etk-wip-folder').dataset.sec; if (pick.dataset.icon) o.icons[id] = pick.dataset.icon; else delete o.icons[id]; api.save(); return render(); }   // 고르는 칸은 모양 버튼을 다시 누를 때까지 열어 둠
    // 색은 골라도 창을 열어 둠(모양도 이어서 고를 수 있게). 모양이 없으면 동그라미를 붙여 색이 보이게
    const col = e.target.closest('.etk-xp-color:not(.etk-xp-custom)');   // 직접 고르기는 색 고르기 창이 열리게 그냥 둠(change 에서 저장)
    if (col) { const id = col.closest('.etk-wip-folder').dataset.sec; if (col.dataset.color) { o.colors[id] = col.dataset.color; if (!isIcon(o.icons[id])) o.icons[id] = 'circle'; } else delete o.colors[id]; api.save(); return render(); }
    if (e.target.closest('.etk-xp-palette')) return;
    const head = e.target.closest('.etk-wip-fhead');
    if (head) {
        const id = head.parentElement.dataset.sec;
        if (e.target.closest('.etk-wip-fall')) {
            const keys = [...head.parentElement.querySelectorAll('.etk-wip-book')].map(r => r.dataset.key), all = keys.every(k => ui.picked.has(k));
            for (const k of keys) all ? ui.picked.delete(k) : ui.picked.add(k);
            return render();
        }
        if (e.target.closest('.etk-xp-ficon')) { ui.iconFor = ui.iconFor === id ? null : id; ui.confirm = null; return render(); }
        if (e.target.closest('.etk-wip-frename')) { ui.edit = { id }; ui.confirm = null; ui.iconFor = null; return render(); }
        if (e.target.closest('.etk-wip-fdel')) { ui.confirm = id; return render(); }
        if (e.target.closest('.etk-xp-delno')) { ui.confirm = null; return render(); }
        if (e.target.closest('.etk-xp-delok')) {
            ui.confirm = null;
            o.tags = o.tags.filter(t => t !== id); delete o.icons[id]; delete o.colors[id];
            for (const k of Object.keys(o.of)) { o.of[k] = o.of[k].filter(t => t !== id); if (!o.of[k].length) delete o.of[k]; }
            api.save(); return render();
        }
        o.collapsed[id] = !(o.collapsed[id] ?? id === HIDDEN);   // (숨김은 처음엔 접혀 있음)
        if (o.collapsed[id] && ui.iconFor === id) ui.iconFor = null;   // 접으면 열려 있던 모양 고르는 칸도 같이 접음
        api.save(); return render();
    }
    const star = e.target.closest('.etk-xp-star');
    if (star) {
        const k = star.closest('.etk-wip-book').dataset.key, at = o.favs.indexOf(k);
        at >= 0 ? o.favs.splice(at, 1) : o.favs.push(k);
        api.save(); return render();
    }
    const r = e.target.closest('.etk-wip-book');
    if (!r) return;
    if (ui.picking) {
        if (swallowClick) return;
        const k = r.dataset.key, on = !ui.picked.has(k);
        // PC: Shift 를 누른 채 누르면 앞서 누른 줄부터 여기까지 한꺼번에
        if (e.shiftKey && ui.lastPick) {
            const rows = [...side.querySelectorAll('.etk-wip-book')], a = rows.findIndex(x => x.dataset.key === ui.lastPick), b = rows.indexOf(r);
            if (a >= 0) for (const x of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) on ? ui.picked.add(x.dataset.key) : ui.picked.delete(x.dataset.key);
        } else on ? ui.picked.add(k) : ui.picked.delete(k);
        ui.lastPick = k;
        return render();
    }
    select(r.dataset.key, { fromUser: true });
}
function onKey(e) {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches('.etk-wip-book, .etk-wip-fhead, .etk-wip-now, .etk-xp-tag, .etk-xp-newtag, .etk-xp-star, .etk-xp-up, .etk-xp-upall, .etk-xp-uppick, .etk-xp-check, .etk-xp-foldall, .etk-xp-pickbtn, .etk-xp-pick, .etk-xp-color')) return;
    e.preventDefault(); e.target.click();
}

// 줄을 끌어 순서 바꾸기 · 다른 묶음으로 옮기기: 마우스는 조금 움직이면, 손가락은 0.35초 눌렀다가 끌면 시작(그냥 밀면 목록이 스크롤).
// 다른 태그 묶음에 놓으면 원래 묶음의 태그를 떼고 그 태그를 붙임('태그 없음'이면 떼기만, '숨김'이면 숨기기). 고른 게 있으면 고른 것 전부
// 칸 크기 끌기: PC 는 왼쪽 목록 폭, 휴대폰은 펼친 목록 높이. 누를 때 한 번만 재고, 끄는 동안엔 CSS 변수만 바꿈(화면당 한 번), 놓을 때 저장
const SIZE_VAR = { w: '--etk-xp-left', h: '--etk-xp-listh' };
function applySize() {
    const o = opts();
    block()?.style.setProperty(SIZE_VAR.w, o.leftW ? o.leftW + 'px' : '');
    side?.style.setProperty(SIZE_VAR.h, o.listH ? o.listH + 'px' : '');
}
// 두 번 누르면 처음 크기: 끌기 때문에 누를 때 기본 동작을 막아 휴대폰에선 dblclick 이 안 오고, 빨리 두 번 누르면 놓쳐서 직접 셈
let lastTap = 0;
function startResize(e) {
    e.preventDefault();
    const o = opts(), tall = narrow(), h = e.target;
    const now = e.timeStamp;
    if (now - lastTap < 450) { lastTap = 0; if (tall) delete o.listH; else delete o.leftW; api.save(); applySize(); return; }
    lastTap = now;
    const base = tall ? side.querySelector('.etk-wip-sidebody').getBoundingClientRect().height : side.getBoundingClientRect().width;
    const max = tall ? innerHeight * 0.8 : (block()?.clientWidth || innerWidth) * 0.6, min = tall ? 120 : 200;
    const s0 = tall ? e.clientY : e.clientX;
    let v = base, raf = 0;
    h.setPointerCapture?.(e.pointerId);
    h.classList.add('etk-on');
    const move = (ev) => {
        v = Math.round(Math.min(max, Math.max(min, base + (tall ? ev.clientY : ev.clientX) - s0)));
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (tall) side.style.setProperty(SIZE_VAR.h, v + 'px'); else block()?.style.setProperty(SIZE_VAR.w, v + 'px'); });
    };
    const up = () => {
        h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
        h.classList.remove('etk-on');
        if (v === base) return;   // 끌지 않고 누르기만 함(두 번 누르기 첫 번째일 수 있음): 크기를 저장하지 않음
        lastTap = 0;
        if (tall) o.listH = v; else o.leftW = v;
        api.save();
    };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
}

// 선택 중 체크 칸을 누른 채 위아래로 밀면 지나간 줄을 한꺼번에 고르거나 빼기(첫 줄을 고르면 고르기, 빼면 빼기)
// 줄을 바꿀 때마다 그 줄 표시만 바꾸고, 다 그리기는 손을 뗄 때 한 번
let swallowClick = false;
function startSwipePick(e, r0) {
    e.preventDefault();
    // Shift 범위 고르기는 체크 칸을 눌러도 되게(체크 칸 누르기는 여기로 와서 아래 누르기 처리까지 안 감)
    if (e.shiftKey && ui.lastPick) {
        const rows = [...side.querySelectorAll('.etk-wip-book')], a = rows.findIndex(x => x.dataset.key === ui.lastPick), b = rows.indexOf(r0), on = !ui.picked.has(r0.dataset.key);
        if (a >= 0) for (const x of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) on ? ui.picked.add(x.dataset.key) : ui.picked.delete(x.dataset.key);
        ui.lastPick = r0.dataset.key;
        swallowClick = true; setTimeout(() => { swallowClick = false; }, 300);
        return render();
    }
    const tree = side.querySelector('.etk-wip-tree'), tb = tree.getBoundingClientRect(), on = !ui.picked.has(r0.dataset.key), seen = new Set();
    const mark = (r) => {
        if (!r || seen.has(r) || !side.contains(r)) return;
        seen.add(r); const k = r.dataset.key;
        on ? ui.picked.add(k) : ui.picked.delete(k);
        r.classList.toggle('etk-picked', on); const cb = r.querySelector('input'); if (cb) cb.checked = on;
        ui.lastPick = k;
    };
    mark(r0);
    const box = e.target.closest('.etk-xp-pickbox');
    box.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
        mark(document.elementFromPoint(tb.left + 30, ev.clientY)?.closest('.etk-wip-book'));
        if (ev.clientY < tb.top + 28) tree.scrollTop -= 12; else if (ev.clientY > tb.bottom - 28) tree.scrollTop += 12;   // 가장자리에 대면 목록을 굴림
    };
    const up = () => {
        box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); box.removeEventListener('pointercancel', up);
        swallowClick = true; setTimeout(() => { swallowClick = false; });   // 손을 뗀 뒤 오는 누르기로 첫 줄이 다시 뒤집히지 않게
        render();
    };
    box.addEventListener('pointermove', move); box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
}

function onPointerDown(e) {
    if (e.target.closest?.('.etk-xp-split')) return startResize(e);
    if (ui.picking && e.button <= 0 && e.target.closest?.('.etk-xp-pickbox')) return startSwipePick(e, e.target.closest('.etk-wip-book'));
    const fh = e.target.closest?.('.etk-wip-fhead');
    if (fh && e.button <= 0 && !ui.picking && !ui.edit && opts().tags.includes(fh.closest('.etk-wip-folder').dataset.sec) && !e.target.closest('input, .etk-xp-ficon, .etk-wip-frename, .etk-wip-fdel, .etk-xp-tag')) return startFolderDrag(e, fh);
    const r = e.target.closest?.('.etk-wip-book');
    if (!r || e.button > 0 || e.target.closest('.etk-xp-star, .etk-xp-up')) return;
    const sx = e.clientX, sy = e.clientY, touch = e.pointerType !== 'mouse';
    let started = false, t = 0, ghost = null, over = null, at = null, after = false, lastY = sy, lastX = sx, roll = 0;
    const keys = ui.picking && ui.picked.has(r.dataset.key) ? [...ui.picked] : [r.dataset.key];
    const begin = () => {
        started = true;
        ghost = document.createElement('div'); ghost.className = 'etk-wip-ghost';
        ghost.textContent = keys.length > 1 ? `${keys.length}개` : r.querySelector('.etk-wip-bname').textContent;
        document.body.append(ghost); r.classList.add('etk-dragging');
        // 목록 위 · 아래 끝 가까이 대고 있으면 목록을 굴림(멀리 있는 묶음에도 놓을 수 있게)
        const tree = side?.querySelector('.etk-wip-tree');
        roll = setInterval(() => {
            if (!tree) return;
            const b = tree.getBoundingClientRect(), edge = 36;
            const dy = lastY < b.top + edge ? -Math.ceil((b.top + edge - lastY) / 3) : lastY > b.bottom - edge ? Math.ceil((lastY - (b.bottom - edge)) / 3) : 0;
            if (dy) { tree.scrollTop += dy; mark(lastX, lastY); }
        }, 16);
    };
    const mark = (x, y) => {
        ghost.style.transform = `translate(${x + 12}px, ${y + 8}px)`;
        const hit = document.elementFromPoint(x, y);
        const f = hit?.closest?.('.etk-xp-side .etk-wip-folder'), b = hit?.closest?.('.etk-xp-side .etk-wip-book');
        const nb = b && b !== r ? b : null, na = nb ? y > nb.getBoundingClientRect().top + nb.getBoundingClientRect().height / 2 : false;
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
        lastX = ev.clientX; lastY = ev.clientY;
        ev.preventDefault(); mark(ev.clientX, ev.clientY);
    };
    const up = () => {
        if (started && over) {
            const o = opts(), from = r.dataset.sec, to = over.dataset.sec;
            if (to !== from && (to === FAV || from === FAV)) {
                // 즐겨찾기로 끌어 넣으면 별 켜기, 즐겨찾기에서 다른 묶음으로 빼면 별 끄기(태그는 그대로)
                for (const k of keys) { o.favs = o.favs.filter(x => x !== k); if (to === FAV) o.favs.push(k); }
            } else if (to !== from) {
                for (const k of keys) {
                    let cur = tagsOf(k);
                    if (from === HIDDEN) o.hidden = o.hidden.filter(x => x !== k);
                    else if (from !== NONE) cur = cur.filter(x => x !== from);
                    if (to === HIDDEN) { if (!o.hidden.includes(k)) o.hidden.push(k); }
                    else if (to !== NONE && !cur.includes(to)) cur.push(to);
                    if (to === NONE) cur = [];
                    if (cur.length) o.of[k] = cur; else delete o.of[k];
                }
                if (to !== NONE && to !== HIDDEN) o.collapsed[to] = false;
            }
            // 순서: 놓은 줄 앞 · 뒤에 끼움(묶음 제목에 놓으면 그 묶음 맨 끝 = 순서는 그대로)
            if (at && over.contains(at)) {
                const all = sorted().map(u => u.key).filter(k => !keys.includes(k));
                let i = all.indexOf(at.dataset.key) + (after ? 1 : 0);
                if (i < 0) i = all.length;
                all.splice(i, 0, ...keys);
                o.order = all;
            }
            api.save();
        }
        if (started) dragging = { until: Date.now() + 400 };
        cleanup();
        if (started) render();
    };
    // 손가락: 끌기 신호는 터치 신호로 받음. 손가락을 움직이는 순간 브라우저가 화면 굴리기로 넘겨받으며 포인터 신호를 끊어(pointercancel)
    //   길게 눌러 집은 줄을 끌 수 없었음 — 터치 신호는 그 뒤에도 끝까지 옴. 집은 뒤엔 화면이 안 굴러가게 막음
    const noScroll = (te) => { if (started) { if (te.cancelable) te.preventDefault(); const p = te.touches[0]; if (p) { lastX = p.clientX; lastY = p.clientY; mark(p.clientX, p.clientY); } } else if (touch) { const p = te.touches[0]; if (p && Math.hypot(p.clientX - sx, p.clientY - sy) > 8) cleanup(); } };
    const touchUp = () => up();
    const cleanup = () => {
        clearTimeout(t); clearInterval(roll);
        document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true);
        document.removeEventListener('touchmove', noScroll, true); document.removeEventListener('touchend', touchUp, true); document.removeEventListener('touchcancel', touchUp, true); window.removeEventListener('blur', up);
        ghost?.remove(); over?.classList.remove('etk-drop'); at?.classList.remove('etk-drop-before', 'etk-drop-after'); r.classList.remove('etk-dragging');
    };
    // 신호는 문서에서 받음: 끄는 중에 목록을 다시 그려도 놓기를 받게
    if (touch) {
        t = setTimeout(() => { begin(); mark(sx, sy); navigator.vibrate?.(10); }, 350);
        document.addEventListener('touchmove', noScroll, { passive: false, capture: true });
        document.addEventListener('touchend', touchUp, true); document.addEventListener('touchcancel', touchUp, true);
    } else { document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true); }
    window.addEventListener('blur', up);
}

// 창을 열기 전 가벼운 준비: 훑지 않고 지난번 고른 확장만 보이게 표시(계산된 스타일 안 읽음)
function quickHide() {
    const last = opts().last;
    for (const col of cols()) for (const holder of col.children) {
        const d = holder.matches('.inline-drawer') ? holder : holder.querySelector('.inline-drawer');
        if (!d || !headOf(d)) continue;
        holder.classList.add('etk-xp-unit');
        const key = holder.id || d.id || `name:${titleOf(d)}`;
        holder.classList.toggle('etk-xp-cur', key === last);
        if (key === last) for (const c of cols()) c.classList.toggle('etk-xp-curcol', c.contains(holder));
    }
}
function rebuild() {
    scan();
    if (classWatch) for (const u of units) classWatch.observe(u.holder, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });   // 새로 생긴 칸도(같은 칸을 다시 걸어도 하나로 침)
    for (const k of [...ui.picked]) if (!units.some(u => u.key === k)) ui.picked.delete(k);
    render();
    if (shows('update')) { updates.pair(units).then(() => { if (side) render(); }); updates.checkSoon(); }
    const o = opts(), hid = hiddenKeys(), cur = units.find(x => x.key === o.last && !hid.has(x.key));
    const first = sorted().find(u => !hid.has(u.key));
    if (cur || first) select((cur || first).key);
}
// 확장 창이 닫혀 있으면 다시 훑기를 미뤘다가 열 때 한 번(켜지는 동안 확장들이 칸을 넣을 때마다 훑어서 화면 계산을 6번 넘게 치렀음)
let dirty = false, openWatch = null;
const panelOpen = () => panel()?.classList.contains('openDrawer') || panel()?.classList.contains('pinnedOpen');
const schedule = () => { clearTimeout(timer); if (!panelOpen()) { dirty = true; return; } timer = setTimeout(rebuild, 150); };

export function start(a) {
    api = a;
    // 따로 있던 '확장 관리 창 검색칸' 기능을 여기로 합침: 처음 한 번, 그 기능을 꺼 두었던 사람은 검색칸도 꺼 둠
    const o0 = opts();
    if (!o0.searchMoved) { if (!globalThis[Symbol.for('breeze.api')]?.isOn?.('extension_search')) o0.off.push('search'); o0.searchMoved = true; a.save(); }
    if (shows('search')) searchStart(searchApi(a));
    if (shows('update')) updates.start(() => { if (side) render(); });
    const b = block(), p = panel(), first = cols()[0];
    if (!b || !p || !first) return;
    p.classList.add('etk-xp');
    side = document.createElement('div');
    side.className = 'etk-wip-side etk-xp-side';
    side.innerHTML = `<div class="etk-wip-top"><div class="etk-wip-now" tabindex="0"><i class="fa-solid fa-puzzle-piece"></i><span></span><i class="fa-solid fa-chevron-down"></i></div></div>
        <div class="etk-wip-sidebody">
            <div class="etk-xp-note" hidden><span>확장 이름으로 태그를 짐작해 붙여 봤어요. 틀린 건 끌어서 옮기면 돼요.</span><div class="etk-xp-noteact"><div class="menu_button etk-xp-keep">그대로 둘게요</div><div class="menu_button etk-xp-clear">태그 다 지우기</div></div></div>
            <div class="etk-wip-sidehead etk-xp-head"><input type="search" class="text_pole etk-wip-find" placeholder="${PH[0]}"><div class="menu_button etk-xp-foldall fa-solid fa-angles-up" tabindex="0" title="묶음 모두 접기"></div><div class="menu_button etk-xp-newtag fa-solid fa-tag" tabindex="0" title="새 태그"></div><div class="menu_button etk-xp-pickbtn" tabindex="0">선택</div></div>
            <div class="etk-wip-tree"></div>
            <div class="etk-wip-sidefoot"></div>
        </div>
        <div class="etk-xp-split" title="끌어서 크기 조절 (두 번 누르면 처음 크기)"></div>`;
    first.before(side);
    side.addEventListener('click', onClick);
    side.addEventListener('keydown', onKey);
    side.addEventListener('pointerdown', onPointerDown);
    // 색 직접 고르기: 고르는 동안은 모양 색만 바꿔 보여 주고, 다 고르면(change) 저장
    side.addEventListener('input', (e) => { if (!e.target.matches('.etk-xp-custom input')) return; const f = e.target.closest('.etk-wip-folder'), i = f?.querySelector('.etk-xp-ticon'); if (i) { i.style.color = e.target.value; i.style.opacity = '1'; } });
    side.addEventListener('change', (e) => { if (!e.target.matches('.etk-xp-custom input')) return; const o = opts(), id = e.target.closest('.etk-wip-folder').dataset.sec; o.colors[id] = e.target.value; if (!isIcon(o.icons[id])) o.icons[id] = 'circle'; api.save(); render(); });
    applySize();
    document.fonts?.ready.then(() => { if (side) { alignKey = ''; alignIcons(); } });   // 테마 글꼴이 늦게 읽히면 다시 잼
    side.querySelector('.etk-wip-find').addEventListener('input', (e) => { ui.query = e.target.value; render(); });
    // 좁은 배치는 화면 폭이 아니라 확장 창 폭으로(테마에 따라 PC 에서도 창이 좁음)
    resizer = new ResizeObserver(() => { const w = p.clientWidth; if (!w) return; const was = narrow(), now = was ? w < 660 : w < 620; if (now !== was) p.classList.toggle('etk-xp-narrow', now); });
    resizer.observe(p);
    // 찾기 칸 안내 글이 칸보다 길면(휴대폰 · 글자 크기 키운 테마) 잘려 보여서, 칸 폭이 바뀔 때만 재서 짧은 글로
    const find = side.querySelector('.etk-wip-find');
    fitter = new ResizeObserver(([e]) => {
        const w = e.contentRect.width; if (!w) return;
        const c = (fitCanvas ??= document.createElement('canvas').getContext('2d'));
        const st = getComputedStyle(find); c.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;   // font 묶음 값은 브라우저에 따라 빈 글이라 나눠 씀
        find.placeholder = PH.find(t => c.measureText(t).width <= w) || PH[PH.length - 1];
    });
    fitter.observe(find);
    // 확장이 나중에 칸을 넣거나 빼면 목록도(우리 표시 바꿈은 class 라 여기 안 걸림)
    observer = new MutationObserver(schedule);
    for (const c of cols()) observer.observe(c, { childList: true });
    // 다른 도구가 나중에 칸을 숨기거나 다시 보이면(class 를 바꿈) 목록도. 우리 표시(etk-xp-*)만 바뀐 건 무시
    classWatch = new MutationObserver((list) => { const mine = (v) => String(v || '').split(/\s+/).filter(c => c && !c.startsWith('etk-xp-')).sort().join(' '); if (list.some(m => mine(m.oldValue) !== mine(m.target.getAttribute('class')))) schedule(); });

    openWatch = new MutationObserver(() => { if (dirty && panelOpen()) { dirty = false; rebuild(); } });
    openWatch.observe(p, { attributes: true, attributeFilter: ['class'] });
    // 처음: 창이 열려 있으면 바로, 닫혀 있으면 열 때. 다만 고른 확장만 보이는 모양은 바로 걸어 둠(열자마자 다 보였다 줄어드는 깜빡임 없게)
    if (panelOpen()) rebuild(); else { dirty = true; quickHide(); }
}

export function stop() {
    searchStop();
    updates.stop();
    clearTimeout(timer);
    observer?.disconnect(); observer = null;
    openWatch?.disconnect(); openWatch = null; dirty = false;
    resizer?.disconnect(); resizer = null;
    fitter?.disconnect(); fitter = null;
    classWatch?.disconnect(); classWatch = null;
    cancelAnimationFrame(alignRaf); alignRaf = 0; alignKey = '';
    // 우리가 펼친 칸은 다시 접음
    for (const d of opened) if (d.isConnected && isOpen(d)) openNow(d);
    opened = new Set();
    document.querySelectorAll('.etk-xp-unit, .etk-xp-cur, .etk-xp-curcol, .etk-xp-out').forEach(x => x.classList.remove('etk-xp-unit', 'etk-xp-cur', 'etk-xp-curcol', 'etk-xp-out'));
    block()?.style.removeProperty(SIZE_VAR.w);
    panel()?.classList.remove('etk-xp', 'etk-xp-narrow', 'etk-xp-probe');
    side?.remove(); side = null;
    units = []; ui.query = ''; ui.picking = false; ui.picked.clear(); ui.open = false; ui.edit = null; ui.confirm = null; ui.iconFor = null; ui.iconFor = null;
    api = null;
}

// breeze 설정 창: 확장 창에 무엇을 보일지 고르기(끄면 버튼만 숨기고 고른 모양 · 즐겨찾기는 지우지 않음)
const PARTS = [['shape', '태그 모양과 색 고르기'], ['fav', '즐겨찾기 별'], ['hint', '목록 아래 끌기 안내 글'], ['count', '묶음 옆 확장 개수'], ['update', '새 버전 표시와 업데이트 버튼'], ['search', "'확장 관리' 창 검색칸"]];
export function options(box, a) {
    const o = a.options(); o.off ??= [];
    box.innerHTML = `<div class="etk-xp-optlist"><small>확장 창에 보일 것</small>${PARTS.map(([k, t]) => `<label class="checkbox_label"><input type="checkbox" data-k="${k}"${o.off.includes(k) ? '' : ' checked'}><span>${t}</span></label>`).join('')}</div>`;
    box.addEventListener('change', (e) => {
        const k = e.target.dataset?.k; if (!k) return;
        o.off = o.off.filter(x => x !== k); if (!e.target.checked) o.off.push(k);
        a.save();
        if (k === 'search' && api) { if (e.target.checked) searchStart(searchApi(api)); else searchStop(); return; }
        if (k === 'update' && api) { if (e.target.checked) { updates.start(() => { if (side) render(); }); if (side) rebuild(); } else updates.stop(); }
        if (side) render();
    });
}
