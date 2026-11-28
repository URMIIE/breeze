// 다시 번역 판의 안쪽 화면.
// 그 답의 대사 문단을 한 줄씩 보여 주고 무엇을 다시 번역할지 고르게 한다. 맨 앞 '글 전체'는 답을 처음부터 다시 번역하고,
// '대사 전부'와 사람 버튼은 누를 때마다 그 대사를 더한다(다 들어 있으면 뺀다). 줄은 하나씩 넣고 뺀다.
// 줄의 밑줄 친 이름을 눌러 누구 말인지 바로잡고, 누구 말인지 모르는 대사 여러 개는 한 번에 한 사람 것으로 정한다.
// 한 사람 것만 골랐으면 그 사람의 적어 둔 말투를 보여 주고, 이번에 적은 말투를 그 사람 말투로 적어 두게 한다.
// 화면만 다룬다: 저장과 번역 요청은 api 를 넘겨준 쪽이 한다.
//
// api 꼴
//   data(): {
//     rows: { at: number, said: boolean, who: string[] | string, text: string }[]
//           그 답의 번역 문단. at = 문단 번호, said = 대사가 든 문단, who = 말한 사람(비었으면 누구 말인지 모름), text = 번역 글
//     picked?: number[]            처음부터 골라 둘 문단 번호(사용자가 누른 대사)
//     names?: string[]             이 채팅에 나온 다른 사람(이 답에 나온 사람은 저절로 들어간다)
//     tones?: { [name]: string }   사람마다 적어 둔 말투
//     guessed?: boolean            누가 말했는지 적어 두기 전에 번역한 답이라 이름으로 짐작했으면 true
//     wholeRequests?: number       글 전체 다시 번역이 드는 요청 수(없으면 1)
//   }
//   setHead?({ title: string, sub: string, back: { label: string, onBack: () => void } | null })
//           판 머리의 글. back 이 있으면 머리의 뒤로 가기를 이 화면이 맡고, null 이면 틀이 하던 대로 둔다
//   onWho(ats: number[], who: string)   누구 말인지 바로잡았을 때(바로 저장할 것)
//   onGo({ whole: boolean, ats: number[], tone: string, keepTone: string | null, withBefore: boolean })
//           다시 번역. whole = 글 전체, ats = 고른 문단 번호, tone = 이번에 지킬 말투나 부탁(두 갈래 모두에 실린다),
//           keepTone = 이번 말투를 적어 둘 사람(없으면 null), withBefore = 앞 번역문을 모델에게 같이 보낼지(기본은 안 보냄)
// 돌려주는 값: { refresh(), close() }. refresh 는 data() 를 다시 읽어 그리고(고른 것은 남긴다), close 는 듣기를 떼고 비운다.

import { fold as foldName } from '../../core/find.js';

const UNKNOWN = '누구 말인지 모름';
const ALL = '*';          // '대사 전부' 묶음의 열쇠
const NAMES_AT_ONCE = 6;  // 이름 고르기에서 한 번에 보이는 사람 수. 넘으면 이 답에 나온 사람만 보이고 나머지는 '다른 사람 N명'으로 접는다

/** 태그 하나를 만든다. 글은 textContent 로만 넣는다(넘겨받은 글을 HTML 로 읽지 않게) */
function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key.startsWith('aria-') && value != null) { node.setAttribute(key, String(value)); continue; }
        if (value == null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value === true ? '' : String(value));
    }
    node.append(...kids.flat().filter(kid => kid != null && kid !== false));
    return node;
}
const icon = name => el('i', { class: `fa-solid fa-${name}`, 'aria-hidden': 'true' });
const button = (cls, act, props, ...kids) => el('button', { type: 'button', class: cls, 'data-act': act, ...props }, ...kids);
/** 번역 글에서 태그와 굵게, 기울임 표시를 걷어 낸 읽는 글 */
const plain = text => String(text ?? '').replace(/<[^>]*>/g, '').replace(/(\*\*|__|\*)/g, '').trim();
const namesOf = who => (Array.isArray(who) ? who : [who]).map(name => String(name ?? '').trim()).filter(Boolean);

/**
 * 한 사람의 여러 이름(원문 이름 · 다른 표기 · 한글 표기 · 번역 문단 짝으로 그 사람 것으로 본 한글 이름)을 한 이름으로 모으는 함수.
 * 대사 기록에는 그때그때 쓴 이름이 그대로 적혀 있어, 같은 사람이 원문 이름과 한글 이름으로 따로 묶였다.
 * 모으는 이름은 첫 화면 '나온 사람들'에 보이는 이름과 같다(한글 표기가 저장돼 있으면 그것, 아니면 원문 이름).
 * @param {object[]} [people] open-data.js peopleOf 의 줄
 */
function nameJoiner(people = []) {
    const byKey = new Map();
    for (const person of people) {
        if (person.isNew) continue;
        const label = person.guess ? person.src : person.name || person.src;
        if (!label) continue;
        for (const name of [person.src, ...(person.alts ?? []), person.name]) if (name) byKey.set(foldName(name), label);
    }
    return name => byKey.get(foldName(name)) ?? name;
}

/** 넘겨받은 문단에서 대사 문단만 읽기 좋은 꼴로. 한 사람의 여러 이름은 join 으로 한 이름에 모은다 */
function saidRows(rows = [], join = name => name) {
    return rows.filter(row => row.said).map(row => ({ at: Number(row.at), who: [...new Set(namesOf(row.who).map(join))], text: plain(row.text) }));
}

/** 묶음: 사람마다(그 사람 대사 전부)와 누구 말인지 모르는 것을 대사 많은 차례로. 열쇠는 이름, 모름은 '' */
function peopleGroups(said) {
    const byKey = new Map();
    for (const row of said) {
        for (const key of row.who.length ? row.who : ['']) {
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push(row.at);
        }
    }
    return [...byKey].map(([key, ats]) => ({ key, label: key || UNKNOWN, ats })).sort((a, b) => b.ats.length - a.ats.length);
}

/** 위의 버튼 줄에 놓일 묶음: 사람이 둘 이상이면 맨 앞에 '대사 전부' */
function setGroups(said) {
    const people = peopleGroups(said);
    return people.length > 1 ? [{ key: ALL, label: '대사 전부', ats: said.map(row => row.at) }, ...people] : people;
}

/**
 * @param {HTMLElement} host 판 안에서 이 화면이 들어갈 자리(높이가 정해진 상자)
 * @param {object} api 맨 위 주석의 꼴
 */
export function mount(host, api) {
    const state = { said: [], data: {}, picked: new Set(), whole: false, asking: null, askingAll: false, keep: false, decide: null, decideName: '' };
    // 공통 모습은 판의 뿌리(.btr-plan)에 걸려 있다. 다시 번역은 따로 여는 판이라 그 뿌리가 없으면 이 화면이 뿌리를 겸한다
    const root = el('div', { class: `btr-redo-root${host.closest('.btr-plan') ? '' : ' btr-plan phone fix'}` });
    const parts = buildShell(root);
    host.replaceChildren(root);

    function load(first) {
        state.data = api.data?.() ?? {};
        state.join = nameJoiner(api.people?.());
        state.said = saidRows(state.data.rows, state.join);
        const known = new Set(state.said.map(row => row.at));
        const keep = first ? (state.data.picked ?? []).map(Number) : [...state.picked];
        state.picked = new Set(keep.filter(at => known.has(at)));
        if (first) startPick();
    }
    // 처음 열 때: 넘겨받은 대사를, 없으면 묶음이 하나뿐일 때 그것을 골라 둔다. 대사가 없는 답은 '글 전체'만 있다
    function startPick() {
        if (!state.said.length) { state.whole = true; return; }
        const groups = setGroups(state.said);
        if (!state.picked.size && groups.length === 1) groups[0].ats.forEach(at => state.picked.add(at));
    }

    const ctx = { state, parts, api, root };
    const paint = () => paintAll(ctx);
    ctx.paint = paint;

    const onClick = event => { ctx.pressing = false; clickAct(ctx, event.target.closest('[data-act]')); endTyping(ctx); };
    const onInput = event => inputAct(ctx, event.target);
    const onFocusIn = event => typingMode(ctx, event.target, true);
    const onFocusOut = event => typingMode(ctx, event.target, false);
    // 판 안을 누르는 중인지: 누르면 켜고, 누름이 끝나거나(click) 스크롤로 바뀌면(pointercancel) 끈다
    const onPointerDown = () => { ctx.pressing = true; };
    const onPointerCancel = () => { ctx.pressing = false; };
    const events = [['click', onClick], ['input', onInput], ['focusin', onFocusIn], ['focusout', onFocusOut], ['pointerdown', onPointerDown], ['pointercancel', onPointerCancel]];
    for (const [type, fn] of events) root.addEventListener(type, fn);

    load(true);
    paint();
    return {
        refresh() { load(false); paint(); },
        close() {
            for (const [type, fn] of events) root.removeEventListener(type, fn);
            root.remove();
        },
    };
}

/** 한 번만 만드는 틀. 입력 칸은 다시 그리지 않는다(쓰는 중에 커서가 날아가지 않게) */
function buildShell(root) {
    const tone = el('input', { class: 'input', type: 'text', maxlength: 200, 'data-role': 'tone', placeholder: '이번에 지킬 말투나 부탁 (비워도 돼요)', 'aria-label': '이번에 지킬 말투나 부탁' });
    const before = el('input', { type: 'checkbox', 'data-role': 'with-before' });
    const newName = el('input', { class: 'input', type: 'text', maxlength: 60, 'data-role': 'new-name', placeholder: '이름을 적으면 나온 사람들에 더해져요', 'aria-label': '목록에 없는 사람' });
    const parts = {
        main: el('div', { class: 'rmain' }),
        info: el('div', { class: 'rinfo', text: '예전에 번역한 답이라 누구 대사인지는 이름으로 짐작했어요. 틀린 줄은 이름을 눌러 고쳐 주세요.' }),
        sum: el('div', { class: 'rsum' }),
        sets: el('div', { class: 'filters', role: 'group', 'aria-label': '한꺼번에 고르기' }),
        pickbar: el('div', { class: 'rpickbar' }),
        rows: el('div', { class: 'rrows' }),
        empty: el('div', { class: 'rempty', text: '따옴표로 말한 줄이 없는 답이라 대사는 고를 것이 없어요.\n글 전체를 처음부터 재번역할 수 있어요.' }),
        note: el('div', { class: 'note' }),
        tone,
        before,
        keep: button('keep', 'keep', { role: 'checkbox' }),
        go: button('go solid', 'go'),
        decide: el('div', { class: 'rdecide' }),
        decideList: el('div', { class: 'rdecide-list' }),
        newName,
        decideGo: button('go solid', 'set-who'),
    };
    const check = el('label', { class: 'btr-redo-check' }, before, ' 앞 번역도 같이 보내기');
    const foot = el('div', { class: 'foot' }, parts.note, tone, parts.keep, check, parts.go);
    parts.main.append(parts.info, parts.sum, el('div', { class: 'rsetswrap' }, parts.sets), parts.pickbar, parts.rows, parts.empty, foot);
    parts.decide.append(parts.decideList, el('div', { class: 'lab', text: '목록에 없는 사람' }), newName, parts.decideGo);
    root.append(parts.main, parts.decide);
    return parts;
}

// ---------- 그리기 ----------

function paintAll(ctx) {
    const { state, parts } = ctx;
    parts.main.hidden = !!state.decide;
    parts.decide.hidden = !state.decide;
    if (state.decide) { paintDecide(ctx); return; }
    paintHead(ctx);
    parts.info.hidden = !state.data.guessed;
    paintSets(ctx);
    paintPickbar(ctx);
    paintRows(ctx);
    paintSum(ctx);
    paintFoot(ctx);
}

function paintHead({ state, api }) {
    const count = state.said.length;
    const people = peopleGroups(state.said).filter(group => group.key).length;
    const sub = !count ? '이 답에는 대사가 없어요' : `이 답의 대사 ${count}개${people >= 3 ? `, 말한 사람 ${people}명` : ''}`;
    api.setHead?.({ title: '재번역', sub, back: null });
}

function paintSets({ state, parts }) {
    const list = [button(`set${state.whole ? ' on' : ''}`, 'whole', { 'aria-pressed': state.whole }, '글 전체')];
    for (const group of setGroups(state.said)) list.push(setButton(state, group));
    parts.sets.replaceChildren(...list);
}

/**
 * 묶음 버튼: 다 골랐으면 칠하고, 일부만 골랐으면 테두리와 '고른 수/전체'.
 * 일부만 고른 표시는 그 사람 혼자 말한 줄을 고른 때만 한다(다른 사람 버튼으로 같이 골라진 여럿이 말한 줄로는 켜지 않게).
 * '대사 전부'는 다 골랐는지만 보인다
 */
function setButton(state, group) {
    const picked = state.whole ? [] : group.ats.filter(at => state.picked.has(at));
    const all = picked.length === group.ats.length;
    const sole = new Set(state.said.filter(row => row.who.length <= 1).map(row => row.at));
    const inside = picked.filter(at => sole.has(at)).length;
    const part = !all && group.key !== ALL && inside > 0;
    const cls = `set${all ? ' on' : part ? ' part' : ''}`;
    const count = part ? `${inside}/${group.ats.length}` : String(group.ats.length);
    return button(cls, 'set', { 'data-key': group.key, 'aria-pressed': all ? 'true' : part ? 'mixed' : 'false' }, group.label, ' ', el('i', { text: count }));
}

/** 고른 대사 가운데 누구 말인지 모르는 것 */
const unknownPicked = state => (state.whole ? [] : state.said.filter(row => !row.who.length && state.picked.has(row.at)));

/** 누구 말인지 모르는 대사만 둘 이상 골랐을 때: 한 번에 한 사람 것으로 정하는 줄 */
function paintPickbar({ state, parts }) {
    const unknown = unknownPicked(state);
    parts.pickbar.hidden = unknown.length < 2 || unknown.length !== state.picked.size;
    if (parts.pickbar.hidden) return;
    parts.pickbar.replaceChildren(el('span', { text: `${unknown.length}개 골랐어요` }), button('pill', 'decide', {}, '누구 말인지 한 번에 정하기'));
}

function paintRows(ctx) {
    const { state, parts } = ctx;
    parts.rows.hidden = !state.said.length;
    parts.empty.hidden = !!state.said.length;
    if (!state.said.length) return;
    const top = parts.rows.scrollTop;
    parts.rows.replaceChildren(...state.said.map(row => rowNode(ctx, row)));
    parts.rows.scrollTop = top;
}

/** 대사 한 줄: 동그라미, 밑줄 친 이름(누르면 이름 고르기가 펼쳐짐), 대사 글 */
function rowNode(ctx, row) {
    const { state } = ctx;
    const on = !state.whole && state.picked.has(row.at), asking = state.asking === row.at;
    const name = row.who.length ? row.who.join(', ') : UNKNOWN;
    return el('div', { class: `rrow${on ? ' on' : ''}` },
        button('rtick', 'toggle', { 'data-at': row.at, 'aria-pressed': on, 'aria-label': on ? '빼기' : '고르기' }, el('span', { class: `chk${on ? '' : ' off'}` }, on ? icon('check') : null)),
        el('div', { class: 'rbody' },
            button('nm', 'who', { 'data-at': row.at, 'aria-expanded': asking }, el('u', { text: name }), icon(asking ? 'chevron-up' : 'chevron-down')),
            asking ? nameChoices(ctx, row) : null,
            button('rq', 'toggle', { 'data-at': row.at }, row.text)));
}

/** 이 답에 나온 사람(대사 많은 차례), 그다음 이 채팅에 나온 다른 사람 */
function choiceNames(ctx) {
    const here = peopleGroups(ctx.state.said).filter(group => group.key).map(group => group.key);
    const join = ctx.state.join ?? (name => name);
    const others = (ctx.state.data.names ?? []).map(name => join(String(name))).filter(name => name && !here.includes(name));
    return { here, others: [...new Set(others)] };
}

function nameChoices(ctx, row) {
    const { here, others } = choiceNames(ctx);
    const fold = !ctx.state.askingAll && here.length + others.length > NAMES_AT_ONCE;
    const shown = fold ? here : [...here, ...others];
    const list = shown.map(name => button(`rname${row.who.length === 1 && row.who[0] === name ? ' cur' : ''}`, 'name', { 'data-name': name }, name));
    if (fold && others.length) list.push(button('rname more', 'more', {}, `다른 사람 ${others.length}명`));
    return el('div', { class: 'rnames', role: 'group', 'aria-label': '누구 대사인지 고르기' }, list);
}

/** 키보드가 올라와 목록을 접었을 때의 한 줄: 무엇을 몇 개 골랐는지 */
function paintSum({ state, parts }) {
    parts.sum.replaceChildren(el('span', { text: pickedSummary(state) }), button('rlink', 'list', {}, '목록 보기'));
}

function pickedSummary(state) {
    if (state.whole) return '글 전체 골랐어요';
    if (!state.picked.size) return '고른 대사가 없어요';
    // 버튼 줄 차례로 세고, 여럿이 같이 말한 문단은 먼저 센 사람에게만 넣는다(더한 수가 고른 대사 수와 같게)
    const counted = new Set(), parts = [];
    for (const group of peopleGroups(state.said)) {
        const fresh = group.ats.filter(at => state.picked.has(at) && !counted.has(at));
        fresh.forEach(at => counted.add(at));
        if (fresh.length) parts.push(`${group.label} ${fresh.length}`);
    }
    return `${parts.join(', ')} 골랐어요`;
}

/** 고른 대사가 모두 한 사람 것이면 그 이름. 여럿이 같이 말한 문단은 그 사람이 들어 있으면 그 사람 것으로 친다 */
function singlePerson(state) {
    if (state.whole || !state.picked.size) return null;
    const rows = state.said.filter(item => state.picked.has(item.at));
    const common = rows[0].who.filter(name => rows.every(row => row.who.includes(name)));
    return common.length === 1 ? common[0] : null;
}

function paintFoot({ state, parts }) {
    const person = singlePerson(state), saved = person ? state.data.tones?.[person] : '';
    parts.note.hidden = !saved;
    parts.note.textContent = saved ? `${person}의 적어 둔 말투: ${saved}` : '';
    const typed = parts.tone.value.trim();
    parts.keep.hidden = !(person && typed);
    parts.keep.setAttribute('aria-checked', String(state.keep));
    parts.keep.replaceChildren(el('span', { class: `chk${state.keep ? '' : ' off'}` }, state.keep ? icon('check') : null), el('span', { text: `이 말투를 ${person ?? ''}의 말투로 적어 두기` }));
    paintGo(state, parts.go);
}

function paintGo(state, go) {
    const ready = state.whole || state.picked.size > 0;
    go.disabled = !ready;
    if (!ready) { go.replaceChildren('재번역할 대사를 눌러 주세요'); return; }
    const label = state.whole ? '글 전체 재번역' : `대사 ${state.picked.size}개 재번역`;
    const requests = state.whole ? Number(state.data.wholeRequests) || 1 : 1;
    go.replaceChildren(label, el('small', { text: `요청 ${requests}번` }));
}

// ---------- 한 번에 정하기 화면 ----------

function paintDecide(ctx) {
    const { state, parts, api } = ctx;
    api.setHead?.({ title: '', sub: '', back: { label: '재번역', onBack: () => leaveDecide(ctx) } });
    const rows = state.said.filter(row => state.decide.includes(row.at));
    const { here, others } = choiceNames(ctx);
    const chips = names => el('div', { class: 'rnames' }, names.map(name => button(`rname${state.decideName === name ? ' cur' : ''}`, 'pick', { 'data-name': name, 'aria-pressed': state.decideName === name }, name)));
    parts.decideList.replaceChildren(el('div', {},
        el('div', { class: 'rtitle', text: `고른 대사 ${rows.length}개는 누구 말인가요?` }),
        el('div', { class: 'rprev' }, rows.map(row => el('div', { text: row.text }))),
        el('div', { class: 'note', text: '정하면 바로 저장돼요. 번역은 바뀌지 않고, 재번역할 때 그 사람의 말투로 나와요.' }),
        here.length ? [el('div', { class: 'lab', text: '이 답에서 말한 사람' }), chips(here)] : null,
        others.length ? [el('div', { class: 'lab', text: '이 채팅에 나온 다른 사람' }), chips(others)] : null));
    const name = state.decideName;
    parts.decideGo.disabled = !name;
    parts.decideGo.replaceChildren(name ? `${name}의 대사로 정하기` : '누구 말인지 골라 주세요');
}

function enterDecide(ctx) {
    const { state, parts } = ctx;
    state.decide = unknownPicked(state).map(row => row.at);
    state.decideName = '';
    parts.newName.value = '';
    parts.decide.scrollTop = 0;
    ctx.paint();
}

function leaveDecide(ctx) {
    ctx.state.decide = null;
    ctx.paint();
}

/** 한 번에 정하기를 마침: 고른 줄을 그 사람 것으로 바꾸고 알린 뒤 목록으로 */
function applyDecide(ctx) {
    const { state, api } = ctx;
    const name = state.decideName;
    if (!name || !state.decide?.length) return;
    for (const row of state.said) if (state.decide.includes(row.at)) row.who = [name];
    api.onWho?.([...state.decide], name);
    leaveDecide(ctx);
}

// ---------- 누름 ----------

/** 묶음 버튼: 다 들어 있으면 빼고, 아니면 더한다(한 사람 대사와 모르는 대사를 같이 고를 수 있게) */
function chooseGroup(state, ats) {
    const all = !state.whole && ats.every(at => state.picked.has(at));
    state.whole = false;
    for (const at of ats) { if (all) state.picked.delete(at); else state.picked.add(at); }
}

function toggleRow(state, at) {
    if (state.whole) { state.whole = false; state.picked.clear(); }
    if (state.picked.has(at)) state.picked.delete(at); else state.picked.add(at);
}

/** 줄의 이름 고르기에서 사람을 골랐을 때: 바로 알리고 접는다 */
function setOwner(ctx, name) {
    const { state, api } = ctx;
    const row = state.said.find(item => item.at === state.asking);
    if (row && !(row.who.length === 1 && row.who[0] === name)) {
        row.who = [name];
        api.onWho?.([row.at], name);
    }
    state.asking = null;
    state.askingAll = false;
}

function go({ state, parts, api }) {
    if (parts.go.disabled) return;
    const tone = parts.tone.value.trim();
    const person = singlePerson(state);
    const ats = state.whole ? [] : [...state.picked].sort((a, b) => a - b);
    api.onGo?.({ whole: state.whole, ats, tone, keepTone: person && tone && state.keep ? person : null, withBefore: parts.before.checked });
}

const ACTS = {
    whole: ({ state }) => { state.whole = !state.whole; if (state.whole) state.picked.clear(); },
    set: ({ state }, target) => {
        const group = setGroups(state.said).find(item => item.key === target.dataset.key);
        if (group) chooseGroup(state, group.ats);
    },
    toggle: ({ state }, target) => toggleRow(state, Number(target.dataset.at)),
    who: ({ state }, target) => {
        const at = Number(target.dataset.at);
        state.asking = state.asking === at ? null : at;
        state.askingAll = false;
    },
    name: (ctx, target) => setOwner(ctx, target.dataset.name),
    more: ({ state }) => { state.askingAll = true; },
    keep: ({ state }) => { state.keep = !state.keep; },
    list: ({ parts }) => parts.tone.blur(),
};

function clickAct(ctx, target) {
    if (!target || target.disabled) return;
    const act = target.dataset.act;
    if (act === 'go') return go(ctx);
    if (act === 'decide') return enterDecide(ctx);
    if (act === 'set-who') return applyDecide(ctx);
    if (act === 'pick') { ctx.state.decideName = target.dataset.name; ctx.parts.newName.value = ''; return ctx.paint(); }
    if (!ACTS[act]) return;
    ACTS[act](ctx, target);
    ctx.paint();
}

function inputAct(ctx, target) {
    if (target === ctx.parts.tone) paintFoot(ctx);
    if (target === ctx.parts.newName) { ctx.state.decideName = target.value.trim(); paintDecide(ctx); }
}

/**
 * 휴대폰에서 말투 칸을 누르면 키보드가 판을 가리므로 목록을 한 줄로 접고, 말투 칸과 큰 버튼만 남긴다.
 * 마우스가 있는 기기(hover 가 되는 기기)에서는 키보드가 화면을 가리지 않으니 접지 않는다
 */
function typingMode(ctx, target, on) {
    if (target !== ctx.parts.tone) return;
    if (on) {
        if (globalThis.matchMedia?.('(hover: none)').matches) ctx.root.classList.add('typing');
        return;
    }
    // 판 안을 눌러서 칸을 떠난 것이면 접힌 목록을 누름이 끝난 뒤에 편다(먼저 펴면 누른 자리에 다른 버튼이 와서 그것이 눌린다)
    if (ctx.pressing) return;
    ctx.root.classList.remove('typing');
}

/** 누름이 끝났는데 말투 칸에서 벗어나 있으면 접은 목록을 편다 */
function endTyping(ctx) {
    if (ctx.root.getRootNode().activeElement !== ctx.parts.tone) ctx.root.classList.remove('typing');   // 판이 shadow root 안이면 포커스는 그 root 에서 읽는다
}
