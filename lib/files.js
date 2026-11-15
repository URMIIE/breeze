// 사용자 파일(user/files) 올리기 — 그림 · 소리 · CSS 를 설정 안에 통째로 넣지 않고 파일로 둔다(설정 파일이 커지지 않게).
function toBase64(bytes) {
    // 큰 파일도 있어 한꺼번에 펼치지 않고 나눠서
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

/** @param {string} name 파일 이름 @param {string|Blob} content 글 또는 파일 @returns {Promise<string>} 불러올 주소 */
export async function saveUserFile(name, content) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(await content.arrayBuffer());
    const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: SillyTavern.getContext().getRequestHeaders(),
        body: JSON.stringify({ name, data: toBase64(bytes) }),
    });
    if (!res.ok) throw new Error(`저장 실패 (${res.status})`);
    return `/user/files/${name}`;
}

/** 파일 고르기 창을 띄워 고른 파일을 돌려줌(취소하면 null) */
export function pickFile(accept) {
    return new Promise(resolve => {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept });
        input.addEventListener('change', () => resolve(input.files?.[0] || null));
        input.addEventListener('cancel', () => resolve(null));
        input.click();
    });
}

/** 여러 파일 고르기(취소하면 빈 목록) */
export function pickFiles(accept) {
    return new Promise(resolve => {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple: true });
        input.addEventListener('change', () => resolve([...(input.files || [])]));
        input.addEventListener('cancel', () => resolve([]));
        input.click();
    });
}

export const extOf = (file) => (file.name.match(/\.([a-z0-9]{1,5})$/i)?.[1] || 'bin').toLowerCase();

// 내보내기 · 불러오기용: 설정 안의 사용자 파일 주소(/user/files/…)를 파일 내용째 넣고(다른 컴퓨터에서도 그대로 쓰게), 불러올 때 다시 올림
const isUserFile = (v) => typeof v === 'string' && /^\/user\/files\/[^/?#]+$/.test(v);
async function toDataUrl(url) {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(null); fr.readAsDataURL(blob); });
}
/** 값 속 사용자 파일 주소를 { __file: 이름, data: dataURL } 로 바꾼 사본 */
export async function embedFiles(value) {
    const seen = new Map();
    const walk = async (v) => {
        if (isUserFile(v)) {
            if (!seen.has(v)) seen.set(v, await toDataUrl(v));
            const data = seen.get(v);
            return data ? { __file: v.split('/').pop(), data } : v;
        }
        if (Array.isArray(v)) return Promise.all(v.map(walk));
        if (v && typeof v === 'object') { const out = {}; for (const [k, x] of Object.entries(v)) out[k] = await walk(x); return out; }
        return v;
    };
    return walk(value);
}
/** embedFiles 로 넣은 파일을 다시 올리고 주소로 바꾼 사본 */
export async function restoreFiles(value, { fresh = false } = {}) {
    const done = new Map();
    const walk = async (v) => {
        if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.__file === 'string' && typeof v.data === 'string') {
            const name = v.__file.replace(/[^a-zA-Z0-9_.\-]/g, '_').replace(/^\.+/, '_');   // 실리태번은 영문 · 숫자 · _ - . 이름만 받음(다른 글자가 있으면 올리기가 통째로 실패)
            // fresh: 새 이름으로 올림 — 지금 쓰는 같은 이름 파일(다른 세트의 그림)을 덮지 않게
            const as = fresh ? name.replace(/(\.[a-zA-Z0-9]+)?$/, `-${Date.now().toString(36)}$1`) : name;
            if (!done.has(name)) done.set(name, saveUserFile(as, await (await fetch(v.data)).blob()));
            return await done.get(name);
        }
        if (Array.isArray(v)) return Promise.all(v.map(walk));
        if (v && typeof v === 'object') { const out = {}; for (const [k, x] of Object.entries(v)) out[k] = await walk(x); return out; }
        return v;
    };
    return walk(value);
}
/** 글을 파일로 내려받게 함 */
export function downloadText(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
