// 요술봉 앱 서랍 모양. 기능을 켤 때 <style> 로 붙이고 끌 때 뗀다(확장 공용 style.css 에 두면 꺼도 남음).
// 바탕 · 글자색은 테마 변수를 따름: 흰 유리 · 흰 글자로 두었더니 밝은 테마에서 글자가 안 읽혔음.
// 창은 화면에 떠 있는 다른 확장 그림보다 위에 와야 해서 z-index 를 높게(떠 있는 공 그림을 담은 통이 z-index 2000000 이라 40000 · 99990 이던 창을 덮었음).
// 그래서 알림(toastr) · 그림 생성 옆 메뉴보다도 위에 옴: 창이 그 자리에 겹쳐 열려 있을 때만 가려짐
export const CSS = `
html.bw-on #extensionsMenu { opacity: 0 !important; pointer-events: none !important; }
html.bw-probe #extensionsMenu {
    display: flex !important; position: fixed !important; inset: auto !important; margin: 0 !important;
    left: var(--bw-px) !important; top: var(--bw-py) !important; transform: none !important;
}
.bw-glass {
    position: fixed; left: 0; top: 0; z-index: 2000010; box-sizing: border-box;
    color: var(--SmartThemeBodyColor);
    background: color-mix(in srgb, var(--bw-color) var(--bw-mix), transparent);
    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 16%, transparent);
    box-shadow: 0 18px 50px rgba(0, 0, 0, .28);
    -webkit-backdrop-filter: blur(var(--bw-blur)) saturate(1.4);
    backdrop-filter: blur(var(--bw-blur)) saturate(1.4);
}
.bw-glass[hidden] { display: none !important; }
#bw_win { display: flex; flex-direction: column; border-radius: 26px; min-width: 150px; min-height: 160px; }
#bw_win.bw-look-b { border-radius: 30px; border-color: color-mix(in srgb, var(--SmartThemeBodyColor) 22%, transparent); }
#bw_win.bw-moving { transition: none; will-change: transform; }

.bw-head {
    flex: none; height: 30px; display: grid; grid-template-columns: 34px 1fr 34px; align-items: center;
    padding: 0 8px; cursor: grab; touch-action: none; user-select: none;
}
.bw-grip { justify-self: center; width: 38px; height: 5px; border-radius: 3px; background: currentColor; opacity: .7; }
.bw-hbtn {
    position: relative; justify-self: center; width: 30px; height: 30px; display: grid; place-items: center;
    border: 0; border-radius: 15px; background: none; color: inherit; font-size: 12px; opacity: .6; cursor: pointer; padding: 0;
}
.bw-hbtn::after { content: ''; position: absolute; inset: -7px; }
.bw-hbtn.bw-pin-on { opacity: 1; background: color-mix(in srgb, var(--SmartThemeBodyColor) 22%, transparent); }
.bw-done { justify-self: end; width: auto; padding: 0 6px; font-size: 12px; font-weight: 700; opacity: 1; white-space: nowrap; }

.bw-grid {
    flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(var(--bw-icon) + 10px), 1fr));
    gap: 14px 4px; padding: 6px 12px 10px; align-content: start; touch-action: pan-y;
}
.bw-app {
    position: relative; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 5px;
    font-size: var(--bw-font); font-weight: 700; line-height: 1.2; text-align: center; cursor: pointer; user-select: none;
    /* 비쳐 보이는 채팅 글과 겹쳐도 이름이 읽히게 바탕색으로 옅은 테두리 빛(아이콘 그림에는 안 번지게 .bw-ic 에서 끔) */
    text-shadow: 0 0 6px var(--SmartThemeBlurTintColor), 0 0 2px var(--SmartThemeBlurTintColor);
    -webkit-tap-highlight-color: transparent;
}
.bw-label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bw-ic {
    width: var(--bw-icon); height: var(--bw-icon); border-radius: calc(var(--bw-icon) * .27); flex: none; box-sizing: border-box;
    display: grid; place-items: center; overflow: hidden; font-size: calc(var(--bw-icon) * .42); text-shadow: none;
    background: var(--bw-ic-bg); color: var(--bw-ic-fg); border: var(--bw-ic-border); box-shadow: var(--bw-ic-shadow);
}
/* 색 3: 반투명 흰 타일에 그림만 테마 강조색 */
.bw-tone-c3 .bw-ic {
    --bw-ic-bg: color-mix(in srgb, #fff 62%, transparent); --bw-ic-fg: var(--SmartThemeQuoteColor);
    --bw-ic-border: 1px solid rgba(255, 255, 255, .7); --bw-ic-shadow: 0 2px 6px rgba(60, 40, 20, .18);
}
/* 색 4: 아이콘마다 두 색이 섞이는 연한 그라데이션, 그림은 흰색 */
.bw-tone-c4 .bw-ic {
    --bw-ic-bg: linear-gradient(135deg, color-mix(in oklch, var(--v1) 72%, #fff), color-mix(in oklch, var(--v2) 72%, #fff));
    --bw-ic-fg: #fff; --bw-ic-border: 0; --bw-ic-shadow: 0 2px 6px rgba(60, 40, 20, .18);
}
.bw-ic svg, .bw-ic > img:not(.bw-full) { width: 55%; height: 55%; object-fit: contain; fill: currentColor; }
.bw-ic img.bw-full { width: 100%; height: 100%; object-fit: cover; }
/* 폴더 타일: 안에 든 아이콘 넷까지 2x2 로 작게(그 아이콘의 타일 그대로). 모양 나에서는 아래 .bw-look-b 규칙이 단색 둥근 꼴로 덮음 */
.bw-ic.bw-fold {
    display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; place-items: stretch;
    gap: calc(var(--bw-icon) * .08); padding: calc(var(--bw-icon) * .16);
    --bw-ic-bg: color-mix(in srgb, #fff 55%, transparent); --bw-ic-border: 0; --bw-ic-shadow: 0 2px 6px rgba(60, 40, 20, .18);
}
.bw-fold > .bw-mini {
    width: auto; height: auto; min-width: 0; min-height: 0; border-radius: calc(var(--bw-icon) * .1);
    font-size: calc(var(--bw-icon) * .14); box-shadow: none;
}
.bw-fold > .bw-mini img, .bw-fold > .bw-mini svg { width: 70%; height: 70%; }
.bw-look-b .bw-ic {
    border-radius: 50%; --bw-ic-fg: var(--SmartThemeBodyColor); --bw-ic-shadow: none;
    --bw-ic-bg: color-mix(in srgb, var(--SmartThemeBodyColor) 14%, transparent);
    --bw-ic-border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 20%, transparent);
}
.bw-look-b .bw-on .bw-ic { --bw-ic-bg: var(--SmartThemeBodyColor); --bw-ic-fg: var(--SmartThemeBlurTintColor); }
.bw-app:active .bw-ic { filter: brightness(.9); }

.bw-x {
    text-shadow: none; position: absolute; top: -5px; left: calc(50% - var(--bw-icon) / 2 - 5px); z-index: 2;
    width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center;
    background: rgba(40, 40, 46, .88); color: #fff; font-size: 8px;
}
.bw-x::after { content: ''; position: absolute; inset: -8px; }
#bw_win:not(.bw-editing) .bw-x, .bw-sheet .bw-x, #bw_dock .bw-x { display: none; }
.bw-editing .bw-app { touch-action: none; }
.bw-editing .bw-app.bw-drag { z-index: 5; pointer-events: none; opacity: .85; }
.bw-editing .bw-app.bw-drop > .bw-ic { outline: 2px solid currentColor; outline-offset: 2px; }
/* 아이콘 한가운데에 겹쳐 놓으면 폴더가 된다: 자리 바꾸기(테두리 선)와 다르게 둘레에 옅은 판이 번짐 */
.bw-editing .bw-app.bw-merge > .bw-ic { outline: none; box-shadow: 0 0 0 7px color-mix(in srgb, var(--SmartThemeBodyColor) 26%, transparent); }
/* 꾸미기 중엔 아이콘 그림만 흔들림(이름 글은 그대로) */
@keyframes bw-calm {
    0% { transform: rotate(-1.9deg); }
    50% { transform: rotate(1.9deg); }
    100% { transform: rotate(-1.9deg); }
}
.bw-editing .bw-app:not(.bw-drag) > .bw-ic { animation: bw-calm .26s ease-in-out infinite; }
.bw-editing .bw-app:nth-child(2n) > .bw-ic { animation-delay: -.13s; }
.bw-editing .bw-app:nth-child(3n) > .bw-ic { animation-delay: -.065s; }
@media (prefers-reduced-motion: reduce) { .bw-editing .bw-app > .bw-ic { animation: none; } }

.bw-rs {
    position: absolute; right: 7px; bottom: 7px; width: 16px; height: 16px; cursor: nwse-resize; touch-action: none;
    border-right: 3px solid currentColor; border-bottom: 3px solid currentColor; border-radius: 0 0 10px 0; opacity: .8;
}
.bw-rs::after { content: ''; position: absolute; inset: -12px; }

.bw-sheet {
    /* 꾸미는 동안 창이 펼친 내용만큼 커지지만(wand_window.js fitEdit), 화면이 더 작으면 아래 칸이 안에서 스크롤 */
    flex: 0 0 auto; min-height: 0; max-height: calc(100% - 30px - var(--bw-icon) - 34px); overflow-y: auto; overscroll-behavior: contain;
    padding: 0 12px 12px; display: grid; gap: 10px; font-size: 11.5px; text-shadow: none;
}
.bw-sheet[hidden] { display: none; }
.bw-tip { opacity: .8; line-height: 1.45; }
.bw-tip-center { font-size: 10.5px; opacity: .7; text-align: center; }
.bw-tabs { display: flex; gap: 6px; }
.bw-tab, .bw-seg-btn {
    flex: 1; min-width: 0; height: 30px; padding: 0 4px; border: 0; border-radius: 15px; white-space: nowrap;
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 9%, transparent); color: inherit;
    font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer;
}
.bw-seg-btn { height: 28px; }
.bw-tab.bw-sel, .bw-seg-btn.bw-sel { background: var(--SmartThemeBodyColor); color: var(--SmartThemeBlurTintColor); }
.bw-pane {
    border-radius: 14px; padding: 10px 12px; display: grid; gap: 9px;
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 7%, transparent);
}
.bw-seg { display: grid; grid-template-columns: 62px 1fr 1fr; gap: 6px; align-items: center; }
.bw-sl { display: grid; grid-template-columns: 62px 1fr; align-items: center; gap: 8px; }
.bw-sl input { width: 100%; height: 28px; margin: 0; accent-color: var(--SmartThemeBodyColor); }
.bw-line {
    display: flex; justify-content: space-between; align-items: center; min-height: 32px; padding: 0; gap: 8px;
    border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.bw-sw { flex: none; position: relative; width: 34px; height: 20px; border-radius: 10px; background: color-mix(in srgb, var(--SmartThemeBodyColor) 25%, transparent); }
.bw-sw::after { content: ''; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px; border-radius: 8px; background: #fff; transition: transform .14s; }
.bw-sw.bw-sw-on { background: var(--SmartThemeBodyColor); }
.bw-sw.bw-sw-on::after { transform: translateX(14px); }
.bw-swatch { flex: none; width: 22px; height: 22px; border-radius: 11px; border: 1px solid rgba(0, 0, 0, .15); }
.bw-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.bw-btn {
    min-height: 30px; padding: 0 12px; border: 0; border-radius: 15px; display: inline-flex; align-items: center; gap: 6px;
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 16%, transparent); color: inherit;
    font: inherit; font-weight: 600; cursor: pointer;
}
.bw-btn.bw-sel { background: var(--SmartThemeBodyColor); color: var(--SmartThemeBlurTintColor); }
.bw-field { display: grid; grid-template-columns: 52px 1fr; gap: 8px; align-items: center; }
.bw-field input[type="text"] {
    min-width: 0; height: 30px; padding: 0 8px; border-radius: 8px; box-sizing: border-box; font: inherit;
    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 28%, transparent); background: transparent; color: inherit;
}
.bw-field input[type="color"] { width: 44px; height: 30px; padding: 0; border: 0; background: none; }
.bw-check { display: flex; gap: 8px; align-items: center; min-height: 30px; }
.bw-sheet h4 { margin: 0; font-size: 12px; }
.bw-hidden-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(var(--bw-icon) + 10px), 1fr)); gap: 10px 4px; }
.bw-color-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

.bw-pop {
    position: absolute; left: 12px; right: 12px; top: 54px; z-index: 6; max-height: calc(100% - 70px); overflow-y: auto;
    padding: 12px; border-radius: 22px; box-sizing: border-box;
    background: color-mix(in srgb, var(--bw-color) 88%, transparent);
    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 20%, transparent);
    -webkit-backdrop-filter: blur(26px); backdrop-filter: blur(26px);
}
.bw-pop h4 { margin: 0 0 10px; font-size: 13px; text-align: center; }
.bw-pop .bw-grid { padding: 0; overflow: visible; grid-template-columns: repeat(3, 1fr); }
.bw-out {
    text-shadow: none; position: absolute; top: -5px; left: calc(50% + var(--bw-icon) / 2 - 11px); z-index: 2;
    width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center;
    background: rgba(40, 40, 46, .88); color: #fff; font-size: 8px;
}
.bw-out::after { content: ''; position: absolute; inset: -8px; }
#bw_win.bw-folder-open > .bw-grid { opacity: .45; }

.bw-hint {
    position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 7; max-width: calc(100% - 24px);
    padding: 6px 10px; border-radius: 10px; font-size: 11.5px; line-height: 1.4; text-align: center; pointer-events: none;
    background: var(--SmartThemeBlurTintColor); border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 20%, transparent);
    animation: bw-fade 2.6s forwards;
}
@keyframes bw-fade { 0%, 80% { opacity: 1; } 100% { opacity: 0; } }

#bw_dock { display: flex; align-items: center; gap: 8px; padding: 7px 10px 7px 4px; border-radius: 22px; }
.bw-dock-grip { align-self: stretch; width: 16px; display: grid; place-items: center; cursor: grab; touch-action: none; }
.bw-dock-grip::before { content: ''; width: 4px; height: 22px; border-radius: 2px; background: currentColor; opacity: .5; }
#bw_dock .bw-app { --bw-icon: 44px; }
#bw_dock .bw-label { display: none; }
.bw-dock-empty { font-size: 12px; padding: 0 6px; max-width: 200px; line-height: 1.4; }
`;
