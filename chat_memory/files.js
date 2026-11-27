// 이 채팅 기억: 기억을 서버 파일에 읽고 쓰기. 파일 이름과 안의 꼴은 따로 깔아 쓰던 때와 같다(쓰던 기억이 그대로 읽힌다).
import { oai_settings } from '../../../../openai.js';
import { MODULE, LOG, ctx, toast, nfc, tr, settings, charKey } from './shared.js';

// ---------------- 기억 저장소 (캐릭터 · 그룹마다 서버 파일 하나) ----------------
// user/files/chat-preset-memory.<이름>-<해시>.json = { owner, chats: { 채팅 id: 기억 } }
// 채팅이 많아도 저장할 때는 그 캐릭터 파일만 읽고 씀. 채팅을 다 지우거나 캐릭터를 지우면 파일도 지움.
export const LEGACY_FILE = 'chat-preset-memory.json';   // 예전: 모든 채팅을 파일 하나에: 열 때 캐릭터별 파일로 옮김
// 지금까지 읽은 캐릭터들의 기억(채팅 id → 기억). 파일에서 읽은 채팅은 짧은 꼴 그대로 두었다가 처음 쓸 때 풂
// (한 캐릭터에 채팅이 수천 개여도 그 캐릭터를 열 때 전부 풀지 않게)
export const PACKED = Symbol('packed');
export const lazy = (m, ids) => ({ [PACKED]: m, ids });
export let STORE = { chats: new Proxy({}, {
    get(target, id) { const v = target[id]; if (v && v[PACKED]) return (target[id] = unpackChat(v[PACKED], v.ids)); return v; },
}) };
export const ownerOf = {};                               // 채팅 id → 캐릭터 · 그룹 키
export const loaded = new Map();                         // 캐릭터 · 그룹 키 → 읽기 Promise
export const dirty = new Set();
// 캐릭터별 마지막 설정(새 채팅 시작값) 몸통은 그 캐릭터 기억 파일의 last 칸에: 설정 파일엔 목록용 {preset, at} 만
// (설정 파일에 두면 토글 · 테마를 바꿀 때마다 그 덩어리까지 서버로 다시 보냈음)
export const lastOf = {};                                // 캐릭터 · 그룹 키 → 마지막 설정(풀린 꼴)
export const dirtyLast = new Set();
export const gone = new Set();                           // 지운 캐릭터 · 그룹: 늦게 도는 저장이 파일을 다시 만들지 않게
export let storeTimer = null;
export function fileOf(key) {
    let h = 0x811c9dc5;
    for (const ch of String(key)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    const slug = String(key).replace(/\.png$/i, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
    return `chat-preset-memory.${slug || 'char'}-${h.toString(36)}.json`;   // 영문 · 숫자가 없는 이름(한글 · 한자)은 char-해시
}
/** 파일이 없을 때만 null: 서버 오류 · 끊김 · 깨진 글은 오류로 던짐
 *  (예전엔 모두 '없음'으로 봐서, 잠깐 못 읽은 순간에 저장하면 그 캐릭터의 다른 채팅 기억을 빼고 덮어쓰거나 파일을 지웠음) */
export async function readJson(name) {
    const r = await fetch(`/user/files/${name}`, { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`read ${name}: ${r.status}`);
    return await r.json();
}
export async function writeJson(name, obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj)); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));   // 큰 파일도 한 번에 펼치지 않게
    const r = await fetch('/api/files/upload', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ name, data: btoa(bin) }) });
    if (!r.ok) throw new Error(`write ${name}: ${r.status}`);
}
// 저장이 끝내 안 되면 한 번만 알림 (다시 저장되면 풀림)
export let saveWarned = false;
export let retryTimer = null;
export function warnSaveFailed(err) {
    console.warn(LOG, 'save', err);
    if (saveWarned) return;
    saveWarned = true;
    toast.warning(tr`Couldn't save this chat's memory to the server. It will keep trying.`, tr`Chat Preset Memory`);
}
export async function removeFile(name) {
    await fetch('/api/files/delete', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ path: `user/files/${name}` }) }).catch(() => {});
}
/** 기억 파일 목록(확장 설정): 새 파일이 생기거나 지울 때만 설정 저장 */
export function noteFile(key, exists) {
    const list = settings().files, has = list.includes(key);
    if (exists === has) return;
    if (exists) list.push(key); else list.splice(list.indexOf(key), 1);
    ctx().saveSettingsDebounced();
}
/** 실리태번을 켤 때: 캐릭터 · 그룹이 없어진 기억 파일을 지움 (지우는 신호를 놓쳤어도 남지 않게) */
export async function pruneFiles() {
    const c = ctx();
    if (!c.characters?.length) return;   // 목록을 못 읽었으면 아무것도 지우지 않음
    let groups = null;   // 그룹 목록은 서버에 직접 물음: 못 읽으면 그룹 파일은 남김
    try { const r = await fetch('/api/groups/all', { method: 'POST', headers: c.getRequestHeaders() }); if (r.ok) groups = await r.json(); } catch { /* 못 읽음 */ }
    const alive = new Set([...c.characters.map(x => x.avatar), ...(Array.isArray(groups) ? groups : []).map(g => 'group:' + g.id)]);
    for (const key of [...settings().files]) {
        if (alive.has(key)) continue;
        if (key.startsWith('group:') && !Array.isArray(groups)) continue;
        await removeFile(fileOf(key));
        noteFile(key, false);
    }
}
export let legacyReady = null;
export const loadLegacy = () => legacyReady ??= readJson(LEGACY_FILE).then(j => j?.chats && typeof j.chats === 'object' ? j : null).catch(err => { legacyReady = null; throw err; });
/** 이 캐릭터(그룹)의 기억 파일을 읽음: 예전 한 파일에 이 캐릭터 채팅이 있으면 여기로 옮김 */
export function loadOwner(key = charKey()) {
    if (!key) return Promise.resolve();
    if (!loaded.has(key)) loaded.set(key, (async () => {
        gone.delete(key);
        const file = await readJson(fileOf(key));
        for (const [id, m] of Object.entries(file?.chats || {})) {
            if (!m || typeof m !== 'object') continue;
            ownerOf[id] = key;
            if (!dirty.has(id)) STORE.chats[id] = lazy(m, file.ids);
        }
        if (file?.last && !dirtyLast.has(key)) lastOf[key] = unpackChat(file.last, file.ids);
        // 예전처럼 설정 파일에 몸통이 있으면 이 파일로 옮기고 설정엔 목록용만 남김
        const old = settings().byChar[key];
        if (old?.byPreset) {
            if (!lastOf[key]) { lastOf[key] = old; dirtyLast.add(key); }
            settings().byChar[key] = { preset: old.preset, at: old.at };
            ctx().saveSettingsDebounced();
            if (dirtyLast.has(key)) await saveStore();
        }
        const legacy = await loadLegacy();
        if (!legacy || !Object.keys(legacy.chats).length) return;
        const mine = new Set(await chatsOf(key).catch(() => []));
        const here = ctx().getCurrentChatId(); if (here && charKey() === key) mine.add(here);
        const moved = Object.keys(legacy.chats).filter(id => mine.has(id));
        if (!moved.length) return;
        for (const id of moved) {
            const m = legacy.chats[id];
            if (m && typeof m === 'object' && !STORE.chats[id]) { STORE.chats[id] = compact(m); ownerOf[id] = key; dirty.add(id); }
            delete legacy.chats[id];
        }
        await saveStore();
        if (Object.keys(legacy.chats).length) await writeJson(LEGACY_FILE, legacy); else await removeFile(LEGACY_FILE);
    })().catch(err => { console.warn(LOG, 'load', err); loaded.delete(key); }));   // 못 읽었으면 다음에 다시 읽음
    return loaded.get(key);
}
/** 캐릭터 · 그룹의 채팅 id 목록 */
export async function chatsOf(key) {
    const c = ctx();
    if (String(key).startsWith('group:')) return c.groups?.find(g => g.id === key.slice(6))?.chats || [];
    const res = await fetch('/api/characters/chats', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ avatar_url: key, simple: true }) });
    const data = await res.json();
    const list = Array.isArray(data) ? data : Object.values(data || {});
    return list.map(x => String(x.file_name || '').replace(/\.jsonl$/, '')).filter(Boolean);
}
/** 기억 하나를 가볍게: 같은 토글을 두 번 담지 않고 쓰지 않는 칸을 뺌 (바뀐 게 없으면 같은 객체) */
export function compact(m) {
    const extra = 'locked' in m;
    const dup = m.toggles && m.byPreset && Object.entries(m.byPreset).some(([k]) => nfc(k) === nfc(m.preset));
    if (!extra && !dup) return m;
    const out = { ...m };
    delete out.locked;
    if (dup) delete out.toggles;
    return out;
}
// 파일 안 토글은 짧게: 프리셋마다 토글 id 목록(ids)을 파일에 한 번만 두고, 채팅에는 그 순서대로 '1'(켬) · '0'(끔) · '.'(기억 없음) 한 줄
// (토글 148개면 148글자: 예전엔 토글마다 긴 id 를 다시 적어 채팅 하나에 6KB 넘게 들었음)
export function packChat(m, ids) {
    if (!m || typeof m !== 'object') return m;
    const out = { ...m };
    const by = { ...(m.byPreset || {}) };
    if (m.toggles && m.preset && !Object.keys(by).some(k => nfc(k) === nfc(m.preset))) by[m.preset] = m.toggles;
    delete out.toggles;
    if (!Object.keys(by).length) { delete out.byPreset; return out; }
    out.byPreset = {};
    for (const [p, t] of Object.entries(by)) {
        if (typeof t === 'string') { out.byPreset[p] = t; continue; }
        const list = ids[p] ||= [];
        for (const id of Object.keys(t || {})) if (!list.includes(id)) list.push(id);
        out.byPreset[p] = list.map(id => id in t ? (t[id] ? '1' : '0') : '.').join('').replace(/\.+$/, '');
    }
    return out;
}
export function unpackChat(m, ids) {
    if (!m || typeof m !== 'object' || !m.byPreset) return m;
    const out = { ...m, byPreset: {} };
    for (const [p, t] of Object.entries(m.byPreset)) {
        if (typeof t !== 'string') { out.byPreset[p] = t; continue; }
        const list = ids?.[p] || [], obj = {};
        [...t].forEach((ch, i) => { if (list[i] && ch !== '.') obj[list[i]] = ch === '1'; });
        out.byPreset[p] = obj;
    }
    return out;
}
/** 바뀐 채팅이 든 캐릭터 파일만: 저장 직전에 그 파일을 다시 읽어 다른 탭 · 기기의 기억을 덮지 않음. 비면 파일을 지움
 *  저장은 한 번에 하나씩: 겹치면 뒤 저장이 앞 저장 전 파일을 읽어 방금 지운 기억을 되살렸음(마지막 채팅을 지우면 새 채팅이 바로 저장됨) */
export let saving = Promise.resolve();
/** 지금 도는 저장이 끝나길 기다림 */
export const savingDone = () => saving.catch(() => {});
export function saveStore() {
    saving = saving.then(saveStoreNow, saveStoreNow);
    return saving;
}
export async function saveStoreNow() {
    const ids = [...dirty]; dirty.clear();
    const lastKeys = new Set(dirtyLast); dirtyLast.clear();
    const byOwner = new Map();
    for (const id of ids) { const k = ownerOf[id]; if (k) (byOwner.get(k) || byOwner.set(k, []).get(k)).push(id); }
    for (const k of lastKeys) if (!byOwner.has(k)) byOwner.set(k, []);
    for (const [key, list] of byOwner) {
        // 다른 탭 · 기기가 같은 순간에 같은 파일을 쓰면 한쪽 변경이 덮일 수 있음 → 쓴 뒤 다시 읽어 내 변경이 빠졌으면 합쳐서 다시 씀
        // 읽기 · 쓰기가 실패하거나 끝내 맞지 않으면 그 채팅들을 '저장할 것'으로 되돌림 (다음 변경 때 다시 저장)
        let ok = false;
        try { for (let tries = 0; tries < 4; tries++) {
            if (gone.has(key)) break;
            const name = fileOf(key);
            const latest = await readJson(name) || {};
            const ids = latest.ids && typeof latest.ids === 'object' ? latest.ids : {};
            const chats = latest.chats && typeof latest.chats === 'object' ? latest.chats : {};
            for (const id of list) { if (STORE.chats[id] === undefined) delete chats[id]; else chats[id] = packChat(STORE.chats[id], ids); }
            for (const [id, m] of Object.entries(chats)) if (!list.includes(id) && !dirty.has(id)) { STORE.chats[id] = lazy(m, ids); ownerOf[id] = key; }
            const want = Object.fromEntries(list.map(id => [id, JSON.stringify(chats[id] ?? null)]));
            const presets = new Set(list.flatMap(id => Object.keys(chats[id]?.byPreset || {})));
            const last = lastKeys.has(key) && lastOf[key] ? packChat(lastOf[key], ids) : latest.last;
            for (const p of Object.keys(last?.byPreset || {})) presets.add(p);
            const wantIds = [...presets].map(p => [p, ids[p] || []]);
            if (Object.keys(chats).length || last) { await writeJson(name, { owner: key, ids, chats, ...(last ? { last } : {}) }); noteFile(key, true); }
            else { await removeFile(name); noteFile(key, false); }
            await new Promise(r => setTimeout(r, 150 + Math.random() * 250));
            const check = await readJson(name);
            const back = check?.chats || {};
            // 채팅 줄도, 그 줄이 가리키는 토글 id 목록(앞부분)도 그대로여야 함
            const idsOk = wantIds.every(([p, l]) => l.every((x, i) => check?.ids?.[p]?.[i] === x));
            const lastOk = !lastKeys.has(key) || JSON.stringify(check?.last ?? null) === JSON.stringify(last ?? null);
            if (idsOk && lastOk && list.every(id => JSON.stringify(back[id] ?? null) === want[id])) { ok = true; break; }
        } } catch (err) { console.warn(LOG, 'save', err); }
        if (gone.has(key)) continue;
        if (ok) { saveWarned = false; continue; }
        for (const id of list) dirty.add(id);
        if (lastKeys.has(key)) dirtyLast.add(key);
        warnSaveFailed(`${fileOf(key)}`);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => saveStore().catch(err => console.warn(LOG, 'save', err)), 30000);   // 변경이 없어도 30초 뒤 한 번 더
    }
}
export function scheduleStore(urgent) {
    clearTimeout(storeTimer);
    storeTimer = setTimeout(() => saveStore().catch(err => console.warn(LOG, 'save', err)), urgent ? 0 : 1500);
}
export function putMemory(id, value, urgent = true, key = ownerOf[id] || charKey()) {
    if (!id || !key) return;
    ownerOf[id] = key;
    if (value === undefined) delete STORE.chats[id]; else STORE.chats[id] = value;
    dirty.add(id);
    scheduleStore(urgent);
}
export const memory = () => { const id = ctx().getCurrentChatId(); return (id && STORE.chats[id]) || ctx().chatMetadata?.[MODULE] || null; };
export const currentPreset = () => oai_settings.preset_settings_openai;
