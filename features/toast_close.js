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

// × 가 알림 바탕과 거의 같은 색이면(흰 바탕에 흰 ×, 검은 바탕에 검은 ×) 그 알림에서만 색을 바꿈.
// 알림 도구는 × 를 흰색으로 그리는데 테마가 알림 바탕만 밝게 바꾸면 × 가 묻힘. 잘 보이는 알림은 손대지 않음(테마가 정한 색 그대로).
// 바탕이 많이 비치는 알림은 뒤 화면 색을 알 수 없어 판단하지 않음.
function rgba(text) { const m = /rgba?\(([^)]+)\)/.exec(text || ''); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length >= 3 ? [p[0], p[1], p[2], p[3] ?? 1] : null; }
function light(c) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
function gap(a, b) { const x = light(a), y = light(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function readable(toast) {
    const x = toast?.querySelector?.('.toast-close-button');
    if (!x || !toast.isConnected) return;
    const bg = rgba(getComputedStyle(toast).backgroundColor), fg = rgba(getComputedStyle(x).color);
    if (!bg || !fg || bg[3] < 0.6 || gap(bg, fg) >= 2.2) return;
    const text = rgba(getComputedStyle(toast).color);
    const pick = text && gap(bg, text) >= 3 ? `rgb(${text[0]}, ${text[1]}, ${text[2]})` : light(bg) > 0.4 ? '#222' : '#fff';
    x.style.setProperty('color', pick, 'important');
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
            const el = orig.call(this, message, title, { ...(options || {}), closeButton: true });
            requestAnimationFrame(() => readable(el?.[0] || el));
            return el;
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
