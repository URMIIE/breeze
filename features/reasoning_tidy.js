// 생각(추론) 칸 모양 — 여러 테마의 추론 칸을 참고한 모양 몇 가지 중 하나를 고르거나, 다른 사람이 준 CSS 를 붙여넣는다.
// 추론 칸을 직접 꾸민 테마의 모양을 덮지 않게, 지금 테마 CSS 에 추론 상자 · 머리 줄 · 추론 글 칸 자체를 꾸미는 규칙이 있으면 쉰다
// (추론 글 안 인용문 · 코드 · 수정 버튼만 손본 규칙은 셈하지 않음).
// 모양 규칙은 채팅(body.etk-reasoning-tidy.etk-rs-모양)과 설정 창 견본(.etk-rs-sample.etk-rs-모양) 둘 다에 걸리게 만든다.
import { onThemeCss, dropGoneThemes } from '../lib/theme-css.js';
import { addMaximize } from '../lib/textarea-max.js';

const BOX = /\.mes_reasoning(_details|_header[\w-]*)?(?![\w-])[^\s>+~]*$/;
const themeStyles = ({ css, rules }) => css.includes('mes_reasoning')
    && rules.some(([head]) => head.includes('mes_reasoning') && head.split(',').some(sel => BOX.test(sel.trim())));

// 아이콘은 글꼴에 기대지 않게 직접 그린 선 그림을 마스크로(글자색을 따름)
const ICON = {
    // 옆선이 살짝 볼록한 마름모(보석) — 다른 테마의 네 꼭짓점 별과 겹치지 않게 우리 표시로
    gem: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27black%27%3E%3Cpath d=%27M12 1.5C15 6 18 9 22.5 12 18 15 15 18 12 22.5 9 18 6 15 1.5 12 6 9 9 6 12 1.5Z%27/%3E%3C/svg%3E")',
    bulb: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M9.5 18h5%27/%3E%3Cpath d=%27M10.5 21h3%27/%3E%3Cpath d=%27M12 3a6 6 0 0 0-3.7 10.7c.7.6 1.2 1.4 1.2 2.3h5c0-.9.5-1.7 1.2-2.3A6 6 0 0 0 12 3Z%27/%3E%3C/svg%3E")',
    spark: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M12 3v4%27/%3E%3Cpath d=%27M12 17v4%27/%3E%3Cpath d=%27M3 12h4%27/%3E%3Cpath d=%27M17 12h4%27/%3E%3Cpath d=%27M6.3 6.3l2.5 2.5%27/%3E%3Cpath d=%27M15.2 15.2l2.5 2.5%27/%3E%3Cpath d=%27M6.3 17.7l2.5-2.5%27/%3E%3Cpath d=%27M15.2 8.8l2.5-2.5%27/%3E%3C/svg%3E")',
    chevron: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M9 6l6 6-6 6%27/%3E%3C/svg%3E")',
    plus: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M12 6v12%27/%3E%3Cpath d=%27M6 12h12%27/%3E%3C/svg%3E")',
    minus: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M6 12h12%27/%3E%3C/svg%3E")',
};
const icon = (name, size) => `content: ""; flex: none; width: ${size}; height: ${size}; background: currentColor; -webkit-mask: ${ICON[name]} center / contain no-repeat; mask: ${ICON[name]} center / contain no-repeat;`;

// 모든 모양에 공통: 실리태번 기본 상자 · 제목 · 세모를 걷어 냄
const reset = (D) => `
${D} { background: transparent !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; padding: 0 !important; margin: 0 0 12px 0 !important; }   /* 오른쪽 여백을 두지 않음 — 실리태번 기본은 오른쪽에 넘기기 화살표 자리(30px)를 비우는데, 그러면 칸(가운데 머리 줄 · 펼친 글 칸)이 왼쪽으로 치우쳐 보였음. 화살표는 메시지 맨 아래에 있어 안 겹침 */
${D} > :is(summary, .etk-summary) { list-style: none; cursor: pointer; background: transparent !important; border: 0 !important; box-shadow: none !important; padding: 0 !important; }
${D} > summary::-webkit-details-marker { display: none; }
${D} .mes_reasoning_header_title, ${D} .mes_reasoning_arrow { display: none !important; }
${D} .mes_reasoning_header_block { display: flex !important; align-items: center; width: 100%; }
${D} .mes_reasoning_header { display: inline-flex !important; align-items: center; width: auto !important; margin: 0 !important; background: transparent !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
${D} > :is(summary, .etk-summary) { position: relative; }
/* 접기 · 복사 버튼은 펼쳤을 때만 나오는데, 줄 안에 두면 나올 때마다 머리 줄이 밀리고 오른쪽 끝 버튼이 칸 밖으로 나갔음 → 머리 줄 오른쪽 위에 띄워 둠 */
${D} .mes_reasoning_actions { position: absolute !important; right: 30px; top: calc(100% + 39px); transform: none; margin: 0 !important; display: flex; gap: 4px; z-index: 1; }   /* 펼친 글 칸 안 오른쪽 위에 — 머리 줄 오른쪽 끝에 두면 가운데 제목과 떨어져 칸 밖에 붕 떠 보였음 */
${D}[open] .mes_reasoning { padding-right: 84px !important; }
/* 접힌 동안엔 숨김 — 테마가 이 버튼들을 흐리게만 해 두는 경우, 접힌 머리 줄 옆에 흐린 아이콘이 떠 있었음 */
${D}:not([open]) .mes_reasoning_actions { display: none !important; }
/* 펼쳤을 때 버튼: 테마가 흐림 효과 · 그림자를 걸어 뿌옇게 보였음 → 또렷하게, 평소엔 옅게, 올리면 진하게 */
${D} .mes_reasoning_actions .mes_button { filter: none !important; text-shadow: none !important; box-shadow: none !important; background: transparent !important; opacity: .45; font-size: .85em; padding: 2px 4px !important; margin: 0 !important; transition: opacity .15s; }
${D} .mes_reasoning_actions .mes_button:hover { opacity: .9; }
${D} .mes_reasoning { border: 0 !important; border-radius: 0 !important; box-shadow: none !important; background: transparent !important; font-size: .92em; line-height: 1.65; }
${D} .mes_reasoning > :first-child { margin-top: 0 !important; }
${D} .mes_reasoning > :last-child { margin-bottom: 0 !important; }
${D} .mes_reasoning :is(h1, h2, h3, h4, h5, h6) { font-size: 1em !important; font-weight: 600 !important; margin: .8em 0 .3em !important; line-height: 1.5 !important; }`;

const ACCENT = 'var(--SmartThemeQuoteColor, currentColor)';
const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
// 모두 가운데 정렬(쓰는 테마들의 추론 칸이 머리 줄을 가운데에 둠). 펼친 생각 글은 둥근 옅은 칸.
const center = (D) => `
${D} > :is(summary, .etk-summary) { display: flex !important; justify-content: center; }
${D} .mes_reasoning_header_block { justify-content: center; width: auto; }`;
const well = (D) => `
${D} .mes_reasoning { margin: 6px 0 0 !important; padding: 12px 16px !important; border-radius: 14px !important; background: color-mix(in srgb, currentColor 5%, transparent) !important; color: color-mix(in srgb, currentColor 70%, transparent) !important; }`;
export const STYLES = {
    star: { name: '작은 보석', make: (D) => reset(D) + center(D) + well(D) + `
${D} .mes_reasoning_header { padding: 7px 10px !important; color: color-mix(in srgb, currentColor 45%, transparent) !important; transition: color .16s; }
${D} .mes_reasoning_header::before { ${icon('gem', '10px')} opacity: .75; }
${D} > :is(summary, .etk-summary):hover .mes_reasoning_header { color: color-mix(in srgb, currentColor 75%, transparent) !important; }
${D}[open] .mes_reasoning_header { color: ${ACCENT} !important; }
${D}[open] .mes_reasoning_header::before { opacity: 1; }` },
    label: { name: '보석 + 글자', make: (D) => reset(D) + center(D) + well(D) + `
${D} .mes_reasoning_header { gap: 8px; padding: 6px 10px !important; color: color-mix(in srgb, currentColor 45%, transparent) !important; font-size: .7em; font-weight: 600; letter-spacing: .22em; transition: color .16s; }
${D} .mes_reasoning_header::before { ${icon('gem', '9px')} }
${D} .mes_reasoning_header::after { content: "THINKING"; }
${D}[open] .mes_reasoning_header { color: ${ACCENT} !important; }` },
    card: { name: '메모 카드', make: (D) => reset(D) + center(D) + `
${D} { border: 1px solid color-mix(in srgb, currentColor 14%, transparent) !important; border-radius: 8px !important; background: color-mix(in srgb, currentColor 3%, transparent) !important; overflow: hidden; }
${D} > :is(summary, .etk-summary) { padding: 6px 12px !important; }
${D} .mes_reasoning_header { gap: 8px; color: color-mix(in srgb, currentColor 50%, transparent) !important; font: 400 .72em/1.4 ${MONO}; letter-spacing: .08em; }
${D} .mes_reasoning_header::after { content: "notes"; }
${D} .mes_reasoning_header_block::after { content: "+"; margin-left: 8px; font: 400 .8em/1 ${MONO}; opacity: .5; }
${D}[open] .mes_reasoning_header_block::after { content: "−"; }
${D} .mes_reasoning { margin: 0 !important; padding: 10px 14px 12px !important; border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent) !important; color: color-mix(in srgb, currentColor 72%, transparent) !important; }` },
    rule: { name: '가는 선', make: (D) => reset(D) + well(D) + `
${D} > :is(summary, .etk-summary) { display: flex !important; justify-content: center; }
${D} .mes_reasoning_header_block { width: 100%; gap: 12px; }
${D} .mes_reasoning_header_block::before, ${D} .mes_reasoning_header_block::after { content: ""; flex: 1; height: 1px; background: color-mix(in srgb, currentColor 14%, transparent); }
${D} .mes_reasoning_header { flex: none; gap: 7px; padding: 6px 0 !important; color: color-mix(in srgb, currentColor 45%, transparent) !important; font-size: .68em; font-weight: 600; letter-spacing: .24em; transition: color .16s; }
${D} .mes_reasoning_header::before { ${icon('gem', '8px')} }
${D} .mes_reasoning_header::after { content: "THINKING"; }
${D}[open] .mes_reasoning_header { color: ${ACCENT} !important; }` },
};
const where = (key) => `:is(body.etk-reasoning-tidy.etk-rs-${key} #chat#chat .mes, .etk-rs-sample.etk-rs-${key}) .mes_reasoning_details`;
const ALL_CSS = Object.entries(STYLES).map(([k, v]) => v.make(where(k))).join('\n') + '\nbody.etk-rs-switching #chat .mes_reasoning_details, body.etk-rs-switching #chat .mes_reasoning_details * { transition: none !important; animation: none !important; }';

let style = null, custom = null, off = null, api = null, lastTheme = null;
// 테마가 추론 칸을 꾸미면 쉬는 게 기본 — 테마마다 ‘이 테마에서는 breeze 모양 쓰기’를 고를 수 있음(옵션 overrideThemes = 테마 이름 목록)
const themeName = () => String(api?.ctx().powerUserSettings?.theme || '').normalize('NFC');
const overrides = () => { if (!api) return []; const o = api.options(); o.overrideThemes ??= []; return o.overrideThemes; };
function applyRest() {
    const override = overrides().includes(themeName());
    const mine = override || !(lastTheme && themeStyles(lastTheme));
    document.body.classList.toggle('etk-reasoning-tidy', mine);
    api?.rest?.(mine ? null : 'same');   // 테마가 추론 칸을 꾸며서 쉬는 중
}
const pick = () => (STYLES[api?.options().look] ? api.options().look : 'star');

// 붙여넣은 CSS 는 그대로 쓰되, 테마가 추론 칸을 꾸밀 때는 빠지게 ‘breeze가 추론 칸을 맡을 때’ 안으로 감싸 넣음
function applyCustom() {
    const css = api?.options().css?.trim();
    custom ??= Object.assign(document.createElement('style'), { id: 'etk-reasoning-custom' });
    if (!custom.isConnected) document.head.append(custom);
    custom.textContent = css ? `body.etk-reasoning-tidy { ${css} }` : '';
    document.body.classList.toggle('etk-rs-custom', !!css);
}
function applyLook() {
    // 바꾸는 순간엔 색이 서서히 바뀌는 효과를 꺼서 한 화면에 싹 바뀌게(메시지마다 조금씩 늦게 바뀌어 보였음)
    document.body.classList.add('etk-rs-switching');
    for (const k of Object.keys(STYLES)) document.body.classList.toggle(`etk-rs-${k}`, !api?.options().css?.trim() && k === pick());
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('etk-rs-switching')));
}

export function start(a) {
    api = a;
    style = Object.assign(document.createElement('style'), { id: 'etk-reasoning-tidy', textContent: ALL_CSS });
    document.head.append(style);
    applyCustom(); applyLook();
    off = onThemeCss(info => { lastTheme = info; applyRest(); });
}

export function stop() {
    off?.(); off = null;
    style?.remove(); style = null;
    custom?.remove(); custom = null;
    document.body.classList.remove('etk-reasoning-tidy', 'etk-rs-custom', ...Object.keys(STYLES).map(k => `etk-rs-${k}`));
}

// 견본은 <details> 대신 <div>(실리태번이 화면의 추론 칸 <details> 를 메시지 기록대로 닫아 버림). [open] 꼴은 같은 규칙에 걸림
const SAMPLE_CLOSED = `<div class="mes_reasoning_details" data-has-content="true"><div class="etk-summary"><div class="mes_reasoning_header_block"><div class="mes_reasoning_header"></div></div></div></div>`;
const SAMPLE_OPEN = `<div class="mes_reasoning_details" data-has-content="true" open><div class="etk-summary"><div class="mes_reasoning_header_block"><div class="mes_reasoning_header"></div></div></div><div class="mes_reasoning"><p>Considering the scene and the next line…</p></div></div>`;

export function options(box, a) {
    api ??= a;
    const o = a.options();
    box.innerHTML = `
        <div class="etk-rs-list">${Object.entries(STYLES).map(([k, v]) => `
            <label class="etk-rs-tile" data-look="${k}"><input type="radio" name="etk-rs-look" value="${k}">
                <span class="etk-rs-title">${v.name}</span>
                <div class="etk-rs-sample etk-rs-${k}">${SAMPLE_OPEN}</div></label>`).join('')}</div>
        <div class="etk-sub">테마가 추론 칸을 직접 꾸미면 테마 모양을 그대로 써요. 아래에서 고른 테마만 breeze 모양으로 덮어요</div>
        <div class="etk-rs-themes"></div>
        <details class="etk-advanced"><summary>내 CSS 로 직접 꾸미기</summary>
            <small>갖고 있는 추론 칸 CSS를 넣으면 위에서 고른 모양 대신 이걸로 꾸며요. 비우면 고른 모양으로 돌아가요</small>
            <textarea class="text_pole" rows="6" placeholder="여기에 CSS 붙여넣기"></textarea>
        </details>`;
    addMaximize(box);
    const paint = () => {
        const usingCustom = !!o.css?.trim();
        box.querySelectorAll('.etk-rs-tile').forEach(t => { t.querySelector('input').checked = t.dataset.look === pick(); t.classList.toggle('etk-dim', usingCustom); });
    };
    paint();
    box.querySelectorAll('.etk-rs-tile input').forEach(r => r.addEventListener('change', () => { o.look = r.value; a.save(); applyLook(); paint(); }));
    const themesBox = box.querySelector('.etk-rs-themes');
    const drawThemes = () => {
        if (dropGoneThemes(overrides())) a.save();
        const now = themeName(), list = overrides();
        const styled = !!(lastTheme && themeStyles(lastTheme));
        themesBox.innerHTML = '';
        const cur = document.createElement('label');
        cur.className = 'checkbox_label';
        cur.innerHTML = '<input type="checkbox"><span></span>';
        cur.querySelector('span').textContent = `지금 테마(${now || '기본'})${styled ? '' : '. 이 테마는 추론 칸을 꾸미지 않아서 breeze 모양으로 보여요'}`;
        const cb = cur.querySelector('input');
        cb.checked = list.includes(now) || !styled;
        cb.disabled = !styled;
        cb.addEventListener('change', () => { o.overrideThemes = cb.checked ? [...new Set([...list, now])] : list.filter(t => t !== now); a.save(); applyRest(); drawThemes(); });
        themesBox.append(cur);
        const rows = document.createElement('div');
        rows.className = 'etk-theme-rows';
        themesBox.append(rows);
        for (const t of list.filter(t => t !== now)) {
            const row = document.createElement('div');
            row.className = 'etk-flex';
            row.innerHTML = '<small></small><div class="fa-solid fa-xmark interactable etk-known-del" title="목록에서 빼기"></div>';
            row.querySelector('small').textContent = t;
            row.querySelector('div').addEventListener('click', () => { o.overrideThemes = overrides().filter(x => x !== t); a.save(); applyRest(); drawThemes(); });
            rows.append(row);
        }
    };
    drawThemes();
    const ta = box.querySelector('textarea');
    ta.value = o.css || '';
    if (o.css?.trim()) box.querySelector('details').open = true;
    ta.addEventListener('input', () => { o.css = ta.value; a.save(); applyCustom(); applyLook(); paint(); });
}
