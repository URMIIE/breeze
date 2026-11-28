// 번역 수정 화면: 번역문 전체를 직접 고친다(메시지의 수정 버튼). 메시지 본문 자리에 놓인다.
// 실리태번을 직접 부르지 않는다: 글을 넘겨받아 그리고, 저장할 꼴을 돌려준다(실제 저장은 넘겨받은 함수가 한다).
//
// mount(host, api) → { refresh, close, value }
//   host  이 화면을 넣을 요소(메시지 본문 자리의 빈 상자)
//   api
//     translation  저장된 번역문 전체
//     source       원문 전체(매크로를 푼 것)
//     rules?       화면용 정규식 규칙(core/shown.js 의 ScreenRule[]). 맨 앞, 맨 뒤의 안 그려지는 덩이를 떼는 데 쓴다
//     kept?        { pairs, hash } 지금 메시지에 적힌 문단 짝 기록과 원문 해시. 저장 꼴에 그대로 실어 돌려준다
//     offset?      열 때 보여 줄 자리(번역문 전체에서 몇 글자째). 읽던 문단의 시작을 주면 그 문단이 맨 위에 오게 열린다
//     side?        원문과 나란히 보기를 켠 채 열지(지난번 상태)
//     onSide?(on)  나란히 보기를 켜거나 껐을 때(다음에 같은 상태로 열려고)
//     onRedo?()    대사 골라 다시 번역 버튼
//     onCancel()   취소
//     onSave(shape) 저장. shape 는 saveShape 가 만든다
//   refresh()  원문과 나란히 보기를 다시 그린다
//   close()    화면을 떼고 듣기를 멈춘다
//   value()    지금 고치는 칸의 글(그려지는 부분만)
//
// 고치는 칸에는 본문에 그려지는 글만 보인다: 맨 앞, 맨 뒤의 숨김 주석과 화면에서 지워지는 덩이(생각 글 등)는 떼어 뒀다가
// 저장할 때 원래대로 붙인다. 보이지 않는 글을 칸에 두면 지우거나 깨뜨리기 쉽다.

import { splitEnds } from '../../core/shown.js';

// 버튼마다 아이콘 아래 작은 이름(휴대폰에는 마우스 올리기가 없어 title 만으로는 무엇인지 몰랐다).
// 나란히 보기 아이콘은 두 칸 그림: 펼친 책은 설정 판의 '보기' 줄과 같은 그림이라 같은 기능으로 보였다
const FRAME = `<div class="btr-edit-bar" role="toolbar" aria-label="번역 수정">
<button type="button" data-act="side" aria-pressed="false" aria-label="원문과 나란히 보기"><i class="fa-solid fa-table-columns" aria-hidden="true"></i><small>원문과 나란히</small></button>
<button type="button" data-act="redo" aria-label="대사 골라 재번역"><i class="fa-solid fa-rotate" aria-hidden="true"></i><small>재번역</small></button>
<span class="btr-edit-gap"></span>
<button type="button" data-act="cancel" aria-label="취소"><i class="fa-solid fa-xmark" aria-hidden="true"></i><small>취소</small></button>
<button type="button" data-act="save" class="btr-edit-ok" aria-label="저장"><i class="fa-solid fa-check" aria-hidden="true"></i><small>저장</small></button>
</div>
<div class="btr-edit-scroll">
<div class="btr-edit-src" hidden></div>
<textarea class="btr-edit-area" aria-label="번역문"></textarea>
<div class="btr-edit-rows" hidden></div>
</div>`;

/**
 * 글을 빈 줄에서 문단으로 나눈다. 문단 사이의 빈 줄과 앞뒤 공백은 그대로 들고 있어서 joinParts 가 원래 글을 되돌린다.
 * @returns {{ lead: string, trail: string, paras: string[], seps: string[] }}
 */
export function parts(text) {
    const whole = String(text ?? ''), lead = whole.match(/^\s*/)[0], trail = whole.slice(lead.length).match(/\s*$/)[0];
    const bits = whole.slice(lead.length, whole.length - trail.length).split(/(\n[ \t]*\n\s*)/);
    const filled = bits.length > 1 || bits[0];
    return { lead, trail, paras: filled ? bits.filter((_, i) => i % 2 === 0) : [], seps: bits.filter((_, i) => i % 2 === 1) };
}

export const joinParts = ({ lead, trail, paras, seps }) => lead + paras.map((para, i) => para + (seps[i] ?? '')).join('') + trail;

/**
 * 저장할 꼴. 메시지와 지금 스와이프 사본에 같이 넣는 것(store/message.js 의 attach 가 받는 꼴)에 erase, same 을 더했다.
 * @param {string} edited 고치는 칸의 글
 * @param {{ head: string, body: string, tail: string }} ends 열 때 떼어 둔 것
 * @param {{ pairs?: object | null, hash?: string }} [kept] 문단 짝 기록과 원문 해시
 * @returns {{ erase: boolean, same: boolean, text: string, pairs: object | null, hash: string | undefined }}
 *   erase 칸을 비우고 저장함(번역을 지운다), same 바뀐 것이 없음(저장하지 않아도 된다), text 붙일 번역문 전체.
 *   pairs 는 받은 그대로다: 짝 기록은 번역 문단을 지문으로 찾아서, 고친 문단은 앞뒤 문단 사이의 차례로 다시 맞는다
 */
export function saveShape(edited, ends, kept = {}) {
    const body = String(edited ?? ''), before = ends.head + ends.body + ends.tail;
    // 칸에 보일 글이 처음부터 없던 번역(전부 안 그려지는 글)은 빈 채 저장해도 지우지 않는다
    const erase = !body.trim() && !!ends.body.trim();
    const text = erase ? '' : body.trim() ? ends.head + body + ends.tail : before;
    return { erase, same: text === before, text, pairs: kept.pairs ?? null, hash: kept.hash };
}

/** 칸 높이를 글에 맞춘다. 한꺼번에: 칸마다 지우고 재고 넣으면 칸 수만큼 화면 배치를 다시 계산한다 */
function fitAll(areas) {
    for (const area of areas) area.style.height = 'auto';
    const heights = areas.map(area => area.scrollHeight);
    areas.forEach((area, i) => { area.style.height = `${heights[i] + 2}px`; });
}

function rowFor(source, value, i) {
    const row = document.createElement('div'), src = document.createElement('div'), area = document.createElement('textarea');
    row.className = 'btr-edit-row';
    src.className = 'btr-edit-src';
    src.textContent = source;
    Object.assign(area, { rows: 1, value });
    area.dataset.row = String(i);
    area.setAttribute('aria-label', `${i + 1}번째 문단의 번역`);
    row.append(src, area);
    return row;
}

/** 원문과 나란히 보기. 문단 수가 같으면 문단마다 원문 아래에 번역 칸, 다르면(짝이 틀리므로) 원문 전체를 위에 */
function showSide(ui) {
    const { scroll, area, rows, whole } = ui;
    rows.hidden = whole.hidden = true;
    area.hidden = false;
    scroll.classList.remove('btr-edit-paired');
    ui.split = null;
    if (!ui.side) return;
    const src = parts(ui.src.body), dst = parts(area.value);
    if (src.paras.length < 2 || src.paras.length !== dst.paras.length) { whole.textContent = ui.src.body; whole.hidden = false; return; }
    rows.replaceChildren(...src.paras.map((para, i) => rowFor(para, dst.paras[i], i)));
    area.hidden = true;
    rows.hidden = false;
    scroll.classList.add('btr-edit-paired');
    ui.split = dst;
    fitAll([...rows.querySelectorAll('textarea')]);
}

/** 고치는 칸에서 그 글자 자리까지의 높이(줄바꿈이 접히는 것까지 세려고 같은 폭의 보이지 않는 상자에 넣어 잰다) */
function heightBefore(ui, offset) {
    const { area, scroll } = ui, style = getComputedStyle(area), probe = document.createElement('div');
    probe.className = 'btr-edit-measure';
    probe.style.width = `${area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)}px`;
    probe.textContent = `${area.value.slice(0, offset)}가`;
    scroll.append(probe);
    const height = probe.offsetHeight - parseFloat(style.lineHeight);
    probe.remove();
    return Math.max(0, height);
}

/** 그 글자 자리가 든 문단의 번호 */
function rowAt(split, at) {
    let end = split.lead.length;
    for (let row = 0; row < split.paras.length; row++) {
        end += split.paras[row].length + (split.seps[row] ?? '').length;
        if (at < end) return row;
    }
    return split.paras.length - 1;
}

/** 읽던 문단이 맨 위에 오게 한다(칸에 글자를 넣을 자리는 잡지 않는다: 휴대폰에서 키보드가 올라와 글을 가린다) */
function seek(ui, offset) {
    const at = Math.max(0, Math.min(ui.ends.body.length, offset - ui.ends.head.length));
    if (!ui.split) { ui.area.scrollTop = heightBefore(ui, at); return; }
    const target = ui.rows.children[rowAt(ui.split, at)];
    if (target) ui.scroll.scrollTop = target.offsetTop;
}

function press(ui, api, kind) {
    if (kind === 'side') {
        ui.side = !ui.side;
        ui.bar.querySelector('[data-act="side"]').setAttribute('aria-pressed', String(ui.side));
        showSide(ui);
        api.onSide?.(ui.side);
    }
    else if (kind === 'redo') api.onRedo?.();
    else if (kind === 'cancel') api.onCancel?.();
    else if (kind === 'save') api.onSave?.(saveShape(ui.area.value, ui.ends, api.kept));
}

/** 나란히 보기의 칸에 쓴 글을 번역문 전체에 넣는다(문단 사이의 빈 줄은 원래 그대로) */
function typed(ui, area) {
    if (!ui.split || area.dataset.row == null) return;
    ui.split.paras[Number(area.dataset.row)] = area.value;
    ui.area.value = joinParts(ui.split);
    fitAll([area]);
}

export function mount(host, api) {
    const el = document.createElement('div');
    el.className = 'btr-edit';
    el.innerHTML = FRAME;
    const find = name => el.querySelector(`.btr-edit-${name}`);
    const ui = { bar: find('bar'), scroll: find('scroll'), whole: find('src'), area: find('area'), rows: find('rows'), split: null, side: !!api.side };
    ui.ends = splitEnds(api.translation, api.rules);
    ui.src = splitEnds(api.source, api.rules);
    ui.area.value = ui.ends.body;
    ui.bar.querySelector('[data-act="side"]').setAttribute('aria-pressed', String(ui.side));
    const onClick = event => { const button = event.target.closest?.('[data-act]'); if (button) press(ui, api, button.dataset.act); };
    const onInput = event => typed(ui, event.target);
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    host.append(el);
    showSide(ui);
    if (Number.isFinite(api.offset)) seek(ui, api.offset);
    return {
        refresh: () => showSide(ui),
        close() { el.removeEventListener('click', onClick); el.removeEventListener('input', onInput); el.remove(); },
        value: () => ui.area.value,
    };
}
