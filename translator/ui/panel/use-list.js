// 프리필 · 재번역 자리 아래의 작은 목록: 그 쓰임으로 저장해 둔 프롬프트를 고르면 글 칸에 들어간다. 새로 추가(이름 · 글) · 고치기 · 지우기.
// 프리필용은 프리필 자리에서, 재번역용은 재번역 자리에서만 만든다. 프롬프트 자체는 번역 프롬프트와 같은 자리(store/prompts.js)에
// 쓰임만 달리해 둔다. 번역 프롬프트 화면의 목록에는 보이지 않는다.
// 이 파일은 글(html)과 누름 처리만 한다. 그려 넣고 다시 그리는 것은 품은 화면(more.js 프리필, prompts.js 재번역)이 한다.
//
//   useListHtml(ctx) → html           ctx = { use, es, layers, state, current() }
//   useListClick(target, ctx) → bool  누른 것이 이 목록의 것이면 처리하고 true. ctx 에 더: pick(text), repaint(), notice?(text)
//   useListKey(event, ctx) → bool     새로 추가하는 이름 칸에서 Enter
//   state: { edit: 고치는 프롬프트 id, naming: 새로 추가하는 칸을 폈나 } (품은 화면이 들고 있는다)

import { esc, SV } from './text.js';
import * as P from '../../store/prompts.js';

const nameOf = p => p?.title || '이름 없는 프롬프트';
const ADD_NAME = { prefill: '새 프리필', redo: '새 재번역 프롬프트' };

function editHtml(p) {
    return `<div class="btr-uses-ed" data-uedit-box="${esc(p.id)}">
<div class="lab">이름</div><input type="text" class="input" data-ufield="title" value="${esc(p.title)}" aria-label="이름">
<div class="lab">내용</div><textarea class="input btr-prompts-text btr-uses-text" data-ufield="text" spellcheck="false" aria-label="내용">${esc(p.text)}</textarea>
<div class="acts"><button type="button" class="go line sm" data-uact="remove">지우기</button><button type="button" class="go sm" data-uact="save">저장</button></div></div>`;
}

/** on: 글 칸의 글과 같은 줄(같은 글이 여럿이면 첫 줄만) */
function rowHtml(p, ctx, on) {
    const editing = ctx.state.edit === p.id;
    return `<div class="rule" data-upick="${esc(p.id)}" role="button" tabindex="0"><span>${esc(nameOf(p))}</span><i class="fa-solid fa-pen-to-square" data-uedit="${esc(p.id)}" role="button" tabindex="0" aria-label="${esc(nameOf(p))} 고치기"></i><i class="radio${on ? ' on' : ''}" aria-hidden="true"></i></div>${editing ? editHtml(p) : ''}`;
}

export function useListHtml(ctx) {
    const items = P.promptsFor(ctx.es, ctx.layers, ctx.use), now = items.find(p => p.text === ctx.current())?.id;
    const list = items.length ? `<div class="btr-uses">${items.map(p => rowHtml(p, ctx, p.id === now)).join('')}</div>` : '';
    // 새로 추가: 이름과 글. 글은 지금 글 칸의 글로 채워 두고(비어 있으면 빈 칸) 고쳐 적을 수 있다
    const naming = ctx.state.naming
        ? `<div class="btr-uses-new"><div class="lab">이름</div><input type="text" class="input" data-uname enterkeyhint="done" aria-label="이름">
<div class="lab">내용</div><textarea class="input btr-prompts-text btr-uses-text" data-unew-text spellcheck="false" aria-label="내용">${esc(ctx.current())}</textarea>
<div class="acts"><button type="button" class="go line sm" data-uact="cancel">그만두기</button><button type="button" class="go sm" data-uact="make">추가</button></div></div>`
        : `<span class="add" data-uact="name" role="button" tabindex="0">${SV('plus')}${ADD_NAME[ctx.use] ?? '새로 추가'}</span>`;
    return `<div class="btr-uses-box" data-uses="${esc(ctx.use)}">${list}${naming}</div>`;
}

/** 새로 추가하는 칸의 이름 · 글로 그 쓰임의 프롬프트를 만든다 */
function make(box, ctx) {
    const input = box.querySelector('[data-uname]'), text = box.querySelector('[data-unew-text]')?.value ?? '';
    const id = P.addPromptText(ctx.es, ctx.layers, input?.value, text, ctx.use);
    if (!id) { input?.focus(); return; }
    ctx.state.naming = false;
    ctx.notice?.('추가했어요.');
    ctx.repaint();
}

/** 고치는 칸의 이름 · 글을 저장한다 */
function save(box, id, ctx) {
    const title = box.querySelector('[data-ufield="title"]').value, text = box.querySelector('[data-ufield="text"]').value;
    if (!title.trim()) return;
    P.setPromptText(ctx.es, ctx.layers, id, text);
    P.renamePrompt(ctx.es, ctx.layers, id, title);
    ctx.state.edit = '';
    ctx.notice?.('저장했어요.');
    ctx.repaint();
}

/** 지운다(번역용과 달리 프리필 · 재번역 목록은 다 지워도 된다) */
function remove(id, ctx) {
    P.removePrompt(ctx.es, ctx.layers, id);
    ctx.state.edit = '';
    ctx.repaint();
}

/** 새로 추가하는 칸을 펴고 그 칸에 커서를 둔다(다시 그리면 상자가 바뀌어 그린 뒤의 문서에서 찾는다) */
function openNaming(box, ctx) {
    const doc = box.getRootNode();
    ctx.state.naming = true;
    ctx.repaint();
    doc.querySelector(`[data-uses="${CSS.escape(ctx.use)}"] [data-uname]`)?.focus();
}

/** 새로 추가하는 이름 칸에서 Enter 면 추가. 처리했으면 true */
export function useListKey(event, ctx) {
    if (event.key !== 'Enter' || event.isComposing || !event.target.matches?.('[data-uname]')) return false;
    const box = event.target.closest(`[data-uses="${CSS.escape(ctx.use)}"]`);
    if (!box) return false;
    event.preventDefault();
    make(box, ctx);
    return true;
}

/** 목록에서 고른 것을 글 칸에 넣는다. 칸에 있던 글이 목록 어디에도 없으면 덮기 전에 목록에 남긴다(고르는 순간 원래 글을 잃었다) */
function pickRow(id, ctx) {
    const p = P.promptsFor(ctx.es, ctx.layers, ctx.use).find(each => each.id === id);
    if (!p) return;
    if (P.keepUnsaved(ctx.es, ctx.layers, ctx.use, ctx.current())) ctx.notice?.('칸에 있던 글은 목록에 남겨 뒀어요.');
    ctx.pick(p.text);
}

export function useListClick(target, ctx) {
    const box = target.closest(`[data-uses="${CSS.escape(ctx.use)}"]`);
    if (!box || target.closest('input, textarea')) return Boolean(box);
    const act = target.closest('[data-uact]')?.dataset.uact, edit = target.closest('[data-uedit]'), row = target.closest('[data-upick]');
    const editing = target.closest('[data-uedit-box]')?.dataset.ueditBox;
    if (act === 'name') openNaming(box, ctx);
    else if (act === 'make') make(box, ctx);
    else if (act === 'cancel') { ctx.state.naming = false; ctx.repaint(); }
    else if (act === 'save' && editing) save(box.querySelector(`[data-uedit-box="${CSS.escape(editing)}"]`), editing, ctx);
    else if (act === 'remove' && editing) remove(editing, ctx);
    else if (edit) { ctx.state.edit = ctx.state.edit === edit.dataset.uedit ? '' : edit.dataset.uedit; ctx.repaint(); }
    else if (row) pickRow(row.dataset.upick, ctx);
    return true;
}
