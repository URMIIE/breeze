// 브라우저 탭 아이콘 · 홈 화면 아이콘을 사용자가 고른 그림으로.
// 고른 그림을 정사각형으로 잘라(가운데 기준) 크기별 PNG 와 탭 아이콘(ICO 안에 PNG 한 장)을 만들어 user/files 에 올리면,
// 서버 플러그인이 /favicon.ico · /img/apple-icon-*.png 요청에 이 파일을 먼저 내줌. 지금 열린 탭은 아이콘 줄만 바로 바꿈.
import { saveUserFile } from './files.js';

const PREFIX = 'breeze-tab-';
const HOME_SIZES = [57, 72, 114, 144, 192, 512];

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('그림을 열 수 없음'));
        img.src = URL.createObjectURL(file);
    });
}

function square(img, n) {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, n, n);
    return c;
}

const toBlob = (canvas) => new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

// ICO: 머리(6) + 항목(16) + PNG 한 장
async function icoFrom(canvas) {
    const png = new Uint8Array(await (await toBlob(canvas)).arrayBuffer());
    const out = new Uint8Array(22 + png.length), v = new DataView(out.buffer);
    v.setUint16(2, 1, true); v.setUint16(4, 1, true);
    out[6] = canvas.width >= 256 ? 0 : canvas.width; out[7] = canvas.height >= 256 ? 0 : canvas.height;
    v.setUint16(10, 1, true); v.setUint16(12, 32, true);
    v.setUint32(14, png.length, true); v.setUint32(18, 22, true);
    out.set(png, 22);
    return new Blob([out], { type: 'image/x-icon' });
}

function showNow(url) {
    let link = document.querySelector('link[rel~="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.append(link); }
    link.href = url;
}

/** 고른 그림으로 아이콘 파일들을 만들어 올림 */
export async function setTabIcon(file) {
    const img = await loadImage(file);
    try {
        await saveUserFile(`${PREFIX}favicon.ico`, await icoFrom(square(img, 64)));
        for (const n of HOME_SIZES) await saveUserFile(`${PREFIX}apple-icon-${n}x${n}.png`, await toBlob(square(img, n)));
        showNow(`/favicon.ico?v=${Date.now()}`);
    } finally { URL.revokeObjectURL(img.src); }
}

/** 원래 아이콘으로: 올린 파일들을 지움 */
export async function resetTabIcon() {
    const headers = SillyTavern.getContext().getRequestHeaders();
    for (const name of ['favicon.ico', ...HOME_SIZES.map(n => `apple-icon-${n}x${n}.png`)]) {
        await fetch('/api/files/delete', { method: 'POST', headers, body: JSON.stringify({ path: `user/files/${PREFIX}${name}` }) }).catch(() => {});
    }
    showNow(`/favicon.ico?v=${Date.now()}`);
}

/** 사용자가 고른 아이콘이 있는지 */
export async function hasTabIcon() {
    try { return (await fetch(`/user/files/${PREFIX}favicon.ico`, { method: 'HEAD', cache: 'no-store' })).ok; } catch { return false; }
}
