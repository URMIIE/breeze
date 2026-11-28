// breeze 서버 플러그인 설치(맥 · 리눅스 · 안드로이드 · 윈도우). curl · sh · PowerShell 스크립트 없이 node 만 있으면 됨.
//   node -e "<설치 화면의 한 줄>" <이 파일이 있는 주소> [실리태번 포트]
// 플러그인 파일은 디스크에서 찾지 않고 그 주소에서 받음(자료 폴더가 실리태번 밖에 있어도 됨).
// 실리태번 폴더: 지금 폴더 → 돌고 있는 server.js 의 작업 폴더. 설정 파일: 그 프로세스의 --configPath, 없으면 <실리태번>/config.yaml.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const fail = (msg) => { console.log(msg); process.exit(1); };
const isStFolder = (d) => !!d && fs.existsSync(path.join(d, 'server.js')) && fs.existsSync(path.join(d, 'package.json'));
const args = process.argv.slice(1);
const base = args.find(a => /^https?:\/\//.test(a));
const port = Number(args.find(a => /^\d+$/.test(a))) || 8000;
if (!base) fail('설치 화면의 명령을 그대로 붙여 넣어 주세요.');

// 윈도우: 다른 프로세스의 작업 폴더는 읽을 수 없어서, 명령 줄의 server.js 경로 → 그 프로세스를 띄운 .bat · .cmd 경로 →
//   명령 줄 앞의 cd 경로 순으로 실리태번 폴더를 짐작함. { args, cwd }
function windowsProcesses() {
    const ps = `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress`;
    let list = [];
    try { list = [].concat(JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', maxBuffer: 64 << 20 }))); } catch { return []; }
    const byId = new Map(list.map(p => [p.ProcessId, p]));
    const split = (line) => (String(line || '').match(/"[^"]*"|\S+/g) || []).map(x => x.replace(/^"|"$/g, ''));
    const out = [];
    for (const p of list) {
        if (!/^node(\.exe)?$/i.test(p.Name || '') || !/server\.js/i.test(p.CommandLine || '')) continue;
        const a = split(p.CommandLine);
        const js = a.find(x => /(^|[\\/])server\.js$/i.test(x));
        let cwd = js && path.isAbsolute(js) ? path.dirname(js) : null;
        for (let q = byId.get(p.ParentProcessId), n = 0; !cwd && q && n < 3; q = byId.get(q.ParentProcessId), n++) {
            const line = String(q.CommandLine || '');
            const bat = line.match(/"?([a-z]:[^"]*?)[\\/][^\\/"]+\.(bat|cmd)"?/i);
            const cd = line.match(/cd\s+(?:\/d\s+)?"?([a-z]:[^"&]+?)"?\s*(&|$)/i);
            cwd = bat ? bat[1] : cd ? cd[1].trim() : null;
        }
        out.push({ args: a, cwd });
    }
    return out;
}
// 윈도우에서 위로도 못 찾을 때: 흔히 두는 곳(사용자 폴더 · 바탕 화면 · 문서 · 다운로드 · 드라이브 맨 위)을 몇 단계만 훑어
//   package.json 이름이 sillytavern 인 폴더를 찾음. 여럿이면 config.yaml 의 포트가 이 포트인 것
function searchWindows() {
    const home = os.homedir();
    const roots = [home, ...['Desktop', 'Documents', 'Downloads', 'OneDrive'].map(n => path.join(home, n)),
        ...'CDEFGH'.split('').map(l => `${l}:\\`)].filter(d => fs.existsSync(d));
    const found = [];
    const isSt = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).name === 'sillytavern' && fs.existsSync(path.join(d, 'server.js')); } catch { return false; } };
    const walk = (d, depth) => {
        if (found.length > 20 || depth > 3) return;
        if (isSt(d)) { found.push(d); return; }
        let entries = [];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (!e.isDirectory() || /^(\$|\.|node_modules$|Windows$|Program Files|ProgramData$|AppData$)/i.test(e.name)) continue;
            walk(path.join(d, e.name), depth + 1);
        }
    };
    for (const r of roots) walk(r, 0);
    const portOf = (d) => { try { return Number(fs.readFileSync(path.join(d, 'config.yaml'), 'utf8').match(/^port:\s*(\d+)/m)?.[1]) || 8000; } catch { return 8000; } };
    return found.find(d => portOf(d) === port) || found[0] || null;
}

// server.js 를 돌리는 프로세스: { args, cwd }
function serverProcesses() {
    if (process.platform === 'win32') return windowsProcesses();
    const out = [];
    let pids = null;
    try { pids = fs.readdirSync('/proc').filter(n => /^\d+$/.test(n)); } catch { /* 맥: /proc 없음 */ }
    if (pids) {
        for (const p of pids) {
            try {
                const a = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0').filter(Boolean);
                if (a.some(x => /(^|\/)server\.js$/.test(x))) out.push({ args: a, cwd: fs.readlinkSync(`/proc/${p}/cwd`) });
            } catch { /* 남의 프로세스 · 이미 끝남 */ }
        }
        return out;
    }
    try {
        const pids2 = execFileSync('pgrep', ['-f', 'server\\.js'], { encoding: 'utf8' }).split(/\s+/).filter(Boolean);
        for (const p of pids2) {
            try {
                const line = execFileSync('ps', ['-o', 'args=', '-p', p], { encoding: 'utf8' }).trim();
                const cwd = execFileSync('lsof', ['-a', '-d', 'cwd', '-p', p, '-Fn'], { encoding: 'utf8' }).split('\n').find(l => l.startsWith('n'))?.slice(1);
                out.push({ args: line.split(/\s+/), cwd });
            } catch { /* 이미 끝남 */ }
        }
    } catch { /* pgrep 없음 */ }
    return out;
}
const argValue = (a, name) => {
    const i = a.findIndex(x => x === name || x.startsWith(`${name}=`));
    if (i < 0) return null;
    return a[i].includes('=') ? a[i].slice(name.length + 1) : a[i + 1];
};

const procs = serverProcesses();
const cwd = process.cwd();
// 같은 컴퓨터에 서버가 여럿이면 이 포트로 뜬 것 → 지금 폴더에서 뜬 것 → 아무거나 순
const proc = procs.find(p => Number(argValue(p.args, '--port')) === port)
    || procs.find(p => p.cwd === cwd)
    || procs[0];
const dir = isStFolder(cwd) ? cwd : isStFolder(proc?.cwd) ? proc.cwd : process.platform === 'win32' ? searchWindows() : null;
if (!dir) fail('실리태번 폴더를 못 찾았어요. 실리태번 폴더로 이동한 뒤 다시 붙여 넣어 주세요.');
const configArg = proc ? argValue(proc.args, '--configPath') : null;
const yaml = configArg ? path.resolve(proc.cwd || dir, configArg) : path.join(dir, 'config.yaml');

// 설정 파일을 못 열면 플러그인 파일도 쓰지 않음(반쯤 깔린 채로 남지 않게)
let text = '';
try { text = fs.readFileSync(yaml, 'utf8'); } catch { fail(`설정 파일을 못 열었어요: ${yaml}`); }
const FILES = ['index.mjs', 'client-patches.mjs', 'package.json'];
const got = {};
for (const f of FILES) {
    let res;
    try { res = await fetch(new URL(`breeze-server/${f}`, base)); } catch (e) { fail(`실리태번 주소에서 설치 파일을 못 받았어요(로그인 · 주소 확인): ${e.message}`); }
    if (!res.ok) fail(`실리태번 주소에서 설치 파일을 못 받았어요(로그인 · 주소 확인): ${res.status}`);
    got[f] = await res.text();
}
const target = path.join(dir, 'plugins', 'breeze-server');
fs.mkdirSync(target, { recursive: true });
for (const f of FILES) fs.writeFileSync(path.join(target, f), got[f]);

const ON = /^enableServerPlugins:\s*true\s*$/m;
if (!ON.test(text)) {
    fs.writeFileSync(`${yaml}.bak`, text);
    const next = /^enableServerPlugins:.*$/m.test(text)
        ? text.replace(/^enableServerPlugins:.*$/m, 'enableServerPlugins: true')
        : `${text.replace(/\n?$/, '\n')}enableServerPlugins: true\n`;
    fs.writeFileSync(yaml, next);
    if (!ON.test(fs.readFileSync(yaml, 'utf8'))) fail(`설정 파일에서 서버 플러그인을 켜지 못했어요: ${yaml}`);
}
console.log(`breeze 서버 플러그인 설치 완료: ${dir}`);
console.log('실리태번 서버를 끄고 다시 실행하세요.');
