// breeze의 짝 서버 플러그인.
// 실리태번 본체 파일을 디스크에서 고치지 않는다. 서버가 켜져 있는 동안 메모리에서만 처리기를 끼워 넣으므로,
// 이 폴더를 빼고 서버를 다시 켜면 아무 흔적 없이 원래대로 돌아가고 실리태번 업데이트(git pull)도 막지 않는다.
// 기능마다 끼울 자리를 못 찾으면(다른 실리태번 버전) 그 기능만 쉬고 서버 창에 한 줄 알린다.
// 켜고 끌 기능은 같은 폴더 config.json 의 "features" (없으면 전부 켬).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { CLIENT_PATCHES } from './client-patches.mjs';

export const info = {
    id: 'breeze-server',
    name: 'Everyday Toolkit server',
    description: 'Faster startup and lists for SillyTavern, plus hooks used by the Everyday Toolkit extension. Changes nothing on disk.',
};

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.cwd();
const TAG = '[breeze]';
// 플러그인 버전: breeze 확장 버전(manifest.json)과 같게 둠(둘이 다른 이름을 쓰면 헷갈려서). 배포할 때 manifest 버전과 함께 올림
const PLUGIN_VERSION = '1.2.2';
const verNum = (v) => (typeof v === 'number' ? v : String(v || '').split('.').slice(0, 3).reduce((a, n) => a * 1000 + (Number(n) || 0), 0));
const PLUGIN_FILES = ['index.mjs', 'client-patches.mjs', 'package.json'];
let updatedTo = 0;

// 업데이트: 확장을 업데이트해도 실리태번 plugins 폴더의 이 사본은 그대로라, 새 기능을 쓰려면 사람이 다시 복사해야 했음.
// 확장 폴더들 안의 server-plugin/breeze-server 중 버전이 가장 높은 것을 찾아 이 폴더를 덮어씀(지금 도는 코드는 그대로, 서버를 다시 켜면 새 판).
// 버전이 같거나 낮으면 손대지 않음(사용자 폴더가 여럿이고 옛 확장이 남아 있어도 내려가지 않게). 설정(config.json) · 아이콘은 건드리지 않음.
// 설정 창의 '지금 업데이트'(POST /update) 또는 '자동 업데이트'(config.json autoUpdate)
function versionOf(file) {
    // 예전 꼴(숫자 3 · 4)도 읽음: 숫자는 버전 꼴(1.2.0)보다 늘 낮게 견줘짐
    try { const m = fs.readFileSync(file, 'utf8').match(/const PLUGIN_VERSION = (?:'([\d.]+)'|(\d+));/); return m ? (m[1] || Number(m[2])) : 0; } catch { return 0; }
}
function pluginCopies() {
    const roots = [];
    const dataRoot = globalThis.DATA_ROOT || path.join(ROOT, 'data');
    try { for (const u of fs.readdirSync(dataRoot, { withFileTypes: true })) if (u.isDirectory() && !u.name.startsWith('_')) roots.push(path.join(dataRoot, u.name, 'extensions')); } catch { /* 자료 폴더 못 읽음 */ }
    roots.push(path.join(ROOT, 'public', 'scripts', 'extensions', 'third-party'));
    const out = [];
    for (const r of roots) {
        let names;
        try { names = fs.readdirSync(r); } catch { continue; }
        for (const n of names) { const dir = path.join(r, n, 'server-plugin', 'breeze-server'); if (fs.existsSync(path.join(dir, 'index.mjs'))) out.push(dir); }
    }
    return out;
}
const hereDir = () => fs.realpathSync(path.dirname(fileURLToPath(import.meta.url)));
function newestCopy() {
    const here = hereDir();
    let best = null, bestVersion = verNum(updatedTo) > verNum(PLUGIN_VERSION) ? updatedTo : PLUGIN_VERSION;
    for (const dir of pluginCopies()) {
        let real; try { real = fs.realpathSync(dir); } catch { continue; }
        if (real === here) continue;
        const v = versionOf(path.join(dir, 'index.mjs'));
        if (verNum(v) > verNum(bestVersion)) { best = dir; bestVersion = v; }
    }
    return best ? { dir: best, version: bestVersion } : null;
}
function applyUpdate() {
    const found = newestCopy();
    if (!found) return 0;
    const here = hereDir();
    for (const f of PLUGIN_FILES) { const src = path.join(found.dir, f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(here, f)); }
    updatedTo = found.version;
    console.log(`${TAG} 서버 플러그인을 ${found.version} 버전으로 바꿔 두었어요. 실리태번 서버를 다시 켜면 적용돼요.`);
    return found.version;
}
function readConfig() { try { return JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8')) || {}; } catch { return {}; } }
function writeConfig(json) { fs.writeFileSync(path.join(HERE, 'config.json'), `${JSON.stringify(json, null, 2)}\n`); }
function updateInfo() {
    let available = 0;
    try { available = newestCopy()?.version || 0; } catch { /* 못 찾음 */ }
    return { plugin: PLUGIN_VERSION, updated: updatedTo, available, autoUpdate: readConfig().autoUpdate === true };
}
const FEATURES = ['lazy_load', 'folder_cache', 'chat_cache', 'no_local_compression', 'regex_hook', 'tab_icon', 'loading_screen', 'light_chat_open', 'early_message_frames', 'near_message_frames', 'settings_once'];
/** 기능 → 'on' | 'off' | 'mismatch: 까닭' */
const status = {};
const undo = [];   // 서버를 끌 때 되돌릴 일

function config() {
    try { return JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8')).features || {}; } catch { return {}; }
}
// 다른 기능이 쓰는 받침(연결 지점 · 로딩 화면 파일 읽기)은 설정과 상관없이 늘 켬: 화면에 줄이 없어 꺼 둔 채로 남으면 켤 길이 없음
const ALWAYS_ON = new Set(['regex_hook', 'loading_screen']);
const wanted = (name) => ALWAYS_ON.has(name) || config()[name] !== false;
function rest(name, why) { status[name] = `mismatch: ${why}`; console.warn(`${TAG} ${name}: 이 실리태번 버전과 안 맞아 쉼 — ${why}`); }

const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

// ───────── 처리기 한 겹 만들기 ─────────
// 실리태번이 플러그인에게 준 라우터에 잠깐 등록했다 꺼내 쓴다(익스프레스를 따로 불러오지 않아도 되게).
let scratch = null;
function makeLayer(method, routePath, handler) {
    if (method) scratch[method](routePath, handler); else scratch.use(handler);
    return scratch.stack.pop();
}
function putFirst(router, layer) {
    router.stack.unshift(layer);
    undo.push(() => { const i = router.stack.indexOf(layer); if (i >= 0) router.stack.splice(i, 1); });
}

// 바뀌지 않은 폴더 알아보기: 파일 이름 · 수정 시각 · 크기를 이어 붙인 글
function folderStamp(dir, ext = '.json') {
    let out = '';
    let names;
    try { names = fs.readdirSync(dir); } catch { return '(없음)'; }
    for (const name of names.sort()) {
        if (ext && path.extname(name).toLowerCase() !== ext) continue;
        const st = fs.statSync(path.join(dir, name), { throwIfNoEntry: false });
        out += `${name}\t${st ? `${st.mtimeMs}\t${st.size}` : '?'}\n`;
    }
    return out;
}

// ───────── 설정 묶음: 바뀌지 않은 폴더는 다시 안 읽기 + 프리셋 · 테마는 쓸 때만 ─────────
// 실리태번은 켤 때마다(그리고 여러 확장이 따로) 설정 묶음을 통째로 받는데, 그때마다 프리셋 · 테마 등 폴더 열몇 개의 파일을 전부 다시 읽는다.
// 폴더마다 내용이 그대로면 지난번에 만든 그 폴더 몫 글을 다시 쓰고, 화면이 청하면(lazy…) 지금 쓰는 프리셋 · 테마만 내용째 보낸다.
const PRESET_DIRS = [   // [폴더, 내용 열쇠, 이름 열쇠]
    ['koboldAI_Settings', 'koboldai_settings', 'koboldai_setting_names'],
    ['novelAI_Settings', 'novelai_settings', 'novelai_setting_names'],
    ['openAI_Settings', 'openai_settings', 'openai_setting_names'],
    ['textGen_Settings', 'textgenerationwebui_presets', 'textgenerationwebui_preset_names'],
];
const PARSED_DIRS = [   // [폴더, 열쇠]
    ['themes', 'themes'], ['movingUI', 'movingUIPresets'], ['quickreplies', 'quickReplyPresets'],
    ['instruct', 'instruct'], ['context', 'context'], ['sysprompt', 'sysprompt'], ['reasoning', 'reasoning'],
];
const KNOWN_DIRS = new Set([...PRESET_DIRS.map(x => x[0]), ...PARSED_DIRS.map(x => x[0]), 'worlds', 'root']);
const KNOWN_KEYS = new Set(['settings', 'world_names', ...PRESET_DIRS.flatMap(x => [x[1], x[2]]), ...PARSED_DIRS.map(x => x[1])]);

// 원래 처리기를 빈 폴더로 한 번 돌려서: 우리가 모르는 폴더를 읽는지 · 모르는 목록 칸이 생겼는지 확인하고, 폴더와 상관없는 나머지 칸을 얻는다.
function probeSettingsHandler(original) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'etk-probe-'));
    try {
        const empty = path.join(tmp, 'empty');
        fs.mkdirSync(empty);
        fs.writeFileSync(path.join(tmp, 'settings.json'), '{}');
        const touched = new Set();
        const directories = new Proxy({}, { get: (_t, key) => { touched.add(String(key)); return key === 'root' ? tmp : empty; } });
        let sent;
        const response = { send: (v) => { sent = v; return response; }, sendStatus: () => response, type: () => response, status: () => response, set: () => response, setHeader: () => response };
        original({ user: { directories, profile: { handle: 'probe' } }, body: {} }, response);
        if (typeof sent === 'string') sent = JSON.parse(sent);
        if (!sent || typeof sent !== 'object') return { why: '설정 응답 꼴이 다름' };
        const unknownDir = [...touched].find(k => !KNOWN_DIRS.has(k));
        if (unknownDir) return { why: `모르는 폴더를 읽음(${unknownDir})` };
        for (const k of KNOWN_KEYS) if (!(k in sent)) return { why: `응답에 ${k} 칸이 없음` };
        const rest = {};
        for (const [k, v] of Object.entries(sent)) {
            if (KNOWN_KEYS.has(k)) continue;
            if (Array.isArray(v)) return { why: `모르는 목록 칸(${k})` };
            rest[k] = v;
        }
        return { rest };
    } catch (e) {
        return { why: `확인 중 오류(${e.message})` };
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// breeze 확장이 그 사용자 확장 폴더나 전역 확장 폴더에 아직 있는지(폴더 이름은 사람마다 달라 로딩 화면 기능 파일로 알아봄).
// 확장을 지웠는데 남은 로딩 화면 파일 때문에 로딩 화면이 계속 바뀌어 있지 않게
function breezeInstalled(user) {
    const roots = [user?.directories?.extensions, path.join(ROOT, 'public', 'scripts', 'extensions', 'third-party')].filter(Boolean);
    for (const root of roots) {
        let names = [];
        try { names = fs.readdirSync(root); } catch { continue; }
        if (names.some(n => fs.existsSync(path.join(root, n, 'features', 'loading_screen.js')) && fs.existsSync(path.join(root, n, 'manifest.json')))) return true;
    }
    return false;
}

const partMemo = new Map();
function part(key, stamp, build) {
    const hit = partMemo.get(key);
    if (hit && hit.stamp === stamp) return hit.json;
    const json = build();
    partMemo.set(key, { stamp, json });
    return json;
}

// 프리셋 폴더: 실리태번과 같은 순서 · 같은 건너뛰기(JSON 이 아닌 파일은 뺌). 내용은 글 그대로, 이름은 확장자 뺀 것
function readPresets(dir) {
    const contents = [], names = [];
    for (const file of fs.readdirSync(dir).sort((a, b) => a.localeCompare(b)).filter(x => path.parse(x).ext == '.json')) {
        try {
            const text = fs.readFileSync(path.join(dir, file), 'utf8');
            JSON.parse(text);
            contents.push(text);
            names.push(file.replace(/\.[^/.]+$/, ''));
        } catch { /* 실리태번도 건너뜀 */ }
    }
    return { contents, names };
}
function readParsed(dir) {
    const out = [];
    for (const file of fs.readdirSync(dir).filter(x => path.parse(x).ext == '.json').sort()) {
        try { out.push({ file, data: JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) }); } catch { /* 건너뜀 */ }
    }
    return out;
}

function settingsBody(request, restJson, lazyOk) {
    const d = request.user.directories;
    const who = request.user.profile?.handle ?? '';
    const settings = fs.readFileSync(path.join(d.root, 'settings.json'), 'utf8');
    const lazyThemes = lazyOk && !!request.body?.lazyThemes;
    const lazyPresets = lazyOk && !!request.body?.lazyPresets;
    let current = null;
    if (lazyThemes || lazyPresets) { try { const s = JSON.parse(settings); current = { theme: s?.power_user?.theme ?? null, preset: s?.oai_settings?.preset_settings_openai ?? null }; } catch { current = {}; } }

    const pieces = [`"settings":${JSON.stringify(settings)}`];
    for (const [dirKey, contentsKey, namesKey] of PRESET_DIRS) {
        const lazy = lazyPresets && dirKey === 'openAI_Settings';
        pieces.push(part(`${who}|${contentsKey}|${lazy ? `lazy:${current.preset}` : 'full'}`, folderStamp(d[dirKey]), () => {
            const { contents, names } = readPresets(d[dirKey]);
            // 번호가 어긋나지 않게 목록 · 순서는 그대로 두고, 지금 프리셋이 아닌 것만 표시로 바꿈
            const list = lazy ? contents.map((c, i) => (names[i] === current.preset ? c : '{"__lazyPreset":true}')) : contents;
            return `"${contentsKey}":${JSON.stringify(list)},"${namesKey}":${JSON.stringify(names)}`;
        }));
    }
    pieces.push(part(`${who}|world_names`, folderStamp(d.worlds), () => `"world_names":${JSON.stringify(
        fs.readdirSync(d.worlds).filter(f => path.extname(f).toLowerCase() === '.json').sort((a, b) => a.localeCompare(b)).map(f => path.parse(f).name))}`));
    for (const [dirKey, key] of PARSED_DIRS) {
        const lazy = lazyThemes && dirKey === 'themes';
        pieces.push(part(`${who}|${key}|${lazy ? `lazy:${current.theme}` : 'full'}`, folderStamp(d[dirKey]), () => {
            const items = readParsed(d[dirKey]);
            const list = lazy ? items.map(x => (x.data?.name === current.theme ? x.data : { name: x.data?.name, __lazyFile: x.file })) : items.map(x => x.data);
            return `"${key}":${JSON.stringify(list)}`;
        }));
    }
    if (restJson) pieces.push(restJson);
    return `{${pieces.join(',')}}`;
}

async function setupSettings() {
    const cache = wanted('folder_cache'), lazy = wanted('lazy_load');
    status.folder_cache = cache ? 'on' : 'off';
    status.lazy_load = lazy ? 'on' : 'off';
    if (!cache && !lazy) return;
    const both = (why) => { if (cache) rest('folder_cache', why); if (lazy) rest('lazy_load', why); };
    let settingsRouter, themesRouter;
    try { settingsRouter = (await load('src/endpoints/settings.js')).router; themesRouter = (await load('src/endpoints/themes.js')).router; } catch (e) { return both(`본체 모듈을 못 읽음(${e.message})`); }
    const original = settingsRouter?.stack?.find(l => l.route?.path === '/get' && l.route.methods?.post)?.route?.stack?.[0]?.handle;
    if (typeof original !== 'function') return both('설정 읽기 처리기를 못 찾음');
    if (settingsRouter.stack.some(l => l.route?.path === '/get-preset')) return both('같은 일을 하는 다른 수정이 이미 들어 있음');
    const probe = probeSettingsHandler(original);
    if (probe.why) return both(probe.why);
    const restJson = JSON.stringify(probe.rest).slice(1, -1);

    putFirst(settingsRouter, makeLayer('post', '/get', (request, response, next) => {
        // 폴더 기억을 껐으면 화면이 ‘쓸 때만’을 청한 요청만 맡고, 나머지는 원래 처리기로
        if (!cache && !(request.body?.lazyThemes || request.body?.lazyPresets)) return next();
        let body;
        try {
            if (!cache) partMemo.clear();
            body = settingsBody(request, restJson, status.lazy_load === 'on');   // 화면 쪽 조각이 안 맞아 쉬게 됐으면 전부 내용째
        } catch (e) {
            console.warn(`${TAG} 설정 묶음을 만들지 못해 원래 처리기로 넘김 — ${e.message}`);
            return next();
        }
        response.type('application/json').send(body);
    }));
    if (!lazy) return;
    putFirst(settingsRouter, makeLayer('post', '/get-preset', (request, response) => {
        const name = request.body?.name;
        if (typeof name !== 'string' || !name || /[\\/]|\.\./.test(name)) return response.sendStatus(400);
        const file = path.join(request.user.directories.openAI_Settings, `${name}.json`);
        if (!fs.existsSync(file)) return response.sendStatus(404);
        response.type('application/json').send(fs.readFileSync(file, 'utf8'));
    }));
    putFirst(themesRouter, makeLayer('post', '/get', (request, response) => {
        const name = path.basename(String(request.body?.file || ''));
        if (!name || path.extname(name) !== '.json') return response.sendStatus(400);
        const file = path.join(request.user.directories.themes, name);
        if (!fs.existsSync(file)) return response.sendStatus(404);
        response.type('application/json').send(fs.readFileSync(file, 'utf8'));
    }));
}

// ───────── 채팅 목록: 바뀌지 않았으면 다시 안 읽기 + 미리보기용 칸 ─────────
// 홈 화면 최근 채팅 · 캐릭터 채팅 목록은 열 때마다 채팅 파일을 처음부터 끝까지 읽는다(메시지 수 · 마지막 말을 알려고).
// 관련 채팅 파일들의 이름 · 수정 시각 · 크기가 그대로면 지난번 응답을 그대로 다시 보낸다.
// 새로 읽었을 땐 응답 항목마다 마지막 메시지의 보이는 번역문 · 내 말 여부 · 만든 프리셋을 덧붙여, 화면 쪽 확장이 미리보기를 화면처럼 만들 수 있게 한다.
const chatMemo = new Map();

// 파일 끝 조각만 읽어 마지막 줄(마지막 메시지)을 얻음
function lastMessage(file) {
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const size = fs.fstatSync(fd).size;
        let want = 256 * 1024;
        while (true) {
            const len = Math.min(size, want);
            const buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, size - len);
            const text = buf.toString('utf8').trimEnd();
            const at = text.lastIndexOf('\n');
            if (at >= 0 || len === size) { try { return JSON.parse(text.slice(at + 1)); } catch { return null; } }
            if (want >= 64 * 1024 * 1024) return null;
            want *= 4;
        }
    } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// 파일 앞 조각만 읽어 첫 메시지(머리 줄 다음 줄)를 얻음. 채팅 이름의 날짜는 분기 채팅이면 원래 채팅 것이라 시작 날짜로 못 씀
function firstMessage(file, withHead = false) {
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const size = fs.fstatSync(fd).size;
        let want = 64 * 1024;
        while (true) {
            const len = Math.min(size, want);
            const buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, 0);
            const lines = buf.toString('utf8').split('\n');
            if (lines.length > 2 || len === size) {
                // 머리 줄(채팅 정보)은 크면 수백 KB 라 통째로 해석하지 않고 분기 표시(main_chat)가 있는지만 글자로 봄
                const head = withHead ? { branch: /"main_chat"\s*:\s*"[^"]/.test(lines[0]) } : null;
                for (const l of lines.slice(1, len === size ? undefined : -1)) { try { const m = JSON.parse(l); if (m && typeof m.mes === 'string') return withHead ? { m, head } : m; } catch { /* 깨진 줄 */ } }
                return withHead ? { m: null, head } : null;
            }
            if (want >= 64 * 1024 * 1024) return null;
            want *= 4;
        }
    } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

const PREVIEW_CUT = 1500;
function addPreviewFields(items, fileOf, withSource = false) {
    for (const item of items) {
        if (!item || typeof item !== 'object' || !item.file_name || 'display_mes' in item) continue;
        const file = fileOf(item);
        const last = file && lastMessage(file);
        if (!last || typeof last !== 'object') continue;
        item.display_mes = typeof last.extra?.display_text === 'string' ? last.extra.display_text : '';
        item.mes_is_user = !!last.is_user;
        item.mes_preset = typeof last.extra?.regex_preset === 'string' ? last.extra.regex_preset : '';
        // 채팅 파일 관리 창(찾기): 마지막 글을 통째로 보내면 채팅 수십 개에 응답이 MB 단위로 커지고 화면 쪽에서 글마다 정규식을 돌려 창이 늦게 떴음
        // → 화면에 보일 글(번역문 먼저)의 앞 · 뒤 조각만. 앞은 줄의 마지막 글 두 줄, 뒤는 미리보기(끝 400자)에 씀
        if (withSource) {
            const src = item.display_mes || (typeof last.mes === 'string' ? last.mes : '');
            item.preview_head = src.slice(0, PREVIEW_CUT);
            item.preview_tail = src.length > PREVIEW_CUT ? src.slice(-PREVIEW_CUT) : src;
            // 답이 앞 조각보다 긴 태그 덩어리(생각 글 등)로 시작하면 앞 조각이 통째로 그 덩어리라 화면에서 숨겨져 빈 줄이 됨
            // → 그 덩어리가 닫힌 뒤부터 한 조각 더(숨길지는 화면 쪽 정규식이 정함: 본문이 태그로 감싸인 답도 있어 여기서 지우지 않음)
            const open = /^\s*<([A-Za-z][\w-]*)[^>]*>/.exec(src);
            if (open) {
                const close = src.toLowerCase().indexOf(`</${open[1].toLowerCase()}>`, open[0].length);
                const end = close < 0 ? -1 : close + open[1].length + 3;
                if (end > PREVIEW_CUT) item.preview_after = src.slice(end).trimStart().slice(0, PREVIEW_CUT);
            }
            item.display_mes = '';
        }
        if (withSource) {
            const r = firstMessage(file, true), first = r?.m;
            if (first?.send_date) item.first_date = first.send_date;   // 찾기 응답의 미리보기는 끝 400자로 잘려 있어 통째로 한 번 더
            // 분기 채팅은 모채팅 메시지(보낸 시각 포함)를 그대로 복사해 '마지막 대화'가 모채팅 시각이라, 방금 만든 분기도 '한 달 전'으로 · 최근순 아래에 떴음
            // → 분기 채팅이면 파일을 만든 시각도 보냄(화면에서 마지막 대화와 둘 중 늦은 쪽을 씀)
            if (r?.head?.branch) { const st = fs.statSync(file, { throwIfNoEntry: false }); if (st?.birthtimeMs > 0) item.branch_born = Math.round(st.birthtimeMs); }
        }
    }
}

// memo: 꺼져 있으면 응답을 기억해 두었다 다시 쓰는 것만 안 하고, 미리보기 칸은 그대로 붙임
function cachedList(key, stampOf, fileOf, withSource = false, memo = true) {
    return (request, response, next) => {
        let memoKey, stamp;
        try {
            memoKey = `${request.user.profile?.handle ?? ''}|${key}|${JSON.stringify(request.body ?? {})}`;
            stamp = memo ? stampOf(request) : '';
        } catch { return next(); }
        const hit = memo && chatMemo.get(memoKey);
        if (hit && hit.stamp === stamp) return response.type('application/json').send(hit.json);
        // 원래 처리기가 보내는 응답을 받아 적어 둠
        const send = response.send.bind(response);
        response.send = (value) => {
            response.send = send;
            try {
                if (Array.isArray(value) && response.statusCode === 200) {
                    addPreviewFields(value, (item) => fileOf(request, item), withSource);
                    const json = JSON.stringify(value);
                    if (memo) { if (chatMemo.size > 400) chatMemo.clear(); chatMemo.set(memoKey, { stamp, json }); }
                    return response.type('application/json').send(json);
                }
            } catch (e) { console.warn(`${TAG} 채팅 목록 기억 실패 — ${e.message}`); }
            return send(value);
        };
        next();
    };
}

async function setupChats() {
    // 이 기능을 꺼도 채팅 목록 응답에 미리보기 칸(마지막 글 등)은 붙임: 화면 쪽 채팅 목록 미리보기 · 채팅 파일 관리 창이 그 칸을 씀.
    // 끄면 '바뀌지 않았으면 기억해 둔 응답 다시 쓰기'만 안 함
    const memo = wanted('chat_cache');
    status.chat_cache = memo ? 'on' : 'off';
    const fail = (why) => { if (memo) rest('chat_cache', why); else console.warn(`${TAG} 채팅 목록 미리보기 칸을 못 붙임 — ${why}`); };
    let chatsRouter, charactersRouter;
    try { chatsRouter = (await load('src/endpoints/chats.js')).router; charactersRouter = (await load('src/endpoints/characters.js')).router; } catch (e) { return fail(`본체 모듈을 못 읽음(${e.message})`); }
    const has = (router, p) => router?.stack?.some(l => l.route?.path === p && l.route.methods?.post);
    if (!has(chatsRouter, '/recent') || !has(charactersRouter, '/chats')) return fail('채팅 목록 처리기를 못 찾음');

    const charDir = (request, avatar) => path.join(request.user.directories.chats, String(avatar || '').replace('.png', ''));
    // 최근 채팅: 모든 캐릭터 채팅 폴더 + 그룹 채팅 + 그룹 정의 + 캐릭터 목록
    putFirst(chatsRouter, makeLayer('post', '/recent', cachedList('recent', (request) => {
        const d = request.user.directories;
        let out = folderStamp(d.chats, '.jsonl') + folderStamp(d.groupChats, '.jsonl') + folderStamp(d.groups, '.json');
        out += fs.readdirSync(d.characters).filter(f => f.endsWith('.png')).sort().join('|');
        for (const e of fs.readdirSync(d.chats, { withFileTypes: true })) if (e.isDirectory()) out += `\n[${e.name}]\n${folderStamp(path.join(d.chats, e.name), '.jsonl')}`;
        return out;
    }, (request, item) => (item.group
        ? path.join(request.user.directories.groupChats, item.file_name)
        : item.avatar ? path.join(charDir(request, item.avatar), item.file_name) : path.join(request.user.directories.chats, item.file_name)), false, memo)));
    // 캐릭터 채팅 목록: 그 캐릭터 폴더만
    putFirst(charactersRouter, makeLayer('post', '/chats', cachedList('chats', (request) => {
        if (!request.body?.avatar_url) throw new Error('no avatar');
        return folderStamp(charDir(request, request.body.avatar_url), '.jsonl');
    }, (request, item) => path.join(charDir(request, request.body.avatar_url), item.file_name), false, memo)));
    // 채팅 파일 관리 창(찾기): 그 캐릭터 폴더 또는 그룹 채팅 폴더. 항목의 file_name 은 확장자 없는 이름
    if (has(chatsRouter, '/search')) putFirst(chatsRouter, makeLayer('post', '/search', cachedList('search', (request) => {
        const d = request.user.directories;
        if (request.body?.group_id) return folderStamp(d.groupChats, '.jsonl') + folderStamp(d.groups, '.json');
        if (!request.body?.avatar_url) throw new Error('no avatar');
        return folderStamp(charDir(request, request.body.avatar_url), '.jsonl');
    }, (request, item) => (request.body?.group_id
        ? path.join(request.user.directories.groupChats, `${item.file_name}.jsonl`)
        : path.join(charDir(request, request.body.avatar_url), `${item.file_name}.jsonl`)), true, memo)));
}

// ───────── 앱 전체에 걸치는 것: 압축 · 브라우저로 가는 파일 ─────────
// 플러그인은 앱 자체를 건네받지 못하므로, 듣기 시작한 서버의 요청 처리기에서 찾는다(못 찾으면 플러그인 주소로 온 첫 요청에서).
function findApp() {
    for (const h of process._getActiveHandles?.() || []) {
        const fn = typeof h?.listeners === 'function' ? h.listeners('request')[0] : null;
        if (typeof fn === 'function' && fn._router?.stack) return fn;
    }
    return null;
}

// 같은 컴퓨터에서 도는 터널 · 대리 서버를 거쳐 온 요청은 주소가 127.0.0.1 로 보이지만 실제로는 먼 기기 — 그런 요청은 넘겨 준 표시(헤더)가 있거나 부른 주소가 localhost 가 아님
const FORWARDED = ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'via', 'cf-connecting-ip'];
const isSameMachine = (req) => {
    const a = req.socket?.remoteAddress || '';
    if (!(a === '::1' || a.startsWith('127.') || a.startsWith('::ffff:127.'))) return false;
    if (FORWARDED.some(h => req.headers?.[h])) return false;
    return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i.test(String(req.headers?.host || ''));
};

const patchedFiles = new Map();   // url → { stamp, text }
// 한 파일에 여러 기능의 조각을 차례로 끼움. 기능마다 따로 맞춰 봐서, 한 기능의 자리가 안 맞아도 그 기능만 쉬고 나머지는 끼움
const patchesFor = (url) => CLIENT_PATCHES.filter(x => x.url === url && status[x.feature] === 'on');
// 확장 파일은 사용자 폴더에 깔린 것이 먼저(실리태번이 보내는 순서와 같게), 없으면 모두가 같이 쓰는 자리
const THIRD_PARTY = '/scripts/extensions/third-party/';
function fileFor(url, user) {
    if (url.startsWith(THIRD_PARTY) && user?.directories?.extensions) {
        const own = path.join(user.directories.extensions, url.slice(THIRD_PARTY.length));
        if (fs.existsSync(own)) return own;
    }
    return path.join(ROOT, 'public', url);
}
function patchedText(url, user) {
    const file = fileFor(url, user);
    const st = fs.statSync(file, { throwIfNoEntry: false });
    if (!st) return null;
    const stamp = `${st.mtimeMs}:${st.size}`;
    const hit = patchedFiles.get(file);
    if (hit && hit.stamp === stamp) return hit.text;
    let text = fs.readFileSync(file, 'utf8'), changed = false;
    // 끼울 자리 글은 줄바꿈이 \n 인데, Windows 에서 받은 파일은 \r\n 이라 한 곳도 안 맞았음 → 찾기 전에 \n 으로 맞춤(브라우저에겐 같은 코드)
    if (text.includes('\r\n')) text = text.replace(/\r\n/g, '\n');
    for (const patch of patchesFor(url)) {
        let t = text, ok = true;
        for (const step of patch.steps) {
            // apply: 글자 그대로가 아니라 코드 모양으로 자리를 찾는 조각(압축돼서 판마다 이름이 바뀌는 파일용). 못 찾으면 null
            if (step.apply) { const out = step.apply(t); if (out == null) { ok = false; break; } t = out; continue; }
            if (!t.includes(step.find)) { ok = false; break; }
            t = t.replace(step.find, () => step.replace);
        }
        if (ok) { text = t; changed = true; }
        else rest(patch.feature, `${url} 에 끼울 자리가 없음(이미 고쳐져 있거나 코드가 바뀜)`);
    }
    text = changed ? text : null;
    patchedFiles.set(file, { stamp, text });
    return text;
}

function setupApp(app) {
    const stack = app._router.stack;
    const insertBefore = (name, layer) => {
        const i = stack.findIndex(l => l.handle?.name === name);
        if (i < 0) return false;
        stack.splice(i, 0, layer);
        undo.push(() => { const j = stack.indexOf(layer); if (j >= 0) stack.splice(j, 1); });
        return true;
    };

    // 같은 컴퓨터에서는 압축 없이: 압축에 드는 시간이 보내는 시간보다 김. 다른 기기에서 온 요청은 그대로 압축
    status.no_local_compression = wanted('no_local_compression') ? 'on' : 'off';
    if (wanted('no_local_compression')) {
        const layer = stack.find(l => l.handle?.name === 'compression');
        if (!layer) rest('no_local_compression', '압축 단계를 못 찾음');
        else {
            const original = layer.handle;
            layer.handle = function compression(req, res, next) { return isSameMachine(req) ? next() : original(req, res, next); };
            undo.push(() => { layer.handle = original; });
        }
    }

    // 브라우저로 가는 본체 파일에 조각 끼우기 · 탭 아이콘 · 로딩 화면 CSS 읽기 줄
    status.regex_hook = wanted('regex_hook') ? 'on' : 'off';
    const iconDir = path.join(HERE, 'icons');
    const icons = wanted('tab_icon') && fs.existsSync(iconDir) ? new Set(fs.readdirSync(iconDir)) : new Set();
    // 탭 아이콘: 사용자가 설정 창에서 고른 그림(user/files/breeze-tab-<원래 파일 이름>)이 먼저, 없으면 icons 폴더, 둘 다 없으면 원래 아이콘
    status.tab_icon = wanted('tab_icon') ? 'on' : 'off';
    const TAB_ICON = /^(favicon\.ico|apple-icon-\d+x\d+\.png)$/;
    status.loading_screen = wanted('loading_screen') ? 'on' : 'off';
    status.light_chat_open = wanted('light_chat_open') ? 'on' : 'off';
    status.early_message_frames = wanted('early_message_frames') ? 'on' : 'off';
    status.settings_once = wanted('settings_once') ? 'on' : 'off';
    status.near_message_frames = wanted('near_message_frames') ? 'on' : 'off';
    const patches = CLIENT_PATCHES.filter(p => status[p.feature] === 'on');
    for (const url of new Set(patches.map(p => p.url))) patchedText(url);   // 켤 때 한 번 맞춰 보고 안 맞으면 알림

    const serve = (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const p = req.path;
        if (status.tab_icon === 'on' && (p === '/favicon.ico' || p.startsWith('/img/')) && TAB_ICON.test(path.basename(p))) {
            const name = path.basename(p);
            const own = req.user?.directories?.files && path.join(req.user.directories.files, `breeze-tab-${name}`);
            if (own && fs.existsSync(own)) { res.set('Cache-Control', 'no-cache'); return res.sendFile(own); }
            if (icons.has(name)) return res.sendFile(path.join(iconDir, name));
        }
        if (p === '/css/user.css' && status.loading_screen === 'on') {
            const splash = req.user?.directories?.files && path.join(req.user.directories.files, 'breeze-splash.css');
            if (splash && fs.existsSync(splash) && breezeInstalled(req.user)) {
                const userCss = path.join(globalThis.DATA_ROOT || path.join(ROOT, 'data'), '_css', 'user.css');
                const own = fs.existsSync(userCss) ? fs.readFileSync(userCss, 'utf8') : '';
                const line = '@import url("/user/files/breeze-splash.css");';
                res.set('Cache-Control', 'no-cache');
                if (own.includes('breeze-splash.css')) return res.type('text/css').send(own);
                // @import 는 맨 앞 줄들에만 쓸 수 있고 뒤에 읽힌 것이 이기므로, 이미 있는 @import 줄들 바로 뒤에 넣음
                const lines = own.split('\n');
                let at = 0;
                while (at < lines.length && /^\s*(@import|@charset|$)/.test(lines[at])) at++;
                lines.splice(at, 0, line);
                return res.type('text/css').send(lines.join('\n'));
            }
            return next();
        }
        if (!patches.some(x => x.url === p && status[x.feature] === 'on')) return next();
        let text = null;
        try { text = patchedText(p, req.user); } catch { /* 원본으로 */ }
        if (text === null) return next();
        res.set('Cache-Control', 'no-cache');
        res.type('application/javascript').send(text);
    };
    // 로딩 화면 CSS 는 사용자 CSS 단계보다, 나머지는 정적 파일 단계보다 앞에 있어야 함(사용자 CSS 단계가 더 앞이라 한 겹으로 충분)
    const layer = makeLayer(null, null, serve);
    if (!insertBefore('userCssMiddleware', layer) && !insertBefore('serveStatic', layer)) {
        for (const f of ['regex_hook', 'tab_icon', 'loading_screen', 'light_chat_open', 'early_message_frames', 'near_message_frames', 'settings_once']) if (status[f] === 'on') rest(f, '정적 파일 단계를 못 찾음');
        if (status.lazy_load === 'on') rest('lazy_load', '정적 파일 단계를 못 찾음');
    }
}

export async function init(router) {
    scratch = router;
    if (readConfig().autoUpdate === true) { try { applyUpdate(); } catch (e) { console.warn(`${TAG} 플러그인 자동 업데이트 실패 — ${e.message}`); } }
    for (const f of FEATURES) status[f] = 'off';
    try { await setupSettings(); } catch (e) { console.warn(`${TAG} 설정 묶음 준비 실패 — ${e.message}`); }
    try { await setupChats(); } catch (e) { console.warn(`${TAG} 채팅 목록 준비 실패 — ${e.message}`); }

    let appDone = false;
    const withApp = (app) => {
        if (appDone || !app?._router?.stack) return;
        appDone = true;
        try { setupApp(app); } catch (e) { console.warn(`${TAG} 앱 단계 준비 실패 — ${e.message}`); }
        const on = FEATURES.filter(f => status[f] === 'on');
        console.log(`${TAG} 켜진 기능: ${on.join(', ') || '없음'}`);
    };
    // 서버가 듣기 시작한 뒤에야 찾을 수 있어 잠깐씩 다시 봄(최대 1분)
    let tries = 0;
    const timer = setInterval(() => { withApp(findApp()); if (appDone || ++tries > 120) clearInterval(timer); }, 500);
    timer.unref?.();
    undo.push(() => clearInterval(timer));

    // 모든 프리셋의 정규식만(breeze의 프리셋 모양 유지 · 미리보기가 씀) — 프리셋 전체를 하나씩 받지 않게. 폴더가 그대로면 지난번 것
    router.post('/preset-regex', (request, response) => {
        try {
            const dir = request.user.directories.openAI_Settings;
            const json = part(`${request.user.profile?.handle ?? ''}|preset-regex`, folderStamp(dir), () => {
                const { contents, names } = readPresets(dir);
                const out = {};
                names.forEach((n, i) => { try { const r = JSON.parse(contents[i])?.extensions?.regex_scripts; out[n] = Array.isArray(r) ? r : []; } catch { out[n] = []; } });
                return JSON.stringify(out);
            });
            response.type('application/json').send(json);
        } catch (e) { response.status(500).send({ error: e.message }); }
    });

    // 채팅 파일 관리 창의 펼쳐 보기: 채팅을 통째로 보내지 않고 처음 두 마디 · 끝 두 마디만(큰 채팅은 수십 MB 라 통째로 받아 읽으면 화면이 멈췄음).
    // 앞은 파일 처음부터 줄 셋(머리 줄 + 두 마디)까지만, 끝은 파일 끝 조각만 읽음. 작은 파일은 통째로(all)
    router.post('/chat-peek', (request, response) => {
        try {
            const d = request.user.directories;
            const name = path.basename(String(request.body?.file || ''));
            if (!name || name.includes('..')) return response.sendStatus(400);
            const file = request.body?.group
                ? path.join(d.groupChats, `${name}.jsonl`)
                : path.join(d.chats, path.basename(String(request.body?.avatar_url || '')).replace(/\.png$/i, ''), `${name}.jsonl`);
            if (!file.startsWith(d.chats) && !file.startsWith(d.groupChats)) return response.sendStatus(400);
            const st = fs.statSync(file, { throwIfNoEntry: false });
            if (!st) return response.sendStatus(404);
            const parse = (lines) => lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(x => x && typeof x === 'object');
            // 마지막 글 하나만(채팅 목록 미리보기가 비었을 때): 스와이프 기록까지 보내면 한 번에 MB 단위라 보일 글만
            if (request.body?.lastOnly) {
                const m = lastMessage(file);
                if (!m || typeof m.mes !== 'string') return response.send({ last: null });
                const shown = typeof m.extra?.display_text === 'string' && m.extra.display_text ? m.extra.display_text : m.mes;
                return response.send({ last: { text: shown, is_user: !!m.is_user, preset: typeof m.extra?.regex_preset === 'string' ? m.extra.regex_preset : '' } });
            }
            if (st.size <= 512 * 1024) return response.send({ all: parse(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) });
            const fd = fs.openSync(file, 'r');
            try {
                const read = (pos, len) => { const buf = Buffer.alloc(len); const n = fs.readSync(fd, buf, 0, len, pos); return buf.subarray(0, n).toString('utf8'); };
                let headText = '', want = 64 * 1024;
                while (true) { headText = read(0, Math.min(want, st.size)); if (headText.split('\n').length > 3 || want >= st.size) break; want *= 4; }
                let tailText = '', back = 64 * 1024;
                while (true) { const len = Math.min(back, st.size); tailText = read(st.size - len, len); if (tailText.trimEnd().split('\n').length > 2 || len === st.size) break; back *= 4; }
                const head = parse(headText.split('\n').slice(0, 3));
                const tail = parse(tailText.trimEnd().split('\n').slice(-2));
                response.send({ head, tail });
            } finally { fs.closeSync(fd); }
        } catch (e) { response.status(500).send({ error: e.message }); }
    });

    // breeze이 상태를 물어보는 주소. 여기까지 온 첫 요청으로도 앱을 찾음
    // wanted = config.json 에 적힌 켜짐(다음에 서버를 켤 때 쓸 값). 지금 상태(features)와 다르면 서버를 다시 켜야 바뀜
    const wantedAll = () => Object.fromEntries(FEATURES.map(f => [f, wanted(f)]));
    router.get('/status', (req, res) => { withApp(req.app); res.send({ version: 2, ...updateInfo(), features: status, wanted: wantedAll() }); });
    // 월드인포 폴더 화면: 월드인포마다 항목 수 · 켜진 수 · 상시 수 · 수정 시각(화면 쪽이 토큰 수를 다시 셀지 정함).
    // 화면 쪽에서 월드인포를 하나씩 다 받아 세면 월드인포가 많을 때 열 때마다 수십 번 요청 → 서버가 파일을 읽어 한 번에(파일이 그대로면 지난번 값)
    const wiMemo = new Map();
    router.get('/worldinfo-summary', (request, response) => {
        try {
            const dir = request.user.directories.worlds;
            const out = {};
            for (const f of fs.readdirSync(dir)) {
                if (path.extname(f).toLowerCase() !== '.json') continue;
                const file = path.join(dir, f);
                const st = fs.statSync(file, { throwIfNoEntry: false });
                if (!st) continue;
                const key = `${file}|${st.mtimeMs}|${st.size}`;
                let row = wiMemo.get(file);
                if (!row || row.key !== key) {
                    let entries = 0, enabled = 0, constant = 0;
                    try {
                        const list = Object.values(JSON.parse(fs.readFileSync(file, 'utf8'))?.entries || {});
                        entries = list.length;
                        for (const e of list) { if (!e?.disable) enabled++; if (e?.constant) constant++; }
                    } catch { /* 깨진 파일 */ }
                    row = { key, data: { entries, enabled, constant, mtime: st.mtimeMs } };
                    wiMemo.set(file, row);
                }
                out[path.basename(f, path.extname(f))] = row.data;
            }
            response.send(out);
        } catch (e) { response.status(500).send({ error: e.message }); }
    });

    // 설정 창: 지금 업데이트 · 자동 업데이트 켜고 끄기
    router.post('/update', (req, res) => {
        try {
            if (typeof req.body?.auto === 'boolean') { const json = readConfig(); json.autoUpdate = req.body.auto; writeConfig(json); }
            if (req.body?.apply === true) applyUpdate();
            res.send(updateInfo());
        } catch (e) { res.status(500).send({ error: e.message }); }
    });
    // 기능 켜고 끄기: config.json 에 적어 둠. 기능은 서버가 켜질 때 한 번 끼우므로 서버를 다시 켜야 바뀜
    router.post('/features', (req, res) => {
        try {
            const { name, on } = req.body || {};
            if (!FEATURES.includes(name) || typeof on !== 'boolean') return res.status(400).send({ error: 'bad request' });
            const file = path.join(HERE, 'config.json');
            let json = {};
            try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 새로 만듦 */ }
            json.features = { ...(json.features || {}), [name]: on };
            fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
            res.send({ version: 2, features: status, wanted: wantedAll() });
        } catch (e) { res.status(500).send({ error: e.message }); }
    });
}

export async function exit() {
    for (const fn of undo.reverse()) { try { fn(); } catch { /* 끄는 중 */ } }
}
