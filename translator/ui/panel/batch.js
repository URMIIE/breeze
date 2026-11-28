// 채팅 전부 번역의 시작 전 확인 화면.
// '전부 번역'을 누르면 바로 시작하지 않고, 무엇이 얼마나 나가는지(새로 번역할 답과 어림한 요청 수, 전에 번역한 글이라 바로 붙일 답),
// 어느 프롬프트와 모델로 하는지 보여 주고, 처음 답부터 할지 최근 답부터 할지 고르게 한다.
// 요청 수가 많으면(MANY 를 넘으면) 그 숫자를 강조 색으로 보인다. 도는 동안의 아래 한 줄은 여기서 그리지 않는다.
// 화면만 다룬다: 번역을 시작하는 일은 api 를 넘겨준 쪽이 한다.
//
// api 꼴
//   data(): {
//     left: number           번역 안 된 답 수
//     fresh: number          그 가운데 새로 번역할 답 수
//     freshRequests: number  새로 번역에 드는 요청 수(답의 길이로 어림한 값)
//     reuse: number          전에 번역한 글이라 요청 없이 바로 붙일 답 수
//     prompt: string         쓰는 프롬프트 이름
//     model: string          쓰는 모델 이름
//     from?: 'first' | 'last'  처음 골라 둘 차례(없으면 처음 답부터)
//   }
//   setHead?({ title: string, sub: string, back: { label: string, onBack: () => void } | null })  판 머리의 글
//   onStart({ from: 'first' | 'last' })   번역 시작
//   onCancel()                             취소
// 돌려주는 값: { refresh(), close() }. refresh 는 data() 를 다시 읽어 그리고(고른 차례는 남긴다), close 는 듣기를 떼고 비운다.

const MANY = 50;  // 요청 수가 이보다 많으면 강조 색으로 보인다

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
const button = (cls, act, props, ...kids) => el('button', { type: 'button', class: cls, 'data-act': act, ...props }, ...kids);
const num = value => Math.max(0, Number(value) || 0);
/** '요청 13번쯤', 요청이 없으면 '요청 없음' */
const requestText = n => (n ? `요청 ${n}번쯤` : '요청 없음');

/**
 * @param {HTMLElement} host 판 안에서 이 화면이 들어갈 자리(높이가 정해진 상자)
 * @param {object} api 맨 위 주석의 꼴
 */
export function mount(host, api) {
    const state = { data: {}, from: 'first' };
    const root = el('div', { class: 'btr-batch' });
    host.replaceChildren(root);

    function load(first) {
        state.data = api.data?.() ?? {};
        if (first && state.data.from === 'last') state.from = 'last';
    }
    const paint = () => paintAll(root, state, api);
    const onClick = event => {
        const target = event.target.closest('[data-act]');
        if (!target || target.disabled) return;
        const act = target.dataset.act;
        if (act === 'from') { state.from = target.dataset.from; paint(); }
        else if (act === 'start') api.onStart?.({ from: state.from });
        else if (act === 'cancel') api.onCancel?.();
    };
    root.addEventListener('click', onClick);

    load(true);
    paint();
    return {
        refresh() { load(false); paint(); },
        close() { root.removeEventListener('click', onClick); root.remove(); },
    };
}

function paintAll(root, state, api) {
    const data = state.data;
    api.setHead?.({ title: '채팅 전부 번역', sub: `번역 안 된 답 ${num(data.left)}개`, back: null });
    root.replaceChildren(
        el('div', { class: 'btr-batch-body' },
            el('div', { class: 'btr-batch-kvs' }, summaryRows(data)),
            el('div', { class: 'btr-batch-lab', text: '어디부터' }),
            el('div', { class: 'btr-batch-seg', role: 'group', 'aria-label': '어디부터' }, fromButton(state, 'first', '처음 답부터'), fromButton(state, 'last', '최근 답부터')),
            el('div', { class: 'btr-batch-note', text: '다른 채팅으로 가도 계속되고, 돌아오면 번역이 붙어 있어요.' })),
        el('div', { class: 'btr-batch-foot' },
            button('btr-batch-go is-line', 'cancel', {}, '취소'),
            button('btr-batch-go', 'start', {}, '번역 시작', el('small', { text: requestText(num(data.freshRequests)) }))));
}

/** 새로 번역, 바로 붙임, 프롬프트와 모델 */
function summaryRows(data) {
    const requests = num(data.freshRequests);
    const using = [data.prompt, data.model].filter(Boolean).join(', ');
    return [
        kv('새로 번역', `${num(data.fresh)}개 `, el('span', { class: requests > MANY ? 'is-many' : null, text: `(${requestText(requests)})` })),
        kv('전에 번역한 글이라 바로 붙임', `${num(data.reuse)}개 (요청 없음)`),
        kv('프롬프트와 모델', using),
    ];
}

const kv = (key, ...value) => el('div', { class: 'btr-batch-kv' }, el('b', { text: key }), el('span', {}, ...value));

function fromButton(state, from, label) {
    const on = state.from === from;
    return button(`btr-batch-from${on ? ' is-on' : ''}`, 'from', { 'data-from': from, 'aria-pressed': on }, label);
}
