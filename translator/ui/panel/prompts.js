// 번역 프롬프트(시안 t2-settings-plan.html 의 promptPart): 맨 위 고르는 목록 두 줄(답 언어마다 따로 | 하나로), 고른 줄 바로 아래에
// 언어별 줄 셋 또는 '쓸 프롬프트' 한 줄(고르는 칸과 고치기), 프롬프트 목록(이름과 글 고치기 · 지우기 · 고치기 전으로 · 새 프롬프트), 다시 번역 프롬프트.
// 판의 '번역 프롬프트' 화면과 breeze 설정 창의 번역 칸(inline.js)이 같은 것을 그린다.
// 자료는 store/prompts.js 와 store/redo-prompts.js 만 부른다(둘 다 쓰는 곳 층 layers 로 적는다).
//
// drawPrompts(box, api, { label, list }) → { refresh(), close() }
//   label: 줄 앞에 '번역 프롬프트' 이름을 둘지(번역 칸). list: 프롬프트 목록을 펴 둘지(PC 오른쪽 칸)
//   api.layers, api.refresh(), api.lang?(): 지금 채팅 답의 언어('' = 채팅 없음)

import { registerScreen } from './screens.js';
import { esc, SV, IC } from './text.js';
import { foldHtml, selHtml, picksHtml, wire, openFolds, setFold } from './motion.js';
import { langNow, hasChat } from './open-data.js';
import * as P from '../../store/prompts.js';
import { readRedoPrompt, setRedoPrompt } from '../../store/redo-prompts.js';
import { useListHtml, useListClick, useListKey } from './use-list.js';
import { openFull } from './full-text.js';

const LANG_NAME = { en: '영어 답', zh: '중국어 답', ja: '일본어 답' };
// 맨 위 두 줄: 값, 이름, 작은 설명
const MODES = [['auto', '답 언어마다 따로 정하기', '영어, 중국어, 일본어 답마다 다른 프롬프트를 써요'], ['one', '프롬프트 하나로 정하기', '답이 어느 언어든 같은 프롬프트를 써요']];
const nameOf = p => p?.title || '이름 없는 프롬프트';
// 글 칸 오른쪽 위의 '편집기 크게' 버튼(실리태번의 그 버튼과 같은 그림). 글 칸과 한 상자에 둔다
const FULL = '<button type="button" class="btr-full-open" data-act="full" aria-label="편집기 크게"><i class="fa-solid fa-maximize" aria-hidden="true"></i></button>';
const areaHtml = (field, label, text) => `<div class="btr-full-wrap"><textarea class="input btr-prompts-text" data-field="${field}" spellcheck="false" aria-label="${label}">${esc(text)}</textarea>${FULL}</div>`;

const pen = id => `<div class="sel penb" data-t="${esc(id)}" role="button" tabindex="0" aria-label="프롬프트 고치기"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></div>`;

/** 프롬프트 하나를 고치는 자리: 이름, 글, 버튼들. 펼 때 채운다(목록이 길어도 글을 미리 넣어 두지 않는다) */
function editorHtml(p, draft) {
    return `<div class="ed" data-edit="${esc(p.id)}">
<div class="lab">이름</div><input type="text" class="input" data-field="title" value="${esc(draft.title)}" aria-label="프롬프트 이름">
<div class="lab">내용</div>${areaHtml('text', '프롬프트 내용', draft.text)}
<div class="acts">${p.canRemove ? '<button type="button" class="go line sm" data-act="remove">지우기</button>' : ''}${p.canReset ? '<button type="button" class="go line sm" data-act="reset">고치기 전으로</button>' : ''}<button type="button" class="go sm" data-act="save">저장</button></div></div>`;
}

/** 맨 위 고르는 줄 하나(보기 화면의 고르는 목록과 같은 꼴: 이름과 작은 설명, 동그라미) */
const modeRow = ([mode, name, note], on) =>
    `<div class="rule" data-mode="${mode}" role="button" tabindex="0"><span>${name}<small>${note}</small></span><i class="radio${on ? ' on' : ''}"></i></div>`;

/** 하나로일 때 고른 줄 아래: 사용 프롬프트 고르는 칸 + 고치기, 그 아래로 펴지는 프롬프트 이름들 */
const oneHtml = (s, choices) => `<div class="kids"><div class="two in"><span>사용 프롬프트</span><div class="prow">${selHtml('prompt', nameOf(s.list.find(p => p.id === s.chosen.id)))}${pen('etop')}</div></div>
${foldHtml('prompt', false, picksHtml('prompt', choices, s.chosen.id))}${foldHtml('etop', false, '')}</div>`;

function html(s, { label, list }, redoList) {
    const auto = s.chosen.id === P.AUTO;
    const choices = s.list.map(p => ({ value: p.id, label: nameOf(p) }));
    const langs = s.langs.map(l => `<div class="two in"><span>${LANG_NAME[l.lang]}${l.lang === s.lang ? '<b class="bdg now">지금 채팅</b>' : ''}</span><div class="prow">${selHtml(`p-${l.lang}`, nameOf(l.used))}${pen(`e-${l.lang}`)}</div></div>
${foldHtml(`p-${l.lang}`, false, picksHtml(`p-${l.lang}`, choices, l.used.id))}${foldHtml(`e-${l.lang}`, false, '')}`).join('');
    const usedBy = id => (auto ? s.langs.filter(l => l.used.id === id).map(l => `<b class="bdg">${LANG_NAME[l.lang]}</b>`).join('') : '');
    const rows = s.list.map(p => `<div class="rule"><span>${esc(nameOf(p))}${usedBy(p.id)}</span><i class="fa-solid fa-pen-to-square" data-t="el-${esc(p.id)}" role="button" tabindex="0" aria-label="${esc(nameOf(p))} 고치기"></i></div>${foldHtml(`el-${p.id}`, false, '')}`).join('');
    const fresh = `<div class="ed"><div class="lab">이름</div><input type="text" class="input" data-field="new" placeholder="새 프롬프트 이름" enterkeyhint="done" aria-label="새 프롬프트 이름">
<div class="note">지금 쓰는 프롬프트의 글을 베껴서 만들어요</div><div class="acts"><button type="button" class="go sm" data-act="make">만들기</button></div></div>`;
    const head = label ? `<div class="two solo btr-prompts-head"><span>${IC('pen-nib')}번역 프롬프트</span></div>` : '';
    return `${head}<div class="group btr-prompts-mode">${modeRow(MODES[0], auto)}${foldHtml('langs', auto, `<div class="kids">${langs}</div>`)}
${modeRow(MODES[1], !auto)}${foldHtml('one', !auto, auto ? '' : oneHtml(s, choices))}</div>
<div class="gh${list ? ' up' : ''}" data-t="plist" role="button" tabindex="0"><i class="fa-solid fa-list-ul" aria-hidden="true"></i>프롬프트 목록<small>${s.list.length}개</small>${SV('down')}</div>
${foldHtml('plist', list, `<div class="card">${rows}<span class="add" data-t="pnew" role="button" tabindex="0">${SV('plus')}새 프롬프트</span>${foldHtml('pnew', false, fresh)}</div>`)}
<div class="gh" data-t="redo" role="button" tabindex="0"><i class="fa-solid fa-rotate" aria-hidden="true"></i>재번역 프롬프트<small></small>${SV('down')}</div>
${foldHtml('redo', false, `<div class="card btr-prompts-redo">${areaHtml('redo', '재번역 프롬프트', s.redo)}
<div class="acts btr-prompts-redoacts"><span class="note">비어 있으면 재번역도 평소 번역 프롬프트로 보내요</span><button type="button" class="go sm" data-act="redo-save">저장</button></div>${redoList}</div>`)}`;
}

export function drawPrompts(box, api, options = {}) {
    const root = document.createElement('div');
    root.className = 'btr-prompts inst';
    box.append(root);
    const context = () => SillyTavern.getContext(), es = () => context().extensionSettings, layers = api.layers;
    const drafts = {};   // 고치던 이름과 글: 프롬프트 id → { title, text }(다시 그려도 남는다)
    let redoDraft = null, listOpen = Boolean(options.list);
    const uses = {};   // 재번역 자리의 저장해 둔 목록(use-list.js)이 펴 둔 것

    const lang = () => api.lang?.() ?? (hasChat(context()) ? langNow(context()) : '');
    const read = () => ({
        list: P.promptList(es(), layers), chosen: P.chosenPrompt(es(), layers), langs: P.languagePrompts(es(), layers), lang: lang(),
        redo: redoDraft ?? readRedoPrompt(layers.view()).text,
    });
    /** 고치는 자리의 id 가 가리키는 프롬프트 */
    function promptOf(foldId, s) {
        if (foldId === 'etop') return s.list.find(p => p.id === s.chosen.id);
        if (foldId.startsWith('e-')) return s.list.find(p => p.id === s.langs.find(l => l.lang === foldId.slice(2))?.used.id);
        return foldId.startsWith('el-') ? s.list.find(p => p.id === foldId.slice(3)) : null;
    }
    /** 펴진 고치는 자리의 안을 채운다 */
    function fill(foldId, s = read()) {
        const p = promptOf(foldId, s), inner = [...root.querySelectorAll('.fold[data-f]')].find(f => f.dataset.f === foldId)?.firstElementChild;
        if (p && inner && !inner.firstElementChild) inner.innerHTML = editorHtml(p, drafts[p.id] ?? { title: p.title, text: p.text });
    }
    /** 재번역 글 칸 아래의 저장해 둔 재번역 목록. 고르면 그 글을 재번역 프롬프트로 저장한다 */
    const redoList = () => ({
        use: 'redo', es: es(), layers, state: uses, current: () => redoDraft ?? readRedoPrompt(layers.view()).text,
        pick: text => { setRedoPrompt(layers, text); redoDraft = null; api.notice?.('넣었어요.'); api.refresh(); },
        repaint: () => paint(), notice: text => api.notice?.(text),
    });
    function paint() {
        const open = openFolds(root).filter(id => id !== 'langs' && id !== 'one'), s = read(), top = root.closest('.btr-frame-scroll, .btr-inline')?.scrollTop;
        root.innerHTML = html(s, { ...options, list: listOpen }, useListHtml(redoList()));
        for (const id of open) { if (setFold(root, id, true)) fill(id, s); }
        if (top != null) root.closest('.btr-frame-scroll, .btr-inline').scrollTop = top;
    }
    function onPick(id, value) {
        if (id === 'prompt') P.choosePrompt(es(), layers, value);
        else if (id.startsWith('p-')) P.setLanguagePrompt(es(), layers, id.slice(2), value);
        api.refresh();
    }
    /** 맨 위 고르는 줄: 하나로 처음 바꿀 때는 지금 채팅 언어(채팅이 없으면 첫 언어)에 쓰이던 프롬프트를 고른다 */
    function chooseMode(mode) {
        const auto = P.chosenPrompt(es(), layers).id === P.AUTO;
        if (mode === 'auto' && !auto) P.choosePrompt(es(), layers, P.AUTO);
        else if (mode === 'one' && auto) { P.choosePrompt(es(), layers, P.promptInUse(es(), layers, lang() || P.LANGUAGES[0]).id); }
        else return;
        api.refresh();
    }
    function onFold(id, on) {
        if (id === 'plist') listOpen = on;
        if (on) fill(id);
    }
    function save(id) {
        const draft = drafts[id], now = P.promptList(es(), layers).find(p => p.id === id);
        if (!draft || !now || !draft.title.trim()) return;
        if (draft.text !== now.text) P.setPromptText(es(), layers, id, draft.text);
        if (draft.title.trim() !== now.title) P.renamePrompt(es(), layers, id, draft.title);
        delete drafts[id];
        api.notice?.('저장했어요.');
    }
    function make(input) {
        const from = P.promptInUse(es(), layers, lang() || P.LANGUAGES[0]).id, id = P.addPrompt(es(), layers, input.value, from);
        if (!id) { input.focus(); return; }
        listOpen = true;
        api.refresh();
        setFold(root, `el-${id}`, true); fill(`el-${id}`);
    }
    function onClick(event) {
        if (useListClick(event.target, redoList())) return;
        const mode = event.target.closest('[data-mode]');
        if (mode && root.contains(mode)) return chooseMode(mode.dataset.mode);
        const button = event.target.closest('[data-act]');
        if (!button || !root.contains(button)) return;
        const act = button.dataset.act, id = button.closest('[data-edit]')?.dataset.edit;
        if (act === 'full') return showFull(button.parentElement.querySelector('textarea'), id);
        if (act === 'make') return make(button.closest('.ed').querySelector('[data-field="new"]'));
        if (act === 'redo-save') { setRedoPrompt(layers, redoDraft ?? readRedoPrompt(layers.view()).text); redoDraft = null; api.notice?.('저장했어요.'); }
        else if (act === 'save') save(id);
        else if (act === 'reset') { P.resetPrompt(es(), layers, id); delete drafts[id]; }
        else if (act === 'remove') { P.removePrompt(es(), layers, id); delete drafts[id]; }
        api.refresh();
    }
    // 적는 동안은 다시 그리지 않고 적던 것만 들고 있는다
    function onInput(event) {
        const field = event.target.dataset?.field, id = event.target.closest('[data-edit]')?.dataset.edit;
        if (field === 'redo') keep('', 'text', event.target.value);
        else if (id && (field === 'title' || field === 'text')) keep(id, field, event.target.value);
    }
    /** 적던 글을 들고 있는다(프롬프트 id 가 없으면 재번역 프롬프트) */
    function keep(id, field, value) {
        if (!id) { redoDraft = value; return; }
        const now = P.promptList(es(), layers).find(p => p.id === id);
        (drafts[id] ??= { title: now?.title ?? '', text: now?.text ?? '' })[field] = value;
    }
    /** 글 칸을 실리태번의 '편집기 크게' 창으로 연다. 거기서 적은 글은 적던 글로 들고 있다가, 닫으면 원래 칸에 다시 그린다(저장은 원래 자리의 저장 버튼) */
    function showFull(area, id) {
        openFull(area, text => keep(id, 'text', text), paint);
    }
    function onKey(event) {
        if (useListKey(event, redoList())) return;
        if (event.key === 'Enter' && !event.isComposing && event.target.dataset?.field === 'new') { event.preventDefault(); make(event.target); }
    }
    const off = wire(root, onPick, onFold);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKey);
    // 포커스는 판이 그려진 root(shadow root 또는 문서)에서 읽는다: 문서의 activeElement 는 shadow 의 겉 칸이라 적는 칸을 못 알아본다
    const typing = () => { const now = root.getRootNode().activeElement; return Boolean(now && root.contains(now) && now.matches('input, textarea')); };
    paint();
    return {
        refresh() { if (!typing()) paint(); },
        close() { off(); root.removeEventListener('click', onClick); root.removeEventListener('input', onInput); root.removeEventListener('keydown', onKey); root.remove(); },
    };
}

registerScreen('prompts', { title: '번역 프롬프트', icon: 'pen-nib', render: (box, api) => drawPrompts(box, api, { label: false, list: api.wide }) });
