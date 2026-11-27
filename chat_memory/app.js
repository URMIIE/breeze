// 이 채팅 기억: 켜고 끄기. 실리태번 신호에 일을 달고, 끌 때 전부 뗀다.
// 같은 기억 파일과 같은 설정 칸을 쓰는 따로 깔린 확장이 이 화면에 올라와 있으면 이쪽이 쉰다:
// 둘이 같이 돌면 채팅을 열 때 설정을 두 번 맞추고, 서로 맞춘 것을 상대가 '사용자가 바꿨다'로 알고 다시 기억해 덮어쓴다.
// 그 확장은 올라오면서 전역 표시(Symbol.for('chat-preset-memory.api'))에 자기 것을 넣는다. 이쪽도 같은 표시를 쓰므로(다른 확장이 읽는 창구라 이름을 바꾸지 않는다)
// 표시에 든 것이 이쪽 것이 아니면 다른 쪽이 올라온 것이다. 확장이 올라오는 순서는 정해져 있지 않아서 시작할 때와, 채팅이 바뀔 때마다 본다.
import { LOG, ctx, loadKo, settings, charKey, S } from './shared.js';
import { STORE, ownerOf, loaded, dirty, lastOf, dirtyLast, gone, fileOf, readJson, writeJson, removeFile, noteFile, pruneFiles, loadOwner, putMemory, savingDone, warnSaveFailed } from './files.js';
import { kindsOf, syncAuOption, refreshEntries } from './kinds.js';
import { remember, onChatChanged, onPresetChanged } from './remember.js';
import { renderBar, watchPromptManager, unwatchPromptManager } from './bar.js';
import { renderChars } from './char_list.js';

const API = Symbol.for('chat-preset-memory.api');
const STYLE_ID = 'breeze-chat-memory-style';
/** breeze 에 알릴 글(api.rest('same', REST_INFO)): 따로 깔린 쪽이 켜져 있으면 그쪽이 맡는다. 설정 · 기억 파일 자리가 같아 값은 그대로 이어진다 */
export const REST_INFO = Object.freeze({
    saw: '따로 깔린 이 채팅 기억 확장이 켜져 있어 그쪽이 맡고 있어요',
    who: { kind: 'ext', name: '이 채팅 기억 (Chat Preset Memory)' },
    back: '설정과 기억은 같은 자리를 써서 그대로예요.',
});

// 다른 확장이 읽는 창구: 채팅 id → 그 채팅이 기억한 { avatar, au? } (페르소나를 기억하는 채팅만, 이 캐릭터 파일을 읽은 뒤)
const mine = {
    async persona(chatId, owner = charKey()) {
        await loadOwner(owner);
        const m = STORE.chats[chatId];
        return m && !m.off && kindsOf(m).persona && m.persona?.avatar ? { ...m.persona } : null;
    },
};
/** 같은 일을 하는 다른 쪽이 이 화면에 올라와 있나 */
export const otherRunning = () => !!globalThis[API] && globalThis[API] !== mine;

let bound = [];       // [신호, 처리] : 끌 때 뗌
let wiTimer = null;
let onOther = null;   // 돌던 중에 다른 쪽이 올라온 것을 알았을 때 부를 것
let live = false;

function on(ev, fn) {
    if (!ev) return;
    ctx().eventSource.on(ev, fn);
    bound.push([ev, fn]);
}
const bare = n => String(n || '').replace(/\.jsonl$/, '');

/** 돌던 중에 다른 쪽이 늦게 올라왔으면 이쪽을 걷고 true */
function yieldToOther() {
    if (!live || !otherRunning()) return false;
    stop();
    onOther?.();
    return true;
}

function bindEvents() {
    const t = ctx().event_types;
    // 실리태번은 이벤트 처리를 하나씩 기다리므로, 일부러 쉬는 이 처리가 채팅 열기 · 첫 화면을 막지 않게 따로 돌림
    on(t.CHAT_CHANGED, () => { if (!yieldToOther()) void onChatChanged().catch(err => console.warn(LOG, err)); });
    // 채팅 이름을 바꾸면 기억도 새 이름으로, 지우면 기억도 지움
    on(t.CHAT_RENAMED, async d => { await loadOwner(charKey()); const a = bare(d?.oldFileName), b = bare(d?.newFileName); if (a && b && STORE.chats[a]) { putMemory(b, STORE.chats[a], true, ownerOf[a]); putMemory(a, undefined); } });
    // 채팅을 지우면 그 기억을 빼고, 캐릭터 파일이 비면 파일도 지움
    const onChatDeleted = async name => { await loadOwner(charKey()); const id = bare(name); if (STORE.chats[id]) putMemory(id, undefined); };
    on(t.CHAT_DELETED, onChatDeleted);
    on(t.GROUP_CHAT_DELETED, onChatDeleted);
    // 캐릭터를 지우면 그 캐릭터 기억 파일을 통째로, 이름(아바타)을 바꾸면 새 이름 파일로 옮김
    on(t.CHARACTER_DELETED, async ({ character } = {}) => {
        const key = character?.avatar; if (!key) return;
        gone.add(key);
        delete lastOf[key]; dirtyLast.delete(key);
        if (settings().byChar[key]) { delete settings().byChar[key]; ctx().saveSettingsDebounced(); renderChars(); }
        for (const id of Object.keys(ownerOf)) if (ownerOf[id] === key) { delete ownerOf[id]; delete STORE.chats[id]; dirty.delete(id); }
        loaded.delete(key);
        await savingDone();   // 이미 돌고 있는 저장이 끝난 뒤에 지움
        await removeFile(fileOf(key)); noteFile(key, false);
    });
    on(t.CHARACTER_RENAMED, async (oldKey, newKey) => {
        if (!oldKey || !newKey || oldKey === newKey) return;
        try {
            const file = await readJson(fileOf(oldKey)); if (!file?.chats) return;
            await writeJson(fileOf(newKey), { ...file, owner: newKey }); await removeFile(fileOf(oldKey)); noteFile(oldKey, false); noteFile(newKey, true);
        } catch (err) { return void warnSaveFailed(err); }   // 옛 파일은 그대로 둠
        for (const id of Object.keys(ownerOf)) if (ownerOf[id] === oldKey) ownerOf[id] = newKey;
        loaded.delete(oldKey); loaded.delete(newKey);
    });
    on(t.SETTINGS_UPDATED, remember);
    on(t.PERSONA_CHANGED, () => { if (kindsOf().persona) remember(); });
    // 캐릭터 카드 칸이 바뀌면(저장판 '사용' · 직접 고침) 캐릭터 AU 를 따라 기억
    on(t.CHARACTER_EDITED, () => { if (kindsOf().card) remember(); });
    // 로어북 항목을 켜고 끄면(월드인포 편집 창) 그 상태를 기억. 로어북을 저장할 때마다 오므로 몰아서 한 번만 다시 읽음
    on(t.WORLDINFO_UPDATED, () => { if (S.restoring || !kindsOf().world) return; clearTimeout(wiTimer); wiTimer = setTimeout(() => refreshEntries().then(remember), 400); });
    // 프리셋을 바꾸는 동안(설정이 여러 번 저장됨)은 기억하지 않다가, 다 바뀐 뒤 그 프리셋 기준으로 처리
    on(t.OAI_PRESET_CHANGED_BEFORE, () => { if (!S.restoring) S.switching = true; });
    on(t.OAI_PRESET_CHANGED_AFTER, () => setTimeout(() => { if (live) onPresetChanged(); }, 300));
    // 연결 프로필 · 공급자 · 모델을 바꾸면 (연결을 기억하는 채팅에서) 기억
    const onConnection = () => { if (kindsOf().connection) remember(); };
    on(t.CONNECTION_PROFILE_LOADED, onConnection);
    on(t.CHATCOMPLETION_SOURCE_CHANGED, onConnection);
    on(t.CHATCOMPLETION_MODEL_CHANGED, onConnection);
    on(t.GENERATION_STARTED, (type, _opts, dryRun) => { if (!dryRun && type !== 'quiet') remember(); });
}

/** 화면이 다 뜬 뒤 한 번: 주인이 없어진 기억 파일을 지우고, 설정 파일에 남은 예전 몸통을 캐릭터 파일로 옮김 */
function afterAppReady() {
    if (yieldToOther() || !live) return;
    syncAuOption(); renderBar();
    pruneFiles().catch(err => console.warn(LOG, 'prune', err));
    (async () => { for (const k of Object.keys(settings().byChar)) if (settings().byChar[k]?.byPreset) await loadOwner(k); })().catch(err => console.warn(LOG, 'move last', err));
}

/** 켜기. 다른 쪽이 이미 올라와 있으면 아무것도 달지 않고 false. whenOther = 돌던 중 다른 쪽이 올라와 물러났을 때 부를 것 */
export async function start(whenOther) {
    if (live) return true;
    if (otherRunning()) return false;
    globalThis[API] = mine;
    live = true;
    onOther = whenOther;
    if (!document.getElementById(STYLE_ID)) document.head.append(Object.assign(document.createElement('link'), { id: STYLE_ID, rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }));
    settings();
    await loadKo();
    if (!live) return false;   // 글을 읽는 사이에 꺼짐
    loadOwner(charKey());
    bindEvents();
    watchPromptManager();
    // 화면이 다 뜨기 전에 켜졌으면 다 뜬 신호를 기다리고, 이미 뜬 뒤(설정 창에서 켬)면 바로. 이미 열려 있는 채팅도 그때부터 기억한다
    const c = ctx();
    if (document.getElementById('preloader')) on(c.event_types.APP_READY, afterAppReady);
    else { afterAppReady(); if (live && c.getCurrentChatId()) void onChatChanged().catch(err => console.warn(LOG, err)); }
    return true;
}

/** 끄기: 단 것을 전부 떼고 줄을 걷음. 이미 예약된 기억 저장은 그대로 끝낸다(바꾼 것을 잃지 않게) */
export function stop() {
    if (!live) return;
    live = false;
    const es = ctx().eventSource;
    for (const [ev, fn] of bound) es.removeListener(ev, fn);
    bound = [];
    clearTimeout(wiTimer); clearTimeout(S.saveTimer);
    S.seq++;                         // 돌고 있던 '채팅 열 때 맞추기'가 더 나아가지 않게
    S.ready = false; S.readyChat = null; S.switching = false;
    unwatchPromptManager();
    document.getElementById(STYLE_ID)?.remove();
    if (globalThis[API] === mine) delete globalThis[API];
}

export const running = () => live;
