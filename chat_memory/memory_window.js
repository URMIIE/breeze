// 이 채팅 기억: ⓘ 창(이 채팅이 기억하는 것을 보고 바로 고침).
import { promptManager } from '../../../../openai.js';
import { extension_settings } from '../../../../extensions.js';
import { world_names } from '../../../../world-info.js';
import { getScriptsByType, saveScriptsByType, SCRIPT_TYPES } from '../../../regex/engine.js';
import { LOG, ctx, toast, nfc, tr, settings, charKey, S } from './shared.js';
import { STORE, chatsOf, putMemory, memory, currentPreset } from './files.js';
import { kindList, kindsOf, kindPills, cardChar, cardFields, same, cardState, setCardText, keepUnsaved, applyCard, regexState, worldState, connectionState, applyConnection, connectionLabel, personaState, personaName, personaLabel, activeBooks, readEntries, refreshEntries, snapshot, applyToggles, applyWorld, applyEntries, applyRegex, rawKinds } from './kinds.js';
import { store, remember } from './remember.js';
import { makePick } from './pick.js';
import { renderBar } from './bar.js';

// ⓘ 창: 이 채팅이 기억하는 것을 보고 바로 고침: 여기서 바꾸면 지금 설정이 바뀌고 기억도 따라감 (따로 저장 버튼 없음)
export async function showMemory() {
    const mem = memory();
    const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    let kinds = kindsOf(mem);
    const root = document.createElement('div');
    root.className = 'cpm-info cpm-edit';
    let regexChanged = false;
    const addedAlts = [];   // 이 창에서 카드에 새로 남긴 판 [{ key, item }]: '취소'하면 지움
    const closed = new AbortController();   // 창이 닫히면 문서에 붙인 이벤트도 뗌
    // '취소'용: 창을 열 때의 실제 설정과 이 채팅의 기억
    const openChat = ctx().getCurrentChatId();
    const openMem = openChat && STORE.chats[openChat] ? structuredClone(STORE.chats[openChat]) : undefined;
    let openEntries = null;
    try { openEntries = await readEntries(); } catch (err) { console.warn(LOG, 'world info', err); }
    const before = { preset: currentPreset(), toggles: snapshot({ toggles: true }).toggles, world: worldState(), entries: openEntries, regex: regexState(), connection: connectionState(), card: cardState() };
    root.innerHTML = `
        <h3 class="cpm-edit-title">${e(tr`What this chat remembers`)}</h3>
        <p class="cpm-edit-sub">${e(tr`Changes apply right away. Cancel puts everything back as it was when you opened this.`)}</p>
        <div class="cpm-edit-top">
            <label class="cpm-switch"><input type="checkbox" role="switch" class="cpm-edit-on" ${mem?.off ? '' : 'checked'}><span class="cpm-track" aria-hidden="true"></span><span>${e(tr`Remember this chat`)}</span></label>
            <span class="cpm-kinds" role="group" aria-label="${e(tr`What to remember`)}">${kindPills(kinds, e)}</span>
        </div>
        <div class="cpm-sec" data-sec="toggles"></div>
        <div class="cpm-sec" data-sec="connection"></div>
        <div class="cpm-sec" data-sec="regex"></div>
        <div class="cpm-sec" data-sec="world"></div>
        <div class="cpm-sec" data-sec="persona"></div>
        <div class="cpm-sec" data-sec="card"></div>
        <div class="cpm-sec cpm-copy" data-sec="copy"></div>`;
    const sec = k => root.querySelector(`[data-sec="${k}"]`);
    // 칸을 다시 그려도 펼친 줄 · 목록 스크롤 · 창 스크롤은 그대로
    const keep = async (k, paint) => {
        const box = sec(k);
        const titleOf = d => d.querySelector(':scope > summary .cpm-g-title')?.textContent;
        const was = new Map([...box.querySelectorAll('details.cpm-group')].map(d => [titleOf(d), { open: d.open, top: d.querySelector('.cpm-checks')?.scrollTop ?? 0 }]));
        const pane = root.closest('.popup-content');
        const top = pane?.scrollTop;
        await paint();
        box.querySelectorAll('details.cpm-group').forEach(d => {
            const w = was.get(titleOf(d));
            if (!w) return;
            if (w.open) d.open = true;
            const ul = d.querySelector('.cpm-checks');
            if (ul) ul.scrollTop = w.top;
        });
        if (pane && top != null) pane.scrollTop = top;
    };
    const search = (box, rows) => {
        const inp = box.querySelector('.cpm-search');
        inp?.addEventListener('input', () => { const q = inp.value.trim().toLowerCase(); rows().forEach(li => { li.hidden = !!q && !li.textContent.toLowerCase().includes(q); }); });
    };
    // 칸마다 같은 꼴: 접는 줄(제목: 개수) 안에 검색 + 체크 목록
    const group = (title, count, list, attrs = '') => `<details class="cpm-group"><summary><span class="cpm-g-title">${e(title)}</span><span class="cpm-count">${e(count)}</span></summary><input type="search" class="text_pole cpm-search" placeholder="${e(tr`Search`)}"><ul class="cpm-checks" ${attrs}>${list}</ul></details>`;
    const row = (key, name, on, extra = '') => `<li><label><input type="checkbox" data-k="${e(key)}" ${on ? 'checked' : ''}><span>${e(name)}</span>${extra}</label></li>`;

    // 프롬프트: 지금 프리셋 토글 켜고 끄기 + 다른 프리셋에 기억한 것 지우기
    const paintToggles = () => {
        const box = sec('toggles');
        box.hidden = !kinds.toggles;
        if (!kinds.toggles) { box.innerHTML = ''; return; }
        const order = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter) || [];
        const nameOf = id => promptManager.getPromptById(id)?.name || id;
        const others = Object.entries(memory()?.byPreset || {}).filter(([p]) => nfc(p) !== nfc(currentPreset()));
        box.innerHTML = `
            <h4>${e(tr`Prompts`)}</h4>
            ${group(currentPreset(), tr`${order.filter(x => x.enabled).length} on`, order.filter(x => promptManager.getPromptById(x.identifier)).map(x => row(x.identifier, nameOf(x.identifier), x.enabled)).join(''), 'data-kind="toggles"')}
            ${others.length ? `<details class="cpm-group"><summary><span class="cpm-g-title">${e(tr`Other presets`)}</span><span class="cpm-count">${e(String(others.length))}</span></summary><ul class="cpm-others">${others.map(([p, t]) => `<li><span>${e(p)} — ${e(tr`${Object.values(t || {}).filter(Boolean).length} on`)}</span><button type="button" class="menu_button cpm-forget" data-p="${e(p)}">${e(tr`Forget`)}</button></li>`).join('')}</ul></details>` : ''}`;
        box.querySelectorAll('.cpm-checks input').forEach(cb => cb.addEventListener('change', () => {
            const entry = order.find(x => x.identifier === cb.dataset.k);
            if (!entry) return;
            entry.enabled = cb.checked;
            promptManager.render();
            Promise.resolve(promptManager.saveServiceSettings()).catch(err => console.warn(LOG, err));
            remember();
            cb.closest('details').querySelector('.cpm-count').textContent = tr`${order.filter(x => x.enabled).length} on`;
        }));
        // 지우기는 그 줄만 뺌 (다시 그리면 펼친 칸이 접히고 스크롤이 튐)
        box.querySelectorAll('.cpm-forget').forEach(btn => btn.addEventListener('click', () => {
            const m = memory(); if (!m?.byPreset) return;
            delete m.byPreset[btn.dataset.p];
            putMemory(ctx().getCurrentChatId(), m);
            const details = btn.closest('details');
            btn.closest('li').remove();
            const left = details.querySelectorAll('.cpm-others li').length;
            if (left) details.querySelector('.cpm-count').textContent = String(left);
            else details.remove();
        }));
        box.querySelectorAll('details').forEach(d => search(d, () => d.querySelectorAll('.cpm-checks li')));
    };

    // 월드인포: 전역 선택 + 이 채팅에 걸린 로어북 항목
    const paintWorld = async () => {
        const box = sec('world');
        box.hidden = !kinds.world;
        if (!kinds.world) { box.innerHTML = ''; return; }
        const selected = new Set(worldState());
        const books = activeBooks();
        const parts = [];
        for (const book of books) {
            let data = null;
            try { data = await ctx().loadWorldInfo(book); } catch { /* 없어진 로어북 */ }
            const entries = Object.entries(data?.entries || {});
            const on = entries.filter(([, x]) => !x.disable).length;
            parts.push(group(book, tr`${on} on, ${entries.length - on} off`, entries.map(([uid, x]) => row(uid, x.comment || (Array.isArray(x.key) ? x.key.slice(0, 3).join(', ') : '') || `#${uid}`, !x.disable)).join(''), `data-book="${e(book)}"`));
        }
        box.innerHTML = `
            <h4>${e(tr`World info`)}</h4>
            ${group(tr`Global world info`, selected.size ? [...selected].join(', ') : tr`none`, (world_names || []).map(n => row(n, n, selected.has(n))).join(''), 'data-global="1"')}
            ${parts.join('') || `<p class="cpm-edit-sub">${e(tr`No lorebook is attached to this chat.`)}</p>`}`;
        box.querySelectorAll('ul[data-global] input').forEach(cb => cb.addEventListener('change', () => {
            const want = [...box.querySelectorAll('ul[data-global] input:checked')].map(x => x.dataset.k);
            applyWorld(want);
            refreshEntries().then(() => { remember(); keep('world', paintWorld); });
        }));
        box.querySelectorAll('ul[data-book] input').forEach(cb => cb.addEventListener('change', async () => {
            const book = cb.closest('ul').dataset.book;
            const data = await ctx().loadWorldInfo(book);
            const entry = data?.entries?.[cb.dataset.k];
            if (!entry) return;
            entry.disable = !cb.checked;
            await ctx().saveWorldInfo(book, data, true);
            ctx().reloadWorldInfoEditor?.(book);
            await refreshEntries(); remember();
            const all = Object.values(data.entries), n = all.filter(x => !x.disable).length;
            cb.closest('details').querySelector('.cpm-count').textContent = tr`${n} on, ${all.length - n} off`;
        }));
        box.querySelectorAll('details').forEach(d => search(d, () => d.querySelectorAll('.cpm-checks li')));
    };

    // 정규식: 전역 · 프리셋 정규식 켜고 끄기
    const paintRegex = () => {
        const box = sec('regex');
        box.hidden = !kinds.regex;
        if (!kinds.regex) { box.innerHTML = ''; return; }
        const groups = [[SCRIPT_TYPES.GLOBAL, tr`Global regex`], [SCRIPT_TYPES.PRESET, tr`Preset regex`]].map(([type, label]) => [type, label, getScriptsByType(type, { allowedOnly: false }) || []]);
        box.innerHTML = `<h4>${e(tr`Regex`)}</h4>` + groups.filter(g => g[2].length).map(([type, label, list]) => group(label, tr`${list.filter(x => !x.disabled).length} on, ${list.filter(x => x.disabled).length} off`, list.map(x => row(x.id, x.scriptName || x.id, !x.disabled)).join(''), `data-type="${type}"`)).join('');
        box.querySelectorAll('ul[data-type] input').forEach(cb => cb.addEventListener('change', async () => {
            const type = Number(cb.closest('ul').dataset.type);
            const list = getScriptsByType(type, { allowedOnly: false }) || [];
            const script = list.find(x => x.id === cb.dataset.k);
            if (!script) return;
            script.disabled = !cb.checked;
            await saveScriptsByType(list, type);
            regexChanged = true;
            remember();
            const on = list.filter(x => !x.disabled).length;
            cb.closest('details').querySelector('.cpm-count').textContent = tr`${on} on, ${list.length - on} off`;
        }));
        box.querySelectorAll('details').forEach(d => search(d, () => d.querySelectorAll('.cpm-checks li')));
    };

    // 연결: 지금 연결과 이 채팅이 기억한 연결 (바꾸는 건 실리태번 연결 화면에서: 바꾸면 따라 기억)
    const paintConnection = () => {
        const box = sec('connection');
        box.hidden = !kinds.connection;
        if (!kinds.connection) { box.innerHTML = ''; return; }
        const now = connectionState(), saved = memory()?.connection;
        const profiles = extension_settings.connectionManager?.profiles || [];
        const differs = saved && JSON.stringify(saved) !== JSON.stringify(now);
        box.innerHTML = `<h4>${e(tr`Connection`)}</h4>
            <dl class="cpm-conn cpm-picks"><dt>${e(tr`Now`)}</dt><dd class="cpm-conn-now"></dd>${!saved || differs ? `<dt>${e(tr`Remembered`)}</dt><dd>${e(connectionLabel(saved) || tr`Not remembered yet`)}</dd>` : ''}</dl>
            <p class="cpm-edit-sub">${e(profiles.length ? tr`Pick a profile to switch right away; this chat remembers it. To change only the model, use SillyTavern's API panel.` : tr`Change the connection profile or model in SillyTavern's API panel; this chat follows it.`)}</p>`;
        const dd = box.querySelector('.cpm-conn-now');
        if (!profiles.length) { dd.textContent = connectionLabel(now) || '—'; return; }
        const items = profiles.map(p => ({ v: p.name, label: p.name }));
        if (!now.profile) items.unshift({ v: '', label: tr`No profile`, sub: connectionLabel(now) });
        dd.append(makePick({ items, value: now.profile || '', onPick: async name => {
            if (!name) return;
            await applyConnection({ profile: name });
            remember();
            paintConnection();
        } }));
    };

    // 페르소나: 지금 페르소나와 이 채팅이 기억한 페르소나 (바꾸는 건 실리태번 페르소나 화면에서: 바꾸면 따라 기억)
    const paintPersona = () => {
        const box = sec('persona');
        box.hidden = !kinds.persona;
        if (!kinds.persona) { box.innerHTML = ''; return; }
        const now = personaState(), saved = memory()?.persona, locked = ctx().chatMetadata?.persona;
        box.innerHTML = `<h4>${e(tr`Persona`)}</h4>
            <dl class="cpm-conn"><dt>${e(tr`Now`)}</dt><dd>${e(personaLabel(now) || '—')}</dd><dt>${e(tr`Remembered`)}</dt><dd>${e(personaLabel(saved) || tr`Not remembered yet`)}</dd></dl>
            <p class="cpm-edit-sub">${e(locked ? tr`A persona is locked to this chat (${personaName(locked)}), so the lock wins.` : tr`Change the persona in SillyTavern's persona panel; this chat follows it.`)}</p>`;
    };

    // 캐릭터 AU: 저장판이 있는 칸마다 지금 판을 고름: 고르면 카드 칸에 바로 넣고 이 채팅이 따라 기억
    const paintCard = () => {
        const box = sec('card');
        box.hidden = !kinds.card;
        if (!kinds.card) { box.innerHTML = ''; return; }
        const fields = cardFields();
        const unsaved = fields.some(f => { const t = document.getElementById(f.area).value; return t.trim() && !f.list.some(x => same(x.content, t)); });
        box.innerHTML = `<h4>${e(tr`Character AU`)}</h4><dl class="cpm-conn cpm-picks cpm-card">${fields.map(f => `<dt>${e(f.label())}</dt><dd data-k="${e(f.key)}"></dd>`).join('')}</dl>
            ${unsaved ? `<p class="cpm-edit-sub">${e(tr`Text that isn't a saved version is kept as a new version before you switch, so you can pick it again.`)}</p>` : ''}`;
        const n = s => tr`${s.replace(/\r/g, '').trim().length.toLocaleString()} chars`;
        for (const f of fields) {
            const text = document.getElementById(f.area).value;
            const curI = f.list.findIndex(x => same(x.content, text));
            const items = f.list.map((x, i) => ({ v: String(i), label: x.title || '—', sub: n(x.content) }));
            if (curI < 0 && text.trim()) items.push({ v: 'now', label: f.list.some(x => x.title === tr`Original text`) ? tr`Edited text` : tr`Original text`, sub: tr`not saved yet`, sep: true });
            if (f.key !== 'alt_descriptions' || !text.trim()) items.push({ v: 'empty', label: tr`Empty`, sep: !items.at(-1)?.sep });
            const value = curI >= 0 ? String(curI) : text.trim() ? 'now' : 'empty';
            box.querySelector(`dd[data-k="${f.key}"]`).append(makePick({ items, value, onPick: async v => {
                const live = cardFields().find(x => x.key === f.key);
                if (!live) return;
                const kept = await keepUnsaved(live);
                if (kept >= 0) { const it = cardFields().find(x => x.key === f.key).list[kept]; addedAlts.push({ key: f.key, item: { title: it.title, content: it.content } }); }
                // 창을 열 때의 글이 지금 남긴 판이면 '취소'가 그 판으로 돌아가게
                if (kept >= 0 && !before.card?.[f.key]) (before.card ||= {})[f.key] = { t: cardFields().find(x => x.key === f.key).list[kept].title, i: kept };
                const item = v === 'empty' ? { content: '' } : cardFields().find(x => x.key === f.key)?.list[Number(v)];
                if (!item) return;
                setCardText(f, item.content);
                remember();
                paintCard();
            } }));
        }
    };

    // 다른 채팅에 적용: 고른 채팅을 열 때 이 기억으로 바뀜 (지금 그 채팅 파일을 열거나 다시 쓰지 않음)
    const paintCopy = (open = false) => {
        const box = sec('copy');
        const on = !memory()?.off && !!memory();
        box.innerHTML = `<details class="cpm-group"${open ? ' open' : ''}><summary><span class="cpm-g-title">${e(tr`Apply to other chats`)}</span><span class="cpm-count"></span></summary>
            <p class="cpm-edit-sub">${e(tr`The chats you pick switch to this chat's settings the next time you open them.`)}</p>
            <div class="cpm-copy-body"><p class="cpm-edit-sub">${e(on ? tr`Loading…` : tr`Turn on remembering for this chat first.`)}</p></div></details>`;
        if (!on) return;
        // 이 캐릭터의 다른 채팅 목록은 한 번만 받아서 오른쪽 숫자와 펼친 목록에 같이 씀
        const chats = otherChats().catch(err => { console.warn(LOG, err); return []; });
        // 오른쪽 숫자: 이 캐릭터의 다른 채팅 중 지금 이 채팅과 같은 설정을 기억하는 채팅 수 (= 적용된 채팅)
        chats.then(ids => {
            const n = ids.filter(id => sameMemory(STORE.chats[id], memory())).length;
            const c = box.querySelector('.cpm-count');
            if (c) c.textContent = n ? tr`${n} applied` : tr`None applied`;
        });
        const details = box.querySelector('details');
        let shown = false;
        const show = async () => {
            if (shown || !details.open) return;
            shown = true;
            const body = box.querySelector('.cpm-copy-body');
            const ids = await chats;
            if (!ids.length) { body.innerHTML = `<p class="cpm-edit-sub">${e(tr`No other chats for this character.`)}</p>`; return; }
            const touch = matchMedia('(pointer: coarse)').matches;
            body.innerHTML = `<input type="search" class="text_pole cpm-search" placeholder="${e(tr`Search`)}">
                <p class="cpm-edit-sub cpm-pick-hint">${e(touch ? tr`Pick many: long-press, then drag` : tr`Pick many: drag · Shift+click for a range`)}</p>
                <ul class="cpm-checks cpm-chats">${ids.map(id => row(id, id, false, sameMemory(STORE.chats[id], memory()) ? `<small class="cpm-pend">${e(tr`applied`)}</small>` : STORE.chats[id] ? `<small class="cpm-pend">${e(tr`has settings`)}</small>` : '')).join('')}</ul>
                <div class="cpm-copy-bar"><label class="cpm-all"><input type="checkbox"><span>${e(tr`All`)}</span></label><button type="button" class="menu_button cpm-apply" disabled>${e(tr`Apply`)}</button></div>`;
            const boxes = () => [...body.querySelectorAll('.cpm-chats input')];
            const btn = body.querySelector('.cpm-apply');
            const sync = () => { const n = boxes().filter(x => x.checked).length; btn.disabled = !n; btn.textContent = n ? tr`Apply to ${n}` : tr`Apply`; };
            body.querySelector('.cpm-all input').addEventListener('change', x => { boxes().filter(b => !b.closest('li').hidden).forEach(b => { b.checked = x.target.checked; }); sync(); });
            boxes().forEach(b => b.addEventListener('change', sync));
            // 여러 개 고르기: 마우스는 누른 채 끌기 · Shift+클릭 범위, 터치는 길게 누른 뒤 끌기 (짧게 누르면 하나)
            const ul = body.querySelector('.cpm-chats'), lis = () => [...ul.querySelectorAll('li')];
            let last = null, paint = null, press = null;
            const setLi = (li, on) => { const b = li.querySelector('input'); if (b && !li.hidden) b.checked = on; };
            ul.addEventListener('click', ev => ev.preventDefault());
            ul.addEventListener('pointerdown', ev => {
                const li = ev.target.closest('li'); if (!li || ev.button !== 0) return;
                const idx = lis().indexOf(li), on = !li.querySelector('input').checked;
                if (ev.pointerType !== 'mouse') {
                    press = { li, idx, x: ev.clientX, y: ev.clientY, long: false };
                    press.t = setTimeout(() => { if (!press) return; press.long = true; paint = on; setLi(li, on); last = idx; sync(); navigator.vibrate?.(12); }, 450);
                    return;
                }
                ev.preventDefault();
                if (ev.shiftKey && last != null) { const [a, z] = [Math.min(last, idx), Math.max(last, idx)]; lis().slice(a, z + 1).forEach(x => setLi(x, on)); }
                else { setLi(li, on); paint = on; }
                last = idx; sync();
            });
            ul.addEventListener('pointerover', ev => { if (paint === null || press) return; const li = ev.target.closest('li'); if (li) { setLi(li, paint); sync(); } });
            ul.addEventListener('pointermove', ev => { if (press && !press.long && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 8) { clearTimeout(press.t); press = null; } });
            ul.addEventListener('touchmove', ev => {
                if (!press?.long) return;
                ev.preventDefault();
                const t = ev.touches[0], li = document.elementFromPoint(t.clientX, t.clientY)?.closest?.('li');
                if (li && ul.contains(li)) { setLi(li, paint); sync(); }
            }, { passive: false });
            ul.addEventListener('pointerup', () => { if (press && !press.long) { clearTimeout(press.t); setLi(press.li, !press.li.querySelector('input').checked); last = press.idx; sync(); press = null; } });
            ul.addEventListener('touchend', () => { if (press?.long) { press = null; paint = null; } });
            ul.addEventListener('contextmenu', ev => { if (ev.target.closest('li')) ev.preventDefault(); });
            const stop = () => { paint = null; };
            document.addEventListener('pointerup', stop, { signal: closed.signal });
            search(body, () => body.querySelectorAll('.cpm-chats li'));
            btn.addEventListener('click', () => {
                const mem = memory(); if (!mem) return;
                const copy = structuredClone(mem); delete copy.at; delete copy.off;
                const picked = boxes().filter(x => x.checked).map(x => x.dataset.k);
                picked.forEach(id => putMemory(id, { ...structuredClone(copy), at: Date.now() }, true, charKey()));   // 이 캐릭터 기억 파일만 씀: 고른 채팅 파일은 열지도 쓰지도 않음
                toast.success(tr`Applied to ${picked.length} chats. They switch to these settings when opened.`, tr`Chat Preset Memory`);
                paintCopy(true);
            });
        };
        details.addEventListener('toggle', show);
        show();
    };

    // 위 스위치 · 버튼: 막대와 같음: 켜면 그 칸이 바로 나타남
    const paintTop = () => {
        const on = !memory()?.off;
        root.querySelector('.cpm-edit-on').checked = on;
        root.querySelectorAll('.cpm-edit-top .cpm-kind').forEach(b => { b.setAttribute('aria-pressed', String(!!kinds[b.dataset.kind])); b.disabled = !on; });
        root.querySelectorAll('.cpm-sec').forEach(x => x.classList.toggle('cpm-dim', !on));
    };
    root.querySelector('.cpm-edit-on').addEventListener('change', ev => { store(snapshot(), { off: !ev.target.checked }); paintTop(); keep('copy', () => paintCopy()); });
    root.querySelectorAll('.cpm-edit-top .cpm-kind').forEach(btn => btn.addEventListener('click', async () => {
        const next = { ...rawKinds(), [btn.dataset.kind]: btn.getAttribute('aria-pressed') !== 'true' };
        if (!kindList().some(k => next[k])) return void toast.info(tr`Pick at least one, or turn the switch off.`, tr`Chat Preset Memory`);
        if (next.world) await refreshEntries();
        store(snapshot(next), { kinds: next });
        kinds = kindsOf();
        paintTop();
        await keep('toggles', paintToggles); await keep('regex', paintRegex); await keep('connection', paintConnection); await keep('persona', paintPersona); await keep('card', paintCard); await keep('world', paintWorld); await keep('copy', () => paintCopy());
    }));
    paintTop(); paintToggles(); paintRegex(); paintConnection(); paintPersona(); paintCard(); paintCopy(); await paintWorld();
    const result = await ctx().callGenericPopup(root, ctx().POPUP_TYPE.CONFIRM, '', { wide: true, allowVerticalScrolling: true, okButton: tr`OK`, cancelButton: tr`Cancel` });
    if (result !== ctx().POPUP_RESULT.AFFIRMATIVE && ctx().getCurrentChatId() === openChat) {
        // 취소 (Esc 포함): 창에서 바꾼 실제 설정과 이 채팅의 기억을 연 때로 되돌림: '다른 채팅에 적용'은 이미 적용한 것으로 둠
        S.restoring = true;
        try {
            if (nfc(before.preset) === nfc(currentPreset())) await applyToggles(before.toggles);
            applyWorld(before.world);
            if (before.entries) { await applyEntries(before.entries); await refreshEntries(); }
            if (await applyRegex(before.regex)) regexChanged = true;
            applyCard(before.card);
            // 이 창에서 남긴 판도 지움 (글은 위에서 그 판의 글로 이미 되돌림)
            const ch = cardChar(), alts = ch?.data?.extensions?.alternate_fields;
            if (alts && addedAlts.length) {
                for (const { key, item } of addedAlts) if (Array.isArray(alts[key])) { const at = alts[key].findLastIndex(x => x.title === item.title && x.content === item.content); if (at >= 0) alts[key].splice(at, 1); }   // 저장하면 캐릭터 목록이 새 객체로 바뀌어서 이름 · 글로 찾음
                await ctx().writeExtensionField(ctx().characterId, 'alternate_fields', alts);
            }
            // 연결은 카드 다음에 (연결을 바꾸면 채팅을 다시 불러오며 캐릭터 편집 칸을 잠깐 비움)
            if (kinds.connection) await applyConnection(before.connection);
        } finally {
            S.restoring = false;
        }
        // 기억이 실제로 바뀌었을 때만 되돌려 저장 (아무것도 안 바꾸고 취소하면 파일을 쓰지 않음)
        if (JSON.stringify(STORE.chats[openChat]) !== JSON.stringify(openMem)) putMemory(openChat, openMem);
    }
    closed.abort();
    if (regexChanged) await ctx().reloadCurrentChat();   // 바뀐 정규식으로 채팅을 다시 그림
    renderBar();
}

/** 이 캐릭터(그룹)의 다른 채팅 id: 이름만 받음(내용은 안 읽음) */
// 두 기억이 같은 설정인지 (기억한 시각 · 끔 표시는 빼고 비교)
export function sameMemory(a, b) {
    if (!a || !b) return false;
    const norm = v => Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => k !== 'at' && k !== 'off').sort().map(k => [k, norm(v[k])])) : v;
    return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}
export async function otherChats() {
    const c = ctx(), here = c.getCurrentChatId();
    if (c.groupId) return (c.groups?.find(g => g.id === c.groupId)?.chats || []).filter(id => id !== here);
    const avatar = c.characters?.[c.characterId]?.avatar;
    if (!avatar) return [];
    return (await chatsOf(avatar)).filter(id => id !== here).sort().reverse();
}
