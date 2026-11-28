// 상태창 번역 화면 위쪽의 두 줄이 여는 화면: 한글 글꼴(자리마다 글꼴 고르기)과 원문으로 볼 정규식.
// 둘 다 옛 번역 확장이 쓰던 설정 칸(extension_settings.llmt 의 koFonts · keepScripts)에 같은 꼴로 적는다: 쓰던 값이 그대로 읽힌다.
//   koFonts      { serif | script | sans | mono: { name, url } }   고르지 않은 자리는 칸이 없다(기본 글꼴)
//   keepScripts  정규식의 열쇠(id, 없으면 이름, 없으면 찾을 글) 목록
// 한글 글꼴 파일은 하나에 1~3MB 라 화면 가까이 온 줄의 글꼴만 그때 불러온다.

import { scriptKey } from '../../rules/kept.js';

const OPTIONS_KEY = 'llmt';
const NOON = 'https://fastly.jsdelivr.net/gh/projectnoonnu/';
const GOOGLE = 'https://fonts.googleapis.com/css2?family=';
const SAMPLE = '오늘은 비가 온다. ABC 123';

export const FONT_KINDS = [
    { kind: 'serif', label: '명조 자리 (제목 · 문구 등)', short: '명조', icon: 'heading', fallback: 'serif' },
    { kind: 'script', label: '손글씨 자리 (장 번호 등 꾸밈 글씨)', short: '손글씨', icon: 'feather', fallback: 'cursive' },
    { kind: 'sans', label: '고딕 자리', short: '고딕', icon: 't', fallback: 'sans-serif' },
    { kind: 'mono', label: '코딩체 자리 (코드 · 터미널처럼 꾸민 칸)', short: '코딩체', icon: 'code', fallback: 'monospace' },
];
// 고르지 않은 자리에 쓰이는 글꼴(카드에 글꼴을 끼우는 screen/font.js 의 자리별 첫 글꼴과 같다)
const DEFAULT_NAME = { serif: 'Diphylleia', script: 'Nanum Pen Script', sans: 'Pretendard Variable', mono: 'Nanum Gothic Coding' };

const FONTS = [
    ['serif', 'Diphylleia', '', `${GOOGLE}Diphylleia&display=swap`],
    ['serif', 'Gowun Batang', '고운바탕', `${GOOGLE}Gowun+Batang:wght@400;700&display=swap`],
    ['serif', 'Song Myung', '송명', `${GOOGLE}Song+Myung&display=swap`],
    ['serif', 'Hahmlet', '함렛', `${GOOGLE}Hahmlet:wght@300;400;600&display=swap`],
    ['serif', 'Nanum Myeongjo', '나눔명조', `${GOOGLE}Nanum+Myeongjo:wght@400;700;800&display=swap`],
    ['serif', 'Noto Serif KR', '본명조', `${GOOGLE}Noto+Serif+KR:wght@400;600&display=swap`],
    ['serif', 'Chosunilbo_myungjo', '조선일보명조', `${NOON}noonfonts_one@1.0/Chosunilbo_myungjo.woff`],
    ['serif', 'MaruBuri', '마루부리', 'https://hangeul.pstatic.net/hangeul_static/css/maru-buri.css'],
    ['serif', 'RIDIBatang', '리디바탕', `${NOON}noonfonts_twelve@1.0/RIDIBatang.woff`],
    ['serif', 'BookkMyungjo', '부크크 명조', `${NOON}noonfonts_2302@1.0/BookkMyungjo-Lt.woff2`],
    ['serif', 'ChosunSm', '조선신명조', `${NOON}noonfonts_20-04@1.1/ChosunSm.woff`],
    ['serif', 'KBIZHanmaumMyungjo', 'KBIZ 한마음명조', `${NOON}noonfonts_one@1.0/KBIZHanmaumMyungjo.woff`],
    ['script', 'ChosunGs', '조선궁서체', `${NOON}noonfonts_20-04@1.0/ChosunGs.woff`],
    ['script', 'Nanum Brush Script', '나눔붓', `${GOOGLE}Nanum+Brush+Script&display=swap`],
    ['script', 'East Sea Dokdo', '동해독도', `${GOOGLE}East+Sea+Dokdo&display=swap`],
    ['script', 'Nanum Pen Script', '나눔손글씨 펜', `${GOOGLE}Nanum+Pen+Script&display=swap`],
    ['script', 'Hi Melody', '하이멜로디', `${GOOGLE}Hi+Melody&display=swap`],
    ['script', 'LeeSeoyun', '이서윤체', 'https://cdn.jsdelivr.net/npm/@noonnu/lee-seoyun@0.1.0/fonts/leeseoyun-normal.woff'],
    ['script', 'KyoboHand', '교보 손글씨', `${NOON}noonfonts_20-04@1.0/KyoboHand.woff`],
    ['script', 'OmyuPretty', '오뮤 다예쁨', `${NOON}noonfonts_2304-01@1.0/omyu_pretty.woff2`],
    ['script', 'KNPSKkomi', '국립공원 꼬미', `${NOON}noonfonts_2201-2@1.0/KNPSKkomi-Regular00.woff`],
    ['script', 'OwnglyphKonkon', '온글잎 콘콘', `${NOON}2412-1@1.0/Ownglyph_corncorn-Rg.woff2`],
    ['script', 'SimKyungha', '심경하체', `${NOON}noonfonts_2202-2@1.0/SimKyungha.woff`],
    ['script', 'Ownglyph_ParkDaHyun', '온글잎 박다현체', `${NOON}2411-3@1.0/Ownglyph_ParkDaHyun.woff2`],
    ['script', 'HakgyoansimBadasseugi', '학교안심 받아쓰기', `${NOON}2408-5@1.0/HakgyoansimBadasseugiTTF-L.woff2`],
    ['script', 'HakgyoansimGeurimilgi', '학교안심 그림일기', `${NOON}2408-5@1.0/HakgyoansimGeurimilgiTTF-R.woff2`],
    ['script', 'HakgyoansimNalgae', '학교안심 날개', `${NOON}2511-1@1.0/HakgyoansimNalgaeR.woff2`],
    ['script', 'GangwonEduSaeeum', '강원교육새음', `${NOON}noonfonts_2201-2@1.0/GangwonEduSaeeum_OTFMediumA.woff`],
    ['script', 'EarlyFontDiary', '', `${NOON}noonfonts_220508@1.0/EarlyFontDiary.woff2`],
    ['script', 'RixXladywatermelon', '', `${NOON}2408-4@1.0/RixXladywatermelonR.woff2`],
    ['script', 'iceHimchan', '', `${NOON}noonfonts_2307-2@1.0/iceHimchan-Rg.woff2`],
    ['sans', 'Pretendard Variable', 'Pretendard', 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css'],
    ['sans', 'SUIT Variable', 'SUIT', 'https://cdn.jsdelivr.net/gh/sun-typeface/SUIT@2/fonts/variable/woff2/SUIT-Variable.woff2'],
    ['sans', 'Noto Sans KR', '본고딕', `${GOOGLE}Noto+Sans+KR:wght@400;700&display=swap`],
    ['sans', 'Gowun Dodum', '고운돋움', `${GOOGLE}Gowun+Dodum&display=swap`],
    ['sans', 'IBM Plex Sans KR', '', `${GOOGLE}IBM+Plex+Sans+KR:wght@400;600&display=swap`],
    ['sans', 'NanumSquareNeo', '나눔스퀘어 네오', 'https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareNeo/NanumSquareNeoTTF-bRg.woff'],
    ['sans', 'Freesentation', '프리젠테이션', `${NOON}2404@1.0/Freesentation-4Regular.woff2`],
    ['sans', 'Paperlogy', '페이퍼로지', `${NOON}2408-3@1.0/Paperlogy-4Regular.woff2`],
    ['sans', 'IM_Hyemin', 'IM혜민', `${NOON}noonfonts_2106@1.1/IM_Hyemin-Regular.woff2`],
    ['sans', 'KkakdugiDrafting', '깍두기 도면', 'https://cdn.jsdelivr.net/gh/Project-Noonnu/2610102356@kkakdugidrafting-extralight/kkakdugidrafting-extralight/KkakdugiDrafting-Regular.woff2'],
    ['sans', 'MinSans', '민산스', `${NOON}noonfonts_2201-2@1.0/MinSans-Regular.woff`],
    ['sans', 'NanumSquareRound', '나눔스퀘어라운드', `${NOON}noonfonts_two@1.0/NanumSquareRound.woff`],
    ['sans', 'S-CoreDream', '에스코어드림', `${NOON}noonfonts_six@1.2/S-CoreDream-4Regular.woff`],
    ['sans', 'NexonLv2Gothic', '넥슨 Lv2 고딕', `${NOON}noonfonts_20-04@2.1/NEXON%20Lv2%20Gothic%20Light.woff`],
    ['sans', 'GangwonEdu', '강원교육모두', `${NOON}noonfonts_2201-2@1.0/GangwonEdu_OTFLightA.woff`],
    ['sans', 'ChosunGu', '조선굴림', `${NOON}noonfonts_20-04@1.0/ChosunGu.woff`],
    ['sans', 'ChosunSg', '', `${NOON}noonfonts_20-04@1.0/ChosunSg.woff`],
    ['sans', 'LeferiPoint', '레페리포인트', `${NOON}noonfonts_2201-2@1.0/LeferiPoint-WhiteObliqueA.woff`],
    ['mono', 'Nanum Gothic Coding', '나눔고딕코딩', `${GOOGLE}Nanum+Gothic+Coding&display=swap`],
    ['mono', 'DungGeunMo', '둥근모꼴', `${NOON}noonfonts_six@1.2/DungGeunMo.woff`],
].map(([group, name, label, url]) => ({ group, name, label, url }));

const FONT_FILE = /\.(woff2?|ttf|otf)(\?|#|$)/i;
const cssQuote = name => `"${String(name).replace(/["\\]/g, '')}"`;
// 한글 이름이 있으면 그것만(영문 이름까지 붙이면 좁은 줄에서 두 줄로 꺾였다)
const labelOf = font => font.label || font.name;

function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value === true ? '' : String(value));
    }
    node.append(...kids.flat().filter(kid => kid != null && kid !== false));
    return node;
}
const icon = (name, cls = '') => el('i', { class: `fa-solid fa-${name} ${cls}`.trim(), 'aria-hidden': 'true' });

/** 그 글꼴의 파일을 이 문서에 불러온다(글꼴 파일 주소면 @font-face, 아니면 글꼴 CSS). 한 번만 */
function loadFont({ name, url }) {
    const id = `btr-ko-pick-${name.replace(/[^\w-]/g, '_')}`;
    if (!name || !url || document.getElementById(id)) return;
    const node = FONT_FILE.test(url)
        ? Object.assign(document.createElement('style'), { textContent: `@font-face{font-family:${cssQuote(name)};src:url(${JSON.stringify(url)});font-display:swap}` })
        : Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url });
    node.id = id;
    document.head.append(node);
}

/**
 * 글꼴과 정규식 고르기가 읽고 쓰는 설정.
 * @param {() => object} context 실리태번 getContext
 */
export function optionTools(context) {
    const own = () => (context().extensionSettings[OPTIONS_KEY] ??= {});
    const save = () => context().saveSettingsDebounced();
    return {
        /** 그 자리에 지금 쓰이는 글꼴 { name, url, picked }. 고르지 않았으면 기본 글꼴 */
        fontOf(kind) {
            const pick = own().koFonts?.[kind];
            if (pick?.name) return { name: pick.name, url: pick.url || '', picked: true };
            return { ...FONTS.find(font => font.name === DEFAULT_NAME[kind]), picked: false };
        },
        /** 자리의 글꼴을 정한다. pick 이 없으면 기본으로 돌린다 */
        setFont(kind, pick) {
            const fonts = { ...(own().koFonts || {}) };
            if (pick?.name) fonts[kind] = { name: pick.name, url: pick.url || '' }; else delete fonts[kind];
            own().koFonts = fonts;
            save();
        },
        keptKeys: () => (Array.isArray(own().keepScripts) ? own().keepScripts.filter(key => typeof key === 'string' && key) : []),
        setKept(key, on) {
            const keys = new Set(this.keptKeys());
            if (on) keys.add(key); else keys.delete(key);
            own().keepScripts = [...keys];
            save();
        },
    };
}

/** 그 자리의 글꼴로 쓴 글자(줄의 값 자리에 놓는다). text 를 안 주면 '가나다' */
export function fontSample(tools, kind, text = '가나다') {
    const font = tools.fontOf(kind), slot = FONT_KINDS.find(item => item.kind === kind);
    loadFont(font);
    return el('span', { class: 'fsample', style: `font-family:${cssQuote(font.name)},${slot.fallback}`, text });
}

// 한글 글꼴 줄의 값: 네 자리를 그 자리 글꼴로 쓴 자리 이름(어느 자리가 어떤 모양인지 한눈에. '가나다'만 둘 늘어놓으면 무엇인지 알 수 없었다)
const ROW_NAMES = { serif: '명조', script: '손글씨', sans: '고딕', mono: '코딩' };
export function fontRowSamples(tools) {
    const out = [];
    for (const slot of FONT_KINDS) {
        if (out.length) out.push(' ');
        out.push(fontSample(tools, slot.kind, ROW_NAMES[slot.kind] ?? slot.short));
    }
    return out;
}

// ---------- 한글 글꼴 화면 ----------
// 위에서부터: 미리 볼 글 칸 → 지금 네 자리의 글꼴(자리마다 미리 볼 글을 그 글꼴로) → 글꼴 무리마다 접는 묶음(첫 묶음만 펼침).
// 묶음의 줄마다 글꼴 이름, 그 글꼴로 쓴 견본, 자리 버튼 넷. 자리 버튼을 누르면 그 글꼴이 그 자리에 들어가고, 한 번 더 누르면 기본으로.
// 따로 고르지 않아 기본으로 쓰이는 글꼴도 그 자리 버튼이 켜진 모양이다(꺼져 보이면 아무것도 안 쓰이는 줄 알았다).

// 손글씨 자리는 어디서나 '손글씨' 한 이름으로 부른다
const SLOT_BUTTON = { serif: '명조', script: '손글씨', sans: '고딕', mono: '코딩' };
const SLOT_NAME = { serif: '명조', script: '손글씨', sans: '고딕', mono: '코딩체' };
const GROUP_NAME = { serif: '명조', script: '손글씨', sans: '고딕', mono: '코딩체' };
// 이 화면이 하는 일(screen/font.js): 카드가 정한 글꼴 줄에 한글 글꼴이 없으면 한글만 브라우저 기본 글꼴로 떨어진다 → 그 줄에 한글 글꼴을 끼운다
const FONT_WHY = '상태창은 카드가 정한 글꼴로 그려져요. 그 글꼴이 한글 글꼴이 아니면 한글만 브라우저 기본 글꼴로 떨어져 상태창 모양과 따로 놀아요. 그래서 한글만 카드 글꼴과 어울리는 글꼴로 바꿔 보여 줘요.';
// 어느 자리의 글꼴이 쓰이나(screen/font.js kindOf): 카드 글꼴 이름이 명조 · 손글씨 · 코드용 쪽이면 그 자리, 그 밖은 고딕
const SLOT_RULE = '카드 글꼴이 명조 계열이면 명조, 손글씨 계열이면 손글씨, 코드용이면 코딩체, 그 밖은 고딕 자리의 글꼴이 쓰여요. 바꾸려면 아래 글꼴 줄에서 자리 버튼을 누르고, 한 번 더 누르면 기본으로 돌아가요.';

/**
 * @param {HTMLElement} box 그릴 자리  @param {ReturnType<typeof optionTools>} tools
 * @returns {() => void} 정리 함수
 */
export function mountFonts(box, tools) {
    const state = { open: new Set(['serif']), sample: '' };
    const root = el('div', { class: 'sfont' });
    // 줄이 화면 가까이 왔을 때에만 그 글꼴 파일을 불러온다(하나에 1~3MB)
    const near = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            near.unobserve(entry.target);
            const font = FONTS.find(item => item.name === entry.target.dataset.font);
            if (font) loadFont(font);
        }
    }, { rootMargin: '200px 0px' });
    const parts = { text: el('input', { class: 'input', type: 'text', 'data-role': 'sample-text', placeholder: '여기에 적으면 아래 견본이 이 글로 바뀌어요', 'aria-label': '미리 볼 글' }), top: el('div'), groups: el('div') };
    const ctx = { state, tools, root, near, parts };
    root.append(
        el('div', { class: 'note', text: FONT_WHY }),
        el('div', { class: 'lab', text: '미리 볼 글' }), parts.text, parts.top, parts.groups);
    const onClick = event => fontClick(ctx, event.target.closest('[data-act]'));
    let typed = 0;
    // 견본 글은 다음 그림 차례에 한 번만 바꾼다(빠르게 쳐도 한 그림에 한 번)
    const onInput = event => {
        if (event.target !== parts.text || typed) return;
        typed = requestAnimationFrame(() => { typed = 0; state.sample = parts.text.value; for (const node of root.querySelectorAll('.ksample, .fsample')) node.textContent = sampleText(ctx); });
    };
    const onChange = event => { if (event.target.closest('.kcustom')) paintCustom(ctx); };
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    box.replaceChildren(root);
    paintTop(ctx);
    parts.groups.replaceChildren(...Object.keys(GROUP_NAME).map(group => fontGroup(ctx, group)), customGroup(ctx));
    return () => { near.disconnect(); cancelAnimationFrame(typed); root.remove(); };
}

const familyOf = (tools, kind) => `${cssQuote(tools.fontOf(kind).name)},${FONT_KINDS.find(item => item.kind === kind).fallback}`;
const sampleText = ctx => ctx.state.sample.trim() || SAMPLE;
/** 그 자리에 지금 쓰이는 글꼴 이름(고르지 않았으면 기본 글꼴) */
const usedIn = (tools, kind) => tools.fontOf(kind).name;

/** 지금 네 자리의 글꼴: 자리 이름, 글꼴 이름, 그 글꼴로 쓴 미리 볼 글 */
function paintTop(ctx) {
    const { tools, parts } = ctx;
    for (const { kind } of FONT_KINDS) loadFont(tools.fontOf(kind));
    const now = el('div', { class: 'group know' }, FONT_KINDS.map(({ kind }) => {
        const font = tools.fontOf(kind), known = FONTS.find(item => item.name === font.name);
        // 누르면 아래 목록에서 그 자리의 글꼴 무리가 펴지고 거기로 간다
        return el('div', { class: 'line', 'data-kind': kind, 'data-act': 'jump', 'data-group': kind, role: 'button', tabindex: '0', 'aria-label': `${SLOT_NAME[kind]} 글꼴 고르기` },
            el('div', { class: 'k', text: SLOT_NAME[kind] }),
            el('span', { class: 'v', text: `${known ? labelOf(known) : font.name}${font.picked ? '' : ' · 기본'}` }),
            el('div', { class: 'fsample', style: `font-family:${familyOf(tools, kind)}`, text: sampleText(ctx) }));
    }));
    parts.top.replaceChildren(el('div', { class: 'lab', text: '지금 쓰이는 글꼴' }), el('div', { class: 'note', text: SLOT_RULE }), now);
}

const SLIDE_MS = 180;   // 무리가 펴지고 접히는 시간(status.css 의 .kfold 와 같은 값)
/** 펴지고 접힐 때 미끄러지듯 움직이는 상자(다른 줄의 펼침과 같은 움직임) */
const slideBox = inner => el('div', { class: 'kfold on' }, el('div', {}, inner));

/** 글꼴 무리 하나: 머리(이름, 개수) + 펼쳤으면 줄들 */
function fontGroup(ctx, group) {
    const fonts = FONTS.filter(font => font.group === group), open = ctx.state.open.has(group);
    const head = el('button', { type: 'button', class: `line${open ? ' up' : ''}`, 'data-act': 'fold', 'data-group': group, 'aria-expanded': String(open) },
        el('div', { class: 'k', text: GROUP_NAME[group] }), el('span', { class: 'v', text: `${fonts.length}개` }), icon(open ? 'chevron-up' : 'chevron-down', 'arr'));
    const body = open ? slideBox(el('div', { class: 'krows' }, fonts.map(font => fontRow(ctx, font)))) : null;
    return el('div', { class: 'group kgroup', 'data-group': group }, head, body);
}

/** 글꼴 줄: 이름, 견본, 자리 버튼 넷 */
function fontRow(ctx, font) {
    const fallback = FONT_KINDS.find(item => item.kind === font.group).fallback;
    const row = el('div', { class: 'krow', 'data-font': font.name },
        el('div', { class: 'khead' }, el('small', { text: labelOf(font) }), slotButtons(ctx, font.name)),
        el('div', { class: 'ksample', style: `font-family:${cssQuote(font.name)},${fallback}`, text: sampleText(ctx) }));
    ctx.near.observe(row);
    return row;
}

function slotButtons(ctx, name) {
    return el('span', { class: 'kslots' }, FONT_KINDS.map(({ kind }) => {
        const on = usedIn(ctx.tools, kind) === name;
        return el('button', { type: 'button', class: `set${on ? ' on' : ''}`, 'data-act': 'slot', 'data-slot': kind, 'aria-pressed': String(on), text: SLOT_BUTTON[kind] });
    }));
}

/** 직접 입력: 이름과 주소를 적고 자리 버튼으로 넣는다 */
function customGroup(ctx) {
    const open = ctx.state.open.has('custom');
    const head = el('button', { type: 'button', class: `line${open ? ' up' : ''}`, 'data-act': 'fold', 'data-group': 'custom', 'aria-expanded': String(open) },
        el('div', { class: 'k', text: '직접 입력' }), el('span', { class: 'v', text: '이름과 주소' }), icon(open ? 'chevron-up' : 'chevron-down', 'arr'));
    if (!open) return el('div', { class: 'group kgroup', 'data-group': 'custom' }, head);
    const mine = FONT_KINDS.map(({ kind }) => ctx.tools.fontOf(kind)).find(font => font.picked && !FONTS.some(item => item.name === font.name));
    const body = el('div', { class: 'kcustom' },
        el('input', { class: 'input', type: 'text', 'data-role': 'font-name', placeholder: '글꼴 이름 (font-family)', value: ctx.state.customName ?? mine?.name ?? '' }),
        el('input', { class: 'input', type: 'text', 'data-role': 'font-url', placeholder: '글꼴 CSS 주소 또는 woff · ttf 파일 주소', value: ctx.state.customUrl ?? mine?.url ?? '' }),
        el('div', { class: 'khead' }, el('small', { text: '넣을 자리' }), slotButtons(ctx, ctx.state.customName ?? mine?.name ?? '\u0000')));
    return el('div', { class: 'group kgroup', 'data-group': 'custom' }, head, slideBox(body));
}

/** 직접 입력 칸을 고쳤을 때: 적은 값만 기억한다(자리 버튼을 눌러야 들어간다) */
function paintCustom(ctx) {
    const box = ctx.root.querySelector('.kcustom');
    ctx.state.customName = box.querySelector('[data-role="font-name"]').value.trim();
    ctx.state.customUrl = box.querySelector('[data-role="font-url"]').value.trim();
    paintSlots(ctx);   // 버튼은 바꿔 끼우지 않는다: change 는 버튼을 누르는 순간에 와서, 바꿔 끼우면 그 누름이 사라졌다
}

/** 자리 버튼의 켜짐을 지금 값대로 맞춘다(줄을 다시 만들지 않는다) */
function paintSlots(ctx) {
    for (const button of ctx.root.querySelectorAll('.kslots [data-slot]')) {
        const row = button.closest('.krow'), name = row ? row.dataset.font : ctx.state.customName;
        const on = Boolean(name) && usedIn(ctx.tools, button.dataset.slot) === name;
        button.classList.toggle('on', on);
        button.setAttribute('aria-pressed', String(on));
    }
}

/** 글꼴 무리 하나를 펴거나 접는다 */
function toggleGroup(ctx, group) {
    const { state, parts } = ctx;
    const opening = !state.open.has(group);
    if (opening) state.open.add(group); else state.open.delete(group);
    const old = parts.groups.querySelector(`.kgroup[data-group="${group}"]`), build = () => (group === 'custom' ? customGroup(ctx) : fontGroup(ctx, group));
    if (opening) {
        // 접힌 모습으로 넣고 다음 그림에서 편다(바로 편 채 넣으면 움직임 없이 뚝 나타난다)
        const fresh = build(), box = fresh.querySelector('.kfold');
        box.classList.remove('on');
        old.replaceWith(fresh);
        requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('on')));
    } else {
        // 먼저 접히는 움직임을 보이고, 끝나면 접힌 줄로 바꾼다(그 사이 다시 폈으면 그대로 둔다)
        old.querySelector('.kfold')?.classList.remove('on');
        setTimeout(() => { if (old.isConnected && !state.open.has(group)) old.replaceWith(build()); }, SLIDE_MS);
    }
}

function fontClick(ctx, target) {
    if (!target) return;
    const { state, tools, parts } = ctx, { act } = target.dataset;
    if (act === 'fold') { toggleGroup(ctx, target.dataset.group); return; }
    if (act === 'jump') {
        const group = target.dataset.group;
        const wait = state.open.has(group) ? 0 : SLIDE_MS + 60;
        if (wait) toggleGroup(ctx, group);
        setTimeout(() => parts.groups.querySelector(`.kgroup[data-group="${group}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), wait);
        return;
    }
    if (act !== 'slot') return;
    const kind = target.dataset.slot, row = target.closest('.krow');
    if (row) {
        const font = FONTS.find(item => item.name === row.dataset.font);
        // 이미 이 자리에 쓰이는 글꼴이거나 그 자리의 기본 글꼴이면 기본으로
        tools.setFont(kind, usedIn(tools, kind) === font.name || font.name === DEFAULT_NAME[kind] ? null : font);
    } else {
        if (!state.customName) return;
        tools.setFont(kind, usedIn(tools, kind) === state.customName ? null : { name: state.customName, url: state.customUrl ?? '' });
    }
    paintTop(ctx);
    paintSlots(ctx);
}

// ---------- 원문으로 볼 정규식 화면 ----------

const AI_OUTPUT = 2;   // 실리태번 정규식의 placement 값: AI 답에 쓰는 정규식
const SOURCES = [['GLOBAL', '전역'], ['SCOPED', '캐릭터'], ['PRESET', '프리셋']];

/** 지금 실리태번에 걸려 있는 정규식 스크립트 가운데 AI 답의 화면을 그리는 것 → { key, name, from }[] */
async function screenScripts() {
    const engine = await import('/scripts/extensions/regex/engine.js').catch(() => null);
    if (!engine) return [];
    const out = [], seen = new Set();
    for (const [type, from] of SOURCES) {
        let scripts = [];
        try { scripts = engine.getScriptsByType(engine.SCRIPT_TYPES[type], { allowedOnly: false }) ?? []; } catch { /* 그 갈래를 못 읽으면 뺀다 */ }
        for (const script of scripts) {
            const key = scriptKey(script);
            if (!key || seen.has(key) || !Array.isArray(script.placement) || !script.placement.includes(AI_OUTPUT)) continue;
            seen.add(key);
            out.push({ key, name: script.scriptName || '이름 없는 정규식', from });
        }
    }
    return out;
}

/**
 * @param {HTMLElement} box 그릴 자리  @param {ReturnType<typeof optionTools>} tools  @param {() => void} [changed] 고른 것이 바뀌었을 때
 * @returns {() => void} 정리 함수
 */
export function mountKept(box, tools, changed) {
    const state = { scripts: null, query: '' };
    const search = el('input', { class: 'input', type: 'search', 'data-role': 'kept-search', placeholder: '정규식 이름으로 찾기', 'aria-label': '정규식 이름으로 찾기' });
    const list = el('div', { class: 'group skept-list' }), away = el('div', { class: 'note' });
    const root = el('div', { class: 'skept' },
        el('div', { class: 'note', text: '고른 정규식이 그린 부분은 번역된 답에서도 원문으로 보여요.' }),
        search, list, away);
    const paint = () => {
        const keys = new Set(tools.keptKeys()), query = state.query.toLowerCase();
        const shown = (state.scripts ?? []).filter(script => !query || script.name.toLowerCase().includes(query));
        list.replaceChildren(...shown.map(script => keptRow(script, keys.has(script.key))));
        if (!shown.length) list.replaceChildren(el('div', { class: 'sempty', text: state.scripts ? '찾는 정규식이 없어요' : '정규식을 읽는 중이에요' }));
        // 지금 목록에 없는 정규식(다른 캐릭터 · 다른 프리셋의 것)을 골라 둔 수: 지우지 않고 남겨 둔다
        const here = new Set((state.scripts ?? []).map(script => script.key)), gone = [...keys].filter(key => !here.has(key)).length;
        away.hidden = !gone || !state.scripts;
        away.textContent = `다른 캐릭터나 프리셋의 정규식 ${gone}개도 골라져 있어요.`;
    };
    root.addEventListener('click', event => {
        const row = event.target.closest('[data-act="kept"]');
        if (!row) return;
        tools.setKept(row.dataset.key, row.getAttribute('aria-checked') !== 'true');
        paint();
        changed?.();
    });
    search.addEventListener('input', () => { state.query = search.value.trim(); paint(); });
    box.replaceChildren(root);
    paint();
    screenScripts().then(scripts => { state.scripts = scripts; if (root.isConnected) paint(); });
    return () => root.remove();
}

function keptRow(script, on) {
    return el('button', { type: 'button', class: 'line', role: 'checkbox', 'aria-checked': String(on), 'data-act': 'kept', 'data-key': script.key },
        el('span', { class: `chk${on ? '' : ' off'}` }, on ? icon('check') : null),
        el('div', { class: 'k', text: script.name }), el('span', { class: 'v', text: script.from }));
}
