// 테마마다 전용 스크립트 자동으로 켜기.
// 테마 제작자가 따로 주는 JS · CSS 는 대개 아무 테마에서나 화면에 칸을 붙여서, 그대로 두면 다른 테마로 바꿔도 빈 칸 · 깨진 모양이 남는다.
// 규칙마다 ‘언제’(테마 이름 · 테마가 정한 CSS 변수 · 테마 CSS 안 글자)를 정해 두면 그 테마일 때만 켜고, 벗어나면 끄고 뒷정리한다.
// 뒷정리: 규칙의 CSS 는 떼고, JS 가 etk.onCleanup(fn) 으로 맡긴 함수 · ‘끌 때 부를 함수 이름’(스크립트가 창에 내놓는 정리 함수)을 부른다.
// 둘 다 없는 스크립트가 붙인 것은 새로고침해야 사라진다.
// 태번 헬퍼(酒馆助手)가 있으면 규칙에 그 전역 스크립트를 골라 둘 수 있다: 조건이 맞으면 그 스크립트를 켜고, 벗어나면 끈다(실행 · 뒷정리는 태번 헬퍼가).
// 어느 규칙에도 골라 두지 않은 태번 헬퍼 스크립트는 건드리지 않는다. 스크립트를 다시 가져와 id 가 바뀌면 이름으로 다시 찾는다.
// ‘값이 바뀌면 다시 켤 CSS 변수’를 적어 두면, 같은 조건 안에서 그 변수 값이 달라질 때(같은 계열 테마끼리 배치가 다른 경우) 껐다 다시 켠다.
import { onThemeCss, appliedTheme } from '../lib/theme-css.js';
import { pickFile } from '../lib/files.js';
import { addMaximize } from '../lib/textarea-max.js';

const WHEN = { theme: '이 테마에서만', series: '이름에 이 글자가 든 테마 전부', cssvar: '테마가 이 CSS 변수를 쓸 때', csstext: '테마 CSS 에 이 글자가 있을 때' };
let api = null, off = null, running = new Map();   // 규칙 id → { style, cleanups }

const rules = () => (api.options().rules ??= []);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name.startsWith('--') ? name : `--${name}`).trim();
const html = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// getComputedStyle 결과는 늘 지금 값을 비추는 객체라 한 번 만들어 두고 다시 씀(규칙마다 새로 만들지 않게)
let rootStyle = null;
function matches(rule, css) {
    const v = String(rule.value || '').trim();
    if (!v) return false;
    if (rule.when === 'theme') return appliedTheme().normalize('NFC') === v.normalize('NFC');
    if (rule.when === 'series') return appliedTheme().normalize('NFC').includes(v.normalize('NFC'));
    if (rule.when === 'cssvar') return (rootStyle ??= getComputedStyle(document.documentElement)).getPropertyValue(v.startsWith('--') ? v : `--${v}`).trim() !== '';
    return css.includes(v);
}

// ── 태번 헬퍼 전역 스크립트
const helper = () => { const th = window.TavernHelper; return th && typeof th.getScriptTrees === 'function' && typeof th.updateScriptTreesWith === 'function' ? th : null; };
function thList() {
    const th = helper(); if (!th) return [];
    let trees = []; try { trees = th.getScriptTrees({ type: 'global' }) || []; } catch { return []; }
    const out = [];
    for (const t of trees) {
        if (t.type === 'folder') for (const x of t.scripts || []) out.push({ id: x.id, name: x.name, enabled: !!x.enabled, folder: t.name });
        else out.push({ id: t.id, name: t.name, enabled: !!t.enabled, folder: '' });
    }
    return out;
}
// 규칙에 적어 둔 스크립트(id · 이름)를 지금 목록에서 찾음 — id 가 바뀌었으면 이름으로 찾고 id 를 고쳐 둠
function resolve(ref, list) {
    let hit = list.find(x => x.id === ref.id);
    if (!hit) { hit = list.find(x => x.name === ref.name); if (hit) { ref.id = hit.id; api?.save(); } }
    return hit || null;
}
// 켤 것 · 끌 것 맞추기: 실행 중인 규칙이 고른 스크립트는 켜고, 다른 규칙에만 걸린 스크립트는 끔. restart 의 id 는 껐다가 다시 켬(같은 조건 안에서 배치가 바뀐 경우)
// 다른 쪽이 같은 스크립트를 켜고 끄는지: 우리가 맞춘 1.5초 뒤 다시 보고, 되돌려져 있으면 한 번 더 맞춤 → 또 되돌려지면 물러남(서로 번갈아 켜고 끄지 않게)
let syncGen = 0, flips = 0, fought = false;
async function thSync(restart = new Set()) {
    const th = helper(); if (!th || fought) return;
    const list = thList();
    const linked = new Map(), want = new Set();
    for (const r of rules()) for (const ref of r.th || []) {
        const hit = resolve(ref, list); if (!hit) continue;
        linked.set(hit.id, hit);
        if (running.has(r.id)) want.add(hit.id);
    }
    const flip = (on) => (x) => x.type === 'folder' ? { ...x, scripts: (x.scripts || []).map(flip(on)) } : (linked.has(x.id) ? { ...x, enabled: on(x) } : x);
    const off = [...restart].filter(id => linked.has(id) && linked.get(id).enabled);
    try {
        if (off.length) await th.updateScriptTreesWith(t => t.map(flip(x => (off.includes(x.id) ? false : x.enabled))), { type: 'global' });
        const differs = [...linked.values()].some(x => (off.includes(x.id) ? false : x.enabled) !== want.has(x.id));
        if (differs || off.length) await th.updateScriptTreesWith(t => t.map(flip(x => want.has(x.id))), { type: 'global' });
        if (differs || off.length) {
            const gen = ++syncGen;
            setTimeout(() => {
                if (gen !== syncGen || fought) return;
                const now = thList();
                const back = [...linked.keys()].map(id => now.find(x => x.id === id)).filter(x => x && x.enabled !== want.has(x.id));
                if (!back.length) { flips = 0; return; }
                if (++flips >= 2) {
                    fought = true;
                    api?.rest('clash', { saw: `breeze가 켜고 끈 태번 헬퍼 스크립트(${back.map(x => x.name).join(', ')})를 다른 쪽이 곧바로 되돌렸어요`, who: { kind: 'unknown' }, back: '그쪽을 끄고 새로고침하면 다시 해요.' });
                    return;
                }
                thSync();
            }, 1500);
        }
    } catch (e) { console.warn('[Breeze] 태번 헬퍼 스크립트 켜고 끄기', e); }
}

// 추가 창에서 고른 JS · CSS 는 태번 헬퍼 전역 스크립트로 만들어 이 규칙에 잇는다(켜고 끄기 · 실행은 태번 헬퍼가).
// 만든 스크립트는 실리태번 창에서 원래 스크립트를 실행하고 CSS 를 붙이며, 꺼질 때(칸이 닫힐 때) CSS 를 떼고 뒷정리를 부른다.
// 원래 코드는 스크립트 안에 JSON 으로 넣어 두어, 고치기 창에서 다시 꺼내 볼 수 있다.
const TH_MARK = '/* breeze theme script */';
function wrapperCode(rule) {
    // 글 안의 </script> 가 스크립트를 담는 칸의 태그를 닫아 버리지 않게 </ 를 <\\/ 로
    const j = (v) => JSON.stringify(String(v || '')).replace(/<\//g, '<\\/');
    return `${TH_MARK}
/* ${String(rule.name).replace(/\*\//g, '* /')}: breeze ‘테마별 스크립트’가 조건이 맞을 때만 켜고 끔 */
const NAME = ${j(rule.name)};
const CSS = ${j(rule.css)};
const JS = ${j(rule.js)};
const CLEANUP = ${j(rule.cleanupName)};
(() => {
  const P = window.parent;
  let style = null;
  const cleanups = [];
  if (CSS.trim()) { style = P.document.createElement('style'); style.dataset.breezeThemeScript = NAME; style.textContent = CSS; P.document.head.append(style); }
  if (JS.trim()) {
    const etk = { onCleanup: (fn) => { if (typeof fn === 'function') cleanups.push(fn); }, rule: NAME };
    try { new P.Function('etk', JS)(etk); } catch (e) { console.error('[테마 스크립트] ' + NAME, e); }
  }
  window.addEventListener('pagehide', () => {
    style?.remove();
    for (const fn of cleanups.reverse()) { try { fn(); } catch (e) { console.warn(e); } }
    if (CLEANUP.trim() && typeof P[CLEANUP.trim()] === 'function') { try { P[CLEANUP.trim()](); } catch (e) { console.warn(e); } }
  });
})();
`;
}
// 만든 스크립트에서 원래 JS · CSS · 뒷정리 이름을 꺼냄(고치기 창에 채우려고)
function unwrap(content) {
    if (!String(content).startsWith(TH_MARK)) return null;
    const get = (k) => { const m = String(content).match(new RegExp(`^const ${k} = (".*");$`, 'm')); try { return m ? JSON.parse(m[1]) : ''; } catch { return ''; } };
    return { css: get('CSS'), js: get('JS'), cleanupName: get('CLEANUP') };
}
function thScript(id) {
    const th = helper(); if (!th) return null;
    let trees = []; try { trees = th.getScriptTrees({ type: 'global' }) || []; } catch { return null; }
    for (const t of trees) {
        if (t.type === 'folder') { const x = (t.scripts || []).find(y => y.id === id); if (x) return x; }
        else if (t.id === id) return t;
    }
    return null;
}
// 규칙의 JS · CSS 를 태번 헬퍼 스크립트로 옮김: 이 규칙이 만든 스크립트가 있으면 내용만 바꾸고, 없으면 새로 만듦(꺼진 채로 — 켜기는 sync 가)
async function moveToHelper(rule) {
    const th = helper();
    if (!th || !(rule.js?.trim() || rule.css?.trim())) return;
    const content = wrapperCode(rule);
    const own = rule.thOwn && thScript(rule.thOwn);
    const update = (x) => x.type === 'folder' ? { ...x, scripts: (x.scripts || []).map(update) } : (x.id === rule.thOwn ? { ...x, name: rule.name, content } : x);
    if (own) await th.updateScriptTreesWith(t => t.map(update), { type: 'global' });
    else {
        const id = crypto.randomUUID();
        const script = { type: 'script', enabled: false, name: rule.name, id, content, info: `${rule.name}: breeze ‘테마별 스크립트’가 조건이 맞을 때만 켜요.`, button: { enabled: true, buttons: [] }, data: {}, export_with: { data: true, button: true } };
        await th.updateScriptTreesWith(t => [...t, script], { type: 'global' });
        rule.thOwn = id;
    }
    rule.th = [...(rule.th || []).filter(x => x.id !== rule.thOwn), { id: rule.thOwn, name: rule.name }];
    rule.js = ''; rule.css = ''; rule.cleanupName = '';   // 이제 태번 헬퍼가 실행(breeze 가 또 돌리지 않게)
}
// 태번 헬퍼 스크립트 파일에서 읽은 스크립트를 꺼진 채로 넣고 이 규칙에 이음(같은 이름이 이미 있으면 그 스크립트에 잇기만)
async function addHelperFile(rule, list) {
    const th = helper();
    if (!th || !list?.length) return;
    const have = thList();
    const add = [];
    rule.th ??= [];
    for (const x of list) {
        let hit = have.find(y => y.name === x.name);
        if (!hit) { hit = { id: crypto.randomUUID(), name: x.name }; add.push({ type: 'script', enabled: false, name: x.name, id: hit.id, content: x.content, info: x.info, button: x.button || { enabled: true, buttons: [] }, data: x.data || {}, export_with: { data: true, button: true } }); }
        if (!rule.th.some(r => r.id === hit.id)) rule.th.push({ id: hit.id, name: hit.name });
    }
    if (add.length) await th.updateScriptTreesWith(t => [...t, ...add], { type: 'global' });
}

// 어느 규칙에도 안 걸리게 된 스크립트는 끔 — 규칙을 지우거나 연결을 풀면 켜고 끌 주인이 없어져 모든 테마에서 켜진 채 남았음
async function turnOffUnlinked(ids) {
    const th = helper();
    const still = new Set(rules().flatMap(r => (r.th || []).map(x => x.id)));
    const drop = new Set(ids.filter(id => id && !still.has(id)));
    if (!th || !drop.size) return;
    const flip = (x) => x.type === 'folder' ? { ...x, scripts: (x.scripts || []).map(flip) } : (drop.has(x.id) && x.enabled ? { ...x, enabled: false } : x);
    try { await th.updateScriptTreesWith(t => t.map(flip), { type: 'global' }); } catch (e) { console.warn('[Breeze] 태번 헬퍼 스크립트 끄기', e); }
}
// 파일에 든 스크립트 중 같은 이름이 없는 것만 꺼진 채로 넣음
async function addMissingScripts(list) {
    const th = helper();
    if (!th || !Array.isArray(list) || !list.length) return;
    const have = new Set(thList().map(x => x.name));
    const add = list.filter(x => x?.name && typeof x.content === 'string' && !have.has(x.name)).map(x => ({ type: 'script', enabled: false, name: String(x.name), id: crypto.randomUUID(), content: x.content, info: String(x.info || ''), button: x.button || { enabled: true, buttons: [] }, data: x.data || {}, export_with: { data: true, button: true } }));
    if (add.length) await th.updateScriptTreesWith(t => [...t, ...add], { type: 'global' });
}

async function removeOwnScript(rule) {
    const th = helper();
    if (!th || !rule.thOwn) return;
    const drop = (list) => list.filter(x => x.id !== rule.thOwn).map(x => x.type === 'folder' ? { ...x, scripts: drop(x.scripts || []) } : x);
    try { await th.updateScriptTreesWith(t => drop(t), { type: 'global' }); } catch (e) { console.warn('[Breeze] 태번 헬퍼 스크립트 지우기', e); }
}

function turnOn(rule) {
    const job = { style: null, cleanups: [], watched: rule.watch?.trim() ? cssVar(rule.watch.trim()) : null };
    running.set(rule.id, job);
    if (rule.css?.trim()) {
        job.style = document.createElement('style');
        job.style.dataset.etkThemeScript = rule.id;
        job.style.textContent = rule.css;
        document.head.append(job.style);
    }
    if (rule.js?.trim()) {
        const etk = { onCleanup: fn => { if (typeof fn === 'function') job.cleanups.push(fn); }, rule: rule.name };
        try { new Function('etk', rule.js)(etk); } catch (e) { console.error(`[Breeze] 테마 스크립트 ‘${rule.name}’`, e); }
    }
}

function turnOff(id) {
    const job = running.get(id);
    if (!job) return;
    running.delete(id);
    job.style?.remove();
    for (const fn of job.cleanups.reverse()) { try { fn(); } catch (e) { console.warn('[Breeze] 뒷정리', e); } }
    const rule = rules().find(r => r.id === id);
    const name = rule?.cleanupName?.trim();
    if (name && typeof window[name] === 'function') { try { window[name](); } catch (e) { console.warn('[Breeze] 뒷정리', e); } }
}

let lastCss = '';
function sync(css = lastCss) {
    lastCss = css;
    const want = new Set(rules().filter(r => r.on && matches(r, css)).map(r => r.id));
    const restart = new Set();
    for (const id of [...running.keys()]) {
        const rule = rules().find(r => r.id === id);
        const moved = rule?.watch?.trim() && cssVar(rule.watch.trim()) !== running.get(id).watched;
        if (moved && want.has(id)) for (const ref of rule.th || []) restart.add(ref.id);
        if (!want.has(id) || moved) turnOff(id);
    }
    for (const r of rules()) if (want.has(r.id) && !running.has(r.id)) turnOn(r);
    thSync(restart);
}

// 테마 이름만 바뀌고 CSS 가 같은 경우도 있어 테마를 고를 때도 한 번
const onThemePick = () => setTimeout(() => sync(), 200);

export function start(a) {
    api = a;
    fought = false; flips = 0;
    off = onThemeCss(({ css }) => sync(css));
    document.addEventListener('change', themePickListener, true);
    // 태번 헬퍼는 확장 중 늦게 뜰 수 있음 — 뜨면 한 번 맞춤(최대 30초 기다림)
    if (!helper() && rules().some(r => r.th?.length)) {
        let n = 0; const t = setInterval(() => { if (helper()) { clearInterval(t); thSync(); } else if (++n > 60) clearInterval(t); }, 500);
    }
}
function themePickListener(e) { if (e.target?.id === 'themes') onThemePick(); }

export function stop() {
    off?.(); off = null;
    document.removeEventListener('change', themePickListener, true);
    for (const id of [...running.keys()]) turnOff(id);
    thSync();
}

// 편집 창을 띄우는 동안 설정 창은 잠깐 가림(반투명한 편집 창 뒤로 비쳐 글이 겹쳐 보임)
async function withDialogHidden(fn) {
    const d = document.getElementById('etk_dialog');
    if (d) d.style.visibility = 'hidden';
    try { return await fn(); } finally { if (d) d.style.visibility = ''; }
}

// 스크립트 추가 · 고치기. 보통은 ‘어느 테마에서’와 ‘파일 고르기’ 두 가지만 하면 되게 하고, 나머지는 고급에 접어 둔다.
async function editRule(rule) {
    const c = api.ctx();
    const themes = [...document.querySelectorAll('#themes option')].map(o => o.value).filter(Boolean);
    const current = appliedTheme();
    const box = document.createElement('div');
    box.className = 'etk-ts-edit';
    box.innerHTML = `
        <div class="etk-ts-step"><b>1. 어느 테마에서 실행할까요?</b>
            <select class="text_pole" data-k="theme"></select>
            <div class="etk-series-row"><input type="checkbox" data-k="series" id="etk-ts-series"><label for="etk-ts-series">같은 시리즈 테마 전부에서: 이름에</label><input class="text_pole etk-inline" data-k="seriesWord"><label for="etk-ts-series">이(가) 들어간 테마</label></div>
        </div>
        <div class="etk-ts-step etk-ts-th"><b>2. 켤 태번 헬퍼 스크립트</b><small>태번 헬퍼 전역 스크립트 중 이 테마에서만 켤 것을 골라요. 테마를 벗어나면 꺼져요.</small><div class="etk-ts-thlist"></div></div>
        <div class="etk-ts-step"><b><span class="etk-ts-num">2</span>. 또는 테마 제작자가 준 파일을 직접</b>
            <div class="etk-flex"><div class="menu_button" data-pick="js"><i class="fa-solid fa-file-code"></i>JS 파일 고르기</div><small data-info="js"></small></div>
            <div class="etk-flex"><div class="menu_button" data-pick="css"><i class="fa-solid fa-file-lines"></i>CSS 파일 고르기</div><small data-info="css"></small></div>
            <details class="etk-advanced"><summary>파일 내용 보기 · 직접 붙여넣기</summary>
                <label>JS<textarea class="text_pole" rows="6" data-k="js"></textarea></label>
                <label>CSS<textarea class="text_pole" rows="4" data-k="css"></textarea></label>
            </details>
        </div>
        <div class="etk-ts-step"><b>3. 이 스크립트를 부를 이름</b><small>breeze 설정의 ‘테마별 스크립트’ 목록에 이 이름으로 보여요. 비우면 테마 이름을 써요.</small><input class="text_pole" data-k="name" placeholder="예: 날씨 위젯"></div>
        <input type="hidden" data-k="when"><input type="hidden" data-k="value"><input type="hidden" data-k="cleanupName"><input type="hidden" data-k="watch">`;
    addMaximize(box);
    const f = k => box.querySelector(`[data-k="${k}"]`);
    // 태번 헬퍼 스크립트 목록(없으면 이 칸은 숨기고 직접 넣기만)
    const thAll = thList().filter(x => x.id !== rule.thOwn), chosen = new Set((rule.th || []).map(ref => resolve(ref, thAll)?.id).filter(Boolean));
    const thBox = box.querySelector('.etk-ts-th');
    if (!helper()) thBox.hidden = true;
    else {
        box.querySelector('.etk-ts-num').textContent = '3';
        box.querySelector('.etk-ts-thlist').innerHTML = thAll.length ? thAll.map(x => `<label class="checkbox_label"><input type="checkbox" value="${html(x.id)}" ${chosen.has(x.id) ? 'checked' : ''}><span>${x.folder ? `<em>${html(x.folder)} /</em> ` : ''}${html(x.name)}</span></label>`).join('') : '<small>태번 헬퍼 전역 스크립트 0개</small>';
    }
    f('theme').innerHTML = themes.map(t => `<option>${html(t)}</option>`).join('');
    const owned = rule.thOwn ? unwrap(thScript(rule.thOwn)?.content || '') : null;   // 이 규칙이 태번 헬퍼에 만든 스크립트의 원래 코드
    for (const k of ['name', 'when', 'value', 'css', 'js', 'cleanupName', 'watch']) f(k).value = (owned && k in owned ? owned[k] : rule[k]) ?? (k === 'when' ? 'theme' : '');
    const isNew = !rule.value;
    f('theme').value = rule.when === 'theme' && rule.value ? rule.value : current;
    if (isNew) { f('when').value = 'theme'; f('value').value = current; f('name').value = current; }
    // 시리즈: 테마 이름의 첫 낱말(앞의 그림 글자 · 뒤의 [색 이름]은 빼고 첫 낱말만)을 기본값으로
    const firstWord = (t) => (String(t).replace(/^[^\p{L}\p{N}]+/u, '').match(/^[\p{L}\p{N}._-]+/u) || [''])[0];
    f('series').checked = rule.when === 'series';
    f('seriesWord').value = rule.when === 'series' ? rule.value : firstWord(f('theme').value);
    const syncWhen = () => {
        if (f('series').checked) { f('when').value = 'series'; f('value').value = f('seriesWord').value.trim(); }
        else if (f('when').value === 'series' || f('when').value === 'theme' || !rule.value) { f('when').value = 'theme'; f('value').value = f('theme').value; }
    };
    f('series').addEventListener('change', syncWhen);
    f('seriesWord').addEventListener('input', () => { f('series').checked = true; syncWhen(); });
    // 태번 헬퍼에서 내보낸 스크립트 파일(.json)을 고르면 그 스크립트를 그대로 태번 헬퍼에 넣음(감싸지 않음)
    let helperFile = [];
    const info = () => {
        for (const k of ['js', 'css']) box.querySelector(`[data-info="${k}"]`).textContent = f(k).value.trim() ? `${f(k).value.length.toLocaleString()}자` : '미선택';
        if (helperFile.length) box.querySelector('[data-info="js"]').textContent = `태번 헬퍼 스크립트: ${helperFile.map(x => x.name).join(', ')}`;
    };
    info();
    // 테마를 고르면 조건은 ‘테마 이름’으로 맞추고, 이름을 안 고쳤으면 이름도 따라감
    f('theme').addEventListener('change', () => { const was = f('name').value; if (!f('series').checked) f('seriesWord').value = firstWord(f('theme').value); syncWhen(); if (!was.trim() || themes.includes(was)) f('name').value = f('theme').value; });
    box.addEventListener('input', info);
    box.addEventListener('click', async (e) => {
        const pick = e.target.closest('[data-pick]');
        if (!pick) return;
        const kind = pick.dataset.pick;
        const file = await pickFile(kind === 'js' ? '.js,.json,text/javascript,application/json' : '.css,text/css');
        if (!file) return;
        const text = await file.text();
        if (kind === 'js' && /\.json$/i.test(file.name)) {
            let j = null;
            try { j = JSON.parse(text); } catch { /* 아래에서 알림 */ }
            const list = (j?.type === 'folder' ? j.scripts : Array.isArray(j) ? j : [j]).filter(x => x && typeof x.content === 'string' && x.content.trim());
            if (!list.length) return void toastr.warning('태번 헬퍼 스크립트 파일이 아니에요.', 'breeze');
            helperFile = list.map(x => ({ name: String(x.name || file.name.replace(/(\.script)?\.json$/i, '')), content: x.content, info: String(x.info || ''), button: x.button, data: x.data }));
            f('js').value = '';
            const cur = f('name').value.trim();
            if (!cur || themes.includes(cur)) f('name').value = helperFile[0].name;
        } else { f(kind).value = text; if (kind === 'js') helperFile = []; }
        info();
    });
    const ok = await withDialogHidden(() => c.callGenericPopup(box, c.POPUP_TYPE.CONFIRM, '', { okButton: '저장', cancelButton: '취소', wide: true, allowVerticalScrolling: true }));
    if (ok !== c.POPUP_RESULT.AFFIRMATIVE) return false;
    syncWhen();
    for (const k of ['name', 'when', 'value', 'css', 'js', 'cleanupName', 'watch']) rule[k] = f(k).value;
    if (helper()) rule.th = [...box.querySelectorAll('.etk-ts-thlist input:checked')].map(i => { const x = thAll.find(y => y.id === i.value); return { id: x.id, name: x.name }; }).concat(rule.thOwn ? [{ id: rule.thOwn, name: rule.name }] : []);
    rule.name = rule.name.trim() || rule.value || '이름 미지정';
    try { await addHelperFile(rule, helperFile); } catch (e) { console.error('[Breeze] 태번 헬퍼 스크립트 넣기', e); toastr.error('태번 헬퍼에 스크립트를 넣지 못했어요.', 'breeze'); }
    try { await moveToHelper(rule); } catch (e) { console.error('[Breeze] 태번 헬퍼 스크립트 만들기', e); toastr.error('태번 헬퍼에 스크립트를 넣지 못했어요.', 'breeze'); }
    return true;
}

// 들여오기는 남이 만든 코드를 실행하게 되므로, 무엇이 들어오는지 보여 주고 확인받은 뒤에만
async function importRules(text) {
    const c = api.ctx();
    let list;
    let scripts = [];
    try { list = JSON.parse(text); scripts = Array.isArray(list?.helperScripts) ? list.helperScripts : []; list = Array.isArray(list) ? list : list?.rules; } catch { list = null; }
    if (!Array.isArray(list) || !list.length) return toastr.warning('읽을 수 있는 규칙이 없어요.');
    list = list.filter(r => r && typeof r === 'object').map(r => ({
        id: crypto.randomUUID(), on: true, name: String(r.name || '이름 미지정'), when: WHEN[r.when] ? r.when : 'theme',
        value: String(r.value || ''), css: String(r.css || ''), js: String(r.js || ''), cleanupName: String(r.cleanupName || ''), watch: String(r.watch || ''),
        th: Array.isArray(r.th) ? r.th.filter(x => x?.name).map(x => ({ id: '', name: String(x.name) })) : [],
    }));
    const withJs = [...list.filter(r => r.js.trim()), ...scripts];
    const msg = `<b>스크립트 ${list.length}개를 불러올까요?</b><br>${list.map(r => `· ${html(r.name)}: ${html(WHEN[r.when])} ‘${html(r.value)}’${r.js.trim() ? ' <b>(JS 포함)</b>' : ''}`).join('<br>')}`
        + (withJs.length ? '<br><br>JS 가 든 스크립트는 그 테마일 때 실리태번 안에서 코드를 실행해요. 믿을 수 있는 곳에서 받은 것만 불러오세요.' : '');
    const ok = await withDialogHidden(() => c.callGenericPopup(msg, c.POPUP_TYPE.CONFIRM, '', { okButton: '불러오기', cancelButton: '취소' }));
    if (ok !== c.POPUP_RESULT.AFFIRMATIVE) return;
    try { await addMissingScripts(scripts); } catch (e) { console.error('[Breeze] 태번 헬퍼 스크립트 넣기', e); }
    for (const r of list) { try { await moveToHelper(r); } catch (e) { console.error('[Breeze] 태번 헬퍼 스크립트 만들기', e); } }
    rules().push(...list);
    api.save();
    sync();
    return true;
}

export function options(box, a) {
    api ??= a;
    const render = () => {
        box.innerHTML = `
            <div class="etk-ts-list"></div>
            <div class="etk-flex">
                <div class="menu_button etk-ts-add"><i class="fa-solid fa-plus"></i> 스크립트 추가</div>
                <div class="menu_button etk-ts-export" title="등록한 스크립트를 파일로 저장">내보내기</div>
                <label class="menu_button" title="내보내기로 저장한 파일에서 스크립트 불러오기">불러오기<input type="file" accept=".json,application/json" hidden></label>
            </div>`;
        const list = box.querySelector('.etk-ts-list');
        if (!rules().length) list.innerHTML = '<small>등록된 스크립트 0개</small>';
        for (const r of rules()) {
            const row = document.createElement('div');
            row.className = 'etk-ts-row';
            row.innerHTML = `<input type="checkbox" ${r.on ? 'checked' : ''} title="사용"><div class="etk-ts-text"><div class="etk-ts-name"></div><small></small></div>
                <div class="menu_button fa-solid fa-pen" title="고치기"></div><div class="menu_button fa-solid fa-trash" title="지우기"></div>`;
            // 이름 아래: 이 규칙이 켜는 스크립트(태번 헬퍼 스크립트 이름 · 직접 넣은 JS · CSS). 조건(CSS 변수 이름 등)은 쓰지 않음
            row.querySelector('.etk-ts-name').textContent = r.name;
            const what = [...(r.th || []).map(x => x.name), ...(r.js?.trim() ? ['직접 넣은 JS'] : []), ...(r.css?.trim() ? ['직접 넣은 CSS'] : [])];
            row.querySelector('small').textContent = (what.length ? `적용 스크립트: ${what.join(', ')}` : '적용 스크립트 없음') + (running.has(r.id) ? ' (지금 실행 중)' : '');
            row.querySelector('input').addEventListener('change', e => { r.on = e.target.checked; a.save(); sync(); render(); });
            row.querySelector('.fa-pen').addEventListener('click', async () => { const had = (r.th || []).map(x => x.id); if (await editRule(r)) { turnOff(r.id); await turnOffUnlinked(had); a.save(); sync(); render(); } });
            row.querySelector('.fa-trash').addEventListener('click', async () => { turnOff(r.id); await removeOwnScript(r); const had = (r.th || []).map(x => x.id); a.options().rules = rules().filter(x => x !== r); await turnOffUnlinked(had); a.save(); render(); });   // 이 규칙이 태번 헬퍼에 만든 스크립트도 같이 지움
            list.append(row);
        }
        box.querySelector('.etk-ts-add').addEventListener('click', async () => {
            const r = { id: crypto.randomUUID(), on: true, name: '', when: 'theme', value: '', css: '', js: '', cleanupName: '', watch: '', th: [] };
            if (await editRule(r)) { rules().push(r); a.save(); sync(); render(); }
        });
        box.querySelector('.etk-ts-export').addEventListener('click', () => {
            // 태번 헬퍼로 옮겨 둔 코드는 규칙에 다시 넣고, 골라 둔 태번 헬퍼 스크립트는 내용째 같이(이름만 넣으면 다른 컴퓨터에서 불러올 때 아무것도 안 돎)
            const own = new Set(rules().map(r => r.thOwn).filter(Boolean));
            const linked = [...new Set(rules().flatMap(r => (r.th || []).map(x => x.id)))].filter(id => !own.has(id)).map(thScript).filter(Boolean).map(({ name, content, info, button, data }) => ({ name, content, info, button, data }));
            const data = JSON.stringify({ rules: rules().map(({ id, on, thOwn, ...r }) => { const code = thOwn && unwrap(thScript(thOwn)?.content || ''); return code ? { ...r, ...code, th: (r.th || []).filter(x => x.id !== thOwn) } : r; }), helperScripts: linked }, null, 2);
            const link = document.createElement('a');
            link.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
            link.download = 'theme-scripts.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        });
        box.querySelector('input[type=file]').addEventListener('change', async e => {
            const f = e.target.files?.[0];
            if (f && await importRules(await f.text())) render();
        });
    };
    render();
}

