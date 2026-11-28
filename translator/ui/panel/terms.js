// 용어집 화면(시안 t2-settings-plan-more.html 의 '용어집' 탭).
// 차례: 머리(용어집 · 개수 · 사용) → 걸러 보기 한 줄과 정렬 → 낱말 목록(줄을 누르면 그 자리에서 고치는 칸, 맨 아래 넣는 줄)
//       → 아래 세 줄(예전 번역에서 나온 이름 · 다른 캐릭터에서 가져오기 · 더 보기).
// 사람과 말투는 이 화면에 나오지 않는다(사람 화면의 일). 사람과 용어를 같이 찾는 것은 채우기 화면(fill.js).
// 저장은 쓰는 곳 층(store/layers.js)과 용어집 store(terms-options · terms-move)로만 한다.
// 다른 캐릭터의 용어집은 그 줄을 펼 때만 읽는다(api.tools.books, store/terms-from.js): 판을 열 때마다 캐릭터 파일을 묻지 않게.

import { registerScreen } from './screens.js';
import { esc, SV } from './text.js';
import { ownerOf } from '../../job/sources.js';
import { oldSuggestions } from '../../job/terms-find.js';
import { termsOn, setTermsOn, sortKey, setSortKey, sorted } from '../../store/terms-options.js';
import { planImport, applyImport } from '../../store/terms-move.js';
import { skipsCardTerms } from '../../store/old-layers.js';
import { SETTINGS_KEY } from '../../store/settings.js';

const PLACE_NAMES = { all: '모든 채팅', card: '이 캐릭터', chat: '지금 채팅만' };
const PLACE_ORDER = ['all', 'card', 'chat'];
const SORTS = [['dst', '번역순'], ['src', '원문순']];
// 옛 번역기가 쓰던 열쇠 그대로: 채팅 자료의 '캐릭터 용어집 안 씀' 표시와, 보내는 글 번역에도 용어집을 쓸지
const NO_CARD_TERMS = 'llmt_chat_no_char_glossary';
const APPLY_SEND = 'glossary_apply_send';

const contextOf = api => (typeof api.context === 'function' ? api.context() : api.context ?? SillyTavern.getContext());
const toast = (text, kind = 'info') => globalThis.toastr?.[kind]?.(text, '', { timeOut: 3500 });
const icon = (name, cls = '') => `<i class="fa-solid fa-${name} ${cls}" aria-hidden="true"></i>`;
const check = on => `<span class="chk ${on ? '' : 'off'}">${on ? icon('check') : ''}</span>`;

/** 지금 고를 수 있는 쓰는 곳: 채팅이 없으면 모든 채팅뿐 */
const placesOf = context => (ownerOf(context) && context.getCurrentChatId?.() ? PLACE_ORDER : ['all']);

// ── 그리기 ──

// 화면 이름 '용어집'은 판 머리(휴대폰) · 오른쪽 칸 이름(PC)에 이미 있다: 여기서는 수와 사용 체크만
function titleHtml(count, on) {
    return `<div class="rtitle"><span><small>용어 ${count}개</small></span>
<button type="button" class="keep" data-act="use" role="checkbox" aria-checked="${on}">${check(on)}<span>사용</span></button></div>`;
}

function barHtml(rows, state, sort) {
    const count = place => rows.filter(row => row.place === place).length;
    const filters = [['', '전부', ''], ...PLACE_ORDER.map(place => [place, PLACE_NAMES[place], ` <i>${count(place)}</i>`])];
    const sortName = SORTS.find(([id]) => id === sort)[1];
    return `<div class="gbar"><div class="gset">${filters.map(([id, name, n]) => `<span role="button" tabindex="0" data-filter="${id}" class="${state.filter === id ? 'on' : ''}">${name}${n}</span>`).join('')}</div>
<button type="button" class="sel gsel" data-act="sort" aria-label="정렬 바꾸기">${icon('arrow-down-a-z')}<span class="sv">${sortName}</span></button></div>`;
}

/** 쓰는 곳 고르기: 넣는 줄과 고치는 칸이 같은 꼴(펼침 목록) */
function placeSelect(places, value, attr) {
    const options = places.map(place => `<option value="${place}"${place === value ? ' selected' : ''}>${PLACE_NAMES[place]}</option>`).join('');
    return `<span class="gpick"><select class="sel gsel" ${attr} aria-label="쓰는 곳">${options}</select>${SV('down')}</span>`;
}

function editHtml(edit, places) {
    return `<div class="open gedit"><div class="gin"><input type="text" class="input" data-edit="src" value="${esc(edit.src)}" placeholder="원문" aria-label="원문">
<input type="text" class="input" data-edit="dst" value="${esc(edit.dst)}" placeholder="번역" aria-label="번역"></div>
<div class="gwhere">${placeSelect(places, edit.place, 'data-edit="place"')}<div class="btns"><button type="button" class="go sm line" data-act="remove">지우기</button><button type="button" class="go sm solid" data-act="save">저장</button></div></div></div>`;
}

function rowHtml(row, state, places) {
    if (state.edit?.vid === row.vid) return editHtml(state.edit, places);
    return `<div class="term" role="button" tabindex="0" data-row="${esc(row.vid)}"><span>${esc(row.src)}</span><span>${esc(row.dst)}</span><b class="tag">${PLACE_NAMES[row.place]}</b></div>`;
}

function addHtml(draft, places) {
    return `<div class="term add"><input type="text" class="input" data-add="src" placeholder="원문" value="${esc(draft.src)}" aria-label="원문">
<input type="text" class="input" data-add="dst" placeholder="번역" enterkeyhint="done" value="${esc(draft.dst)}" aria-label="번역">
<span class="gend">${placeSelect(places, draft.place, 'data-add="place"')}<button type="button" class="go sm solid" data-act="add">넣기</button></span></div>`;
}

/** 아래 세 줄의 한 줄: 누르면 그 아래로 펼친다 */
function footLine(id, name, value, iconName, body, open) {
    return `<div class="line ${open ? 'up' : ''}" role="button" tabindex="0" data-foot="${id}" aria-expanded="${open}">${icon(iconName, 'lic')}<div class="k">${name}</div><span class="v">${value}</span>${SV('down')}</div>
<div class="fold ${open ? 'on' : ''}"><div><div class="open">${open ? body : ''}</div></div></div>`;
}

function seenHtml(seen) {
    if (!seen.length) return '<div class="note">예전 번역에서 나온 이름이 없어요.</div>';
    return `<div class="note">예전 번역에 쓰인 표기예요. 넣기를 누르면 굵은 글자 그대로 용어집에 들어가요.</div>${seen.map((item, i) => `<div class="term gseen"><span>${esc(item.src)}</span>${icon('arrow-right')}<span><b>${esc(item.dst)}</b></span><button type="button" class="pill" data-seen="${i}">넣기</button></div>`).join('')}`;
}

/** 가져올 수: 용어 a개, 사람 b명(0 인 것은 뺀다) */
const counted = (names, people) => [names ? `용어 ${names}개` : '', people ? `사람 ${people}명` : ''].filter(Boolean).join(', ');

const PLAN_SHOWN = 5;   // 누른 캐릭터 아래에 보일 새 용어 줄 수(나머지는 수로)

/** 새로 들어올 용어 몇 줄(원문 → 번역)과 남은 수 */
function planTerms(plan, book) {
    const fresh = book.names.filter((_, i) => plan.steps.names[i] === 'add');
    if (!fresh.length) return '';
    const rows = fresh.slice(0, PLAN_SHOWN).map(n => `<div class="gplan-term"><span>${esc(n.src)}</span>${icon('arrow-right')}<span>${esc(n.dst)}</span></div>`).join('');
    const rest = fresh.length > PLAN_SHOWN ? `<div class="gplan-rest">그 밖에 ${fresh.length - PLAN_SHOWN}개</div>` : '';
    return `<div class="gplan-terms">${rows}${rest}</div>`;
}

/** 누른 캐릭터 아래: 무엇이 들어오고 무엇을 그대로 두는지, 가져오기 버튼. 겹치는 것은 있던 것을 둔다(policy 'keep') */
function planHtml(plan, place, book) {
    const fresh = counted(plan.names.add, plan.people.add), same = counted(plan.names.keep, plan.people.keep);
    const kept = same ? `<br>이미 있어서 그대로 두는 것: ${same}` : '';
    if (!plan.changed) return `<div class="gplan">새로 들어올 것이 없어요.${kept}</div>`;
    return `<div class="gplan">${PLACE_NAMES[place]}에 새로 들어오는 것: ${fresh}${planTerms(plan, book)}${kept}
<div class="btns"><button type="button" class="go sm solid" data-act="from-go">가져오기</button></div></div>`;
}

function fromRowHtml(row, open) {
    const face = row.avatar ? `<img class="face pic" loading="lazy" alt="" src="/thumbnail?type=avatar&amp;file=${encodeURIComponent(row.avatar)}">` : `<span class="face icon">${icon(row.group ? 'users' : 'user')}</span>`;
    const count = [`용어 ${row.book.names.length}`, row.book.people.length ? `사람 ${row.book.people.length}` : ''].filter(Boolean).join(' · ');
    return `<div class="gfrom-row${open ? ' on' : ''}" role="button" tabindex="0" data-from="${esc(row.key)}" aria-expanded="${open}">${face}<span class="gfrom-name">${esc(row.name)}</span><small>${count}</small></div>`;
}

/** 다른 캐릭터에서 가져오기: 용어집이 있는 캐릭터 목록(고정 높이 안에서 내림). 누른 줄 아래에 들어올 것 */
function fromHtml(from, planOf, place) {
    if (!from || from.loading) return '<div class="note">다른 캐릭터의 용어집을 읽는 중이에요.</div>';
    if (from.error) return `<div class="note">${esc(from.error)}</div>`;
    if (!from.list.length) return '<div class="note">용어집이 있는 다른 캐릭터가 없어요.</div>';
    const rows = from.list.map(row => fromRowHtml(row, row.key === from.pick) + (row.key === from.pick ? planHtml(planOf(row), place, row.book) : '')).join('');
    return `<div class="note">캐릭터를 누르면 들어올 용어가 그 아래에 보여요.</div><div class="gfrom">${rows}</div>`;
}

// 체크 줄 둘은 접지 않고 아래에 바로 둔다(접는 줄 이름으로는 안에 무엇이 있는지 알 수 없었다)
function moreHtml(context) {
    const meta = context.getCurrentChatId?.() ? context.chatMetadata : null;
    const skip = skipsCardTerms(meta), send = context.extensionSettings?.[SETTINGS_KEY]?.[APPLY_SEND] !== false;
    const row = (act, on, label) => `<button type="button" class="keep" data-act="${act}" role="checkbox" aria-checked="${on}">${check(on)}<span>${label}</span></button>`;
    // '사용'(위 체크)은 모든 채팅의 용어집을 통째로 끄고 켠다. 이 줄은 이 채팅에서 '이 캐릭터' 용어만 뺀다(store/layers.js)
    return (meta ? row('skip-card', skip, "이 채팅에선 '이 캐릭터' 용어 빼기") : '') + row('apply-send', send, '내가 보내는 글을 번역할 때도 쓰기');
}


// ── 화면 ──

function render(box, api) {
    const root = Object.assign(document.createElement('div'), { className: 'gloss' });
    box.append(root);
    const { layers } = api;
    const context = () => contextOf(api);
    const notice = (text, kind = 'info') => (api.notice ?? toast)(text, kind);
    // filter: 걸러 볼 쓰는 곳('' = 전부). edit: 고치는 줄. foot: 편 아래 줄. from: 다른 캐릭터 목록({ loading } | { list, pick } | { error })
    const state = { filter: '', sortOpen: false, edit: null, foot: '', from: null, draft: { src: '', dst: '', place: placesOf(context()).includes('card') ? 'card' : 'all' } };

    const rowsNow = () => sorted(layers.view().names, sortKey(context().extensionSettings));
    const seenNow = () => oldSuggestions(context(), layers.view());

    function paint() {
        const c = context(), rows = rowsNow(), places = placesOf(c), seen = seenNow();
        const shown = rows.filter(row => !state.filter || row.place === state.filter);
        const list = shown.map(row => rowHtml(row, state, places)).join('');
        root.innerHTML = titleHtml(rows.length, termsOn(c.extensionSettings))
            + (rows.length ? barHtml(rows, state, sortKey(c.extensionSettings)) : '')
            + `<div class="group glist">${list}${addHtml(state.draft, places)}</div>`
            + (rows.length || c.getCurrentChatId?.() ? '' : '<div class="note">채우기는 채팅을 열면 쓸 수 있어요.</div>')
            + `<div class="gfoot">${footLine('seen', '예전 번역에서 나온 이름', seen.length ? `<b class="cnt">${seen.length}개</b>` : '', 'clock-rotate-left', seenHtml(seen), state.foot === 'seen')}
${footLine('from', '다른 캐릭터에서 가져오기', '', 'right-to-bracket', fromHtml(state.from, planOf, importPlace()), state.foot === 'from')}
<div class="gkeeps">${moreHtml(c)}</div></div>`;
    }

    /** 고친 뒤: 실패한 고침은 까닭을 알리고, 됐으면 이 화면과 첫 화면의 줄을 다시 그린다 */
    function change(fn) {
        try { fn(); } catch (error) { notice(error.message || '저장하지 못했어요.', 'warning'); return false; }
        paint();
        api.refresh?.();
        return true;
    }

    function addTerm() {
        const { src, dst, place } = state.draft;
        if (!src.trim() || !dst.trim()) { notice('원문과 번역을 적어 주세요.'); return; }
        if (change(() => layers.addName(place, src, dst))) { state.draft.src = ''; state.draft.dst = ''; paint(); root.querySelector('[data-add="src"]')?.focus(); }
    }

    function saveEdit() {
        const { vid, src, dst, place } = state.edit;
        if (!src.trim() || !dst.trim()) { notice('원문과 번역을 적어 주세요.'); return; }
        state.edit = null;
        // 원문이 바뀌면 줄의 id 도 바뀐다: 옛 줄을 빼고 고른 쓰는 곳에 새로 적는다
        change(() => { layers.removeName(vid); layers.addName(place, src, dst); });
    }

    function removeEdit() {
        const { vid } = state.edit;
        state.edit = null;
        change(() => layers.removeName(vid));
    }

    /** 가져올 쓰는 곳: 채팅에 캐릭터가 있으면 이 캐릭터, 없으면 모든 채팅 */
    const importPlace = () => (placesOf(context()).includes('card') ? 'card' : 'all');
    const planOf = row => planImport(layers.view(), row.book, { place: importPlace(), policy: 'keep' });

    /** 줄을 처음 펼 때 다른 캐릭터의 용어집을 읽는다(한 번 읽은 목록은 화면을 닫을 때까지 쓴다) */
    function loadFrom() {
        if (state.from) return;
        const books = api.tools?.books;
        if (!books) { state.from = { list: [], pick: null }; return; }
        state.from = { loading: true };
        books().then(list => { state.from = { list, pick: null }; }, () => { state.from = { error: '다른 캐릭터의 용어집을 읽지 못했어요.' }; }).then(paint);
    }

    function importFrom() {
        const row = state.from?.list?.find(r => r.key === state.from.pick);
        if (!row) return;
        let plan = null;
        if (!change(() => { plan = applyImport(layers, row.book, { place: importPlace(), policy: 'keep' }); })) return;
        const got = counted(plan.names.add, plan.people.add);
        notice(got ? `${got}${got.endsWith('명') ? '을' : '를'} 가져왔어요.` : '새로 들어온 것이 없어요.');
    }

    function toggleSkipCard() {
        const c = context(), meta = c.chatMetadata;
        if (skipsCardTerms(meta)) delete meta[NO_CARD_TERMS]; else meta[NO_CARD_TERMS] = true;
        c.saveMetadata?.();
    }

    function toggleApplySend() {
        const c = context(), own = (c.extensionSettings[SETTINGS_KEY] ??= {});
        own[APPLY_SEND] = own[APPLY_SEND] === false;
        c.saveSettingsDebounced();
    }

    const ACTS = {
        use: () => change(() => setTermsOn(context(), !termsOn(context().extensionSettings))),
        sort: () => change(() => setSortKey(context(), sortKey(context().extensionSettings) === 'dst' ? 'src' : 'dst')),
        add: addTerm, save: saveEdit, remove: removeEdit,
        'from-go': importFrom,
        'skip-card': () => change(toggleSkipCard), 'apply-send': () => change(toggleApplySend),
    };

    function openRow(vid) {
        const row = layers.view().names.find(n => n.vid === vid);
        if (!row) return;
        state.edit = { vid, src: row.src, dst: row.dst, place: row.place };
        paint();
        root.querySelector('[data-edit="dst"]')?.focus({ preventScroll: true });
    }

    function onClick(event) {
        const hit = name => event.target.closest(`[data-${name}]`);
        const act = hit('act'), filter = hit('filter'), sort = hit('sort'), row = hit('row'), foot = hit('foot'), seen = hit('seen'), from = hit('from');
        if (act) ACTS[act.dataset.act]?.();
        else if (filter) { state.filter = filter.dataset.filter; state.edit = null; paint(); }
        else if (sort) { state.sortOpen = false; change(() => setSortKey(context(), sort.dataset.sort)); }
        else if (row) openRow(row.dataset.row);
        else if (foot) { state.foot = state.foot === foot.dataset.foot ? '' : foot.dataset.foot; if (state.foot === 'from') loadFrom(); paint(); }
        else if (from && state.from?.list) { state.from.pick = state.from.pick === from.dataset.from ? null : from.dataset.from; paint(); }
        else if (seen) { const item = seenNow()[Number(seen.dataset.seen)]; if (item) change(() => layers.addName(item.everywhere ? 'all' : state.draft.place, item.src, item.dst)); }
    }

    // 적는 동안은 다시 그리지 않는다(커서를 지키려고): 값만 들고 있는다
    function onInput(event) {
        const t = event.target;
        if (t.dataset.add) state.draft[t.dataset.add] = t.value;
        else if (t.dataset.edit && state.edit) state.edit[t.dataset.edit] = t.value;
    }

    function onKey(event) {
        if (event.key !== 'Enter' || event.isComposing) return;
        const t = event.target;
        if (t.dataset.add && t.tagName === 'INPUT') { event.preventDefault(); addTerm(); }
        else if (t.dataset.edit) { event.preventDefault(); saveEdit(); }
        else if (t.matches('[role="button"]')) { event.preventDefault(); t.click(); }
    }

    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    root.addEventListener('keydown', onKey);
    paint();
    // 다른 화면에서 값이 바뀌면 틀이 refresh 를 부른다: 걸러 보기 · 펼친 줄 · 적던 글은 그대로 두고 다시 그린다
    return { refresh: paint, close() { root.remove(); } };
}

registerScreen('terms', {
    title: '용어집', icon: 'book',
    summary: api => `${api?.layers?.view().names.length ?? 0}개`,
    render,
});
