// 로딩 화면 바꾸기 — 실리태번을 켤 때 뜨는 로딩 화면의 배경색 · 배경 그림 · 로고 · 문구를 바꾼다.
// 로딩 화면은 확장이 불러와지기 전에 지나가므로 확장 코드로는 못 바꾼다. 그래서 고른 내용을 CSS 로 만들어 사용자 파일
// (user/files/breeze-splash.css)로 저장해 두고, 실리태번이 가장 먼저 읽는 사용자 CSS(css/user.css)가 그 파일을 읽게 한다.
// css/user.css 에 읽기 줄을 넣는 건 짝 서버 플러그인이 하고, 플러그인이 없으면 넣을 줄을 안내한다.
// 테마에 자기 로딩 화면이 있으면(테마 CSS 에 #preloader · .splash-* 규칙) 그 테마가 뜬 뒤엔 쉰다(html.etk-theme-splash).
// 다른 확장이 로딩 화면을 바꾸고 있어도 쉰다: 켤 때 한 번, 화면이 한가할 때 실리태번 기본 · 우리 파일이 아닌 스타일시트에 #preloader 규칙이 있는지 찾아본다.
import { onThemeCss, appliedTheme, dropGoneThemes } from '../lib/theme-css.js';
import { saveUserFile, pickFile, extOf, embedFiles, restoreFiles, downloadText } from '../lib/files.js';
import { addMaximize } from '../lib/textarea-max.js';

const FILE = 'breeze-splash.css';
const IMPORT_LINE = `@import url("/user/files/${FILE}");`;
const THEME_SPLASH = /(#preloader|\.splash-screen|\.splash-message)[^{}]*\{/;
const ON = 'html:not(.etk-theme-splash)';
// 기본 로딩 화면 — 고양이. 고양이 그림 · 글꼴은 공유해도 되는 사용권으로 풀린 것을 확장 폴더(assets/loading)에 넣어 씀
// (출처 · 사용권은 assets/loading/SOURCES.md). 바깥에서 받아 오는 것 없음. 실리태번 로고 · 이름은 넣지 않음.
// 로딩 화면 파일은 확장보다 먼저 읽히므로 그림 주소는 확장 폴더의 절대 주소로 적음.
// 확장 폴더 이름은 설치한 주소에 따라 달라지므로(저장소 이름) 이 파일 자리에서 찾음
const ASSET = new URL('../assets/loading/', import.meta.url).pathname;
const BASE = `
${ON} .popup:has(#loader.splash-screen) { padding: 0 !important; border: 0 !important; border-radius: 0 !important; background: transparent !important; box-shadow: none !important; }
${ON} .popup:has(#loader.splash-screen)::backdrop { background: transparent !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
${ON} .popup:has(#loader.splash-screen), ${ON} .popup:has(#loader.splash-screen)[opening] { animation: none !important; transition: none !important; }   /* 실리태번 팝업이 열리며 세로로 늘어나는 움직임(pop-in) 동안 글자가 납작 · 흐릿하다가 끝나면 갑자기 또렷(진하게) 보였음 */
${ON} #preloader { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
${ON} #loader.splash-screen { gap: 0 !important; filter: none !important; }
${ON} #loader.splash-screen, ${ON} #loader.splash-screen * { text-shadow: none !important; }
${ON} #loader.splash-screen .splash-logo { display: none !important; }
${ON} #loader.splash-screen .splash-message { order: 2; display: block !important; margin: 0 !important; font-size: 0 !important; line-height: 0 !important; letter-spacing: 0 !important; opacity: 1 !important; text-align: center !important; }
${ON} #loader.splash-screen .splash-message::before { display: block; }
${ON} #loader.splash-screen #load-spinner { display: none !important; }
@media (prefers-reduced-motion: reduce) { ${ON} #preloader, ${ON} #loader.splash-screen, ${ON} #loader.splash-screen * { animation: none !important; } }`;
const SYSTEM = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const CARD = 'position: fixed !important; left: 50% !important; top: 50% !important; transform: translate(-50%, -50%) !important; width: auto !important; height: auto !important; box-sizing: border-box;';
// 글 뒤 점 셋이 하나씩 늘어남(글자 폭만큼 잘라 보이기)
// 점 셋: ... → .. → . → .. → ... 처럼 줄었다 늘었다(같은 폭에서 오른쪽을 1/3씩 가림 — 폭을 바꾸면 점이 반쯤 잘리고 줄도 흔들렸음)
const DOTS = 'content: "..."; display: block; white-space: nowrap; animation: etk-dots 1.6s infinite;';
const DOTS_KF = '@keyframes etk-dots { 0%, 24.9% { clip-path: inset(0 0 0 0); } 25%, 49.9% { clip-path: inset(0 33.3% 0 0); } 50%, 74.9% { clip-path: inset(0 66.7% 0 0); } 75%, 100% { clip-path: inset(0 33.3% 0 0); } }';
const LOOKS = {
    // 고양이: 둥근 작은 창 안을 도트 고양이가 걷고 발밑 땅이 뒤로 흘러감, 창 안 하늘(낮 구름 흐름 · 밤 달과 별 깜박임)은 로고 그림 자리에 그림.
    // 아래 줄 오른쪽 걸음 수는 1초마다 하나씩 올라감(실제 지난 초와 같게). 땅은 #load-spinner 를 빌려 씀(톱니 회전을 끄고 배경으로)
    // 창틀은 실리태번 로딩 팝업(.popup)에 입힘 — 미리보기 틀에도 같은 팝업 껍데기를 둠
    cat: { name: '고양이 · 낮', note: '밝은 창 안을 걷는 고양이', css: `${BASE}
@font-face{font-family:"breeze-mono";src:url("${ASSET}JetBrainsMono-Italic.woff2") format("woff2");font-style:italic;font-weight:500;font-display:block}
${ON} #preloader{background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .06 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"),radial-gradient(ellipse 55% 50% at 50% 50%,var(--etk-glow,rgba(255,255,255,.75)),transparent 70%),radial-gradient(circle,rgba(40,34,24,.11) 1px,transparent 1.2px) 0 0/18px 18px,#e8e5df!important;color:#24221f!important}
${ON} #preloader::before,${ON} #preloader::after{content:none!important}
${ON} .popup:has(#loader.splash-screen){position:fixed!important;box-sizing:border-box!important;width:min(86vw,420px)!important;min-width:0!important;max-width:min(86vw,420px)!important;height:262px!important;min-height:0!important;padding:0!important;overflow:hidden!important;border:1px solid rgba(36,34,31,.78)!important;border-radius:12px!important;background:#fcfbf8!important;box-shadow:0 1px 2px rgba(40,34,24,.06),0 14px 28px -10px rgba(40,34,24,.16),0 44px 90px -30px rgba(40,34,24,.32)!important;animation:etk-cat-in .8s cubic-bezier(.2,.7,.2,1) both!important}
${ON} .popup:has(#loader.splash-screen)::before{content:"daytime walk"!important;position:absolute!important;z-index:4;top:0;left:0;right:0;box-sizing:border-box;height:32px;border-bottom:1px solid rgba(36,34,31,.13);background:#fcfbf8!important;text-align:center;color:#24221f;font:italic 500 12px/31px "breeze-mono",ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.04em}
${ON} .popup:has(#loader.splash-screen)::after{content:"ON THE WAY"!important;position:absolute!important;z-index:4;left:0;right:0;bottom:0;box-sizing:border-box;height:28px;padding:0 14px;border-top:1px solid rgba(36,34,31,.13);background:#fcfbf8;text-align:left!important;color:#7d7a73;font:500 10px/27px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.16em}
${ON} #loader.splash-screen{position:absolute!important;inset:32px 0 28px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:0!important;width:auto!important;height:auto!important;margin:0!important;padding:8px 0 6px!important;background:none!important;color:#24221f!important}
/* 창 안 하늘: 로고 그림 자리에 도트 하늘을 그려 넣음(낮 구름 흐름 · 밤 별 깜박임) */
${ON} #loader.splash-screen .splash-logo{display:block!important;content:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 140 30' shape-rendering='crispEdges'%3E%3Cg%3E%3Crect x='3' y='0' width='4' height='1' fill='%23e4e0d7'/%3E%3Crect x='1' y='1' width='8' height='1' fill='%23e4e0d7'/%3E%3Crect x='10' y='1' width='2' height='1' fill='%23e4e0d7'/%3E%3Crect x='0' y='2' width='12' height='1' fill='%23e4e0d7'/%3E%3CanimateTransform attributeName='transform' type='translate' from='-16 6' to='144 6' dur='46s' begin='-14s' repeatCount='indefinite'/%3E%3C/g%3E%3Cg%3E%3Crect x='2' y='0' width='3' height='1' fill='%23e4e0d7'/%3E%3Crect x='0' y='1' width='8' height='1' fill='%23e4e0d7'/%3E%3CanimateTransform attributeName='transform' type='translate' from='-16 15' to='144 15' dur='64s' begin='-40s' repeatCount='indefinite'/%3E%3C/g%3E%3Cg%3E%3Crect x='3' y='0' width='4' height='1' fill='%23e4e0d7'/%3E%3Crect x='1' y='1' width='8' height='1' fill='%23e4e0d7'/%3E%3Crect x='10' y='1' width='2' height='1' fill='%23e4e0d7'/%3E%3Crect x='0' y='2' width='12' height='1' fill='%23e4e0d7'/%3E%3CanimateTransform attributeName='transform' type='translate' from='-16 21' to='144 21' dur='80s' begin='-66s' repeatCount='indefinite'/%3E%3C/g%3E%3C/svg%3E");position:absolute!important;left:0;top:6px;width:100%!important;height:90px!important;max-width:none!important;margin:0!important;object-fit:cover;image-rendering:pixelated;opacity:1;pointer-events:none;z-index:0;filter:none!important}
${ON} #loader.splash-screen::before{content:""!important;order:1;flex:none;position:relative;z-index:1;width:150px;height:150px;margin:-42px 0 -15px;background:url("${ASSET}cat-walk.png") 0 0/1200px 150px no-repeat;image-rendering:pixelated;filter:none;animation:etk-cat-walk .9s steps(8) infinite}
/* 발밑 땅: 고양이 걸음에 맞춰 뒤로 흘러감, 양 끝은 흐리게 */
${ON} #loader.splash-screen #load-spinner{display:block!important;order:1;position:relative!important;inset:auto!important;width:76%!important;height:24px!important;margin:-57px 0 24px!important;font-size:0!important;line-height:0!important;transform:none!important;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='8' shape-rendering='crispEdges'%3E%3Crect x='0' y='7' width='82' height='1' fill='rgba(36,34,31,.28)'/%3E%3Crect x='85' y='7' width='35' height='1' fill='rgba(36,34,31,.28)'/%3E%3Crect x='18' y='5' width='2' height='2' fill='rgba(36,34,31,.22)'/%3E%3Crect x='70' y='4' width='1' height='3' fill='rgba(36,34,31,.22)'/%3E%3Crect x='72' y='5' width='1' height='2' fill='rgba(36,34,31,.22)'/%3E%3Crect x='108' y='6' width='3' height='1' fill='rgba(36,34,31,.22)'/%3E%3C/svg%3E") 0 0/360px 24px repeat-x;image-rendering:pixelated;-webkit-mask:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);mask:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);animation:etk-cat-ground 2.4s linear infinite!important}
${ON} #loader.splash-screen #load-spinner::before{content:none!important}
${ON} #loader.splash-screen .splash-message{order:2;position:relative;z-index:1;display:flex!important;flex-direction:column;align-items:center;gap:12px;width:100%;margin:0!important;font-size:0!important}
${ON} #loader.splash-screen .splash-message::after{content:""!important;order:1;display:block;width:min(56%,210px);height:2px;border-radius:2px;background:linear-gradient(#24221f,#24221f) 0 0/28% 2px no-repeat,linear-gradient(rgba(36,34,31,.13),rgba(36,34,31,.13)) 0 50%/100% 1px no-repeat;animation:etk-cat-bar 1.6s cubic-bezier(.6,0,.4,1) infinite}
${ON} #loader.splash-screen .splash-message::before{content:"LOADING"!important;order:2;display:block;color:#7d7a73;font:500 10px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.32em;margin-right:-.32em;animation:etk-cat-breathe 2.4s ease-in-out infinite}
@property --etk-steps{syntax:"<integer>";inherits:false;initial-value:0}
${ON} #loader.splash-screen::after{content:"STEPS " counter(etk-steps)!important;counter-reset:etk-steps var(--etk-steps);position:absolute;z-index:5;right:14px;bottom:-28px;color:#7d7a73;font:500 10px/27px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.16em;font-variant-numeric:tabular-nums;animation:etk-cat-steps 1000s steps(1000, end) infinite}
@keyframes etk-cat-steps{to{--etk-steps:1000}}
@keyframes etk-cat-walk{to{background-position:-1200px 0}}
@keyframes etk-cat-ground{to{background-position:-360px 0}}
@keyframes etk-cat-bar{from{background-position:-39% 0,0 50%}to{background-position:139% 0,0 50%}}
@keyframes etk-cat-breathe{50%{opacity:.45}}
@keyframes etk-cat-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){${ON} .popup:has(#loader.splash-screen),${ON} #loader.splash-screen::before,${ON} #loader.splash-screen #load-spinner,${ON} #loader.splash-screen .splash-message::before,${ON} #loader.splash-screen .splash-message::after{animation:none!important}}` },
    cat_night: { name: '고양이 · 밤', note: '어두운 창 안을 걷는 고양이', css: `${BASE}
@font-face{font-family:"breeze-mono";src:url("${ASSET}JetBrainsMono-Italic.woff2") format("woff2");font-style:italic;font-weight:500;font-display:block}
${ON} #preloader{background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .06 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"),radial-gradient(ellipse 55% 50% at 50% 50%,var(--etk-glow,rgba(120,128,170,.12)),transparent 70%),radial-gradient(circle,rgba(236,232,224,.08) 1px,transparent 1.2px) 0 0/18px 18px,#111216!important;color:#ece8e0!important}
${ON} #preloader::before,${ON} #preloader::after{content:none!important}
${ON} .popup:has(#loader.splash-screen){position:fixed!important;box-sizing:border-box!important;width:min(86vw,420px)!important;min-width:0!important;max-width:min(86vw,420px)!important;height:262px!important;min-height:0!important;padding:0!important;overflow:hidden!important;border:1px solid rgba(236,232,224,.55)!important;border-radius:12px!important;background:#1a1b20!important;box-shadow:0 1px 2px rgba(0,0,0,.4),0 18px 36px -12px rgba(0,0,0,.5),0 50px 100px -30px rgba(0,0,0,.7)!important;animation:etk-cat-in .8s cubic-bezier(.2,.7,.2,1) both!important}
${ON} .popup:has(#loader.splash-screen)::before{content:"night walk"!important;position:absolute!important;z-index:4;top:0;left:0;right:0;box-sizing:border-box;height:32px;border-bottom:1px solid rgba(236,232,224,.12);background:#1a1b20!important;text-align:center;color:#ece8e0;font:italic 500 12px/31px "breeze-mono",ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.04em}
${ON} .popup:has(#loader.splash-screen)::after{content:"ON THE WAY"!important;position:absolute!important;z-index:4;left:0;right:0;bottom:0;box-sizing:border-box;height:28px;padding:0 14px;border-top:1px solid rgba(236,232,224,.12);background:#1a1b20;text-align:left!important;color:#8f8c86;font:500 10px/27px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.16em}
${ON} #loader.splash-screen{position:absolute!important;inset:32px 0 28px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:0!important;width:auto!important;height:auto!important;margin:0!important;padding:8px 0 6px!important;background:none!important;color:#ece8e0!important}
/* 창 안 하늘: 로고 그림 자리에 도트 하늘을 그려 넣음(낮 구름 흐름 · 밤 별 깜박임) */
${ON} #loader.splash-screen .splash-logo{display:block!important;content:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 140 30' shape-rendering='crispEdges'%3E%3Crect x='40' y='6' width='1' height='1' fill='%23d8d4cb'%3E%3Canimate attributeName='opacity' values='.25;1;.25' dur='2.6s' begin='0s' repeatCount='indefinite'/%3E%3C/rect%3E%3Crect x='31' y='17' width='1' height='1' fill='%23d8d4cb'%3E%3Canimate attributeName='opacity' values='.25;1;.25' dur='3.4s' begin='-1.2s' repeatCount='indefinite'/%3E%3C/rect%3E%3Crect x='52' y='4' width='1' height='1' fill='%23d8d4cb'%3E%3Canimate attributeName='opacity' values='.25;1;.25' dur='2.9s' begin='-2s' repeatCount='indefinite'/%3E%3C/rect%3E%3Crect x='70' y='13' width='1' height='1' fill='%23d8d4cb'%3E%3Canimate attributeName='opacity' values='.25;1;.25' dur='3.8s' begin='-0.6s' repeatCount='indefinite'/%3E%3C/rect%3E%3Crect x='88' y='22' width='1' height='1' fill='%23d8d4cb'%3E%3Canimate attributeName='opacity' values='.25;1;.25' dur='3.1s' begin='-1.7s' repeatCount='indefinite'/%3E%3C/rect%3E%3Crect x='114' y='19' width='1' height='1' fill='%23d8d4cb'%3E%3Canimate attributeName='opacity' values='.25;1;.25' dur='2.4s' begin='-0.3s' repeatCount='indefinite'/%3E%3C/rect%3E%3Crect x='24' y='25' width='1' height='1' fill='%23d8d4cb'%3E%3Canimate attributeName='opacity' values='.25;1;.25' dur='4.2s' begin='-2.5s' repeatCount='indefinite'/%3E%3C/rect%3E%3Crect x='61' y='24' width='1' height='1' fill='%23d8d4cb'%3E%3Canimate attributeName='opacity' values='.25;1;.25' dur='3.6s' begin='-3s' repeatCount='indefinite'/%3E%3C/rect%3E%3Crect x='103' y='2' width='2' height='1' fill='%23d8d4cb'/%3E%3Crect x='102' y='3' width='2' height='1' fill='%23d8d4cb'/%3E%3Crect x='101' y='4' width='3' height='1' fill='%23d8d4cb'/%3E%3Crect x='101' y='5' width='3' height='1' fill='%23d8d4cb'/%3E%3Crect x='101' y='6' width='3' height='1' fill='%23d8d4cb'/%3E%3Crect x='101' y='7' width='4' height='1' fill='%23d8d4cb'/%3E%3Crect x='101' y='8' width='5' height='1' fill='%23d8d4cb'/%3E%3Crect x='102' y='9' width='7' height='1' fill='%23d8d4cb'/%3E%3Crect x='103' y='10' width='5' height='1' fill='%23d8d4cb'/%3E%3Crect x='93' y='7' width='1' height='1' fill='%23d8d4cb'%3E%3Canimate attributeName='opacity' values='.25;1;.25' dur='2.6s' begin='1.1s' repeatCount='indefinite'/%3E%3C/rect%3E%3C/svg%3E");position:absolute!important;left:0;top:6px;width:100%!important;height:90px!important;max-width:none!important;margin:0!important;object-fit:cover;image-rendering:pixelated;opacity:1;pointer-events:none;z-index:0;filter:none!important}
${ON} #loader.splash-screen::before{content:""!important;order:1;flex:none;position:relative;z-index:1;width:150px;height:150px;margin:-42px 0 -15px;background:url("${ASSET}cat-walk.png") 0 0/1200px 150px no-repeat;image-rendering:pixelated;filter:invert(.9);animation:etk-cat-walk .9s steps(8) infinite}
/* 발밑 땅: 고양이 걸음에 맞춰 뒤로 흘러감, 양 끝은 흐리게 */
${ON} #loader.splash-screen #load-spinner{display:block!important;order:1;position:relative!important;inset:auto!important;width:76%!important;height:24px!important;margin:-57px 0 24px!important;font-size:0!important;line-height:0!important;transform:none!important;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='8' shape-rendering='crispEdges'%3E%3Crect x='0' y='7' width='82' height='1' fill='rgba(236,232,224,.24)'/%3E%3Crect x='85' y='7' width='35' height='1' fill='rgba(236,232,224,.24)'/%3E%3Crect x='18' y='5' width='2' height='2' fill='rgba(236,232,224,.18)'/%3E%3Crect x='70' y='4' width='1' height='3' fill='rgba(236,232,224,.18)'/%3E%3Crect x='72' y='5' width='1' height='2' fill='rgba(236,232,224,.18)'/%3E%3Crect x='108' y='6' width='3' height='1' fill='rgba(236,232,224,.18)'/%3E%3C/svg%3E") 0 0/360px 24px repeat-x;image-rendering:pixelated;-webkit-mask:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);mask:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);animation:etk-cat-ground 2.4s linear infinite!important}
${ON} #loader.splash-screen #load-spinner::before{content:none!important}
${ON} #loader.splash-screen .splash-message{order:2;position:relative;z-index:1;display:flex!important;flex-direction:column;align-items:center;gap:12px;width:100%;margin:0!important;font-size:0!important}
${ON} #loader.splash-screen .splash-message::after{content:""!important;order:1;display:block;width:min(56%,210px);height:2px;border-radius:2px;background:linear-gradient(#ece8e0,#ece8e0) 0 0/28% 2px no-repeat,linear-gradient(rgba(236,232,224,.12),rgba(236,232,224,.12)) 0 50%/100% 1px no-repeat;animation:etk-cat-bar 1.6s cubic-bezier(.6,0,.4,1) infinite}
${ON} #loader.splash-screen .splash-message::before{content:"LOADING"!important;order:2;display:block;color:#8f8c86;font:500 10px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.32em;margin-right:-.32em;animation:etk-cat-breathe 2.4s ease-in-out infinite}
@property --etk-steps{syntax:"<integer>";inherits:false;initial-value:0}
${ON} #loader.splash-screen::after{content:"STEPS " counter(etk-steps)!important;counter-reset:etk-steps var(--etk-steps);position:absolute;z-index:5;right:14px;bottom:-28px;color:#8f8c86;font:500 10px/27px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.16em;font-variant-numeric:tabular-nums;animation:etk-cat-steps 1000s steps(1000, end) infinite}
@keyframes etk-cat-steps{to{--etk-steps:1000}}
@keyframes etk-cat-walk{to{background-position:-1200px 0}}
@keyframes etk-cat-ground{to{background-position:-360px 0}}
@keyframes etk-cat-bar{from{background-position:-39% 0,0 50%}to{background-position:139% 0,0 50%}}
@keyframes etk-cat-breathe{50%{opacity:.45}}
@keyframes etk-cat-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){${ON} .popup:has(#loader.splash-screen),${ON} #loader.splash-screen::before,${ON} #loader.splash-screen #load-spinner,${ON} #loader.splash-screen .splash-message::before,${ON} #loader.splash-screen .splash-message::after{animation:none!important}}` },
    plain: { name: '실리태번 기본', note: '바꾸지 않은 원래 화면', css: '' },
};
const DEFAULT_LOOK = LOOKS.cat.css;
let off = null, otherSplash = false, themeSplash = false, ignoreTheme = false;
// 내 로딩 화면을 쓰는 테마 이름 목록(테마마다 정함)
const ownHere = (o) => (o?.ownThemes || []).includes(appliedTheme());
// 테마(또는 다른 확장)에 로딩 화면이 있으면 쉼 — ‘테마 로딩 화면 무시’를 켜면 늘 이 화면
const applyThemeClass = () => applyThemeClassNow();
const applyThemeClassNow = () => {
    const resting = !ignoreTheme && (themeSplash || otherSplash);
    document.documentElement.classList.toggle('etk-theme-splash', resting);
    muteThemeSplash();
    apiRef?.rest?.(resting ? "same" : null);
};

// 내 로딩 화면을 쓰기로 했으면 테마 CSS 의 로딩 화면 규칙을 끔: 안 끄면 테마가 문구 자리를 옮기고 그 뒤 장식(::after)을 글자로 바꿔
//   내 로딩 바(같은 자리)가 사라졌음. 규칙마다 선택자 앞에 '내 로딩일 땐 안 맞음' 조건을 무게 없이(:where) 붙여 두고 html 클래스로 켜고 끔.
const MUTE = 'etk-own-splash';
function muteThemeSplash() {
    document.documentElement.classList.toggle(MUTE, ignoreTheme && themeSplash);
    if (!ignoreTheme || !themeSplash) return;
    const sheet = document.getElementById('custom-style')?.sheet;
    const walk = (rules) => {
        for (const rule of rules || []) {
            if (rule.cssRules && !(rule instanceof CSSStyleRule)) { walk(rule.cssRules); continue; }
            if (!(rule instanceof CSSStyleRule) || rule.selectorText.includes(MUTE) || !SPLASH_SEL.test(rule.selectorText)) continue;
            rule.selectorText = rule.selectorText.split(/,(?![^(]*\))/).map(x => {
                x = x.trim();
                const root = x.match(/^(html|:root)(?=$|[\s.:#\[>~+])/);
                return root ? `${root[1]}:where(:not(.${MUTE}))${x.slice(root[1].length)}` : `:where(html:not(.${MUTE})) ${x}`;
            }).join(', ');
        }
    };
    try { walk(sheet?.cssRules); } catch (error) { console.warn('[Breeze] 테마 로딩 규칙 끄기', error); }
}

const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, '')}")`;
const cssText = (t) => `"${String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;

// 직접 쓴 CSS: 화면 규칙은 html:not(.etk-theme-splash) 로 시작해 우선순위가 높아서, 사용자가 #loader … 로 적으면 !important 를 붙여도 졌음 —
// 선택자마다 같은 앞머리를 붙여 같은 무게로 만들고 뒤에 둠. :root · html 로 시작하면 그 자리에 붙임(앞에 덧붙이면 html 안의 html 이 되어 안 맞았음),
// @media · @supports 안은 안쪽까지, @font-face · @keyframes 같은 @ 규칙은 그대로
function splitTop(css) {
    const out = []; let i = 0;
    while (i < css.length) {
        const a = i; let depth = 0;
        for (; i < css.length; i++) {
            const c = css[i];
            if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e < 0 ? css.length : e + 1; continue; }
            if (c === '"' || c === "'") { const q = c; for (i++; i < css.length && css[i] !== q; i++) if (css[i] === '\\') i++; continue; }
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth <= 0) { i++; break; } }
            else if (c === ';' && depth === 0) { i++; break; }
        }
        const part = css.slice(a, i).trim();
        if (part) out.push(part);
    }
    return out;
}
function prefixSelectors(list) {
    const sels = []; let depth = 0, cur = '';
    for (const c of list) { if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--; if (c === ',' && !depth) { sels.push(cur); cur = ''; } else cur += c; }
    sels.push(cur);
    return sels.map(x => x.trim()).filter(Boolean).map(x => {
        const m = x.match(/^(:root|html)(?![\w-])/i);
        return m ? `${ON}${x.slice(m[0].length)}` : `${ON} ${x}`;
    }).join(', ');
}
function scopeUserCss(css) {
    return splitTop(css.replace(/\/\*[\s\S]*?\*\//g, '')).map(part => {
        const b = part.indexOf('{');
        if (b < 0) return part;   // @import 같은 한 줄(맨 위로는 hoistImports 가 옮김)
        const head = part.slice(0, b).trim(), body = part.slice(b + 1, part.lastIndexOf('}'));
        if (/^@(media|supports|container|layer|document)\b/i.test(head)) return `${head} {\n${scopeUserCss(body)}\n}`;
        if (head.startsWith('@')) return part;
        return `${prefixSelectors(head)} {${body}}`;
    }).join('\n');
}
// @import 는 파일 맨 앞에만 쓸 수 있어서(화면 CSS · @media 뒤에 있으면 무시됨) 맨 앞으로 모음
function hoistImports(text) {
    const imports = [];
    const rest = text.replace(/^[ \t]*@import\s[^;]+;[ \t]*$/gm, m => { imports.push(m.trim()); return ''; });
    return imports.length ? `${[...new Set(imports)].join('\n')}\n${rest}` : text;
}

// 한 모양의 CSS 만들기. 직접 쓴 CSS(고급)는 뒤에 그대로 붙인다.
function buildOne(o) {
    const out = [];
    // 직접 CSS 를 넣지 않았으면 breeze 기본 모양을 바탕으로(고른 색 · 그림 · 문구가 그 위에 덮임)
    const look = LOOKS[o.look] || LOOKS.plain;   // 아무 모양도 안 골랐으면 실리태번 기본
    // 직접 쓴 CSS: 기본은 모양 위에 덧입힘(문구 하나 바꾸려다 모양이 통째로 빠지지 않게), ‘CSS 만’을 고르면 모양 없이 그 CSS 만
    const hasDecor = !!(o.bgColor || o.bgImage || o.logo);
    const bare = (o.cssMode === 'only' && o.css?.trim()) || (o.decorMode === 'only' && hasDecor);   // ‘화면 없이’를 골랐으면 고른 화면을 빼고 꾸미기 · CSS 만
    if (!bare) out.push(look.css);
    const over = !bare && look !== LOOKS.plain;   // 고른 화면 위에 덧입히는 중
    if (o.bgColor) {
        // 덧입힐 때는 바탕색만 바꾸고 화면의 무늬 · 결 · 빛은 그대로(바탕 전체와 창(팝업)까지 지우면 그림 창이 사라지고 글만 붕 떠 보임)
        // 화면 가운데 빛(--etk-glow 를 쓰는 화면)은 고른 색을 조금 밝힌 색으로 — 하얀 빛이 어두운 바탕 위에 둥둥 떠 보였음
        if (over) out.push(`${ON} #preloader { background-color: ${o.bgColor} !important; --etk-glow: color-mix(in srgb, ${o.bgColor} 80%, white 20%); }`);
        else out.push(`${ON} #preloader { background: ${o.bgColor} !important; backdrop-filter: none !important; }`, `${ON} .popup:has(#loader.splash-screen) { background: transparent !important; box-shadow: none !important; }`);
        // 팝업 뒷막은 칠하지 않고 투명하게: 뒷막을 같은 색으로 칠하면 팝업이 뜨는 순간 #preloader 와 그 위 테두리 · 구석 글(::before · ::after)을 덮어 사라졌음
        out.push(`${ON} .popup:has(#loader.splash-screen)::backdrop { background: transparent !important; backdrop-filter: none !important; }`);
    }
    if (o.bgImage) out.push(`${ON} #preloader { background-image: ${cssUrl(o.bgImage)} !important; background-size: cover !important; background-position: center !important; }`, `${ON} .popup:has(#loader.splash-screen)::backdrop { background: transparent !important; backdrop-filter: none !important; }`);
    if (o.hideLogo) out.push(`${ON} #loader.splash-screen .splash-logo, ${ON} #loader.splash-screen::before { display: none !important; }`);
    else if (o.logo) out.push(`${ON} #loader.splash-screen::before { display: none !important; }\n${ON} #loader.splash-screen .splash-logo { display: block !important; order: 0 !important; position: relative !important; inset: auto !important; margin: 0 auto !important; z-index: 1; opacity: 1 !important; content: ${cssUrl(o.logo)}; width: min(150px, 50%) !important; height: auto !important; aspect-ratio: auto; max-height: 40vh; object-fit: contain; filter: none !important; }`);
    // 덧입힐 때 로고는 화면 안 그림 자리(고양이 창 등)에 맞게 작게, 발밑 땅 같은 겹쳐 올린 칸이 로고를 덮지 않게
    if (o.logo && !o.hideLogo && over) out.push(`${ON} #loader.splash-screen .splash-logo { width: auto !important; max-width: 60% !important; max-height: 96px !important; } ${ON} #loader.splash-screen #load-spinner { margin-top: 6px !important; }`);
    // 문구 글꼴: 모양 기본 · 도트(갈무리, 확장에 들어 있음) · 고딕 · 명조 · 내 컴퓨터 글꼴 이름 · 글꼴 파일
    const family = { galmuri: '"etk-galmuri", monospace', sans: SYSTEM, serif: '"AppleMyungjo", "Nanum Myeongjo", "NanumMyeongjo", "Noto Serif KR", "Batang", Georgia, serif', name: o.fontName ? `"${String(o.fontName).replace(/["\\]/g, '')}", sans-serif` : '', file: o.fontFile ? '"etk-splash-font", sans-serif' : '' }[o.font];
    if (family) {
        if (o.font === 'galmuri') out.push(`@font-face { font-family: "etk-galmuri"; src: url("${ASSET}Galmuri11-Bold.woff2") format("woff2"); font-weight: 700; font-display: block; }`);
        if (o.font === 'file') out.push(`@font-face { font-family: "etk-splash-font"; src: ${cssUrl(o.fontFile)}; font-display: block; }`);
        out.push(`${ON} #loader.splash-screen .splash-message, ${ON} #loader.splash-screen .splash-message::before, ${ON} #loader.splash-screen .splash-message::after { font-family: ${family} !important; }`);
    }
    // 모양마다 글자색을 문구 ::before · ::after 에 직접 칠해서, 바깥 칸에만 주면 안 바뀌었음
    if (o.textColor) out.push(`${ON} #loader.splash-screen, ${ON} #preloader, ${ON} #loader.splash-screen .splash-message, ${ON} #loader.splash-screen .splash-message::before, ${ON} #loader.splash-screen .splash-message::after { color: ${o.textColor} !important; }`);
    if (o.message?.trim()) {
        // 모양에 글자 꾸밈이 있으면 글만 바꾸고, 실리태번 기본 모양이면 원래 글을 감추고 새 글을 씀
        if (look === LOOKS.plain || o.css?.trim()) out.push(`${ON} #loader.splash-screen .splash-message { font-size: 0 !important; }`, `${ON} #loader.splash-screen .splash-message::before { content: ${cssText(o.message.trim())}; display: block; font-size: 22px; line-height: 1.25; }`);
        else out.push(`${ON} #loader.splash-screen .splash-message::before { content: ${cssText(o.message.trim())} !important; width: auto !important; height: auto !important; font: 700 20px/1.3 system-ui, sans-serif; }`);
    }
    if (o.messageCss?.trim()) {
        // 문구(모양마다 문구 칸의 ::before)에 적은 선언 그대로 — 모양 규칙이 !important 라 각 선언에 !important 를 붙임
        const decl = String(o.messageCss).replace(/[{}<]/g, '').split(';').map(d => d.trim()).filter(d => d.includes(':')).map(d => /!important$/i.test(d) ? d : `${d} !important`).join('; ');
        if (decl) out.push(`${ON} #loader.splash-screen .splash-message::before { ${decl}; }`);
    }
    if (o.css?.trim()) out.push(scopeUserCss(o.css));
    return out.join('\n');
}

// 세트에 담기는 값(고른 모양 + 바꾼 값 전부)
const SET_KEYS = ['look', 'bgColor', 'bgImage', 'logo', 'hideLogo', 'message', 'messageCss', 'cssMode', 'decorMode', 'font', 'fontName', 'fontFile', 'textColor', 'css'];
const pickSet = (o) => Object.fromEntries(SET_KEYS.filter(k => o[k] !== undefined && o[k] !== '').map(k => [k, o[k]]));
// 세로 화면 모양: '' = 가로와 같음, 'look:키' = 모양, 'set:id' = 내 세트
function portraitOf(o) {
    const v = String(o.portrait || '');
    if (v.startsWith('look:') && LOOKS[v.slice(5)]) return { look: v.slice(5) };
    if (v.startsWith('set:')) return (o.sets || []).find(x => x.id === v.slice(4)) || null;
    return null;
}

// 저장 파일 전체: 세로 화면 모양이 따로 있으면 화면 방향으로 나눠 둘 다 넣음(한쪽 규칙이 다른 쪽에 남지 않게)
export function buildCss(o) {
    const head = '/* breeze ‘로딩 화면’이 만든 파일. 설정 창에서 고쳐요 */';
    const p = portraitOf(o);
    if (!p) return hoistImports(`${head}\n${buildOne(o)}`);
    return hoistImports(`${head}\n@media not (orientation: portrait) {\n${buildOne(o)}\n}\n@media (orientation: portrait) {\n${buildOne(p)}\n}`);
}

async function linked() {
    try { return (await (await fetch('/css/user.css', { cache: 'no-store' })).text()).includes(FILE); } catch { return false; }
}

// 스타일시트를 한 번 훑음(@import 로 읽은 것까지). 다른 출처라 못 여는 시트는 건너뜀
// staticOnly: css/user.css 로 함께 읽히는 것만(실리태번이 켜지는 순간부터 있는 것) — 확장이 나중에 붙이는 스타일은 켜지는 순간엔 없어서 섞이지 않음
function findOtherSplash(staticOnly = false) {
    const scan = (sheet, depth = 0) => {
        if (depth > 4) return false;
        const href = sheet.href || '';
        if (href.includes(FILE) || /\/(style|css\/[\w-]+)\.css(\?|$)/.test(href) && !href.includes('user.css')) return false;
        let rules;
        try { rules = sheet.cssRules; } catch { return false; }
        const walk = (list) => {
            for (const r of list) {
                if (r.styleSheet) { if (scan(r.styleSheet, depth + 1)) return true; continue; }
                if (r.cssRules && !r.selectorText && walk(r.cssRules)) return true;   // @media · @supports 안
                if (r.selectorText && r.selectorText.includes('#preloader') && sheet.ownerNode?.id !== 'custom-style') return true;
            }
            return false;
        };
        return walk(rules);
    };
    return [...document.styleSheets].filter(s => !staticOnly || (s.href || '').includes('/css/user.css')).some(s => scan(s));
}

// 로딩 파일에 쓸 글: 다른 확장의 로딩 화면 CSS 가 같이 읽히면(css/user.css 로 함께 불림) 쉬는 표시만.
// 실리태번이 켜지는 순간엔 html 표시(etk-theme-splash)를 붙일 수 없어서 두 로딩 화면이 한 화면에 섞임:
// 지난번 켰을 때 본 결과를 파일에 적어 두고 다음 켤 때부터 쉼. 테마 CSS 는 실리태번이 켜지는 중에 붙어서 이 판단에 넣지 않음
const REST = '/* breeze 로딩 화면: 다른 확장의 로딩 화면이 있어 쉼 */';
// 테마에 로딩 화면이 있으면 그 로딩 화면 CSS 만 골라 이 파일에 적어 둠 — 새로고침 첫 화면부터 테마 로딩 화면이 떠서,
// 이 화면을 먼저 띄웠다가 테마 CSS 가 붙은 뒤 바꾸던(뚝 끊기던) 순간이 없어짐. 테마 CSS 가 붙어도 같은 규칙이라 그대로.
// 고르는 것: 로딩 화면 규칙(#preloader · #loader · splash · 로딩 팝업), 거기 쓰이는 @font-face · @keyframes · @import · @property,
// :root · html · body 의 변수 선언(변수만 — 다른 꾸밈은 안 가져옴), 그래도 비는 변수는 지금 화면에서 읽은 값으로.
let lastThemeCss = '';
// 선언 나누기: 따옴표 · 괄호 안의 ; 는 건너뜀(그림을 글로 넣은 변수 값 url("data:…;base64,…")을 ; 로 잘라 파일이 그 뒤로 통째로 깨졌음)
function splitDecls(body) {
    const out = []; let cur = '', depth = 0, q = '';
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (q) { cur += c; if (c === '\\') { cur += body[++i] ?? ''; } else if (c === q) q = ''; continue; }
        if (c === '"' || c === "'") { q = c; cur += c; continue; }
        if (c === '(') depth++; else if (c === ')') depth = Math.max(0, depth - 1);
        if (c === ';' && !depth) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
        cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}
const SPLASH_SEL = /#preloader|#loader|#load-spinner|splash|\.popup:has\(/;   // 톱니(#load-spinner)만 따로 꾸민 규칙도 — 빠지면 테마 CSS 가 붙기 전까지 실리태번 기본 톱니가 보였음
function pickThemeSplash(css) {
    const used = new Set(), have = new Set(), imports = [], varBlocks = [];
    const pick = (text) => splitTop(text.replace(/\/\*[\s\S]*?\*\//g, '')).map(part => {
        const b = part.indexOf('{');
        if (b < 0) { if (/^@import\b/i.test(part)) imports.push(part); return ''; }
        const head = part.slice(0, b).trim(), body = part.slice(b + 1, part.lastIndexOf('}'));
        if (/^@(media|supports|container|layer)\b/i.test(head)) { const inner = pick(body).trim(); return inner ? `${head} {\n${inner}\n}` : ''; }
        if (/^@(font-face|keyframes|-webkit-keyframes|property)\b/i.test(head)) return part;
        if (head.startsWith('@')) return '';
        if (SPLASH_SEL.test(head)) { for (const m of body.matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1]); return `${prefixSelectors(head)} {${body}}`; }   // 앞머리를 붙여 실리태번 기본 로딩 CSS(이 파일보다 뒤에 읽힘)를 이기게 — 안 붙이면 같은 무게라 뒤에 읽힌 기본 화면이 이겼음
        if (/^(:root|html|body)(\s*,\s*(:root|html|body))*$/i.test(head)) {
            // 변수는 일단 모아 두고, 로딩 화면이 실제로 쓰는 것만 끝에 넣음(그림을 글로 넣은 변수까지 다 넣으면 파일이 수백 KB)
            const vars = splitDecls(body).filter(d => d.startsWith('--'));
            const key = `\u0000VARS${varBlocks.length}\u0000`;
            varBlocks.push([head, vars]);
            return key;
        }
        return '';
    }).filter(Boolean).join('\n');
    let picked = pick(css);
    // 쓰는 변수를 따라가며(변수 값이 다른 변수를 쓰는 것까지) 모음
    const decl = new Map();
    for (const [, vars] of varBlocks) for (const d of vars) { const n = d.slice(0, d.indexOf(':')).trim(); if (!decl.has(n)) decl.set(n, []); decl.get(n).push(d); }
    for (let changed = true; changed;) { changed = false; for (const v of [...used]) for (const d of decl.get(v) || []) for (const m of d.matchAll(/var\(\s*(--[\w-]+)/g)) if (!used.has(m[1])) { used.add(m[1]); changed = true; } }
    picked = picked.replace(/\u0000VARS(\d+)\u0000/g, (_, i) => { const [head, vars] = varBlocks[i]; const keep = vars.filter(d => used.has(d.slice(0, d.indexOf(':')).trim())); keep.forEach(d => have.add(d.slice(0, d.indexOf(':')).trim())); return keep.length ? `${head} { ${keep.join('; ')}; }` : ''; }).replace(/\n{2,}/g, '\n');
    const root = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
    const missing = [...used].filter(v => !have.has(v)).map(v => [v, (root.getPropertyValue(v) || body.getPropertyValue(v)).trim()]).filter(([, x]) => x);
    // @import 는 파일 맨 앞에만 쓸 수 있음(주소 안에 ; 가 든 글꼴 주소도 있어 통째로 옮김)
    return `${[...new Set(imports)].join('\n')}\n/* breeze 로딩 화면: 지금 테마의 로딩 화면 사본(테마를 바꾸면 다시 씀) */\n${missing.length ? `:root { ${missing.map(([k, x]) => `${k}: ${x}`).join('; ')}; }\n` : ''}${picked}`;
}
let staticSplash = false;
const fileText = (o) => (ownHere(o) ? buildCss(o) : staticSplash ? REST : themeSplash && lastThemeCss ? pickThemeSplash(lastThemeCss) : buildCss(o));
let apiRef = null;
async function syncFile(o = apiRef?.options()) {
    if (!o) return;
    const want = fileText(o);
    try { const have = await fetch(`/user/files/${FILE}`, { cache: 'no-store' }).then(r => (r.ok ? r.text() : '')); if (have !== want) await saveUserFile(FILE, want); } catch { /* 다음에 */ }
}

export function start(api) {
    apiRef = api;
    ignoreTheme = ownHere(api.options());
    // 테마가 바뀌면(로딩 화면이 있는지 · 그 모양이 달라지면) 파일도 다시 씀 — 한가할 때 한 번
    let syncT = 0;
    off = onThemeCss(({ css }) => {
        const own = ownHere(api.options());
        if (own !== ignoreTheme) { ignoreTheme = own; clearTimeout(syncT); syncT = setTimeout(() => syncFile(), 300); }
        const was = themeSplash ? lastThemeCss : null;
        themeSplash = THEME_SPLASH.test(css); lastThemeCss = css; applyThemeClass();
        if (was !== (themeSplash ? css : null)) { clearTimeout(syncT); syncT = setTimeout(() => (window.requestIdleCallback || setTimeout)(() => syncFile()), 1500); }
    });
    // 화면이 한가할 때: 다른 확장 로딩 화면이 있는지 본 뒤, 저장된 파일이 지금 설정 · 상황과 다르면 다시 씀
    (window.requestIdleCallback || setTimeout)(() => {
        otherSplash = findOtherSplash();
        staticSplash = findOtherSplash(true);
        applyThemeClass();
        syncFile();
    });
}

// 끄면 파일을 빈 것으로 — 다음에 켤 때 로딩 화면이 원래대로
export async function stop() {
    off?.(); off = null;
    document.documentElement.classList.remove('etk-theme-splash');
    try { await saveUserFile(FILE, '/* breeze ‘로딩 화면’ 꺼짐 */'); } catch (e) { console.warn('[Breeze] 로딩 화면 끄기', e); }
}

// 미리보기: 설정 칸 안의 작은 화면(iframe)에 실리태번 로딩 화면과 같은 틀 + 실리태번 로딩 CSS + 지금 값으로 만든 CSS 를 넣어 그림.
// 화면 전체를 덮지 않고, 값을 바꿀 때마다 바로 다시 그림.
function previewHtml(o, still = false) {
    // still: 화면 줄의 작은 그림 — 움직임을 꺼서 세트가 많아도 칸이 버벅이지 않게(큰 미리보기 · 전체 화면은 그대로 움직임)
    const css = hoistImports(buildOne(o)).replace(/<\/style/gi, '') + (still ? '\n*, *::before, *::after { animation: none !important; transition: none !important; }' : '');
    return `<!doctype html><html><head><base href="${location.origin}/"><link rel="stylesheet" href="css/loader.css"><link rel="stylesheet" href="css/fontawesome.min.css"><link rel="stylesheet" href="css/solid.min.css">
        <style>:root { --SmartThemeBlurTintColor: ${getComputedStyle(document.body).getPropertyValue('--SmartThemeBlurTintColor') || '#222'}; --SmartThemeBodyColor: ${getComputedStyle(document.body).getPropertyValue('--SmartThemeBodyColor') || '#ddd'}; --animation-duration-2x: .2s; }
        html, body { margin: 0; height: 100%; overflow: hidden; font-family: sans-serif; } #preloader { position: absolute; width: 100%; height: 100%; }
        #loader.splash-screen { position: absolute; inset: 0; }
        .popup { position: absolute; inset: 0; margin: auto; z-index: 2147483647; }   /* 실리태번은 로딩 칸을 팝업(dialog, 맨 위 층) 안에 띄움 — 창틀을 팝업에 입히는 모양도 미리보기에 보이게. #preloader 가 z-index 가 높아 그 위로 올림 */
        </style><style id="etk-preview-css">${css}</style></head><body><div id="preloader"></div><div class="popup"><div id="loader" class="splash-screen"><img class="splash-logo" src="img/logo.png" alt=""><h2 class="splash-message">SillyTavern</h2><div id="load-spinner" class="fa-solid fa-gear fa-spin fa-2x"></div></div></div></body></html>`;
}

// 배경색 팔레트: 채도를 낮춘 차분한 색(종이 · 안개처럼 밝은 바탕 7 + 어두운 바탕 3)
// 배경색 팔레트: 쓰는 테마들의 바탕색 느낌을 따르되 값은 조금씩 옮긴 색(밝은 종이빛 · 파스텔 · 은빛, 검정 대신 색이 스민 밤색)
const BG_SWATCHES = [['종이', '#f3f1ec'], ['아이보리', '#eeeae2'], ['세피아', '#e0dbd2'], ['살구', '#f7e1d9'], ['벚꽃', '#f5e3e9'], ['라벤더', '#e9e3f5'], ['하늘', '#e2edf5'], ['은빛', '#dde0e4'], ['미드나잇', '#151c2b'], ['먹', '#1d1d1c']];
export function options(box, api) {
    const o = api.options();
    const cssId = `etk_splash_css_${Math.random().toString(36).slice(2, 8)}`;   // 설정 창 · 확장 칸 두 곳에 그려져도 ‘편집기 크게’가 제 칸을 찾게
    box.innerHTML = `
        <div class="etk-sub etk-sub-io"><span>보기</span><div class="etk-sum-io"><i class="fa-solid fa-file-export etk-splash-export interactable" tabindex="0" title="로딩 화면 내보내기(지금 고른 것 · 꾸미기 · 내 세트)"></i><i class="fa-solid fa-file-import etk-splash-import interactable" tabindex="0" title="로딩 화면 불러오기"></i></div></div>
        <div class="etk-splash-looks">${Object.entries(LOOKS).filter(([k]) => k !== 'plain').map(([k, v]) => `<div class="etk-splash-look" data-look="${k}" tabindex="0" title="${v.note}"><div class="etk-splash-thumb etk-splash-thumb-${k}"><iframe tabindex="-1" sandbox="allow-same-origin" loading="lazy"></iframe><i class="fa-solid fa-xmark etk-set-del etk-look-del" title="목록에서 지우기"></i></div><span>${v.name}</span></div>`).join('')}<div class="etk-splash-sets"></div></div>
        <div class="etk-splash-previews">
            <div class="etk-splash-view"><iframe class="etk-splash-frame" title="로딩 화면 미리보기" sandbox="allow-same-origin"></iframe><i class="fa-solid fa-expand etk-splash-full" data-full="land" title="전체 화면으로 보기"></i></div>
            <div class="etk-splash-phone"><small>세로 화면(휴대폰)</small><select class="text_pole etk-portrait"></select><div class="etk-splash-thumb etk-splash-thumb-portrait"><iframe tabindex="-1" sandbox="allow-same-origin"></iframe><i class="fa-solid fa-expand etk-splash-full" data-full="port" title="전체 화면으로 보기"></i></div></div>
        </div>
        <details class="etk-advanced etk-splash-more"><summary>세부 설정</summary>
        <div class="etk-sub">테마에 로딩 화면이 있어도 내가 고른 로딩 화면 쓰기</div>
        <div class="etk-own-list etk-ignore-theme"></div>
        <details class="etk-advanced etk-decor"><summary>배경 · 로고 꾸미기</summary>
            <div class="etk-css-mode" role="radiogroup"><label><input type="radio" name="${cssId}-decor" data-k="decorMode" value="over"><span>고른 화면 위에 덧입히기</span></label><label><input type="radio" name="${cssId}-decor" data-k="decorMode" value="only"><span>화면 없이 꾸미기만</span></label></div>
            <div class="etk-form">
                <label>배경색</label><div class="etk-flex etk-swatches">${BG_SWATCHES.map(([n, c]) => `<div class="etk-swatch" data-swatch="${c}" title="${n}" style="background:${c}" tabindex="0"></div>`).join('')}<label class="etk-swatch etk-swatch-custom" title="직접 고르기"><input type="color" data-k="bgColor"><i class="fa-solid fa-eye-dropper"></i></label><div class="menu_button" data-clear="bgColor">기본</div></div>
                <label>배경 그림 · GIF</label><div class="etk-flex"><div class="menu_button" data-pick="bgImage"><i class="fa-solid fa-image"></i> 고르기</div><small data-show="bgImage"></small><div class="menu_button" data-clear="bgImage">지우기</div></div>
                <label>로고 · GIF</label><div class="etk-flex"><div class="menu_button" data-pick="logo"><i class="fa-solid fa-image"></i> 고르기</div><small data-show="logo"></small><div class="menu_button" data-clear="logo">지우기</div></div>
            </div>
        </details>
        <details class="etk-advanced"><summary>CSS로 직접 꾸미기 (문구 · 글꼴 · 글자색 등)</summary><div class="etk-css-mode" role="radiogroup"><label><input type="radio" name="${cssId}-css" data-k="cssMode" value="over"><span>고른 화면 위에 덧입히기</span></label><label><input type="radio" name="${cssId}-css" data-k="cssMode" value="only"><span>화면 없이 이 CSS만</span></label></div><textarea id="${cssId}" class="text_pole monospace" rows="6" data-k="css" placeholder="예) 문구 바꾸기 · 자리 · 글꼴 · 색
#loader.splash-screen .splash-message::before {
  content: &quot;잠시만요&quot; !important;
  font: 14px Pretendard !important; color: #333 !important;
}"></textarea></details>
        <div class="etk-sub">내 세트</div>
        <div class="etk-flex etk-splash-setrow"><input class="text_pole etk-set-name" placeholder="세트 이름"><div class="menu_button etk-set-add" title="지금 고른 화면과 꾸미기를 이름 붙여 세트로 저장"><i class="fa-solid fa-plus"></i>지금 화면을 세트로 추가</div></div>
        </details>
        <div class="etk-flex etk-splash-bottom"><div class="menu_button etk-splash-save" title="고른 화면 · 꾸미기를 로딩 화면 파일에 씀"><i class="fa-solid fa-check"></i>로딩 화면에 적용</div><small class="etk-splash-hint">다음 새로고침부터 이 화면이 떠요</small></div>
        <small class="etk-splash-state"></small>`;
    // 모양 칸마다 그 모양을 실제 화면 크기로 그려 작게 보여 줌(고른 색 · 문구 · 그림은 빼고 모양만)
    // 화면 칸 작은 그림은 보일 때만 그림 — 세트가 많으면(100개) 미리보기 창 100개를 한꺼번에 띄워 설정 칸이 몇 초씩 멈췄음
    const thumbs = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { const fr = e.target; thumbs.unobserve(fr); fr.srcdoc = fr._etkHtml(); } }, { rootMargin: '120px' });
    const lazyThumb = (fr, make) => { fr._etkHtml = make; fr.removeAttribute('srcdoc'); thumbs.observe(fr); };
    for (const el of box.querySelectorAll('.etk-splash-look[data-look]')) lazyThumb(el.querySelector('iframe'), () => previewHtml({ look: el.dataset.look }, true));
    const f = k => box.querySelector(`[data-k="${k}"]`);
    o.sets ??= [];
    o.hiddenLooks ??= [];
    // 지운 기본 보기는 목록에서 숨김(되살리기 없음). 지금 쓰는 보기를 지워도 로딩 화면은 그대로
    const drawLooks = () => {
        for (const el of box.querySelectorAll('.etk-splash-looks > .etk-splash-look[data-look]')) el.hidden = o.hiddenLooks.includes(el.dataset.look);
    };
    drawLooks();
    const sets = box.querySelector('.etk-splash-sets'), portrait = box.querySelector('.etk-portrait');
    const portraitFrame = box.querySelector('.etk-splash-thumb-portrait iframe');
    const drawSets = () => {
        sets.innerHTML = o.sets.length ? o.sets.map(x => `<div class="etk-splash-look" data-set="${x.id}" tabindex="0" title="눌러서 불러오기"><div class="etk-splash-thumb"><iframe tabindex="-1" sandbox="allow-same-origin" loading="lazy"></iframe><i class="fa-solid fa-xmark etk-set-del" title="세트 지우기"></i><b class="etk-set-badge">내 세트</b></div><span></span></div>`).join('') : '';
        sets.querySelectorAll('[data-set]').forEach((el, i) => { const x = o.sets[i]; el.querySelector('span').textContent = x.name; lazyThumb(el.querySelector('iframe'), () => previewHtml(x, true)); });
        const opt = (v, t) => `<option value="${v}">${t.replace(/[<&]/g, '')}</option>`;
        portrait.innerHTML = opt('', '가로 화면과 같게') + Object.entries(LOOKS).filter(([k]) => !o.hiddenLooks.includes(k) || o.portrait === `look:${k}`).map(([k, v]) => opt(`look:${k}`, v.name)).join('') + o.sets.map(x => opt(`set:${x.id}`, `내 세트 · ${x.name}`)).join('');
        portrait.value = portraitOf(o) ? o.portrait : '';
        portraitFrame.srcdoc = previewHtml(portraitOf(o) || o);
    };
    drawSets();
    portrait.addEventListener('change', () => { o.portrait = portrait.value; portraitFrame.srcdoc = previewHtml(portraitOf(o) || o); });
    box.querySelector('.etk-set-add').addEventListener('click', () => {
        const input = box.querySelector('.etk-set-name');
        const name = input.value.trim() || `세트 ${o.sets.length + 1}`;
        o.sets.push({ id: Date.now().toString(36), name, ...pickSet(o) });
        input.value = ''; api.save(); drawSets(); toastr.success(`‘${name}’ 세트를 화면 줄에 추가했어요`);
    });
    sets.addEventListener('click', e => {
        const el = e.target.closest('[data-set]'); if (!el) return;
        const i = o.sets.findIndex(x => x.id === el.dataset.set); if (i < 0) return;
        if (e.target.closest('.etk-set-del')) {
            // 엑스가 작아 실수로 눌러 세트(그림 · CSS 포함)를 잃었음 — 한 번 묻고 지움
            const c = SillyTavern.getContext(), id = o.sets[i].id, nm = String(o.sets[i].name).replace(/[<>&]/g, '');
            c.callGenericPopup(`<h3>‘${nm}’ 세트를 지울까요?</h3>지우면 되돌릴 수 없어요.`, c.POPUP_TYPE.CONFIRM, '', { okButton: '지우기', cancelButton: '그대로 두기' }).then(r => {
                if (r !== c.POPUP_RESULT.AFFIRMATIVE) return;
                const j = o.sets.findIndex(x => x.id === id); if (j < 0) return;
                if (o.portrait === `set:${id}`) o.portrait = '';
                o.sets.splice(j, 1); api.save(); drawSets();   // 세트 추가 · 지우기는 바로 저장(적용을 안 누르고 새로고침하면 사라졌음)
            });
            return;
        }
        // 불러오기: 세트 값으로 바꿈(세트에 없는 값은 비움)
        for (const k of SET_KEYS) delete o[k];
        Object.assign(o, pickSet(o.sets[i]));
        show(); redraw();
    });
    // 내보내기 · 불러오기: 지금 고른 것 · 내 세트 · 세로 화면 · 지운 기본 보기. 그림 · 글꼴 파일은 파일 안에 함께 넣음
    box.querySelector('.etk-splash-export').addEventListener('click', async () => {
        const data = await embedFiles({ kind: 'breeze-loading', current: pickSet(o), ownThemes: o.ownThemes || [], portrait: o.portrait || '', sets: o.sets, hiddenLooks: o.hiddenLooks });
        downloadText('breeze-loading.json', JSON.stringify(data, null, 1));
    });
    box.querySelector('.etk-splash-import').addEventListener('click', async () => {
        const file = await pickFile('.json,application/json');
        if (!file) return;
        let data = null;
        try { data = JSON.parse(await file.text()); } catch { /* 아래에서 알림 */ }
        if (data?.kind !== 'breeze-loading') return toastr.warning('breeze 로딩 화면 파일이 아니에요.', 'breeze');
        const c = SillyTavern.getContext();
        const n = Array.isArray(data.sets) ? data.sets.length : 0;
        const r = await c.callGenericPopup(`<h3>로딩 화면을 불러올까요?</h3>지금 고른 로딩 화면이 파일의 것으로 바뀌고, 내 세트 ${n}개가 더해져요.`, c.POPUP_TYPE.CONFIRM, '', { okButton: '불러오기', cancelButton: '취소' });
        if (r !== c.POPUP_RESULT.AFFIRMATIVE) return;
        try { data = await restoreFiles(data, { fresh: true }); } catch (e) { console.error('[Breeze] 로딩 화면 파일 올리기', e); return toastr.error('그림 · 글꼴 파일을 올리지 못했어요.', 'breeze'); }
        for (const k of SET_KEYS) delete o[k];
        Object.assign(o, pickSet(data.current || {}));
        o.ownThemes = Array.isArray(data.ownThemes) ? [...new Set([...(o.ownThemes || []), ...data.ownThemes.map(String)])] : (o.ownThemes || []);
        const idMap = new Map();
        for (const x of Array.isArray(data.sets) ? data.sets : []) { const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`; idMap.set(x.id, id); o.sets.push({ ...x, id }); }
        const p = String(data.portrait || '');
        o.portrait = p.startsWith('set:') ? (idMap.has(p.slice(4)) ? `set:${idMap.get(p.slice(4))}` : '') : p;
        o.hiddenLooks = Array.isArray(data.hiddenLooks) ? data.hiddenLooks.filter(k => LOOKS[k]) : o.hiddenLooks;
        ignoreTheme = ownHere(o); applyThemeClass();
        api.save(); drawLooks(); drawSets(); show(); redraw();
        toastr.success('불러왔어요. ‘로딩 화면에 적용’을 누르면 다음 새로고침부터 떠요.', 'breeze');
    });
    const state = box.querySelector('.etk-splash-state');
    const show = () => {
        f('bgColor').value = o.bgColor || '#000000';
        box.querySelectorAll('[data-k="cssMode"]').forEach(r => { r.checked = r.value === (o.cssMode === 'only' ? 'only' : 'over'); });
        box.querySelectorAll('[data-k="decorMode"]').forEach(r => { r.checked = r.value === (o.decorMode === 'only' ? 'only' : 'over'); });
        f('bgColor').classList.toggle('etk-unset', !o.bgColor);
        f('css').value = o.css || '';
        if (dropGoneThemes(o.ownThemes)) api.save();
        const now = appliedTheme(), list = o.ownThemes || [];
        const own = box.querySelector('.etk-own-list');
        own.innerHTML = `<label class="checkbox_label"><input type="checkbox" data-own><span></span></label>`;
        own.querySelector('span').textContent = `지금 테마(${now || '기본'})${themeSplash ? '' : '. 이 테마는 로딩 화면이 없어서 내가 고른 로딩 화면이 떠요'}`;
        const cb = own.querySelector('input');
        cb.checked = list.includes(now) || !themeSplash;
        cb.disabled = !themeSplash;
        const rows = document.createElement('div');
        rows.className = 'etk-theme-rows';
        own.append(rows);
        for (const t of list.filter(t => t !== now)) {
            const row = document.createElement('div');
            row.className = 'etk-flex';
            row.innerHTML = '<small></small><div class="fa-solid fa-xmark interactable etk-known-del" title="목록에서 빼기"></div>';
            row.querySelector('small').textContent = t;
            row.querySelector('div').dataset.ownDel = encodeURIComponent(t);
            rows.append(row);
        }
        for (const k of ['bgImage', 'logo']) box.querySelector(`[data-show="${k}"]`).textContent = o[k] ? o[k].split('/').pop() : '';
        box.querySelectorAll('[data-swatch]').forEach(el => el.classList.toggle('etk-on', !!o.bgColor && el.dataset.swatch.toLowerCase() === String(o.bgColor).toLowerCase()));
        box.querySelector('.etk-swatch-custom')?.classList.toggle('etk-on', !!o.bgColor && !BG_SWATCHES.some(([, c]) => c.toLowerCase() === String(o.bgColor).toLowerCase()));
        box.querySelectorAll('.etk-splash-look').forEach(el => el.classList.toggle('etk-on', el.dataset.look === o.look));
    };
    show();
    addMaximize(box);
    // 테마를 목록에 넣고 빼면 바로 저장하고 로딩 파일도 다시 씀(다음 새로고침부터)
    const setOwn = (name, on) => {
        if (!name) return;
        const list = new Set(o.ownThemes || []);
        if (on) list.add(name); else list.delete(name);
        o.ownThemes = [...list];
        ignoreTheme = ownHere(o); applyThemeClass(); api.save(); syncFile(o); show();
    };
    box.addEventListener('click', e => { const del = e.target.closest('[data-own-del]'); if (del) setOwn(decodeURIComponent(del.dataset.ownDel), false); });
    box.addEventListener('input', e => {
        if (e.target.matches('[data-own]')) { setOwn(appliedTheme(), e.target.checked); return; }
        const k = e.target.dataset?.k; if (!k) return;
        o[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        if (e.target.type === 'color') e.target.classList.remove('etk-unset');
    });
    box.addEventListener('click', async e => {
        const look = e.target.closest('.etk-splash-look[data-look]');   // 내 세트 칸도 같은 모양 칸이라, data-look 이 있는 것만(없으면 모양이 비워졌음)
        if (look && e.target.closest('.etk-look-del')) {
            const c = SillyTavern.getContext(), k = look.dataset.look, nm = String(LOOKS[k]?.name || k).replace(/[<>&]/g, '');
            const r = await c.callGenericPopup(`<h3>‘${nm}’ 보기를 목록에서 지울까요?</h3>지우면 되돌릴 수 없어요.`, c.POPUP_TYPE.CONFIRM, '', { okButton: '지우기', cancelButton: '그대로 두기' });
            if (r !== c.POPUP_RESULT.AFFIRMATIVE) return;
            if (!o.hiddenLooks.includes(k)) o.hiddenLooks.push(k);
            api.save(); drawLooks(); drawSets();
            return;
        }
        if (look) {
            // 세트를 불러온 뒤 모양을 누르면 세트의 그림 · CSS 가 남아 모양이 안 바뀌어 보였음 — 지금 꾸밈이 세트 그대로면 비우고 모양만
            const mine = (x) => JSON.stringify(Object.entries(pickSet(x)).filter(([k]) => k !== 'look').sort());
            if ((o.sets || []).some(x => mine(x) === mine(o))) for (const k of SET_KEYS) delete o[k];
            o.look = o.look === look.dataset.look ? 'plain' : look.dataset.look; show(); redraw(); return;
        }   // 고른 모양을 다시 누르면 풀려서 실리태번 기본
        const sw = e.target.closest('[data-swatch]');
        if (sw) { o.bgColor = sw.dataset.swatch; show(); return; }
        const clear = e.target.closest('[data-clear]');
        if (clear) { delete o[clear.dataset.clear]; show(); return; }
        const pick = e.target.closest('[data-pick]');
        if (!pick) return;
        const isFont = pick.dataset.pick === 'fontFile';
        const file = await pickFile(isFont ? '.woff2,.woff,.ttf,.otf' : 'image/*,.gif');
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) return toastr.warning(isFont ? '8MB가 넘는 글꼴은 로딩이 늦어져요. woff2처럼 작은 파일을 골라 주세요.' : '8MB가 넘는 그림 · GIF는 로딩이 늦어져요. 더 작은 파일을 골라 주세요.');
        try { o[pick.dataset.pick] = await saveUserFile(`breeze-splash-${pick.dataset.pick}-${Date.now().toString(36)}.${extOf(file)}`, file)   /* 고를 때마다 새 이름 — 같은 이름에 덮으면 먼저 저장해 둔 세트의 그림까지 바뀌었음 */; show(); } catch (err) { toastr.error(String(err.message || err)); }
    });
    // 전체 화면 미리보기: 화면 전체에 실제 크기로 띄우고, 누르거나 Esc 로 닫음(세로 화면은 휴대폰 크기를 화면 높이에 맞춰 가운데)
    box.addEventListener('click', e => {
        const btn = e.target.closest('.etk-splash-full'); if (!btn) return;
        e.stopPropagation();
        const port = btn.dataset.full === 'port';
        const wrap = document.createElement('div'); wrap.className = 'etk-splash-fullview';
        const fr = document.createElement('iframe'); fr.setAttribute('sandbox', 'allow-same-origin');
        if (port) { const k = Math.min(innerHeight * .94 / 844, innerWidth * .94 / 390); Object.assign(fr.style, { width: '390px', height: '844px', transform: `scale(${k})` }); fr.classList.add('etk-port'); }
        fr.srcdoc = previewHtml(port ? (portraitOf(o) || o) : o);
        const close = document.createElement('div'); close.className = 'etk-splash-fullclose'; close.innerHTML = '<i class="fa-solid fa-xmark"></i> 닫기 (Esc)';
        wrap.append(fr, close); document.body.append(wrap);
        const done = () => { wrap.remove(); removeEventListener('keydown', key, true); };
        const key = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); done(); } };
        wrap.addEventListener('click', done); addEventListener('keydown', key, true);
    }, true);
    const frame = box.querySelector('.etk-splash-frame');
    // 실제 화면 크기(지금 창 크기)로 그린 뒤 칸 너비에 맞게 줄여 보여 줌 — 작은 칸에 바로 그리면 로고 · 글자가 화면 비율과 달라짐
    const view = box.querySelector('.etk-splash-view');
    const fit = () => {
        // 큰 미리보기는 늘 가로 화면(옆 휴대폰 칸이 세로를 보여 줌) — 휴대폰에서 열어도 가로로
        if (!view.clientWidth) return;   // 접힌 칸 안에서 그려질 때는 폭이 0 — 펼쳐져 크기가 생기면 아래 크기 감시가 다시 부름
        const w = Math.max(1280, innerWidth, innerHeight * 1.6), h = Math.round(w / 1.6), k = view.clientWidth / w;
        Object.assign(frame.style, { width: `${w}px`, height: `${h}px`, transform: `scale(${k})` });
        view.style.height = `${Math.round(h * k)}px`;
        // 옆 휴대폰 칸: 글 · 고르기 칸을 뺀 높이를 큰 미리보기와 맞추고, 폭은 휴대폰 비율(390:844)로
        const thumb = portraitFrame.parentElement, stacked = thumb.parentElement.offsetTop > view.offsetTop + 10;   // 좁은 화면: 위아래로 쌓이면 높이 맞춤 없이 넉넉히
        const ph = stacked ? 320 : Math.max(120, Math.round(h * k) - thumb.offsetTop + thumb.parentElement.offsetTop), pw = Math.round(ph * 390 / 844);
        Object.assign(thumb.style, { height: `${ph}px`, width: `${pw}px` });
        thumb.parentElement.style.width = `${Math.max(pw, 104)}px`;
        portraitFrame.style.transform = `scale(${ph / 844})`;
    };
    requestAnimationFrame(fit);
    // 칸이 접혀 있다가 펼쳐지거나 창 크기가 바뀌면 다시 맞춤(접힌 칸에서 처음 그려지면 폭이 0 이라 높이도 0 으로 남음)
    let lastW = 0;
    new ResizeObserver(() => { if (view.clientWidth !== lastW) { lastW = view.clientWidth; fit(); } }).observe(view);
    let t = 0;
    const redraw = () => {
        clearTimeout(t);
        t = setTimeout(() => {
            const style = frame.contentDocument?.getElementById('etk-preview-css');
            if (style) style.textContent = hoistImports(buildOne(o)).replace(/<\/style/gi, '');
            else frame.srcdoc = previewHtml(o);
        }, 120);
    };
    redraw();
    box.addEventListener('input', redraw);
    box.addEventListener('click', () => setTimeout(redraw, 50));
    const showState = async () => { state.textContent = (await linked()) ? '' : `서버 플러그인이 없어서, css/user.css 맨 위에 이 줄을 직접 넣어야 로딩 화면이 바뀌어요: ${IMPORT_LINE}`; };
    box.querySelector('.etk-splash-save').addEventListener('click', async () => {
        api.save();
        try {
            await saveUserFile(FILE, fileText(o));
            if (!ownHere(o) && staticSplash) toastr.info('다른 확장의 로딩 화면이 있어서 그쪽이 떠요. 내 화면을 쓰려면 ‘세부 설정’의 ‘지금 테마에서 내가 고른 로딩 화면 쓰기’를 켜요.');
            else toastr.success('적용했어요. 다음 새로고침부터 이 로딩 화면이 떠요.');
        } catch (e) { toastr.error(String(e.message || e)); }
        showState();
    });
    showState();
}
