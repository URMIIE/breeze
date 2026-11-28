// 메시지 버튼 넷: 맨 앞 버튼 · 수정 · 번역 지우기(지우개) · 설정(시안 mock2 1).
// 맨 앞 버튼은 지금 누르면 일어나는 일을 보여 준다:
//   번역 없음 → 번역 · 번역하는 동안 → 멈추기 · 번역이 보임 → 원문으로 바꾸기(바꾸기 그림) · 원문이 보임 → 번역으로 바꾸기(번역 그림에 색)
// 버튼은 실리태번 메시지의 덧버튼 칸(.extraMesButtons) 맨 앞에 붙인다(옛 번역 버튼과 같은 자리).
// 새 메시지는 #chat 의 바로 아래 자식으로만 들어오므로 그것만 지켜본다(subtree 를 켜면 답이 오는 동안 글자 조각마다 콜백이 돈다).
// 버튼 그림은 같은 줄의 다른 버튼이 그려진 꼴에 맞춘다(look.js): 메시지가 붙을 때와 테마를 고를 때 옆 버튼을 잰다.
// 실리태번은 테마가 바뀌었다는 신호를 따로 내지 않아, 테마 고르는 칸(#themes)의 바뀜을 듣는다(다른 길로 테마가 바뀌면 다음 메시지가 붙을 때 맞춰진다).

import { matchNeighbors, themeDraws } from './look.js';
import { allSettings, saved, write } from './prefs.js';
import * as pins from '../../../features/message_pins.js';
import { orderOf, reorder } from './button-order.js';

// 종류 클래스(kind)는 옛 번역기와 같은 이름을 그대로 단다: 메시지 버튼을 고정하거나 숨기는 기능은 버튼을 첫 종류 클래스로 가리고,
// 테마와 다른 확장도 그 이름에 제 아이콘을 입혀 두었다. 그래서 mes_button 바로 뒤 맨 앞에 두고 우리 클래스는 그 뒤에 둔다.
// 맨 앞 버튼은 번역이 없을 때 '번역', 있을 때 '바꾸기' 종류다(번역하는 동안은 누르기 전의 종류 그대로 두고 그림만 멈추기로).
const TRANSLATE = 'mes_llm_translate', TOGGLE = 'mes_toggle_original';
const FIRST = {
    none: { kind: TRANSLATE, icon: 'fa-language', label: '번역' },
    busy: { kind: null, icon: 'fa-stop', label: '멈추기' },
    shown: { kind: TOGGLE, icon: 'fa-right-left', label: '원문으로 바꾸기' },
    original: { kind: TOGGLE, icon: 'fa-language', label: '번역으로 바꾸기' },
};
const OTHERS = [
    ['mes_edit_translation', 'btr-button-edit', 'fa-pen-to-square', '수정'],
    ['mes_delete_translation', 'btr-button-erase', 'fa-eraser', '번역 지우기'],
    ['mes_llmt_settings', 'btr-button-settings', 'fa-sliders', '설정'],
];
const KINDS = [TRANSLATE, TOGGLE, ...OTHERS.map(other => other[0])];

// ── 버튼 숨기기 ──
// 숨긴 버튼은 종류 이름으로 적는다. 적는 자리는 옛 번역기와 같다: '메시지 버튼 관리' 기능이 켜져 있으면 그 기능의 숨김 목록
// (그쪽 화면과 같은 값이고, 가리는 것도 그쪽이 한다), 꺼져 있으면 번역 설정의 hidden_buttons 이고 여기서 CSS 로 가린다.
// 그 기능이 설정에는 켜져 있는데 아직 돌지 않는 동안(시작 전이거나 시작하지 못함)에도 목록은 그 기능의 것 하나만 읽고 쓴다.
// 가리는 것만 그동안 여기서 맡는다: 번역 설정에 따로 적으면 값이 두 곳으로 갈리고, 그 기능이 돌기 시작하면 방금 숨긴 것이 풀린다.
// 옛 hide_..._button 값은 읽지 않는다: 옛 번역기가 읽지 않게 된 뒤에도 값이 남아 있어, 읽으면 쓰던 버튼이 사라진다.
// 맨 앞 버튼은 종류가 둘이라 줄도 둘이다(번역이 없을 때의 종류, 있을 때의 종류).
// 맨 앞 버튼은 하나다(번역이 없으면 번역, 있으면 원문/번역 바꾸기). 숨김 목록에는 옛 버튼 둘의 종류 이름이 따로 남아 있을 수 있어서
// 설정에서는 한 줄로 보이고, 숨기면 두 종류를 같이 적고 보이면 같이 지운다
const FIRST_KEY = 'first';
const HIDEABLE = [
    { key: FIRST_KEY, name: '번역 · 원문 전환', hint: '' },
    ...OTHERS.map(other => ({ key: other[0], name: other[3], hint: '' })),
];
const pinsOn = () => Boolean(allSettings().breeze?.enabled?.message_pins);
/** 버튼 관리 기능이 돌고 있는가(돌지 않으면 그 기능의 isHidden 이 null 을 준다) */
const pinsRunning = () => pins.isHidden('') !== null;
const listOf = value => (Array.isArray(value) ? value : []);
const ownHidden = () => listOf(saved().hidden_buttons);
const pinsHidden = () => listOf(allSettings().breeze?.options?.message_pins?.hidden);
/** 지금 쓰는 숨김 목록(종류 이름들) */
const hiddenNow = () => (pinsOn() ? pinsHidden() : ownHidden());
const isHidden = key => hiddenNow().includes(key);

/** 버튼 관리 기능이 돌지 않을 때 그 기능의 숨김 목록에 바로 적는다(그 기능이 돌기 시작하면 이 목록으로 가린다) */
function writePinsHidden(key, hidden) {
    const c = globalThis.SillyTavern.getContext();
    const options = ((c.extensionSettings.breeze.options ??= {}).message_pins ??= {});
    const rest = listOf(options.hidden).filter(each => each !== key);
    options.hidden = hidden ? [...rest, key] : rest;
    c.saveSettingsDebounced();
}

let hideStyle = null;
function applyHidden() {
    const keys = pinsOn() && pinsRunning() ? [] : hiddenNow().filter(key => KINDS.includes(key));
    if (!keys.length) { hideStyle?.remove(); return; }
    const css = `#chat .mes :is(.mes_buttons, .extraMesButtons) :is(${keys.map(key => `.${key}`).join(', ')}) { display: none !important; }`;
    hideStyle ??= Object.assign(document.createElement('style'), { id: 'btr-button-hide' });
    if (hideStyle.textContent !== css) hideStyle.textContent = css;
    if (!hideStyle.isConnected) document.head.append(hideStyle);
}

// 숨김 목록이 바뀌면 이미 그려진 맨 앞 버튼의 종류와 그림을 다시 맞춘다(화면에 버튼을 붙인 뒤에 mountButtons 가 채운다)
let syncShown = () => {};
const HIDDEN_CHANGED = 'breeze-message-buttons-hidden';   // 버튼 관리 기능이 document 에 내는 알림의 이름
/** 숨김 목록이 바뀐 뒤: 가리는 규칙과 그려진 버튼을 지금 목록에 맞춘다 */
function hiddenChanged() {
    applyHidden();
    applyOrder();
    syncShown();
}

// ── 버튼 순서 ──
// 숨김과 같은 규칙으로 한 곳에만 적는다: '메시지 버튼 관리'가 켜져 있으면 그 기능의 두 순서 목록(바로 표시 pins, ⋯ 메뉴 menuOrder) 안에서
// 번역 버튼끼리 자리만 바꾸고(다른 확장 버튼 자리 · 두 칸 구분은 그대로, button-order.js), 꺼져 있으면 번역 설정의 button_order 에 적고
// 여기서 CSS order 로만 놓는다(버튼을 옮기지 않는다: 다른 확장이 건 처리가 그대로 남게). 그 기능을 켠 채 순서를 바꾸면 button_order 는 지운다
// (켜진 동안 따로 남은 순서가 끈 뒤 엇갈려 살아나지 않게). 맨 앞 버튼의 두 종류는 한 덩이로 같이 움직인다
const UNITS = { [FIRST_KEY]: [TRANSLATE, TOGGLE], ...Object.fromEntries(OTHERS.map(other => [other[0], [other[0]]])) };
const pinsLists = () => pins.getOrder() ?? { pins: listOf(allSettings().breeze?.options?.message_pins?.pins), menuOrder: listOf(allSettings().breeze?.options?.message_pins?.menuOrder) };
const ownOrder = () => { const own = listOf(saved().button_order).filter(key => key in UNITS); return [...own, ...Object.keys(UNITS).filter(key => !own.includes(key))]; };
/** 지금 보이는 차례(덩이 이름들) */
const orderNow = () => (pinsOn() ? orderOf(pinsLists(), UNITS) : ownOrder());

let orderStyle = null;
/**
 * 그 기능이 돌지 않는 동안: ⋯ 메뉴 안에서 번역 버튼끼리의 차례를 CSS order 로. 번역 버튼 넷은 한 덩이로 붙어 있고 그 앞뒤에 다른 확장 버튼이 붙는다
 * (번역 버튼은 맨 앞에 넣지만 다른 확장이 나중에 그 앞에 넣기도 한다). 앞의 것은 그대로(order 0), 번역 버튼은 1부터 새 차례, 그 뒤의 것은 그다음 수로 두어
 * 다른 버튼 자리는 그대로 두고 번역 버튼끼리만 바꾼다
 */
function applyOrder() {
    const order = pinsOn() && pinsRunning() ? [] : orderNow();
    const plain = order.every((unit, i) => unit === Object.keys(UNITS)[i]);
    if (!order.length || plain) { orderStyle?.remove(); return; }
    const css = order.map((unit, i) => `#chat .mes .extraMesButtons > :is(${UNITS[unit].map(kind => `.${kind}`).join(', ')}).btr-button { order: ${i + 1}; }`).join('\n')
        + `\n#chat .mes .extraMesButtons > .btr-button ~ :not(.btr-button) { order: ${order.length + 1}; }`;
    orderStyle ??= Object.assign(document.createElement('style'), { id: 'btr-button-order' });
    if (orderStyle.textContent !== css) orderStyle.textContent = css;
    if (!orderStyle.isConnected) document.head.append(orderStyle);
}

/** 버튼 순서를 바꾸고 저장한다(덩이 이름들: 'first' · 수정 · 번역 지우기 · 설정의 종류 이름). 화면의 버튼은 바로 바뀐다 @returns {boolean} */
export function setButtonOrder(order) {
    const next = [...new Set(order.filter(unit => unit in UNITS))];
    if (next.length !== Object.keys(UNITS).length) return false;
    if (pinsOn()) {
        const lists = reorder(pinsLists(), next, UNITS);
        if (!pins.setOrder(lists)) writePinsOrder(lists);
        if (saved().button_order) write('button_order', undefined);
    } else write('button_order', next);
    applyOrder();
    return true;
}

/** 버튼 관리 기능이 돌지 않을 때 그 기능의 순서 목록에 바로 적는다(그 기능이 돌기 시작하면 이 목록으로 놓는다) */
function writePinsOrder(lists) {
    const c = globalThis.SillyTavern.getContext();
    const options = ((c.extensionSettings.breeze.options ??= {}).message_pins ??= {});
    options.pins = lists.pins;
    options.menuOrder = lists.menuOrder;
    c.saveSettingsDebounced();
}

/** 숨길 수 있는 버튼들(지금 차례대로) @returns {{ key: string, name: string, hint: string, hidden: boolean }[]} hint 는 덧붙일 설명(없으면 '') */
const hiddenRow = key => (key === FIRST_KEY ? isHidden(TRANSLATE) && isHidden(TOGGLE) : isHidden(key));
export const buttonList = () => { const order = orderNow(); return [...HIDEABLE].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).map(each => ({ ...each, hidden: hiddenRow(each.key) })); };

/** 버튼 하나를 숨기거나 다시 보이고 저장한다. 화면의 버튼은 바로 바뀐다 @returns {boolean} 바꿨으면 true */
export function setButtonHidden(key, hidden) {
    if (key === FIRST_KEY) return [TRANSLATE, TOGGLE].map(kind => setButtonHidden(kind, hidden)).every(Boolean);
    if (!KINDS.includes(key)) return false;
    if (pinsOn()) {
        if (!pins.setHidden(key, hidden)) writePinsHidden(key, hidden);
    } else {
        const rest = ownHidden().filter(each => each !== key);
        write('hidden_buttons', hidden ? [...rest, key] : rest);
    }
    hiddenChanged();
    return true;
}

/**
 * 우리 그림(선 그림)으로 그릴 버튼인가: 테마가 그 종류에 제 그림을 입혀 두지 않았거나, 테마가 모르는 멈추기 그림이거나,
 * 맨 앞 버튼이 그 상태의 원래 종류가 숨겨져 다른 쪽 종류를 달고 있을 때(shownKind). 마지막 경우에 테마 그림을 두면
 * 번역이 없는 답에 바꾸기 그림이, 번역이 보이는 답에 번역 그림이 나온다.
 */
function dress(el) {
    const kind = KINDS.find(name => el.classList.contains(name)), state = el.dataset.state;
    const borrowed = Boolean(FIRST[state]?.kind) && FIRST[state].kind !== kind;
    el.classList.toggle('btr-plain', state === 'busy' || borrowed || !themeDraws(kind));
}

function button(kind, mine, icon, label) {
    const el = document.createElement('div');
    el.className = `mes_button ${kind} btr-button ${mine} fa-solid ${icon} interactable`;
    el.tabIndex = 0;
    el.title = label;
    el.setAttribute('aria-label', label);
    el.setAttribute('role', 'button');
    return el;
}

let template = null;
function buttons() {
    if (!template) {
        template = document.createDocumentFragment();
        template.append(button(shownKind(TRANSLATE), 'btr-button-first', FIRST.none.icon, FIRST.none.label), ...OTHERS.map(other => button(...other)));
    }
    return template.cloneNode(true);
}

/**
 * 맨 앞 버튼에 달 종류. 이 버튼은 번역과 바꾸기를 하나로 합친 것이라, 예전에 그 둘 가운데 하나만 숨겨 둔 사람은
 * 숨긴 쪽 종류가 걸리는 상태에서 버튼이 통째로 사라졌다(번역 버튼을 숨겨 둔 사람은 번역을 시작할 버튼이 없음).
 * 둘 다 숨겼을 때만 숨는다: 그 상태의 종류가 숨겨져 있고 다른 쪽은 아니면 다른 쪽 종류를 단다.
 */
function shownKind(kind, hidden = hiddenNow()) {
    if (!kind) return kind;
    const other = kind === TRANSLATE ? TOGGLE : TRANSLATE;
    return hidden.includes(kind) && !hidden.includes(other) ? other : kind;
}

/** 맨 앞 버튼의 종류 클래스를 그 상태와 숨김 목록에 맞춘다. 번역하는 동안은 누르기 전의 종류 그대로 둔다 */
function setKind(el, state, hidden) {
    const kind = shownKind((FIRST[state] ?? FIRST.none).kind, hidden);
    // 종류 클래스를 바꿀 때도 mes_button 바로 뒤 자리를 지킨다(버튼을 첫 종류 클래스로 가리는 기능이 있다)
    if (kind && !el.classList.contains(kind)) el.className = el.className.replace(/\b(?:mes_llm_translate|mes_toggle_original)\b/, kind);
}

/** 맨 앞 버튼의 모양을 상태에 맞춘다(바뀐 것만 건드린다) */
function paintFirst(el, state) {
    const look = FIRST[state] ?? FIRST.none;
    if (el.dataset.state === state) return;
    el.classList.remove(...Object.values(FIRST).map(f => f.icon));
    el.classList.add(look.icon);
    setKind(el, state);
    el.dataset.state = state;
    el.title = look.label;
    el.setAttribute('aria-label', look.label);
}

/**
 * @param {object} o
 * @param {(id: number) => 'none' | 'busy' | 'shown' | 'original'} o.stateOf 메시지 번호 → 상태
 * @param {Record<'first' | 'edit' | 'erase' | 'settings', (id: number) => void>} o.on 누르면 할 일
 * @returns {{ paint: (mes?: Element) => void }} paint(): 전부, paint(메시지 요소): 그 메시지만
 */
export function mountButtons({ stateOf, on }) {
    const chat = document.getElementById('chat');
    const add = mes => {
        if (!mes?.classList?.contains('mes') || mes.querySelector('.btr-button-first')) return;
        mes.querySelector('.extraMesButtons')?.prepend(buttons());
        paintOne(mes);
    };
    // hidden(숨김 목록)을 주면 상태가 그대로인 맨 앞 버튼의 종류도 그 목록에 맞춘다(paintFirst 는 상태가 바뀐 버튼만 건드린다)
    const paintOne = (mes, hidden) => {
        const first = mes.querySelector('.btr-button-first'), id = Number(mes.getAttribute('mesid'));
        if (first && Number.isInteger(id)) paintFirst(first, stateOf(id));
        if (first && hidden) setKind(first, first.dataset.state, hidden);
        for (const el of mes.querySelectorAll('.btr-button')) dress(el);
    };
    syncShown = () => {
        const hidden = hiddenNow();
        for (const el of chat.querySelectorAll('.btr-button-first')) { setKind(el, el.dataset.state, hidden); dress(el); }
    };
    // 버튼 관리 기능이 제 화면에서 숨김을 바꾸거나 돌기 시작한 것을 알리면 바로 맞춘다. 알림이 없어도 전부 다시 그릴 때(paint) 맞춰진다
    document.addEventListener(HIDDEN_CHANGED, hiddenChanged);
    const paint = mes => {
        if (mes) { add(mes); paintOne(mes); return; }
        matchNeighbors();
        applyHidden();
        applyOrder();
        const hidden = hiddenNow();
        for (const each of chat.querySelectorAll(':scope > .mes')) { add(each); paintOne(each, hidden); }
    };
    // 채팅이 열려 메시지가 붙은 뒤에야 옆 버튼을 잴 수 있다: 붙은 묶음마다 한 번만(화면을 한 번 그린 뒤)
    let matching = false;
    const matchSoon = () => {
        if (matching) return;
        matching = true;
        requestAnimationFrame(() => { matching = false; matchNeighbors(); for (const el of chat.querySelectorAll('.btr-button')) dress(el); });
    };
    new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) add(node);
        matchSoon();
    }).observe(chat, { childList: true, subtree: false });

    document.getElementById('themes')?.addEventListener('change', matchSoon);

    const kinds = { 'btr-button-first': 'first', 'btr-button-edit': 'edit', 'btr-button-erase': 'erase', 'btr-button-settings': 'settings' };
    const press = event => {
        const el = event.target.closest?.('.btr-button');
        if (!el) return;
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        const id = Number(el.closest('.mes')?.getAttribute('mesid'));
        const kind = Object.keys(kinds).find(name => el.classList.contains(name));
        if (Number.isInteger(id) && kind) on[kinds[kind]](id);
    };
    chat.addEventListener('click', press);
    chat.addEventListener('keydown', press);
    paint();
    return { paint };
}
