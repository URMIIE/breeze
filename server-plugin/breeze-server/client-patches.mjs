// 브라우저로 보내는 본체 파일에 끼우는 조각들. 디스크의 파일은 고치지 않고, 보낼 때 메모리에서만 끼운다.
// 끼울 자리(find)가 하나라도 없으면(다른 실리태번 버전) 그 파일은 원본 그대로 보낸다.

export const CLIENT_PATCHES = [
    {
        feature: 'lazy_load',
        url: '/script.js',
        steps: [
            {
                find: "        headers: getRequestHeaders(),\n        body: JSON.stringify({}),\n        cache: 'no-cache',",
                replace: "        headers: getRequestHeaders(),\n        // 테마 · 프리셋은 지금 것만 내용째 받고 나머지는 쓸 때 받음\n        body: JSON.stringify({ lazyThemes: true, lazyPresets: true }),\n        cache: 'no-cache',",
            },
        ],
    },
    {
        feature: 'lazy_load',
        url: '/scripts/openai.js',
        steps: [
            {
                find: '    openai_settings = data.openai_settings;\n    openai_settings.forEach(function (item, i) {\n',
                replace: `    openai_settings = data.openai_settings;
    // 서버가 표시만 내려 준 프리셋은 누가 처음 읽을 때 받아 그 자리에 채움.
    // 읽는 쪽(본체 · 확장)은 예전처럼 openai_settings[번호] 를 바로 쓰면 됨 — 기다리는 코드로 바꿀 수 없는 곳이 많아 받기는 동기 요청
    const lazyPresetNames = [...openai_setting_names];
    openai_settings.forEach(function (item, i) {
`,
            },
            {
                find: '    openai_settings.forEach(function (item, i) {\n        openai_settings[i] = JSON.parse(item);\n    });\n',
                replace: `    openai_settings.forEach(function (item, i) {
        const parsed = JSON.parse(item);
        if (!parsed?.__lazyPreset) { openai_settings[i] = parsed; return; }
        const fill = (value) => Object.defineProperty(openai_settings, i, { value, writable: true, configurable: true, enumerable: true });
        Object.defineProperty(openai_settings, i, {
            configurable: true,
            enumerable: true,
            get() {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/settings/get-preset', false);
                for (const [k, v] of Object.entries(getRequestHeaders())) xhr.setRequestHeader(k, v);
                xhr.send(JSON.stringify({ name: lazyPresetNames[i] }));
                if (xhr.status !== 200) throw new Error(\`Could not load preset "\${lazyPresetNames[i]}" (\${xhr.status})\`);
                const value = JSON.parse(xhr.responseText);
                fill(value);
                return value;
            },
            set: fill,
        });
    });
`,
            },
        ],
    },
    {
        feature: 'lazy_load',
        url: '/scripts/power-user.js',
        steps: [
            {
                find: '\nfunction applyTheme(name) {\n',
                replace: `
// 켤 때 이름만 받은 테마는 고를 때 파일을 받아 채운 뒤 적용
const lazyThemeLoads = new Map();
function loadLazyTheme(theme) {
    if (!lazyThemeLoads.has(theme.name)) {
        lazyThemeLoads.set(theme.name, fetch('/api/themes/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file: theme.__lazyFile }) })
            .then(r => { if (!r.ok) throw new Error(\`theme \${r.status}\`); return r.json(); })
            .then(full => { delete theme.__lazyFile; Object.assign(theme, full); return theme; })
            .catch(err => { lazyThemeLoads.delete(theme.name); console.error('Theme load failed', theme.name, err); toastr.error(\`테마를 불러오지 못했어요: \${theme.name}\`); return null; }));
    }
    return lazyThemeLoads.get(theme.name);
}

function applyTheme(name) {
`,
            },
            {
                find: '    if (!theme) {\n        return;\n',
                replace: `    if (!theme) {
        return;
    }

    if (theme.__lazyFile) {
        loadLazyTheme(theme).then(full => { if (full && power_user.theme === name) { applyTheme(name); saveSettingsDebounced(); } });
        return;
`,
            },
        ],
    },
    {
        feature: 'regex_hook',
        url: '/scripts/extensions/regex/engine.js',
        steps: [
            {
                find: '        this.#cache.clear();\n    }\n}\n\n',
                replace: `        this.#cache.clear();
    }
}

/** @type {((scripts: RegexScript[], rawString: string, placement: number, options: object) => RegexScript[]|null|undefined)|null} */
let regexScriptsProvider = null;

/**
 * Lets an extension replace the script list used by getRegexedString.
 * @param {typeof regexScriptsProvider} fn Provider, or null to remove
 */
export function setRegexScriptsProvider(fn) {
    regexScriptsProvider = typeof fn === 'function' ? fn : null;
}

`,
            },
            {
                find: '\n    const allRegex = getRegexScripts({ allowedOnly: true });\n    allRegex.forEach((script) => {\n',
                replace: `
    let allRegex = getRegexScripts({ allowedOnly: true });
    // An extension may swap the list per message
    if (regexScriptsProvider) {
        try {
            allRegex = regexScriptsProvider(allRegex, rawString, placement, { isMarkdown, isPrompt, isEdit, depth }) ?? allRegex;
        } catch (error) {
            console.error('getRegexedString: regex scripts provider failed', error);
        }
    }
    allRegex.forEach((script) => {
`,
            },
        ],
    },
    // 채팅을 열 때마다 오른쪽 캐릭터 칸을 다시 고르며 칸 바꾸는 움직임을 돌리는데, 칸이 닫혀 있어도 돌아
    // 그때마다 화면 전체 배치를 다시 계산했음. 칸이 닫혀 있으면 움직임(시작할 때 배치를 강제로 다시 계산함)은 건너뛰고 투명도만 맞춤
    {
        feature: 'light_chat_open',
        url: '/script.js',
        steps: [
            {
                find: "    $('#result_info').toggle(selectedMenuId === 'rm_ch_create_block');\n    document.querySelectorAll('#right-nav-panel .right_menu').forEach((menu) => {",
                replace: "    $('#result_info').css('display', selectedMenuId === 'rm_ch_create_block' ? '' : 'none');\n    const rightShown = !!document.getElementById('right-nav-panel')?.matches('.openDrawer, .pinnedOpen');\n    document.querySelectorAll('#right-nav-panel .right_menu').forEach((menu) => {",
            },
            {
                find: "            $(menu).css('display', mode);\n            $(menu).css('opacity', 0.0);\n",
                replace: "            $(menu).css('display', mode);\n            if (!rightShown) { menu.style.opacity = '1'; return; }\n            $(menu).css('opacity', 0.0);\n",
            },
        ],
    },
    // 프리셋 목록을 만들면서 '내용이 있는 프리셋만' 고르려고 프리셋마다 내용을 읽는 확장이 있음. 프리셋을 쓸 때만 받는 동안에는
    // 그 한 줄이 켤 때 프리셋을 전부 하나씩 받아 오게 만들어(프리셋 125개면 요청 125번) 켜지는 게 몇 초 늦어짐.
    // → 내용을 읽지 않고 그 번호의 칸이 있는지만 봄. 그 줄이 없으면(다른 판) 아무것도 안 바꿈: 이 조각 때문에 쓸 때만 불러오기 전체가 쉬면 안 됨
    {
        feature: 'lazy_load',
        url: '/scripts/extensions/third-party/prompt-panel/index.js',
        steps: [
            {
                apply(text) {
                    const find = 'filter(n=>openai_settings[openai_setting_names[n]]).map(n=>({id:n,name:n}))';
                    return text.includes(find) ? text.replace(find, () => 'filter(n=>openai_setting_names[n] in openai_settings).map(n=>({id:n,name:n}))') : text;
                },
            },
        ],
    },
    // 메시지 안 화면(상태창)을 그리는 확장은 '채팅 다 열림' 신호가 와야 그리기 시작하는데, 그 신호는 모든 확장의 '채팅 바뀜' 처리가
    // 차례로 끝난 뒤에야 나와서 메시지가 뜬 뒤 몇 초 동안 상태창 자리에 코드만 보였음. 게다가 화면 밖 상태창까지 한꺼번에 읽어 보이는 것이 더 늦었음.
    // → '채팅 바뀜' 맨 앞에서 맨 아래 메시지 둘의 상태창부터 그리고, 그중 화면 아래쪽 두 화면 높이 안에 있는 것이 뜰 때까지(길어도 1초)
    //   다음 처리를 기다리게 함. 나머지는 원래대로 '채팅 다 열림' 때 그리되 먼저 그린 것은 다시 그리지 않음. 그룹 채팅은 원래대로.
    // 이 파일은 압축돼 있어 판마다 이름이 바뀌므로 이름은 코드 모양에서 뽑아 씀. 하나라도 못 찾으면 원본 그대로 보냄
    {
        feature: 'early_message_frames',
        url: '/scripts/extensions/third-party/JS-Slash-Runner/dist/index.js',
        steps: [
            {
                apply(text) {
                    const I = '[\\w$]+', q = (x) => x.replace(/\$/g, '\\$');
                    const one = (re) => { const m = [...text.matchAll(re)]; return m.length === 1 ? m[0] : null; };
                    // '채팅 다 열림' 때 전부 새로 그리는 줄: 신호 묶음 · 설정 · 그린 목록 · '전부 새로 그리기' 함수 이름
                    const whole = one(new RegExp(`(${I})\\.on\\(\`chatLoaded\`,\\(\\)=>\\{(${I})\\.settings\\.render\\.enabled&&\\((${I})\\.value=(${I})\\(\\2\\.settings\\.render\\.depth,\\2\\.settings\\.render\\.depth_ignore_hidden\\)\\)\\}\\)`, 'g'));
                    if (!whole) return null;
                    const [found, bus, set, list, redrawAll] = whole;
                    // '고른 메시지만 그리기' 함수와 새 표시 만드는 함수
                    const some = one(new RegExp(`function ${q(redrawAll)}\\(${I},${I}\\)\\{return (${I})\\(${I}\\(${I},${I}\\),(${I})\\(\\)\\)\\}`, 'g'));
                    // '이미 그린 것은 두고 빠진 것만 그리기' 함수
                    const keep = new Set([...text.matchAll(new RegExp(`${q(list)}\\.value=(${I})\\(${q(list)}\\.value,${q(set)}\\.settings\\.render\\.depth,`, 'g'))].map(m => m[1]));
                    // 메시지 하나의 매크로 글자를 바꿔 주는 함수(먼저 해 두지 않으면 나중에 메시지를 통째로 다시 써서 먼저 그린 상태창이 지워짐)
                    const macro = one(new RegExp(`function (${I})\\(${I}\\)\\{${I}\\(\\$\\(\`#chat > \\.mes\\[mesid="\\$\\{${I}\\}"\\]\`\\)\\)\\}`, 'g'));
                    if (!some || keep.size !== 1 || !macro) return null;
                    const [, drawSome, stamp] = some, keepDrawn = [...keep][0], macroOne = macro[1];
                    const on = `${set}.settings.render`;
                    const early = `${bus}.makeFirst(\`chat_id_changed\`,async()=>{if(!${on}.enabled||${on}.allow_streaming||SillyTavern.getContext().groupId)return;`
                        + 'let n=$(`#chat > .mes[mesid]`).slice(-2).toArray().map(e=>Number(e.getAttribute(`mesid`)));if(n.length===0)return;'
                        + `${set}.settings.macro?.enabled&&n.forEach(${macroOne});`
                        + `let r=${list}.value.filter(e=>e.elements.every(e=>e.isConnected));`
                        + `let i=${drawSome}(_.difference(n,r.map(e=>e.message_id)),${stamp}());if(i.length===0){${list}.value=r;return}${list}.value=_.concat(r,i);`
                        + 'await new Promise(e=>setTimeout(e,0));'
                        + 'let o=document.getElementById(`chat`),s=o.getBoundingClientRect().top-o.scrollTop+o.scrollHeight,a=i.flatMap(e=>e.elements).map(e=>e.querySelector(`iframe`)).filter(e=>e&&s-e.getBoundingClientRect().top<2*o.clientHeight);'
                        + 'await Promise.race([Promise.all(a.map(e=>new Promise(t=>e.addEventListener(`load`,t,{once:!0})))),new Promise(e=>setTimeout(e,1e3))])})';
                    const later = `${bus}.on(\`chatLoaded\`,()=>{${on}.enabled&&(${list}.value=${keepDrawn}(${list}.value.filter(e=>e.elements.every(e=>e.isConnected&&e.querySelector(\`iframe\`))),${on}.depth,${on}.depth_ignore_hidden))})`;
                    return text.replace(found, () => `${early},${later}`);
                },
            },
        ],
    },
    // 위 조각으로 보이는 상태창은 먼저 뜨지만, '채팅 다 열림' 때 화면에서 먼 메시지의 상태창까지 한꺼번에 그려서(상태창마다 공용 파일을 읽고 돌림)
    // 그동안 화면이 버벅이고 전부 뜨는 때가 몇 초 늦었음.
    // → 그 확장의 '그릴 메시지 번호 고르기' 함수를 감싸, 채팅 칸 위아래 두 화면 안으로 들어온 적 있는 메시지와 맨 아래 둘만 남김.
    //   가까워졌다는 알림(IntersectionObserver)이 오면 '빠진 것만 그리기'를 한 번 돌림. 한 번 그린 것은 그대로 둠.
    //   메시지 번호는 지우면 바뀌므로 번호가 아니라 메시지 칸으로 기억. 그룹 채팅과, 그 확장의 코드 접기를 끈 경우(안 그린 칸이 긴 코드로 보임)는 원래대로 전부 그림.
    // 위 조각이 끼워진 글에만 덧붙음(없으면 쉼)
    {
        feature: 'near_message_frames',
        url: '/scripts/extensions/third-party/JS-Slash-Runner/dist/index.js',
        steps: [
            {
                apply(text) {
                    const I = '[\\w$]+';
                    const calc = [...text.matchAll(new RegExp(`function (${I})\\((${I}),(${I})\\)\\{let ${I}=Number\\(\\$\\(\`#chat > \\.mes\`\\)\\.first\\(\\)\\.attr\\(\`mesid\`\\)\\);`, 'g'))];
                    const later = text.match(new RegExp(`(${I})\\.on\\(\`chatLoaded\`,\\(\\)=>\\{(${I}\\.settings\\.render)\\.enabled&&\\((${I})\\.value=(${I})\\(\\3\\.value\\.filter\\(`));
                    const first = text.match(new RegExp(`${I}\\.makeFirst\\(\`chat_id_changed\`,async\\(\\)=>\\{`));
                    if (calc.length !== 1 || !later || !first) return null;
                    const name = calc[0][1], [, , on, list, keepDrawn] = later;
                    const wrapper = `function ${name}(a,b){const all=${name}__all(a,b),g=globalThis.__nearMessageFrames,c=document.getElementById(\`chat\`);if(!g||!c||!g.on()||SillyTavern.getContext().groupId)return all;`
                        + 'const ok=new Set;for(const m of c.querySelectorAll(`:scope > .mes[mesid]`)){if(!g.seen.has(m)){g.seen.add(m);g.io.observe(m)}g.near.has(m)&&ok.add(Number(m.getAttribute(`mesid`)))}'
                        + 'const last=SillyTavern.getContext().chat.length-2;return all.filter(i=>i>=last||ok.has(i))}';
                    const setup = `(globalThis.__nearMessageFrames={seen:new WeakSet,near:new WeakSet,on:()=>${on}.enabled&&${on}.collapse_code_block!==\`none\`,`
                        + `io:new IntersectionObserver(es=>{const g=globalThis.__nearMessageFrames;let hit=!1;for(const e of es)e.isIntersecting&&!g.near.has(e.target)&&(g.near.add(e.target),hit=!0);`
                        + `hit&&g.on()&&(${list}.value=${keepDrawn}(${list}.value,${on}.depth,${on}.depth_ignore_hidden))},{root:document.getElementById(\`chat\`),rootMargin:\`200% 0px\`})}),`;
                    return text
                        .replace(calc[0][0], () => wrapper + calc[0][0].replace(`function ${name}(`, `function ${name}__all(`))
                        .replace(first[0], () => setup + first[0]);
                },
            },
        ],
    },
    // 실리태번은 켤 때 설정 묶음(프리셋 · 테마 · 빠른 답장 세트 등)을 한 번 받는데, 기본 확장인 빠른 답장이 자기 세트를 얻으려고 같은 묶음을 통째로 한 번 더 받음.
    // 프리셋이 많으면 그 한 번이 수십 MB 라 켜질 때 2초쯤 더 걸림(쓸 때만 불러오기를 켜도 이 요청은 전부 내용째 받음).
    // → 처음 받은 묶음의 빠른 답장 세트를 잠깐 맡아 두었다가 빠른 답장이 한 번 가져가게 함. 두 파일 중 한쪽만 끼워져도 안 깨지게 import 대신 전역 칸으로 넘김.
    // 이미 같은 고침이 파일에 들어 있으면(표시 글자) 건드리지 않음
    {
        feature: 'settings_once',
        url: '/script.js',
        steps: [
            {
                apply(text) {
                    if (text.includes('takeStartupQuickReplyPresets')) return text;
                    const find = "    const data = await response.json();\n    if (data.result != 'file not find' && data.settings) {";
                    if (!text.includes(find)) return null;
                    return text.replace(find, () => "    const data = await response.json();\n    globalThis.__startupQuickReplyPresets = Array.isArray(data.quickReplyPresets) ? data.quickReplyPresets : null;\n    if (data.result != 'file not find' && data.settings) {");
                },
            },
        ],
    },
    {
        feature: 'settings_once',
        url: '/scripts/extensions/quick-reply/index.js',
        steps: [
            {
                apply(text) {
                    if (text.includes('takeStartupQuickReplyPresets')) return text;
                    const find = "const loadSets = async () => {\n    const response = await fetch('/api/settings/get', {";
                    if (!text.includes(find)) return null;
                    return text.replace(find, () => "const loadSets = async () => {\n    const startupSets = globalThis.__startupQuickReplyPresets;\n    globalThis.__startupQuickReplyPresets = null;\n    const response = Array.isArray(startupSets) ? { ok: true, json: async () => ({ quickReplyPresets: startupSets }) } : await fetch('/api/settings/get', {");
                },
            },
        ],
    },
];
