// 조각 안에서 모델에게 보이지 않게 가릴 글을 자리표로 바꾸고, 답에서 되돌린다.
// 자리표 번호는 조각 안 차례(0부터)다. 메시지 전체 번호로 매기면 앞 문단이 바뀔 때 뒤 문단의 글이 전부 달라진다.

const VAR = /\[\[__VAR_(\d+)__\]\]/g;
// 모델이 망가뜨린 꼴: [__VAR_1__] · [[ __VAR_1__ ]] · [[_VAR_1_]] · [[__var_1__]] · [[/__VAR_1__]]
const VAR_VARIANT = /\[{1,2}[ \t]*\/?[ \t]*_{1,2}[ \t]*(?:VAR|VARIABLE|[Vv]ar|변수)[ \t]*_[ \t]*(\d+)[ \t]*_{1,2}[ \t]*\/?[ \t]*\]{1,2}/g;
const token = n => `[[__VAR_${n}__]]`;

/**
 * @param {{ src: string, kind?: string, holds?: {at: number, len: number}[] }} piece
 * @param {RegExp[]} [rules] 가릴 글의 규칙
 * @param {{ shared?: boolean }} [o] shared: 같은 글은 같은 번호로(원문과 기존 번역을 한 조각에 같이 보낼 때. 같은 블록이 두 번 나가도 답에는 한 번만 있으면 된다)
 * @returns {{ head: string, body: string, tail: string, vars: string[], tags: string[] }}
 *   head · tail 은 조각 앞뒤의 빈칸과 글 전체를 감싼 태그 짝(보내지 않고 그대로 붙인다)
 */
export function mask(piece, rules = [], { shared = false } = {}) {
    const src = piece.src, ranges = (piece.holds || []).map(h => ({ from: h.at, to: h.at + h.len }));
    for (const rule of rules) {
        const flags = rule.flags.includes('g') ? rule.flags : rule.flags + 'g';
        for (const m of src.matchAll(new RegExp(rule.source, flags))) if (m[0]) ranges.push({ from: m.index, to: m.index + m[0].length });
    }
    ranges.sort((a, b) => a.from - b.from || b.to - a.to);
    const vars = [];
    let out = '', at = 0;
    for (const r of ranges) {
        if (r.from < at) continue;
        const held = src.slice(r.from, r.to), same = shared ? vars.indexOf(held) : -1;
        out += src.slice(at, r.from) + token(same >= 0 ? same : vars.length);
        if (same < 0) vars.push(held);
        at = r.to;
    }
    out += src.slice(at);
    const [, lead, inside, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(out);
    // 구조 덩이(상태창 같은 블록)는 태그까지가 그 덩이의 꼴이라 벗기지 않는다. 이야기 문단만
    const wrap = piece.kind === 'cell' ? { head: '', body: inside, tail: '' } : peelWraps(inside);
    const short = shortenTags(wrap.body);
    return { head: lead + wrap.head, body: short.body, tail: wrap.tail + trail, vars, tags: short.tags };
}

const OPEN_TAG = /<([A-Za-z][\w:-]*)(\s[^<>]*?)(\/?)>/g;
const alias = (name, n, self) => `<${name} a${n}${self}>`;

/**
 * 문장 가운데 태그의 속성(색 · 클래스 · 주소 같은, 번역에 쓰이지 않는 글)을 짧은 표시로 바꾼다: <span style="color:#e06c75"> → <span a1>.
 * 태그 자리는 모델이 번역문 안에 옮겨 놓아야 하므로 태그는 남기고, 속성 글자만 보내지 않는다. 같은 속성은 같은 번호.
 * 줄여도 짧아지지 않는 태그는 그대로 둔다.
 * @returns {{ body: string, tags: string[] }} tags[n - 1] = a{n} 의 원래 속성 글(앞의 빈칸 포함)
 */
function shortenTags(text) {
    const tags = [];
    const body = text.replace(OPEN_TAG, (whole, name, attrs, self) => {
        if (!attrs.trim() || /^\s+a\d+\s*$/.test(attrs)) return whole;   // 속성이 없거나, 원문이 이미 이 표시와 같은 꼴이면 건드리지 않는다
        const n = tags.includes(attrs) ? tags.indexOf(attrs) + 1 : tags.length + 1;
        if (alias(name, n, self).length >= whole.length) return whole;
        if (n > tags.length) tags.push(attrs);
        return alias(name, n, self);
    });
    return { body, tags };
}

/**
 * 답의 짧은 표시를 원래 속성으로 되돌린다. 모델이 표시를 빠뜨려 맨 태그(<span>)로 돌려준 것은,
 * 보낸 글에 그 이름의 맨 태그가 없고 개수가 보낸 표시와 같을 때만 차례대로 채운다(못 채우면 맨 태그 그대로: 꾸밈만 빠진다).
 */
function restoreTags(answer, body, tags) {
    if (!tags?.length) return answer;
    const sent = [...body.matchAll(/<([A-Za-z][\w:-]*) a(\d+)(\/?)>/g)];
    let text = answer;
    for (const name of new Set(sent.map(tag => tag[1].toLowerCase()))) {
        const mine = sent.filter(tag => tag[1].toLowerCase() === name);
        const bare = new RegExp(`<${name}>`, 'gi');
        const marked = new RegExp(`<${name} a\\d+\\/?>`, 'gi');
        if (bare.test(body) || marked.test(text) || (text.match(bare) || []).length !== mine.length) continue;
        let at = 0;
        text = text.replace(bare, () => mine[at++][0]);
    }
    return text.replace(/<([A-Za-z][\w:-]*) a(\d+)(\/?)>/g, (whole, name, n, self) => (tags[Number(n) - 1] === undefined ? whole : `<${name}${tags[Number(n) - 1]}${self}>`));
}

/**
 * 글 전체를 감싼 태그 짝(여는 태그로 시작해 그 짝인 닫는 태그로 끝남)을 벗긴다. 여러 겹이면 겹마다.
 * 벗긴 태그는 보내지 않고 번역 앞뒤에 그대로 다시 붙인다: 모델이 볼 까닭이 없고(글 전체에 걸린 꾸밈), 안 보내면 모델이 망가뜨릴 일도 없다.
 * 문장 가운데에 낀 태그는 번역문의 어디에 둘지를 모델이 정해야 하므로 그대로 둔다.
 */
function peelWraps(text) {
    let head = '', tail = '', body = text;
    for (;;) {
        const open = /^<([A-Za-z][\w:-]*)(?:\s[^<>]*)?>/.exec(body);
        if (!open || /\/\s*>$/.test(open[0])) break;
        const close = new RegExp(`</${open[1]}\\s*>$`, 'i').exec(body);
        if (!close || close.index < open[0].length) break;
        const inner = body.slice(open[0].length, close.index);
        // 안쪽에서 같은 이름의 태그가 먼저 닫히면 처음 태그의 짝은 끝의 것이 아니다(<b>가</b> 나 <b>다</b>)
        let depth = 0;
        for (const tag of inner.matchAll(new RegExp(`<(/?)${open[1]}\\b[^<>]*>`, 'gi'))) { depth += tag[1] ? -1 : 1; if (depth < 0) break; }
        if (depth !== 0 || !inner.trim()) break;
        const before = /^\s*/.exec(inner)[0], after = /\s*$/.exec(inner)[0];
        head += open[0] + before;
        tail = after + close[0] + tail;
        body = inner.slice(before.length, inner.length - after.length);
    }
    return { head, body, tail };
}

/**
 * 답의 자리표를 원래 글로 되돌린다.
 * 빠진 자리표는 원문에서 조각 머리에 있었으면 앞에, 아니면 뒤에 되돌리고 patched 로 알린다(그림 · 블록이 사라지지 않게).
 * 원문에 없던 번호의 자리표는 지운다.
 * @returns {{ text: string, patched: boolean }}
 */
export function unmask(answer, masked) {
    const { body, vars } = masked;
    let text = restoreTags(String(answer ?? ''), body, masked.tags).replace(VAR_VARIANT, (m, n) => token(Number(n)));
    const seen = new Set();
    text = text.replace(VAR, (m, n) => {
        const i = Number(n);
        if (i >= vars.length) return '';
        seen.add(i);
        return m;
    });
    let patched = false;
    for (let i = vars.length - 1; i >= 0; i--) {
        if (seen.has(i)) continue;
        patched = true;
        const at = body.indexOf(token(i)), atHead = !body.slice(0, at).replace(VAR, '').trim();
        // 원문에서 자리표가 제 줄에 있었으면 되돌릴 때도 줄을 바꾼다(닫는 태그 · 그림 블록이 앞 문장 끝에 붙지 않게)
        const after = /^[ \t]*\n/.test(body.slice(at + token(i).length)) ? '\n' : ' ', before = /\n[ \t]*$/.test(body.slice(0, at)) ? '\n' : ' ';
        text = atHead ? `${token(i)}${/^\s/.test(text) ? '' : after}${text}` : `${text.replace(/\s+$/, '')}${before}${token(i)}`;
    }
    return { text: text.replace(VAR, (m, n) => vars[Number(n)]), patched };
}

/** 가린 뒤 보낼 글자가 남는가(자리표뿐이면 보낼 것이 없다) */
export const hasBody = masked => /\p{L}/u.test(masked.body.replace(VAR, ''));
