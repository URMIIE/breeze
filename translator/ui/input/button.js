// 입력창 옆 번역 버튼. 누르면 '내 글도 번역해서 보내기'를 켜고 끄고, 길게 누르면 입력창에 쓴 글을 그 자리에서 번역한다.
// 켜져 있으면 색이 들어오고, 번역하는 동안 깜빡인다(input.css).
// id 는 옛 번역 확장의 것 그대로다: 그 버튼에 맞춰 둔 테마의 모양이 그대로 먹게.

export const BUTTON_ID = 'llm_translate_input_button';
// 길게 누른 것으로 치는 시간(ms): iOS 의 길게 누르기 기본값
const HOLD_MS = 500;

/** 누르기와 길게 누르기를 가른다. 길게 누른 뒤 손을 뗄 때 오는 click 은 누르기로 치지 않는다 */
function bindPress(el, { onPress, onHold }) {
    let timer = null, held = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', () => {
        held = false;
        cancel();
        timer = setTimeout(() => { held = true; navigator.vibrate?.(20); onHold(); }, HOLD_MS);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(type, cancel);
    // 휴대폰에서 길게 누를 때 브라우저의 메뉴가 뜨지 않게
    el.addEventListener('contextmenu', event => event.preventDefault());
    el.addEventListener('click', () => { if (held) held = false; else onPress(); });
    el.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onPress();
    });
}

function create(on) {
    const el = document.createElement('div');
    el.id = BUTTON_ID;
    el.className = 'interactable';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.innerHTML = '<i class="fa-solid fa-font"></i>';
    bindPress(el, on);
    return el;
}

/**
 * @param {{ state: () => { on: boolean, language: string }, onPress: () => void, onHold: () => void }} o
 * @returns {{ show(visible: boolean): void, paint(): void, busy(on: boolean): void }}
 */
export function inputButton({ state, onPress, onHold }) {
    const find = () => document.getElementById(BUTTON_ID);

    function paint() {
        const el = find();
        if (!el) return;
        const { on, language } = state();
        const label = on ? `내 글을 번역해서 보내요 (${language}). 누르면 꺼요.` : '내 글을 쓴 그대로 보내요. 누르면 번역해서 보내요.';
        el.classList.toggle('is-on', on);
        el.setAttribute('aria-pressed', String(on));
        // 길게 누르는 것은 화면 읽기 프로그램에도 알린다(설정 화면에도 같은 안내가 있다)
        const full = `${label} 길게 누르면 입력창에 쓴 글을 바로 번역해요.`;
        el.setAttribute('aria-label', full);
        el.title = full;
    }

    function show(visible) {
        if (!visible) { find()?.remove(); return; }
        if (!find()) document.getElementById('rightSendForm')?.append(create({ onPress, onHold }));
        paint();
    }

    return { show, paint, busy: on => find()?.classList.toggle('is-busy', on) };
}
