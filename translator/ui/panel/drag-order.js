// 한 줄에 놓인 버튼들을 끌어서 차례를 바꾼다(손잡이를 따로 붙이지 않는다: 줄이 작아야 한다).
// 마우스는 누른 채 5px 넘게 움직이면 끌기, 손가락은 길게(350ms) 누른 뒤 끌기. 짧게 누르면 그 버튼의 원래 누름(켜고 끄기)이 그대로 된다.
// 끄는 동안은 그 줄 안에서만 자리를 바꿔 보여 주고, 놓으면 onDrop(새 차례의 data-key 들)을 부른다. 끈 뒤 따라오는 누름 하나는 버린다.
//
//   dragOrder(root, { item, key, onDrop }) → 끊기 함수
//     item: 끌 수 있는 버튼을 고르는 선택자, key: 버튼 → 차례에 쓸 이름, onDrop(keys)

const MOUSE_SLOP = 5, TOUCH_SLOP = 8, HOLD_MS = 350;

export function dragOrder(root, { item, key, onDrop }) {
    let press = null;   // { el, x, y, touch, timer, dragging }

    const stop = () => { clearTimeout(press?.timer); press?.el.classList.remove('btr-dragging'); press = null; };
    function begin() {
        press.dragging = true;
        press.el.classList.add('btr-dragging');
    }
    /** 손가락 · 마우스 아래의 다른 버튼 앞이나 뒤로 옮긴다(가로 가운데를 넘으면 뒤로) */
    function follow(event) {
        const under = root.getRootNode().elementFromPoint?.(event.clientX, event.clientY)?.closest?.(item);
        if (!under || under === press.el || under.parentElement !== press.el.parentElement) return;
        const box = under.getBoundingClientRect(), after = event.clientX > box.left + box.width / 2;
        under.parentElement.insertBefore(press.el, after ? under.nextSibling : under);
    }
    function onDown(event) {
        const el = event.target.closest?.(item);
        if (!el || !root.contains(el) || event.button > 0) return;
        const touch = event.pointerType === 'touch';
        press = { el, x: event.clientX, y: event.clientY, touch, dragging: false, timer: 0 };
        if (touch) press.timer = setTimeout(() => press && begin(), HOLD_MS);
    }
    function onMove(event) {
        if (!press) return;
        const far = Math.hypot(event.clientX - press.x, event.clientY - press.y);
        if (!press.dragging) {
            if (press.touch) { if (far > TOUCH_SLOP) stop(); return; }   // 길게 누르기 전에 움직이면 끌기가 아니다
            if (far <= MOUSE_SLOP) return;
            begin();
        }
        event.preventDefault();
        follow(event);
    }
    function onUp() {
        if (!press) return;
        const { el, dragging } = press;
        stop();
        if (!dragging) return;
        // 끈 뒤에 오는 누름(켜고 끄기)은 버린다
        root.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => root.removeEventListener('click', swallow, { capture: true }), 400);
        onDrop([...el.parentElement.querySelectorAll(item)].map(key));
    }
    const swallow = event => { event.stopPropagation(); event.preventDefault(); };
    // 길게 눌러 끄는 동안 휴대폰이 글자 고르기 · 메뉴를 띄우지 않게
    const noMenu = event => { if (press?.dragging || event.target.closest?.(item)) event.preventDefault(); };

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', stop);
    root.addEventListener('contextmenu', noMenu);
    return () => {
        stop();
        root.removeEventListener('pointerdown', onDown);
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerup', onUp);
        root.removeEventListener('pointercancel', stop);
        root.removeEventListener('contextmenu', noMenu);
    };
}
