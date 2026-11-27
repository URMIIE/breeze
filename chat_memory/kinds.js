// 이 채팅 기억: 종류마다(프롬프트 · 연결 · 정규식 · 월드인포 · 페르소나 AU · 캐릭터 AU) 지금 상태를 읽고, 기억한 상태로 맞추기.
import { oai_settings, promptManager, getPresetApplicationPromise, getChatCompletionModel } from '../../../../openai.js';
import { extension_settings } from '../../../../extensions.js';
import { selected_world_info, world_names, world_info } from '../../../../world-info.js';
import { getScriptsByType, saveScriptsByType, SCRIPT_TYPES } from '../../../regex/engine.js';
import { user_avatar, setUserAvatar } from '../../../../personas.js';
import { power_user } from '../../../../power-user.js';
import { t as coreT } from '../../../../i18n.js';
import { LOG, KINDS, KIND_GROUPS, ctx, toast, nfc, tr, S, settings } from './shared.js';
import { memory, currentPreset } from './files.js';

/** 프리셋 이름 → 그 프리셋에서 기억한 토글 (예전 꼴 {preset, toggles} 도 읽음) */
export function togglesFor(mem, preset) {
    if (!mem) return null;
    const hit = Object.entries(mem.byPreset || {}).find(([k]) => nfc(k) === nfc(preset));
    if (hit) return hit[1];
    return nfc(mem.preset) === nfc(preset) ? mem.toggles || null : null;
}

/** 이 채팅이 기억하는 종류 (채팅마다 고른 것, 없으면 설정의 기본값) */
export const rawKinds = (mem = memory()) => ({ ...settings().kinds, ...(mem?.kinds || {}) });
// 페르소나 종류는 페르소나마다 버전(AU)을 고르는 확장이 켜져 있을 때만 보이고 작동 (그 확장의 빠른 전환 버튼로 판단)
export const auReady = () => !!document.getElementById('ps-quick-trigger');
// 캐릭터 AU 는 캐릭터 카드 칸마다 여러 판을 저장해 두는 확장이 켜져 있고(그 확장의 버튼로 판단) 지금 캐릭터 카드에 저장판이 있을 때만
export const cardReady = () => !!document.querySelector('.alt_fields_button');
export const kindReady = k => k === 'persona' ? auReady() : k === 'card' ? cardReady() && !!cardFields().length : true;
export const kindList = () => KINDS.filter(kindReady);
export const kindsOf = (mem = memory()) => { const k = rawKinds(mem); for (const x of KINDS) if (!kindReady(x)) k[x] = false; return k; };
/** 버튼을 두 묶음으로 (묶음 사이 세로선) */
export const kindPills = (kinds, e) => KIND_GROUPS.map(g => g.filter(kindReady)).filter(g => g.length)
    .map(g => `<span class="cpm-kind-group">${g.map(k => `<button type="button" class="cpm-kind" data-kind="${k}" aria-pressed="${!!kinds[k]}">${e(KIND_LABEL[k]())}</button>`).join('')}</span>`).join('');
export function syncAuOption() {
    for (const pre of ['cpm_kind_', 'cpm_nkind_']) {
        const label = document.getElementById(`${pre}persona`)?.closest('label');
        if (label) label.hidden = !auReady();
        const card = document.getElementById(`${pre}card`)?.closest('label');
        if (card) card.hidden = !cardReady();
    }
    document.querySelectorAll('.cpm-au-word').forEach(x => { x.hidden = !auReady() && !cardReady(); });
}

// 캐릭터 AU: 카드 칸마다 저장해 둔 판 중 지금 어느 판인지 { 저장 키: { t: 판 이름, i: 몇 번째 } } (이름이 같은 판이 있어 순서도 적음): 그 확장의 '사용'처럼 카드 칸 글을 바꿔 넣음(실리태번이 카드를 저장)
export const CARD_FIELDS = [
    { key: 'alt_descriptions', area: 'description_textarea', prop: 'description', label: () => tr`Character description` },
    { key: 'alt_personalities', area: 'personality_textarea', prop: 'personality', label: () => tr`Personality summary` },
    { key: 'alt_scenarios', area: 'scenario_pole', prop: 'scenario', label: () => tr`Scenario` },
    { key: 'alt_example_dialogue', area: 'mes_example_textarea', prop: 'mes_example', label: () => tr`Examples of dialogue` },
    { key: 'alt_main_prompts', area: 'system_prompt_textarea', prop: 'system_prompt', label: () => tr`Main prompt` },
    { key: 'alt_post_history', area: 'post_history_instructions_textarea', prop: 'post_history_instructions', label: () => tr`Post-history instructions` },
];
export function cardChar() {
    const c = ctx();
    if (c.groupId) return null;
    const ch = c.characters?.[c.characterId];
    // 캐릭터 편집 칸이 지금 캐릭터 것일 때만 (다른 캐릭터 칸에 쓰지 않게)
    return ch && document.getElementById('avatar_url_pole')?.value === ch.avatar ? ch : null;
}
/** 지금 캐릭터 카드에서 저장판이 있는 칸 [{ ...칸, list }] */
export function cardFields() {
    const ch = cardChar();
    const alts = ch?.data?.extensions?.alternate_fields || {};
    return CARD_FIELDS.map(f => ({ ...f, list: Array.isArray(alts[f.key]) ? alts[f.key].filter(x => x && typeof x.content === 'string') : [] })).filter(f => f.list.length && document.getElementById(f.area));
}
// 카드 파일엔 줄바꿈이 \r\n 으로 저장되기도 해서 \r 은 빼고 비교
export const same = (a, b) => String(a ?? '').replace(/\r/g, '').trim() === String(b ?? '').replace(/\r/g, '').trim();
export function cardState() {
    const out = {};
    for (const f of cardFields()) {
        const text = document.getElementById(f.area).value;
        const i = f.list.findIndex(x => same(x.content, text));
        if (i >= 0) out[f.key] = { t: f.list[i].title, i };
        else if (!text.trim()) out[f.key] = { e: 1 };   // 빈칸도 하나의 상태로 기억 (빈 시나리오로 돌아갈 수 있게)
    }
    return Object.keys(out).length ? out : null;
}
/** 카드 칸에 글을 넣음: 편집 칸과 메모리의 캐릭터 값을 같이 바꿈.
 *  편집 칸만 바꾸면, 저장되기 전에 실리태번이 채팅을 다시 불러올 때(연결 프로필을 바꿀 때 등) 칸을 메모리의 옛 글로 다시 채워 되돌아갔음 */
export function setCardText(f, text) {
    const ch = cardChar(), area = document.getElementById(f.area);
    if (!ch || !area) return;
    if (f.prop in ch) ch[f.prop] = text;
    if (ch.data) ch.data[f.prop] = text;
    area.value = text;
    area.dispatchEvent(new Event('input', { bubbles: true }));
}
/** 지금 칸 글이 어느 저장판에도 없으면 그 글을 판으로 남김: 다른 판으로 바꾸면 사라지니까. 남긴 판의 순서 (안 남겼으면 -1) */
export async function keepUnsaved(f) {
    const ch = cardChar(), text = document.getElementById(f.area)?.value ?? '';
    if (!ch || !text.trim() || f.list.some(x => same(x.content, text))) return -1;
    const alts = (ch.data.extensions ||= {}).alternate_fields ||= {};
    const list = alts[f.key] ||= [];
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const title = list.some(x => x.title === tr`Original text`) ? `${tr`Edited text`} ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` : tr`Original text`;
    list.push({ title, content: text });
    await ctx().writeExtensionField(ctx().characterId, 'alternate_fields', alts);
    return list.length - 1;
}
/** 기억한 판으로 → 바꾼 칸 [[칸 이름, 판 이름]]: 지금 글이 어느 저장판과도 다르면(직접 고친 글) 그 칸은 건드리지 않음 */
export function applyCard(state) {
    const done = [];
    if (!state) return done;
    for (const f of cardFields()) {
        const want = state[f.key];
        // 순서 · 이름이 둘 다 맞는 판 → 없으면 이름이 같은 첫 판 (판을 지우거나 옮긴 경우)
        const target = want?.e ? { title: tr`Empty`, content: '' } : want && (f.list[want.i]?.title === want.t ? f.list[want.i] : f.list.find(x => x.title === want.t));
        const area = document.getElementById(f.area);
        if (!target || same(target.content, area.value) || (area.value.trim() && !f.list.some(x => same(x.content, area.value)))) continue;
        setCardText(f, target.content);
        done.push([f.label(), target.title]);
    }
    return done;
}

export const REGEX_TYPES = [SCRIPT_TYPES.GLOBAL, SCRIPT_TYPES.PRESET];
export function regexState() {
    const out = {};
    for (const type of REGEX_TYPES) for (const script of getScriptsByType(type, { allowedOnly: false }) || []) if (script?.id) out[script.id] = !script.disabled;
    return out;
}
export const worldState = () => [...selected_world_info].sort();

// 연결: 연결 프로필을 쓰면 그 이름, 아니면 공급자 + 모델
export function connectionState() {
    const cm = extension_settings.connectionManager;
    const profile = cm?.profiles?.find(p => p.id === cm.selectedProfile)?.name || null;
    return profile ? { profile } : { source: oai_settings.chat_completion_source, model: getChatCompletionModel() };
}
/** 기억한 연결로 → 바뀌었으면 true (같으면 아무것도 안 함) */
export async function applyConnection(state) {
    if (!state || JSON.stringify(state) === JSON.stringify(connectionState())) return false;
    if (state.profile) {
        if (!extension_settings.connectionManager?.profiles?.some(p => p.name === state.profile)) {
            toast.warning(tr`Saved connection profile "${state.profile}" was not found.`, tr`Chat Preset Memory`);
            return false;
        }
        await ctx().executeSlashCommandsWithOptions(`/profile await=true ${JSON.stringify(state.profile)}`);
        return true;
    }
    if (!state.source) return false;
    if (oai_settings.chat_completion_source !== state.source) {
        $('#chat_completion_source').val(state.source).trigger('change');
        await new Promise(r => setTimeout(r, 300));
    }
    if (state.model && getChatCompletionModel() !== state.model) {
        // API 연결 칸이 닫혀 있어도 찾게: 화면에 보이는지 말고 그 공급자 칸(data-source)의 모델 목록에서
        const sel = [...document.querySelectorAll('select[id^="model_"][id$="_select"]')].find(x => String(x.closest('[data-source]')?.dataset.source || '').split(',').includes(state.source) && [...x.options].some(o => o.value === state.model));
        if (sel) $(sel).val(state.model).trigger('change');
        else if (state.source === 'custom') $('#custom_model_id').val(state.model).trigger('input');
        if (getChatCompletionModel() !== state.model) toast.warning(tr`Saved model "${state.model}" was not found.`, tr`Chat Preset Memory`);
    }
    return true;
}
export const connectionLabel = st => st?.profile || [st?.source, st?.model].filter(Boolean).join(' · ');

// 페르소나: 지금 페르소나 + (페르소나마다 버전(AU)을 고르는 확장을 쓰면) 그 페르소나에 고른 버전 이름
export const VERSION_KEY = 'st-persona-au-manager';
export const versionsOf = avatar => extension_settings[VERSION_KEY]?.personaHistoryByAvatar?.[avatar] || [];
export const versionOf = avatar => extension_settings[VERSION_KEY]?.activeVersionByAvatar?.[avatar] || '';
export function personaState() {
    if (!user_avatar) return null;
    const au = versionOf(user_avatar);
    return au ? { avatar: user_avatar, au } : { avatar: user_avatar };
}
export const personaName = avatar => power_user.personas?.[avatar] || String(avatar || '').replace(/\.[^.]+$/, '');
export const personaLabel = st => st?.avatar ? personaName(st.avatar) + (st.au ? ` · ${st.au}` : '') : '';
// 실리태번이 채팅을 열며 띄운 알림 하나를 지움 (곧바로 이 확장이 다시 바꿀 때: 알림이 틀린 말이 되지 않게)
// 알림이 조금 늦게 뜰 수도 있어서 2초 동안 새로 뜨는 것도 봄
export function dropToast(match, ms = 2000) {
    const sweep = () => { for (const el of document.querySelectorAll('#toast-container .toast')) if (match(el)) el.remove(); };
    sweep();
    const mo = new MutationObserver(sweep);
    mo.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), ms);
}
/** 기억한 페르소나 · 버전으로 → 바꾼 것 설명(없으면 ''): 채팅에 잠근 페르소나가 있으면 그걸 따름 */
export async function applyPersona(state, stale = () => false) {
    if (!state?.avatar) return '';
    const locked = ctx().chatMetadata?.persona;
    if (locked && locked !== state.avatar) return '';
    if (!power_user.personas?.[state.avatar]) {
        toast.warning(tr`Saved persona "${personaName(state.avatar)}" was not found.`, tr`Chat Preset Memory`);
        return '';
    }
    const notes = [];
    // 실리태번의 채팅 열기(캐릭터 연결 · 기본 페르소나 고르기)가 끝난 뒤에 바꿈: 늦게 끝나면 한 번 더 맞춤
    for (let i = 0; i < 2 && user_avatar !== state.avatar; i++) {
        if (stale()) return '';
        await setUserAvatar(state.avatar, { toastPersonaNameChange: false });
        notes.push(1);
        await new Promise(r => setTimeout(r, 400));
    }
    // 실리태번의 '페르소나 자동 선택' 알림 (번역된 제목 · 영어 본문 둘 다 봄)
    if (notes.length) dropToast(el => [coreT`Persona Auto Selected`, '페르소나 자동 선택됨'].includes(el.querySelector('.toast-title')?.textContent?.trim()) || /Auto-selected persona/i.test(el.querySelector('.toast-message')?.textContent || ''));
    // 버전: 그 확장의 빠른 전환 메뉴 항목을 대신 눌러 그 확장이 직접 적용하게(설명 · 아바타 · 저장)
    if (state.au && user_avatar === state.avatar && versionOf(state.avatar) !== state.au && versionsOf(state.avatar).some(v => v.name === state.au)) {
        const trigger = document.getElementById('ps-quick-trigger');
        if (trigger && !trigger.disabled) {
            trigger.click();
            const item = [...document.querySelectorAll('.ps-quick-menu .ps-quick-item')].find(b => b.title === state.au);
            if (item) item.click(); else document.querySelector('.ps-quick-menu') && trigger.click();
        }
        if (versionOf(state.avatar) === state.au) {
            notes.push(2);
            dropToast(el => el.querySelector('.toast-message')?.textContent?.startsWith(`'${state.au}'`));
        }
    }
    if (!notes.length) return '';
    return notes.includes(2) ? `${personaName(state.avatar)} · ${state.au}` : personaName(state.avatar);
}

// 이 채팅에 걸린 로어북: 전역 선택 · 채팅 로어북 · 캐릭터(그룹이면 멤버들)의 연결 · 추가 로어북
export function activeBooks() {
    const c = ctx(), books = new Set(selected_world_info);
    if (c.chatMetadata?.world_info) books.add(c.chatMetadata.world_info);
    const chars = c.groupId ? (c.groups?.find(g => g.id === c.groupId)?.members || []).map(a => c.characters.find(x => x.avatar === a)).filter(Boolean) : [c.characters?.[c.characterId]].filter(Boolean);
    for (const ch of chars) {
        if (ch.data?.extensions?.world) books.add(ch.data.extensions.world);
        const file = String(ch.avatar || '').replace(/\.[^.]+$/, '');
        world_info?.charLore?.find(e => e.name === file)?.extraBooks?.forEach(b => books.add(b));
    }
    return [...books].filter(n => world_names?.includes(n)).sort();
}
// 로어북 항목 켜짐/꺼짐 { 로어북: { uid: 켜짐 } }: 파일을 읽어야 해서 미리 읽어 두고(refreshEntries) 기억할 때는 그 값을 씀

export async function readEntries() {
    const out = {};
    for (const name of activeBooks()) {
        const data = await ctx().loadWorldInfo(name);
        if (!data?.entries) continue;
        out[name] = {};
        for (const [uid, e] of Object.entries(data.entries)) out[name][uid] = !e.disable;
    }
    return out;
}
export async function refreshEntries() { try { S.lastEntries = await readEntries(); } catch (err) { console.warn(LOG, 'world info', err); } }

/** 지금 상태: 기억하는 종류만 (안 고른 종류는 담지 않아 저장도 안 일어남) */
export function snapshot(kinds = kindsOf()) {
    const snap = { preset: currentPreset() };
    if (kinds.toggles) {
        snap.toggles = {};
        for (const e of promptManager.getPromptOrderForCharacter(promptManager.activeCharacter) || []) snap.toggles[e.identifier] = !!e.enabled;
    }
    if (kinds.world) { snap.world = worldState(); if (S.lastEntries) snap.entries = S.lastEntries; }
    if (kinds.regex) snap.regex = regexState();
    if (kinds.connection) snap.connection = connectionState();
    if (kinds.persona && auReady()) snap.persona = personaState();
    if (kinds.card && cardReady()) { const st = cardState(); if (st) snap.card = st; }
    return snap;
}

export async function switchPreset(name) {
    const opt = [...document.querySelectorAll('#settings_preset_openai option')].find(o => nfc(o.textContent) === nfc(name));
    if (!opt) return false;
    $('#settings_preset_openai').val(opt.value).trigger('change');
    await getPresetApplicationPromise();
    await new Promise(r => setTimeout(r, 300));
    return true;
}

/** 지금 프리셋에 기억한 토글을 맞춤 → 바꾼 개수 */
// 방금 맞추며 바꾼 토글 이름 (알림에서 펼쳐 봄)

export async function applyToggles(toggles) {
    S.lastToggleChanges = { on: [], off: [] };
    if (!toggles) return 0;
    let changed = 0;
    for (const e of promptManager.getPromptOrderForCharacter(promptManager.activeCharacter) || []) {
        if (e.identifier in toggles && !!e.enabled !== toggles[e.identifier]) {
            e.enabled = toggles[e.identifier];
            changed++;
            (e.enabled ? S.lastToggleChanges.on : S.lastToggleChanges.off).push(promptManager.getPromptById(e.identifier)?.name || e.identifier);
        }
    }
    if (changed) {
        // 채팅을 열면 실리태번도 곧 목록을 다시 그림(시험 생성 포함): 미뤄 그리기로 합쳐 시험 생성을 한 번만
        if (typeof promptManager.renderDebounced === 'function') promptManager.renderDebounced(); else promptManager.render();
        // 저장은 기다리지 않음 (기다리는 동안 기억이 늦어지고 화면도 잠깐 멈춤)
        Promise.resolve(promptManager.saveServiceSettings()).catch(err => console.warn(LOG, err));
    }
    return changed;
}

/** 기억한 전역 월드인포만 켜 둠 (없는 이름은 무시) → 바뀌었으면 true */
export function applyWorld(names) {
    if (!Array.isArray(names)) return false;
    const want = names.filter(n => world_names?.includes(n)).sort();
    if (JSON.stringify(want) === JSON.stringify(worldState())) return false;
    $('#world_info').val(want.map(n => String(world_names.indexOf(n)))).trigger('change');
    return true;
}

/** 기억한 로어북 항목 켜짐/꺼짐 → 바꾼 항목 수. 지금 이 채팅에 걸린 로어북만, 바뀐 로어북만 저장 */
export async function applyEntries(state) {
    if (!state) return 0;
    let changed = 0;
    for (const name of activeBooks()) {
        const want = state[name];
        if (!want) continue;
        const data = await ctx().loadWorldInfo(name);
        if (!data?.entries) continue;
        let here = 0;
        for (const [uid, on] of Object.entries(want)) {
            const e = data.entries[uid];
            if (!e || !e.disable === on) continue;
            e.disable = !on;
            here++;
        }
        if (here) { await ctx().saveWorldInfo(name, data, true); ctx().reloadWorldInfoEditor?.(name); changed += here; }
    }
    return changed;
}

/** 기억한 정규식 켜짐/꺼짐 (전역 · 프리셋) → 바꾼 개수. 기억에 없는 정규식은 그대로 */
export async function applyRegex(state) {
    if (!state) return 0;
    let changed = 0;
    for (const type of REGEX_TYPES) {
        const scripts = getScriptsByType(type, { allowedOnly: false }) || [];
        let here = 0;
        for (const script of scripts) {
            if (!script?.id || !(script.id in state) || !script.disabled === state[script.id]) continue;
            script.disabled = !state[script.id];
            here++;
        }
        if (here) { await saveScriptsByType(scripts, type); changed += here; }
    }
    return changed;
}

export const KIND_LABEL = { toggles: () => tr`Preset · toggles`, world: () => tr`World info`, regex: () => tr`Regex`, connection: () => tr`Connection`, persona: () => tr`Persona`, card: () => tr`Character AU` };
