// 우리 메시지 버튼을 같은 줄의 다른 메시지 버튼과 같은 꼴로 그린다.
// 왜: 테마가 메시지 버튼을 글꼴 아이콘 대신 자기 그림(::before 에 mask 로 입힌 선 그림)으로 그리면, 글꼴 아이콘으로 그린 우리 버튼만
//     크기, 굵기, 높이가 달라 보인다. 테마 이름으로 가리지 않고, 옆 버튼이 실제로 어떻게 그려졌는지 재서 맞춘다.
//   옆 버튼이 그림으로 그려졌으면 → 우리도 같은 칸 크기의 선 그림으로(자리 잡는 값도 옆 버튼 것을 그대로)
//   옆 버튼이 글꼴 아이콘이면   → 그대로 둔다(같은 글꼴, 같은 크기라 이미 같다)
// 테마가 우리 버튼의 종류 클래스(옛 번역기와 같은 이름)에 이미 제 그림을 입혀 두었으면 그 버튼은 테마 그림 그대로 두고,
// 테마가 그림을 입히지 않은 버튼(설정, 멈추기 상태 등: btr-plain 표시)만 우리 선 그림으로 그린다.
// 진행 표시의 멈춤 버튼도 같은 표시(html.btr-line-icons)를 보고 선 그림으로 바뀐다.

// 24칸 그림, 한 줄 선. 아이콘 이름은 버튼에 붙는 Font Awesome 클래스와 같다
const LINES = {
    'fa-language': 'M3 6h10M8 4v2M5.5 6c.8 3.5 3 6.3 6.5 8M11 6c-.8 3.6-3.2 6.6-7.5 8.6M13.5 20l3.75-9 3.75 9M14.8 17h4.9',
    'fa-stop': 'M8 6.5h8A1.5 1.5 0 0 1 17.5 8v8a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 16V8A1.5 1.5 0 0 1 8 6.5z',
    'fa-right-left': 'M4 8.5h15M15.5 5l3.5 3.5-3.5 3.5M20 15.5H5M8.5 12L5 15.5 8.5 19',
    'fa-pen-to-square': 'M11 5H6.5A2.5 2.5 0 0 0 4 7.5v10A2.5 2.5 0 0 0 6.5 20h10a2.5 2.5 0 0 0 2.5-2.5V13M17.2 3.8a2 2 0 0 1 2.9 2.9l-7.6 7.6L9 15l.7-3.5z',
    'fa-eraser': 'M9.5 20l-5-5a1.6 1.6 0 0 1 0-2.2l8.3-8.3a1.6 1.6 0 0 1 2.2 0l4.5 4.5a1.6 1.6 0 0 1 0 2.2L11 20zM7.5 10.5l6 6M11 20h9',
    'fa-sliders': 'M4 7h9M17 7h3M15 5v4M4 12h3M11 12h9M9 10v4M4 17h10M18 17h2M16 15v4',
};
const STROKE = 1.7;
const url = path => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='${STROKE}' stroke-linecap='round' stroke-linejoin='round'><path d='${path}'/></svg>`)}")`;

/** 아이콘마다 선 그림을 가리키는 규칙을 한 번만 넣는다(버튼의 아이콘 클래스가 바뀌면 그림도 따라 바뀐다) */
function addSheet() {
    if (document.getElementById('btr-line-style')) return;
    const style = Object.assign(document.createElement('style'), { id: 'btr-line-style' });
    style.textContent = Object.entries(LINES).map(([icon, path]) => `.${icon} { --btr-line: ${url(path)}; }`).join('\n');
    document.head.append(style);
}

const drawn = style => { const mask = style.webkitMaskImage || style.maskImage || 'none'; return mask !== 'none' && mask !== ''; };

/** 같은 메시지의 버튼 가운데 테마가 그림으로 그린 것 하나의 ::before 값. 없으면 null */
function pictureOf(mes) {
    for (const el of mes.querySelectorAll('.mes_buttons .mes_button:not(.btr-button), .extraMesButtons .mes_button:not(.btr-button)')) {
        const before = getComputedStyle(el, '::before');
        if (drawn(before) && parseFloat(before.width) > 4) return before;
    }
    return null;
}

// 테마가 제 그림을 입혀 둔 우리 버튼 종류(옛 번역기와 같은 종류 클래스에 테마가 그림을 걸어 둔 것). 그런 버튼은 테마 그림 그대로 둔다
const themed = new Set();
const OUR_KINDS = ['mes_llm_translate', 'mes_toggle_original', 'mes_edit_translation', 'mes_delete_translation', 'mes_llmt_settings'];

/** 테마가 그 종류의 버튼을 제 그림으로 그리나 */
export const themeDraws = kind => themed.has(kind);

/** 우리 클래스 없이 종류 클래스만 단 버튼을 잠깐 놓아 테마가 그림을 입히는지 잰다(우리 규칙이 걸린 버튼으로는 가릴 수 없다) */
function readThemed(mes) {
    themed.clear();
    const row = mes.querySelector('.extraMesButtons');
    if (!row) return;
    const probes = OUR_KINDS.map(kind => Object.assign(document.createElement('div'), { className: `mes_button ${kind} fa-solid` }));
    // 자리는 차지하지 않고 보이지 않게(아예 그리지 않으면 ::before 의 값을 읽을 수 없는 브라우저가 있다)
    for (const probe of probes) probe.style.cssText = 'position: absolute; visibility: hidden; pointer-events: none;';
    row.append(...probes);
    probes.forEach((probe, i) => { if (drawn(getComputedStyle(probe, '::before'))) themed.add(OUR_KINDS[i]); });
    for (const probe of probes) probe.remove();
}

/**
 * 옆 버튼을 재서 표시를 맞춘다. 메시지가 붙을 때와 테마를 고를 때 부른다(ui/message/buttons.js). 메시지가 하나도 없으면 아무것도 바꾸지 않는다.
 * 잰 값이 앞과 같으면 <html> 에 다시 쓰지 않는다(같은 값을 써도 스타일을 다시 셈하게 만든다).
 * @returns {boolean} 선 그림으로 그리게 됐으면 true
 */
export function matchNeighbors() {
    // 맨 끝 메시지에서 잰다(맨 앞은 버튼이 덜 붙는 안내 메시지일 수 있다)
    const all = document.querySelectorAll('#chat > .mes'), mes = all[all.length - 1];
    if (!mes) return document.documentElement.classList.contains('btr-line-icons');
    const picture = pictureOf(mes), root = document.documentElement;
    if (root.classList.contains('btr-line-icons') !== !!picture) root.classList.toggle('btr-line-icons', !!picture);
    if (!picture) { themed.clear(); return false; }
    readThemed(mes);
    addSheet();
    const set = (name, value) => { if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value); };
    set('--btr-icon-w', picture.width);
    set('--btr-icon-h', picture.height);
    set('--btr-icon-display', picture.display === 'none' ? 'inline-block' : picture.display);
    set('--btr-icon-valign', picture.verticalAlign);
    set('--btr-icon-margin', picture.margin || '0');
    return true;
}
