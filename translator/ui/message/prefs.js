// 메시지 화면의 설정 가운데 옛 번역 확장의 설정 칸에 두는 것을 읽고 쓴다.
// 저장 꼴은 옛 번역기와 같다(같은 열쇠, 같은 값): 숨긴 메시지 버튼(hidden_buttons, 쓰는 곳은 buttons.js), 원문 칸의 글자 크기(llmt_orig_size).

import { SETTINGS_KEY } from '../../store/settings.js';

const context = () => globalThis.SillyTavern?.getContext?.();

/** 실리태번 extension_settings 전체(읽기만) */
export const allSettings = () => context()?.extensionSettings ?? {};
/** 번역 설정 칸(읽기만) */
export const saved = () => allSettings()[SETTINGS_KEY] ?? {};

/** 번역 설정 칸에 값 하나를 적고 저장한다 */
export function write(key, value) {
    const c = context();
    if (!c?.extensionSettings) return;
    (c.extensionSettings[SETTINGS_KEY] ??= {})[key] = value;
    c.saveSettingsDebounced();
}

// ── 원문 칸의 글자 크기 ──
// 고르는 값과 크기는 옛 번역기 그대로다: 작게 = 본문의 .88배(view.css 에 적힌 기본값), 본문과 같게 = 1배.
// 크기는 <html> 의 변수 하나로 넘긴다(채팅의 칸과 설정 화면의 미리 보기 칸이 같은 값을 쓴다). 기본값일 때는 변수를 두지 않는다.
const SIZE_VAR = '--btr-orig-size';
const ORIG_SIZES = [
    { value: 'small', name: '작게', size: '' },
    { value: 'normal', name: '본문과 같게', size: '1em' },
];

/** 고를 수 있는 값 @returns {{ value: 'small' | 'normal', name: string }[]} */
export const origSizeChoices = () => ORIG_SIZES.map(({ value, name }) => ({ value, name }));

/** 지금 값. 적힌 것이 없거나 모르는 값이면 'small' @returns {'small' | 'normal'} */
export const origSize = () => (ORIG_SIZES.find(each => each.value === saved().llmt_orig_size) ?? ORIG_SIZES[0]).value;

/** 저장된 크기를 화면에 건다(값이 그대로면 <html> 에 다시 쓰지 않는다) */
export function applyOrigSize() {
    const style = document.documentElement.style, size = ORIG_SIZES.find(each => each.value === origSize()).size;
    if (style.getPropertyValue(SIZE_VAR) === size) return;
    if (size) style.setProperty(SIZE_VAR, size); else style.removeProperty(SIZE_VAR);
}

/** 크기를 바꿔 저장하고 바로 건다. 모르는 값은 받지 않는다 @returns {boolean} 바꿨으면 true */
export function setOrigSize(value) {
    if (!ORIG_SIZES.some(each => each.value === value)) return false;
    write('llmt_orig_size', value);
    applyOrigSize();
    return true;
}
