// 손잡이를 끄는 동안: 포인터를 손잡이가 붙잡고(setPointerCapture), 움직임은 한 프레임에 한 번만 onFrame 으로, 놓으면 onEnd.
export function dragWith(e, onFrame, onEnd) {
    const target = e.currentTarget, sx = e.clientX, sy = e.clientY;
    let dx = 0, dy = 0, raf = 0;
    target.setPointerCapture(e.pointerId);
    const move = (ev) => {
        dx = ev.clientX - sx; dy = ev.clientY - sy;
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; onFrame(dx, dy); });
    };
    const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        cancelAnimationFrame(raf);
        onEnd(dx, dy);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
}

export const MARGIN = 8;
/** 화면 안에 들어오게 자리 · 크기를 맞춤 */
export function fit(left, top, w, h, min = { w: 0, h: 0 }) {
    w = Math.min(Math.max(min.w, w), innerWidth - MARGIN * 2);
    h = Math.min(Math.max(min.h, h), innerHeight - MARGIN * 2);
    left = Math.min(Math.max(MARGIN, left), innerWidth - w - MARGIN);
    top = Math.min(Math.max(MARGIN, top), innerHeight - h - MARGIN);
    return { left, top, w, h };
}
