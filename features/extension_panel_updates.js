// 확장 창 정리의 새 버전 표시 · 업데이트.
// 새 버전 확인은 서버가 확장마다 저장소에 한 번씩 물어서 느림 → 확인 결과를 브라우저에 적어 두고 창을 열 땐 적어 둔 것으로 바로 표시.
//   · 실리태번이 스스로 물은 답(하루 한 번 알림 · '확장 프로그램 관리' 창)은 지나갈 때 받아 적음(따로 묻지 않음)
//   · 실리태번이 안 물은 확장만 하루 한 번, 확장 창을 연 뒤에 뒤에서 물음
const KEY = 'breeze.extUpdates', FRESH = 20 * 3600 * 1000;
let active = false, wrapped = null, baseFetch = null, notify = null, exts = null, extsAsk = null, checking = false, checkTimer = 0;
let items = {};   // 폴더 이름 → { up: 최신인지, at: 확인한 때 }
const updating = new Set();
const bare = (n) => String(n || '').replace(/^\/+/, '').replace(/^third-party\//, '');
const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function read() { try { items = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { items = {}; } }
function write() { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* 저장소 막힘 */ } }
function note(name, up) {
    name = bare(name);
    if (!name) return;
    const was = items[name]?.up;
    items[name] = { up: !!up, at: Date.now() };
    write();
    if (was !== !!up) notify?.();
}

// 실리태번이 보내는 새 버전 확인 · 업데이트 요청의 답을 받아 적음(요청은 그대로 지나감)
function hook() {
    if (wrapped) return;
    baseFetch = window.fetch;
    wrapped = function (input, init) {
        const p = baseFetch.apply(this, arguments);
        try {
            const url = typeof input === 'string' ? input : input?.url || '';
            const kind = !active ? '' : url.endsWith('/api/extensions/version') ? 'version' : url.endsWith('/api/extensions/update') ? 'update' : '';
            if (kind && typeof init?.body === 'string') {
                const name = JSON.parse(init.body).extensionName;
                p.then(res => (res.ok ? res.clone().json() : null)).then(d => { if (!d) return; if (kind === 'update') note(name, true); else if (typeof d.isUpToDate === 'boolean') note(name, d.isUpToDate); }).catch(() => {});
            }
        } catch { /* 우리 일로 요청을 막지 않음 */ }
        return p;
    };
    window.fetch = wrapped;
}

// 깔린 확장(남이 만든 것) 목록: 폴더 이름 · 화면 이름 · 모두가 쓰는 자리에 깔렸는지
async function loadExts() {
    if (exts) return exts;
    return (extsAsk ??= (async () => {
        const { extensionNames, extensionTypes } = await import('/scripts/extensions.js');
        const off = new Set(SillyTavern.getContext().extensionSettings.disabledExtensions || []);
        const list = await Promise.all(extensionNames.filter(n => n.startsWith('third-party/') && !off.has(n)).map(async (n) => {
            let display = '';
            try { display = (await (await baseFetch(`/scripts/extensions/${n}/manifest.json`)).json()).display_name || ''; } catch { /* 이름 없이 */ }
            return { name: bare(n), display, global: extensionTypes[n] === 'global' };
        }));
        exts = list; extsAsk = null;
        return list;
    })());
}

// 목록 줄 ↔ 확장 폴더 짝짓기(실리태번이 알려 주지 않아 이름으로): 같은 이름 → 한쪽이 다른 쪽을 품음 → 칸 id 에 폴더 이름 → 앞 네 글자가 같음.
// 후보가 둘이면 짝짓지 않음(엉뚱한 확장을 업데이트하지 않게)
const pairs = new Map();   // 줄 key → 폴더 이름 | ''
export async function pair(units) {
    const list = await loadExts();
    const taken = new Set(), left = [];
    for (const u of units) { const had = pairs.get(u.key); if (had) taken.add(had); else left.push(u); }
    const only = (c) => (c.length === 1 ? c[0] : null);
    const free = () => list.filter(e => !taken.has(e.name));
    const short = (n) => norm(n.replace(/^(sillytavern|extension|st)[-_.]/i, ''));
    const steps = [
        (u, t) => only(free().filter(e => norm(e.display) === t || norm(e.name) === t)),
        (u, t) => { if (t.length < 2) return null; const c = free().map(e => { const d = norm(e.display); return { e, n: d && (d.includes(t) || t.includes(d)) ? Math.min(d.length, t.length) : 0 }; }).filter(x => x.n >= 2).sort((a, b) => b.n - a.n); return c.length && (c.length === 1 || c[0].n > c[1].n) ? c[0].e : null; },
        (u) => { const ids = norm(`${u.holder.id} ${u.drawer.id}`); return ids ? only(free().filter(e => short(e.name).length >= 5 && ids.includes(short(e.name)))) : null; },
        (u, t) => (t.length < 4 ? null : only(free().filter(e => norm(e.display).startsWith(t.slice(0, 4))))),
    ];
    for (const step of steps) for (const u of left) {
        if (pairs.get(u.key)) continue;
        const e = step(u, norm(u.title));
        if (e) { pairs.set(u.key, e.name); taken.add(e.name); }
    }
    for (const u of left) if (!pairs.has(u.key)) pairs.set(u.key, '');
}
export const extOf = (u) => pairs.get(u.key) || '';
export const outdated = (u) => { const n = extOf(u); return !!n && items[n]?.up === false; };
export const isUpdating = (u) => updating.has(extOf(u));
export const isChecking = () => checking;
// 새 버전이 있는 확장 전부(목록에 줄이 없는 확장까지): 폴더 이름 · 화면 이름
export function pending() { return (exts || []).filter(e => items[e.name]?.up === false).map(e => ({ name: e.name, display: e.display || e.name, listed: [...pairs.values()].includes(e.name) })); }

const headers = () => SillyTavern.getContext().getRequestHeaders();
// 새 버전 확인: force 가 아니면 최근에 확인한 확장은 건너뜀. 한 번에 셋씩
export async function check(force = false) {
    if (checking || !active) return;
    checking = true; notify?.();
    try {
        const now = Date.now(), list = (await loadExts()).filter(e => force || !items[e.name] || now - items[e.name].at > FRESH);
        let i = 0;
        const worker = async () => {
            while (active && i < list.length) {
                const e = list[i++];
                try {
                    const res = await baseFetch('/api/extensions/version', { method: 'POST', headers: headers(), body: JSON.stringify({ extensionName: e.name, global: e.global }) });
                    if (res.ok) { const d = await res.json(); if (typeof d.isUpToDate === 'boolean') note(e.name, d.isUpToDate); }
                } catch { /* 이 확장은 다음에 */ }
            }
        };
        await Promise.all([worker(), worker(), worker()]);
    } finally { checking = false; notify?.(); }
}
// 확장 창을 연 뒤 조금 있다가(창 여는 일과 겹치지 않게) 하루 치 확인
export function checkSoon() { clearTimeout(checkTimer); checkTimer = setTimeout(() => check(false), 2500); }

async function updateOne(name) {
    const e = (exts || []).find(x => x.name === name);
    if (!e || updating.has(name)) return false;
    updating.add(name); notify?.();
    try {
        const res = await baseFetch('/api/extensions/update', { method: 'POST', headers: headers(), body: JSON.stringify({ extensionName: e.name, global: e.global }) });
        if (!res.ok) { toastr.error((await res.text()) || res.statusText, `${e.display || e.name} 업데이트 실패`); return false; }
        note(name, true);
        return true;
    } catch (err) { toastr.error(String(err?.message || err), `${e.display || e.name} 업데이트 실패`); return false; } finally { updating.delete(name); notify?.(); }
}
export async function update(names) {
    let done = 0;
    for (const n of names) if (await updateOne(n)) done++;
    if (done) toastr.success('새로고침하면 적용돼요.', `확장 ${done}개 업데이트함`);
}

export function start(onChange) {
    active = true; notify = onChange;
    read(); hook();
}
export function stop() {
    active = false; notify = null; clearTimeout(checkTimer);
    if (wrapped && window.fetch === wrapped) { window.fetch = baseFetch; wrapped = null; }   // 다른 도구가 그 위에 덧씌웠으면 그대로 두고 쉼(active 로)
    pairs.clear(); exts = null; extsAsk = null;
}
