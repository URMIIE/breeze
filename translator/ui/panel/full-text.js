// 글 칸을 실리태번의 '편집기 크게' 창과 같은 창으로 열어 읽고 고친다. 적는 대로 onText(글)로 알리고, 닫으면 onClose() 를 부른다.
// 실리태번의 그 버튼은 문서에서 id 로 글 칸을 찾는데 번역 설정 판은 그 바깥(shadow root)에 그려져서, 같은 창을 여기서 직접 띄운다.

/**
 * @param {HTMLTextAreaElement} area 원래 글 칸
 * @param {(text: string) => void} onText
 * @param {() => void} [onClose]
 */
export async function openFull(area, onText, onClose) {
    const context = SillyTavern.getContext();
    const wrapper = document.createElement('div');
    wrapper.className = 'height100p wide100p flex-container flexFlowColumn justifyCenter alignitemscenter';
    const big = document.createElement('textarea');
    big.className = 'height100p wide100p maximized_textarea monospace';
    big.value = area.value;
    big.addEventListener('input', () => onText(big.value));
    wrapper.append(big);
    await context.callGenericPopup(wrapper, context.POPUP_TYPE.TEXT, '', { wide: true, large: true });
    onClose?.();
}
