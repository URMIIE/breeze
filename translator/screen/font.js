// 카드 글꼴에 한글 글꼴 끼우기(브라우저에서만 돈다).
// 정규식 카드가 고른 글꼴에 한글 글자가 없으면 한글만 브라우저 기본 글꼴로 떨어져 카드 분위기와 따로 논다.
// 카드가 정한 글꼴 줄은 그대로 두고, 그 줄의 기본 계열(serif 등) 바로 앞에 분위기가 맞는 한글 글꼴을 끼운다:
//   앞 글꼴에 있는 글자(영문, 숫자)는 앞 글꼴 그대로, 없는 한글만 끼운 글꼴로. 이미 한글 글꼴이 든 줄은 건드리지 않는다.
//   iframe 카드는 그 안 전부, 본문에 바로 그려진 카드(custom- 클래스)는 본문 칸과 다른 글꼴을 쓴 곳만.
// 자리(명조, 손글씨, 고딕, 코딩체)마다 고른 글꼴은 옛 설정 칸(koFonts)에서 읽기만 한다.

import { SETTINGS_KEY } from '../store/settings.js';

const KO_FONT = {
    serif: { stack: '"Diphylleia", "Gowun Batang", "Nanum Myeongjo", "AppleMyungjo"', css: 'https://fonts.googleapis.com/css2?family=Diphylleia&family=Gowun+Batang:wght@400;700&display=swap' },
    // 손글씨 자리의 기본은 손글씨 글꼴이다(명조를 두면 꾸밈 글씨 자리가 명조로 보였다). 받지 못하면 명조로 떨어진다
    script: { stack: '"Nanum Pen Script", "Gowun Batang", "AppleMyungjo"', css: 'https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&display=swap' },
    sans: { stack: '"Pretendard Variable", "Pretendard", "Apple SD Gothic Neo"', css: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css' },
    mono: { stack: '"Nanum Gothic Coding", "D2Coding", "Apple SD Gothic Neo"', css: 'https://fonts.googleapis.com/css2?family=Nanum+Gothic+Coding&display=swap' },
};
// 범용 CJK 글꼴 이름(중국어 명조 등)은 한글 글꼴로 치지 않는다: 컴퓨터에 없으면 한글이 기본 고딕으로 떨어진다
const KO_FAMILY = /pretendard|gowun|nanum|batang|myeongjo|myungjo|apple ?sd ?gothic|malgun|noto (serif|sans)( mono)? kr|spoqa|kopub|ridi|maru ?buri|ibm plex sans kr|\bkr\b|korean|hangul|d2coding|gulim|dotum|gungsuh/i;
const GENERIC_FAMILY = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong|inherit|initial|unset|-apple-system|blinkmacsystemfont)$/i;
const DEFAULT_FAMILY = /^(times|times new roman|-webkit-standard|-webkit-body)$/i;   // 카드가 글꼴을 정하지 않았을 때 iframe 의 기본값
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT', 'CODE']);
const FONT_FILE = /\.(woff2?|ttf|otf)(\?|#|$)/i;
const cssQuote = name => `"${String(name).replace(/["\\]/g, '')}"`;

/** 글꼴 이름들 → 어느 자리의 한글 글꼴이 어울리나 */
export function kindOf(names) {
    const generic = names.find(n => GENERIC_FAMILY.test(n))?.toLowerCase();
    if (generic) return /mono/.test(generic) ? 'mono' : /sans|system|rounded|apple|blink/.test(generic) ? 'sans' : /cursive|fantasy/.test(generic) ? 'script' : 'serif';
    const all = names.join(' ');
    if (/mono|code|courier|consol|menlo/i.test(all)) return 'mono';
    if (/vibes|script|hand|brush|callig/i.test(all)) return 'script';
    if (/mincho|ming|song|serif|batang|myeong|garamond|georgia|times|baskerville|didot|bodoni|playfair|lora|merriweather|caslon|cormorant/i.test(all)) return 'serif';
    return 'sans';
}

/** 그 자리에 쓸 글꼴: 사용자가 고른 것이 있으면 맨 앞에 */
function fontFor(kind, picks) {
    const base = KO_FONT[kind] || KO_FONT.serif, pick = picks?.[kind];
    if (!pick?.name) return { stack: base.stack, css: base.css, sig: base.css };
    return { stack: `${cssQuote(pick.name)}, ${base.stack}`, css: base.css, extra: pick.url || '', name: pick.name, sig: `${base.css}|${pick.name}|${pick.url || ''}` };
}

/**
 * 글꼴 줄(font-family 값)에 한글 글꼴을 끼운 값. 끼울 필요가 없으면 null.
 * @param {string} fontFamily  @param {object} [picks] 자리마다 고른 글꼴({ serif: { name, url } … })
 * @returns {{ value: string, kind: string } | null}
 */
export function withKorean(fontFamily, picks) {
    const parts = String(fontFamily || '').split(',').map(s => s.trim()).filter(Boolean);
    const names = parts.map(s => s.replace(/^["']|["']$/g, ''));
    if (!names.length || names.some(n => KO_FAMILY.test(n))) return null;
    const at = names.findIndex(n => GENERIC_FAMILY.test(n)), own = at < 0 ? names : names.slice(0, at);
    if (!own.length || own.every(n => DEFAULT_FAMILY.test(n))) return null;
    const kind = kindOf(names), stack = fontFor(kind, picks).stack;
    const next = at < 0 ? [...parts, stack] : [...parts.slice(0, at), stack, ...parts.slice(at)];
    return { value: next.join(', '), kind };
}

/** 끼운 글꼴의 파일을 그 문서에 불러온다(자리마다 한 번, 고른 글꼴이 바뀌면 다시) */
function loadFonts(doc, kinds, picks) {
    if (!doc.head) return;
    for (const kind of kinds) {
        const font = fontFor(kind, picks), id = `btr-ko-font-${kind}`, old = doc.getElementById(id);
        if (old?.dataset.sig === font.sig) continue;
        old?.remove(); doc.getElementById(`${id}-x`)?.remove();
        const link = Object.assign(doc.createElement('link'), { id, rel: 'stylesheet', href: font.css });
        link.dataset.sig = font.sig;
        doc.head.append(link);
        if (!font.extra) continue;
        // 고른 글꼴의 주소가 글꼴 파일이면 @font-face 로, 아니면 글꼴 CSS 로 불러온다
        const extra = FONT_FILE.test(font.extra)
            ? Object.assign(doc.createElement('style'), { textContent: `@font-face{font-family:${cssQuote(font.name)};src:url(${JSON.stringify(font.extra)});font-display:swap}` })
            : Object.assign(doc.createElement('link'), { rel: 'stylesheet', href: font.extra });
        extra.id = `${id}-x`;
        doc.head.append(extra);
    }
}

/**
 * @param {() => object} context 실리태번 getContext
 * @returns {{ scan: (ids?: number[]) => void }} scan: 그 메시지들(없으면 전부)의 카드에 한글 글꼴을 끼운다
 */
export function createFonts(context) {
    const picks = () => context().extensionSettings?.[SETTINGS_KEY]?.koFonts;
    const done = new WeakSet(), hooked = new WeakSet(), looks = new Map();
    let near = null;

    /** root 안에서 글이 든 요소의 글꼴을 읽어 끼울 것을 todo 에 모은다(base 와 같은 글꼴은 테마 글꼴이라 둔다) */
    function read(root, base, todo) {
        const doc = root?.ownerDocument, win = doc?.defaultView;
        if (!win) return;
        const els = new Set(), walker = doc.createTreeWalker(root, 4 /* 글 조각만 */);
        for (let n; (n = walker.nextNode());) {
            const p = n.parentElement;
            if (p && !done.has(p) && !SKIP_TAGS.has(p.tagName) && n.nodeValue.trim()) els.add(p);
        }
        for (const el of els) {
            done.add(el);
            const family = win.getComputedStyle(el).fontFamily;
            if (base != null && family === base) continue;
            const fit = withKorean(family, picks());
            if (fit) todo.push([el, fit]);
        }
    }
    // 글꼴을 다 읽은 뒤 한꺼번에 입힌다: 칸마다 읽고 바로 입히면 입힐 때마다 다음 읽기에서 화면 전체 스타일을 다시 계산한다
    function apply(todo, doc) {
        const kinds = new Set();
        for (const [el, fit] of todo) { el.style.setProperty('font-family', fit.value, 'important'); el.dataset.btrKo = fit.kind; kinds.add(fit.kind); }
        if (kinds.size) loadFonts(doc, kinds, picks());
    }

    /** iframe 카드: 다 불러온 문서 전부에 끼우고, 나중에 생기는 글도 따라 끼운다 */
    function dressFrame(frame) {
        let doc = null;
        try { doc = frame.contentDocument; } catch { return; /* 다른 출처 */ }
        if (!doc?.body || doc.readyState !== 'complete' || doc.btrFonts) return;
        doc.btrFonts = true;
        const run = () => { const todo = []; read(doc.body, null, todo); apply(todo, doc); };
        run();
        let timer = 0;
        new doc.defaultView.MutationObserver(() => { clearTimeout(timer); timer = setTimeout(run, 300); })
            .observe(doc.body, { subtree: true, childList: true, characterData: true });
    }
    // 화면 가까이 온 iframe 만 읽는다(긴 채팅을 열 때 안 보이는 카드까지 글꼴을 읽지 않게)
    function watchFrame(frame) {
        if (hooked.has(frame)) return;
        hooked.add(frame);
        frame.addEventListener('load', () => { if (frame.dataset.btrNear) dressFrame(frame); });
        near ??= new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                near.unobserve(entry.target);
                entry.target.dataset.btrNear = '1';
                dressFrame(entry.target);
            }
        }, { root: document.getElementById('chat'), rootMargin: '800px 0px' });
        near.observe(frame);
    }
    // 본문 칸의 글꼴은 테마가 정해 메시지마다 같다: 사용자 · 캐릭터 메시지별로 한 번만 읽는다
    function lookOf(text) {
        const key = text.closest('.mes')?.getAttribute('is_user') ?? '';
        if (!looks.has(key)) looks.set(key, getComputedStyle(text).fontFamily);
        return looks.get(key);
    }

    function scan(ids = null) {
        const texts = ids ? ids.map(id => document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`)).filter(Boolean) : [...document.querySelectorAll('#chat .mes_text')];
        const todo = [];
        for (const text of texts) {
            for (const card of text.querySelectorAll('[class*="custom-"]')) {
                if (card.parentElement?.closest('[class*="custom-"]')) continue;   // 맨 바깥 칸만(안쪽은 같이 읽힌다)
                read(card, lookOf(text), todo);
            }
        }
        apply(todo, document);
        for (const text of texts) text.querySelectorAll('iframe').forEach(watchFrame);
    }
    return { scan };
}
