// 테마 맞추기(시험판): 테마가 내 화면과 안 맞는 곳을 화면을 보면서 바로 고친다. 테마 파일은 건드리지 않고 breeze 설정에만 저장.
// 지팡이 메뉴 '테마 맞추기' → 화면 위 작은 막대와 레이아웃 창(결과만 고르는 조절)이 뜨고, 그걸로 안 되는 곳은 창 맨 아래 '화면에서 고르기'로 누른 자리 옆에 맞는 조절을 띄운다.
// 설정 창에서 값을 바꾸고 창을 닫고 그 자리에 가서 확인하던 길(시험판 첫 판)이 번거로웠음 → 조절은 모두 화면 위에서, 바꾸는 즉시 반영.
// 조절하는 것:
// - 화면 값(기기마다 따로, 기본은 모든 테마 · 이 테마만도 가능): 설정 패널 · 양옆 패널 최소 폭, 채팅 폭, 글자 크기.
//   실리태번은 위쪽 설정 패널 폭을 채팅 폭에 맞추고 양옆 패널은 남은 폭을 나눠 써서, 채팅 폭이 좁거나 넓은 테마는 패널 안이 넘치거나 잘렸음
// - 테마별: 테마 글꼴 끄기, 테마의 '모든 요소 여백 0' 규칙 끄기, 메시지 아바타 최대 폭, 고른 칸 숨기기 · 누름 통과.
import { onThemeCss, appliedTheme } from '../lib/theme-css.js';
import { pickFile, downloadText } from '../lib/files.js';

const isPhone = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const dev = () => (isPhone() ? 'phone' : 'pc');
const SCREEN_KEYS = ['panel', 'side', 'chat', 'font'];

let api = null, style = null, off = null, offChat = null;

// ── 설정
function opts() {
    const o = api.options();
    o.screen ??= {};
    o.screen[dev()] ??= {};
    o.share ??= {};
    o.share[dev()] ??= {};
    o.themes ??= {};
    return o;
}
const themeName = () => appliedTheme().normalize('NFC');
function themeOpt(create) {
    const t = opts().themes, n = themeName();
    if (create) { t[n] ??= {}; t[n].area ??= {}; }
    t[n]?.styles?.forEach(wireStyle);
    if (t[n]?.area) wireArea(t[n].area);
    return t[n] || {};
}
// 사진 크기도 기기마다 따로(area.avD[기기] = { av, avCss, avW0 }): 한 기기에서 잰 px 값을 다른 기기에 그대로 걸면 어긋날 수 있음.
// 코드에서는 area.av · avCss · avW0 로 지금 기기 값을 읽고 씀(저장되지 않는 접근자, 지울 땐 null 을 넣음). 예전에 하나로 저장된 값은 두 기기에 똑같이 나눠 넣음
const AV_KEYS = ['av', 'avCss', 'avW0'];
function wireArea(a) {
    if (Object.getOwnPropertyDescriptor(a, 'av')?.get) return a;
    const old = {};
    for (const k of AV_KEYS) if (Object.hasOwn(a, k)) { if (a[k] != null) old[k] = a[k]; delete a[k]; }
    if (Object.keys(old).length) a.avD ??= { pc: old, phone: { ...old } };
    for (const k of AV_KEYS) Object.defineProperty(a, k, {
        get() { return this.avD?.[dev()]?.[k]; },
        set(v) { const b = (this.avD ??= {})[dev()] ??= {}; if (v == null) delete b[k]; else b[k] = v; },
        enumerable: false, configurable: true,
    });
    return a;
}
// 하나씩 손보기 값은 기기(PC · 휴대폰)마다 따로 둠(x.dev[기기]): 한 값을 두 기기에 같이 걸어 PC 에서 옮긴 자리가 휴대폰에서 겹쳤음.
// 코드에서는 x.props 로 지금 기기 값을 읽고 씀(저장되지 않는 접근자). 예전에 하나로 저장된 값은 두 기기에 똑같이 나눠 넣어 지금 모습을 그대로 둠
function wireStyle(x) {
    const d = Object.getOwnPropertyDescriptor(x, 'props');
    if (d?.get) return x;
    if (d) { x.dev ??= { pc: d.value || {}, phone: JSON.parse(JSON.stringify(d.value || {})) }; delete x.props; }
    x.dev ??= {};
    Object.defineProperty(x, 'props', { get() { return this.dev[dev()] ??= {}; }, enumerable: false, configurable: true });
    return x;
}
const devCount = (x) => Object.values(x.dev || { a: Object.getOwnPropertyDescriptor(x, 'props')?.value || {} }).filter(p => p && Object.keys(p).length).length;
// 화면 값(채팅 폭 · 패널 폭): 기본은 이 테마에만(scr). 테마마다 CSS 가 달라 '모든 테마' 기본은 다른 테마를 어긋나게 했음 →
// 사용자가 고른 테마들끼리만 같은 값을 함께 씀(share[기기][키] = { themes, v }). 예전 '모든 테마' 값(screen)은 읽기만
const shareOf = (k) => { const g = opts().share[dev()][k]; return g && g.themes?.includes(themeName()) ? g : null; };
// 고친 항목 목록에서 잠시 꺼 둔 '테마 전체' 값(값은 두고 안 씀): 'scr:chat' · 'avatar' · 'noFont' · 'mg' · 'av' · 'd'
const isOff = (k, t = themeOpt()) => !!t.offs?.includes(k);
function screenVal(k) {
    if (isOff(`scr:${k}`)) return 0;
    const own = themeOpt().scr?.[dev()];
    if (own && k in own) return Number(own[k]) || 0;
    const g = shareOf(k);
    if (g) return Number(g.v) || 0;
    return Number(opts().screen[dev()][k]) || 0;
}
function setScreen(k, v) {
    { const t0 = themeOpt(); if (t0.offs?.includes(`scr:${k}`)) t0.offs = t0.offs.filter(x => x !== `scr:${k}`); }   // 꺼 둔 값을 새로 바꾸면 다시 켬
    const g = shareOf(k), own = themeOpt().scr?.[dev()];
    if (g && !(own && k in own)) { g.v = v; return; }
    const t = themeOpt(true);
    t.scr ??= {};
    t.scr[dev()] ??= {};
    t.scr[dev()][k] = v;
    tidy();
}
// 같이 쓸 테마 정하기: 고른 테마들(지금 테마 포함)이 지금 값을 함께 씀. 하나만 남으면 그 테마 값으로 되돌림
function setShare(k, themes) {
    const v = screenVal(k), all = opts().themes, now = themeName();
    const list = [...new Set([now, ...themes])];
    for (const n of list) { const sc = all[n]?.scr?.[dev()]; if (sc) delete sc[k]; }
    if (list.length > 1) opts().share[dev()][k] = { themes: list, v };
    else { delete opts().share[dev()][k]; setScreen(k, v); }
    for (const n of Object.keys(all)) tidyTheme(n);
}
const themeList = () => [...document.querySelectorAll('#themes option')].map(o => o.value).filter(Boolean);
// 테마 고르는 작은 창(체크 목록). 지금 테마는 늘 포함
function pickThemes(anchor, chosen, onDone) {
    document.querySelector('.etk-tf-themes')?.remove();
    const pop = keepPanels(Object.assign(document.createElement('div'), { className: 'etk-tf-themes' }));
    const now = themeName();
    pop.innerHTML = `<div class="etk-tf-themes-head">같이 적용할 테마</div><input class="text_pole etk-tf-themes-find" type="search" placeholder="테마 찾기"><div class="etk-tf-themes-list"></div><div class="etk-tf-themes-foot"><div class="menu_button etk-tf-themes-ok">적용</div><div class="menu_button etk-tf-themes-no">취소</div></div>`;
    const list = pop.querySelector('.etk-tf-themes-list'), set = new Set(chosen);
    for (const n of themeList()) {
        const row = document.createElement('label');
        row.className = 'etk-tf-themes-row';
        row.innerHTML = '<input type="checkbox"><span></span>';
        row.querySelector('span').textContent = n === now ? `${n} (지금 테마)` : n;
        const cb = row.querySelector('input');
        cb.checked = n === now || set.has(n); cb.disabled = n === now;
        cb.addEventListener('change', () => { if (cb.checked) set.add(n); else set.delete(n); });
        row.dataset.name = n.toLowerCase();
        list.append(row);
    }
    pop.querySelector('.etk-tf-themes-find').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); for (const r of list.children) r.hidden = !!q && !r.dataset.name.includes(q); });
    pop.querySelector('.etk-tf-themes-ok').addEventListener('click', () => { pop.remove(); onDone([...set].filter(n => n !== now)); });
    pop.querySelector('.etk-tf-themes-no').addEventListener('click', () => pop.remove());
    document.body.append(pop);
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    pop.style.top = `${r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
    pop.style.setProperty('--tf-bg', solidTint());
}
// 비운 테마 설정은 지워서 설정이 쌓이지 않게
function tidy() { tidyTheme(themeName()); if (opts().hideAll && !opts().hideAll.length) delete opts().hideAll; }
function tidyTheme(n) {
    const t = opts().themes, v = t[n];
    if (!v) return;
    for (const d of Object.keys(v.scr || {})) if (!Object.keys(v.scr[d]).length) delete v.scr[d];
    if (v.scr && !Object.keys(v.scr).length) delete v.scr;
    if (!v.fixes?.length) delete v.fixes;
    if (v.styles) v.styles = v.styles.filter(x => { if (x.dev) for (const k of Object.keys(x.dev)) if (!Object.keys(x.dev[k] || {}).length) delete x.dev[k]; return devCount(x) > 0; });
    if (!v.styles?.length) delete v.styles;
    if (v.area) { for (const k of Object.keys(v.area)) if (v.area[k] == null) delete v.area[k]; if (v.area.d == null) { delete v.area.rowH; delete v.area.pad0; } if (v.area.avD) { for (const k of Object.keys(v.area.avD)) if (!v.area.avD[k]?.av) delete v.area.avD[k]; if (!Object.keys(v.area.avD).length) delete v.area.avD; } else if (!v.area.av) { delete v.area.avCss; delete v.area.avW0; } if (v.area.mg == null) { delete v.area.mgX; delete v.area.mgV0; } if (!Object.keys(v.area).length) delete v.area; }
    if (v.offs) { v.offs = v.offs.filter(k => k.startsWith('scr:') ? ((q) => Object.values(v.scr || {}).some(o => q in o) || Object.values(opts().share || {}).some(d => d?.[q]?.themes?.includes(n)) || Object.values(opts().screen || {}).some(d => d?.[q]))(k.slice(4)) : k === 'avatar' ? v.avatar > 0 : k === 'noFont' ? !!v.noFont : v.area?.[k] != null); if (!v.offs.length) delete v.offs; }
    if (!v.scr && !v.noFont && !v.font && !(v.avatar > 0) && !v.fixes && !v.styles && !v.area) delete t[n];
}

const ICONS = ':not(i):not(.fa):not([class*="fa-"]):not([class*="icon"]):not([class*="Icon"])';
// ── 테마 글꼴 끄기: 테마 CSS(#custom-style) 안의 글꼴 선언만 뺌. 예전엔 모든 칸에 기본 글꼴을 강한 규칙으로 덮어써서,
// 다른 확장이나 사용자가 따로 정한 글꼴(메시지 · 입력창 등)까지 같이 꺼졌음. 아이콘 글꼴은 남김.
// 테마를 바꾸면 실리태번이 #custom-style 을 새로 써서 뺀 것도 함께 없어지고, build 가 새 시트에서 다시 뺌
const ICON_FONT = /awesome|icon|symbol|material|glyph/i;
// 아이콘 칸인지는 :not(…) 안을 빼고 봄: 테마가 ':not(i):not(.fa) { 글꼴 }'(아이콘만 빼고 전부)로 쓴 규칙을 아이콘 규칙으로 잘못 알아 못 껐음
const ICON_SEL = /(^|[\s,>+~(])i([.:#[\s,>+~)]|$)|\.fa\b|fa-|icon/i;
const isIconSel = (p) => ICON_SEL.test(p.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, ''));
const splitSel = (sel) => { const r = []; let d = 0, cur = ''; for (const ch of sel) { if (ch === '(') d++; else if (ch === ')') d--; if (ch === ',' && !d) { r.push(cur.trim()); cur = ''; } else cur += ch; } r.push(cur.trim()); return r.filter(Boolean); };
let fontCut = null;   // { sheet, undo: [되돌리는 함수] }
function themeFontOff(on) {
    const sheet = document.getElementById('custom-style')?.sheet || null;
    if (fontCut && (!on || fontCut.sheet !== sheet)) {
        if (fontCut.sheet === sheet) for (const f of fontCut.undo.reverse()) { try { f(); } catch { /* 이미 바뀐 시트 */ } }
        fontCut = null;
    }
    if (!on || !sheet || fontCut) return;
    const undo = [];
    const drop = (st, k) => { const v = st.getPropertyValue(k), pr = st.getPropertyPriority(k); st.removeProperty(k); undo.push(() => st.setProperty(k, v, pr)); };
    const add = (list, after, text) => {
        const added = list.cssRules[list.insertRule(text, [...list.cssRules].indexOf(after) + 1)];
        undo.push(() => { const i = [...list.cssRules].indexOf(added); if (i >= 0) list.deleteRule(i); });
    };
    const cut = (r, list) => {
        const st = r.style;
        if (st.getPropertyValue('--mainFontFamily')) drop(st, '--mainFontFamily');
        if (![...st].includes('font-family')) return;
        // 중첩 규칙 안 선언 묶음(셀렉터 없음)은 바깥 셀렉터를 따름: 쪼개지 않고 아이콘 글꼴만 남김
        const parts = r.selectorText ? splitSel(r.selectorText) : [''], icons = parts.filter(isIconSel), rest = parts.filter(p => !isIconSel(p));
        if (!rest.length) return;
        const fam = st.getPropertyValue('font-family'), pr = st.getPropertyPriority('font-family') ? ' !important' : '';
        if (fam) {
            if (ICON_FONT.test(fam)) return;
            drop(st, 'font-family');
            // 아이콘 셀렉터가 같은 목록에 섞여 있으면 그쪽 글꼴은 따로 남김
            if (icons.length && r.selectorText) add(list, r, `${icons.join(', ')} { font-family: ${fam}${pr} }`);
            return;
        }
        // font 줄임 꼴에 var() 가 있으면 글꼴 값이 비어 읽혀(크기 · 굵기와 한 덩어리) 따로 뺄 수 없어,
        // 같은 셀렉터 규칙을 바로 뒤에 넣어 글꼴만 물려받게 함. 줄임 꼴 뒤에 font-style 등을 덧붙이면 font 값도 비어 읽혀 cssText 로 봄
        if (ICON_FONT.test(st.cssText) || !r.selectorText) return;
        add(list, r, `${rest.join(', ')} { font-family: inherit${pr} }`);
    };
    const walk = (list) => {
        for (const r of [...list.cssRules]) {
            if (r instanceof CSSFontFaceRule || r instanceof CSSImportRule) continue;
            if (r.style) cut(r, list);
            if (r.cssRules?.length) walk(r);
        }
    };
    try { walk(sheet); } catch (e) { console.warn('[Breeze] 테마 글꼴 끄기', e); }
    fontCut = { sheet, undo };
}

// 규칙을 칸마다 따로 둠: 하나를 바꿀 때 전체를 새로 쓰면 화면 전체 스타일을 처음부터 다시 계산했음(글꼴 규칙이 모든 칸에 걸려 있어 특히) →
// 바뀐 칸의 규칙만 고치면 브라우저가 그 셀렉터에 맞는 칸만 다시 계산함. 순서: 화면 전체 값 · 글꼴 → 칸마다 → 숨기기 · 뒤 누르기
let fixStyle = null;
const parts = new Map();   // sel → <style>
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
function build() {
    if (!style) return;
    const t = themeOpt(), out = [], v = (k) => screenVal(k);
    // 다른 확장 · 테마가 같은 곳을 !important 로 더 강하게 고정해 둔 경우(양옆 패널 최소 폭 등) 우리 값이 안 먹었음 → 아이디 셋만큼 강하게
    const S = 'html:not(#etk-tf-a):not(#etk-tf-b):not(#etk-tf-c) body';
    // 실리태번 채팅 폭 값(--sheldWidth)은 채팅 칸에만: 페이지 전체에 걸면 그 값으로 '채팅 옆 남은 자리'를 재는 테마에서 설정 패널까지 같이 좁아졌음
    // (채팅 칸 안에서는 실리태번 · 테마 규칙이 이 값으로 폭 · 가운데 자리를 계산함)
    if (v('chat') > 0) out.push(`${S} #sheld { --sheldWidth: ${v('chat')}vw !important; }`);
    // 실리태번 채팅 폭 값을 테마가 상한으로만 쓰는 경우(예: min(채팅 폭, 화면 - 그림 자리)) 값을 키워도 더 안 넓어졌음 → 채팅 칸 폭도 직접(위치는 테마대로라 오른쪽에 붙은 테마는 왼쪽으로 넓어짐)
    if (v('chat') > 0) out.push(`${S} #sheld { width: min(${v('chat')}vw, 100vw) !important; max-width: 100vw !important; }`);
    // 채팅 칸을 넓혀도 안쪽 칸의 최대 폭(테마 96개 중 메시지 16 · 글 칸 29개가 둠)에 막혀 글은 그대로였음 → 채팅 폭을 정했으면 안쪽 최대 폭도 풂
    // (메시지 안 여백 · 이름 칸은 테마 모양이라 그대로 두고, 그건 '메시지 왼쪽 빈자리'로 따로)
    if (v('chat') > 0) out.push(`${S} :is(#chat, #chat .mes, #chat .mes .mes_block, #chat .mes .mes_text) { max-width: none !important; }`);
    // 글자 크기: 실리태번 글자 배율(--fontScale)은 글자를 px 로 박아 둔 테마에선 아이콘만 커져서, 메시지 글 칸 자체를 확대 · 축소
    if (v('font') > 0) out.push(`${S} #chat .mes :is(.mes_text, .mes_reasoning_details) { zoom: ${v('font')} !important; }`);
    if (v('panel') > 0) out.push(`${S} #top-settings-holder .drawer-content:not(.fillLeft):not(.fillRight):not(#left-nav-panel):not(#right-nav-panel) { min-width: min(${v('panel')}px, calc(100vw - 16px)) !important; left: 50% !important; right: auto !important; transform: translateX(-50%) !important; }`);
    if (v('side') > 0) out.push(`${S} :is(#left-nav-panel, #right-nav-panel) { min-width: min(${v('side')}px, calc(100vw - 16px)) !important; width: min(${v('side')}px, calc(100vw - 16px)) !important; }`);
    themeFontOff(!!t.noFont && !isOff('noFont', t));
    if (t.avatar > 0 && !isOff('avatar', t)) out.push(`${S} #chat .mes .avatar { max-width: ${t.avatar}px !important; height: auto !important; }
${S} #chat .mes .avatar img { max-width: ${t.avatar}px !important; max-height: ${Math.round(t.avatar * 1.5)}px !important; width: auto !important; height: auto !important; }`);
    out.push(...areaCss(S, t));
    if (t.area?.mg != null && t.area.mgX?.[dev()] == null && !gapBusy && !gapNoMes) requestAnimationFrame(() => fitGap(t.area.mg, true));
    // 사진 크기는 정해져 있는데 이 기기에서 잰 규칙이 아직 없으면(불러온 값 · 다른 기기에서 정한 값) 한 번 재서 맞춤. 메시지가 없으면 채팅을 열 때 다시, 맞출 수 없는 테마면 값을 지움
    if (t.area?.av && t.area.avCss == null && !avBusy && !avNoMes) { avBusy = true; requestAnimationFrame(async () => { let r = { ok: false, why: 'fail' }; try { r = await fitAvatar(t.area.av); } catch (e) { console.warn('[Breeze] 사진 크기 맞추기', e); } avBusy = false; if (r.ok) api.save(); else if (r.why === 'nomes') avNoMes = true; else { t.area.av = t.area.avCss = t.area.avW0 = null; build(); } }); }
    if (t.area?.d != null && (!t.area.rowH || Object.keys(LIST_ROWS).some(k => t.area.pad0?.[k] == null))) requestAnimationFrame(measureListRow);
    setText(style, out.join('\n'));
    if (!fixStyle?.isConnected) { fixStyle = Object.assign(document.createElement('style'), { id: 'etk-theme-fit-fixes', media: style.media }); style.after(fixStyle); }
    const want = new Map();
    for (const x of t.styles || []) if (!x.off) { const css = styleCss(S, x); if (css) want.set(x.sel, (want.get(x.sel) ? want.get(x.sel) + '\n' : '') + css); }
    for (const [sel, el] of parts) if (!want.has(sel)) { el.remove(); parts.delete(sel); }
    for (const [sel, css] of want) {
        let el = parts.get(sel);
        if (!el?.isConnected) { el = Object.assign(document.createElement('style'), { className: 'etk-theme-fit-part', media: style.media }); fixStyle.before(el); parts.set(sel, el); }
        setText(el, css);
    }
    setText(fixStyle, [...(opts().hideAll || []).map(f => ({ ...f, how: 'hide' })), ...(t.fixes || [])].filter(f => !f.off).map(f => `${S} ${f.sel} { ${f.how === 'hide' ? 'display: none' : 'pointer-events: none'} !important; }`).join('\n'));
}
// ── 영역별 맞추기: 실리태번 화면 구조(테마가 달라도 같음)를 알고 결과만 고르게 함. 무엇을 바꿀지는 여기서 정함
// 프롬프트 · 캐릭터 목록 줄 간격: 줄 높이를 실제로 정하는 곳은 테마마다 달라서(줄 안쪽 여백 · 최소 높이 · 고정 높이 · 줄 사이 · 긴 이름이 두 줄로 꺾임) 그걸 한꺼번에 바꿈.
// 그룹 줄처럼 프롬프트 줄 높이를 재서 따라가는 것은 바꾼 뒤 잰 줄 높이(rowH)를 --pf-row-h 로 넘겨 같이 맞춤
const LIST_ROWS = {
    prompt: '#completion_prompt_manager_list li.completion_prompt_manager_prompt',
    char: '#rm_print_characters_block :is(.character_select, .group_select, .bogus_folder_select)',
};
// 줄 위아래 여백은 테마 원래 여백(pad0, 목록마다 잼)에서 d 만큼 늘리거나 줄임: 고정값으로 하면 원래 여백이 큰 테마에서 '넓게'가 오히려 좁아졌음.
// 아직 못 잰 목록은 줄일 때만 3px 로(늘릴 땐 원래보다 좁아질 수 있어 걸지 않음)
const listPad = (a, k) => { const p0 = a.pad0?.[k]; if (a.d == null) return null; return p0 == null ? (a.d < 0 ? 3 : null) : Math.max(0, p0 + a.d); };
const TIGHT = 3, LOOSE = 6;   // 빽빽하게: 프롬프트 줄 여백 3px, 널찍하게: 원래 + 6px
function areaCss(S, t) {
    const a = t.area || {}, out = [];
    if (a.av && a.avCss && !isOff('av', t)) out.push(a.avCss);
    const gx = a.mg != null && !isOff('mg', t) ? a.mgX?.[dev()] : null;
    if (gx != null) out.push(`${S} #chat .mes { margin-bottom: ${gx}px !important; }`);
    if (a.d == null || isOff('d', t)) return out;
    for (const [k, sel] of Object.entries(LIST_ROWS)) {
        const pad = listPad(a, k);
        if (pad == null) continue;
        out.push(`${S} ${sel} { padding-top: ${pad}px !important; padding-bottom: ${pad}px !important; min-height: 0 !important; height: auto !important; margin-top: 0 !important; margin-bottom: ${a.d < 0 ? 1 : 4}px !important; }`);
    }
    if (a.rowH > 0) out.push(`${S} #completion_prompt_manager_list { --pf-row-h: ${a.rowH}px !important; }`);
    // 프롬프트 줄 높이를 따라가는 그룹 줄도 제 여백 때문에 더 줄지 못했음 → 같은 여백으로
    const pp = listPad(a, 'prompt');
    if (pp != null) out.push(`${S} #completion_prompt_manager_list .pf-group-head { padding-top: ${Math.max(0, pp - 2)}px !important; padding-bottom: ${Math.max(0, pp - 2)}px !important; }`);
    return out;
}
// 목록마다 테마 원래 줄 여백: 우리 규칙을 잠깐 끄고 잼(이미 걸린 값을 재면 원래 여백을 알 수 없어서). 보이는 목록만, 한 번만
function measurePad0(a) {
    const todo = Object.entries(LIST_ROWS).filter(([k]) => a.pad0?.[k] == null).map(([k, sel]) => [k, [...document.querySelectorAll(sel)].find(e => e.getBoundingClientRect().height > 0)]).filter(([, e]) => e);
    if (!todo.length) return false;
    setMedia('not all');
    a.pad0 ??= {};
    for (const [k, e] of todo) a.pad0[k] = Math.round(parseFloat(getComputedStyle(e).paddingTop) || 0);
    setMedia('');
    return true;
}
// 바꾼 뒤 한 줄짜리 프롬프트 줄 높이를 재 둠(목록이 보일 때만). 재면 그 값을 따라가는 줄(그룹 줄)도 같이 맞춰짐
// 사진 크기: 테마마다 사진을 그리는 방식이 달라(액자째 그림 · 화면 폭의 % · 떠 있는 틀을 최소 폭과 고정 높이로 묶음) 방법 하나로는 깨지는 테마가 있었음 →
// 방법을 차례로 걸어 실제로 목표 크기가 된 것을 씀. 떠 있는 사진이면 바뀐 높이만큼 글 위 여백 · 사진 밑 표시를 옮기고, 이름 · 글을 덮으면 비켜 놓음.
// 끝으로 사진이 보이는지 · 메시지 밖으로 삐져나오지 않는지 · 이름과 글을 덮지 않는지 다시 재서 하나라도 어긋나면 걸지 않고 되돌림(처음 보는 방식의 테마에서 화면이 깨진 채 남지 않게)
const AV_S = 'html:not(#etk-tf-a):not(#etk-tf-b):not(#etk-tf-c) body #chat .mes';
const shown = (e) => { if (!e) return false; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 2 && r.height > 2 && c.display !== 'none' && c.visibility !== 'hidden' && parseFloat(c.opacity) > 0.05; };
function avatarMes() { return [...document.querySelectorAll('#chat .mes')].reverse().find(m => shown(m.querySelector('.avatar'))); }
async function fitAvatar(T) {
    const t = themeOpt(true);
    t.area ??= {};
    const prev = t.area.avCss;
    t.area.avCss = ''; build();
    const R = (e) => e.getBoundingClientRect(), frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const undoTo = (why) => { t.area.avCss = prev; build(); return { ok: false, why }; };
    const mes = avatarMes();
    if (!mes) return undoTo('nomes');
    const av = mes.querySelector('.avatar'), img = av.querySelector('img') || av, txt = mes.querySelector('.mes_text'), blk = mes.querySelector('.mes_block');
    if (!txt) return undoTo('fail');
    const S = AV_S, w0 = R(av).width, h0 = R(av).height, wrap = av.closest('.mesAvatarWrapper') || av;
    t.area.avW0 = Math.round(w0);
    const floatAv = /absolute|fixed/.test(getComputedStyle(av).position) || /absolute|fixed/.test(getComputedStyle(wrap).position);
    const tm0 = parseFloat(getComputedStyle(txt).marginTop) || 0, avB0 = R(av).bottom, txtTop0 = R(txt).top;
    const below = [...mes.querySelectorAll('.mes_timer, .tokenCounterDisplay, .mesIDDisplay')].filter(e => /absolute|fixed/.test(getComputedStyle(e).position) && R(e).height > 0 && R(e).top >= avB0 - 8 && R(e).top <= txtTop0).map(e => [...e.classList][0]);
    const st = document.createElement('style');
    document.head.append(st);
    const hit = () => Math.abs(R(av).width - T) <= 15 || Math.abs(R(img).width - T) <= 15;
    const base = `${S} .avatar, ${S} .avatar * { transition: none !important; }`;
    const ways = [
        `${S} .avatar { zoom: ${(T / w0).toFixed(3)} !important; }`,
        `${S} .avatar { max-width: ${T}px !important; } ${S} .avatar img { max-width: 100% !important; height: auto !important; max-height: none !important; }`,
        `${S} .avatar { width: ${T}px !important; min-width: 0 !important; max-width: none !important; height: ${Math.round(h0 * T / w0)}px !important; }`,
    ];
    let css = null;
    for (const w of ways) { st.textContent = base + w; await frame(); if (hit()) { css = st.textContent; break; } }
    if (!css) { st.remove(); return undoTo('size'); }
    const inter = (x, y) => Math.max(0, Math.min(x.right, y.right) - Math.max(x.left, y.left)) * Math.max(0, Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top));
    st.textContent = css; await frame();
    let tm = tm0;
    if (floatAv) {
        let dh = Math.round(R(av).height - h0);
        if (dh < 0 && tm0 > 0) tm = Math.max(0, tm0 + dh);
        // 떠 있는 사진은 메시지마다 같은 자리에 그려지는데, 일부 메시지에만 있는 줄(다른 확장이 이름 밑에 넣는 줄 등)이 그 자리를 지나가면 사진에 덮였음.
        // 맨 아래 메시지 하나만 재면 그 줄이 없어 못 봤음 → 그려진 메시지 여러 개에서 사진 자리를 지나가는 글 줄을 찾아, 가장 아래 줄 밑으로 사진을 내림
        const down = Math.max(0, ...[...document.querySelectorAll('#chat .mes')].slice(-15).map(m => {
            const a = m.querySelector('.avatar'), t2 = m.querySelector('.mes_text');
            if (!shown(a) || !t2) return 0;
            const ar = R(a), tt = R(t2).top;
            // 글자를 직접 가진 칸으로 찾음(아이콘이 같이 든 칸도 글 줄). 접힌 추론(닫힌 details)처럼 화면에 안 그려지는 글도 크기는 재져서 사진이 쓸데없이 내려갔음 → 그려지는 글만, 감싼 칸이 잘라 낸 부분은 빼고 잼
            const seen = (e) => { let r = R(e), x = { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; for (let p = e.parentElement; p && p !== m; p = p.parentElement) { if (getComputedStyle(p).overflow === 'visible') continue; const q = R(p); x = { left: Math.max(x.left, q.left), right: Math.min(x.right, q.right), top: Math.max(x.top, q.top), bottom: Math.min(x.bottom, q.bottom) }; if (x.right - x.left < 2 || x.bottom - x.top < 2) return null; } return x; };
            const lines = [...m.querySelectorAll('.mes_block *')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && !e.closest('.mes_text, .ch_name, .avatar, .mesAvatarWrapper') && !/absolute|fixed/.test(getComputedStyle(e).position) && shown(e) && !e.closest('details:not([open]) > :not(summary)') && (e.checkVisibility?.({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }) ?? true));
            let need = 0;
            for (const e of lines) { const r = seen(e); if (r && r.bottom <= tt + 1 && inter(ar, r) >= 40) need = Math.max(need, Math.round(r.bottom + 6 - ar.top)); }
            return need;
        }));
        if (down) { css += ` ${S} .avatar { translate: 0 ${down}px !important; }`; dh += down; }
        if (dh) css += below.map(c => ` ${S} .${c} { translate: 0 ${dh}px !important; }`).join('');
    }
    // 커진 사진이 이름이나 글을 덮으면 비켜 놓음: 한 번 옮기면 다른 칸 자리도 바뀌어서, 겹침이 없어질 때까지 다시 재며 최대 5번.
    // 이름은 메시지 칸 → 이름 줄 → 이름 글자 순으로 밀어 봄(테마가 칸을 크기 없는 칸(display: contents)으로 만들면 그 칸에 준 여백은 먹지 않았음)
    const nameEl = mes.querySelector('.ch_name .name_text') || mes.querySelector('.ch_name');
    const solidBox = (e) => e && getComputedStyle(e).display !== 'contents';
    const nameWays = [blk, mes.querySelector('.ch_name'), nameEl].filter(solidBox).filter((e, i, arr) => arr.indexOf(e) === i);
    const sel = (e) => (e === blk ? '.mes_block' : e === nameEl && nameEl.classList.contains('name_text') ? '.ch_name .name_text' : '.ch_name');
    const extra = new Map();   // 셀렉터 → 덧붙일 규칙
    const write = async () => { st.textContent = css + [...extra.values()].join('') + (tm !== tm0 ? ` ${S} .mes_text { margin-top: ${tm}px !important; }` : ''); await frame(); };
    await write();
    for (let i = 0; i < 5; i++) {
        let moved = false;
        if (nameEl && inter(R(av), R(nameEl)) >= 40 && R(av).left < R(nameEl).left) {
            const e = nameWays.shift();
            if (e) {
                // 안쪽 여백으로 밀면 칸 자리는 그대로라 겹침이 안 풀려서, 바깥 여백으로 칸째 밈
                const push = Math.round(R(av).right - R(nameEl).left + 8), k = sel(e), now = parseFloat(getComputedStyle(e).marginLeft) || 0;
                extra.set(k, ` ${S} ${k} { margin-left: ${Math.round(now + push)}px !important; }`);
                moved = true;
            }
        }
        // 사진 밑에 따라 내려간 시간 · 토큰 표시도 글을 덮으면 안 돼서, 사진과 그 표시 중 가장 아래를 기준으로 비킴
        const low = Math.max(R(av).bottom, ...[...mes.querySelectorAll(below.map(c => '.' + c).join(', ') || ':not(*)')].filter(shown).map(e => R(e).bottom));
        if ((inter(R(av), R(txt)) >= 80 || low > R(av).bottom) && low + 8 > R(txt).top) {
            // 위 칸의 아래 여백과 겹쳐 합쳐지는 바람에(마진 겹침) 글 위 여백을 늘려도 덜 내려갔음 → 실제로 벌어진 여백에서 더함
            const prev = txt.previousElementSibling, prevMb = prev ? parseFloat(getComputedStyle(prev).marginBottom) || 0 : 0;
            tm = Math.round(Math.max(tm, prevMb) + low + 8 - R(txt).top);
            moved = true;
        }
        if (!moved) break;
        await write();
    }
    css = st.textContent;
    // 확인
    const a3 = R(av), nm = nameEl ? R(nameEl) : null;
    const why = !hit() ? 'size' : !shown(av) || !shown(img) ? 'hidden' : a3.top < R(mes).top - 4 ? 'out' : nm && inter(a3, nm) >= 40 ? 'name' : inter(a3, R(txt)) >= 80 ? 'text' : '';
    st.remove();
    if (why) return undoTo(why);
    t.area.av = T; t.area.avCss = css.replace(/\s+/g, ' ').trim();
    build();
    return { ok: true };
}
// 메시지 사이 간격: 테마마다 간격을 만드는 곳이 달라(메시지 바깥 여백 · 메시지 안 빈 곳 · 채팅 줄 사이 · 떠 있는 사진) 한 값을 걸면 테마마다 결과가 달랐음 →
// 눈에 보이는 간격(위 메시지의 마지막 보이는 것 ~ 아래 메시지의 첫 보이는 것)을 재서, 메시지 아래 여백을 목표에 닿을 때까지 고침(최대 4번).
// 휴대폰은 메시지 안 배치가 달라 기기마다 따로 잼(mgX[기기]). d = 테마 원래 간격(mgV0)에서 얼마나 늘리고 줄일지
// gapNoMes: 이 기기 값을 재려 했는데 메시지가 없었음 → 채팅이 열릴 때까지 다시 재지 않음(안 그러면 build 마다 다시 재러 가 프레임마다 되풀이)
let gapBusy = false, gapNoMes = false, avBusy = false, avNoMes = false;
const gapTight = (v0) => Math.min(8, v0), GAP_LOOSE = 24;   // 좁게: 보이는 간격 8px(원래 더 좁으면 그대로), 넓게: 원래 + 24px
const frame2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
function gapPairs() {
    const R = (e) => e.getBoundingClientRect();
    // 화면에서 먼 메시지는 그리기를 건너뛰어(content-visibility) 안쪽 자리를 잴 수 없어서 뺌
    const mes = [...document.querySelectorAll('#chat > .mes')].filter(m => m.getBoundingClientRect().height > 0 && getComputedStyle(m).contentVisibility !== 'auto').slice(-8);
    // 굴림에 따라 자리가 바뀌는 칸(sticky · fixed)은 메시지 자리와 상관없어 뺌
    // 크기부터 보고(싼 것) 크기 있는 칸만 계산된 스타일을 한 번 읽음: 긴 메시지는 칸이 수천 개라 칸마다 두 번 읽으면 버튼 한 번에 0.2초가 걸렸음
    const edge = (m) => { let top = Infinity, bot = -Infinity; for (const e of m.querySelectorAll('*')) { const r = R(e); if (r.width <= 2 || r.height <= 2 || (r.top >= top && r.bottom <= bot)) continue; const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) <= 0.05 || /sticky|fixed/.test(c.position)) continue; top = Math.min(top, r.top); bot = Math.max(bot, r.bottom); } return [top, bot]; };
    const ed = mes.map(edge), out = [];
    for (let i = 1; i < mes.length; i++) if (mes[i].previousElementSibling === mes[i - 1] && Number.isFinite(ed[i][0]) && Number.isFinite(ed[i - 1][1])) out.push({ g: Math.round(ed[i][0] - ed[i - 1][1]), mb: parseFloat(getComputedStyle(mes[i - 1]).marginBottom) || 0 });
    return out;
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
// 한 번만 재고 바로 계산: 메시지 안 빈 곳은 바깥 여백과 상관없으니, 짝마다 '그 짝이 목표가 되는 아래 여백'(지금 여백 + 목표 − 지금 간격)을 구해 가운데 값을 씀.
// 고치고 다시 재며 맞추는 방식은 재는 사이 화면 밖 메시지가 펼쳐지며 자리가 움직여(긴 메시지) 값이 엉뚱하게 쌓였음
async function fitGap(d, quiet) {
    if (gapBusy) return { ok: false, why: 'busy' };
    const t = themeOpt(true);
    t.area ??= {};
    const a = t.area, keep = a.mgX?.[dev()];
    gapBusy = true;
    // 재는 동안만 테마의 움직임 효과를 끔(여백이 천천히 바뀌는 테마에서 덜 바뀐 값을 잼)
    const still = Object.assign(document.createElement('style'), { textContent: `${AV_S}, ${AV_S} * { transition: none !important; animation: none !important; }` });
    document.head.append(still);
    try {
        a.mgX ??= {};
        delete a.mgX[dev()]; build(); await frame2();
        const p0 = gapPairs();
        if (!p0.length) { if (keep != null) a.mgX[dev()] = keep; if (quiet) gapNoMes = true; build(); return { ok: false, why: 'nomes' }; }
        const v0 = median(p0.map(x => x.g));
        if (typeof d === 'function') d = d(v0);
        const T = Math.max(Math.min(0, v0), v0 + d);
        a.mgV0 = v0; a.mg = d;
        a.mgX[dev()] = Math.round(median(p0.map(x => x.mb + T - x.g)));
        build();
        if (quiet) api.save();
        return { ok: true, v0, T };
    } finally { gapBusy = false; still.remove(); }
}
function measureListRow() {
    const t = themeOpt();
    if (t.area?.d == null) return;
    if (measurePad0(t.area)) { api.save(); build(); }
    // 한 줄짜리 줄 높이: 이름이 두 줄로 꺾인 줄을 재면 따라가는 줄까지 커졌음 → 보이는 줄 중 가장 낮은 것
    const hs = [...document.querySelectorAll(LIST_ROWS.prompt)].map(e => e.getBoundingClientRect().height).filter(h => h > 0);
    if (!hs.length) return;
    const h = Math.round(Math.min(...hs));
    if (h > 0 && h !== t.area.rowH) { t.area.rowH = h; api.save(); build(); }
}
// 원래 모습 잠깐 보기: 우리 규칙 전부를 잠시 끔
function setMedia(m) { for (const el of [style, fixStyle, ...parts.values()]) if (el) el.media = m; }
const refresh = () => { if (mode?.box) mode.box._key = null; build(); };
// 끄는 동안 · 방향키로 옮기는 동안 미리 보기: 전체 규칙을 매번 새로 쓰면 화면 전체 스타일을 다시 계산해 한 번 움직일 때 30ms 넘게 걸렸음(메시지가 많을수록 더) →
// 잡은 칸 하나에만 표시(data-etk-tf-live)를 달고 그 표시만 고르는 작은 규칙으로 미리 보여 주고, 손을 떼면 한 번만 전체를 새로 씀
let liveStyle = null, liveEl = null;
function live(el, x) {
    liveStyle ??= Object.assign(document.createElement('style'), { id: 'etk-theme-fit-live' });
    if (!liveStyle.isConnected) document.head.append(liveStyle);
    if (liveEl !== el) { liveEl?.removeAttribute('data-etk-tf-live'); liveEl = el; el.setAttribute('data-etk-tf-live', ''); }
    liveStyle.textContent = styleCss('html:not(#etk-tf-a):not(#etk-tf-b):not(#etk-tf-c):not(#etk-tf-d):not(#etk-tf-e):not(#etk-tf-f) body', { ...x, sel: '[data-etk-tf-live]' });
    if (mode?.box) mode.box._key = null;
}
function liveEnd() {
    liveEl?.removeAttribute('data-etk-tf-live'); liveEl = null;
    if (liveStyle) liveStyle.textContent = '';
}

// ── 고른 칸 하나를 직접 조절(이 칸): 폭 · 높이 · 글자 크기 · 여백 · 간격 · 줄바꿈 · 배율 · 불투명도
const PROPS = {
    width: { label: '폭', unit: 'px', min: 0, step: 1, max: (r) => Math.max(innerWidth, Math.round(r.width * 2)), now: (r) => Math.round(r.width) },
    height: { label: '높이', unit: 'px', min: 0, step: 1, max: (r) => Math.max(innerHeight, Math.round(r.height * 2)), now: (r) => Math.round(r.height), notImg: true },
    fontSize: { label: '글자 크기', unit: 'px', min: 6, step: 1, max: () => 60, now: (r, cs) => Math.round(parseFloat(cs.fontSize)) || 14, notImg: true },
    padding: { label: '안쪽 여백', unit: 'px', min: 0, step: 1, max: () => 60, now: (r, cs) => Math.round(parseFloat(cs.paddingTop)) || 0, notImg: true },
    margin: { label: '바깥 여백', unit: 'px', min: -100, step: 1, max: () => 100, now: (r, cs) => Math.round(parseFloat(cs.marginTop)) || 0 },
    lineHeight: { label: '줄 간격', unit: '배', min: 0.8, step: 0.05, max: () => 3, now: (r, cs) => Math.round((parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) || 1.4) * 20) / 20, notImg: true },
    moveX: { label: '가로 위치', unit: 'px', min: -300, step: 1, max: () => 300, now: () => 0 },
    moveY: { label: '세로 위치', unit: 'px', min: -300, step: 1, max: () => 300, now: () => 0 },
    gap: { label: '안에 있는 것끼리 간격', unit: 'px', min: 0, step: 1, max: () => 60, now: (r, cs) => Math.round(parseFloat(cs.gap)) || 0, flexOnly: true },
    zoom: { label: '전체 배율', unit: '배', min: 0.3, step: 0.05, max: () => 2.5, now: () => 1 },
    opacity: { label: '불투명도', unit: '', min: 0.05, step: 0.05, max: () => 1, now: (r, cs) => Number(cs.opacity) },
};
const isFlex = (cs) => /flex|grid/.test(cs.display);
// 조절이 한꺼번에 다 나오면 길고 어수선해서, 칸 종류마다 자주 쓸 것만 먼저 보이고 나머지는 '더 보기' 안에
function mainProps(el, cs, img) {
    if (img) return ['width', 'zoom'];
    const text = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || el.matches('p, span, q, em, b, i, h1, h2, h3, h4, h5, h6, li, .mes_text');
    // 바깥 여백은 마이너스로 줄일 수 있는 유일한 여백이라 앞에 둠(안쪽 여백 · 간격 · 높이는 0 아래가 없음)
    if (text) return ['fontSize', 'width', 'padding', 'margin'];
    if (isFlex(cs)) return ['gap', 'width', 'padding', 'margin'];
    return ['width', 'height', 'padding', 'margin'];
}
function styleCss(S, x) {
    const p = x.props || {}, d = [];
    // 'auto' = 테마가 고정해 둔 크기(폭 0 · 높이 150px 등)를 풀어 내용에 맞춤
    // 나란히 놓인 칸(flex) 안에서 남은 자리를 채우게 된 칸(입력창 글 칸 등)은 폭을 정해도 그대로 늘어나서, 폭을 정하면 늘고 줄지 않게
    if (p.width != null) d.push(`width: ${p.width === 'auto' ? 'auto' : `${p.width}px`}`, 'max-width: none', 'min-width: 0', ...(p.width !== 'auto' ? ['flex: 0 0 auto'] : []), ...(x.img ? ['height: auto'] : []));
    if (p.height != null) d.push(`height: ${p.height === 'auto' ? 'auto' : `${p.height}px`}`, 'min-height: 0', 'max-height: none');
    else if (p.minH != null) d.push(`min-height: ${p.minH}px`);
    // 떠 있는 칸 제자리에: 테마가 위치를 고정해 띄운 칸(position absolute 등)을 다른 칸들 차례에 놓음 → 위에 무엇이 끼어들어도 밀려서 안 겹침
    if (p.unfloat) d.push('position: relative', 'inset: auto', 'transform: none');
    // 세로로 쌓기: 안의 칸들을 옆으로 늘어놓지 않고 위아래로
    const dir = p.dir || (p.oneLine ? 'row' : p.stack ? 'col' : p.wrap ? 'wrap' : null);
    if (dir === 'col') d.push('flex-direction: column', 'flex-wrap: nowrap');
    if (dir === 'row') d.push('flex-direction: row', 'flex-wrap: nowrap', 'align-items: center');
    if (dir === 'wrap') d.push('flex-wrap: wrap');
    // 이 칸 자리: 감싸는 칸 안에서 왼쪽 · 가운데 · 오른쪽(바깥 여백 auto). 글자처럼 줄 안에 놓이는 칸은 블록으로 바꿔야 먹음
    // 줄 전체를 차지한 칸만 내용 폭으로 줄임(fit): 폭이 남는 칸까지 줄이면 테마가 준 폭이 사라져 양옆 간격이 좁아졌음
    if (p.place) d.push(`margin-left: ${p.place === 'left' ? '0' : 'auto'}`, `margin-right: ${p.place === 'right' ? '0' : 'auto'}`, 'align-self: auto', ...(p.fit && p.width == null ? ['width: fit-content'] : []));
    if (p.fontSize != null) d.push(`font-size: ${p.fontSize}px`);
    if (p.padding != null) d.push(`padding: ${p.padding}px`);
    if (p.margin != null) d.push(`margin: ${p.margin}px`);
    // 여백 네 방향 따로(상자 그림 · 화면의 여백 띠 끌기)
    for (const [k, css] of [['pt', 'padding-top'], ['pr', 'padding-right'], ['pb', 'padding-bottom'], ['pl', 'padding-left'], ['mt', 'margin-top'], ['mr', 'margin-right'], ['mb', 'margin-bottom'], ['ml', 'margin-left']]) if (p[k] != null) d.push(`${css}: ${p[k]}px`);
    if (p.gap != null) d.push(`gap: ${p.gap}px`);

    if (p.order != null) d.push(`order: ${p.order}`);
    if (p.zoom != null) d.push(`zoom: ${p.zoom}`);
    if (p.lineHeight != null) d.push(`line-height: ${p.lineHeight}`);
    if (p.moveX != null || p.moveY != null) d.push(`translate: ${p.moveX || 0}px ${p.moveY || 0}px`);
    // 테마가 칸 높이를 고정하고 넘친 걸 잘라 두면(overflow: hidden) 안쪽 글이 잘렸음 → 높이를 내용에 맞추고 넘친 것도 보이게
    if (p.unclip) d.push('overflow: visible', ...(p.height == null ? ['height: auto', 'max-height: none'] : []));
    if (p.opacity != null) d.push(`opacity: ${p.opacity}`);
    // 색: 글자색 · 바탕색(없애기 = 바탕 칠과 무늬를 지움: 대사의 형광펜 같은 것)
    if (p.color) d.push(`color: ${p.color}`);
    if (p.bg === 'none') d.push('background: none', 'box-shadow: none');
    else if (p.bg) d.push(`background-color: ${p.bg}`);
    if (!d.length) return '';
    let css = `${S} ${x.sel} { ${d.map(v => `${v} !important`).join('; ')}; }`;
    // 글 칸 말고는 제 크기만(테마가 버튼 묶음에 폭 100% · flex 1 을 걸어 둬 글 칸이 좁아졌음)
    if (p.place && /^inline/.test(x.display || '')) css += `\n${S} ${x.sel} { display: block !important; }`;
    // 한 줄: 테마가 안쪽 칸 순서(order)와 위 여백을 바꿔 둬서 '입력 칸 · 왼쪽 아이콘 · 오른쪽 아이콘'처럼 놓였음 → 원래 차례대로, 위아래 여백 없이(:where 로 약하게 걸어 사용자가 고른 순서는 그대로)
    if (dir === 'row') css += `\n${S} ${x.sel} > :where(*) { order: 0 !important; margin-top: 0 !important; margin-bottom: 0 !important; }`;
    if (dir === 'row') css += `\n${S} ${x.sel} > :not(textarea, input, [contenteditable="true"]) { flex: 0 1 auto !important; width: auto !important; min-width: 0 !important; }\n${S} ${x.sel} > :is(textarea, input, [contenteditable="true"]) { flex: 1 1 0 !important; width: auto !important; }`;
    // 안쪽 글이 따로 크기를 갖고 있으면 칸의 글자 크기를 바꿔도 그대로라, 아이콘을 뺀 안쪽 글은 이 칸 크기를 따르게
    if (p.fontSize != null) css += `\n${S} ${x.sel} *${ICONS} { font-size: inherit !important; }`;
    return css;
}
const SIDE = { pt: '위 공간(안)', pr: '오른쪽 공간(안)', pb: '아래 공간(안)', pl: '왼쪽 공간(안)', mt: '위 공간', mr: '오른쪽 공간', mb: '아래 공간', ml: '왼쪽 공간' };
const SIDE_PLAIN = { t: '위', r: '오른쪽', b: '아래', l: '왼쪽' };
const WORD = { place: { left: '왼쪽에 놓기', center: '가운데 놓기', right: '오른쪽에 놓기' }, dir: { row: '안에 있는 것 한 줄로', col: '안에 있는 것 세로로', wrap: '안에 있는 것 줄바꿈' } };
const PROP_TEXT = (p) => Object.entries(p).filter(([k]) => k !== 'fit').map(([k, v]) => (WORD[k]?.[v] || (k === 'wrap' ? '넘치면 다음 줄로' : k === 'unclip' ? '잘린 내용 보이기' : k === 'oneLine' ? '한 줄로 놓기' : k === 'unfloat' ? '겹치지 않게 놓기' : k === 'minH' ? `최소 높이 ${v}px` : k === 'stack' ? '세로로 쌓기' : k === 'order' ? `순서 ${v}` : k === 'color' ? `글자색 ${v}` : k === 'bg' ? (v === 'none' ? '바탕 없앰' : `바탕색 ${v}`) : `${SIDE[k] || PROPS[k]?.label || k} ${v === 'auto' ? '자동' : `${v}${SIDE[k] ? 'px' : PROPS[k]?.unit || ''}`}`))).join(' · ');

// ── 고른 칸 이름 · 셀렉터
const SKIP = new Set(['HTML', 'BODY']);
// 메시지마다 붙었다 떨어지는 표시(생각 있음 · 마지막 메시지 등)가 셀렉터에 들어가면 그 표시 없는 메시지엔 안 걸렸음
const STATE = /^(open|closed|opened|active|selected|hover|focus|focused|visible|hidden|show|shown|interactable|etk-|ui-|fa-|flex|wide|margin|padding|justify|align)|^(reasoning|last_mes|lastInContext|editing|expanded|collapsed)$/i;
// 고유 이름(id)이 있는 칸은 그 칸 하나만. '같은 모양 칸 모두'를 고르면(mode.group) 이름을 빼고 모양(태그 · 클래스)으로 잡아 메뉴 줄 전체 같은 곳에 걸림
function selectorFor(el, noId) {
    if (!noId && !(mode?.group && mode.group === el) && el.id && !/^\d/.test(el.id)) return `#${CSS.escape(el.id)}`;
    const useful = (e) => [...e.classList].filter(c => !STATE.test(c) && !/\d{3,}/.test(c)).slice(0, 3);
    let self = el.tagName.toLowerCase() + useful(el).map(c => `.${CSS.escape(c)}`).join('');
    // 글의 종류를 나타내는 칸(대사 q · 문단 p · 강조 em 등)은 어느 칸 안에 있든 메시지의 같은 종류 전부에: 번역 원문 칸 안 대사를 고르면 원문 칸 안 대사에만 걸렸음
    const textTag = /^(Q|P|EM|STRONG|B|I|U|SPAN|A|LI|H[1-6]|BLOCKQUOTE|CODE)$/.test(el.tagName) && el.closest('#chat .mes');
    if (!useful(el).length && !textTag) {
        for (let a = el.parentElement, i = 0; a && a !== document.body && i < 3 && !a.id; a = a.parentElement, i++) {
            const c = useful(a);
            if (c.length) { self = `${a.tagName.toLowerCase()}.${CSS.escape(c[0])} ${self}`; break; }
        }
    }
    // 홈 화면 최근 채팅 카드도 #chat 안에 그려져, 메시지에서 고른 칸(프로필 사진 등)이 홈 화면 카드에도 걸렸음 → 메시지 안이면 .mes 안으로 좁힘
    if (el.closest('#chat .mes') && !el.classList.contains('mes') && !/(^|\s|\.)mes(\s|$|\.)/.test(self)) self = `.mes ${self}`;
    const anc = el.parentElement?.closest('[id]');
    return anc && anc !== document.body && !/^\d/.test(anc.id) ? `#${CSS.escape(anc.id)} ${self}` : self;
}
// 코드 이름만 뜨면 무엇인지 알기 어려워, 실리태번의 흔한 칸은 우리말 이름을 붙임(위에서부터 처음 맞는 것)
const NAMES = [
    ['.mes_reasoning_header, .mes_reasoning_header_block, .mes_reasoning_summary', '추론 머리'],
    ['.mes_reasoning_details, .mes_reasoning', '추론'],
    ['.mes .avatar img', '프로필 사진'],
    ['.mes .avatar', '프로필 사진 틀'],
    ['.mesAvatarWrapper', '프로필 사진 묶음'],
    ['.mes_buttons, .extraMesButtons, .mes_button', '메시지 버튼'],
    ['.mes_timer, .tokenCounterDisplay', '시간 · 토큰 수'],
    ['.mes .ch_name, .mes .name_text', '메시지 이름'],
    ['.mes .timestamp', '메시지 날짜'],
    ['.mes .mesIDDisplay', '메시지 번호'],
    ['.mes_text', '메시지 글'],
    ['.mes_block', '메시지 안쪽'],
    ['.mes', '메시지'],
    ['#chat', '채팅 목록'],
    ['#completion_prompt_manager_list', '프롬프트 목록'],
    ['#completion_prompt_manager', '프롬프트 관리'],
    ['#sheld', '채팅 화면'],
    ['#top-bar, #top-settings-holder', '맨 위 아이콘 줄'],
    ['#right-nav-panel-tabs', '캐릭터 이름 줄'],
    ['#rm_PinAndTabs', '캐릭터 위쪽 줄'],
    ['#top-settings-holder > .drawer, .drawer-toggle, .drawer-icon', '위쪽 아이콘'],
    ['#left-nav-panel', '왼쪽 패널'],
    ['#right-nav-panel', '오른쪽 패널'],
    ['.drawer-content', '설정 패널'],
    ['#send_form, #send_textarea', '입력창'],
    ['#bg1, #bg_custom', '배경'],
    ['iframe', '상태창 · 꾸밈'],
    ['#chat q', '대사'],
    ['p', '문단'],
    ['h1, h2, h3, h4, h5, h6', '제목'],
    ['button, .menu_button', '버튼'],
    ['input, textarea, select', '입력란'],
    ['img', '그림'],
];
const knownName = (el) => NAMES.find(([sel]) => { try { return el.matches(sel); } catch { return false; } })?.[1];
function describe(el) {
    const r = el.getBoundingClientRect();
    const useful = [...el.classList].find(c => !STATE.test(c));
    const code = el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${useful ? `.${useful}` : ''}`;
    return `${knownName(el) || '부분'} · ${code} (${Math.round(r.width)}×${Math.round(r.height)})`;
}

function styleEntry(el, create) {
    const sel = selectorFor(el), tt = themeOpt(create);
    if (!create) return (tt.styles || []).find(x => x.sel === sel);
    tt.styles ??= [];
    let x = tt.styles.find(y => y.sel === sel);
    if (!x) { x = wireStyle({ sel, label: describe(el), dev: {} }); if (/^(IMG|VIDEO|CANVAS|SVG)$/i.test(el.tagName)) x.img = true; tt.styles.push(x); }
    x.at = Date.now(); // 고친 항목 목록의 '최근 고친 순'
    return x;
}

// ── 화면 위 막대 · 고르기 · 조절 칸
let mode = null;   // { bar, box, card, list, el, picking, undo: [], raf }
const ours = (el) => el instanceof Element && !!el.closest('.etk-tf-bar, .etk-tf-card, .etk-tf-list, .etk-tf-box, .etk-tf-zap');
const snapshot = () => JSON.stringify({ screen: opts().screen, share: opts().share, themes: opts().themes, hideAll: opts().hideAll || [] });
function remember() { if (!mode) return; const snap = snapshot(); if (mode.undo[mode.undo.length - 1] === snap) return; mode.undo.push(snap); mode.redo = []; if (mode.undo.length > 200) mode.undo.shift(); paintBar(); }
const commit = () => { api.save(); refresh(); };
// 실리태번은 열린 패널 밖을 누르면(mousedown · touchstart) 패널을 닫아서, 막대 · 조절 칸을 만지면 맞추던 패널이 닫혔음 → 우리 칸에서 시작한 누름은 위로 안 올려 보냄
// 누름 뒤 click 도 막음: 실리태번 메뉴(작가 노트 · 새 채팅…)는 바깥 click 에 닫혀서, 메뉴를 열어 둔 채 '고르기'를 누르면 메뉴가 닫혀 고를 수 없었음
const PRESS = ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click'];
const keepPanels = (el) => { for (const t of PRESS) el.addEventListener(t, e => e.stopPropagation()); return el; };

// 막대 · 조절 칸 바탕: 테마 바탕색(--SmartThemeBlurTintColor)이 반투명인 테마는 뒤 글자가 비쳐 읽기 어려웠음 → 같은 색을 불투명하게
function solidTint() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeBlurTintColor').trim();
    const m = v.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/);
    if (!m) return '';
    return `rgb(${m[1]}, ${m[2]}, ${m[3]})`;
}
const paintTint = () => { const bg = solidTint(); for (const el of [mode?.bar, mode?.card, mode?.list, mode?.area, mode?.zapChip]) if (el) el.style.setProperty('--tf-bg', bg || ''); };
// 표시 상자 · 여백 띠 · 안내선 자리: 요소의 style 속성을 바꾸면 한 번에 16~25ms(화면 전체 스타일 다시 계산)라 끌 때 끊겼음 → 우리만 쓰는 스타일 규칙의 값을 바꿈(약 2ms)
let uiSheet = null;
const UI_RULES = ['.etk-tf-box', ...['mt', 'mr', 'mb', 'ml', 'pt', 'pr', 'pb', 'pl'].map(k => `.etk-tf-box .etk-tf-band[data-k="${k}"]`), '.etk-tf-guide-x', '.etk-tf-guide-y'];
function ui(i) {
    if (!uiSheet?.isConnected) {
        uiSheet = Object.assign(document.createElement('style'), { id: 'etk-theme-fit-ui' });
        uiSheet.textContent = UI_RULES.map(r => `${r} { }`).join('\n');
        document.head.append(uiSheet);
    }
    return uiSheet.sheet.cssRules[typeof i === 'number' ? i : UI_RULES.indexOf(i)].style;
}
const setRule = (st, obj) => { for (const [k, v] of Object.entries(obj)) st.setProperty(k, v, 'important'); };
function outline(el) {
    const box = mode?.box;
    if (!box) return;
    if (!el || !el.isConnected) { box.classList.remove('etk-show'); return; }
    const r = mode.previewRect || el.getBoundingClientRect();   // 큰 칸을 끄는 동안엔 놓을 자리만 그림
    // 열어 두고 가만히 있을 때 매 프레임 칸의 여백까지 다시 읽었음 → 자리 · 크기 · 상태가 그대로면 건너뜀(값을 바꾸면 refresh · live 가 _key 를 비움)
    const key = `${r.left},${r.top},${r.width},${r.height},${!!mode.picking},${!!mode.peek},${!!mode.card},${el === mode.el}`;
    if (box._el === el && box._key === key) return;
    box._key = key;
    if (!mode.dragging) dodgeBar(el === mode.el && !mode.picking ? r : null);
    // 읽기를 먼저 다 하고 쓰기를 한 번에: 규칙을 바꾼 뒤 칸의 여백을 읽으면 그때마다 스타일을 다시 계산해서 한 프레임에 여러 번 계산했음
    const cs = getComputedStyle(el), num = (v) => Math.round(parseFloat(v) || 0);
    const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(num), mar = [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(num);
    const barB = mode.bar?.getBoundingClientRect();
    const edit = !mode.picking && !mode.peek && !!mode.card && el === mode.el;
    if (box._el !== el) { box._el = el; box.dataset.name = mode?.zap && mode.picking ? `숨기기: ${hideName(el)}` : knownName(el) || '이 부분'; }
    box.classList.toggle('etk-hover', !!mode.picking);
    box.classList.toggle('etk-edit', edit);
    box.classList.add('etk-show');
    // 칸이 위쪽 막대 가까이 있으면 이름표가 막대에 가려져서 칸 안쪽 위에 붙임
    box.classList.toggle('etk-tag-in', r.top - 34 < (barB && barB.top < innerHeight / 2 ? barB.bottom : 0));
    const px = (v) => `${Math.max(0, v)}px`, P = pad.map(px), M = mar.map(px);
    setRule(ui(0), { transform: `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px)`, width: `${Math.round(r.width)}px`, height: `${Math.round(r.height)}px`,
        '--tf-pad': P.join(' '), '--tf-mar': M.join(' '), '--tf-mar-t': `-${M[0]}`, '--tf-mar-r': `-${M[1]}`, '--tf-mar-b': `-${M[2]}`, '--tf-mar-l': `-${M[3]}` });
    // 여백 띠: 두께가 바뀐 때만 씀
    const bandKey = edit ? `${pad},${mar}` : '';
    if (edit && box._bands !== bandKey) {
        box._bands = bandKey;
        const min = matchMedia('(pointer: coarse)').matches ? 14 : 8, n = (v) => `${Math.max(min, v)}px`;
        const B = (k) => ui(`.etk-tf-box .etk-tf-band[data-k="${k}"]`);
        setRule(B('pt'), { top: '0', left: '0', right: '0', height: n(pad[0]) });
        setRule(B('pb'), { bottom: '0', left: '0', right: '0', height: n(pad[2]) });
        setRule(B('pl'), { top: '0', bottom: '0', left: '0', width: n(pad[3]) });
        setRule(B('pr'), { top: '0', bottom: '0', right: '0', width: n(pad[1]) });
        setRule(B('mt'), { bottom: '100%', left: '0', right: '0', height: n(mar[0]) });
        setRule(B('mb'), { top: '100%', left: '0', right: '0', height: n(mar[2]) });
        setRule(B('ml'), { top: '0', bottom: '0', right: '100%', width: n(mar[3]) });
        setRule(B('mr'), { top: '0', bottom: '0', left: '100%', width: n(mar[1]) });
    }
}
// 숫자 대신 화면에서 바로: 고른 칸을 끌어 옮기고(가로 · 세로 위치), 가장자리를 끌어 크기를 바꿈(폭 · 높이). 끄는 동안 바로 보이고 놓으면 저장
// 자석: 옮길 때 붙을 선(감싸는 칸 안쪽의 왼쪽 · 가운데 · 오른쪽 · 위 · 아래, 옆 칸들의 가장자리 · 가운데)
function snapLines(el) {
    const x = [], y = [];
    let par = el.parentElement;
    while (par && par !== document.body && getComputedStyle(par).display === 'contents') par = par.parentElement;
    if (par && par !== document.body) {
        const q = par.getBoundingClientRect(), pc = getComputedStyle(par), n = (v) => parseFloat(v) || 0;
        const L = q.left + n(pc.borderLeftWidth) + n(pc.paddingLeft), R = q.right - n(pc.borderRightWidth) - n(pc.paddingRight);
        const T = q.top + n(pc.borderTopWidth) + n(pc.paddingTop), B = q.bottom - n(pc.borderBottomWidth) - n(pc.paddingBottom);
        x.push(L, (L + R) / 2, R); y.push(T, (T + B) / 2, B);
        for (const k of kidsOf(par).slice(0, 40)) {
            if (k === el || k.contains(el) || el.contains(k)) continue;
            const r = k.getBoundingClientRect();
            if (r.bottom < 0 || r.top > innerHeight) continue;
            x.push(r.left, r.left + r.width / 2, r.right); y.push(r.top, r.top + r.height / 2, r.bottom);
        }
    }
    return { x, y };
}
// 붙은 자리에 가는 안내선(가로 · 세로 한 줄씩)
function guides(x, y) {
    for (const [k, v] of [['x', x], ['y', y]]) {
        let g = document.querySelector(`.etk-tf-guide-${k}`);
        if (v == null) { g?.remove(); continue; }
        if (!g) { g = Object.assign(document.createElement('div'), { className: `etk-tf-guide etk-tf-guide-${k}` }); document.body.append(g); }
        setRule(ui(`.etk-tf-guide-${k}`), { transform: k === 'x' ? `translateX(${Math.round(v)}px)` : `translateY(${Math.round(v)}px)` });
    }
}
// 최소 높이에 묶인 부분: 위아래 안쪽 여백을 줄여도 테마 · 확장이 정한 최소 높이(min-height, 테두리 포함 계산) 때문에 키가 그대로였음 → 줄인 만큼 최소 높이도 같이 낮춤
function minBase(el, x) {
    if (x.base) return;
    const cs = getComputedStyle(el), mh = parseFloat(cs.minHeight);
    if (!(mh > 0) || cs.boxSizing !== 'border-box') return;
    x.base = { minH: Math.round(mh), pt: Math.round(parseFloat(cs.paddingTop) || 0), pb: Math.round(parseFloat(cs.paddingBottom) || 0) };
}
function fitMinH(x) {
    const b = x.base, p = x.props;
    if (!b || p.height != null) return;
    const v = b.minH - (b.pt - (p.pt ?? b.pt)) - (b.pb - (p.pb ?? b.pb));
    if (v >= b.minH) delete p.minH; else p.minH = Math.max(0, Math.round(v));
}
function wireHandles(box) {
    const drag = (h, onMove, onUp) => h.addEventListener('pointerdown', (e) => {
        const el = mode?.el;
        if (!el) return;
        e.preventDefault(); e.stopPropagation();
        remember();
        const x0 = e.clientX, y0 = e.clientY, entry = styleEntry(el, true), p = entry.props, r = el.getBoundingClientRect(), start = { ...p, w: r.width, h: r.height, rect: r };
        h.setPointerCapture(e.pointerId);
        mode.dragging = true;
        // 마우스 · 손가락 신호가 한 프레임에 여러 번 와도 마지막 것만 계산(화면 주사율 · 입력 빈도가 높을수록 일이 몇 배로 늘었음)
        let last = null, raf = 0;
        // 채팅 화면처럼 큰 칸은 끄는 동안 실제로 바꾸면 긴 채팅 전체를 프레임마다 다시 배치해 뚝뚝 끊겼음 → 끄는 동안엔 선택 상자만 놓일 자리로 옮기고, 놓을 때 한 번 바꿈
        // 설정 패널처럼 안에 칸이 많은 칸도 같은 이유로 끊겨서, 화면의 1/5 넘게 차지하거나 안쪽 칸이 300개 넘으면 같은 방식으로
        const big = el.matches('#sheld, #chat') || r.width * r.height > innerWidth * innerHeight * 0.2 || el.getElementsByTagName('*').length > 300;
        const step = () => {
            raf = 0; const ev = last; if (!ev) return; last = null;
            const dx = ev.clientX - x0, dy = ev.clientY - y0;
            onMove(p, start, dx, dy, el, ev);
            if (big) { const q = start.preview || start.want || { left: r.left + dx, top: r.top + dy, width: r.width, height: r.height }; mode.previewRect = q; box._key = null; outline(el); return; }
            if (start.ghost) live(start.target, { sel: '', props: start.ghost }); else live(el, entry);
        };
        const mv = (ev) => { last = ev; raf ||= requestAnimationFrame(step); };
        const up = () => {
            h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
            if (raf) { cancelAnimationFrame(raf); step(); }
            mode.dragging = false; mode.previewRect = null; box._el = null; guides(null); onUp?.(p, start, el); tidy(); commit(); liveEnd(); start.after?.(); landAt(el, p, start); paintBar();
            // 옮기거나 키운 칸이 조절 칸 밑으로 들어가면 손잡이(칸 밖으로 조금 나와 있음)를 못 잡아서, 덮으면 옆으로 비켜 줌
            if (mode.card && mode.el === el) { drawCard(mode.card, el); if (covers(mode.card, el, 16)) { const c = mode.card.getBoundingClientRect(); placeBeside(mode.card, el, c.left, c.top); } }
        };
        h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    // 놓은 뒤 실제 자리를 재서 끈 자리(want)와 다르면 위치로 맞춤: 테마가 칸을 화면 한쪽에 붙여 두거나(position fixed · left/right) 여백을 !important 로 막아 두면
    // 여백으로 옮겨도 안 움직이고, 폭을 늘리면 반대쪽으로 늘어났음
    const landAt = (el, p, s) => {
        const w = s.want;
        if (!w || !el.isConnected) return;
        const off = () => { const q = el.getBoundingClientRect(); return [Math.round(w.left - q.left), Math.round(w.top - q.top)]; };
        let [ox, oy] = off();
        if (Math.abs(ox) <= 1 && Math.abs(oy) <= 1) return;
        // 여백으로 옮겼는데 안 간 경우: 그 여백은 하는 일이 없으니 되돌리고 위치만으로
        if (s.kind === 'margin') { for (const k of ['mt', 'ml', 'mr']) { if (s[k] == null) delete p[k]; else p[k] = s[k]; } refresh(); [ox, oy] = off(); }
        if (Math.abs(ox) > 1) p.moveX = Math.round((p.moveX || 0) + ox);
        if (Math.abs(oy) > 1) p.moveY = Math.round((p.moveY || 0) + oy);
        tidy(); commit();
    };
    // 채팅 화면의 왼쪽 · 오른쪽 가장자리: 끄는 쪽 가장자리가 포인터를 따라가고 반대쪽은 그대로(폭은 채팅 폭으로, 어긋난 만큼 가로 위치로)
    const chatEdge = (s, dx, left) => {
        const sh = document.getElementById('sheld'), r0 = s.r0 ??= sh.getBoundingClientRect();
        // 화면 밖으로는 안 나가게(끄는 쪽 가장자리는 화면 끝까지)
        const w = Math.max(innerWidth * 0.25, Math.min(left ? r0.right : innerWidth - r0.left, r0.width + (left ? -dx : dx)));
        const want = left ? { left: r0.right - w, right: r0.right } : { left: r0.left, right: r0.left + w };
        s.preview = { left: want.left, top: r0.top, width: w, height: r0.height };
        box.dataset.name = `채팅 폭 ${Math.round(w)}px`;
        s.after = () => {
            setScreen('chat', Math.round(w / innerWidth * 1000) / 10); refresh();
            const e2 = styleEntry(sh, true), now = sh.getBoundingClientRect(), off = Math.round(want.left - now.left);
            if (Math.abs(off) > 1) { e2.props.moveX = Math.round((e2.props.moveX || 0) + off); }
            tidy(); commit();
        };
    };
    const CSSK = { pt: 'paddingTop', pr: 'paddingRight', pb: 'paddingBottom', pl: 'paddingLeft', mt: 'marginTop', mr: 'marginRight', mb: 'marginBottom', ml: 'marginLeft' };
    const SIGN = { pt: [0, 1], pb: [0, -1], pl: [1, 0], pr: [-1, 0], mt: [0, -1], mb: [0, 1], ml: [-1, 0], mr: [1, 0] };
    for (const band of box.querySelectorAll('.etk-tf-band')) {
        const k = band.dataset.k;
        drag(band, (p, s, dx, dy, el) => {
            // 채팅 화면의 왼쪽 · 오른쪽 가장자리: 여백 대신 채팅 폭을 바꿈(채팅 칸을 화면 오른쪽에 붙여 두는 테마는 바깥 여백을 바꿔도 칸이 안 넓어졌음 —
            // 끄는 쪽으로 넓어지게, 왼쪽을 왼쪽으로 끌면 넓어지고 오른쪽을 오른쪽으로 끌면 넓어짐)
            if ((k === 'ml' || k === 'mr' || k === 'pl' || k === 'pr') && wideKey(el) === 'chat') { chatEdge(s, dx, k[1] === 'l'); return; }
            if (k === 'pt' || k === 'pb') minBase(el, styleEntry(el, true));
            s[k + '0'] ??= Math.round(parseFloat(getComputedStyle(el)[CSSK[k]]) || 0);
            let v = Math.round(s[k + '0'] + dx * SIGN[k][0] + dy * SIGN[k][1]);
            if (k[0] === 'p') v = Math.max(0, v);
            p[k] = v;
            if (k === 'pt' || k === 'pb') fitMinH(styleEntry(el, true));
            box.dataset.name = `${SIDE_PLAIN[k[1]]} 공간 ${v}px`;
        });
    }
    // 옮기기: 나란히 놓인 칸(감싼 칸이 flex · grid) 사이에선 순서를 바꾸고(놓일 자리에 선), 그 밖에선 바깥 여백으로 밀며 옮김(원래 자리가 비지 않고 다른 칸이 따라 밀림).
    // 보이는 자리만 옮기는 방식(translate)은 원래 자리가 비고 감싼 칸은 그대로라 따로 놀았음 → Alt 를 누른 채 끌 때만(겹쳐 놓기)
    drag(box.querySelector('.etk-tf-hmove'), (p, s, dx, dy, el, ev) => {
        if (!s.kind) {
            // 떠 있는 칸(설정 패널처럼 position fixed · absolute)은 차례가 없어서 순서 바꾸기 · 여백으로는 안 움직였음 → 위치로 옮김
            const pos = getComputedStyle(el).position;
            s.kind = ev?.altKey || opts().freeMove || pos === 'fixed' || pos === 'absolute' ? 'free' : 'margin';
            // 옆에 보이는 칸이 없으면(아이콘을 골랐는데 그걸 감싼 칸에 그것뿐인 경우 등) 한 칸씩 바깥으로 올라가 옆 칸이 있는 곳에서 순서를 바꿈
            const shown = (k) => { const q = k.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(k).visibility !== 'hidden'; };
            let t = el, par = null, pc = null, sibs = [];
            for (let i = 0; i < 4 && t && s.kind !== 'free'; i++) {
                par = t.parentElement;
                while (par && par !== document.body && getComputedStyle(par).display === 'contents') par = par.parentElement;
                if (!par || par === document.body) break;
                pc = getComputedStyle(par);
                sibs = [...par.children].filter(k => k !== t && shown(k) && !k.closest('.etk-tf-bar, .etk-tf-card, .etk-tf-list, .etk-tf-box'));
                if (sibs.length) break;
                t = par;
            }
            if (s.kind !== 'free' && sibs.length && isFlex(pc)) {
                s.target = t; s.rect = t.getBoundingClientRect();
                s.kind = 'order'; s.row = /grid/.test(pc.display) ? false : !/column/.test(pc.flexDirection);
                const c = (r) => (s.row ? r.left + r.width / 2 : r.top + r.height / 2);
                s.sibs = sibs.map(k => ({ k, r: k.getBoundingClientRect() })).sort((a, b) => c(a.r) - c(b.r));
                s.from = s.sibs.filter(({ r }) => c(r) < c(s.rect)).length;
            }
            const cs = getComputedStyle(el);
            s.m0 = { mt: parseFloat(cs.marginTop) || 0, ml: parseFloat(cs.marginLeft) || 0, mr: parseFloat(cs.marginRight) || 0 };
        }
        if (s.kind === 'order') {
            // 순서: 잡은 칸은 손가락을 따라 보이기만 하고, 놓일 자리(옆 칸들 사이)에 선
            const at = s.row ? s.rect.left + s.rect.width / 2 + dx : s.rect.top + s.rect.height / 2 + dy;
            const before = s.sibs.filter(({ r }) => (s.row ? r.left + r.width / 2 : r.top + r.height / 2) < at);
            s.index = before.length;
            const prev = before[before.length - 1]?.r, next = s.sibs[before.length]?.r;
            const line = s.row ? (prev && next ? (prev.right + next.left) / 2 : prev ? prev.right + 2 : next.left - 2) : (prev && next ? (prev.bottom + next.top) / 2 : prev ? prev.bottom + 2 : next.top - 2);
            if (s.row) guides(line, null); else guides(null, line);
            s.ghost = { moveX: Math.round((p.moveX || 0) + dx), moveY: Math.round((p.moveY || 0) + dy) }; s.dd = [dx, dy];
            return;
        }
        let sx = null, sy = null;
        if (!opts().noSnap && !ev?.altKey) {
            s.snap ??= snapLines(el);
            const r = s.rect, hit = (edges, lines) => { let best = null; for (const a of edges) for (const b of lines) { const d = b - a; if (Math.abs(d) <= 6 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: b }; } return best; };
            const bx = hit([r.left + dx, r.left + r.width / 2 + dx, r.right + dx], s.snap.x), by = hit([r.top + dy, r.top + r.height / 2 + dy, r.bottom + dy], s.snap.y);
            if (bx) { dx += bx.d; sx = bx.at; }
            if (by) { dy += by.d; sy = by.at; }
        }
        guides(sx, sy);
        s.want = { left: s.rect.left + dx, top: s.rect.top + dy, width: s.rect.width, height: s.rect.height };
        if (s.kind === 'free') { p.moveX = Math.round((s.moveX || 0) + dx); p.moveY = Math.round((s.moveY || 0) + dy); return; }
        // 여백으로: 아래로 끌면 위 여백이 늘고, 옆으로 끌면 왼쪽 여백을 늘린 만큼 오른쪽을 줄여 폭은 그대로
        if (Math.round(dy)) p.mt = Math.round(s.m0.mt + dy); else if (s.mt == null) delete p.mt; else p.mt = s.mt;
        if (Math.round(dx)) { p.ml = Math.round(s.m0.ml + dx); p.mr = Math.round(s.m0.mr - dx); }
        else { if (s.ml == null) delete p.ml; else p.ml = s.ml; if (s.mr == null) delete p.mr; else p.mr = s.mr; }
    }, (p, s, el) => {
        if (s.kind !== 'order') return;
        // 옆 칸을 넘지 않고 놓으면 순서는 그대로라 아무 일도 없었음(채팅 목록을 옆으로 끌어도 안 움직임) → 끈 만큼 그 자리로
        if (s.index == null || s.index === s.from) { if (s.dd && (Math.abs(s.dd[0]) > 2 || Math.abs(s.dd[1]) > 2)) { const t = styleEntry(s.target, true).props; t.moveX = Math.round((t.moveX || 0) + s.dd[0]); t.moveY = Math.round((t.moveY || 0) + s.dd[1]); } return; }
        // 옆 칸들이 같은 셀렉터로 묶이면(이름이 같은 칸들) 순서를 따로 줄 수 없어서 그대로 둠
        const sels = [s.target, ...s.sibs.map(x => x.k)].map(x => selectorFor(x));
        if (new Set(sels).size !== sels.length) return;
        // 화면에 보이는 차례대로 번호를 다시 매기고 잡은 칸을 놓인 자리에 끼움(order 10 · 20 · 30 …)
        const list = s.sibs.map(x => x.k);
        list.splice(s.index, 0, s.target);
        list.forEach((x, n) => { styleEntry(x, true).props.order = n * 10; });
    });
    // 폭 · 높이: 끄는 오른쪽 · 아래 가장자리만 따라오고 왼쪽 · 위는 그대로(오른쪽에 붙은 칸은 폭을 늘리면 왼쪽으로 늘어났음 → 놓을 때 위치로 맞춤)
    drag(box.querySelector('.etk-tf-hw'), (p, s, dx, dy, el) => {
        if (wideKey(el) === 'chat') { chatEdge(s, dx, false); return; }
        p.width = Math.max(8, Math.round(s.w + dx));
        s.want = { left: s.rect.left, top: s.rect.top, width: p.width, height: s.h };
    });
    drag(box.querySelector('.etk-tf-hh'), (p, s, dx, dy, el) => {
        if (/^(IMG|VIDEO|CANVAS)$/i.test(el.tagName)) { p.width = Math.max(8, Math.round(s.w + dy * (s.w / Math.max(1, s.h)))); s.want = { left: s.rect.left, top: s.rect.top, width: p.width, height: s.h * p.width / Math.max(1, s.w) }; }
        else { p.height = Math.max(4, Math.round(s.h + dy)); s.want = { left: s.rect.left, top: s.rect.top, width: s.w, height: p.height }; }
    });
}
// 막대 자리: 화면 밖으로는 안 나가게
function placeBar(x, y, r) {
    const bar = mode?.bar; if (!bar) return;
    Object.assign(bar.style, { left: `${Math.max(0, Math.min(x, innerWidth - r.width))}px`, top: `${Math.max(0, Math.min(y, innerHeight - r.height))}px`, bottom: 'auto', transform: 'none' });
    bar.classList.remove('etk-tf-bar-dodge');
}
const BAR_KEY = 'breeze.themeFitBar';
function barPos(v) {
    try {
        const all = JSON.parse(localStorage.getItem(BAR_KEY) || '{}');
        if (v === undefined) return all[dev()] || null;
        all[dev()] = v; localStorage.setItem(BAR_KEY, JSON.stringify(all));
    } catch { /* 저장 못 해도 이번엔 그 자리 */ }
    return null;
}
// 고른 칸(과 바깥으로 조금 나온 손잡이)을 막대가 덮으면 손잡이를 못 잡아서(입력창은 막대 바로 밑이라 옮기기 손잡이가 가려졌음), 막대를 화면 반대쪽 끝으로 잠시 비킴
function dodgeBar(r) {
    const bar = mode?.bar; if (!bar || mode.barDragging) return;
    const was = bar.classList.contains('etk-tf-bar-dodge');
    if (was) bar.classList.remove('etk-tf-bar-dodge');
    const b = bar.getBoundingClientRect(), pad = 26;
    const hit = r && b.left < r.right + pad && b.right > r.left - pad && b.top < r.bottom + pad && b.bottom > r.top - pad;
    if (!hit) return;
    const up = r.top + r.height / 2 > innerHeight / 2;   // 칸이 화면 아래쪽이면 막대를 맨 위로, 위쪽이면 맨 아래로
    bar.classList.add('etk-tf-bar-dodge');
    bar.style.setProperty('--tf-dodge-top', up ? '8px' : `${innerHeight - b.height - 8}px`);
}
function follow() {
    if (!mode) return;
    outline(mode.picking || mode.peek ? mode.hover : mode.el);
    mode.raf = requestAnimationFrame(follow);
}

function paintBar() {
    if (!mode) return;
    const t = themeOpt();
    const n = (opts().hideAll?.length || 0) + (t.fixes?.length || 0) + (t.styles?.filter(x => Object.keys(x.props).length).length || 0) + (t.area?.d != null ? 1 : 0) + (t.area?.av ? 1 : 0) + (t.area?.mg != null ? 1 : 0) + (t.noFont ? 1 : 0) + (t.avatar > 0 ? 1 : 0) + Object.keys(t.scr?.[dev()] || {}).length + SCREEN_KEYS.filter(k => opts().screen[dev()][k]).length;
    mode.bar.querySelector('.etk-tf-count').textContent = String(n);
    mode.bar.querySelector('.etk-tf-undo').classList.toggle('disabled', !mode.undo.length);
    mode.bar.querySelector('.etk-tf-first').classList.toggle('disabled', !mode.undo.length);
    mode.bar.querySelector('.etk-tf-redo').classList.toggle('disabled', !mode.redo.length);
    mode.bar.querySelector('.etk-tf-snapbtn').classList.toggle('etk-on', !opts().noSnap);
    mode.bar.querySelector('.etk-tf-pickbtn').classList.toggle('etk-on', !!mode.picking && !mode.zap);
    // 고르기 버튼은 늘 막대에(고르는 중에만 보이게 했더니, 한 번 그만 고르면 막대에서 다시 고를 수가 없어 테마 맞추기를 닫았다 열어야 했음)
    { const pb = mode.bar.querySelector('.etk-tf-pickbtn'), on = !!mode.picking && !mode.zap; pb.hidden = false; pb.innerHTML = `<i class="fa-solid fa-crosshairs"></i> ${on ? '고르는 중' : '고르기'}`; pb.title = on ? '고르는 중이에요. 누르면 그만 골라요(Esc 도 돼요)' : '화면에서 고칠 곳 고르기'; }
    mode.bar.querySelector('.etk-tf-zapbtn').classList.toggle('etk-on', !!mode.picking && !!mode.zap);
    mode.box.classList.toggle('etk-tf-zapping', !!mode.picking && !!mode.zap);
    mode.bar.querySelector('.etk-tf-areabtn')?.classList.toggle('etk-on', !!mode.area);
    mode.bar.querySelector('.etk-tf-name').textContent = themeName() || '기본 테마';
}

export function openFit() {
    if (!api) return;
    if (mode) { closeFit(); return; }
    document.getElementById('etk_dialog')?.querySelector('.etk-close')?.click();
    const bar = document.createElement('div');
    bar.className = 'etk-tf-bar';
    bar.innerHTML = `
        <span class="etk-tf-title" title="지금 테마에 맞추는 중이에요"><i class="fa-solid fa-wand-magic-sparkles"></i> <b class="etk-tf-name"></b></span>
        <div class="menu_button etk-tf-pickbtn" title="고르는 중이에요. 누르면 그만 골라요(Esc 도 돼요)"><i class="fa-solid fa-crosshairs"></i> 고르는 중</div>
        <div class="menu_button etk-tf-zapbtn" title="숨기기: 켜고 화면에서 누르는 곳마다 바로 숨겨요. 안 쓰는 설정 줄이나 버튼을 치울 때"><i class="fa-solid fa-eye-slash"></i><span class="etk-tf-lbl"> 숨기기</span></div>
        <div class="etk-tf-hist">
            <div class="menu_button etk-tf-first" title="처음으로: 이번에 맞추기를 연 때로 (앞으로로 다시 살릴 수 있어요)"><i class="fa-solid fa-backward-step"></i></div>
            <div class="menu_button etk-tf-undo" title="이전으로 (Cmd+Z)"><i class="fa-solid fa-rotate-left"></i></div>
            <div class="menu_button etk-tf-redo" title="앞으로 (Cmd+Shift+Z)"><i class="fa-solid fa-rotate-right"></i></div>
        </div>
        <div class="menu_button etk-tf-snapbtn" title="자석: 켜면 옮길 때 가운데 · 가장자리에 착 붙어요. 끄면 자유롭게(PC는 Alt 를 누른 채 끄는 동안만 자유롭게)"><i class="fa-solid fa-magnet"></i></div>
        <div class="menu_button etk-tf-peekbtn" title="누르고 있는 동안 맞춤을 끄고 원래 테마로 보여요"><i class="fa-solid fa-eye"></i></div>
        <div class="menu_button etk-tf-areabtn" title="레이아웃: 목록 줄 간격 · 사진 크기처럼 결과만 고르면 테마에 맞춰 바꿔요"><i class="fa-solid fa-table-columns"></i><span class="etk-tf-lbl"> 레이아웃</span></div>
        <div class="menu_button etk-tf-listbtn" title="이 테마에서 고친 것"><i class="fa-solid fa-list"></i> <span class="etk-tf-count">0</span></div>
        <div class="menu_button etk-tf-end" title="맞추기 끝">끝</div>`;
    const box = Object.assign(document.createElement('div'), { className: 'etk-tf-box' });
    box.innerHTML = '<div class="etk-tf-mar"></div><div class="etk-tf-pad"></div>' + ['mt', 'mr', 'mb', 'ml', 'pt', 'pr', 'pb', 'pl'].map(k => `<div class="etk-tf-band etk-tf-band-${k[0]}" data-k="${k}" title="끌어서 ${SIDE_PLAIN[k[1]]} 공간 바꾸기"></div>`).join('') + '<div class="etk-tf-h etk-tf-hmove" title="끌어서 옮기기 (나란히 놓인 것들 사이에선 순서가 바뀌어요 · 겹쳐 놓기를 켜거나 Alt 를 누른 채 끌면 다른 것 위로 자유롭게)"><i class="fa-solid fa-up-down-left-right"></i></div><div class="etk-tf-h etk-tf-hw" title="끌어서 폭 바꾸기"></div><div class="etk-tf-h etk-tf-hh" title="끌어서 높이 바꾸기"></div>';
    document.body.append(keepPanels(box), keepPanels(bar));
    wireHandles(box);
    mode = { bar, box, card: null, list: null, el: null, hover: null, picking: false, undo: [], redo: [], start: snapshot(), raf: 0 };
    bar.querySelector('.etk-tf-pickbtn').addEventListener('click', () => (mode.picking && !mode.zap ? stopPicking() : startPicking()));
    bar.querySelector('.etk-tf-zapbtn').addEventListener('click', () => (mode.picking && mode.zap ? stopPicking() : startPicking(true)));
    bar.querySelector('.etk-tf-undo').addEventListener('click', undo);
    bar.querySelector('.etk-tf-redo').addEventListener('click', redo);
    bar.querySelector('.etk-tf-first').addEventListener('click', toFirst);
    bar.querySelector('.etk-tf-snapbtn').addEventListener('click', () => { opts().noSnap = !opts().noSnap; commit(); paintBar(); });
    bar.querySelector('.etk-tf-listbtn').addEventListener('click', toggleList);
    bar.querySelector('.etk-tf-areabtn').addEventListener('click', toggleArea);
    bar.querySelector('.etk-tf-end').addEventListener('click', closeFit);
    // 누르고 있는 동안만 맞춤을 끔(손을 떼면 다시)
    const peekBtn = bar.querySelector('.etk-tf-peekbtn');
    const peekOn = (e) => { e.preventDefault(); setMedia('not all'); mode.box.style.visibility = 'hidden'; peekBtn.classList.add('etk-on'); };
    const peekOff = () => { setMedia(''); if (mode) mode.box.style.visibility = ''; peekBtn.classList.remove('etk-on'); };
    peekBtn.addEventListener('pointerdown', peekOn);
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) peekBtn.addEventListener(t, peekOff);
    // 막대가 고치려는 곳을 덮으면 이름 부분을 잡고 끌어 옮김
    // 막대 옮기기: 버튼이 아닌 곳 아무 데나 잡고 끌기(이름 부분만 잡히게 했더니 옮길 수 있는 줄 몰랐음). 자리는 기기마다 기억
    bar.addEventListener('pointerdown', (e) => {
        if (e.button > 0 || e.target.closest('.menu_button, select, input')) return;
        e.preventDefault();
        const r = bar.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        const mv = (ev) => placeBar(ev.clientX - dx, ev.clientY - dy, r);
        const up = () => { document.removeEventListener('pointermove', mv, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true);
            const q = bar.getBoundingClientRect(); barPos(q.left === r.left && q.top === r.top ? undefined : { x: Math.round(q.left / innerWidth * 1000) / 1000, y: Math.round(q.top / innerHeight * 1000) / 1000 }); };
        document.addEventListener('pointermove', mv, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
    });
    { const saved = barPos(); if (saved) requestAnimationFrame(() => { const r = bar.getBoundingClientRect(); placeBar(saved.x * innerWidth, saved.y * innerHeight, r); }); }
    window.addEventListener('keydown', onKey, true);
    paintBar();
    paintTint();
    follow();
    // 결과만 고르는 레이아웃 창부터 엶. 화면에서 하나씩 고르는 것은 그 창 맨 아래(그걸로 안 되는 곳에만)
    toggleArea();
}
export function closeFit() {
    if (!mode) return;
    stopPicking();
    cancelAnimationFrame(mode.raf);
    window.removeEventListener('keydown', onKey, true);
    mode.bar.remove(); mode.box.remove(); mode.zapChip?.remove(); mode.card?.remove(); mode.list?.remove(); mode.area?.remove(); guides(null); liveEnd(); uiSheet?.remove(); uiSheet = null;
    mode = null;
}
let keyT = 0, keyRemembered = false;
function onKey(e) {
    if (!mode) return;
    // Cmd(Ctrl)+Z 이전으로 · +Shift 앞으로(Ctrl+Y 도). 글 입력 칸 안에선 그 칸의 되돌리기 그대로
    if ((e.metaKey || e.ctrlKey) && !e.altKey && /^[zy]$/i.test(e.key) && !(e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]'))) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo();
        return;
    }
    // 고른 칸을 방향키로 1px(Shift 10px)씩 옮김. 글 입력 칸에 있을 땐 그대로
    if (e.key.startsWith('Arrow') && !mode.picking && mode.card && mode.el && !(e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]'))) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!keyRemembered) { remember(); keyRemembered = true; }
        const ent = styleEntry(mode.el, true), p = ent.props, step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft') p.moveX = (p.moveX || 0) - step;
        if (e.key === 'ArrowRight') p.moveX = (p.moveX || 0) + step;
        if (e.key === 'ArrowUp') p.moveY = (p.moveY || 0) - step;
        if (e.key === 'ArrowDown') p.moveY = (p.moveY || 0) + step;
        live(mode.el, ent);
        clearTimeout(keyT);
        keyT = setTimeout(() => { keyRemembered = false; tidy(); commit(); liveEnd(); paintBar(); if (mode?.card && mode.el) drawCard(mode.card, mode.el); }, 500);
        return;
    }
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (mode.picking) stopPicking(); else if (mode.zapChip) closeZapChip(); else if (mode.card) closeCard(); else closeFit();
}

function startPicking(zap) {
    if (!mode) return;
    closeCard(); mode.list?.remove(); mode.list = null; mode.area?.remove(); mode.area = null;
    if (!zap) closeZapChip();
    mode.picking = true; mode.zap = !!zap; mode.hover = null;
    window.addEventListener('pointerdown', onPickDown, true);
    clearTimeout(swallowT);
    for (const t of SWALLOW) window.addEventListener(t, swallow, { capture: true, passive: false });
    window.addEventListener('pointermove', onPickMove, true);
    mode.bar.querySelector('.etk-tf-title').title = zap ? '숨길 곳을 누르세요 · Esc 로 그만' : '고칠 곳을 누르세요 · Esc 로 그만';
    paintBar();
}
// 고른 바로 그 누름의 손 뗌(mouseup · click)까지 실리태번에 안 가게: 고르자마자 막기를 풀면 그 click 이 들어가 메뉴 항목이 실행됐음 → 잠깐 뒤에 풂
const SWALLOW = ['click', 'mousedown', 'mouseup', 'pointerup', 'touchstart', 'touchend', 'dblclick', 'contextmenu'];
let swallowT = 0;
const unswallow = () => { for (const t of SWALLOW) window.removeEventListener(t, swallow, { capture: true }); };
function stopPicking(soon) {
    if (!mode) return;
    mode.picking = false; mode.zap = false; mode.hover = null;
    window.removeEventListener('pointerdown', onPickDown, true);
    clearTimeout(swallowT);
    if (soon) swallowT = setTimeout(unswallow, 700); else unswallow();
    window.removeEventListener('pointermove', onPickMove, true);
    paintBar();
}
// 테마가 '누를 수 없게'(pointer-events: none) 만든 칸은 브라우저가 건너뛰어서, 그런 칸(커진 프로필 사진 등)을 못 골랐음 → 재는 순간에만 모든 칸을 잡히게
function under(x, y) {
    const html = document.documentElement;
    html.classList.add('etk-tf-hit');
    try { return document.elementsFromPoint(x, y).filter(el => !SKIP.has(el.tagName) && !ours(el)); } finally { html.classList.remove('etk-tf-hit'); }
}
// 칸 사이 공간이 고른 칸이 아니라 안쪽 칸들의 여백에서 생기는 경우(메뉴 줄 등): 어디를 고쳐야 하는지 알려 줌
function spaceHint(el, cs) {
    const own = Math.max(parseFloat(cs.paddingTop) || 0, parseFloat(cs.paddingBottom) || 0, parseFloat(cs.rowGap) || 0, parseFloat(cs.gap) || 0);
    if (own > 2) return null;
    const kids = kidsOf(el);
    if (kids.length < 2) return null;
    const k = kids[0], kc = getComputedStyle(k);
    const pad = Math.round((parseFloat(kc.paddingTop) || 0) + (parseFloat(kc.paddingBottom) || 0)), mar = Math.round((parseFloat(kc.marginTop) || 0) + (parseFloat(kc.marginBottom) || 0));
    if (pad < 6 && mar < 6) return null;
    const what = pad >= mar ? `안쪽 여백(위아래 ${pad}px)` : `바깥 여백(위아래 ${mar}px)`;
    return { kid: k, text: `이 부분엔 여백이 없어요. 사이 공간은 안에 있는 ${kids.length}개의 ${what}에서 생겨요.`, button: '안에 있는 것 모두 고르기' };
}
// 'rgb(1, 2, 3)' · 'rgba(…)' → '#010203'(색 고르기 칸은 #rrggbb 만 받음). 투명이면 대신 fallback
function hexOf(v, fallback = '#000000') {
    if (/^#[0-9a-f]{6}$/i.test(v || '')) return v;
    const m = String(v || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/);
    if (!m || (m[4] != null && parseFloat(m[4]) === 0)) return fallback;
    return '#' + [m[1], m[2], m[3]].map(n => Math.round(Number(n)).toString(16).padStart(2, '0')).join('');
}
function looksEmpty(el) {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor, painted = (bg && !/rgba\(.*,\s*0\)$|transparent/.test(bg)) || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0;
    return !painted && ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
}
const swallow = (e) => { if (!ours(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); } };
let moveT = 0;
function onPickMove(e) {
    if (!mode?.picking || moveT) return;
    const { clientX: x, clientY: y } = e;
    moveT = requestAnimationFrame(() => { moveT = 0; if (mode?.picking) mode.hover = mode.zap ? zapTarget(under(x, y)) : under(x, y)[0] || null; });
}
function onPickDown(e) {
    if (ours(e.target)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const stack = under(e.clientX, e.clientY);
    if (mode.zap) { hideEl(zapTarget(stack), e.clientX, e.clientY); return; }
    let el = stack[0];
    // 그림 위에 투명한 칸(메시지 안쪽 등)이 덮여 있으면 그 칸이 먼저 잡혀 그림을 못 골랐음 → 덮은 칸이 비어 보이면(바탕 · 테두리 · 바로 든 글 없음) 밑의 그림을 먼저
    const media = stack.find(x => /^(IMG|VIDEO|CANVAS|IFRAME)$/.test(x.tagName));
    if (el && media && el !== media && !el.contains(media) && looksEmpty(el)) el = media;
    // 줄 앞 아이콘(i · svg · 글꼴 아이콘)을 누르면 아이콘이 잡혀 줄의 여백 · 크기를 못 고쳤음 → 아이콘이 든 줄을 먼저(아이콘은 ↓로)
    if (el && el.matches('i, svg, svg *, [class*="fa-"]') && el.parentElement && !SKIP.has(el.parentElement.tagName)) el = el.closest('svg')?.parentElement || el.parentElement;
    stopPicking(true);
    if (!el) return;
    mode.trail = el; mode.point = [e.clientX, e.clientY]; mode.stack = stack.slice(0, 10);
    openCard(el, e.clientX, e.clientY);
}

// ── 숨기기: 켜 두면 누르는 곳마다 바로 숨김(고르기처럼 계속 누를 수 있음). 숨긴 뒤 작은 알림에서 범위(이 테마만 · 모든 테마) · 감싼 칸까지 · 다시 보이기.
// 범위 기본: 설정 창 · 양옆 패널 안은 실리태번 화면이라 테마가 바뀌어도 같은 줄이 있어 모든 테마, 그 밖(테마가 꾸민 곳)은 이 테마만
const defaultAll = (el) => !!el.closest('.drawer-content, #left-nav-panel, #right-nav-panel');
const scopeOf = (sel) => ((opts().hideAll || []).some(f => f.sel === sel) ? 'all' : 'theme');
function dropHide(sel) {
    const o = opts(), t = themeOpt();
    if (o.hideAll) o.hideAll = o.hideAll.filter(f => f.sel !== sel);
    if (t.fixes) t.fixes = t.fixes.filter(f => !(f.sel === sel && f.how === 'hide'));
}
function addHide(sel, label, all, keep = {}) {
    dropHide(sel);
    const f = { sel, label, at: keep.at || Date.now(), ...(keep.off ? { off: true } : {}) };
    if (all) (opts().hideAll ??= []).push(f);
    else { const t = themeOpt(true); t.fixes = [...(t.fixes || []).filter(x => x.sel !== sel), { ...f, how: 'hide' }]; }
}
// 숨길 칸: 글자 조각(span · small · b)을 누르면 그 글자만 사라지고 체크 칸 · 버튼 틀이 남아서, 그 줄(label · 버튼)째로. 줄 앞 아이콘(i · svg)도 그 줄로
function zapTarget(stack) {
    let el = stack[0];
    if (!el) return null;
    if (el.matches('i, svg, svg *') && el.parentElement && !SKIP.has(el.parentElement.tagName)) el = el.closest('svg')?.parentElement || el.parentElement;
    const row = el.parentElement?.closest('label, button, .menu_button, .list-group-item');
    if (row && /^(SPAN|SMALL|B|STRONG|EM|I|INPUT|SELECT)$/.test(el.tagName) && !el.closest('#chat .mes_text')) el = row;
    return el;
}
const tooBig = (el) => { const r = el.getBoundingClientRect(); return SKIP.has(el.tagName) || el.matches('#sheld, #chat, #form_sheld') || r.width * r.height > innerWidth * innerHeight * 0.6; };
// 메시지 본문(메시지 · 안쪽 · 글)은 숨기지 않음: 테마가 시간 · 버튼을 안 보이게 해 둔 자리를 누르면 그 밑의 메시지 안쪽이 잡혀 모든 메시지 글이 사라졌음
// 글 안에 정규식으로 넣은 상태창 같은 칸(div · details 등)은 숨길 수 있게 둠
const isMesBody = (el) => el.matches('#chat .mes, #chat .mes_block, #chat .mes_text, #chat .mes_text > :not(div, details, section, table, iframe, img, figure)');
// 메시지 밖은 누른 그 칸 하나만: 모양(태그 · 클래스) 셀렉터는 같은 꼴 줄(체크 칸 줄 등)에 모두 걸려 설정 줄이 한꺼번에 사라짐 →
// 안에 든 고유 이름(id) · 번역 열쇠(data-i18n, 언어가 바뀌어도 같음)로 집고, 없으면 가까운 이름 있는 칸에서 몇 번째인지로. 메시지 안은 모든 메시지에 같이
function oneSel(el) {
    if (el.closest('#chat .mes')) return selectorFor(el);
    if (el.id && !/^\d/.test(el.id)) return `#${CSS.escape(el.id)}`;
    const only = (q) => { try { const m = document.querySelectorAll(q); return m.length === 1 && m[0] === el; } catch { return false; } };
    const base = selectorFor(el);
    if (only(base)) return base;
    for (const k of [...el.querySelectorAll('[id]')].slice(0, 5)) if (!/^\d/.test(k.id) && only(`${base}:has(#${CSS.escape(k.id)})`)) return `${base}:has(#${CSS.escape(k.id)})`;
    const key = (e) => `[data-i18n="${e.getAttribute('data-i18n').replace(/["\\]/g, '\\$&')}"]`;
    if (el.hasAttribute('data-i18n') && only(`${base}${key(el)}`)) return `${base}${key(el)}`;
    for (const k of [...el.querySelectorAll('[data-i18n]')].slice(0, 5)) if (only(`${base}:has(${key(k)})`)) return `${base}:has(${key(k)})`;
    const path = [];
    let e = el;
    for (; e && e !== document.body && !(e.id && !/^\d/.test(e.id)); e = e.parentElement) path.unshift(`${e.tagName.toLowerCase()}:nth-child(${[...e.parentElement.children].indexOf(e) + 1})`);
    const q = (e && e !== document.body ? `#${CSS.escape(e.id)} > ` : 'body > ') + path.join(' > ');
    return only(q) ? q : base;
}
// 목록 · 알림에 보일 이름: 메시지 칸은 우리말 이름(시간 · 버튼 등), 설정 줄은 그 줄의 글(첫 줄)
const PLAIN = new Set(['버튼', '입력란', '문단', '그림', '제목', '설정 패널']);
function hideName(el) {
    const known = knownName(el);
    if (known && !PLAIN.has(known)) return known;
    // 메시지 안 글은 채팅 내용(인물 이름 · 대사)이라 이름으로 쓰지 않음
    if (el.closest('#chat .mes')) return known ? `메시지 ${known}` : '메시지 안 부분';
    // 보이는 첫 줄(innerText)을 먼저: textContent 는 드롭다운 목록 글까지 붙어 'Instruct 템플릿 AdventureA…' 꼴이 됐음.
    // 이미 숨긴 안쪽 칸만 글이 있으면(감싼 칸까지 넓힐 때) innerText 가 비어 textContent 로.
    // 숫자부터는 뺌: 머리 줄 글에 토큰 수처럼 바뀌는 숫자가 붙어 목록 이름이 '프롬프트 총 토큰: 86292' 꼴이 됐음
    // 제목 같은 칸(h · b · 굵은 머리 줄)이 들어 있으면 그 글을 먼저: 줄 하나에 제목과 고르는 칸 글이 함께 나와 'Instruct 템플릿 AdventureA…' 꼴이 됐음
    const head = [el, ...el.querySelectorAll('h1, h2, h3, h4, h5, h6, b, strong, .standoutHeader, summary')].find(e => e.matches('h1, h2, h3, h4, h5, h6, b, strong, .standoutHeader, summary') && e.textContent.trim());
    const line = (e) => (e?.innerText || '').split('\n').map(x => x.trim()).find(Boolean) || '';
    const txt = (line(head) || (el.innerText || '').split('\n').map(x => x.trim()).find(Boolean) || el.textContent.replace(/\s+/g, ' ').trim() || el.getAttribute('title') || el.getAttribute('aria-label') || '').replace(/\s*\d[\s\S]*$/, '').replace(/[\s:·,(/-]+$/, '').trim();
    return txt ? (txt.length > 24 ? `${txt.slice(0, 23)}…` : txt) : known || describe(el);
}
function hideEl(el, x, y, sel) {
    if (!el || !mode) return;
    if (isMesBody(el)) { zapChip({ x, y, msg: '메시지 글은 숨기지 않아요. 시간 · 버튼처럼 메시지 둘레에 붙은 것을 눌러 보세요.' }); return; }
    if (tooBig(el)) { zapChip({ x, y, msg: '화면 대부분을 차지하는 부분이라 숨기지 않았어요.' }); return; }
    remember();
    sel ??= oneSel(el);
    const z = { el, sel, label: hideName(el), x, y };
    addHide(sel, z.label, defaultAll(el));
    tidy(); commit(); paintBar();
    zapChip(z);
}
function closeZapChip() { if (!mode?.zapChip) return; mode.zapChip.remove(); mode.zapChip = null; }
function zapChip(z) {
    closeZapChip();
    const c = document.createElement('div');
    c.className = 'etk-tf-zap';
    mode.zapChip = c;
    const draw = () => {
        if (!z.sel) { c.innerHTML = `<div class="etk-tf-zap-head"><small></small><div class="etk-tf-list-x fa-solid fa-xmark interactable" title="닫기"></div></div>`; c.querySelector('small').textContent = z.msg; }
        else {
            const all = scopeOf(z.sel) === 'all', up0 = z.el && upOf(z.el), up = up0 && !tooBig(up0) && !isMesBody(up0) ? up0 : null;
            let n = 0;
            try { n = [...document.querySelectorAll(z.sel)].filter(e => !ours(e)).length; } catch { /* 셀렉터가 깨진 경우 */ }
            c.innerHTML = `<div class="etk-tf-zap-head"><b></b><div class="etk-tf-list-x fa-solid fa-xmark interactable" title="닫기"></div></div>
                <div class="etk-tf-seg">${[['theme', '이 테마만'], ['all', '모든 테마']].map(([v, l]) => `<span class="interactable ${(v === 'all') === all ? 'etk-on' : ''}" data-v="${v}">${l}</span>`).join('')}</div>
                <small class="etk-tf-zap-n">${n > 1 ? `같은 부분 ${n}곳이 함께 숨겨졌어요` : '숨긴 것은 고친 것 목록에서 다시 보이게 할 수 있어요'}</small>
                <div class="etk-tf-zap-acts"><div class="menu_button etk-tf-zap-up ${up ? '' : 'disabled'}" title="이 부분을 감싼 더 큰 칸을 숨겨요(줄 전체 등)"><i class="fa-solid fa-up-right-and-down-left-from-center"></i> 감싼 칸까지</div><div class="menu_button etk-tf-zap-back" title="숨긴 것을 다시 보이게 해요"><i class="fa-solid fa-eye"></i> 다시 보이기</div></div>`;
            c.querySelector('b').textContent = `'${z.label}' 숨김`;
            for (const o of c.querySelectorAll('.etk-tf-seg [data-v]')) o.addEventListener('click', () => {
                if ((o.dataset.v === 'all') === (scopeOf(z.sel) === 'all')) return;
                remember();
                const old = [...(opts().hideAll || []), ...(themeOpt().fixes || [])].find(f => f.sel === z.sel);
                addHide(z.sel, z.label, o.dataset.v === 'all', old);
                tidy(); commit(); paintBar(); draw();
            });
            c.querySelector('.etk-tf-zap-up').addEventListener('click', () => {
                const p = up;
                if (!p) return;
                remember();
                const all2 = scopeOf(z.sel) === 'all';
                dropHide(z.sel);
                Object.assign(z, { el: p, sel: oneSel(p), label: hideName(p) });
                addHide(z.sel, z.label, all2);
                tidy(); commit(); paintBar(); draw();
            });
            c.querySelector('.etk-tf-zap-back').addEventListener('click', () => { remember(); dropHide(z.sel); tidy(); commit(); paintBar(); closeZapChip(); });
        }
        c.querySelector('.etk-tf-list-x').addEventListener('click', closeZapChip);
    };
    draw();
    document.body.append(keepPanels(c));
    paintTint();
    // 누른 자리 옆(아래, 모자라면 위). 막대와 겹치지 않게
    const w = c.offsetWidth, h = c.offsetHeight, br = mode.bar.getBoundingClientRect(), low = br.top > innerHeight / 2;
    const ceil = low ? 8 : br.bottom + 8, floor = low ? br.top - 8 : innerHeight - 8;
    const top = z.y + 14 + h <= floor ? z.y + 14 : z.y - 14 - h;
    c.style.left = `${Math.max(8, Math.min(z.x + 14, innerWidth - w - 8))}px`;
    c.style.top = `${Math.max(ceil, Math.min(top, floor - h))}px`;
}

// 잘린 칸 찾기: 넘친 걸 자르는 칸(overflow hidden · clip)인데 안쪽 칸이 밖으로 삐져나감.
// scrollHeight 는 가운데 정렬로 위로 넘친 부분을 안 세서 놓쳤음 → 안쪽 칸 위치를 직접 견줌(많아야 300칸)
function isClipped(el, cs) {
    if (!/hidden|clip/.test(cs.overflowY + cs.overflowX)) return false;
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) return true;
    const r = el.getBoundingClientRect();
    let n = 0;
    for (const c of el.querySelectorAll('*')) {
        if (++n > 300) break;
        const q = c.getBoundingClientRect();
        if (!q.width || !q.height) continue;
        if (q.top < r.top - 1 || q.bottom > r.bottom + 1 || q.left < r.left - 1 || q.right > r.right + 1) return true;
    }
    return false;
}
// 테마가 'display: contents' 로 만든 칸은 크기가 없어 고르면 테두리도 조절도 소용없고, 아래로 갈 자식이 없다고 판단해 이동이 막혔음 → 건너뜀
const ghost = (e) => getComputedStyle(e).display === 'contents';
const solid = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
// 크기가 0인데 안쪽은 밖으로 넘쳐 보이는 칸(테마가 폭 0으로 둔 프로필 사진 · 메시지 버튼 묶음 등)도 같은 식으로 지나감
const hollow = (e) => ghost(e) || !solid(e);
function upOf(e) {
    let p = e.parentElement;
    while (p && !SKIP.has(p.tagName) && hollow(p)) p = p.parentElement;
    return p && !SKIP.has(p.tagName) ? p : null;
}
function kidsOf(e) {
    const out = [];
    for (const c of e.children) {
        if (c.closest('.etk-tf-bar, .etk-tf-card, .etk-tf-list, .etk-tf-box')) continue;
        if (solid(c) && !ghost(c)) out.push(c); else out.push(...kidsOf(c));
    }
    return out;
}
// 아래로: 처음 누른 칸을 품은 자식 → 처음 누른 자리를 덮는 자식 → 첫 자식 (위로 갔다 내려오면 처음 누른 칸으로 돌아오게)
function downOf(e) {
    // 처음 누른 칸 쪽은 크기와 상관없이 먼저 따라감(마우스를 올려야 보이는 메시지 버튼처럼, 조절 칸으로 마우스를 옮기면 크기가 0이 되는 칸이 있음)
    const trail = mode?.trail;
    if (trail && e !== trail && e.contains(trail)) {
        let c = [...e.children].find(x => x.contains(trail));
        while (c && c !== trail && hollow(c)) c = [...c.children].find(x => x.contains(trail));
        if (c) return c;
    }
    const kids = kidsOf(e);
    if (!kids.length) return null;
    const pt = mode?.point;
    return (pt && kids.find(c => { const r = c.getBoundingClientRect(); return pt[0] >= r.left && pt[0] <= r.right && pt[1] >= r.top && pt[1] <= r.bottom; }))
        || kids[0];
}

// 고른 칸에 맞는 조절만: 무엇 안에 있는지로 판단
// 채팅 폭 · 패널 폭은 실리태번 값(--sheldWidth)이나 패널 최소 폭으로 바꿔야 해서, 그 칸을 골랐을 때 일반 '폭' 대신 이것을 씀(따로 '전체' 칸에 두지 않음)
function wideKey(el) {
    if (isPhone()) return null;
    // 메시지 상자를 골라도 채팅 폭으로(메시지는 채팅 칸 안이라 메시지 폭만 바꾸면 그 메시지만 늘거나 채팅 칸에 막혔음)
    if (el.matches('#sheld, #chat, #chat > .mes')) return 'chat';
    if (el.matches('#left-nav-panel, #right-nav-panel')) return 'side';
    if (el.matches('#top-settings-holder .drawer-content')) return 'panel';
    return null;
}
function kinds(el) {
    const k = new Set();
    // 메시지 글자 크기 · 프로필 사진 크기는 '이 칸'(글자 크기 · 폭)이 모든 메시지의 같은 자리에 걸려서 따로 두지 않음(둘이 나란히 있으면 헷갈렸음).
    // 예전에 저장한 값(font · avatar)은 그대로 적용되고 고친 것 목록에서 지울 수 있음
    k.add('noFont');
    return k;
}
// 슬라이더 처음 자리는 지금 화면에서 잰 값(테마대로일 때도 지금 크기에서 시작)
const SLIDERS = {
    panel: { label: '설정 패널 폭', min: 300, max: 1600, step: 10, unit: 'px', now: (el) => Math.round(el.closest('.drawer-content')?.getBoundingClientRect().width || 600) },
    side: { label: '양옆 패널 폭', min: 200, max: 1000, step: 10, unit: 'px', now: (el) => Math.round(el.closest('#left-nav-panel, #right-nav-panel')?.getBoundingClientRect().width || 400) },
    chat: { label: '채팅 폭', min: 25, max: 100, step: 1, unit: '%', now: () => Math.round(document.getElementById('sheld')?.getBoundingClientRect().width / innerWidth * 100) || 50 },
    font: { label: '메시지 글자 크기', min: 0.6, max: 1.8, step: 0.05, unit: '배', now: () => 1 },
    avatar: { label: '프로필 사진 최대 폭', min: 30, max: 500, step: 5, unit: 'px', theme: true, now: (el) => Math.round((el.closest('.mes')?.querySelector('.avatar img') || el).getBoundingClientRect().width) || 100 },
};
const valOf = (k) => (k === 'avatar' ? Number(themeOpt().avatar) || 0 : screenVal(k));

function closeCard() { mode?.card?.remove(); if (mode) { mode.card = null; mode.el = null; } }
function openCard(el, x, y) {
    if (!mode) return;
    closeCard();
    mode.el = el; mode.group = null;
    const card = document.createElement('div');
    card.className = 'etk-tf-card';
    mode.card = card;
    document.body.append(keepPanels(card));
    drawCard(card, el);
    paintTint();
    if (sheet()) { const q = el.getBoundingClientRect(); if (q.bottom > innerHeight * 0.5) el.scrollIntoView({ block: 'start', behavior: 'instant' }); }
    else placeBeside(card, el, x, y);
}
// 조절 칸이 고른 칸(과 그 손잡이)을 덮으면 끌어서 고칠 수 없어서, 고른 칸 오른쪽 · 왼쪽 빈자리에 먼저 둠. 둘 다 좁으면 누른 자리 옆
function placeBeside(card, el, x, y) {
    const w = card.offsetWidth, h = card.offsetHeight, r = el.getBoundingClientRect(), cs = getComputedStyle(el), m = (k) => Math.max(0, parseFloat(cs[k]) || 0);
    // 바깥 여백 띠도 끌 수 있어야 해서 여백까지 피함
    const o = { left: r.left - m('marginLeft'), right: r.right + m('marginRight'), top: r.top - m('marginTop'), bottom: r.bottom + m('marginBottom') };
    const gap = 12, top = Math.max(o.top, 60), roomR = innerWidth - o.right, roomL = o.left;
    if (roomR >= w + gap + 8) return place(card, o.right + gap - 14, top - 14);
    if (roomL >= w + gap + 8) return place(card, o.left - gap - w - 14, top - 14);
    if (o.top - gap - 60 >= h) return place(card, x, o.top - gap - h - 14);
    if (innerHeight - o.bottom - gap - 60 >= h) return place(card, x, o.bottom + gap - 14);
    // 빈자리가 모자라면 넓은 쪽 화면 끝에 붙여 가리는 곳을 가장 적게
    place(card, roomR >= roomL ? innerWidth : -innerWidth, y);
}
// 카드가 고른 칸(바깥 여백 포함)과 겹치는지: 칸을 옮겨 고를 때 카드가 그대로 덮고 있으면 비켜 줌
function covers(card, el, pad = 0) {
    const c = card.getBoundingClientRect(), r = el.getBoundingClientRect(), cs = getComputedStyle(el), m = (k) => Math.max(0, parseFloat(cs[k]) || 0) + pad;
    const L = Math.max(0, r.left - m('marginLeft')), R = Math.min(innerWidth, r.right + m('marginRight')), T = Math.max(0, r.top - m('marginTop')), B = Math.min(innerHeight, r.bottom + m('marginBottom'));
    return c.left < R && c.right > L && c.top < B && c.bottom > T;
}
function place(card, x, y) {
    if (sheet()) return;
    const w = card.offsetWidth, h = card.offsetHeight;
    card.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - w - 8))}px`;
    // 막대와 겹치지 않게: 막대가 아래에 있으면 그 위까지, 위에 있으면 그 아래부터
    const br = mode?.bar?.getBoundingClientRect();
    const barLow = br && br.top > innerHeight / 2;
    const ceil = br && !barLow ? br.bottom + 8 : 8, floor = br && barLow ? br.top - 8 : innerHeight - 8;
    card.style.top = `${Math.max(ceil, Math.min(y + 14, floor - h))}px`;
}
const sidesOf = (cs) => { const n = (v) => Math.round(parseFloat(v) || 0); return { pt: n(cs.paddingTop), pr: n(cs.paddingRight), pb: n(cs.paddingBottom), pl: n(cs.paddingLeft), mt: n(cs.marginTop), mr: n(cs.marginRight), mb: n(cs.marginBottom), ml: n(cs.marginLeft) }; };
// 한쪽 공간을 d 만큼: 줄일 땐 안쪽 여백부터(0까지) 그다음 바깥 여백(마이너스 가능), 늘릴 땐 바깥 여백. padOnly 면(가운데 놓기 등 바깥이 auto) 안쪽만
function spread(x, side, d, base, padOnly) {
    const pk = 'p' + side, mk = 'm' + side;
    let pv = base[pk], mv = base[mk];
    if (d < 0) { const cut = Math.min(pv, -d); pv -= cut; if (!padOnly) mv -= -d - cut; }
    else if (padOnly) pv += d; else mv += d;
    if (pv !== base[pk]) x.props[pk] = pv;
    if (mv !== base[mk]) x.props[mk] = mv;
}
// 고른 것이 목록(위아래로 3줄 넘게 쌓인 것) 안에 있으면 그 목록
function listOf(el) {
    for (let e = el, i = 0; e && i < 6; e = e.parentElement, i++) {
        const P = e.parentElement;
        if (!P || P === document.body || SKIP.has(P.tagName)) return null;
        const ks = kidsOf(P);
        if (ks.length < 3) continue;
        let down = 0;
        for (let j = 1; j < ks.length && j < 12; j++) if (ks[j].getBoundingClientRect().top >= ks[j - 1].getBoundingClientRect().bottom - 2) down++;
        if (down >= Math.min(ks.length, 12) * 0.6) return P;
    }
    return null;
}
// 목록 안의 '줄' 모양들: 목록 폭의 절반 넘게 넓고 한 줄 높이쯤인 것이 3번 넘게 나오면 한 모양. 모양은 태그 + 첫 이름으로만 묶음(접힘 · 꺼짐 같은 상태 이름이 붙은 줄도 같은 모양으로).
// 위아래 공간이 없는 것(줄 안의 글 칸 등)은 빼고, 다른 줄을 품은 묶음도 빼서 실제로 공간을 가진 가장 안쪽 줄만
function rowKinds(P) {
    const pw = P.getBoundingClientRect().width, seen = new Map(), base = selectorFor(P);
    let n = 0;
    for (const e of P.querySelectorAll('*')) {
        if (++n > 3000) break;
        const r = e.getBoundingClientRect();
        if (r.height < 12 || r.height > 160 || r.width < pw * 0.5) continue;
        const c = [...e.classList].find(c => !STATE.test(c));
        const key = `${base} ${e.tagName.toLowerCase()}${c ? `.${CSS.escape(c)}` : ''}`;
        const v = seen.get(key);
        if (v) v.els.push(e); else seen.set(key, { sel: key, e, els: [e] });
    }
    // 접힌 묶음 안에 숨은 줄도 세서(보이는 게 2줄뿐이어도 같은 모양이 많으면 목록 줄)
    let kinds = [...seen.values()].filter(v => { if (v.els.length >= 3) return true; try { return document.querySelectorAll(v.sel).length >= 3; } catch { return false; } });
    kinds = kinds.filter(v => { const cs = getComputedStyle(v.e), sp = sidesOf(cs); return sp.pt + sp.pb + sp.mt + sp.mb + (parseFloat(cs.minHeight) || 0) > 0; });
    return kinds.filter(v => !kinds.some(o => o !== v && v.els.some(e => o.els.some(x => e !== x && e.contains(x)))));
}
function entryBySel(sel, el) {
    const tt = themeOpt(true);
    tt.styles ??= [];
    let x = tt.styles.find(y => y.sel === sel);
    if (!x) { x = wireStyle({ sel, label: describe(el), dev: {} }); tt.styles.push(x); }
    x.at = Date.now();
    return x;
}
// 무게: 화면을 읽는 일(크기 · 계산된 스타일)을 카드에 쓰기 전에 모두 끝냄. 쓰고 읽기를 섞으면 읽을 때마다 화면 전체 스타일을 다시 계산해 손을 뗄 때 200ms 넘게 걸렸음
function drawCard(card, el) {
    const t = themeOpt(), r = el.getBoundingClientRect(), cs = getComputedStyle(el), img = /^(IMG|VIDEO|CANVAS|SVG)$/i.test(el.tagName), whatText = describe(el);
    const own = (t.styles || []).find(x => x.sel === selectorFor(el))?.props || {};
    const wide = wideKey(el), space = spaceHint(el, cs), clipped = isClipped(el, cs);
    const floating = /absolute|fixed|sticky/.test(cs.position) || own.unfloat;
    const flex = isFlex(cs);
    const textish = !img && ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || el.matches('p, span, q, em, b, i, h1, h2, h3, h4, h5, h6, li, a, label, .mes_text, textarea, input'));
    const sp = sidesOf(cs), list = listOf(el);
    const path = [];
    for (let e = el, i = 0; e && i < 6; e = upOf(e), i++) { if (i === 0 || knownName(e) || e.id) path.unshift(e); }
    // 감싸는 칸 안에 남는 가로 자리: 감싸는 칸이 이 칸에 꼭 맞게 줄어 있으면 왼쪽 · 가운데 · 오른쪽을 눌러도 안 움직였음
    // 크기가 똑같이 겹친 감싸는 칸(화면에선 한 칸)은 하나로 보고, 자리는 그 바깥쪽 칸에 걸음
    const layoutParent = (e) => { let q = e.parentElement; while (q && q !== document.body && getComputedStyle(q).display === 'contents') q = q.parentElement; return q && q !== document.body ? q : null; };
    // 내용 폭(fit-content)으로 줄였을 때의 폭: 원래 폭과 같으면 제 크기가 정해진 칸(사진 등)이라, 감싸는 칸이 옆에 다른 칸을 품고 있어도 그 감싸는 칸째 옮겨야 함
    const fitW = (e) => { const was = [e.style.getPropertyValue('width'), e.style.getPropertyPriority('width')]; e.style.setProperty('width', 'fit-content', 'important'); const w = e.getBoundingClientRect().width; e.style.setProperty('width', was[0], was[1]); return w; };
    let fixedW = null;
    const isFixedW = () => (fixedW ??= Math.abs(fitW(el) - r.width) < 1);
    let pt = el;
    for (let q = layoutParent(pt); q && !SKIP.has(q.tagName) && Math.abs(q.getBoundingClientRect().width - pt.getBoundingClientRect().width) < 1 && (kidsOf(q).length === 1 || isFixedW()); q = layoutParent(pt)) pt = q;
    mode.placeEl = pt;
    const ptOwn = pt === el ? own : (styleEntry(pt, false)?.props || {});
    let room = Infinity, rowFull = false;
    const par = layoutParent(pt), pr = pt.getBoundingClientRect();
    if (par && !ptOwn.place) {
        const pc = getComputedStyle(par), inner = par.clientWidth - (parseFloat(pc.paddingLeft) || 0) - (parseFloat(pc.paddingRight) || 0);
        if (isFlex(pc) && !/column/.test(pc.flexDirection)) { rowFull = true; room = inner - kidsOf(par).reduce((n, k) => n + k.getBoundingClientRect().width, 0); }
        else {
            let w = pr.width;
            if (ptOwn.width == null) w = fitW(pt);
            room = inner - w;
        }
    }
    let alike = 0;
    // 생김새 이름(클래스)이 없는 칸은 이름을 빼면 'div' 같은 태그만 남아 화면의 칸 수천 개가 같은 모양으로 잡혔음 → 자기 클래스가 있을 때만
    if (el.id && [...el.classList].some(c => !STATE.test(c) && !/\d{3,}/.test(c))) { try { alike = document.querySelectorAll(selectorFor(el, true)).length; } catch { alike = 0; } }
    let same = 1;
    try { same = document.querySelectorAll(selectorFor(el)).length || 1; } catch { /* 셀렉터 못 씀 */ }
    const px = (v) => Math.round(parseFloat(v) || 0);
    // 숫자 칸 하나(바꾼 값은 진하게, × 로 원래대로). 위아래 방향키 · 휠로도 바뀜
    const num = (key, now, unit = 'px', step = 1, title = '') => {
        const v = own[key], set = v != null;
        return `<label class="etk-tf-n ${set ? 'etk-set' : ''}" data-k="${key}" title="${title}"><input type="number" step="${step}" value="${set && v !== 'auto' ? v : now}" ${v === 'auto' ? 'placeholder="자동" data-auto="1"' : ''}>${unit ? `<small>${v === 'auto' ? '' : unit}</small>` : ''}${set ? '<i class="etk-tf-nx" title="원래대로">×</i>' : ''}</label>`;
    };
    // 공간: 안쪽 · 바깥 여백을 나누지 않고 '그쪽 공간' 하나로(화면에선 둘 다 그냥 빈 곳이라). 줄이면 안쪽부터, 늘리면 바깥을
    const spaceRow = (k, label, now) => `<div class="etk-tf-row etk-tf-space" data-s="${k}"><span>${label}</span><input type="range" min="${Math.min(-40, now)}" max="${Math.max(80, now * 2)}" step="1" value="${now}"><b>${now}px</b></div>`;
    // 정해진 범위 안의 값은 끌어서 맞추는 막대로(숫자를 치지 않아도 되게)
    const range = (key, label, now, min, max, step, show) => {
        const v = own[key], set = v != null, cur = set ? v : now;
        return `<div class="etk-tf-row etk-tf-range ${set ? 'etk-set' : ''}" data-k="${key}"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${cur}"><b>${show(cur)}</b>${set ? '<i class="etk-tf-nx interactable" title="원래대로">×</i>' : ''}</div>`;
    };
    const seg = (key, opts2, title) => `<div class="etk-tf-seg" data-k="${key}" title="${title || ''}">${opts2.map(([v, label, icon]) => `<span class="interactable ${(key === 'place' ? ptOwn : own)[key] === v ? 'etk-on' : ''}" data-v="${v}" title="${label}">${icon ? `<i class="fa-solid ${icon}"></i>` : ''}${icon ? '' : label}</span>`).join('')}</div>`;
    card.innerHTML = `
        <div class="etk-tf-card-head">
            <div class="menu_button etk-tf-out" title="감싸는 부분 고르기"><i class="fa-solid fa-arrow-up"></i></div>
            <span class="etk-tf-what"></span>
            <div class="menu_button etk-tf-in" title="안에 있는 부분 고르기"><i class="fa-solid fa-arrow-down"></i></div>
            <div class="etk-tf-x fa-solid fa-xmark interactable" title="닫기"></div>
        </div>
        <div class="etk-tf-path"></div>
        <div class="etk-tf-stack"></div>
        ${space ? `<div class="etk-tf-hint"><span>${space.text}</span><div class="menu_button etk-tf-gokid">${space.button}</div></div>` : ''}
        ${clipped || own.unclip ? `<label class="etk-tf-check etk-tf-warn"><input type="checkbox" data-flag="unclip" ${own.unclip ? 'checked' : ''}> 잘린 내용 보이기 <small>${clipped ? '안의 내용이 잘려 있어요' : ''}</small></label>` : ''}
        ${alike > 1 ? `<div class="etk-tf-alike"><span class="etk-tf-chip interactable ${mode.group === el ? '' : 'etk-on'}" data-g="0">이 부분만</span><span class="etk-tf-chip interactable ${mode.group === el ? 'etk-on' : ''}" data-g="1">같은 모양 ${alike}곳 모두</span></div>` : ''}
        ${same > 1 ? `<div class="etk-tf-same">${el.closest('#chat .mes') ? '모든 메시지의 같은 자리에 적용' : `같은 부분 ${same}곳에 함께 적용`}</div>` : ''}

        <div class="etk-tf-sec">크기 · 공간 <small>화면에서 고른 부분의 띠나 손잡이를 끌어도 돼요</small></div>
        ${wide ? `<div class="etk-tf-wide"></div>` : ''}
        ${list ? `<div class="etk-tf-row etk-tf-dense" title="이 목록에서 되풀이되는 줄들의 위아래 공간을 한꺼번에 줄이거나 늘려요"><span>목록 촘촘하게</span><small>촘촘</small><input type="range" min="-16" max="24" step="1" value="0"><small>넉넉</small></div>` : ''}
        ${spaceRow('v', '위아래 공간', sp.pt + sp.pb + sp.mt + sp.mb)}
        ${spaceRow('h', '양옆 공간', sp.pl + sp.pr + sp.ml + sp.mr)}
        <details class="etk-tf-sides"><summary>한쪽씩 조절</summary>
            ${spaceRow('t', '위', sp.pt + sp.mt)}${spaceRow('b', '아래', sp.pb + sp.mb)}${spaceRow('l', '왼쪽', sp.pl + sp.ml)}${spaceRow('r', '오른쪽', sp.pr + sp.mr)}
        </details>
        <div class="etk-tf-row"><span>크기</span>${wide ? '' : `<span class="etk-tf-auto interactable ${own.width === 'auto' ? 'etk-on' : ''}" data-auto="width" title="폭을 안의 내용에 맞춰요(다시 누르면 원래대로)">폭 내용에 맞추기</span>`}<span class="etk-tf-auto interactable ${own.height === 'auto' ? 'etk-on' : ''}" data-auto="height" title="높이를 안의 내용에 맞춰요(다시 누르면 원래대로)">높이 내용에 맞추기</span>${own.height == null && parseFloat(cs.minHeight) > 0 ? `<small class="etk-tf-minh" title="이 부분은 이 높이보다 작아지지 않게 정해져 있어요. 위아래 공간을 줄이면 같이 낮아져요">최소 ${Math.round(parseFloat(own.minH ?? cs.minHeight))}px</small>` : ''}</div>

        <div class="etk-tf-sec">자리 <small>위쪽 손잡이(<i class="fa-solid fa-up-down-left-right"></i>)를 끌어 옮겨요. 나란히 놓인 것들 사이에선 순서가 바뀌어요</small></div>
        ${room >= 2 || ptOwn.place ? `<div class="etk-tf-row"><div class="etk-tf-seg" data-k="place"><span class="interactable ${ptOwn.place === 'center' ? 'etk-on' : ''}" data-v="center" title="감싸는 부분 안에서 가운데로(다시 누르면 원래대로)"><i class="fa-solid fa-align-center"></i> 가운데 놓기</span></div></div>` : ''}
        <label class="etk-tf-check" title="켜면 손잡이로 끌 때 다른 것들 사이에 끼우지 않고, 다른 것 위로 겹쳐 자유롭게 옮겨요(모든 부분 공통)"><input type="checkbox" data-o="freeMove" ${opts().freeMove ? 'checked' : ''}> 겹쳐 놓기</label>
        ${floating ? `<label class="etk-tf-check" title="테마가 다른 것 위에 띄워 둔 부분이에요. 켜면 다른 것들 사이로 들어가서, 위에 뭐가 끼어들어도 밀려나 겹치지 않아요"><input type="checkbox" data-flag="unfloat" ${own.unfloat ? 'checked' : ''}> 겹치지 않게 놓기</label>` : ''}
        ${flex ? range('gap', '안에 있는 것끼리 간격', px(cs.rowGap || cs.gap), 0, Math.max(40, px(cs.rowGap || cs.gap) * 2), 1, (v) => `${v}px`) : ''}

        ${img ? '' : `<div class="etk-tf-sec">글자</div>
        ${range('fontSize', '글자 크기', px(cs.fontSize), 8, Math.max(48, px(cs.fontSize) + 10), 1, (v) => `${v}px`)}
        <label class="etk-tf-check"><input type="checkbox" data-t="noFont" ${t.noFont ? 'checked' : ''}> 테마 글꼴 끄기 <small>이 테마 전체</small></label>`}

        <div class="etk-tf-sec">색</div>
        <div class="etk-tf-color" data-c="color"><span>글자색</span><input type="color" value="${hexOf(own.color || cs.color)}"><i></i><div class="etk-tf-undo1 fa-solid fa-rotate-left interactable ${own.color ? '' : 'etk-off'}" title="원래대로"></div></div>
        <div class="etk-tf-color" data-c="bg"><span>바탕색</span><input type="color" value="${hexOf(own.bg && own.bg !== 'none' ? own.bg : cs.backgroundColor, '#ffffff')}"><div class="menu_button etk-tf-cnone ${own.bg === 'none' ? 'etk-on' : ''}" title="바탕에 칠한 색 · 무늬를 지워요(형광펜 같은 것)">없애기</div><div class="etk-tf-undo1 fa-solid fa-rotate-left interactable ${own.bg ? '' : 'etk-off'}" title="원래대로"></div></div>

        <div class="etk-tf-acts">
            <div class="menu_button" data-how="hide" title="이 부분을 화면에서 숨겨요"><i class="fa-solid fa-eye-slash"></i> 숨기기</div>
            <div class="menu_button" data-how="pass" title="이 부분은 그대로 보이고, 누르면 그 뒤에 가려진 것이 눌려요(버튼을 덮고 있을 때)">뒤에 있는 것 누르기</div>
            <div class="menu_button etk-tf-copy" title="이 부분에 해 둔 조절을 고른 테마에도 똑같이 넣어요"><i class="fa-solid fa-layer-group"></i> 다른 테마에도</div>
        </div>
        <details class="etk-tf-more"><summary>더 보기 (투명도 · 전체 배율 · 줄 간격 · 정확한 크기)</summary>
            ${range('opacity', '투명도', Number(cs.opacity), 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
            ${range('zoom', '전체 배율', 1, 0.3, 2.5, 0.05, (v) => `${Math.round(v * 100)}%`)}
            <div class="etk-tf-row"><span>정확한 크기</span>${wide ? '' : num('width', Math.round(r.width), '', 1, '폭')}<span class="etk-tf-x2">×</span>${num('height', Math.round(r.height), 'px', 1, '높이')}</div>
            ${img ? '' : range('lineHeight', '줄 간격', Math.round((parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) || 1.4) * 20) / 20, 0.8, 3, 0.05, (v) => `${v.toFixed(2)}배`)}
        </details>`;
    const sel = selectorFor(el);
    // 배치를 바꾸면 고른 칸이 화면 밖으로 밀려나 안 보였음 → 보이게 스크롤(휴대폰은 아래 시트를 피해 위쪽에)
    if (!mode.dragging && card.isConnected) { const q = r, low = sheet() ? card.getBoundingClientRect().top : innerHeight; if (q.bottom < 40 || q.top > low - 20) el.scrollIntoView({ block: sheet() ? 'start' : 'center', behavior: 'instant' }); }
    function move(to) { if (to && !SKIP.has(to.tagName)) { mode.el = to; const r2 = card.getBoundingClientRect(); drawCard(card, to); if (covers(card, to)) placeBeside(card, to, r2.left, r2.top); else place(card, r2.left - 14, r2.top - 14); } }
    const entry = (create) => styleEntry(el, create);
    const save = () => { tidy(); commit(); paintBar(); };
    for (const row of card.querySelectorAll('.etk-tf-space')) {
        const k = row.dataset.s, input = row.querySelector('input'), sides = k === 'v' ? ['t', 'b'] : k === 'h' ? ['l', 'r'] : [k];
        let st = null;
        const begin = () => { if (st) return; remember(); const x = entry(true); minBase(el, x); st = { x, props0: { ...x.props }, base: sidesOf(getComputedStyle(el)), v0: Number(input.value) }; };
        input.addEventListener('pointerdown', begin);
        input.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow')) begin(); });
        input.addEventListener('input', () => {
            begin();
            const d = Number(input.value) - st.v0, first = sides.length > 1 ? Math.trunc(d / 2) : d;
            for (const key of Object.keys(st.x.props)) delete st.x.props[key];
            Object.assign(st.x.props, st.props0);
            sides.forEach((side, i) => spread(st.x, side, i ? d - first : first, st.base, (k === 'h' || side === 'l' || side === 'r') && !!(ptOwn.place || own.place)));
            fitMinH(st.x);
            row.querySelector('b').textContent = `${input.value}px`;
            save();
        });
        input.addEventListener('change', () => { st = null; drawCard(card, el); });
    }
    // 목록 촘촘하게: 목록 안에서 되풀이되는 줄 모양마다 위아래 공간을 같은 만큼 바꿈(줄 종류마다 따로 고치지 않게)
    card.querySelector('.etk-tf-dense input')?.addEventListener('pointerdown', function () { this._st = null; });
    card.querySelector('.etk-tf-dense input')?.addEventListener('input', function () {
        if (!this._st) { remember(); this._st = rowKinds(list).map(k => { const x = entryBySel(k.sel, k.e); minBase(k.e, x); return { x, props0: { ...x.props }, base: sidesOf(getComputedStyle(k.e)) }; }); }
        const d = Number(this.value), first = Math.trunc(d / 2);
        for (const k of this._st) {
            for (const key of Object.keys(k.x.props)) delete k.x.props[key];
            Object.assign(k.x.props, k.props0);
            spread(k.x, 't', first, k.base); spread(k.x, 'b', d - first, k.base); fitMinH(k.x);
        }
        save();
    });
    card.querySelector('.etk-tf-dense input')?.addEventListener('change', function () { this._st = null; this.value = 0; paintBar(); });
    const shows = { opacity: (v) => `${Math.round(v * 100)}%`, zoom: (v) => `${Math.round(v * 100)}%`, lineHeight: (v) => `${v.toFixed(2)}배`, gap: (v) => `${v}px`, fontSize: (v) => `${v}px` };
    for (const rg of card.querySelectorAll('.etk-tf-range')) {
        const key = rg.dataset.k, input = rg.querySelector('input');
        input.addEventListener('pointerdown', remember);
        input.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow')) remember(); });
        input.addEventListener('input', () => { const v = Number(input.value); entry(true).props[key] = v; rg.querySelector('b').textContent = shows[key](v); rg.classList.add('etk-set'); save(); });
        rg.querySelector('.etk-tf-nx')?.addEventListener('click', () => { remember(); const x = entry(false); if (x) delete x.props[key]; save(); drawCard(card, el); });
    }
    // 숫자 칸: 바꾸는 즉시 반영. 좌우로 끌면 값이 바뀜(Shift 는 10씩), 그냥 누르면 직접 입력
    for (const n of card.querySelectorAll('.etk-tf-n')) {
        const key = n.dataset.k, input = n.querySelector('input');
        input.addEventListener('focus', () => { remember(); if (key === 'pt' || key === 'pb') minBase(el, entry(true)); });
        input.addEventListener('pointerdown', (e) => {
            if (document.activeElement === input) return;
            const x0 = e.clientX, v0 = Number(input.value) || 0, step = Number(input.step) || 1;
            let scrub = false;
            const mv = (ev) => {
                const dx = ev.clientX - x0;
                if (!scrub && Math.abs(dx) < 4) return;
                if (!scrub) { scrub = true; remember(); if (key === 'pt' || key === 'pb') minBase(el, entry(true)); input.setPointerCapture(e.pointerId); }
                ev.preventDefault();
                input.value = String(Math.round((v0 + Math.round(dx / 3) * step * (ev.shiftKey ? 10 : 1)) * 100) / 100);
                input.dispatchEvent(new Event('input'));
            };
            const up = () => { input.removeEventListener('pointermove', mv); input.removeEventListener('pointerup', up); input.removeEventListener('pointercancel', up); if (scrub) { input.blur(); n.classList.add('etk-set'); } };
            input.addEventListener('pointermove', mv); input.addEventListener('pointerup', up); input.addEventListener('pointercancel', up);
        });

        input.addEventListener('input', () => {
            if (input.value === '' || input.value === '-') return;
            let v = Number(input.value);
            if (!Number.isFinite(v)) return;
            if (/^p[trbl]$|^(width|height|gap|fontSize)$/.test(key)) v = Math.max(0, v);
            const x = entry(true); x.props[key] = v; if (key === 'pt' || key === 'pb') { fitMinH(x); const mh = card.querySelector('.etk-tf-minh'); if (mh && x.props.minH != null) mh.textContent = `최소 ${x.props.minH}px`; } n.classList.add('etk-set'); input.removeAttribute('data-auto'); save();
        });
        n.querySelector('.etk-tf-nx')?.addEventListener('click', (e) => { e.preventDefault(); remember(); const x = entry(false); if (x) { delete x.props[key]; fitMinH(x); } save(); drawCard(card, el); });
    }
    for (const a of card.querySelectorAll('[data-auto]').values()) if (a.classList.contains('etk-tf-auto')) a.addEventListener('click', () => { remember(); const x = entry(true); if (x.props[a.dataset.auto] === 'auto') delete x.props[a.dataset.auto]; else x.props[a.dataset.auto] = 'auto'; save(); drawCard(card, el); });
    // 고르는 칸(자리 · 안쪽 칸 놓기): 다시 누르면 원래대로
    for (const sg of card.querySelectorAll('.etk-tf-seg[data-k]')) for (const o of sg.querySelectorAll('[data-v]')) o.addEventListener('click', () => {
        remember();
        const key = sg.dataset.k, x = key === 'place' ? styleEntry(mode.placeEl || el, true) : entry(true);
        if (key === 'dir') { delete x.props.oneLine; delete x.props.stack; delete x.props.wrap; }
        if (key === 'place') {
            const t2 = mode.placeEl || el, q = t2.getBoundingClientRect(), pp = t2.parentElement, pc = pp && getComputedStyle(pp);
            x.display = getComputedStyle(t2).display;
            if (!x.props.place) { const inner = pp ? pp.clientWidth - (parseFloat(pc.paddingLeft) || 0) - (parseFloat(pc.paddingRight) || 0) : 0; if (inner - q.width < 2) x.props.fit = true; else delete x.props.fit; }
        }
        if (x.props[key] === o.dataset.v) { delete x.props[key]; if (key === 'place') delete x.props.fit; } else x.props[key] = o.dataset.v;
        save(); drawCard(card, el);
    });
    for (const cb of card.querySelectorAll('input[data-flag]')) cb.addEventListener('change', () => { remember(); const x = entry(true); if (cb.checked) x.props[cb.dataset.flag] = true; else delete x.props[cb.dataset.flag]; save(); drawCard(card, el); });
    card.querySelector('.etk-tf-goout')?.addEventListener('click', () => { const up = upOf(mode.placeEl || el); if (up) { mode.trail = el; move(up); } });
    card.querySelector('.etk-tf-gokid')?.addEventListener('click', () => { mode.trail = space.kid; move(space.kid); if (space.kid.id) { mode.group = space.kid; drawCard(card, space.kid); } });
    for (const c of card.querySelectorAll('.etk-tf-alike [data-g]')) c.addEventListener('click', () => { mode.group = c.dataset.g === '1' ? el : null; drawCard(card, el); });
    card.querySelector('.etk-tf-copy')?.addEventListener('click', (e) => {
        const all = opts().themes, now = themeName();
        const has = (n) => (all[n]?.styles || []).some(x => x.sel === sel) || (all[n]?.fixes || []).some(f => f.sel === sel);
        const before = themeList().filter(n => n !== now && has(n));
        pickThemes(e.currentTarget, before, (themes) => {
            remember();
            const mine = (themeOpt().styles || []).find(x => x.sel === sel), fix = (themeOpt().fixes || []).find(f => f.sel === sel);
            for (const n of themeList()) {
                if (n === now) continue;
                const want = themes.includes(n);
                if (!want && !has(n)) continue;
                all[n] ??= {};
                const t2 = all[n];
                t2.styles = (t2.styles || []).filter(x => x.sel !== sel);
                t2.fixes = (t2.fixes || []).filter(f => f.sel !== sel);
                if (want) { if (mine) t2.styles.push(JSON.parse(JSON.stringify(mine))); if (fix) t2.fixes.push({ ...fix }); }
                tidyTheme(n);
            }
            commit(); paintBar();
            toastr.success(themes.length ? `테마 ${themes.length}개에 이 부분 조절을 넣었어요.` : '다른 테마에서 이 부분 조절을 뺐어요.', 'breeze');
        });
    });
    for (const row of card.querySelectorAll('.etk-tf-color')) {
        const key = row.dataset.c, input = row.querySelector('input'), back = row.querySelector('.etk-tf-undo1'), none = row.querySelector('.etk-tf-cnone');
        const set = (v) => { const x = entry(true); if (v == null) delete x.props[key]; else x.props[key] = v; back.classList.toggle('etk-off', v == null); none?.classList.toggle('etk-on', v === 'none'); save(); };
        input.addEventListener('focus', remember);
        input.addEventListener('pointerdown', remember);
        input.addEventListener('input', () => set(input.value));
        none?.addEventListener('click', () => { remember(); set(none.classList.contains('etk-on') ? null : 'none'); });
        back.addEventListener('click', () => { remember(); set(null); });
    }
    for (const cb of card.querySelectorAll('input[data-o]')) cb.addEventListener('change', () => { if (cb.checked) opts()[cb.dataset.o] = true; else delete opts()[cb.dataset.o]; api.save(); });
    for (const cb of card.querySelectorAll('input[data-t]')) cb.addEventListener('change', () => { remember(); const tt = themeOpt(true); if (cb.checked) tt[cb.dataset.t] = true; else delete tt[cb.dataset.t]; save(); });
    for (const b of card.querySelectorAll('[data-how]')) b.addEventListener('click', () => {
        const target = mode.el || el;
        if (b.dataset.how === 'hide') {
            const r = card.getBoundingClientRect(), grouped = mode.group === target;
            closeCard(); hideEl(target, r.left, r.top, grouped ? selectorFor(target) : null); return;
        }
        remember();
        const sel2 = selectorFor(target), tt = themeOpt(true);
        tt.fixes = [...(tt.fixes || []).filter(f => f.sel !== sel2), { sel: sel2, how: b.dataset.how, label: describe(target), at: Date.now() }];
        tidy(); commit(); closeCard(); paintBar();
    });
    // 채팅 폭 · 패널 폭(실리태번 값)은 그 칸을 골랐을 때 크기 칸 위에
    if (wide) {
        const box = card.querySelector('.etk-tf-wide'), s = SLIDERS[wide], v = valOf(wide), g = shareOf(wide), others = (g?.themes || []).filter(n => n !== themeName()).length;
        box.innerHTML = `<div class="etk-tf-row"><span>${s.label}</span><label class="etk-tf-n ${v ? 'etk-set' : ''}"><input type="number" step="${s.step}" value="${v || s.now(el)}"><small>${s.unit}</small>${v ? '<i class="etk-tf-nx" title="테마대로">×</i>' : ''}</label></div><div class="menu_button etk-tf-scope" title="다른 테마도 같은 값을 함께 쓰게 골라요. 기본은 지금 테마에만 적용돼요"><i class="fa-solid fa-layer-group"></i> ${others ? `테마 ${others + 1}개가 함께 씀` : '지금 테마만 · 같이 쓸 테마 고르기'}</div>`;
        const input = box.querySelector('input');
        input.addEventListener('focus', remember);
        input.addEventListener('input', () => { const n = Number(input.value); if (Number.isFinite(n) && n > 0) { setScreen(wide, n); commit(); paintBar(); } });
        box.querySelector('.etk-tf-nx')?.addEventListener('click', (e) => { e.preventDefault(); remember(); setScreen(wide, 0); commit(); paintBar(); drawCard(card, el); });
        box.querySelector('.etk-tf-scope').addEventListener('click', (e) => pickThemes(e.currentTarget, shareOf(wide)?.themes || [], (themes) => { remember(); setShare(wide, themes); commit(); paintBar(); drawCard(card, el); }));
        // 채팅 칸을 넓혀도 메시지 안 왼쪽 빈자리(이름 칸을 왼쪽에 두는 테마는 160px 넘게 비워 둠) 때문에 글은 그대로 좁았음 → 모든 메시지의 왼쪽 빈자리도 여기서
        if (wide === 'chat') {
            const SEL = '#chat .mes', mes = [...document.querySelectorAll('#chat .mes')].pop();
            const cur = themeOpt().styles?.find(x => x.sel === SEL)?.props?.pl;
            const now = cur ?? (mes ? Math.round(parseFloat(getComputedStyle(mes).paddingLeft)) || 0 : 0);
            box.insertAdjacentHTML('beforeend', `<div class="etk-tf-row"><span>메시지 왼쪽 빈자리</span><label class="etk-tf-n ${cur != null ? 'etk-set' : ''}"><input type="number" class="etk-tf-mespl" min="0" step="1" value="${now}"><small>px</small>${cur != null ? '<i class="etk-tf-nx etk-tf-mesx" title="테마대로">×</i>' : ''}</label></div>`);
            const pl = box.querySelector('.etk-tf-mespl');
            pl.addEventListener('focus', remember);
            pl.addEventListener('input', () => {
                const n = Number(pl.value); if (!Number.isFinite(n) || n < 0) return;
                const tt = themeOpt(true); tt.styles ??= [];
                let x = tt.styles.find(y => y.sel === SEL);
                if (!x) { x = wireStyle({ sel: SEL, label: '모든 메시지', dev: {} }); tt.styles.push(x); }
                x.props.pl = n; commit(); paintBar();
            });
            box.querySelector('.etk-tf-mesx')?.addEventListener('click', (e) => { e.preventDefault(); remember(); const x = themeOpt(true).styles?.find(y => y.sel === SEL); if (x) delete x.props.pl; tidy(); commit(); paintBar(); drawCard(card, el); });
        }
    }
    card.querySelector('.etk-tf-what').textContent = whatText;
    const pathBox = card.querySelector('.etk-tf-path');
    if (path.length > 1) for (const [i, e] of path.entries()) {
        if (i) pathBox.append(Object.assign(document.createElement('span'), { className: 'etk-tf-sep', textContent: '›' }));
        const chip = Object.assign(document.createElement('span'), { className: `etk-tf-chip interactable${e === el ? ' etk-on' : ''}`, textContent: knownName(e) || (e.id ? `#${e.id}` : e.tagName.toLowerCase()) });
        chip.addEventListener('pointerenter', () => { chip.title ||= describe(e); mode.hover = e; mode.peek = true; });
        chip.addEventListener('pointerleave', () => { mode.peek = false; });
        if (e !== el) chip.addEventListener('click', () => { mode.peek = false; move(e); });
        pathBox.append(chip);
    } else pathBox.remove();
    const stackBox = card.querySelector('.etk-tf-stack');
    const others2 = (mode.stack || []).filter(e => e.isConnected && e !== el && !e.contains(el) && !path.includes(e) && !el.contains(e)).slice(0, 5);
    if (others2.length) {
        stackBox.append(Object.assign(document.createElement('span'), { className: 'etk-tf-stack-label', textContent: '이 자리에 겹친 것' }));
        for (const e of others2) {
            const chip = Object.assign(document.createElement('span'), { className: 'etk-tf-chip interactable', textContent: knownName(e) || (e.id ? `#${e.id}` : e.tagName.toLowerCase()) });
            chip.addEventListener('pointerenter', () => { chip.title ||= describe(e); mode.hover = e; mode.peek = true; });
            chip.addEventListener('pointerleave', () => { mode.peek = false; });
            chip.addEventListener('click', () => { mode.peek = false; mode.trail = e; move(e); });
            stackBox.append(chip);
        }
    } else stackBox.remove();
    const grip = card.querySelector('.etk-tf-what');
    grip.addEventListener('pointerdown', (e) => {
        if (sheet()) return;
        const r2 = card.getBoundingClientRect(), dx = e.clientX - r2.left, dy = e.clientY - r2.top;
        grip.setPointerCapture(e.pointerId);
        const mv = (ev) => { card.style.left = `${Math.max(0, Math.min(ev.clientX - dx, innerWidth - r2.width))}px`; card.style.top = `${Math.max(0, Math.min(ev.clientY - dy, innerHeight - 40))}px`; };
        const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); };
        grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
    });
    card.querySelector('.etk-tf-x').addEventListener('click', closeCard);
    const upTo = upOf(el), downTo = downOf(el);
    card.querySelector('.etk-tf-out').addEventListener('click', () => move(upTo));
    card.querySelector('.etk-tf-in').addEventListener('click', () => move(downTo));
    card.querySelector('.etk-tf-out').classList.toggle('disabled', !upTo);
    card.querySelector('.etk-tf-in').classList.toggle('disabled', !downTo);
}
// 휴대폰(좁은 화면): 조절 칸을 화면 아래에서 올라오는 판으로
const sheet = () => matchMedia('(max-width: 700px)').matches;

// 되돌리기 기록: 이전으로(undo) · 앞으로(redo) · 처음으로. 새로 고치면(remember) 앞으로 갈 기록은 지움
function restore(snap) {
    const prev = JSON.parse(snap), o = opts();
    o.screen = prev.screen; o.share = prev.share || {}; o.themes = prev.themes;
    if (prev.hideAll?.length) o.hideAll = prev.hideAll; else delete o.hideAll;
}
function afterRestore() {
    commit(); paintBar();
    if (mode.card && mode.el) { const r = mode.card.getBoundingClientRect(); drawCard(mode.card, mode.el); place(mode.card, r.left - 14, r.top - 14); }
    if (mode.list) { mode.list.remove(); mode.list = null; toggleList(); }
}
function undo() {
    if (!mode?.undo.length) return;
    mode.redo.push(snapshot()); restore(mode.undo.pop()); afterRestore();
}
function redo() {
    if (!mode?.redo.length) return;
    mode.undo.push(snapshot()); restore(mode.redo.pop()); afterRestore();
}
// 처음으로: 이전으로를 끝까지 한 것과 같아서, 앞으로로 한 단계씩 다시 살릴 수 있음
function toFirst() {
    if (!mode?.undo.length) return;
    while (mode.undo.length) { mode.redo.push(snapshot()); restore(mode.undo.pop()); }
    afterRestore();
}

// 이 테마에서 고친 것(모든 테마에 걸린 화면 값도 같이) — 하나씩 지우기
// 고친 칸이 화면 어디인지(목록 묶음)
const AREAS = [['all', '테마 전체'], ['chat', '메시지'], ['input', '입력창'], ['panel', '패널'], ['top', '맨 위 줄'], ['etc', '그 밖']];
function areaOf(sel) {
    if (/#chat\b|\.mes\b/.test(sel)) return 'chat';
    if (/#send_form|#form_sheld|#send_textarea|#nonQRFormItems|#qr|#leftSendForm|#rightSendForm|#file_form|#vc_player/.test(sel)) return 'input';
    if (/#left-nav-panel|#right-nav-panel|drawer-content|#rm_|#UI-|#extensions|#AdvancedFormatting|#WorldInfo|#user-settings|#character|#persona|#completion_prompt_manager|#openai|#Instruct|#ContextSettings|#SystemPrompt|#extensions_settings|#range_block|#ai_response/i.test(sel)) return 'panel';
    if (/#top-bar|#top-settings-holder|drawer-toggle|drawer-icon/.test(sel)) return 'top';
    return 'etc';
}
function fixItems() {
    const t = themeOpt(), s = opts().screen[dev()], items = [];
    const unit = (k) => SLIDERS[k].unit;
    const offKey = (key, it) => Object.assign(it, { off: isOff(key, t), toggle: () => { const tt = themeOpt(true); tt.offs ??= []; if (tt.offs.includes(key)) tt.offs = tt.offs.filter(x => x !== key); else tt.offs.push(key); } });
    const whole = (name, text, drop, key) => items.push(key ? offKey(key, { area: 'all', name, text, drop }) : { area: 'all', name, text, drop });
    for (const k of SCREEN_KEYS) if (s[k]) whole(SLIDERS[k].label, `${s[k]}${unit(k)} · 모든 테마(예전 값)`, () => { delete s[k]; }, `scr:${k}`);
    for (const k of SCREEN_KEYS) { const g = shareOf(k); if (g) whole(SLIDERS[k].label, `${g.v ? `${g.v}${unit(k)}` : '테마대로'} · 테마 ${g.themes.length}개가 함께`, () => { g.themes = g.themes.filter(n => n !== themeName()); if (g.themes.length < 2) delete opts().share[dev()][k]; }, `scr:${k}`); }
    for (const [k, v] of Object.entries(t.scr?.[dev()] || {})) whole(SLIDERS[k]?.label || k, `${v ? `${v}${unit(k)}` : '테마대로'} · 이 테마만`, () => { delete t.scr[dev()][k]; }, `scr:${k}`);
    if (t.avatar > 0) whole('프로필 사진 최대 폭', `${t.avatar}px`, () => { delete t.avatar; }, 'avatar');
    if (t.noFont) whole('테마 글꼴', '끔', () => { delete t.noFont; delete t.font; }, 'noFont');
    if (t.area?.mg != null) items.push(offKey('mg', { area: 'chat', name: '메시지 사이 간격', text: `${t.area.mg > 0 ? '+' : ''}${t.area.mg}px`, drop: () => { delete t.area.mg; delete t.area.mgX; delete t.area.mgV0; } }));
    if (t.area?.av) items.push(offKey('av', { area: 'chat', name: '사진 크기', text: `${t.area.av}px`, drop: () => { t.area.av = t.area.avCss = t.area.avW0 = null; } }));
    if (t.area?.d != null) items.push(offKey('d', { area: 'panel', name: '프롬프트 · 캐릭터 목록 줄 간격', text: `${t.area.d > 0 ? '+' : ''}${t.area.d}px`, drop: () => { delete t.area.d; delete t.area.rowH; } }));
    // 지금 기기에서 고친 것만 보이고, 지우면 이 기기 값만 지움(다른 기기 값이 남으면 항목은 둠)
    (t.styles || []).forEach((x, i) => { if (Object.keys(x.props).length) items.push({ area: areaOf(x.sel), name: x.label || x.sel, text: PROP_TEXT(x.props), sel: x.sel, at: x.at || 0, order: i, obj: x, drop: () => { delete x.dev[dev()]; if (!devCount(x)) t.styles = t.styles.filter(y => y !== x); } }); });
    (t.fixes || []).forEach((f, i) => items.push({ area: areaOf(f.sel), name: f.label || f.sel, text: f.how === 'hide' ? '숨김 · 이 테마만' : '뒤에 있는 것 누르기', sel: f.sel, at: f.at || 0, order: 1000 + i, obj: f, hide: f.how === 'hide' ? 'theme' : null, drop: () => { t.fixes = t.fixes.filter(x => x !== f); } }));
    (opts().hideAll || []).forEach((f, i) => items.push({ area: areaOf(f.sel), name: f.label || f.sel, text: '숨김 · 모든 테마', sel: f.sel, at: f.at || 0, order: 2000 + i, obj: f, hide: 'all', drop: () => { opts().hideAll = opts().hideAll.filter(x => x !== f); } }));
    return items;
}
// 화면에서 그 칸 찾기(보이는 것 먼저)
function findOnScreen(sel) {
    let all = [];
    try { all = [...document.querySelectorAll(sel)].filter(e => !ours(e)); } catch { return null; }
    const seen = all.filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height; });
    return seen.find(e => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }) || seen[0] || null;
}
// 고친 항목이 많아도 찾기 쉽게: 찾기 · 정렬(최근 고친 순 · 화면 위치 순 · 이름 순) · 화면 자리별로 접는 묶음. 줄을 누르면 그 칸을 골라 조절 카드를 엶
// 영역 창이 맞추는 패널을 덮으면 바뀐 모습이 안 보여서, 열린 패널 · 설정 창과 덜 겹치는 쪽(왼쪽 · 오른쪽 아래)에 둠. 휴대폰은 낮은 아래 시트(CSS)
function placeArea(win) {
    if (sheet()) return;
    const open = [...document.querySelectorAll('#left-nav-panel, #right-nav-panel, .drawer-content.openDrawer')].map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    // 막대(맞추기 버튼 줄)도 덮지 않게: 막대가 아래에 있으면 그 위로
    const br = mode?.bar?.getBoundingClientRect(), w = win.offsetWidth, h = win.offsetHeight;
    const top = Math.max(8, (br && br.top > innerHeight / 2 ? br.top : innerHeight) - h - 10);
    const cover = (x) => open.reduce((n, r) => n + Math.max(0, Math.min(x + w, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(top + h, r.bottom) - Math.max(top, r.top)), 0);
    const xs = [8, innerWidth - w - 8, Math.round((innerWidth - w) / 2)];
    const x = xs.reduce((b, v) => (cover(v) < cover(b) ? v : b), xs[0]);
    Object.assign(win.style, { left: `${x}px`, top: `${top}px`, right: 'auto', bottom: 'auto', transform: 'none' });
}
function toggleArea() {
    if (!mode) return;
    if (mode.area) { mode.area.remove(); mode.area = null; paintBar(); return; }
    stopPicking(); closeCard(); closeZapChip(); mode.list?.remove(); mode.list = null;
    const win = document.createElement('div');
    win.className = 'etk-tf-list etk-tf-area';
    let avMsg = '', avWhy = '', mgMsg = '';
    // 테마 원래 사진 폭(처음 맞출 때 잼, 아직이면 지금 화면)에서: 작게 = 100px(원래 100 이하면 3/4), 크게 = 1.5배(최소 +40, 최대 400)
    const avNow = () => { const t2 = themeOpt().area; if (t2?.avW0) return t2.avW0; const m = avatarMes(); return m ? Math.round(m.querySelector('.avatar').getBoundingClientRect().width) : 100; };
    // 크게는 메시지 폭을 넘지 않게(휴대폰에서 400px 이 화면 폭보다 커서 사진이 화면 밖으로 나갔음)
    const avPreset = (v) => { const w = themeOpt().area?.avW0 ?? avNow(), room = Math.round((avatarMes()?.getBoundingClientRect().width || 800) * 0.9); return v === 'small' ? (w > 100 ? 100 : Math.max(24, Math.round(w * 0.75))) : Math.min(400, room, Math.round(Math.max(w * 1.5, w + 40))); };
    const draw = () => {
        const a = themeOpt().area || {}, p0 = a.pad0?.prompt;
        const tight = p0 != null ? TIGHT - p0 : -10, d = a.d;
        const on = (v) => (v === 'tight' ? d != null && d === tight : v === 'loose' ? d === LOOSE : d == null);
        const max = Math.max(20, LOOSE + 10), min = -Math.max(p0 ?? 12, 12);
        const mgOn = (v) => (v === 'tight' ? a.mg != null && a.mgV0 != null && a.mg === gapTight(a.mgV0) - a.mgV0 : v === 'loose' ? a.mg === GAP_LOOSE : a.mg == null);
        win.innerHTML = `<div class="etk-tf-list-head"><b>${themeName() || '기본 테마'} 레이아웃</b><div class="etk-tf-list-x fa-solid fa-xmark interactable" title="닫기"></div></div>
            <div class="etk-tf-list-body">
                <div class="etk-tf-area-row"><span>프롬프트 · 캐릭터 목록 줄 간격</span><div class="etk-tf-seg" data-a="list">${[['tight', '좁게'], ['', '테마대로'], ['loose', '넓게']].map(([v, l]) => `<span class="interactable ${on(v) ? 'etk-on' : ''}" data-v="${v}">${l}</span>`).join('')}</div>
                    <small>좁게 하면 한 화면에 더 많은 줄이 보여요. 테마대로는 테마 원래 간격이에요.</small></div>
                <div class="etk-tf-row etk-tf-area-slide"><span>세세하게</span><input type="range" min="${min}" max="${max}" step="1" value="${d ?? 0}"><b>${d == null ? '테마대로' : `${d > 0 ? '+' : ''}${d}px`}</b></div>
                <div class="etk-tf-area-row"><span>메시지 사이 간격</span><div class="etk-tf-seg" data-a="mg">${[['tight', '좁게'], ['', '테마대로'], ['loose', '넓게']].map(([v, l]) => `<span class="interactable ${mgOn(v) ? 'etk-on' : ''}" data-v="${v}">${l}</span>`).join('')}</div>
                    <small>메시지와 메시지 사이 빈 곳을 바꿔요. 테마마다 간격을 만드는 곳이 달라서, 눈에 보이는 간격을 재서 맞춰요.</small></div>
                <div class="etk-tf-row etk-tf-mg-slide"><span>세세하게</span><input type="range" min="${-Math.max(a.mgV0 ?? 60, 20)}" max="80" step="1" value="${a.mg ?? 0}"><b>${a.mg == null ? '테마대로' : `${a.mg > 0 ? '+' : ''}${a.mg}px`}</b></div>
                ${mgMsg ? `<small class="etk-tf-av-msg">${mgMsg}</small>` : ''}
                ${!a.av && !avatarMes() ? `<div class="etk-tf-area-row"><span>사진 크기</span><small>이 테마는 메시지에 프로필 사진을 보여 주지 않아요. 채팅을 열었는데도 이렇게 나오면 이 테마에선 사진 크기를 바꿀 수 없어요.</small></div>` : `<div class="etk-tf-area-row"><span>사진 크기</span><div class="etk-tf-seg" data-a="av">${[['small', '작게'], ['', '테마대로'], ['big', '크게']].map(([v, l]) => `<span class="interactable ${(v === '' ? !a.av : a.av && a.av === avPreset(v)) ? 'etk-on' : ''}" data-v="${v}">${l}</span>`).join('')}</div>
                    <small>메시지의 프로필 사진 크기를 바꿔요. 테마에 맞는 방법을 찾아 바꾸고, 사진이 이름이나 글을 덮으면 비켜 놓아요.</small></div>
                <div class="etk-tf-row etk-tf-av-slide"><span>세세하게</span><input type="range" min="24" max="${Math.min(800, Math.max(400, Math.round((a.avW0 ?? avNow()) * 2)))}" step="2" value="${a.av ?? avNow()}"><b>${a.av ? `${a.av}px` : '테마대로'}</b></div>
                ${avMsg ? `<small class="etk-tf-av-msg" data-why="${avWhy}">${avMsg}</small>` : ''}`}
                <div class="etk-tf-area-row etk-tf-area-pick"><span>하나씩 손보기</span><div class="menu_button etk-tf-area-pickbtn"><i class="fa-solid fa-crosshairs"></i> 화면에서 고르기</div>
                    <small>위 조절로 안 되는 곳은 화면에서 직접 눌러 골라요. 고른 곳 옆에 크기 · 자리 · 글자 · 색 조절이 떠요.</small></div>
            </div>`;
        win.querySelector('.etk-tf-list-x').addEventListener('click', toggleArea);
        win.querySelector('.etk-tf-area-pickbtn').addEventListener('click', () => startPicking());
        // 제목 줄을 잡고 끌어 옮김(휴대폰은 아래 시트라 그대로). 다시 그려도 옮긴 자리는 그대로
        const grip = win.querySelector('.etk-tf-list-head b');
        grip.classList.add('etk-tf-grip');
        grip.addEventListener('pointerdown', (e) => {
            if (sheet()) return;
            e.preventDefault();
            const r0 = win.getBoundingClientRect(), dx = e.clientX - r0.left, dy = e.clientY - r0.top;
            grip.setPointerCapture(e.pointerId);
            const mv = (ev) => Object.assign(win.style, { left: `${Math.max(0, Math.min(ev.clientX - dx, innerWidth - r0.width))}px`, top: `${Math.max(0, Math.min(ev.clientY - dy, innerHeight - 40))}px`, right: 'auto', bottom: 'auto', transform: 'none' });
            const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
            grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
        });
        const apply = (fn) => { const tt = themeOpt(true); tt.area ??= {}; measurePad0(tt.area); fn(tt.area); delete tt.area.rowH; tidy(); commit(); paintBar(); requestAnimationFrame(() => requestAnimationFrame(measureListRow)); };
        for (const o of win.querySelectorAll('.etk-tf-seg[data-a="list"] [data-v]')) o.addEventListener('click', () => {
            remember();
            apply((ar) => {
                const q = ar.pad0?.prompt;
                if (o.dataset.v === 'tight') ar.d = q != null ? TIGHT - q : -10;
                else if (o.dataset.v === 'loose') ar.d = LOOSE;
                else delete ar.d;
            });
            draw();
        });
        const setAv = async (T) => {
            remember();
            if (T == null) { const tt = themeOpt(true); if (tt.area) { tt.area.av = tt.area.avCss = tt.area.avW0 = null; if (tt.area.mg != null) { tt.area.mgX = {}; build(); await fitGap(tt.area.mg); } } avMsg = ''; tidy(); commit(); paintBar(); draw(); return; }
            const r = await fitAvatar(T);
            const ar = themeOpt().area;
            if (r.ok && ar?.mg != null) { ar.mgX = {}; await fitGap(ar.mg); }
            avWhy = r.ok ? '' : r.why;
            avMsg = r.ok ? '' : r.why === 'nomes' ? '채팅에 프로필 사진이 보이는 메시지가 있을 때 맞출 수 있어요.' : '이 테마에선 사진 크기를 자동으로 맞추지 못해 그대로 뒀어요. 하나씩 손보기로 직접 고쳐 보세요.';
            tidy(); commit(); paintBar(); draw();
        };
        const setMg = async (d) => {
            remember();
            if (d == null) { const tt = themeOpt(true); if (tt.area) { delete tt.area.mg; delete tt.area.mgX; } mgMsg = ''; tidy(); commit(); paintBar(); draw(); return; }
            const r = await fitGap(d);
            mgMsg = r.ok || r.why === 'busy' ? '' : '채팅에 메시지가 둘 이상 보일 때 맞출 수 있어요.';
            tidy(); commit(); paintBar(); draw();
        };
        for (const o of win.querySelectorAll('.etk-tf-seg[data-a="mg"] [data-v]')) o.addEventListener('click', () => setMg(o.dataset.v === 'tight' ? (v0) => gapTight(v0) - v0 : o.dataset.v === 'loose' ? GAP_LOOSE : null));
        const mgRange = win.querySelector('.etk-tf-mg-slide input');
        mgRange.addEventListener('input', () => { const v = Number(mgRange.value); win.querySelector('.etk-tf-mg-slide b').textContent = `${v > 0 ? '+' : ''}${v}px`; });
        mgRange.addEventListener('change', () => setMg(Number(mgRange.value)));
        for (const o of win.querySelectorAll('.etk-tf-seg[data-a="av"] [data-v]')) o.addEventListener('click', () => setAv(o.dataset.v ? avPreset(o.dataset.v) : null));
        const avRange = win.querySelector('.etk-tf-av-slide input');
        avRange?.addEventListener('input', () => { win.querySelector('.etk-tf-av-slide b').textContent = `${avRange.value}px`; });
        avRange?.addEventListener('change', () => setAv(Number(avRange.value)));
        const range = win.querySelector('.etk-tf-area-slide input');
        range.addEventListener('pointerdown', remember);
        range.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow')) remember(); });
        range.addEventListener('input', () => { const v = Number(range.value); apply((ar) => { ar.d = v; }); win.querySelector('.etk-tf-area-slide b').textContent = `${v > 0 ? '+' : ''}${v}px`; });
        range.addEventListener('change', draw);
    };
    draw();
    document.body.append(keepPanels(win));
    mode.area = win;
    placeArea(win);
    paintTint();
    paintBar();
}
// ── 맞춘 값 내보내기 · 불러오기(이 테마 것만). 파일은 남이 만든 것일 수 있어, 아는 항목 · 아는 꼴의 값만 골라 넣음(셀렉터 · 색 글자는 CSS 에 그대로 들어가므로 규칙을 끝내거나 새로 여는 글자를 막음).
// 기기에서 잰 값(사진 크기 규칙 · 메시지 간격 px · 목록 줄 원래 여백)은 화면 · 글꼴 · 깔린 확장에 따라 달라 빼고, 받은 쪽에서 다시 잼
const FIT_NUM = ['width', 'height', 'minH', 'fontSize', 'padding', 'margin', 'pt', 'pr', 'pb', 'pl', 'mt', 'mr', 'mb', 'ml', 'gap', 'order', 'zoom', 'lineHeight', 'moveX', 'moveY', 'opacity'];
const FIT_FLAG = ['unfloat', 'oneLine', 'stack', 'wrap', 'fit', 'unclip'];
const okNum = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 100000;
const okSel = (v) => { if (typeof v !== 'string' || !v.trim() || v.length > 300 || /[{};@\\]|\/\*/.test(v)) return false; try { document.querySelector(v); return true; } catch { return false; } };
const okText = (v) => String(v ?? '').replace(/[<>&"'`]/g, '').slice(0, 80);
function cleanProps(p) {
    const out = {};
    if (!p || typeof p !== 'object') return out;
    for (const k of FIT_NUM) if (okNum(p[k]) || ((k === 'width' || k === 'height') && p[k] === 'auto')) out[k] = p[k];
    for (const k of FIT_FLAG) if (p[k] === true) out[k] = true;
    if (['row', 'col', 'wrap'].includes(p.dir)) out.dir = p.dir;
    if (['left', 'center', 'right'].includes(p.place)) out.place = p.place;
    for (const k of ['color', 'bg']) if (typeof p[k] === 'string' && /^(none|#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(p[k].trim())) out[k] = p[k].trim();
    return out;
}
function cleanFit(t) {
    const out = {};
    if (!t || typeof t !== 'object') return out;
    const styles = (Array.isArray(t.styles) ? t.styles : []).filter(x => x && okSel(x.sel)).map(x => {
        const src = x.dev && typeof x.dev === 'object' ? x.dev : { pc: Object.getOwnPropertyDescriptor(x, 'props')?.value, phone: Object.getOwnPropertyDescriptor(x, 'props')?.value };
        const dv = {};
        for (const k of ['pc', 'phone']) { const p = cleanProps(src[k]); if (Object.keys(p).length) dv[k] = p; }
        const y = { sel: x.sel, label: okText(x.label || x.sel), dev: dv };
        if (x.img === true) y.img = true;
        if (x.off === true) y.off = true;
        if (typeof x.display === 'string' && /^[a-z-]{1,20}$/.test(x.display)) y.display = x.display;
        return y;
    }).filter(y => Object.keys(y.dev).length);
    if (styles.length) out.styles = styles;
    const fixes = (Array.isArray(t.fixes) ? t.fixes : []).filter(f => f && okSel(f.sel) && ['hide', 'pass'].includes(f.how)).map(f => ({ sel: f.sel, how: f.how, label: okText(f.label || f.sel), ...(f.off === true ? { off: true } : {}) }));
    if (fixes.length) out.fixes = fixes;
    const a = t.area && typeof t.area === 'object' ? t.area : {}, area = {};
    if (okNum(a.d)) area.d = a.d;
    if (okNum(a.mg)) area.mg = a.mg;
    const avD = {};
    for (const k of ['pc', 'phone']) { const v = a.avD?.[k]?.av ?? Object.getOwnPropertyDescriptor(a, 'av')?.value; if (okNum(v) && v >= 24 && v <= 800) avD[k] = { av: Math.round(v) }; }
    if (Object.keys(avD).length) area.avD = avD;
    if (Object.keys(area).length) out.area = area;
    const scr = {};
    for (const d of ['pc', 'phone']) { const v = {}; for (const k of SCREEN_KEYS) if (okNum(t.scr?.[d]?.[k]) && t.scr[d][k] > 0) v[k] = t.scr[d][k]; if (Object.keys(v).length) scr[d] = v; }
    if (Object.keys(scr).length) out.scr = scr;
    if (t.noFont === true) out.noFont = true;
    if (okNum(t.avatar) && t.avatar > 0) out.avatar = t.avatar;
    return out;
}
const fitCount = (d) => (d.styles?.length || 0) + (d.fixes?.length || 0) + Object.keys(d.area || {}).length + Object.values(d.scr || {}).reduce((n, v) => n + Object.keys(v).length, 0) + (d.noFont ? 1 : 0) + (d.avatar ? 1 : 0);
function exportFit() {
    const data = cleanFit(themeOpt()), name = themeName() || '기본 테마';
    if (!fitCount(data)) return toastr.info('이 테마에서 맞춘 값이 아직 없어요.', 'breeze');
    downloadText(`${name.replace(/[\\/:*?"<>|]/g, '_')} 맞춤.json`, JSON.stringify({ kind: 'breeze-theme-fit', version: 1, theme: name, data }, null, 1));
}
async function importFit(after) {
    const file = await pickFile('.json,application/json');
    if (!file || !mode) return;
    let raw = null;
    try { raw = JSON.parse(await file.text()); } catch { /* 아래에서 알림 */ }
    if (raw?.kind !== 'breeze-theme-fit' || typeof raw.data !== 'object') return toastr.warning('테마 맞추기에서 내보낸 파일이 아니에요.', 'breeze');
    const data = cleanFit(raw.data), n = fitCount(data), now = themeName() || '기본 테마', from = okText(raw.theme);
    if (!n) return toastr.warning('파일에 넣을 값이 없어요.', 'breeze');
    const c = api.ctx();
    const other = from && from !== now ? `<br>이 파일은 '${from}' 테마에서 맞춘 값이에요. 다른 테마에 넣으면 안 맞을 수 있어요.` : '';
    const r = await c.callGenericPopup(`<h3>맞춘 값을 불러올까요?</h3>'${okText(now)}'에서 맞춘 값이 파일의 것(${n}개)으로 바뀌어요.${other}`, c.POPUP_TYPE.CONFIRM, '', { okButton: '불러오기', cancelButton: '취소' });
    if (r !== c.POPUP_RESULT.AFFIRMATIVE || !mode) return;
    remember();
    opts().themes[themeName()] = data;
    gapNoMes = false; avNoMes = false;
    tidy(); commit(); paintBar(); after?.();
    toastr.success(`맞춘 값 ${n}개를 넣었어요. 막대의 되돌리기로 취소할 수 있어요.`, 'breeze');
}
function toggleList() {
    if (!mode) return;
    if (mode.list) { mode.list.remove(); mode.list = null; return; }
    stopPicking(); closeCard(); closeZapChip(); mode.area?.remove(); mode.area = null;
    const list = document.createElement('div');
    list.className = 'etk-tf-list';
    const sorts = [['recent', '최근 고친 순'], ['screen', '화면 위치 순'], ['name', '이름 순']];
    list.innerHTML = `<div class="etk-tf-list-head"><b></b><div class="etk-tf-list-x fa-solid fa-xmark interactable" title="닫기"></div></div>
        <div class="etk-tf-list-tools"><input type="search" class="text_pole etk-tf-list-find" placeholder="찾기"><select class="text_pole etk-tf-list-sort">${sorts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        <div class="etk-tf-list-body"></div>
        <div class="etk-tf-list-file"><div class="menu_button etk-tf-list-export" title="이 테마에서 맞춘 값을 파일로 저장해요. 같은 테마를 쓰는 사람에게 줄 수 있어요"><i class="fa-solid fa-file-export"></i> 내보내기</div><div class="menu_button etk-tf-list-import" title="내보낸 파일을 골라 이 테마에 넣어요"><i class="fa-solid fa-file-import"></i> 불러오기</div></div>`;
    const find = list.querySelector('.etk-tf-list-find'), sortSel = list.querySelector('.etk-tf-list-sort'), body = list.querySelector('.etk-tf-list-body');
    sortSel.value = opts().listSort || 'recent';
    mode.listOpen ??= new Set();
    let first = true;
    const draw = () => {
        const q = find.value.trim().toLowerCase(), sort = sortSel.value, all = fixItems();
        list.querySelector('.etk-tf-list-head b').textContent = `${themeName() || '기본 테마'}에서 고친 것 ${all.length}개`;
        const items = q ? all.filter(it => `${it.name} ${it.text}`.toLowerCase().includes(q)) : all;
        // 화면 위치 순: 정렬하며 같은 칸을 여러 번 찾지 않게 항목마다 한 번만 재 둠
        const tops = new Map();
        if (sort === 'screen') for (const it of items) { const e = it.sel && findOnScreen(it.sel), r = e?.getBoundingClientRect(); tops.set(it, !it.sel ? -1e9 : r ? r.top + scrollY + r.left / 1e4 : 1e9); }
        const top = (it) => tops.get(it);
        const cmp = sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'ko')
            : sort === 'screen' ? (a, b) => top(a) - top(b)
            : (a, b) => (b.at || 0) - (a.at || 0) || (a.order ?? -1) - (b.order ?? -1);
        const groups = AREAS.map(([k, label]) => ({ k, label, rows: items.filter(it => it.area === k).sort(cmp) })).filter(g => g.rows.length);
        if (sort === 'recent') groups.sort((a, b) => (a.k === 'all') - (b.k === 'all') || Math.max(...b.rows.map(r => r.at || 0)) - Math.max(...a.rows.map(r => r.at || 0)));
        // 처음 열 때: 15개 이하면 다 펼치고, 많으면 맨 위 묶음만
        if (first) { first = false; for (const [i, g] of groups.entries()) if (all.length <= 15 || i === 0) mode.listOpen.add(g.k); }
        body.innerHTML = '';
        if (!all.length) { body.innerHTML = '<small class="etk-tf-empty">아직 없어요. 레이아웃 창에서 고르거나 \'화면에서 고르기\'로 이상한 곳을 눌러 보세요</small>'; return; }
        if (!items.length) { body.innerHTML = '<small class="etk-tf-empty">찾는 항목이 없어요</small>'; return; }
        for (const g of groups) {
            const open = !!q || mode.listOpen.has(g.k);
            const head = Object.assign(document.createElement('div'), { className: `etk-tf-list-group interactable${open ? ' etk-open' : ''}` });
            head.innerHTML = `<i class="fa-solid fa-chevron-right"></i><span></span><small>${g.rows.length}</small>`;
            head.querySelector('span').textContent = g.label;
            head.addEventListener('click', () => { if (mode.listOpen.has(g.k)) mode.listOpen.delete(g.k); else mode.listOpen.add(g.k); draw(); });
            body.append(head);
            if (!open) continue;
            for (const it of g.rows) {
                const row = document.createElement('div');
                const off = it.toggle ? it.off : !!it.obj?.off;
                row.className = `etk-tf-list-row${off ? ' etk-off' : ''}${it.sel && !it.hide ? ' interactable' : ''}`;
                row.innerHTML = `<div class="etk-tf-list-txt"><b></b><small></small></div>${it.hide ? `<div class="fa-solid fa-layer-group interactable etk-tf-list-scope" title="${it.hide === 'all' ? '이 테마에서만 숨기기로 바꾸기' : '모든 테마에서 숨기기로 바꾸기'}"></div>` : ''}${it.obj || it.toggle ? `<div class="fa-solid ${off ? 'fa-eye-slash' : 'fa-eye'} interactable etk-tf-list-off" title="${off ? '다시 켜기' : '잠깐 끄기(지우지 않고 원래 테마대로 보기)'}"></div>` : ''}<div class="fa-solid fa-xmark interactable etk-tf-list-del" title="지우기"></div>`;
                row.querySelector('b').textContent = it.name;
                row.querySelector('small').textContent = off ? `꺼 둠 · ${it.text}` : it.text;
                row.querySelector('.etk-tf-list-del').addEventListener('click', (e) => { e.stopPropagation(); remember(); it.drop(); tidy(); commit(); paintBar(); draw(); });
                row.querySelector('.etk-tf-list-off')?.addEventListener('click', (e) => { e.stopPropagation(); remember(); if (it.toggle) it.toggle(); else if (it.obj.off) delete it.obj.off; else it.obj.off = true; tidy(); commit(); draw(); });
                row.querySelector('.etk-tf-list-scope')?.addEventListener('click', (e) => { e.stopPropagation(); remember(); addHide(it.sel, it.name, it.hide !== 'all', it.obj); tidy(); commit(); paintBar(); draw(); });
                if (it.sel && !it.hide) row.addEventListener('click', () => {
                    const el = findOnScreen(it.sel);
                    if (!el) { row.querySelector('small').textContent = `지금 화면에 없어요 · ${it.text}`; return; }
                    el.scrollIntoView({ block: 'center', behavior: 'instant' });
                    const r = el.getBoundingClientRect();
                    toggleList();
                    openCard(el, r.right, r.top);
                });
                body.append(row);
            }
        }
    };
    find.addEventListener('input', draw);
    sortSel.addEventListener('change', () => { opts().listSort = sortSel.value; api.save(); draw(); });
    list.querySelector('.etk-tf-list-export').addEventListener('click', exportFit);
    list.querySelector('.etk-tf-list-import').addEventListener('click', () => importFit(draw));
    list.querySelector('.etk-tf-list-x').addEventListener('click', toggleList);
    draw();
    document.body.append(keepPanels(list));
    mode.list = list;
    paintTint();
}

// ── 지팡이 메뉴 한 줄
function addMenuItem() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;
    if (document.getElementById('etk-tf-menu-item')) return true;
    const item = document.createElement('div');
    item.id = 'etk-tf-menu-item';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-solid fa-wand-magic-sparkles extensionsMenuExtensionButton"></div>테마 맞추기';
    item.addEventListener('click', () => { globalThis.jQuery?.('#extensionsMenu').hide(); openFit(); });
    menu.append(item);
    return true;
}

// 예전 판이 메시지에서 고른 칸을 '#chat img' · '#chat div.avatar img' 처럼 저장해, 같은 #chat 안에 그려지는 홈 화면 카드에도 걸렸음 → 메시지 안(.mes)으로 좁혀 한 번 고쳐 둠
function migrateSelectors() {
    let changed = false;
    for (const t of Object.values(opts().themes)) for (const x of [...(t.styles || []), ...(t.fixes || [])]) {
        if (!/^#chat\s/.test(x.sel) || /\.mes\b|welcome|recent/i.test(x.sel)) continue;
        x.sel = x.sel === '#chat img' ? '#chat .mes div.avatar img' : x.sel.replace(/^#chat\s+/, '#chat .mes ');
        changed = true;
    }
    for (const t of Object.values(opts().themes)) if (t.noReset) { delete t.noReset; changed = true; }
    if (changed) api.save();
}
export function start(a) {
    api = a;
    try { migrateSelectors(); } catch (e) { console.warn('[Breeze] 테마 맞추기 셀렉터 고침', e); }
    style = Object.assign(document.createElement('style'), { id: 'etk-theme-fit' });
    document.head.append(style);
    off = onThemeCss(() => { refresh(); paintBar(); paintTint(); if (mode?.list) { mode.list.remove(); mode.list = null; } });
    // 채팅을 열면 아직 못 잰 메시지 사이 간격(이 기기)을 다시 잼
    const { eventSource, eventTypes: ev } = a.ctx();
    const onChat = () => { gapNoMes = false; avNoMes = false; setTimeout(build, 500); };
    if (ev?.CHAT_CHANGED) { eventSource.on(ev.CHAT_CHANGED, onChat); offChat = () => eventSource.removeListener(ev.CHAT_CHANGED, onChat); }
    let n = 0;
    const tryAdd = () => { if (!addMenuItem() && n++ < 40) setTimeout(tryAdd, 500); };
    tryAdd();
}

export function stop() {
    closeFit();
    document.getElementById('etk-tf-menu-item')?.remove();
    off?.(); off = null; offChat?.(); offChat = null;
    themeFontOff(false); style?.remove(); style = null; fixStyle?.remove(); fixStyle = null; for (const el of parts.values()) el.remove(); parts.clear();
}

// breeze 설정 창: 들어가는 버튼과 고친 목록만(조절은 화면 위에서)
export function options(box, a) {
    api ??= a;
    box.innerHTML = `
        <div class="etk-sub">지팡이 메뉴의 '테마 맞추기'를 누르거나 아래 버튼으로 시작해요. 화면에 작은 막대와 레이아웃 창이 떠요. 줄 간격 · 메시지 사이 간격 · 사진 크기를 고르고, 그걸로 안 되는 곳은 '화면에서 고르기'로 눌러 직접 고쳐요</div>
        <div class="menu_button etk-tf-open"><i class="fa-solid fa-wand-magic-sparkles"></i> 지금 테마 맞추기</div>
        <div class="etk-tf-saved"></div>`;
    box.querySelector('.etk-tf-open').addEventListener('click', openFit);
    const saved = box.querySelector('.etk-tf-saved');
    const draw = () => {
        const o = opts(), names = Object.keys(o.themes);
        saved.innerHTML = names.length ? '<div class="etk-sub">맞춰 둔 테마</div>' : '';
        for (const n of names) {
            const row = document.createElement('div');
            row.className = 'etk-flex';
            row.innerHTML = '<small></small><div class="fa-solid fa-xmark interactable etk-known-del" title="이 테마 맞춤 지우기"></div>';
            row.querySelector('small').textContent = n;
            row.querySelector('div').addEventListener('click', () => { delete o.themes[n]; a.save(); refresh(); draw(); });
            saved.append(row);
        }
    };
    draw();
}
