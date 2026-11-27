// 이 채팅 기억: 바뀔 때마다 기억하고, 채팅을 열 때 기억한 설정으로 맞추기(되돌리기 알림 포함).
import { MODULE, LOG, ctx, toast, nfc, tr, settings, usable, charKey, trimChar, S } from './shared.js';
import { STORE, lastOf, dirtyLast, loadOwner, compact, scheduleStore, putMemory, memory, currentPreset } from './files.js';
import { togglesFor, kindsOf, cardState, applyCard, regexState, worldState, connectionState, applyConnection, connectionLabel, personaState, applyPersona, refreshEntries, snapshot, switchPreset, applyToggles, applyWorld, applyEntries, applyRegex } from './kinds.js';
import { renderBar } from './bar.js';
import { renderChars } from './char_list.js';

/** 새 상태를 기억에 얹음 (프리셋마다 따로) */
export function merged(prev, snap, extra = {}) {
    const byPreset = { ...(prev?.byPreset || {}) };
    if (snap.toggles) {
        if (prev?.preset && prev?.toggles && !togglesFor({ byPreset }, prev.preset)) byPreset[prev.preset] = prev.toggles;
        for (const k of Object.keys(byPreset)) if (nfc(k) === nfc(snap.preset)) delete byPreset[k];
        byPreset[snap.preset] = snap.toggles;
    }
    const out = { ...(prev || {}), ...snap, byPreset, ...extra, at: Date.now() };
    if (out.toggles && togglesFor({ byPreset }, out.preset)) delete out.toggles;   // byPreset 에 이미 있음 (파일을 가볍게)
    return out;
}

// 채팅을 바꾸는 중·맞추는 중·프리셋을 바꾸는 중에는 기억하지 않음 (다른 채팅·다른 프리셋 상태가 섞이지 않게)

// 기억을 시작한 채팅: 실리태번이 '지금 채팅'을 먼저 바꾸고 '채팅 바뀜' 신호는 늦게 보내서, 그 틈에 앞 채팅 상태가 새 채팅 기억으로 들어가지 않게

export const sameChat = () => S.ready && S.readyChat === ctx().getCurrentChatId();



export function store(snap, extra = {}) {
    const c = ctx();
    if (!sameChat()) return;
    const prev = memory();
    const next = merged(prev, snap, extra);
    // 프리셋이 바뀌었거나 켬/끔을 바꿨으면 바로 저장(그 사이 채팅을 옮겨도 예전 프리셋으로 돌아가지 않게),
    // 토글만 바뀌었으면 몰아서 저장(채팅 파일 전체를 매번 쓰지 않게)
    const urgent = !prev || nfc(prev.preset) !== nfc(snap.preset) || 'off' in extra || 'kinds' in extra
        || JSON.stringify(prev.world) !== JSON.stringify(snap.world ?? prev.world)
        || JSON.stringify(prev.entries) !== JSON.stringify(snap.entries ?? prev.entries)
        || JSON.stringify(prev.connection) !== JSON.stringify(snap.connection ?? prev.connection)
        || JSON.stringify(prev.persona) !== JSON.stringify(snap.persona ?? prev.persona)
        || JSON.stringify(prev.card) !== JSON.stringify(snap.card ?? prev.card);
    putMemory(c.getCurrentChatId(), next, urgent);
    const key = charKey();
    if (key && settings().charDefault) {
        const stub = settings().byChar[key];
        const before = lastOf[key] || (stub?.byPreset ? stub : null);
        lastOf[key] = trimChar(merged(before, snap));
        dirtyLast.add(key);
        scheduleStore(false);
        settings().byChar[key] = { preset: snap.preset, at: Date.now() };
        if (!stub) renderChars();
        // 캐릭터별 마지막 설정은 새 채팅을 열 때만 쓰므로, 처음 적을 때와 프리셋이 바뀔 때만 바로 저장.
        // 토글만 바뀌었으면 메모리에 두고 실리태번의 다음 설정 저장에 같이 실림 (토글마다 설정 파일 전체를 한 번 더 쓰던 것)
        if (!stub || stub.byPreset || nfc(stub.preset) !== nfc(snap.preset)) c.saveSettingsDebounced();
    }
    renderBar();
}

export const sameAsMemory = (mem, snap) => !!mem && nfc(mem.preset) === nfc(snap.preset)
    && (!snap.toggles || JSON.stringify(togglesFor(mem, snap.preset)) === JSON.stringify(snap.toggles))
    && (!snap.world || JSON.stringify(mem.world) === JSON.stringify(snap.world))
    && (!snap.entries || JSON.stringify(mem.entries) === JSON.stringify(snap.entries))
    && (!snap.regex || JSON.stringify(mem.regex) === JSON.stringify(snap.regex))
    && (!snap.connection || JSON.stringify(mem.connection) === JSON.stringify(snap.connection))
    && (!snap.persona || JSON.stringify(mem.persona) === JSON.stringify(snap.persona))
    && (!snap.card || JSON.stringify(mem.card) === JSON.stringify(snap.card));

/** 바꿀 때마다 기억 (이 채팅 기억을 끈 경우는 제외) */

export function remember() {
    if (!sameChat() || S.restoring || S.switching || !usable()) return;
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(() => {
        if (!sameChat() || S.restoring || S.switching || !usable()) return;
        const mem = memory();
        if (mem?.off) return;
        const now = snapshot();
        if (!sameAsMemory(mem, now)) store(now);
    }, 150);
}

// 이 확장이 설정을 맞췄을 때 알림은 모두 같은 모양: 머리줄(무엇을 했는지 · 되돌리기) + 바뀐 것 한 줄에 하나씩 [이름 | 값]
// 알림 설정: 끄면 안 띄움(always 는 사용자가 누른 일의 결과라 늘 띄움), '알림에 보일 것'에서 고른 종류의 줄만 보임: 안 고른 종류는 줄을 빼고 머리줄만
// 전체 목록은 늘 마우스를 올리면 보임. notes = [[이름, 값, 종류]]
export function notice(head, notes, { onUndo, timeOut = 8000, always = false } = {}) {
    if (!settings().notify && !always) return;
    const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const show = settings().notifyKinds;
    const shown = notes.filter(([, , kind]) => !kind || show[kind] !== false);
    // 4번째 칸(바뀐 토글 { on, off })이 있으면 그 줄 끝에 작은 '보기': 누르면 알림 안에서 켬 | 끔 두 칸으로 펼침
    const detail = shown.find(n => n[3] && (n[3].on.length || n[3].off.length))?.[3];
    const rows = shown.map(([k, v, , d]) => `<span class="cpm-tn-k">${esc(k)}</span><span class="cpm-tn-v"><span class="cpm-tn-text">${esc(v)}</span>${d && d === detail ? `<button type="button" class="cpm-tn-see">${esc(tr`View`)}</button>` : ''}</span>`).join('');
    const col = (cls, title, list) => `<div class="cpm-tn-box ${cls}"><div class="cpm-tn-grp">${esc(title)} ${list.length}</div>${list.map(n => `<div class="cpm-tn-row" title="${esc(n)}">${esc(n)}</div>`).join('')}</div>`;
    const lists = detail ? `<div class="cpm-tn-list">${col('cpm-tn-on', tr`On`, detail.on)}${col('cpm-tn-off', tr`Off`, detail.off)}</div>` : '';
    const undo = onUndo ? `<u>${esc(tr`Undo`)}</u>` : '';
    const t = toast.info(`<div class="cpm-tn-head"><span>${esc(head)}</span>${undo}</div>${rows ? `<div class="cpm-tn">${rows}</div>` : ''}${lists}`, tr`Chat Preset Memory`, {
        escapeHtml: false, timeOut, extendedTimeOut: 4000, ...(onUndo ? { onclick: onUndo } : {}),
    });
    if (notes.length) t?.attr?.('title', notes.map(([k, v]) => `${k}: ${v}`).join('\n'));
    t?.find?.('.cpm-tn-see').on('click', ev => {
        ev.stopPropagation();   // 알림을 누르면 되돌리기라서
        const open = t.toggleClass('cpm-tn-open').hasClass('cpm-tn-open');
        ev.currentTarget.textContent = open ? tr`Hide` : tr`View`;
        if (open) { t.trigger('mouseenter'); t.off('mouseleave'); t.removeAttr('title'); }   // 펼친 동안은 저절로 안 닫힘
    });
    t?.find?.('.cpm-tn-list').on('click', ev => ev.stopPropagation());
}

/** 채팅을 열 때: 마지막 프리셋으로 바꾸고(설정에 따라), 그 프리셋에서 기억한 토글을 맞춤 */
export async function restore(mem, label, my) {
    const chatId = ctx().getCurrentChatId();
    // 그 사이 다른 채팅을 열었으면 멈춤 (빠르게 옮길 때 앞 채팅 설정이 늦게 덮지 않게)
    const stale = () => ctx().getCurrentChatId() !== chatId || (my !== undefined && my !== S.seq);
    // 알림: 바뀐 것을 한 줄에 하나씩 [이름 칸 | 값 칸]: 값이 길면 그 줄 끝에서 … (전체 글은 마우스를 올리면 보임)
    const notes = [];
    const note = (label, value, kind) => notes.push([label, String(value), kind]);
    S.restoring = true;
    const kinds = kindsOf(mem);
    // 되돌리기용: 바꾸기 전 상태(이 채팅이 맞출 종류만)
    const before = { preset: currentPreset(), toggles: snapshot({ toggles: true }).toggles, world: worldState(), entries: S.lastEntries, regex: kinds.regex ? regexState() : null, connection: kinds.connection ? connectionState() : null, persona: kinds.persona ? personaState() : null, card: kinds.card ? cardState() : null };
    let regexChanged = 0;
    try {
        // 캐릭터 AU 는 연결보다 먼저: 연결 프로필을 바꾸면 실리태번이 채팅을 다시 불러오며 캐릭터 편집 칸을 잠깐 비우는데, 그때는 칸을 못 찾아 건너뜀
        const cardDone = kinds.card ? applyCard(mem.card) : [];
        // 연결은 프리셋보다 먼저: 연결 프로필이 프리셋까지 바꿀 수 있어서, 그 뒤에 프리셋 · 토글을 맞춤
        if (kinds.connection && await applyConnection(mem.connection)) note(tr`Connection`, connectionLabel(mem.connection), 'connection');
        if (stale()) return;
        if (kinds.persona) { const p = await applyPersona(mem.persona, stale); if (p) note(tr`Persona`, p, 'persona'); }
        if (stale()) return;
        for (const [k, v] of cardDone) note(k, v, 'card');
        if (kinds.toggles && settings().restorePreset && mem.preset && nfc(mem.preset) !== nfc(currentPreset())) {
            if (!(await switchPreset(mem.preset))) {
                toast.warning(tr`Saved preset "${mem.preset}" was not found.`, tr`Chat Preset Memory`);
                return;
            }
            note(tr`Preset`, mem.preset, 'toggles');
        }
        if (stale()) return;
        if (kinds.toggles) {
            const changed = await applyToggles(togglesFor(mem, currentPreset()));
            if (changed) notes.push([tr`Toggles`, tr`${changed} changed`, 'toggles', S.lastToggleChanges]);
        }
        if (stale()) return;
        if (kinds.world) {
            const books = applyWorld(mem.world);
            const entries = await applyEntries(mem.entries);
            if (books || entries) note(tr`World info`, entries ? tr`${entries} entries` : tr`Selection changed`, 'world');
            await refreshEntries();
        }
        if (stale()) return;
        if (kinds.regex) {
            regexChanged = await applyRegex(mem.regex);
            if (regexChanged) note(tr`Regex`, tr`${regexChanged} changed`, 'regex');
        }
    } finally {
        S.restoring = false;
    }
    if (notes.length) notice(label, notes, { onUndo: () => undoRestore(before, kinds, chatId) });
    // 화면에 그리는 정규식이 바뀌었으면 이 채팅을 한 번 다시 그림: 기다리지 않음(다시 그리기가 채팅 바뀜을 다시 부르고, 그게 이 맞추기가 끝나길 기다려서 서로 멈춤)
    if (regexChanged && ctx().getCurrentChatId() === chatId) setTimeout(() => { if (ctx().getCurrentChatId() === chatId) ctx().reloadCurrentChat(); }, 0);
}

/** 채팅을 열며 바뀐 것을 그 전으로: 되돌린 상태를 이 채팅이 기억함 */
export async function undoRestore(before, kinds, chatId) {
    if (ctx().getCurrentChatId() !== chatId) return void toast.warning(tr`You're in another chat now, so this can't be undone.`, tr`Chat Preset Memory`);
    S.restoring = true;
    let regexChanged = 0;
    try {
        if (kinds.card) applyCard(before.card);   // 연결보다 먼저 (restore 와 같은 까닭)
        if (kinds.connection) await applyConnection(before.connection);
        if (kinds.persona) await applyPersona(before.persona);
        if (kinds.toggles && nfc(before.preset) !== nfc(currentPreset())) await switchPreset(before.preset);
        if (kinds.toggles) await applyToggles(before.toggles);
        if (kinds.world) { applyWorld(before.world); await applyEntries(before.entries); await refreshEntries(); }
        if (kinds.regex) regexChanged = await applyRegex(before.regex);
    } finally {
        S.restoring = false;
    }
    store(snapshot());
    notice(tr`Back to the settings before opening this chat.`, [], { timeOut: 2500, always: true });
    if (regexChanged) await ctx().reloadCurrentChat();
}

/** 채팅 안에서 사용자가 프리셋을 바꿨을 때: 이 채팅에서 그 프리셋으로 기억한 토글이 있으면 맞추고, 그 상태를 기억 */
export async function onPresetChanged() {
    S.switching = false;
    if (!sameChat() || S.restoring || !usable()) return;
    const mem = memory();
    if (mem && !mem.off && kindsOf(mem).toggles) {
        S.restoring = true;
        try {
            const changed = await applyToggles(togglesFor(mem, currentPreset()));
            if (changed) notice(tr`Restored this chat's toggles for this preset`, [[tr`Toggles`, tr`${changed} changed`, 'toggles', S.lastToggleChanges]], { timeOut: 4000 });
        } finally {
            S.restoring = false;
        }
        // 기다리지 않고 바로 기억·저장 (그 사이 채팅을 옮겨도 예전 프리셋으로 돌아가지 않게)
        clearTimeout(S.saveTimer);
        if (!sameAsMemory(memory(), snapshot())) store(snapshot());
        return;
    }
    remember();
}



export async function onChatChanged() {
    const my = ++S.seq;
    S.ready = false; S.readyChat = null;
    clearTimeout(S.saveTimer);
    renderBar();
    await new Promise(r => setTimeout(r, 500));
    if (my !== S.seq) return;
    await loadOwner(charKey());
    // 예전 방식의 예약(설정 파일 pending)이 남아 있으면 저장소로 옮김: 채팅 파일은 건드리지 않음
    const chatId = ctx().getCurrentChatId(), pend = chatId && settings().pending[chatId];
    if (pend) { putMemory(chatId, { ...structuredClone(pend), at: Date.now() }); delete settings().pending[chatId]; ctx().saveSettingsDebounced(); }
    // 예전에 채팅 파일에 넣어 둔 기억은 저장소로 옮겨 씀(읽기만)
    else if (chatId && !STORE.chats[chatId]) {
        // 분기(Branch)는 원래 채팅(main_chat)의 지금 기억을 물려받고, 그게 없으면 채팅 파일에 남은 예전 기억을 옮김
        const parent = ctx().chatMetadata?.main_chat && STORE.chats[ctx().chatMetadata.main_chat];
        const old = parent || ctx().chatMetadata?.[MODULE];
        if (old) putMemory(chatId, compact({ ...structuredClone(old), at: Date.now() }), false);
    }
    // 로어북 파일 읽기는 월드인포를 기억하는 채팅에서만 (채팅을 열 때 일을 줄임)
    S.lastEntries = null;
    if (kindsOf().world) await refreshEntries();
    // 앞 채팅의 맞추기가 아직 돌고 있으면 끝날 때까지 기다린 뒤 이 채팅 것을 맞춤
    await S.running;
    if (my !== S.seq) return;
    const job = (async () => {
        if (!usable()) return;
        const mem = memory();
        const stub = settings().charDefault ? settings().byChar[charKey()] : null;   // 목록에서 지웠으면 안 씀
        const fallback = stub ? (lastOf[charKey()] || (stub.byPreset ? stub : null)) : null;
        if (mem && !mem.off) await restore(mem, tr`Restored this chat's settings`, my);
        else if (!mem && fallback) await restore(fallback, tr`Started from this character's last settings`, my);
    })().catch(err => console.warn(LOG, err));
    S.running = job;
    await job;
    await new Promise(r => setTimeout(r, 800));
    if (my !== S.seq) return;
    S.ready = true; S.readyChat = ctx().getCurrentChatId();
    remember(); // a chat without memory starts remembering from now
    renderBar();
}
