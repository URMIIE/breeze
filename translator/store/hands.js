// 저장을 실제로 읽고 쓰는 손: 실리태번의 파일 올리기 · 설정 · 채팅 자료 · 브라우저 저장소에 닿는 곳은 여기 한 곳이다.
// 시작하는 곳(app.js)이 한 번 만들어 번역 일(job/)과 화면(ui/)에 넘겨준다. 화면은 여기서 내준 것만 부르고 저장에 직접 닿지 않는다.
//
// 내주는 것
//   layers   쓰는 곳 셋(store/layers.js): 사람, 이름, 내 규칙, 설정
//   memory   문단 번역 기억(store/memory.js, 브라우저 저장소)
//   status(key) → Promise<{ rec, save(), flush() }>   그 캐릭터(그룹)의 상태창 번역(store/status.js). save 는 바뀐 것을 모아 저장
//   옛 번역기 자료 이어받기(store/migrate.js): startFromOrigin() · takeChat() · renamed(옛 아바타, 새 아바타)
//   books() → Promise<…>   용어집이 있는 다른 캐릭터 · 그룹(store/terms-from.js). 읽기만 한다

import { createLayers, cardFile } from './layers.js';
import { oldLayer } from './old-layers.js';
import { originSettings, adoptChatStatus, followRename } from './migrate.js';
import { createMemory } from './memory.js';
import { idbStore } from './memory-idb.js';
import { open as openStatus, saver, statusFile, oldStatusFile } from './status.js';
import { ownerOf, castOf } from '../job/sources.js';
import { otherBooks } from './terms-from.js';

/** 글을 base64 로(파일 올리기 API 가 받는 꼴) */
function base64(text) {
    const bytes = new TextEncoder().encode(text);
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(out);
}

/** user/files 의 파일을 읽는다. 없으면 null */
async function loadFile(name) {
    const res = await fetch(`/user/files/${encodeURIComponent(name)}`, { cache: 'no-store' });
    return res.ok ? res.json() : null;
}

/**
 * @param {() => object} context 실리태번 getContext
 */
export function createHands(context) {
    async function saveFile(name, data) {
        const body = JSON.stringify({ name, data: base64(JSON.stringify(data)) });
        const res = await fetch('/api/files/upload', { method: 'POST', headers: context().getRequestHeaders(), body });
        if (!res.ok) throw new Error(`파일을 저장하지 못했어요 (${res.status})`);
    }

    const layers = createLayers({
        settings: () => context().extensionSettings,
        meta: () => (context().getCurrentChatId?.() ? context().chatMetadata : null),
        owner: () => ownerOf(context()),
        cast: () => castOf(context()),
        loadFile, saveFile,
        saveSettings: () => context().saveSettingsDebounced(),
        saveMeta: () => context().saveMetadata(),
    });

    /** user/files 에 있는 파일 이름들(한 번의 요청으로 묻는다) */
    async function exists(names) {
        const urls = names.map(name => `user/files/${name}`);
        const res = await fetch('/api/files/verify', { method: 'POST', headers: context().getRequestHeaders(), body: JSON.stringify({ urls }) });
        if (!res.ok) throw new Error(`파일 목록을 읽지 못했어요 (${res.status})`);
        const found = await res.json();
        return new Set(names.filter((name, i) => found[urls[i]] === true));
    }

    const books = () => otherBooks(context(), { exists, load: loadFile });

    const opened = new Map();   // 캐릭터 열쇠 → 열린 상태창 번역(약속)

    /** 지금 채팅이 그 캐릭터의 것이면 채팅에 남은 옛 상태창 번역을 기록에 보탠다(없는 줄만, 채팅 파일은 건드리지 않는다) */
    function takeInto(key, rec) {
        const c = context(), chatId = String(c.getCurrentChatId?.() ?? '');
        return ownerOf(c)?.key === key ? adoptChatStatus(rec, chatId, c.chatMetadata) : 0;
    }

    async function openFor(key) {
        const name = statusFile(key);
        const data = await loadFile(name).catch(() => null) ?? await loadFile(oldStatusFile(key)).catch(() => null);
        const rec = openStatus(data);
        const keep = saver(rec, saved => saveFile(name, saved));
        takeInto(key, rec);
        return { rec, save: keep.soon, flush: keep.flush };
    }

    /**
     * 상태창 번역을 연다(캐릭터마다 한 번 읽고 같은 기록을 돌려준다). 새 파일이 아직 없으면 옛 번역기의 기록 파일을 읽어 처음 값으로 삼는다(그 파일에는 쓰지 않는다).
     * 읽기만으로는 저장하지 않는다: 줄을 받거나 고치거나 지웠을 때 새 파일에 쓴다.
     */
    function status(key) {
        if (!opened.has(key)) opened.set(key, openFor(key));
        return opened.get(key);
    }

    /** 채팅이 바뀌었을 때: 이미 열어 둔 캐릭터의 기록에 이 채팅의 옛 상태창 번역을 보탠다 → 보탠 줄 수 */
    async function takeChat() {
        const key = ownerOf(context())?.key, handle = key ? opened.get(key) : null;
        return handle ? takeInto(key, (await handle).rec) : 0;
    }

    /** 원작 확장의 설정만 있는 설치본: 함께 읽는 설정 칸이 비어 있으면 원작 설정을 베껴 시작한다 → 베꼈나 */
    function startFromOrigin() {
        const c = context(), values = originSettings(c.extensionSettings);
        if (!values) return false;
        c.extensionSettings['llm-translator-custom'] = values;
        c.saveSettingsDebounced();
        return true;
    }

    /** 새 파일이 없던 캐릭터: 옛 자리에 아바타 이름으로 묶여 있던 것(용어집 · 말투 · 연결 · 보기)을 새 아바타의 파일에 적는다 */
    async function carryFirst(from, to) {
        const es = context().extensionSettings ?? {}, name = cardFile({ key: to });
        const first = oldLayer('card', { old: es['llm-translator-custom'] ?? {}, styles: es.llmt ?? {}, owner: { key: from }, cast: castOf(context()) });
        const has = first.people.length || first.names.length || Object.keys(first.settings).length;
        if (!has || await loadFile(name)) return false;
        await saveFile(name, first);
        return true;
    }

    /**
     * 캐릭터 파일 이름이 바뀌었다(캐릭터 이름 바꾸기): 옛 이름의 해시로 적힌 캐릭터별 파일을 새 이름의 해시로도 적는다. 옛 파일은 지우지 않는다.
     * 그룹의 파일은 그룹 id 로 묶여 있어 캐릭터 이름과 상관없다.
     * @returns {Promise<string[]>} 새로 적은 파일 이름
     */
    async function renamed(from, to) {
        if (!from || !to || from === to) return [];
        try {
            await layers.saving();
            await (await opened.get(from))?.flush();   // 아직 파일에 안 적힌 줄까지 새 이름으로 가게
            const card = [cardFile({ key: from }), cardFile({ key: to })];
            const written = await followRename([card, [statusFile(from), statusFile(to)], [oldStatusFile(from), statusFile(to)]], { load: loadFile, save: saveFile });
            if (!written.includes(card[1]) && await carryFirst(from, to)) written.push(card[1]);
            return written;
        } catch (error) { console.warn('[번역] 이름을 바꾼 캐릭터의 번역 자료를 새 이름으로 적지 못했어요', error); return []; }
    }

    return { layers, memory: createMemory(idbStore), status, takeChat, startFromOrigin, renamed, books };
}
