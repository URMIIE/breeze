// 알림에 닫기(×) 버튼.
// 실리태번은 알림(toastr)을 닫기 버튼 없이 띄워서, 오래 떠 있는 알림을 닫으려면 어디를 눌러야 하는지 알기 어려웠음.
// 알림을 띄우는 함수(info · success · warning · error)를 한 줄 거쳐 가게 해, 그 알림의 옵션에 닫기 버튼을 켬(실리태번 · 다른 확장 알림 모두).
// 고르는 것(옵션 mode): 'sticky' 저절로 안 사라지거나(timeOut 0) 눌러도 안 닫히는(tapToDismiss false) 알림에만 · 'all' 모든 알림. 안 달려면 기능을 끔.
// 알림을 직접 닫기 버튼 없이 띄우라고 한 경우(closeButton: false)는 그대로 둠. × 는 어느 알림이든 오른쪽 위 모서리 한 자리(style.css). 끄면 원래 함수로.
const KINDS = ['info', 'success', 'warning', 'error'];
let api = null, originals = {}, mine = {};

const mode = () => (!api ? 'none' : api.options().mode === 'sticky' ? 'sticky' : 'all');
function sticky(options) {
    const base = window.toastr?.options || {};
    const pick = (k) => (options && options[k] !== undefined ? options[k] : base[k]);
    return Number(pick('timeOut')) === 0 || pick('tapToDismiss') === false;
}

export function start(a) {
    api = a;
    document.documentElement.classList.add('etk-toast-close');   // × 자리 맞추기(style.css)
    const toastr = window.toastr;
    if (!toastr) return;
    for (const kind of KINDS) {
        if (typeof toastr[kind] !== 'function') continue;
        const orig = originals[kind] = toastr[kind];
        toastr[kind] = mine[kind] = function (message, title, options) {
            const m = mode();
            if (m === 'none' || options?.closeButton === false || (m === 'sticky' && !sticky(options))) return orig.apply(this, arguments);
            return orig.call(this, message, title, { ...(options || {}), closeButton: true });
        };
    }
}

export function stop() {
    const toastr = window.toastr;
    // 우리 뒤에 다른 확장이 또 감쌌으면 그쪽 것을 지우지 않게 그대로 둠(그땐 모드를 'none' 처럼 지나가게)
    for (const kind of KINDS) if (toastr && toastr[kind] === mine[kind]) toastr[kind] = originals[kind];
    originals = {}; mine = {};
    document.documentElement.classList.remove('etk-toast-close');
    api = null;
}

export function options(box, a) {
    const o = a.options();
    if (o.mode !== 'sticky') o.mode = 'all';
    box.innerHTML = `<div class="etk-form"><label>× 버튼을 달 알림</label><select class="text_pole" data-k="mode">
        <option value="sticky">계속 떠 있는 알림에만</option>
        <option value="all">모든 알림</option></select></div>`;
    const sel = box.querySelector('[data-k="mode"]');
    sel.value = o.mode;
    sel.addEventListener('change', () => { o.mode = sel.value; a.save(); });
}
