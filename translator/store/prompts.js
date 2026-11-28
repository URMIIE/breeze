// 번역 프롬프트 자료: 목록, 지금 고른 것, 언어마다 정해 둔 것, 고르기 · 언어별로 정하기 · 글 고치기 · 새로 만들기 · 지우기 · 이름 바꾸기 · 되돌리기.
// 화면이 부를 것은 여기 하나에 모았다. 실리태번을 모른다: 설정 객체(extension_settings)와 layers(store/layers.js createLayers 의 값)를 넘겨받는다.
//
// 프롬프트가 있는 자리
//   옛 번역 확장의 저장 자리(읽기만, store/settings.js): 기본 칸 하나 + 만들어 둔 프롬프트들, 골라 둔 것, 언어마다 정해 둔 것.
//     그래서 예전에 쓰던 프롬프트는 옮기지 않아도 목록에 그대로 보이고 번역에 쓰인다. 이 자리는 고치지도 지우지도 않는다.
//   새 번역기에 든 기본 글(store/prompt-default.js, 원래 번역 확장의 기본값 한 줄): 옛 자리의 기본 칸에 글이 없는 사람에게만
//     기본 칸('채팅 번역 프롬프트')의 글로 쓰이고 보인다. 옛 자리에 글이 있으면 그 글이 기본 칸이라 목록에 같은 것이 두 번 나오지 않는다.
//   새 자리(쓰는 곳 '모든 채팅', 고칠 때만 적는다): 고른 것 settings.prompt, 언어마다 정한 것 promptByLanguage,
//     prompts[id] = { text 고친 글, title 바꾼 이름, made 새로 만든 것, removed 목록에서 뺀 것, use 쓰임('prefill' | 'redo', 없으면 번역) }.
//     쓰임은 새 자리에만 적는다: 옛 자리의 꼴은 그대로라 옛 확장으로 돌아가도 프롬프트가 그대로 보인다.
//     옛 자리에서 온 프롬프트를 지우면 옛 자리는 그대로 두고 removed 만 적는다(기본 칸도 같다: 옛 자리의 글은 그대로).
//     번역용 프롬프트는 어느 것이든 지울 수 있고, 번역용이 하나만 남으면 그 하나는 못 지운다(번역에 쓸 것이 늘 하나는 있다).
//     고른 것만은 다른 설정처럼 지금 그 값이 있는 쓰는 곳(이 채팅 · 이 캐릭터 전용이면 거기)에 적힌다.
//
// 어느 프롬프트가 쓰이나
//   고른 것이 프롬프트 id(목록에 있는 것) → 언어와 상관없이 그 프롬프트
//   그 밖('auto', 없음, 목록에 없는 id)   → 답의 원문 언어에 정해 둔 것(새 자리 → 옛 자리) → 옛 자리에서 골라 둔 것 → 남은 번역용 가운데 첫째(기본 칸이 있으면 기본 칸)
//
// 내보내는 것(es = extension_settings, layers = createLayers 의 값)
//   AUTO                                   'auto': 언어에 맞춰 고르기
//   LANGUAGES                              ['en', 'zh', 'ja']: 원문 언어 종류(core/lang.js sourceLanguage 가 돌려주는 값 전부)
//   USES                                   ['body', 'prefill', 'redo']: 쓰임(번역 · 프리필 · 재번역). 적힌 것이 없으면 'body'
//   promptList(es, layers)                 → [{ id, title, text, source, use, edited, canRemove, canReset, canMove }]  쓰임이 번역인 것만.
//                                             기본 칸 → 옛 자리에서 만든 것 → 새로 만든 것 차례, 뺀 것은 없다. 번역에 쓰이는 것 · 고르는 목록은 모두 이 목록이다
//                                             text 지금 쓰이는 글 · source 'old' 옛 저장 자리 | 'made' 새로 만든 것 | 'builtin' 옛 자리에 글이 없어 기본 글을 쓰는 기본 칸
//                                             edited 글이나 이름을 고쳤나 · canRemove 지울 수 있나(번역용이 하나만 남으면 그 하나는 못 지움) · canReset 고치기 전으로 되돌릴 수 있나
//                                             canMove 쓰임을 바꿀 수 있나(기본 칸은 늘 번역)
//   promptsFor(es, layers, use)            → 그 쓰임의 프롬프트(promptList 와 같은 꼴과 차례)
//   setPromptUse(es, layers, id, use)      → true | false(목록에 없는 id · 기본 칸 · 모르는 쓰임).  번역에서 빼면 그것을 쓰던 곳은 다음 차례로 넘어간다(지울 때와 같다)
//   addPromptText(es, layers, title, text, use) → 새 프롬프트 id | ''(이름이 빔).  글을 그대로 넣어 만든다(프리필 · 재번역 자리의 새로 추가)
//   keepUnsaved(es, layers, use, text, now?) → 남긴 id | ''.  그 쓰임의 목록에 없는 글이면 '저장 안 된 글 월.일 시:분'으로 남긴다(목록에서 골라 칸을 덮기 전에)
//   chosenPrompt(es, layers)               → { id, from }  id 'auto' 또는 프롬프트 id · from 그 값이 적힌 쓰는 곳 'chat' | 'card' | 'all' | null(적힌 적 없음)
//   promptInUse(es, layers, lang)          → { id, title, text }  이 언어의 답에 지금 실제로 쓰이는 프롬프트
//   languagePrompts(es, layers)            → [{ lang, id, from, used: { id, title } }]  언어마다 하나씩(LANGUAGES 차례)
//                                             id 정해 둔 프롬프트('' = 정하지 않음) · from 'new' 새 자리 | 'old' 옛 자리 | ''
//                                             used 언어에 맞춰 고를 때 이 언어에 쓰일 프롬프트
//   choosePrompt(es, layers, id)           → 적힌 쓰는 곳 | null(목록에 없는 id 라 적지 않음).  id 'auto' 또는 프롬프트 id
//   setLanguagePrompt(es, layers, lang, id) → true | false(모르는 언어 · 목록에 없는 id).  id '' = 정하지 않음으로
//   setPromptText(es, layers, id, text)    → true | false(목록에 없는 id)
//   addPrompt(es, layers, title, fromId)   → 새 프롬프트 id | ''(이름이 빔).  글은 fromId 프롬프트의 지금 글을 베낀다(없으면 빈 글)
//   renamePrompt(es, layers, id, title)    → true | false(목록에 없는 id · 빈 이름)
//   removePrompt(es, layers, id)           → true | false(목록에 없는 id · 번역용 마지막 하나).  이 프롬프트를 쓰던 곳은 위 차례의 다음 것으로 넘어간다
//   resetPrompt(es, layers, id)            → true | false(되돌릴 것이 없음).  고친 글과 바꾼 이름을 버린다
//   promptFor(es, view, lang)              → { id, title, text }  promptInUse 의 속(view = layers.view()). 번역 재료를 모을 때 쓴다(job/sources.js)
// 고치는 것들은 layers 가 모아서 저장한다(같은 틱의 고침은 한 번).

import { promptsOf, oldPicks, CHAT_PROMPT } from './settings.js';
import { DEFAULT_TEXT } from './prompt-default.js';

export const AUTO = 'auto';
export const USES = ['body', 'prefill', 'redo'];
export const LANGUAGES = ['en', 'zh', 'ja'];

const isAuto = id => !id || id === AUTO;
const newId = () => `made-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 적힌 쓰임(모르는 값 · 기본 칸은 번역) */
const useOf = (id, own) => (id !== CHAT_PROMPT && USES.includes(own?.use) ? own.use : 'body');

/** 새 자리에 적힌 것을 입힌 한 줄(뺀 것은 null) */
function dressed(base, own) {
    if (own?.removed) return null;
    const text = typeof own?.text === 'string' ? own.text : null, title = typeof own?.title === 'string' && own.title.trim() ? own.title : null;
    const edited = base.source !== 'made' && (text !== null || title !== null);
    const fixed = base.id === CHAT_PROMPT;
    return { ...base, title: title ?? base.title, text: text ?? base.text, use: useOf(base.id, own), edited, canRemove: true, canReset: edited, canMove: !fixed };
}

/** 번역에 쓰는 목록: 쓰임이 번역인 것만(프리필 · 재번역으로 옮긴 것은 고르지도 쓰이지도 않는다). 하나만 남으면 그 하나는 못 지운다 */
function listOf(es, view) {
    const body = allOf(es, view).filter(p => p.use === 'body');
    return body.length > 1 ? body : body.map(p => ({ ...p, canRemove: false }));
}

/** 쓰임과 상관없는 모든 프롬프트: 기본 칸(옛 자리에 글이 없으면 기본 글) → 옛 자리에서 만든 것 → 새로 만든 것. 기본 칸은 늘 있다 */
function allOf(es, view) {
    const own = view.prompts ?? {};
    const old = promptsOf(es).map(p => (p.text ? { ...p, source: 'old' } : { ...p, text: DEFAULT_TEXT, source: 'builtin' }));
    const made = Object.entries(own).filter(([, p]) => p?.made).map(([id]) => ({ id, title: '', text: '', source: 'made' }));
    return [...old, ...made].map(p => dressed(p, own[p.id])).filter(Boolean);
}

/** 이 언어에 정해 둔 것: 새 자리에 그 언어 칸이 있으면 그것(빈 글 = 정하지 않음), 없으면 옛 자리. 목록에 없는 프롬프트를 가리키면 정하지 않은 것으로 */
function languageChoice(es, view, list, lang) {
    const own = view.promptByLanguage ?? {}, mine = Object.hasOwn(own, lang);
    const id = String((mine ? own[lang] : oldPicks(es).byLanguage[lang]) ?? '');
    return list.some(p => p.id === id) ? { id, from: mine ? 'new' : 'old' } : { id: '', from: mine ? 'new' : '' };
}

/** 언어에 맞춰 고를 때 이 언어에 쓰일 것 */
function autoPrompt(es, view, list, lang) {
    const ids = [languageChoice(es, view, list, lang).id, oldPicks(es).selected];
    for (const id of ids) { const found = list.find(p => p.id === id); if (found) return found; }
    // 번역용은 늘 하나 이상 남는다(마지막 하나는 지우거나 옮기지 못한다). 그래도 비었으면 기본 글로 번역한다
    return list[0] ?? { id: CHAT_PROMPT, title: '채팅 번역 프롬프트', text: DEFAULT_TEXT };
}

const brief = p => ({ id: p.id, title: p.title, text: p.text });
// 고치기 · 지우기 · 되돌리기 · 쓰임 바꾸기는 쓰임과 상관없이 찾는다(프리필 · 재번역 자리에서도 고친다)
const find = (es, layers, id) => allOf(es, layers.view()).find(p => p.id === String(id));
const findBody = (es, layers, id) => listOf(es, layers.view()).find(p => p.id === String(id));

export function promptFor(es, view, lang) {
    const list = listOf(es, view);
    const chosen = isAuto(view.settings.prompt) ? null : list.find(p => p.id === view.settings.prompt);
    return brief(chosen ?? autoPrompt(es, view, list, lang));
}

export const promptList = (es, layers) => listOf(es, layers.view());

export const promptsFor = (es, layers, use) => allOf(es, layers.view()).filter(p => p.use === use);

export function setPromptUse(es, layers, id, use) {
    const found = find(es, layers, id);
    if (!found?.canMove || !USES.includes(use) || (use !== 'body' && lastBody(es, layers, found))) return false;
    layers.setPrompt(found.id, { use: use === 'body' ? undefined : use });
    return true;
}

export function addPromptText(es, layers, title, text, use) {
    const name = String(title ?? '').trim();
    if (!name) return '';
    const id = newId();
    layers.setPrompt(id, { made: true, title: name, text: String(text ?? ''), ...(USES.includes(use) && use !== 'body' ? { use } : {}) });
    return id;
}

/**
 * 글 칸의 글이 그 쓰임의 목록 어느 것과도 같지 않으면(어디에도 저장 안 된 글) 목록에 한 줄로 남긴다. 목록에서 다른 것을 골라 칸을 덮기 전에 부른다.
 * @returns {string} 남긴 프롬프트 id. 빈 글이거나 이미 같은 글이 있으면 ''
 */
export function keepUnsaved(es, layers, use, text, now = new Date()) {
    const body = String(text ?? '');
    if (!body.trim() || allOf(es, layers.view()).some(p => p.use === use && p.text === body)) return '';
    const two = n => String(n).padStart(2, '0');
    const when = `${two(now.getMonth() + 1)}.${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`;
    return addPromptText(es, layers, `저장 안 된 글 ${when}`, body, use);
}

export function chosenPrompt(es, layers) {
    const view = layers.view(), id = view.settings.prompt;
    const found = !isAuto(id) && listOf(es, view).some(p => p.id === id);
    return { id: found ? id : AUTO, from: view.from.prompt ?? null };
}

export const promptInUse = (es, layers, lang) => promptFor(es, layers.view(), lang);

export function languagePrompts(es, layers) {
    const view = layers.view(), list = listOf(es, view);
    return LANGUAGES.map(lang => {
        const used = autoPrompt(es, view, list, lang);
        return { lang, ...languageChoice(es, view, list, lang), used: { id: used.id, title: used.title } };
    });
}

export function choosePrompt(es, layers, id) {
    if (!isAuto(id) && !findBody(es, layers, id)) return null;
    return layers.setSetting('prompt', isAuto(id) ? AUTO : String(id));
}

export function setLanguagePrompt(es, layers, lang, id) {
    if (!LANGUAGES.includes(lang) || (id && !findBody(es, layers, id))) return false;
    layers.setLanguagePrompt(lang, id ? String(id) : '');
    return true;
}

export function setPromptText(es, layers, id, text) {
    if (!find(es, layers, id)) return false;
    layers.setPromptText(String(id), text);
    return true;
}

export function addPrompt(es, layers, title, fromId) {
    const name = String(title ?? '').trim();
    if (!name) return '';
    const id = newId();
    layers.setPrompt(id, { made: true, title: name, text: find(es, layers, fromId)?.text ?? '' });
    return id;
}

export function renamePrompt(es, layers, id, title) {
    const name = String(title ?? '').trim();
    if (!name || !find(es, layers, id)) return false;
    layers.setPrompt(String(id), { title: name });
    return true;
}

/** 번역용 가운데 마지막 하나인가(지우거나 다른 쓰임으로 옮기면 번역에 쓸 것이 없어진다) */
const lastBody = (es, layers, found) => found.use === 'body' && listOf(es, layers.view()).length <= 1;

export function removePrompt(es, layers, id) {
    const found = find(es, layers, id);
    if (!found || lastBody(es, layers, found)) return false;
    // 새로 만든 것은 칸째 지우고, 옛 자리에서 온 것은 뺐다는 표시만 남긴다(옛 자리는 그대로)
    layers.setPrompt(found.id, found.source === 'made' ? null : { removed: true, text: undefined, title: undefined });
    return true;
}

export function resetPrompt(es, layers, id) {
    const found = find(es, layers, id);
    if (!found?.canReset) return false;
    layers.setPrompt(found.id, { text: undefined, title: undefined });
    return true;
}
