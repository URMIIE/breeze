// 답에 들어간 월드인포를 채팅에서 바로 보기.
// 어떤 항목이 이번 답에 들어갔는지 보려면 월드인포 창을 열어 찾아야 했다 → 답마다 이름 줄(시각 옆)에 '월드인포 n' 표시, 누르면 이번에 들어간 항목 목록.
// 실리태번이 프롬프트를 만들 때 내는 신호(world_info_activated: 들어간 항목 전부)를 받아 두었다가, 그 생성으로 붙는 답(message_received)에 적는다
// (메시지 extra.breeze_wi, 지금 스와이프 기록에도 → 스와이프를 넘겨도 그 답의 것). 미리 보기 계산(dry run)은 신호가 안 와서 섞이지 않음.
// 목록의 항목을 누르면 실리태번 편집 칸에서 그 항목을 엶. 손가락 기기도 누르기만으로 됨(마우스 올리기 없음).
import { openInEditor } from './worldinfo_library.js';
import { itemizedPrompts } from '../../../../itemized-prompts.js';
import { getSortedEntries } from '../../../../world-info.js';

// 예전 답(이 기능을 켜기 전에 만든 답): 실리태번이 이 기기 브라우저에 남긴 프롬프트 내역(그 답을 만들 때 보낸 프롬프트 전체)에
// 지금 이 채팅에 걸린 월드인포 항목의 내용이 들어 있는지 대조해 찾음. 찾은 것은 r: 1 로 표시(새 답의 기록과 구분).
// 매크로({{char}} 등)는 지금 값으로 바꿔서 대조하고, 내용 전체(띄어쓰기 · 줄바꿈만 맞춰서)가 그대로 들어 있어야 들어간 것으로 봄.
// (앞 · 뒤 60자만 따로 찾았더니 첫머리와 끝이 같은 항목들(상태창 A · B · C 같은)이 하나만 들어가도 전부 들어간 것으로 잡혔음)
// 이 기기에서 만든 답 · 내역이 남은 답만. 예전 방식으로 찾아 둔 목록(rv 없음)은 다시 찾음.
// 화면에 그려진 답만, 한가할 때 하나씩(긴 채팅에서 한꺼번에 하면 멈춤)
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
function promptText(set) {
    const raw = set?.rawPrompt;
    const body = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map(m => (typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map(p => p?.text || '').join(' ') : '')).join('\n') : '';
    return norm(`${body}\n${set?.worldInfoString || ''}`);
}
let restoreQueue = [], restoring = false, candidates = null;
async function restoreOld() {
    if (restoring) return;
    restoring = true;
    try {
        candidates ??= (await getSortedEntries()).filter(e => String(e.content || '').trim()).map(e => {
            let t = e.content; try { t = api.ctx().substituteParams(t); } catch { /* 매크로 그대로 */ }
            t = norm(t);
            return { w: e.world, u: e.uid, c: !!e.constant, t: String(e.comment || (e.key || []).join(', ') || '(제목 없음)').normalize('NFC'), full: t };
        });
        while (restoreQueue.length) {
            const id = restoreQueue.shift();
            const msg = api.ctx().chat?.[id];
            const had = msg?.extra?.[KEY];
            const oldGuess = Array.isArray(had) && had.length && had.every(x => x.r && x.rv !== RV);
            if (!msg || msg.is_user || msg.is_system || (Array.isArray(had) && !oldGuess)) continue;
            // 대조할 기록이 없으면 예전 방식으로 찾아 둔 목록은 맞는지 알 수 없어서 지움
            const drop = () => { if (!oldGuess) return; delete msg.extra[KEY]; const sw = msg.swipe_info?.[msg.swipe_id]; if (sw?.extra) delete sw.extra[KEY]; const el = document.querySelector(`#chat > .mes[mesid="${id}"]`); if (el) paint(el); };
            const set = [...(itemizedPrompts || [])].reverse().find(x => x?.mesId === id);
            if (!set) { drop(); continue; }
            const text = promptText(set);
            if (!text) { drop(); continue; }
            const found = candidates.filter(c => c.full && text.includes(c.full)).map(({ w, u, c, t }) => ({ w, u, c, t, r: 1, rv: RV }));
            if (!found.length) { drop(); continue; }
            msg.extra ??= {};
            msg.extra[KEY] = found;
            const el = document.querySelector(`#chat > .mes[mesid="${id}"]`); if (el) paint(el);
            await new Promise(r => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 300 }) : setTimeout(r, 30)));
        }
    } catch (e) { console.warn('[Breeze] 예전 답 월드인포 찾기', e); }
    finally { restoring = false; }
}
function queueOld() {
    restoreQueue = [...document.querySelectorAll('#chat > .mes')].map(m => Number(m.getAttribute('mesid'))).filter(Number.isInteger).reverse();
    restoreOld();
}

const KEY = 'breeze_wi';
const RV = 2;   // 예전 답 찾기 방식 판(바꾸면 예전 방식으로 찾아 둔 목록을 다시 찾음)
let api = null, pending = null, offs = [], observer = null;
const ctx = () => api.ctx();
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function paint(mesEl) {
    const id = Number(mesEl?.getAttribute('mesid'));
    const msg = ctx().chat?.[id];
    mesEl.querySelector('.etk-wif-chip')?.remove();
    if (pop && mesEl.contains(pop.chip)) closeList();   // 스와이프 · 다시 그리면 그 답의 목록이 아니라서 닫음
    const list = msg?.extra?.[KEY];
    if (!Array.isArray(list) || !list.length || msg.is_user || msg.is_system) return;
    const chip = document.createElement('span');
    chip.className = 'etk-wif-chip interactable';
    chip.tabIndex = 0;
    chip.textContent = `월드인포 ${list.length}`;
    // 실리태번은 시간 바로 뒤에 모델 아이콘(사용자 지정 연결이면 물음표 그림)을 두고, 다시 그릴 때 '시간 바로 뒤'에서 그 아이콘을 찾아 바꿈
    // → 표시를 시간과 아이콘 사이에 넣으면 아이콘이 표시 뒤로 밀려 표시에 붙은 물음표처럼 보이고, 다시 그릴 때 아이콘이 하나 더 생김. 그래서 아이콘 뒤에
    const at = mesEl.querySelector('.ch_name .timestamp + .timestamp-icon') || mesEl.querySelector('.ch_name .timestamp') || mesEl.querySelector('.ch_name .name_text');
    at?.after(chip);
}
const paintAll = () => document.querySelectorAll('#chat > .mes').forEach(paint);

// 목록은 큰 창 대신 표시 옆에 작게 펼침(가운데 창은 채팅을 가리고 컸고, 아래로 펼치면 메시지가 밀렸음). 옆에 자리가 없으면(휴대폰) 표시 바로 아래에 겹쳐서.
// 표시를 다시 누르거나 · 바깥을 누르거나 · Esc · 채팅을 굴리면 닫힘
let pop = null;
function closeList() {
    if (!pop) return;
    pop.chip?.classList.remove('etk-on');
    pop.el.remove(); pop = null;
    document.removeEventListener('pointerdown', onOutside, true); document.removeEventListener('keydown', onEsc, true);
    document.getElementById('chat')?.removeEventListener('scroll', closeList);
}
const onOutside = (e) => { if (pop && !pop.el.contains(e.target) && e.target !== pop.chip) closeList(); };
const onEsc = (e) => { if (e.key === 'Escape' && pop) { e.stopPropagation(); closeList(); } };
function showList(id, chip) {
    const list = ctx().chat?.[id]?.extra?.[KEY];
    if (!Array.isArray(list) || !chip) return;
    const same = pop?.chip === chip;
    closeList();
    if (same) return;
    const byBook = new Map();
    for (const it of list) { if (!byBook.has(it.w)) byBook.set(it.w, []); byBook.get(it.w).push(it); }
    const el = document.createElement('div');
    el.className = 'etk-wif-pop';
    el.innerHTML = [...byBook].map(([w, items]) => `<div class="etk-wif-book">${esc(w)}</div>`   /* 하나뿐이어도 어느 월드인포인지 보이게 */
        + items.map(it => `<div class="etk-wif-item interactable" tabindex="0" title="월드인포 창에서 열기" data-w="${esc(w)}" data-u="${it.u}"><span class="etk-wif-dot ${it.c ? 'etk-const' : 'etk-key'}"></span><span>${esc(it.t)}</span></div>`).join('')).join('')
        + (list.some(x => x.r) ? '<small class="etk-wif-note">예전 답이라 남은 기록에서 찾았어요. 빠진 게 있을 수 있어요.</small>' : '');
    el.addEventListener('click', (e) => { const it = e.target.closest('.etk-wif-item'); if (it) { closeList(); openInEditor(it.dataset.w, Number(it.dataset.u)); } });
    // 테마 바탕색이 반투명이면 뒤 글이 비쳐서 같은 색을 불투명하게
    const v = getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeBlurTintColor').trim().match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    if (v) el.style.setProperty('--wif-bg', `rgb(${v[1]}, ${v[2]}, ${v[3]})`);
    document.body.append(el);
    pop = { el, chip };
    chip.classList.add('etk-on');
    // 자리: 오른쪽 → 왼쪽 → 아래 → 위(화면 안으로)
    const c = chip.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, gap = 8, m = 8;
    let x, y;
    if (innerWidth - c.right - gap >= w + m) { x = c.right + gap; y = c.top - 6; }
    else if (c.left - gap >= w + m) { x = c.left - gap - w; y = c.top - 6; }
    else { x = c.left; y = innerHeight - c.bottom - 6 >= h + m || c.top < h + 6 + m ? c.bottom + 6 : c.top - 6 - h; }   // 옆에 자리가 없으면 아래, 아래도 모자라면 위(표시를 가리지 않게)
    el.style.left = `${Math.max(m, Math.min(x, innerWidth - w - m))}px`;
    el.style.top = `${Math.max(m, Math.min(y, innerHeight - h - m))}px`;
    document.addEventListener('pointerdown', onOutside, true); document.addEventListener('keydown', onEsc, true);
    document.getElementById('chat')?.addEventListener('scroll', closeList, { passive: true });
}

function onChatClick(e) {
    const chip = e.target.closest?.('.etk-wif-chip');
    if (!chip) return;
    e.preventDefault(); e.stopPropagation();
    showList(Number(chip.closest('.mes')?.getAttribute('mesid')), chip);
}

export function start(a) {
    api = a;
    const { eventSource, eventTypes } = ctx();
    const onStart = (_type, _o, dryRun) => { if (!dryRun) pending = null; };
    const onFire = (entries) => {
        pending = (entries || []).map(e => ({ w: e.world, u: e.uid, c: !!e.constant, t: String(e.comment || (e.key || []).join(', ') || '(제목 없음)').normalize('NFC') }));
    };
    const onReceived = (id) => {
        const msg = ctx().chat?.[id];
        if (!pending || !msg || msg.is_user || msg.is_system) return;
        msg.extra ??= {};
        msg.extra[KEY] = pending;
        const sw = msg.swipe_info?.[msg.swipe_id];
        if (sw) { sw.extra ??= {}; sw.extra[KEY] = pending; }
        pending = null;
        const el = document.querySelector(`#chat > .mes[mesid="${id}"]`); if (el) paint(el);
    };
    const onRendered = (id) => { const el = document.querySelector(`#chat > .mes[mesid="${id}"]`); if (el) paint(el); };
    const on = (n, fn) => { eventSource.on(n, fn); offs.push(() => eventSource.removeListener(n, fn)); };
    on(eventTypes.GENERATION_STARTED, onStart);
    on(eventTypes.WORLD_INFO_ACTIVATED, onFire);
    on(eventTypes.MESSAGE_RECEIVED, onReceived);
    on(eventTypes.CHARACTER_MESSAGE_RENDERED, onRendered);
    on(eventTypes.MESSAGE_SWIPED, onRendered);
    on(eventTypes.MESSAGE_UPDATED, onRendered);
    on(eventTypes.CHAT_CHANGED, () => { closeList(); candidates = null; restoreQueue = []; setTimeout(paintAll, 0); });
    if (eventTypes.ITEMIZED_PROMPTS_LOADED) on(eventTypes.ITEMIZED_PROMPTS_LOADED, () => setTimeout(queueOld, 300));
    document.getElementById('chat')?.addEventListener('click', onChatClick, true);
    // 옛 메시지를 더 불러오면(위로 굴림) 새로 붙은 메시지에도
    observer = new MutationObserver(ms => { let more = false; for (const m of ms) m.addedNodes.forEach(n => { if (n.nodeType === 1 && n.classList.contains('mes')) { paint(n); const id = Number(n.getAttribute('mesid')); if (Number.isInteger(id)) { restoreQueue.push(id); more = true; } } }); if (more) restoreOld(); });
    const chat = document.getElementById('chat'); if (chat) observer.observe(chat, { childList: true });
    paintAll();
    candidates = null;
    setTimeout(queueOld, 500);
}

export function stop() {
    offs.forEach(f => f()); offs = [];
    observer?.disconnect(); observer = null;
    document.getElementById('chat')?.removeEventListener('click', onChatClick, true);
    document.querySelectorAll('.etk-wif-chip').forEach(x => x.remove());
    closeList();
}
