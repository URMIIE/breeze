// 채팅 파일 관리 창 보기 쉽게(실리태번 창 그대로, 크기도 그대로).
// 실리태번 창은 채팅을 하나씩만 지우거나 내보낼 수 있고, 어떤 채팅인지는 열어서 읽어 봐야 안다.
// ① 줄마다 언제 · 메시지 몇 개 · (알면) 언제부터 며칠 한 채팅인지, 지금 열린 채팅 표시
// ② 줄의 ∨: 채팅을 열지 않고 처음 두 마디 · 끝 두 마디를 그 자리에(그때 한 번 그 채팅 파일을 읽음). 번역문(extra.display_text)이 있으면 번역문으로,
//    화면 표시용 정규식도 거쳐 채팅 화면에서 보이는 글로. 열기 · 이름 · 내보내기 · 지우기도 여기에(실리태번 버튼을 대신 눌러 줌 — 지우기만 보관을 거치는 우리 흐름)
// ③ 정렬(최근 · 오래된 · 메시지 많은 · 이름) ④ '선택': 여러 개 골라 내보내기(zip) · 지우기. 지금 열린 채팅은 못 고름
// ⑤ 지우기 전에 채팅을 user/files 에 따로 보관(7일), 지운 직후 알림 · 세부 설정의 보관함에서 되돌리기. 보관에 실패한 채팅은 지우지 않음.
// 목록 자료(메시지 수 · 마지막 시각)는 실리태번이 받는 /api/chats/search 응답을 옆에서 읽기만 함(응답은 그대로).
// 언제 시작한 채팅인지는 목록 응답에 없어서: 한 번 펼쳐 본 채팅(브라우저에 기억) · 이름에 날짜가 든 채팅만 보임.
import { saveUserFile } from '../lib/files.js';
import { toScreen } from './chat_list_preview.js';

// 지운 채팅 보관 날수(사용자가 고름, 0 = 보관하지 않음). 묶음마다 지운 때 정한 날수로 비움(나중에 날수를 바꿔도 이미 보관한 것은 그대로)
const KEEP_CHOICES = [0, 1, 3, 7, 14, 30];
const keepDays = () => { const v = Number(opts().keepDays); return KEEP_CHOICES.includes(v) ? v : 7; };
const untilOf = (b) => b.until ?? b.at + 7 * 86400000;
const SPANS = 'breeze.chat-starts';
const SORTS = { recent: '최근 대화순', oldest: '오래된 대화순', count: '메시지 많은 순', name: '이름순' };
let api = null, orig = null, wrapped = null, on = false, observer = null, closeWatch = null;
let info = new Map();       // 파일 이름 → { count, last, size }
let picked = new Set(), selecting = false, opened = new Set();
const peeks = new Map();    // 범위|파일|마지막 시각 → { lines, total }
const ctx = () => api.ctx();
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const list = () => document.getElementById('select_chat_div');
const popup = () => document.getElementById('select_chat_popup');
const opts = () => { const o = api.options(); o.sort ??= 'recent'; o.trash ??= []; return o; };

// 지금 창이 보여 주는 대상(캐릭터 또는 그룹)
function scope() {
    const c = ctx();
    if (c.groupId) return { group: String(c.groupId), name: c.groups.find(g => g.id == c.groupId)?.name || '' };
    const ch = c.characters[c.characterId];
    return ch ? { avatar: ch.avatar, name: ch.name } : null;
}
const scopeKey = (s) => (s?.group ? `g:${s.group}` : `c:${s?.avatar}`);
const post = (url, body) => fetch(url, { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify(body) });

async function readChat(s, file) {
    const res = s.group ? await post('/api/chats/group/get', { id: file }) : await post('/api/chats/get', { ch_name: s.name, file_name: file, avatar_url: s.avatar });
    if (!res.ok) throw new Error(`채팅을 못 읽었어요 (${res.status})`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
}

// ── 언제 시작한 채팅인지(브라우저에 기억: 시작 시각은 안 바뀜)
let starts = null;
const loadStarts = () => { if (!starts) { try { starts = JSON.parse(localStorage.getItem(SPANS) || '{}') || {}; } catch { starts = {}; } } return starts; };
function rememberStart(key, at) {
    const all = loadStarts();
    all[key] = at;
    const keys = Object.keys(all);
    if (keys.length > 600) for (const k of keys.slice(0, keys.length - 600)) delete all[k];
    try { localStorage.setItem(SPANS, JSON.stringify(all)); } catch { /* 저장소가 막힌 브라우저 */ }
}
const stampOf = (v) => { try { const m = ctx().timestampToMoment(v); return m?.isValid?.() ? m.valueOf() : 0; } catch { return 0; } };
// 시작 날짜 = 첫 메시지 날짜: 서버 플러그인이 목록에 넣어 준 것 → 한 번 펼쳐 본 채팅(브라우저에 기억). 둘 다 없으면 안 보임.
// 채팅 이름의 날짜는 쓰지 않음: 분기 채팅은 원래 채팅 이름(날짜)을 물려받아서, 펼치기 전후로 시작 날짜가 달라졌음
function startOf(s, file) {
    return info.get(file)?.first || loadStarts()[`${scopeKey(s)}|${file}`] || 0;
}
// 모든 채팅을 같은 기준으로: 첫 메시지 날부터 마지막 메시지 날까지(지금 열린 채팅만 오늘까지 세면 기준이 둘이라 헷갈렸음)
function spanText(start, last) {
    if (!start || !last || last < start) return '';
    const day = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    const days = Math.round((day(last) - day(start)) / 86400000) + 1;
    const d = new Date(start), from = `${d.getMonth() + 1}월 ${d.getDate()}일`;
    return days <= 1 ? `${from} 하루` : `${from}부터 ${days}일`;
}

// ── 줄 꾸미기
const rows = () => [...list().querySelectorAll(':scope > .select_chat_block_wrapper')];
const fileOf = (row) => row.querySelector('.select_chat_block')?.getAttribute('file_name') || '';
const isCurrent = (row) => row.querySelector('.select_chat_block')?.getAttribute('highlight') === 'true';

// 마지막으로 대화한 때: 분기 채팅은 모채팅 메시지 시각을 그대로 물려받아 방금 만들어도 '한 달 전'이었음 → 만든 시각(서버가 분기 채팅에만 줌)과 둘 중 늦은 쪽
const lastAt = (d) => Math.max(stampOf(d?.last) || 0, d?.born || 0);
function infoText(s, file, current) {
    const d = info.get(file);
    if (!d) return '';
    const m = ctx().timestampToMoment(lastAt(d));
    const parts = [m?.isValid?.() ? m.fromNow() : '', `메시지 ${d.count}개`, spanText(startOf(s, file), stampOf(d.last)), d.size].filter(Boolean);
    return parts.join(' · ');
}

function decorateRow(row, s) {
    const block = row.querySelector('.select_chat_block'), file = fileOf(row);
    if (!block || !file) return;
    const current = isCurrent(row);
    let line = block.querySelector(':scope > .etk-cfl-info');
    if (!line) {
        line = document.createElement('div'); line.className = 'etk-cfl-info';
        const head = block.querySelector('[id="select_chat_name_wrapper"]');
        if (head) head.after(line); else block.prepend(line);
        const more = document.createElement('div');
        more.className = 'etk-cfl-more fa-solid fa-chevron-down interactable'; more.tabIndex = 0; more.title = '처음 · 끝 대화 보기';
        (block.querySelector('.select_chat_actions') || block).after(more);
        const check = document.createElement('input');
        check.type = 'checkbox'; check.className = 'etk-cfl-check'; check.tabIndex = -1;
        row.prepend(check);
    }
    line.innerHTML = `${current ? '<b class="etk-cfl-now">지금</b>' : ''}<span>${esc(infoText(s, file, current))}</span>`;
    const mes = block.querySelector('.select_chat_block_mes');
    if (mes) {
        const it = info.get(file), full = it?.full;
        if (it?.cut) fillCut(row, s, file, it);
        // 화면에 보일 글이 없는 답(태그 · 생각 글뿐)이면 빈 줄 — 원문을 보이면 태그가 그대로 나왔음
        if (typeof full === 'string') { if (mes.textContent !== full) mes.textContent = full; }
        else if (mes.textContent.startsWith('...')) mes.textContent = mes.textContent.slice(3).trimStart();   // 앞 토막 표시는 빼고 보이는 글부터
    }
    const check = row.querySelector(':scope > .etk-cfl-check');
    check.checked = picked.has(file); check.disabled = current;
    row.classList.toggle('etk-cfl-picked', picked.has(file));
    row.classList.toggle('etk-cfl-current', current);
    row.classList.toggle('etk-cfl-open', opened.has(file));
    if (opened.has(file) && !block.querySelector(':scope > .etk-cfl-peek')) openPeek(row, s);
}

function sortRows() {
    const how = opts().sort;
    // 최근 대화순은 실리태번 순서 그대로(마지막 메시지 시각) → 분기 채팅(만든 시각이 더 늦음)이 있을 때만 다시 줄 세움
    if (how === 'recent' && ![...info.values()].some(d => d.born)) return;
    const by = {
        recent: (a, b) => lastAt(info.get(b)) - lastAt(info.get(a)),
        oldest: (a, b) => lastAt(info.get(a)) - lastAt(info.get(b)),
        count: (a, b) => (info.get(b)?.count || 0) - (info.get(a)?.count || 0),
        name: (a, b) => a.localeCompare(b, undefined, { numeric: true }),
    }[how];
    const sorted = rows().sort((a, b) => by(fileOf(a), fileOf(b)));
    list().append(...sorted);
}

function barHtml() {
    if (selecting) return `<span class="etk-cfl-count">${picked.size}개 선택</span><span class="etk-cfl-gap"></span><div class="menu_button etk-cfl-all">전체 선택</div><div class="menu_button etk-cfl-done">끝내기</div>`;
    return `<select class="etk-cfl-sort text_pole" title="정렬">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${opts().sort === k ? ' selected' : ''}>${v}</option>`).join('')}</select><span class="etk-cfl-gap"></span><div class="menu_button etk-cfl-pick" title="여러 개 골라 내보내거나 지우기">선택</div>`;
}
function footHtml() {
    const total = [...picked].reduce((n, f) => n + (info.get(f)?.count || 0), 0);
    return `<span class="etk-cfl-count">메시지 ${total}개</span><span class="etk-cfl-gap"></span><div class="menu_button etk-cfl-export${picked.size ? '' : ' disabled'}"><i class="fa-solid fa-file-export"></i> 내보내기</div><div class="menu_button etk-cfl-delete${picked.size ? '' : ' disabled'}"><i class="fa-solid fa-trash-can"></i> 지우기</div>`;
}
function paintBars() {
    const p = popup(), l = list();
    if (!p || !l) return;
    let bar = p.querySelector(':scope > .etk-cfl-bar'), foot = p.querySelector(':scope > .etk-cfl-foot');
    if (!bar) { bar = document.createElement('div'); bar.className = 'etk-cfl-bar'; l.before(bar); bar.addEventListener('click', onBarClick); bar.addEventListener('change', onSortChange); }
    if (!foot) { foot = document.createElement('div'); foot.className = 'etk-cfl-foot'; l.after(foot); foot.addEventListener('click', onBarClick); }
    bar.innerHTML = barHtml();
    foot.innerHTML = footHtml();
    foot.hidden = !selecting;
    l.classList.toggle('etk-cfl-selecting', selecting);
}

// 다른 쪽이 이미 줄에 체크칸을 넣어 두었으면(같은 '여러 개 고르기') 우리 '선택'은 쉼
const otherChecks = () => !!list()?.querySelector('.select_chat_block_wrapper input[type="checkbox"]:not(.etk-cfl-check)');

let painting = false;
function decorate() {
    const l = list(), s = scope();
    if (!l || !s || painting) return;
    painting = true;
    observer?.disconnect();
    try {
        const names = new Set(rows().map(fileOf));
        for (const f of [...picked]) if (!names.has(f)) picked.delete(f);
        l.classList.add('etk-cfl');
        sortRows();
        for (const row of rows()) decorateRow(row, s);
        paintBars();
        const taken = otherChecks();
        popup()?.classList.toggle('etk-cfl-no-pick', taken);
        if (taken) api.rest('part', { saw: '채팅 줄에 다른 쪽이 넣은 체크칸이 이미 있어서, 여러 개 고르기만 그쪽에 맡겼어요', who: { kind: 'unknown' }, back: '그쪽을 끄면 다음에 창을 열 때 breeze가 맡아요.' });
        else if (rows().length) api.rest(null);
    } finally {
        observer?.observe(l, { childList: true });
        painting = false;
    }
}

async function fillCut(row, s, file, it) {
    it.cut = false;
    try {
        // 마지막 글의 보일 글만 받음(스와이프 기록까지 받으면 한 번에 MB 단위였음)
        const res = await post('/api/plugins/breeze-server/chat-peek', { group: !!s.group, avatar_url: s.avatar, file, lastOnly: true });
        if (!res.ok) return;
        const p = await res.json();
        if (!p.last || typeof p.last.text !== 'string') return;
        it.full = toScreen(p.last.text, s.avatar || null, !!p.last.is_user, p.last.preset || '').slice(0, 1500);
        if (row.isConnected) decorateRow(row, s);
    } catch { /* 빈 줄 그대로 */ }
}

// ── 펼쳐 보기
const clip = (t) => { const s = String(t || '').trim(); return s.length > 90 ? `${s.slice(0, 90)}…` : s; };
async function peekData(s, file) {
    const key = `${scopeKey(s)}|${file}|${info.get(file)?.last ?? ''}`;
    if (peeks.has(key)) return peeks.get(key);
    // 서버 플러그인이 있으면 처음 · 끝 두 마디만 받음(큰 채팅을 통째로 받아 읽으면 펼칠 때 화면이 멈춤), 없으면 통째로
    const isMsg = (m) => m && typeof m.mes === 'string' && !('chat_metadata' in m);
    let chat = null, msgs, total;
    try {
        const res = await post('/api/plugins/breeze-server/chat-peek', { group: !!s.group, avatar_url: s.avatar, file });
        if (res.ok) {
            const p = await res.json();
            if (Array.isArray(p.all)) chat = p.all;
            else if (Array.isArray(p.head) && Array.isArray(p.tail)) {
                const head = p.head.filter(isMsg), tail = p.tail.filter(isMsg);
                total = Math.max(info.get(file)?.count ?? 0, head.length + tail.length);
                msgs = total <= head.length ? head : [...head.slice(0, 2), ...tail.slice(-2)];
                if (total > 4 && msgs.length === 4) msgs.total = total;
                chat = [p.head[0]];
            }
        }
    } catch { /* 플러그인 없음 */ }
    if (!msgs) { chat ??= await readChat(s, file); msgs = chat.filter(isMsg); }
    const first = stampOf(msgs[0]?.send_date) || stampOf(chat?.[0]?.create_date);
    if (first) rememberStart(`${scopeKey(s)}|${file}`, first);
    const count = msgs.total || msgs.length;
    const show = count <= 4 ? msgs.map((m, i) => [m, i < Math.ceil(msgs.length / 2) ? '처음' : '끝']) : [[msgs[0], '처음'], [msgs[1], '처음'], [msgs.at(-2), '끝'], [msgs.at(-1), '끝']];
    const lines = show.map(([m, where]) => ({
        where, name: m.name || '',
        // 번역문이 있으면 번역문(실리태번이 화면에 원문 대신 보여 주는 칸), 그다음 화면 표시용 정규식
        text: clip(toScreen(typeof m.extra?.display_text === 'string' && m.extra.display_text ? m.extra.display_text : m.mes, s.avatar || null, !!m.is_user, m.extra?.regex_preset || '')),
    }));
    const data = { lines, total: count };
    peeks.set(key, data);
    if (peeks.size > 40) peeks.delete(peeks.keys().next().value);
    return data;
}
async function openPeek(row, s) {
    const block = row.querySelector('.select_chat_block'), file = fileOf(row);
    let box = block.querySelector(':scope > .etk-cfl-peek');
    if (!box) { box = document.createElement('div'); box.className = 'etk-cfl-peek'; block.append(box); }
    box.innerHTML = '<div class="etk-cfl-wait">불러오는 중…</div>';
    let body;
    try {
        const d = await peekData(s, file);
        // '처음' · '끝'은 묶음 제목으로 한 번씩(줄마다 붙이면 '처음 처음 끝 끝'으로 되풀이돼 어수선했음), 줄에는 말한 사람만
        const line = (x) => `<div class="etk-cfl-line"><small>${esc(x.name)}</small><span>${esc(x.text) || '<i>(보이는 글 없음)</i>'}</span></div>`;
        const head = d.lines.filter(x => x.where === '처음'), tail = d.lines.filter(x => x.where === '끝');
        body = !d.total ? '<div class="etk-cfl-wait">메시지가 없어요</div>'
            : d.total <= 4 ? d.lines.map(line).join('')
                : `<div class="etk-cfl-sec">처음</div>${head.map(line).join('')}<div class="etk-cfl-sec">끝</div>${tail.map(line).join('')}`;
    } catch (e) { body = `<div class="etk-cfl-wait">${esc(e.message || '채팅을 못 읽었어요')}</div>`; }
    if (!box.isConnected) return;
    const current = isCurrent(row);
    box.innerHTML = `<div class="etk-cfl-lines">${body}</div><div class="etk-cfl-acts">
        ${current ? '' : '<span class="interactable" tabindex="0" data-act="open"><i class="fa-solid fa-arrow-right"></i> 열기</span>'}
        <span class="interactable" tabindex="0" data-act="rename"><i class="fa-solid fa-pencil"></i> 이름</span>
        <span class="interactable" tabindex="0" data-act="jsonl"><i class="fa-solid fa-file-export"></i> 내보내기</span>
        <span class="interactable" tabindex="0" data-act="txt"><i class="fa-solid fa-file-lines"></i> 글 파일로</span>
        ${current ? '' : '<span class="interactable etk-cfl-danger" tabindex="0" data-act="delete"><i class="fa-solid fa-trash-can"></i> 지우기</span>'}</div>`;
    const span = row.querySelector('.etk-cfl-info span');
    if (span) span.textContent = infoText(s, file, current);   // 방금 알게 된 시작 날짜
}

// ── 누르기
function onListClick(e) {
    const row = e.target.closest?.('.select_chat_block_wrapper');
    if (!row || !list().contains(row)) return;
    const file = fileOf(row), s = scope();
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (selecting) {
        stop();
        if (isCurrent(row)) { toastr.info('지금 열린 채팅은 고를 수 없어요.'); return; }
        if (picked.has(file)) picked.delete(file); else picked.add(file);
        row.querySelector(':scope > .etk-cfl-check').checked = picked.has(file);
        row.classList.toggle('etk-cfl-picked', picked.has(file));
        paintBars();
        return;
    }
    if (e.target.closest('.etk-cfl-more')) {
        stop();
        if (opened.has(file)) { opened.delete(file); row.classList.remove('etk-cfl-open'); row.querySelector('.etk-cfl-peek')?.remove(); }
        else { opened.add(file); row.classList.add('etk-cfl-open'); openPeek(row, s); }
        return;
    }
    const act = e.target.closest('.etk-cfl-acts [data-act]')?.dataset.act;
    if (act) {
        stop();
        const press = (sel) => row.querySelector(sel)?.click();
        if (act === 'open') { opened.delete(file); row.querySelector('.etk-cfl-peek')?.remove(); row.querySelector('.select_chat_block').click(); }
        else if (act === 'rename') press('.renameChatButton');
        else if (act === 'jsonl') press('.exportRawChatButton');
        else if (act === 'txt') press('.exportChatButton');
        else if (act === 'delete') removeChats([file]);
        return;
    }
    if (e.target.closest('.etk-cfl-peek')) stop();   // 펼친 글을 눌러도 채팅이 열리지 않게(글 고르기 · 복사)
}
function onListKey(e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.etk-cfl-more, .etk-cfl-acts [data-act]')) { e.preventDefault(); e.target.click(); }
}
function onSortChange(e) {
    if (!e.target.matches('.etk-cfl-sort')) return;
    opts().sort = e.target.value; api.save();
    // 최근 대화순은 실리태번이 그린 순서라 다시 그리게 함
    if (opts().sort === 'recent') refresh(); else decorate();
}
function onBarClick(e) {
    const hit = (c) => e.target.closest(`.${c}`);
    if (hit('etk-cfl-pick')) { selecting = true; opened.clear(); list().querySelectorAll('.etk-cfl-peek').forEach(x => x.remove()); decorate(); }
    else if (hit('etk-cfl-done')) { selecting = false; picked.clear(); decorate(); }
    else if (hit('etk-cfl-all')) {
        const can = rows().filter(r => !isCurrent(r)).map(fileOf);
        if (can.every(f => picked.has(f))) picked.clear(); else can.forEach(f => picked.add(f));
        decorate();
    } else if (hit('etk-cfl-export') && picked.size) exportChats([...picked]);
    else if (hit('etk-cfl-delete') && picked.size) removeChats([...picked]);
}

async function refresh() {
    try { const { displayPastChats } = await import('/script.js'); await displayPastChats(); } catch (e) { console.warn('[Breeze] 채팅 목록 다시 그리기', e); }
}

// ── 내보내기: 하나면 그 파일, 여럿이면 zip 하나
function download(blob, name) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
async function exportChats(files) {
    const s = scope(); if (!s) return;
    const got = [];
    for (const file of files) {
        try {
            const res = await post('/api/chats/export', { is_group: !!s.group, avatar_url: s.avatar, file: `${file}.jsonl`, exportfilename: `${file}.jsonl`, format: 'jsonl' });
            const data = await res.json();
            if (res.ok && typeof data.result === 'string') got.push([`${file}.jsonl`, data.result]);
        } catch (e) { console.warn('[Breeze] 채팅 내보내기', file, e); }
    }
    if (!got.length) { toastr.error('내보내지 못했어요.'); return; }
    if (got.length === 1) download(new Blob([got[0][1]], { type: 'application/octet-stream' }), got[0][0]);
    else {
        if (!window.JSZip) await import('/lib/jszip.min.js');
        const zip = new window.JSZip();
        for (const [name, text] of got) zip.file(name, text);
        download(await zip.generateAsync({ type: 'blob' }), `${s.name || '채팅'} 채팅 ${got.length}개.zip`);
    }
    if (got.length < files.length) toastr.warning(`${files.length - got.length}개는 내보내지 못했어요.`);
}

// ── 지우기(보관 → 지움) · 되돌리기
const trashPath = (name) => `user/files/${name}`;
async function dropTrashFile(name) { try { await post('/api/files/delete', { path: trashPath(name) }); } catch { /* 이미 없음 */ } }

async function deleteOne(s, file) {
    if (s.group) {
        const mod = await import('/scripts/group-chats.js');
        const group = mod.groups.find(g => g.id == s.group);
        if (typeof mod.deleteGroupChatByName === 'function') { await mod.deleteGroupChatByName(group.id, file); return !group.chats.includes(file); }
        const res = await post('/api/chats/group/delete', { id: file });
        if (!res.ok) return false;
        group.chats.splice(group.chats.indexOf(file), 1);
        await mod.editGroup(group.id, true, false);
        return true;
    }
    const res = await post('/api/chats/delete', { chatfile: `${file}.jsonl`, avatar_url: s.avatar });
    if (res.ok) await ctx().eventSource.emit(ctx().eventTypes.CHAT_DELETED, file);
    return res.ok;
}

async function removeChats(files) {
    const s = scope(); if (!s || !files.length) return;
    const c = ctx();
    const days = keepDays();
    const note = days ? `지운 채팅은 ${days}일 동안 따로 보관돼요. 그 안에는 breeze 설정의 이 기능 세부 설정에서 되돌릴 수 있어요.` : '보관하지 않게 해 두어서, 지우면 되돌릴 수 없어요.';
    const html = `<h3>채팅 ${files.length}개를 지울까요?</h3><div class="etk-cfl-confirm">${files.map(f => `<div>${esc(f)} <small>${info.get(f) ? `메시지 ${info.get(f).count}개` : ''}</small></div>`).join('')}</div><small>${note}</small>`;
    const ok = await c.callGenericPopup(html, c.POPUP_TYPE.CONFIRM, '', { okButton: '지우기', cancelButton: '취소' });
    if (ok !== c.POPUP_RESULT.AFFIRMATIVE) return;
    const id = Date.now(), items = [], failed = [];
    for (const [i, file] of files.entries()) {
        try {
            if (!days) { if (await deleteOne(s, file)) items.push({ file }); else failed.push(file); continue; }
            const chat = await readChat(s, file);
            const name = `breeze-trash-${id}-${i}.json`;
            await saveUserFile(name, JSON.stringify({ scope: s, file, chat }));
            if (await deleteOne(s, file)) items.push({ file, store: name, count: info.get(file)?.count ?? Math.max(0, chat.length - 1) });
            else { failed.push(file); await dropTrashFile(name); }
        } catch (e) { console.warn('[Breeze] 채팅 지우기', file, e); failed.push(file); }
    }
    if (items.length && days) { opts().trash.push({ id, at: id, until: id + days * 86400000, scope: s, items }); api.save(); }
    picked.clear(); selecting = false; files.forEach(f => opened.delete(f));
    if (list()?.isConnected && document.getElementById('shadow_select_chat_popup')?.style.display !== 'none') await refresh();
    if (failed.length) toastr.error(`${failed.length}개는 지우지 못해서 그대로 뒀어요: ${failed.join(', ')}`);
    if (items.length && days) toastr.info('여기를 누르면 되돌려요.', `채팅 ${items.length}개를 지웠어요`, { timeOut: 12000, extendedTimeOut: 6000, onclick: () => restore(id) });
    else if (items.length) toastr.info(`채팅 ${items.length}개를 지웠어요`);
}

async function existingNames(s) {
    try { const res = await post('/api/chats/search', { query: '', avatar_url: s.group ? null : s.avatar, group_id: s.group || null }); return new Set((await res.json()).map(x => x.file_name)); } catch { return new Set(); }
}
async function restore(id) {
    const batch = opts().trash.find(b => b.id === id);
    if (!batch) return;
    const s = batch.scope, c = ctx();
    const groupMod = s.group ? await import('/scripts/group-chats.js') : null;
    const group = groupMod?.groups.find(g => g.id == s.group);
    if (s.group ? !group : !c.characters.some(x => x.avatar === s.avatar)) { toastr.error(`${s.name || '그 캐릭터'}이(가) 지금 없어서 되돌릴 수 없어요.`); return; }
    const taken = await existingNames(s), left = [];
    let done = 0;
    for (const it of batch.items) {
        try {
            const res = await fetch(`/${trashPath(it.store)}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`보관 파일이 없어요 (${res.status})`);
            const { chat } = await res.json();
            let name = it.file;
            while (taken.has(name)) name += ' (되돌림)';
            const save = s.group ? await post('/api/chats/group/save', { id: name, chat, force: true }) : await post('/api/chats/save', { ch_name: s.name, file_name: name, chat, avatar_url: s.avatar, force: true });
            if (!save.ok) throw new Error(`저장 실패 (${save.status})`);
            if (group && !group.chats.includes(name)) { group.chats.push(name); await groupMod.editGroup(group.id, true, false); }
            taken.add(name); done++;
            await dropTrashFile(it.store);
        } catch (e) { console.warn('[Breeze] 채팅 되돌리기', it.file, e); left.push(it); }
    }
    const o = opts();
    if (left.length) batch.items = left; else o.trash = o.trash.filter(b => b.id !== id);
    api.save();
    if (done) toastr.success(`채팅 ${done}개를 되돌렸어요.`);
    if (left.length) toastr.error(`${left.length}개는 되돌리지 못했어요.`);
    if (document.getElementById('shadow_select_chat_popup')?.style.display !== 'none' && scopeKey(scope()) === scopeKey(s)) await refresh();
    redrawOptions?.();
}
async function emptyBatch(id) {
    const o = opts(), batch = o.trash.find(b => b.id === id);
    if (!batch) return;
    for (const it of batch.items) await dropTrashFile(it.store);
    o.trash = o.trash.filter(b => b.id !== id);
    api.save();
}
async function purgeOld() {
    const now = Date.now();
    for (const b of opts().trash.filter(x => untilOf(x) < now)) await emptyBatch(b.id);
}

// ── 목록 자료 받기(응답은 그대로 돌려줌)
function watchSearch() {
    if (wrapped) return;
    orig = window.fetch;
    wrapped = function (input, init) {
        const p = orig.apply(this, arguments);
        const url = typeof input === 'string' ? input : input?.url || '';
        if (!on || url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] !== '/api/chats/search') return p;
        p.then(res => (res.ok ? res.clone().json() : null)).then(data => {
            if (!Array.isArray(data)) return;
            const s = scope();
            info = new Map(data.filter(x => x?.file_name).map(x => {
                // 실리태번 미리보기는 마지막 글의 끝 400자에 '...'를 붙인 것 → 두 줄만 보이면 글 중간 토막이 됨. 서버 플러그인이 준 전체 글(번역문 먼저)이 있으면 처음부터
                const src = x.preview_head || (x.display_mes || x.preview_source || String(x.preview_message || '').replace(/^\.\.\./, ''));
                let full = null;
                if (typeof src === 'string' && src) { try { full = toScreen(src, s?.avatar || null, !!x.mes_is_user, x.mes_preset || ''); } catch { full = null; } }
                // 답이 긴 생각 글로 시작하면 앞 조각이 통째로 숨겨져 빈 줄 → 서버가 함께 준 '그 덩어리 뒤' 조각으로. 그것도 비면(숨기는 덩어리가 연달아 길 때) 그 채팅만 마지막 글을 따로 받음
                if (full === '' && typeof x.preview_after === 'string' && x.preview_after) { try { full = toScreen(x.preview_after, s?.avatar || null, !!x.mes_is_user, x.mes_preset || ''); } catch { /* 빈 줄 */ } }
                const cut = full === '' && !!x.preview_head && x.preview_head !== x.preview_tail;
                return [x.file_name, { count: x.message_count ?? 0, last: x.last_mes, size: x.file_size || '', full, cut, first: x.first_date ? stampOf(x.first_date) : 0, born: Number(x.branch_born) || 0 }];
            }));
            requestAnimationFrame(decorate);
        }).catch(() => {});
        return p;
    };
    window.fetch = wrapped;
}

export function start(a) {
    api = a; on = true;
    globalThis[Symbol.for('breeze.chatFileList')] = true;
    const l = list();
    if (!l) return;
    watchSearch();
    l.addEventListener('click', onListClick, true);
    l.addEventListener('keydown', onListKey);
    observer = new MutationObserver(() => requestAnimationFrame(decorate));
    observer.observe(l, { childList: true });
    // 창을 닫으면 고르기 · 펼침을 처음으로
    const shade = document.getElementById('shadow_select_chat_popup');
    closeWatch = new MutationObserver(() => { if (shade.style.display === 'none' && (selecting || picked.size || opened.size)) { selecting = false; picked.clear(); opened.clear(); } });
    if (shade) closeWatch.observe(shade, { attributes: true, attributeFilter: ['style'] });
    purgeOld().catch(e => console.warn('[Breeze] 보관함 비우기', e));
    if (l.firstElementChild) refresh();
}

// 다른 확장이 그 뒤에 fetch 를 또 감쌌으면 우리 것만 빼낼 수 없어, 그땐 감싼 채로 두고 그냥 지나가게 한다
export function stop() {
    on = false;
    delete globalThis[Symbol.for('breeze.chatFileList')];
    if (window.fetch === wrapped) { window.fetch = orig; wrapped = null; }
    observer?.disconnect(); observer = null;
    closeWatch?.disconnect(); closeWatch = null;
    const l = list();
    if (!l) return;
    l.removeEventListener('click', onListClick, true);
    l.removeEventListener('keydown', onListKey);
    l.classList.remove('etk-cfl', 'etk-cfl-selecting');
    l.querySelectorAll('.etk-cfl-info, .etk-cfl-more, .etk-cfl-check, .etk-cfl-peek').forEach(x => x.remove());
    l.querySelectorAll('.etk-cfl-open, .etk-cfl-current').forEach(x => x.classList.remove('etk-cfl-open', 'etk-cfl-current'));
    popup()?.querySelectorAll(':scope > .etk-cfl-bar, :scope > .etk-cfl-foot').forEach(x => x.remove());
    popup()?.classList.remove('etk-cfl-no-pick');
    selecting = false; picked.clear(); opened.clear();
    if (opts().sort !== 'recent' && l.firstElementChild) refresh();
}

// 세부 설정: 지운 채팅 보관함
let redrawOptions = null;
export function options(box, a) {
    api ??= a;
    const render = () => {
        if (!box.isConnected) { redrawOptions = null; return; }
        const trash = opts().trash;
        const day = (t) => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
        const left = (b) => Math.max(0, Math.ceil((untilOf(b) - Date.now()) / 86400000));
        const days = keepDays();
        box.innerHTML = `<div class="etk-sub">지운 채팅 보관</div>
            <label class="etk-flex etk-cfl-keep">지운 채팅을 <select class="text_pole">${KEEP_CHOICES.map(v => `<option value="${v}"${v === days ? ' selected' : ''}>${v ? `${v}일 동안 보관` : '보관하지 않기'}</option>`).join('')}</select></label>
            <small>${days ? '지우기 전에 채팅 파일을 통째로 실리태번 사용자 파일 폴더(user/files)에 복사해 두고, 그동안은 아래에서 되돌릴 수 있어요. 날짜가 지나면 실리태번을 켤 때 그 복사본을 지워요.' : '지우면 바로 없어지고 되돌릴 수 없어요.'}</small>
            <div class="etk-sub">보관함</div><small>되돌리면 원래 캐릭터의 채팅 목록으로 같은 이름으로 돌아가요(같은 이름이 있으면 뒤에 '(되돌림)').</small>
            <div class="etk-cfl-trash">${trash.length ? trash.slice().reverse().map(b => `<div class="etk-cfl-batch" data-id="${b.id}">
                <div class="etk-cfl-batch-head"><b>${esc(b.scope?.name || '')}</b><small>${day(b.at)} · ${left(b)}일 남음</small></div>
                <div class="etk-cfl-batch-names">${b.items.map(it => `<div>${esc(it.file)} <small>메시지 ${it.count}개</small></div>`).join('')}</div>
                <div class="etk-flex"><div class="menu_button etk-cfl-restore"><i class="fa-solid fa-rotate-left"></i> 되돌리기</div><div class="menu_button etk-cfl-empty"><i class="fa-solid fa-trash-can"></i> 지금 비우기</div></div>
            </div>`).join('') : '<div class="etk-empty-line">비어 있어요</div>'}</div>`;
    };
    redrawOptions = render;
    box.onchange = (e) => {
        if (!e.target.closest('.etk-cfl-keep')) return;
        opts().keepDays = Number(e.target.value); api.save(); render();
    };
    box.onclick = async (e) => {
        const id = Number(e.target.closest('.etk-cfl-batch')?.dataset.id);
        if (!id) return;
        if (e.target.closest('.etk-cfl-restore')) await restore(id);
        else if (e.target.closest('.etk-cfl-empty')) {
            const c = ctx();
            const ok = await c.callGenericPopup('<h3>보관한 채팅을 비울까요?</h3><small>비우면 되돌릴 수 없어요.</small>', c.POPUP_TYPE.CONFIRM, '', { okButton: '비우기', cancelButton: '취소' });
            if (ok === c.POPUP_RESULT.AFFIRMATIVE) await emptyBatch(id);
        }
        render();
    };
    render();
}
