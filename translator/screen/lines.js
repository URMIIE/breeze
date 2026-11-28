// 그려진 화면(또는 정규식 틀을 읽은 것)에서 번역 단위인 "줄"을 뽑고, 번역을 줄의 글 조각에 되담는다.
// 화면 요소를 직접 만들거나 찾지 않는다: 넘겨받은 나무의 nodeType · tagName · childNodes · nodeValue 만 읽고, 글 조각의 nodeValue 만 쓴다.
//
// 줄 = 글을 품은 블록 요소 안에서 <br> 과 블록 자식으로 끊긴 한 토막. 줄 안의 글 조각(text node)이 하나면 통째로,
// 여럿이면 조각마다 번호표를 붙여 번역받아 조각별로 되담는다. 번호표가 안 맞으면 그 줄은 손대지 않는다(한 칸에 몰아 담지 않는다).

const ELEMENT = 1, TEXT = 3;
// 블록으로 보는 태그. 틀에는 배치(CSS)가 없으므로 태그로만 가린다. 버튼 · 이름표(label)는 글줄 안에 놓이는 것이라 블록이 아니다
const BLOCK = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'CAPTION', 'DD', 'DETAILS', 'DIALOG', 'DIV', 'DL', 'DT',
    'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LEGEND',
    'LI', 'MAIN', 'NAV', 'OL', 'OPTION', 'P', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);
// 글이 아닌 것: 안으로 들어가지 않는다
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'SVG', 'IFRAME', 'SELECT']);

const squash = text => String(text ?? '').replace(/\s+/g, ' ').trim();
/** 견주는 열쇠: 글자 · 숫자만. 빈칸 · 문장부호 · 따옴표 꼴이 달라도 같은 글로 본다 */
export const keyOf = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * @param {object} root 요소(또는 문서 몸통)
 * @param {{ skip?: (el: object) => boolean }} [options] skip: 이 요소 안은 보지 않는다(편집 칸 · 숨긴 자료 칸 등, 부르는 쪽의 표)
 * @returns {{ nodes: object[], text: string, key: string, kind: 'one' | 'many' | 'chars' }[]}
 *   kind chars: 한 글자짜리 조각이 잇달아 있는 줄(글자마다 따로 꾸민 문장, 또는 요일 줄 같은 한 글자 이름표)
 */
export function scan(root, { skip = () => false } = {}) {
    const lines = [];
    let nodes = [];
    const flush = () => {
        if (nodes.length) {
            const text = squash(nodes.map(n => n.nodeValue).join(''));
            // 한 글자짜리 조각이 둘 이상 잇달아 있으면 글자마다 따로 그린 줄이다(앞뒤에 보통 조각이 섞여 있어도)
            const one = nodes.map(n => Array.from(n.nodeValue.trim()).length === 1), single = one.some((v, i) => v && one[i + 1]);
            lines.push({ nodes, text, key: keyOf(text), kind: nodes.length === 1 ? 'one' : single ? 'chars' : 'many' });
        }
        nodes = [];
    };
    const walk = node => {
        for (const child of node.childNodes || []) {
            if (child.nodeType === TEXT) { if (child.nodeValue.trim()) nodes.push(child); continue; }
            if (child.nodeType !== ELEMENT) continue;
            const tag = String(child.tagName || '').toUpperCase();
            if (SKIP.has(tag) || skip(child)) continue;
            if (tag === 'BR') { flush(); continue; }
            if (BLOCK.has(tag)) { flush(); walk(child); flush(); } else walk(child);
        }
    };
    walk(root);
    flush();
    return lines;
}

/**
 * 한 글자짜리 조각이 잇달아 있는 줄인가. 이런 줄은 번역하지 않고 그대로 둔다(사용자 결정 2026-11-24).
 * 글자마다 상자를 따로 둬 꾸민 제목인지, 요일 줄 같은 한 글자 이름표 줄인지는 구조로 가릴 수 없다:
 * 제목을 글자마다 번역하면 엉뚱한 글이 되므로, 이름표 줄이 원문으로 남는 쪽을 택한다. 조각 수로 가르던 옛 기준(8개 이상이면 문장)은 7글자 제목을 깨뜨렸다
 */
export const isLetterRun = line => line.kind === 'chars';

// 조각 번호표: 본문에 나올 일이 없는 괄호
const MARK = /⟪(\d+)⟫/g;

/** 번역 요청에 넣을 글. 조각이 여럿이면 조각마다 번호표를 앞에 붙인다 */
export function ask(line) {
    if (line.nodes.length === 1) return line.text;
    return line.nodes.map((n, i) => `⟪${i + 1}⟫${squash(n.nodeValue)}`).join('');
}

/**
 * 답을 기록 꼴로. 조각이 하나면 글 그대로, 여럿이면 번호표마다의 글 배열.
 * 번호표가 1부터 조각 수까지 꼭 한 번씩 있어야 한다(차례는 바뀌어도 된다: 말의 차례가 달라지니까). 아니면 null.
 * @returns {string | string[] | null}
 */
export function answer(line, reply) {
    const text = String(reply ?? '').trim();
    if (!text) return null;
    if (line.nodes.length === 1) return /⟪\d+⟫/.test(text) ? null : text;
    const parts = new Array(line.nodes.length).fill(null);
    const marks = [...text.matchAll(MARK)];
    if (marks.length !== parts.length || text.slice(0, marks[0].index).trim()) return null;
    for (let i = 0; i < marks.length; i++) {
        const at = Number(marks[i][1]) - 1;
        if (at < 0 || at >= parts.length || parts[at] !== null) return null;
        parts[at] = text.slice(marks[i].index + marks[i][0].length, i + 1 < marks.length ? marks[i + 1].index : text.length);
    }
    return parts.every(p => p !== null && p.trim()) ? parts.map(p => p.trim()) : null;
}

/** 조각의 앞뒤 빈칸은 두고 가운데 글만 바꾼다 */
const swap = (node, value) => { const v = node.nodeValue; node.nodeValue = v.match(/^\s*/)[0] + value + v.match(/\s*$/)[0]; };

/**
 * 기록을 줄에 담는다. 기록의 꼴이 줄과 안 맞으면(조각 수가 다름) 아무것도 바꾸지 않는다.
 * @returns {boolean} 담았는가
 */
export function put(line, record) {
    if (typeof record === 'string') {
        if (line.nodes.length !== 1) return false;
        swap(line.nodes[0], record);
        return true;
    }
    if (!Array.isArray(record) || record.length !== line.nodes.length) return false;
    line.nodes.forEach((n, i) => swap(n, record[i]));
    return true;
}

// ── 정규식 틀의 줄: 값이 들어가는 자리(구멍) ──
const HOLE = /(\$\d{1,2}|\$<[^>]+>|\{\{[\s\S]*?\}\})/;

/**
 * 틀의 줄 글을 고정 부분과 구멍으로 가른다. 구멍이 없으면 null(보통 줄이다).
 * @returns {{ fixed: string[], pattern: RegExp } | null}
 *   fixed: 번역할 고정 부분(글자가 든 것만). pattern: 화면 줄의 열쇠가 이 틀에서 나온 것인지 보는 식(구멍은 아무 글)
 */
export function holes(text) {
    const parts = String(text ?? '').split(HOLE);
    if (parts.length < 2) return null;
    const fixed = parts.filter((_, i) => i % 2 === 0);
    const keys = fixed.map(keyOf);
    if (!keys.some(Boolean)) return null;
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 번역할 고정 부분은 글자가 든 것만(「/ 300」 같은 숫자 · 기호뿐인 부분은 번역할 것이 없다)
    return { fixed: fixed.map(squash).filter(p => /\p{L}/u.test(p)), pattern: new RegExp(`^${keys.map(escape).join('[\\s\\S]*?')}$`, 'u') };
}

/**
 * 구멍이 든 틀에서 나온 화면 줄에 고정 부분의 번역만 담는다. 고정 부분이 글 조각 하나의 전부이거나 앞머리 · 꼬리일 때만 바꾼다.
 * @param {{ nodes: object[] }} line
 * @param {Map<string, string>} dict 고정 부분의 열쇠 → 번역
 * @param {string[]} fixed
 * @returns {number} 바꾼 조각 수
 */
export function putFixed(line, dict, fixed) {
    let done = 0;
    for (const part of fixed) {
        const tr = dict.get(keyOf(part));
        if (!tr) continue;
        for (const node of line.nodes) {
            const value = node.nodeValue, at = value.indexOf(part);
            if (at < 0 || value.indexOf(part, at + 1) >= 0) continue;
            const before = value.slice(0, at), after = value.slice(at + part.length);
            if (before.trim() && after.trim()) continue;   // 글 한가운데에 낀 것은 값의 일부일 수 있다
            node.nodeValue = before + tr + after;
            done++;
            break;
        }
    }
    return done;
}
