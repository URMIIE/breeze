// 화면의 스크립트가 만들어 내는 글: 스크립트 안 문자열에서 번역할 글을 뽑고, 화면의 글 조각에 맞춘다. 스크립트 자체는 바꾸지 않는다.
// 값을 끼워 만드는 글(n + " 位" · `${n} 位`)은 "{0} 位" 같은 틀로 번역해 두고, 화면의 글이 그 틀에 맞으면 끼워 맞춘다.

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const CODE = /[<>{};=\\]|https?:|\|[^|]*\|/;
const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * 번역할 만한 글인가.
 * 한자 · 가나가 있으면 번역한다. 그 밖의 글자(영어 등)는 문장 꼴일 때만: 낱말이 둘 이상이고, 대문자로 시작하거나 문장부호로 끝난다.
 * 코드 이름(btn_ok · flex-start) · 한 낱말(active) · 꾸밈 값(solid red)은 뺀다.
 */
export function worth(text) {
    const t = squash(text);
    if (!t || CODE.test(t)) return false;
    if (CJK.test(t)) return true;
    const words = t.split(' ');
    if (words.length < 2 || !words.every(w => /^[\p{L}'’.,!?:…-]+$/u.test(w)) || /\p{Script=Hangul}/u.test(t)) return false;
    return /^\p{Lu}/u.test(t) || /[.!?…]$/.test(t);
}

/**
 * 화면에 보이는 글이 번역할 글인가. 이미 화면에 글로 그려진 것이라 코드 모양(; = | { })은 따지지 않는다:
 * 그 규칙은 스크립트 문자열에서 코드 조각을 거르는 것이고, 화면의 줄에 쓰면 「时间：10:30 | 地点：…」 같은 줄이 빠진다.
 * 한자 · 가나는 한 글자도 번역한다. 그 밖의 글자(영어 등)는 두 글자 이상이고 한글보다 많을 때(버튼 이름 같은 한 낱말도).
 * 띄어쓰기 없이 기호 · 숫자 · 낙타 표기가 든 것(weekend-plans · btn_ok · userName)은 코드 이름이라 뺀다.
 */
export function readable(text) {
    const t = squash(text);
    if (!t) return false;
    if (CJK.test(t)) return true;
    const letters = t.match(/\p{L}/gu);
    if (!letters) return false;
    const hangul = letters.filter(ch => /\p{Script=Hangul}/u.test(ch)).length, other = letters.length - hangul;
    if (other < 2 || other <= hangul) return false;
    return !(!/\s/.test(t) && /^[\w.\-:/#@%]+$/.test(t) && /[_\-./:#@%\d]|[a-z][A-Z]/.test(t));
}

// 길이 · 구멍 수로는 자르지 않는다. 스크립트 문자열 2만여 개로 잼: 한자가 든 글 중 300자를 넘는 것 0개,
//   80자를 넘는 틀 16개 가운데 15개는 코드 모양(< > ; = \\)이라 아래 규칙에 이미 걸린다. 코드인지는 길이가 아니라 모양으로 가린다
const NOT_SHOWN = /(?:console\.\w+|\bError)\([^)]*$/;

/**
 * 스크립트 글에서 번역 단위를 뽑는다.
 * @returns {string[]} 그대로인 글과 "{0} …" 틀이 섞여 있다
 */
export function stringsOf(code) {
    const out = new Set();
    const text = String(code ?? '');
    for (const m of text.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*?)\1/g)) {
        const raw = m[2], t = raw.trim();
        if (!t) continue;
        // 콘솔에 찍는 글 · 오류로 던지는 글은 화면에 그려지지 않는다(그 호출의 괄호 안에 있는 문자열)
        //   같은 줄의 바로 앞 300자만 본다: 한 줄로 뭉친 스크립트에서 문자열마다 줄 처음까지 거슬러 가면 한 파일에 265ms 가 걸렸다(11-24 잼, 300자로 끊어도 뽑히는 수는 같았다)
        const before = text.slice(Math.max(0, m.index - 300), m.index);
        if (NOT_SHOWN.test(before.slice(before.lastIndexOf('\n') + 1))) continue;
        if (t.includes('${')) {
            let k = 0;
            const tp = raw.replace(/\$\{[^}]*\}/g, () => `{${k++}}`).trim();
            if (!/[<>;=\\]|https?:/.test(tp) && worth(tp.replace(/\{\d\}/g, 'x'))) out.add(tp);
            continue;
        }
        // 앞이나 뒤가 빈칸인 짧은 조각은 값에 이어 붙이는 글이다(n + " 位")
        const lead = /^\s/.test(raw), trail = /\s$/.test(raw);
        if ((lead || trail) && CJK.test(t) && !CODE.test(t)) { let k = 0; out.add((lead ? `{${k++}} ` : '') + t + (trail ? ` {${k++}}` : '')); }
        for (const piece of (t.includes('<') ? t.split(/<[^>]*>/) : [t])) { const q = squash(piece); if (q && worth(q)) out.add(q); }
    }
    return [...out];
}

/**
 * 숨긴 자료 칸(JSON)의 값 가운데 번역할 글. 화면 스크립트가 이 값을 읽어 나중에 글로 그린다(눌러야 뜨는 화면 등).
 * 자료 자체는 바꾸지 않고, 그려진 뒤의 글 조각에 입히려고 미리 번역해 둔다. JSON 이 아니면 빈 목록.
 */
export function valuesOf(json) {
    const raw = String(json ?? '').trim(), out = new Set();
    if (!/^[\[{]/.test(raw)) return [];
    const walk = v => {
        if (typeof v === 'string') { const t = squash(v); if (t && readable(t)) out.add(t); }
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    try { walk(JSON.parse(raw)); } catch { return []; }
    return [...out];
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shapes = new Map();   // 틀 → 그 틀에 맞는지 보는 식
const shapeOf = key => {
    if (!shapes.has(key)) {
        const body = key.split(/(\{\d\})/).map(part => (/^\{\d\}$/.test(part) ? '(.+?)' : escape(part))).join('');
        shapes.set(key, new RegExp(`^${body}$`, 's'));
    }
    return shapes.get(key);
};

/**
 * 글 조각 하나의 번역. 기록에 그 글이 그대로 있으면 그것, 없으면 "{0}" 틀에 맞춰 본다(끼어든 값은 기록에 있으면 번역하고 없으면 그대로).
 * @param {string} text 화면의 글(앞뒤 빈칸 뺀 것)
 * @param {Map<string, string>} dict 글 → 번역 ("{0} 位" → "{0}명" 같은 틀 포함)
 * @returns {string | null}
 */
export function fill(text, dict) {
    const t = squash(text);
    if (dict.has(t)) return dict.get(t);
    for (const [key, value] of dict) {
        if (!key.includes('{')) continue;
        const m = shapeOf(key).exec(t);
        if (!m) continue;
        const holes = key.match(/\{\d\}/g), got = {};
        holes.forEach((ph, i) => { const g = m[i + 1].trim(); got[ph] = dict.get(g) ?? g; });
        const out = value.replace(/\{\d\}/g, ph => got[ph] ?? ph);
        if (out !== t) return out;
    }
    return null;
}
