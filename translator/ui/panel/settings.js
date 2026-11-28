// 번역 설정 판(승인된 시안 t2-settings-plan.html)의 화면 둘: 보기(view) · 내 규칙(rules).
// 판의 틀(screens.js)이 render(box, api) 를 부른다. 마크업과 클래스 이름은 시안 그대로다(모습은 common.css).

import { esc, SV, PLACE_NAME } from './text.js';
import { foldHtml } from './motion.js';
import { registerScreen } from './screens.js';
import { origSize, setOrigSize, origSizeChoices } from '../message/prefs.js';

/** 쓰는 곳 셋. 채팅이 열려 있지 않으면 모든 채팅만 고를 수 있다(나머지 둘은 적을 자리가 없다) */
const PLACES = ['all', 'card', 'chat'];
const scopeName = place => PLACE_NAME[place] ?? PLACE_NAME.all;
// 규칙 줄의 쓰는 곳 표시에 다는 시안의 색 클래스
const scopeTag = place => ({ card: 'c', chat: 't' })[place] ?? '';
const chatOpen = context => Boolean(context?.getCurrentChatId?.());
const placesFor = context => (chatOpen(context) ? PLACES : PLACES.slice(0, 1));

/** 쓰는 곳을 고르는 목록(시안의 .picks). 줄마다 data-scope 에 쓰는 곳 */
const scopePicks = (context, cur) => `<div class="picks">${placesFor(context).map(place =>
    `<div class="rule" data-scope="${place}" role="button" tabindex="0"><span>${scopeName(place)}</span><i class="radio${place === cur ? ' on' : ''}"></i></div>`).join('')}</div>`;

/** 펼침을 켜고 끈다: 누른 것(data-t)과 같은 이름의 자리(data-f). 다른 자리는 접는다 */
function toggleFold(root, id) {
    for (const each of root.querySelectorAll('[data-f]')) {
        const on = each.dataset.f === id && !each.classList.contains('on');
        each.classList.toggle('on', on);
        root.querySelector(`[data-t="${CSS.escape(each.dataset.f)}"]`)?.classList.toggle('up', on);
    }
}

const warn = error => { console.warn('[번역]', error); globalThis.toastr?.warning(error?.message || '저장하지 못했어요.'); };

/** Enter · Space 로도 눌리게(줄과 표시는 버튼 요소가 아니다) */
function keyAsClick(event) {
    // 쓰는 곳 고르기처럼 안쪽에서 이미 처리한 키는 다시 누르지 않는다(두 번 눌려 폈다 바로 접힌다)
    if (event.defaultPrevented || (event.key !== 'Enter' && event.key !== ' ')) return;
    if (!event.target.matches('[role="button"]')) return;
    event.preventDefault();
    event.target.click();
}

// ── 보기 ──
const DEFAULT_VIEW = { main: 'tr', when: 'tap' };
const WHEN = [['tap', '문단을 누르면 그 아래에'], ['bubble', '문단을 누르면 말풍선으로'], ['every', '늘, 문단마다 아래에 붙여서'], ['said', '늘, 대사에만 붙여서']];
const VIEW_DEMO = { tr: ['"오늘은 비가 오네."', '창밖을 보다가 우산을 집어 들었다.'], src: ['"It\'s raining today."', 'After a glance out the window, the umbrella came along.'] };
const tapped = when => when === 'tap' || when === 'bubble';

/** 지금 보기 값과 그 값이 적힌 쓰는 곳 */
function viewNow(layers) {
    const now = layers.view();
    return { ...DEFAULT_VIEW, ...(now.settings.view ?? {}), place: now.from.view ?? 'all' };
}

/** 첫 화면 줄에 보일 글 */
export function viewSum({ main, when }) {
    const self = main === 'src' ? '원문' : '번역', other = main === 'src' ? '번역' : '원문';
    if (when === 'tap') return `누르면 아래에 ${other}`;
    if (when === 'bubble') return `누르면 말풍선으로 ${other}`;
    return `${self} (${when === 'every' ? '문단마다' : '대사에'} ${other} 붙임)`;
}

/** 예시 문단 둘. open: 눌러서 다른 쪽 글이 떠 있는 문단 번호(없으면 null) */
function viewDemoHtml(view, size, open) {
    const self = VIEW_DEMO[view.main], other = VIEW_DEMO[view.main === 'tr' ? 'src' : 'tr'];
    const small = size === 'small' ? ' btr-view-small' : '';
    const box = (cls, i) => `<div class="orig ${cls}${view.main === 'src' ? ' tr' : ''}${small}">${esc(other[i])}</div>`;
    return self.map((text, i) => {
        const on = tapped(view.when) && open === i, fixed = view.when === 'every' || (view.when === 'said' && i === 0);
        const bubble = on && view.when === 'bubble' ? `<div class="bub${small}">${esc(other[i])}</div>` : '';
        const below = on && view.when === 'tap' ? box('on', i) : fixed ? box('', i) : '';
        return `<div class="para${on ? ' picked' : ''}" data-p="${i}">${esc(text)}${bubble}</div>${below}`;
    }).join('') + (tapped(view.when) ? '<small class="btr-view-hint">문단을 눌러 보세요</small>' : '');
}

function viewHtml(view, size) {
    const seg = (attr, list, cur) => `<div class="seg h">${list.map(([value, name]) => `<span data-${attr}="${value}" role="button" tabindex="0"${value === cur ? ' class="s"' : ''}>${name}</span>`).join('')}</div>`;
    return `<div class="lab btr-view-first">먼저 보이는 글</div>${seg('main', [['tr', '번역 먼저'], ['src', '원문 먼저']], view.main)}
<div class="lab">${view.main === 'src' ? '번역' : '원문'}은 언제 보이나요</div>
<div class="group btr-view-when">${WHEN.map(([id, name]) => `<div class="rule" data-when="${id}" role="button" tabindex="0"><span>${name}</span><i class="radio${id === view.when ? ' on' : ''}"></i></div>`).join('')}</div>
<div class="lab two2 btr-view-demo-lab"><span>이렇게 보여요</span><span class="btr-view-size"><span>${view.main === 'src' ? '번역' : '원문'} 글자</span>${seg('size', origSizeChoices().map(each => [each.value, each.name]), size)}</span></div>
<div class="demo vd"></div>
<div data-where></div>`;
}

/** 보기 값을 지금 그 값이 적힌 쓰는 곳에 적는다(전용으로 둔 값은 전용으로 남는다) */
function saveView(api, value) {
    api.layers.setSetting('view', value);
    api.tools?.onView?.();
}

/** 쓰는 곳을 바꾼다: 고른 곳에 적고, 그보다 좁은 쓰는 곳에 남은 값은 지운다(남겨 두면 좁은 쪽이 이겨 고른 곳의 값이 안 먹는다) */
function moveView(api, to, value) {
    const order = ['chat', 'card', 'all'];
    for (const place of order.slice(0, order.indexOf(to))) {
        if (api.layers.read(place).settings.view) api.layers.edit(place, data => { delete data.settings.view; });
    }
    api.layers.edit(to, data => { data.settings.view = value; });
    api.tools?.onView?.();
}

function renderView(box, api) {
    const root = document.createElement('div');
    root.className = 'btr-view';
    box.append(root);
    let open = null;   // 예시에서 눌러 둔 문단. 처음과 보이는 때를 바꾼 직후에는 없다(누르지 않았는데 떠 있으면 늘 붙어 있는 것처럼 보였다)

    const valueOf = view => ({ main: view.main, when: view.when });
    function paintDemo(view) {
        root.querySelector('.vd').innerHTML = viewDemoHtml(view, origSize(), open);
    }
    // 쓰는 곳은 채팅이 열려 있을 때만 보인다(채팅이 없으면 고를 곳이 모든 채팅 하나뿐이다)
    function paintWhere(view) {
        if (!chatOpen(api.context()) || !api.where) return;
        api.where(root.querySelector('[data-where]'), view.place, place => change(() => moveView(api, place, valueOf(view))), { places: PLACES });
    }
    function paint() {
        const view = viewNow(api.layers);
        root.innerHTML = viewHtml(view, origSize());
        paintDemo(view);
        paintWhere(view);
    }
    function change(fn) {
        try { fn(); } catch (error) { warn(error); }
        paint();
        api.refresh?.();
    }

    function onClick(event) {
        const t = event.target, view = viewNow(api.layers);
        const main = t.closest('[data-main]'), when = t.closest('[data-when]'), size = t.closest('[data-size]'), para = t.closest('.vd .para');
        if (main) change(() => saveView(api, { ...valueOf(view), main: main.dataset.main }));
        else if (when) { open = null; change(() => saveView(api, { ...valueOf(view), when: when.dataset.when })); }
        else if (size) change(() => setOrigSize(size.dataset.size));
        else if (para && tapped(view.when)) { open = open === +para.dataset.p ? null : +para.dataset.p; paintDemo(view); }
    }

    root.addEventListener('click', onClick);
    root.addEventListener('keydown', keyAsClick);
    paint();
    return { refresh: paint, close: () => root.remove() };
}

/** 보기 화면 */
export const viewScreen = {
    title: '보기', icon: 'book-open',
    summary: api => (api?.layers ? viewSum(viewNow(api.layers)) : ''),
    render: renderView,
};

// ── 내 규칙 ──
/** 지금 보일 규칙들: 채팅이 없으면 모든 채팅 것만(나머지는 읽을 채팅이 없다) */
const rulesNow = api => api.layers.view().rules.filter(rule => chatOpen(api.context()) || rule.place === 'all');

function ruleRow(context, rule, openId) {
    const on = openId === rule.vid;
    return `<div class="rule"><span>${esc(rule.text)}</span><b class="tag ${scopeTag(rule.place)}${on ? ' up' : ''}" data-t="${esc(rule.vid)}" role="button" tabindex="0"><span>${scopeName(rule.place)}</span>${SV('down')}</b><span class="btr-rules-del" data-del="${esc(rule.vid)}" role="button" tabindex="0" aria-label="규칙 지우기">${SV('x')}</span></div>${foldHtml(rule.vid, on, `<div data-rule="${esc(rule.vid)}">${scopePicks(context, rule.place)}</div>`)}`;
}

// 앞뒤 한 쌍의 예시는 늘 같은 글이다(시안 그대로. 번역 요청을 보내지 않는다)
const RULE_EXAMPLE = `<div class="lab two2"><span>이렇게 반영돼요</span><span>예시: Captain 은 늘 '대장'으로</span></div>
<div class="ba"><div><small>규칙 없이</small><p>"선장님, 준비됐습니다."</p></div><div><small>규칙을 넣으면</small><p>"<mark>대장</mark>, 준비됐습니다."</p></div></div>`;

function rulesHtml(context, rules, state) {
    return `<div class="rlist">${rules.map(rule => ruleRow(context, rule, state.open)).join('')}</div>
<div class="btr-rules-new"><input type="text" class="input" data-new placeholder="규칙을 한 줄로 적어요" enterkeyhint="done" value="${esc(state.draft)}" aria-label="새 규칙">
<div class="sel" data-t="rnew" role="button" tabindex="0"><span class="cutv">${scopeName(state.scope)}</span>${SV('down')}</div><button type="button" class="go sm solid" data-act="add">넣기</button></div>
${foldHtml('rnew', false, `<div data-rule="">${scopePicks(context, state.scope)}</div>`)}
${RULE_EXAMPLE}`;
}

function renderRules(box, api) {
    const root = document.createElement('div');
    root.className = 'btr-rules';
    box.append(root);
    // open: 쓰는 곳 목록을 펴 둔 규칙, scope: 새 규칙을 넣을 쓰는 곳, draft: 적던 글(다시 그려도 남게)
    const state = { open: '', draft: '', scope: chatOpen(api.context()) ? 'chat' : 'all' };

    // 다시 그려도 새 규칙 칸에 있던 커서는 그 칸에 남긴다
    // 포커스는 판이 그려진 root(shadow root 또는 문서)에서 읽는다(문서의 activeElement 는 shadow 의 겉 칸)
    const typingNew = () => { const now = root.getRootNode().activeElement; return Boolean(now && root.contains(now) && now.matches('[data-new]')); };
    function paint(focus = typingNew()) {
        root.innerHTML = rulesHtml(api.context(), rulesNow(api), state);
        if (focus) root.querySelector('[data-new]')?.focus({ preventScroll: true });
    }
    function change(fn, focus = false) {
        try { fn(); } catch (error) { warn(error); }
        paint(focus);
        api.refresh?.();
    }
    function add() {
        const text = state.draft.trim();
        if (!text) return;
        state.draft = '';
        change(() => api.layers.addRule(state.scope, text), true);
    }
    /** 쓰는 곳 목록에서 골랐다: 규칙의 목록이면 그 규칙을 옮기고, 새 규칙 칸의 목록이면 넣을 곳만 바꾼다 */
    function pickScope(row) {
        const vid = row.closest('[data-rule]').dataset.rule, to = row.dataset.scope;
        state.open = '';
        if (vid) change(() => api.layers.moveRule(vid, to));
        else { state.scope = to; paint(); }
    }

    function onClick(event) {
        const t = event.target, del = t.closest('[data-del]'), scope = t.closest('[data-scope]'), opener = t.closest('[data-t]');
        if (t.closest('[data-act="add"]')) add();
        else if (del) change(() => api.layers.removeRule(del.dataset.del));
        else if (scope) pickScope(scope);
        else if (opener) {
            state.open = opener.dataset.t === 'rnew' || state.open === opener.dataset.t ? '' : opener.dataset.t;
            toggleFold(root, opener.dataset.t);
        }
    }
    function onInput(event) {
        if (event.target.matches('[data-new]')) state.draft = event.target.value;
    }
    function onKey(event) {
        if (event.key === 'Enter' && !event.isComposing && event.target.matches('[data-new]')) { event.preventDefault(); add(); }
        else keyAsClick(event);
    }

    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKey);
    paint();
    return { refresh: () => paint(), close: () => root.remove() };
}

/** 내 규칙 화면 */
export const rulesScreen = {
    title: '내 규칙', icon: 'scroll',
    // 첫 화면은 api 없이 부른다: 그때는 '' 를 돌려 첫 화면이 세 쓰는 곳의 규칙 수를 직접 세게 한다('없음'을 돌리면 규칙이 있어도 '없음'으로 보였다)
    summary: api => { if (!api?.layers) return ''; const n = rulesNow(api).length; return n ? `${n}개` : '없음'; },
    render: renderRules,
};

registerScreen('view', viewScreen);
registerScreen('rules', rulesScreen);
