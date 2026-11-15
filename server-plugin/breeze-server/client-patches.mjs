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
];
