// 답 · 번역이 끝나면 소리로 알리기.
// 답 생성이 끝났을 때, 그리고 ‘답 말고도 알릴 때’에 등록해 둔 다른 확장의 끝남 신호(번역 완료 등)가 왔을 때 짧은 소리를 낸다.
// 신호마다 알아볼 이름을 붙여 체크칸으로 켜고 끈다(옵션 signals = [{ name, event, on }]).
// 어떤 신호가 있는지는 기능이 켜져 있는 동안 저절로 모은다: 다른 확장이 신호를 낼 때 그 이름 · 횟수 · 낸 확장(파일 주소의 third-party/폴더)을
// 메모리에 적어 두고(신호마다 한 줄 거쳐 감 — 지켜보는 일은 없음), 세부 설정에서 ‘최근에 다른 확장이 낸 신호’로 보여 준다. 실리태번 자체 신호는 뺌.
// 기본 소리는 브라우저가 직접 만드는 음이라 따로 받을 파일이 없고, 내 소리 파일을 고르면 그 파일을 쓴다(user/files 에 저장).
// 다른 쪽이 이미 알림 소리를 내면 쉰다: 실리태번의 ‘메시지 소리’가 켜져 있거나, 끝난 직후 잠깐 사이에 다른 코드가 소리를 틀었으면 내지 않는다
// (소리 재생을 한 줄 거쳐 가게 해 ‘방금 누가 틀었는지’ 시각만 적어 둠 — 지켜보는 일은 없음).
// 왜 울렸는지 · 안 울렸는지는 콘솔 디버그에 ‘[Breeze] 완료 소리: …’로 남긴다.
import { saveUserFile, pickFiles, extOf } from '../lib/files.js';

// 기본 소리: [주파수, 시작 초] 들
// 이 확장의 폴더 이름(설치한 주소에 따라 달라짐)
const OWN = decodeURIComponent(import.meta.url.match(/\/third-party\/([^/]+)\//)?.[1] || 'breeze');
const TONES = {
    chime: { name: '맑은 두 음', notes: [[880, 0], [1320, 0.13]] },
    single: { name: '짧은 한 음', notes: [[1047, 0]] },
    soft: { name: '낮은 두 음', notes: [[523, 0], [659, 0.15]] },
    rise: { name: '올라가는 세 음', notes: [[659, 0], [880, 0.12], [1175, 0.24]] },
};
let myPlay = null;
let api = null, listeners = [], docListeners = [], lastOtherPlay = 0, origPlay = null, ours = false, ctxAudio = null, stopFinding = null, unwatchSignals = null, redrawSeen = null;
const seen = new Map();   // 신호 이름 → { count, from }

// 소리 값: 기본 소리 이름(TONES) 또는 'file:주소'(내 소리). 알림마다 고른 소리는 toneFor[알림 열쇠], 없으면 기본 소리(o.tone)
// 예전 꼴(‘내 소리 파일’ 하나 = tone 'file' + url)은 내 소리 목록으로 한 번 옮김
function mySounds() {
    const o = api.options();
    o.sounds ??= [];
    if (o.tone === 'file') { if (o.url?.trim() && !o.sounds.some(x => x.url === o.url)) o.sounds.push({ name: o.url.split('/').pop(), url: o.url }); o.tone = o.url?.trim() ? `file:${o.url}` : 'chime'; delete o.url; }
    return o.sounds;
}
const toneOf = (key) => (key && api.options().toneFor?.[key]) || api.options().tone;
function beep(tone) {
    const o = api.options();
    mySounds();
    tone ??= o.tone;
    const volume = Math.min(1, Math.max(0, Number(o.volume ?? 0.5)));
    ours = true;
    try {
        const file = String(tone || '').startsWith('file:') ? tone.slice(5) : '';
        // 누른 순간(▶ · 고르기)이면 멈춘 소리 길을 새로 열 수 있음
        const gesture = !!navigator.userActivation?.isActive;
        // 아이폰 기본 모드: 소리 길이 멈춰 있을 때(다른 탭에 있었거나 노래에 밀림) 누르지 않은 채 깨우면, 사파리가 그 깨우기를 미뤄 뒀다가
        // 다음에 화면을 누르는 순간 실행해서 그때 듣던 노래가 끊겼음 → 이럴 땐 이번 알림음은 건너뜀
        if (quietIOS() && !gesture && ctxAudio?.state !== 'running') { log('아이폰: 소리 길이 멈춰 있어 이번 알림음은 건너뜀'); return; }
        const ctx = liveCtx(gesture);
        if (file.trim()) { playFile(ctx, file.trim(), volume); return; }
        if (ctx.state !== 'running') { ctx.resume?.().then(() => playNotes(ctx, tone, o, volume)).catch(() => {}); return; }
        playNotes(ctx, tone, o, volume);
    } finally { ours = false; }
}
// 내 소리 파일도 알림음 소리 길(Web Audio)로 튼다: 파일을 그냥 틀면(new Audio) 아이폰은 크기를 못 바꾸고(늘 기기 음량) 듣던 노래도 멈춤.
// 한 번 읽은 파일은 기억해 둠. 읽지 못하는 파일(다른 사이트 주소 등)만 예전처럼 그냥 튼다
const fileBuffers = new Map();
function playFile(ctx, url, volume) {
    const fallback = () => { const a = new Audio(url); a.volume = volume; ours = true; try { a.play().catch(() => {}); } finally { ours = false; } };
    let buf = fileBuffers.get(url);
    if (!buf) {
        buf = fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
            .then(data => new Promise((ok, no) => ctx.decodeAudioData(data, ok, no)));
        fileBuffers.set(url, buf);
        buf.catch(() => fileBuffers.delete(url));
    }
    Promise.all([buf, ctx.state === 'running' ? null : ctx.resume?.()]).then(([decoded]) => {
        const src = ctx.createBufferSource(), gain = ctx.createGain();
        src.buffer = decoded;
        // 휴대폰은 노래에 묻혀서 파일 원래 크기의 2배까지(더 키우면 소리가 찢어짐)
        gain.gain.value = volume * (isPhone() ? 2 : 1);
        src.connect(gain).connect(ctx.destination);
        src.start();
    }).catch(fallback);
}
function playNotes(ctxAudio, tone, o, volume) {
    {
        const t0 = ctxAudio.currentTime;
        for (const [freq, at] of (TONES[tone] || TONES[o.tone] || TONES.chime).notes) {
            const osc = ctxAudio.createOscillator(), gain = ctxAudio.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, t0 + at);
            // 휴대폰은 노래와 섞여 울리면 묻혀서 더 크게(컴퓨터의 3배까지)
            gain.gain.linearRampToValueAtTime(volume * (isPhone() ? 0.9 : 0.3), t0 + at + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.25);
            osc.connect(gain).connect(ctxAudio.destination);
            osc.start(t0 + at);
            osc.stop(t0 + at + 0.27);
        }
    }
}

// 같은 일을 두 신호가 알릴 때(답이 그려짐 + 다른 확장의 ‘답 붙음’) 한 번만
const COOLDOWN = 1500;
let lastBeep = 0;
function notify(why = '', key = 'main') {
    if (api.ctx().powerUserSettings?.play_message_sound) return;   // 실리태번이 직접 냄
    // 아이폰에서 노래와 섞어 울릴 땐 다른 탭에선 소리를 못 내서 이 칸은 안 씀(켜 두면 아예 안 울림)
    if (api.options().onlyHidden && !quietIOS() && document.visibilityState === 'visible' && document.hasFocus()) return;
    const at = Date.now();
    if (at - lastBeep < COOLDOWN) { log(`${why} — 방금 울려서 건너뜀`); return; }
    lastBeep = at;
    log(why);
    // 다른 확장이 같은 순간에 소리를 내는지 잠깐 보고
    setTimeout(() => { if (lastOtherPlay < at - 300) beep(toneOf(key)); }, 250);
}
const log = (why) => { if (why) console.debug(`[Breeze] 완료 소리: ${why}`); };

// 휴대폰은 화면을 끄거나 다른 앱을 보면 페이지 소리를 멈춰서, 답이 끝나도 알림이 안 남.
// 생성하는 동안 소리 없는 아주 짧은 음을 되풀이해 틀어 소리 길을 깨워 두고, 끝나면 멈춘다(옵션 keepAlive, 휴대폰에서만).
// 휴대폰 브라우저는 사용자가 한 번 화면을 눌러야 소리를 틀 수 있어, 첫 손길에 미리 한 번 틀어 둔다.
const SILENT = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==';
const isPhone = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
let keepAudio = null, unlocked = false;
// 아이폰: 무음 '파일'을 틀면 페이지가 음악 트는 쪽으로 바뀌어 듣던 노래가 멈춤(대신 무음 모드에서도 울림).
//   기본은 무음 파일 없이 알림음 소리 길(Web Audio, 다른 소리와 섞임 · 무음 모드면 안 남)만 연다. 사파리는 손을 뗄 때(touchend · click) 연 것만 인정함.
//   무음 파일로 페이지를 붙잡으면 노래가 멈춰서, 아이폰에선 다른 탭 · 화면 꺼짐 관련 칸을 아예 두지 않음(탭을 보고 있을 때만 울림)
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const quietIOS = () => isIOS();
const keepOn = () => api?.options().keepAlive !== false && isPhone() && !quietIOS();
function keepAudioEl() {
    if (!keepAudio) { keepAudio = new Audio(SILENT); keepAudio.loop = true; keepAudio.setAttribute('playsinline', ''); }
    return keepAudio;
}
function playSilently(a) { ours = true; try { return a.play(); } finally { ours = false; } }
// 아이폰(아이폰의 모든 브라우저가 같은 엔진)은 손을 뗀 순간(touchend · click) 소리 길에서 실제로 무언가를 한 번 틀어야 소리 길을 열어 줌 → 열릴 때까지 아주 짧은 빈 소리를 틂.
// 열린 뒤 멈춘 소리 길을 새로 만들어 다시 열면 듣던 노래가 누를 때마다 끊겨서(그 페이지가 이미 음악 트는 쪽으로 바뀌어 있으면) 새로 만들지 않음
const newCtx = () => new (window.AudioContext || window.webkitAudioContext)();
let opened = false;
function liveCtx(gesture) {
    ctxAudio ??= newCtx();
    if (ctxAudio.state === 'running') { opened = true; return ctxAudio; }
    if (gesture && isIOS() && !opened) {
        const src = ctxAudio.createBufferSource();
        src.buffer = ctxAudio.createBuffer(1, 1, 22050);
        src.connect(ctxAudio.destination);
        src.start(0);
        ctxAudio.resume?.().then(() => { if (ctxAudio.state === 'running') opened = true; }).catch(() => {});
    } else ctxAudio.resume?.().catch(() => {});
    return ctxAudio;
}
function unlock(e) {
    if (isIOS()) {
        // 사파리는 손을 뗄 때 연 것만 인정함. 한 번 열린 뒤엔 누를 때 아무것도 안 함: 노래에 밀려 멈춘 소리 길을 누를 때마다 깨우면 그때마다 노래가 끊겼음
        if (e && !['touchend', 'click', 'keydown'].includes(e.type)) return;
        if (!opened) try { liveCtx(true); } catch { /* 소리 장치 없음 */ }
    }
    if (unlocked || !keepOn()) return;
    unlocked = true;
    try { liveCtx(false); } catch { /* 소리 장치 없음 */ }
    const a = keepAudioEl();
    playSilently(a)?.then(() => { if (!busy()) a.pause(); }).catch(() => { unlocked = false; });
}
function keepAlive(on) {
    if (!keepOn()) return;
    const a = keepAudioEl();
    if (on) { try { a.currentTime = 0; } catch { /* 준비 전 */ } playSilently(a)?.catch(() => {}); } else a.pause();
}
let busy = () => false;

// 예전 꼴(쉼표로 적은 신호 이름)을 이름 붙은 목록으로 한 번 옮김
function signals() {
    const o = api.options();
    if (!Array.isArray(o.signals)) {
        o.signals = String(o.extraEvents || '').split(/[\s,]+/).filter(Boolean).map(event => ({ name: event, event, on: true }));
        delete o.extraEvents;
    }
    return o.signals;
}

// 다른 확장의 끝남 신호: 실리태번 신호 이름이거나 화면(document) 신호 이름 — 둘 다에 걸어 둠
// 이미 끝난 일을 채팅에 들여오는 신호는 소리 안 냄 — 예: 홈에 있을 때 끝난 백그라운드 답장은 끝날 때 그 확장이 직접 알리고,
// 채팅에 들어가면 답을 넣으며 ‘답장 도착’ 신호가 한 번 더 와서 소리가 두 번 났음. 신호에 메시지 번호가 있으면 그 답이 끝난 시각
// (gen_finished)을 보고, 지금 채팅을 열기 전에 끝난 답이면 넘김. 시간으로 어림하지 않으므로 다른 신호 · 확장이 없을 때는 그대로.
let chatOpenedAt = 0, appReadyAt = 0;
function finishedBeforeOpen(detail) {
    const d = detail?.detail ?? detail;
    const i = Number(d?.index);
    if (!Number.isInteger(i) || i < 0) return false;
    const msg = api.ctx().chat?.[i];
    const done = Date.parse(msg?.gen_finished ?? msg?.swipe_info?.[d?.swipe ?? msg?.swipe_id]?.gen_finished ?? '');
    return Number.isFinite(done) && done < chatOpenedAt;
}
// 신호에 ‘저장해 둔 결과를 가져옴’ 표시(cached)가 있으면 새로 끝난 일이 아니라 소리 안 냄 — 번역기가 IndexedDB 에 있던 번역을 가져올 때도 같은 ‘번역 완료’ 신호를 냈음
// 신호에 붙은 표시로 ‘새로 끝난 일’만 고름 — 확장마다 따로 알지 않고 표시의 꼴만 봄:
//   저장해 둔 결과를 가져옴(cached) · 멈춤(stopped) · 실패(outcome error · aborted) · 여럿을 한꺼번에 하는 일의 한 조각(batch) → 넘김
//   진행 신호(running · done · total) → 다 끝났을 때(running 아님 · done ≥ total) 한 번만 — 중간에 멈춘 것은 넘김
function isFreshDone(detail) {
    const d = detail?.detail ?? detail;
    if (!d || typeof d !== 'object') return true;
    if (d.cached === true || d.stopped === true || d.batch === true) return false;
    if (['error', 'aborted'].includes(d.outcome)) return false;
    if (typeof d.running === 'boolean') return !d.running && Number(d.total) > 0 && Number(d.done) >= Number(d.total);
    return true;
}
// 한 메시지의 일을 신호 두 개로 알리는 확장이 있음(끝남 → 저장한 뒤 한 번 더). 뒤 신호엔 ‘저장해 둔 결과’ · ‘여럿 중 한 조각’ 표시가 없어서,
// 앞 신호에서 넘긴 일(가져온 번역 · 전체 번역의 한 메시지)도 뒤 신호로 울렸고, 저장이 1.5초를 넘기면 같은 일에 두 번 울렸음 — 메시지 번호로 한 일로 묶음
const handled = new Map();   // 메시지 번호 → 시각
const jobKey = (detail) => { const d = detail?.detail ?? detail; const i = Number(d?.messageId ?? d?.index); return Number.isInteger(i) ? i : null; };
function onSignal(detail, toneKey = null) {
    const key = jobKey(detail), now = Date.now();
    for (const [k, at] of handled) if (now - at > 60000) handled.delete(k);
    if (key !== null && handled.has(key)) return;
    if (key !== null) handled.set(key, now);
    if (isFreshDone(detail) && !finishedBeforeOpen(detail)) notify('다른 확장의 끝남 신호', toneKey);
}

// 생성 요청이 실제로 끝났는지: 실리태번이 보낸 생성 요청(주소에 generate)이 몇 개 걸려 있고 마지막 것이 어떻게 끝났는지만 적어 둠.
// 다른 확장이 생성을 뒤로 넘겨 ‘생성 끝’ 신호가 먼저 와도(입력창만 먼저 풀어 줌), 실리태번의 요청은 진짜 답이 올 때까지 걸려 있다.
const GEN = /^\/api\/.*generate/;
let genBusy = () => false;
// 확장이 보낸 AI 요청: 답이 다 올 때까지(이어 받는 답은 끝까지) 기다린 뒤, 같은 확장이 1.5초 안에 요청을 또 안 보내면 한 번 울림.
// 목록엔 요청을 한 번이라도 보낸 확장만(aiSeen) 오르고, 체크해 둔 확장(aiOn)만 울림 — 번역처럼 따로 끝 신호를 내는 확장과 겹치지 않게 기본은 꺼 둠
const extPending = new Map();   // 확장 폴더 → 진행 중 요청 수
const extTimer = new Map();
function extRequestEnded(folder, res) {
    extPending.set(folder, (extPending.get(folder) || 0) + 1);
    clearTimeout(extTimer.get(folder));
    res.arrayBuffer().catch(() => {}).finally(() => {
        const n = (extPending.get(folder) || 1) - 1;
        extPending.set(folder, n);
        if (!api) return;
        const o = api.options();
        o.aiSeen ??= [];
        if (!o.aiSeen.includes(folder)) { o.aiSeen.push(folder); api.save(); redrawSeen?.(); }
        if (n > 0 || !(o.aiOn || []).includes(folder)) return;
        extTimer.set(folder, setTimeout(() => { if (!(extPending.get(folder) > 0)) notify(`${folder} AI 요청 끝`, `${folder}#ai`); }, 1500));
    });
}
let pendingGen = 0, lastGen = '', origFetch = null, wrappedFetch = null;
function wrapFetch() {
    if (wrappedFetch) return;
    origFetch = window.fetch;
    wrappedFetch = async function (input) {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (!GEN.test(url.replace(/^https?:\/\/[^/]+/, '').split('?')[0])) return origFetch.apply(this, arguments);
        // 확장이 직접 보낸 AI 요청(실리태번 생성 중이 아닐 때, 부른 코드가 그 확장 파일): 요청이 끝나면 그 확장 줄로 알림
        const ext = !genBusy() ? (new Error().stack || '').split('\n').map(l => l.match(/\/third-party\/([^/]+)\//)?.[1]).filter(Boolean).map(decodeURIComponent).filter(f => f !== OWN).pop() || '' : '';   // 맨 바깥 확장 = 요청을 보낸 확장(사이에 fetch 를 감싼 다른 확장이 끼어 있어도)
        pendingGen++;
        try {
            const res = await origFetch.apply(this, arguments);
            lastGen = res.ok ? 'done' : 'error';
            if (ext && res.ok) extRequestEnded(ext, res.clone());
            return res;
        } catch (e) {
            lastGen = e?.name === 'AbortError' ? 'aborted' : 'error';
            throw e;
        } finally { pendingGen--; }
    };
    window.fetch = wrappedFetch;
}
function unwrapFetch() {
    if (window.fetch === wrappedFetch) { window.fetch = origFetch; wrappedFetch = null; }   // 그 뒤에 다른 확장이 또 감쌌으면 그냥 둠
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 신호 이름으로 하는 일을 알 수 있는 것만(번역 · 요약 · 답장 · 음성 · 그림) — 이런 ‘일 끝남’ 신호는 확장을 하나하나 고르지 않아도 저절로 들음
// 확장마다 하나씩 체크하지 않아도 되게. 줄마다 끌 수 있음
const jobOf = (n) => { const s = String(n).toLowerCase(); return /translat/.test(s) ? '번역' : /summar/.test(s) ? '요약' : /reply|respon/.test(s) ? '답장' : /tts|voice|speech/.test(s) ? '음성' : /image|img|picture|diffusion|comfy|(^|[^a-z])sd[_:-]/.test(s) ? '그림' : ''; };
let autoSignals = new Map();   // 신호 이름 → 확장 폴더('a|b')
// 신호를 낸 확장 폴더(호출 기록에서 breeze · 신호 보내기를 감싼 칸은 건너뜀)
const emitterOf = () => (new Error().stack || '').split('\n').filter(l => !/at (?:\S+\.)?(?:emit|dispatchEvent) \(/.test(l)).map(l => l.match(/\/third-party\/([^/]+)\//)?.[1]).filter(Boolean).map(decodeURIComponent).find(f => f !== OWN) || '';
// 기본은 다 켜 두고, 설정에서 뺀 ‘확장 · 하는 일’(otherOff)만 무시 — 같은 번역 신호를 두 확장이 내도 실제로 낸 쪽으로 가름
function onNamedSignal(name, detail) {
    const off = api.options().otherOff || [];
    const j = jobOf(name), who = emitterOf();
    if (j && who && off.includes(`${who}#${j}`)) return;
    onSignal(detail, j && who ? `${who}#${j}` : null);
}
function listenSignals() {
    const { eventSource } = api.ctx();
    for (const [name, fn] of docListeners) { eventSource.removeListener?.(name, fn); document.removeEventListener(name, fn); }
    docListeners = [];
    const names = new Set([...autoSignals.keys()].filter(jobOf));
    for (const sig of signals()) if (sig.on && sig.event?.trim()) names.add(sig.event.trim());   // 예전에 골라 둔 신호도 그대로
    for (const name of names) {
        const fn = (d) => onNamedSignal(name, d);
        eventSource.on(name, fn);
        document.addEventListener(name, fn);
        docListeners.push([name, fn]);
    }
}

function watchSignals() {
    if (unwatchSignals) return;
    const { eventSource, eventTypes } = api.ctx();
    const core = new Set(Object.values(eventTypes || {}));
    const note = (name, detail) => {
        if (typeof name !== 'string' || !name || core.has(name)) return;
        // 켜지는 동안 나오는 신호(확장이 ‘준비됨’을 알리는 :ready 등)는 일이 끝난 게 아니라서 안 적음 — 목록에 ‘음성이 끝날 때’처럼 잘못 떴음
        if (!appReadyAt || Date.now() - appReadyAt < 5000) return;
        // 신호를 낸 확장: 호출 기록에서 breeze 와, 신호 보내기(emit · dispatchEvent)를 감싸 둔 다른 확장의 칸은 건너뜀 —
        // 감싼 확장이 맨 위에 잡혀 모든 신호가 그 확장 것으로 보였음
        const from = (new Error().stack || '').split('\n').filter(l => !/at (?:\S+\.)?(?:emit|dispatchEvent) \(/.test(l)).map(l => l.match(/\/third-party\/([^/]+)\//)?.[1]).filter(Boolean).map(decodeURIComponent).find(f => f !== OWN) || '';
        const hit = seen.get(name) || { count: 0, from };
        hit.count++; hit.last = Date.now(); if (!hit.from) hit.from = from;
        seen.set(name, hit);
        // 실제로 이 신호를 낸 확장을 기억(같은 신호 이름을 여러 확장이 코드에 갖고 있을 때 목록에 누구를 보일지)
        if (from && api) { const o = api.options(), k = `${from}#${name}`; o.confirmed ??= []; if (!o.confirmed.includes(k)) { o.confirmed.push(k); api.save(); } }
        // 진행 신호(running · done · total 을 싣고 일 내내 나오는 신호 — 여러 메시지를 한꺼번에 하는 일)는 이름에 ‘끝’이 없어 미리 못 찾음 —
        // 처음 나올 때 알아보고 듣기 시작해, 그 일이 다 끝날 때 울림
        const d = detail?.detail ?? detail;
        if (d && typeof d === 'object' && typeof d.running === 'boolean' && 'total' in d && jobOf(name) && from && !autoSignals.has(name)) { autoSignals.set(name, from); if (api) listenSignals(); }
        redrawSeen?.();
    };
    const emit = eventSource.emit, dispatch = document.dispatchEvent;
    let watching = true;
    const myEmit = function (name) { if (watching) note(name, arguments[1]); return emit.apply(this, arguments); };
    const myDispatch = function (ev) { if (watching && ev instanceof CustomEvent) note(ev.type, ev.detail); return dispatch.apply(this, arguments); };
    eventSource.emit = myEmit; document.dispatchEvent = myDispatch;
    // 우리 뒤에 다른 확장이 또 감쌌으면 그쪽 것을 지우지 않게, 우리 것일 때만 되돌리고 아니면 그냥 지나가게만
    unwatchSignals = () => { watching = false; if (eventSource.emit === myEmit) eventSource.emit = emit; if (document.dispatchEvent === myDispatch) document.dispatchEvent = dispatch; unwatchSignals = null; };
}

const extNames = new Map();
// 목록에 보이는 이름은 그 확장이 스스로 정한 이름(manifest)만 — 신호 이름 낱말로 무슨 일인지 짐작해 붙였더니 틀린 이름(화면 그리기 끝을 ‘답장 끝남’ 등)이 나왔음
const signalLabel = async (name, from) => (from ? await extensionName(from) : '확장 이름 모름');

// 깔린 확장의 코드에서 ‘끝남’ 신호 이름을 미리 찾음: 그 일을 한 번 시켜 볼 때까지 기다리지 않고 목록에 나오게.
// 확장마다 처음 읽는 파일과 그 파일이 바로 불러오는 파일까지만 봄(설정 칸을 처음 열 때 한 번, 결과는 기억)
let scanned = null;
const DONE_WORD = /(done|finish|complete|end(ed)?|ready|arriv|success|stop)(\b|_|-|:|$)/i;
// 끝나기 직전 · 화면 그리기 · 내보내기 · 불러오기 같은 신호는 ‘일이 끝나 알려 줄 때’가 아니라서 뺌
// 생성(generation) 끝은 이 기능이 원래 알아서 알리므로, 다른 확장이 따로 내는 생성 끝 신호는 겹쳐서 뺌
const NOT_DONE = /before|render|iframe|export|import|start|begin|init|load|open|update|change|generation/i;
function scanSignals() {
    if (scanned) return scanned;
    const core = new Set(Object.values(api.ctx().eventTypes || {}));
    const grab = (code, out) => {
        for (const m of code.matchAll(/(?:\.emit|\.emitAndWait|new CustomEvent|dispatchEvent\(\s*new Event)\(\s*['"`]([\w:.\-]{3,60})['"`]/g)) if (DONE_WORD.test(m[1]) && !NOT_DONE.test(m[1]) && !core.has(m[1])) out.add(m[1]);
    };
    scanned = (async () => {
        const found = new Map();   // 신호 이름 → 확장 폴더
        let list = [];
        try { list = (await (await fetch('/api/extensions/discover')).json()).filter(x => x.type !== 'system').map(x => x.name.replace(/^third-party\//, '')); } catch { return found; }
        const off = new Set((api.ctx().extensionSettings.disabledExtensions || []).map(x => x.replace(/^third-party\//, '')));
        await Promise.all(list.filter(x => x !== OWN && !off.has(x)).map(async folder => {
            const base = `/scripts/extensions/third-party/${encodeURIComponent(folder)}/`;
            try {
                const man = await (await fetch(`${base}manifest.json`)).json();
                if (!man?.js) return;
                // 확장 판이 같으면 지난번 결과를 씀(큰 확장은 파일이 수백 개라 매번 다 읽으면 느림)
                const cacheKey = `${folder}@${man.version || ''}`;
                let cache = {};
                try { cache = JSON.parse(localStorage.getItem('etk-signal-scan') || '{}'); } catch { /* 없음 */ }
                let names;
                if (Array.isArray(cache[cacheKey])) names = new Set(cache[cacheKey]);
                else {
                    names = new Set();
                    // 그 확장 폴더 안에서 불러오는 파일을 끝까지 따라감(몇 단계에서 멈추면, 기능 파일을 수백 개로 나눠 묶는 확장의 안쪽 신호를 못 찾음)
                    const root = new URL(base, location.origin).pathname, seenUrl = new Set();
                    const sub = (code, from) => [...code.matchAll(/['"](\.{1,2}\/[^'"\s]+\.js)['"]/g)].map(m => new URL(m[1], location.origin + from).pathname).filter(u => u.startsWith(root) && !seenUrl.has(u) && seenUrl.add(u));
                    let level = [new URL(base + man.js, location.origin).pathname];
                    seenUrl.add(level[0]);
                    while (level.length && seenUrl.size <= 800) {
                        const next = [];
                        for (let i = 0; i < level.length; i += 24) {   // 한 번에 24개씩 받아 서버에 몰리지 않게
                            await Promise.all(level.slice(i, i + 24).map(async u => { try { const code = await (await fetch(u)).text(); grab(code, names); next.push(...sub(code, u)); } catch { /* 없음 */ } }));
                        }
                        level = next;
                    }
                    // 확장 여러 개를 한꺼번에 읽으므로 적기 직전에 다시 읽어 그 확장 칸만 더함 — 처음 읽어 둔 것에 적으면 먼저 끝난 확장의 결과를 지웠음(다음에 또 다 읽음). 옛 판 칸은 지움
                    try { let now = {}; try { now = JSON.parse(localStorage.getItem('etk-signal-scan') || '{}'); } catch { /* 없음 */ } for (const k of Object.keys(now)) if (k.startsWith(`${folder}@`)) delete now[k]; now[cacheKey] = [...names]; localStorage.setItem('etk-signal-scan', JSON.stringify(now)); } catch { /* 저장 못 함 */ }
                }
                // 같은 신호를 여러 확장이 내기도 함(번역 신호를 다른 번역 확장도 그대로 냄) — 확장들을 모두 적어 둠
                for (const n of names) found.set(n, [...new Set([...(found.get(n) || '').split('|').filter(Boolean), folder])].sort().join('|'));
            } catch { /* 못 읽음 */ }
        }));
        return found;
    })();
    return scanned;
}

// 여러 확장이 같은 신호를 내면 이름을 함께(가운뎃점으로 이어서)
const folderLabel = async (folders) => (await Promise.all(String(folders).split('|').filter(Boolean).map(extensionName))).join(' · ');

function extensionName(folder) {
    if (!folder) return Promise.resolve('');
    if (!extNames.has(folder)) extNames.set(folder, fetch(`/scripts/extensions/third-party/${encodeURIComponent(folder)}/manifest.json`).then(r => (r.ok ? r.json() : null)).then(m => m?.display_name || folder).catch(() => folder));
    return extNames.get(folder);
}

export function start(a) {
    api = a;
    watchSignals();
    // 깔린 확장의 ‘일 끝남’ 신호를 한가할 때 찾아 저절로 들음(찾은 결과는 확장 판이 같으면 기억해 둔 것을 씀)
    (window.requestIdleCallback || setTimeout)(() => scanSignals().then(m => { autoSignals = m; if (api) listenSignals(); }));
    const { eventSource, eventTypes: ev } = a.ctx();
    wrapFetch();
    // 답이 실제로 끝났을 때만 울림. ‘생성 끝’(GENERATION_ENDED) 신호는 실리태번이 멈춤 버튼을 숨길 때 나와서 믿지 않는다:
    //   · 본문 도중 다른 생성이 버튼을 먼저 숨기면 진짜 끝엔 안 나옴
    //   · 다른 확장이 생성을 뒤로 넘기며 입력창을 풀어 주면 답이 오기 전에 나옴(보내자마자 울렸음)
    // 본문(보내기 · 스와이프 · 다시 생성 · 이어 쓰기)은 답이 다 그려졌다는 신호로, 대신 쓰기는 채팅에 그리지 않으니 끝 신호로,
    // 조용한 생성(/gen 등)은 끝 신호 뒤 걸려 있는 생성 요청이 다 끝나고 이어지는 생성이 없을 때 울린다(요청이 실패 · 취소면 안 울림).
    // 멈춤 신호 중 번호가 붙은 것은 스크립트 확장이 자기 생성을 멈춘 것이라 지금 답과 상관없다.
    const MAIN = new Set(['normal', 'swipe', 'regenerate', 'continue', 'impersonate']);
    const RENDER = new Set(['normal', 'swipe', 'regenerate', 'continue']);
    const main = { active: false, type: '', stopped: false };
    const quiet = { active: false, stopped: false, token: 0 };
    const resetMain = () => { main.active = false; main.type = ''; main.stopped = false; };
    busy = () => main.active || quiet.active || quiet.waiting;
    genBusy = () => main.active || quiet.active;
    const settle = () => { if (!busy()) keepAlive(false); };
    const on = (name, fn) => { if (name) { eventSource.on(name, fn); listeners.push([name, fn]); } };
    if (document.getElementById('preloader')) on(ev.APP_READY, () => { appReadyAt = Date.now(); }); else appReadyAt = Date.now();
    on(ev.GENERATION_STARTED, (t, _o, dryRun) => {
        if (dryRun) return;
        const type = String(t || 'normal');
        if (MAIN.has(type)) { main.active = true; main.type = type; main.stopped = false; }
        else { quiet.token++; quiet.active = true; quiet.stopped = false; }
        keepAlive(true);
    });
    on(ev.GENERATION_STOPPED, (id) => {
        if (id !== undefined && id !== null) return;
        if (main.active) main.stopped = true;
        if (quiet.active) quiet.stopped = true;
        log('멈춤 — 이번 생성은 안 울림');
        settle();
    });
    on(ev.CHARACTER_MESSAGE_RENDERED, (_id, type) => {
        if (!RENDER.has(String(type))) return;
        const stopped = main.active && main.stopped;
        resetMain();
        // 채팅을 옮겨 뒤에서 마저 받은 답이 나중에 붙을 때도 이 신호가 와서 울림
        if (stopped) log('멈춘 메시지라 안 울림'); else notify(`메시지 다 그림(${type})`);
        settle();
    });
    // 기다리는 일은 따로 돌린다 — 신호를 낸 쪽이 처리기를 기다리면(await emit) 그동안 같이 멈추므로
    on(ev.GENERATION_ENDED, () => {
        if (main.active) {
            if (main.type === 'impersonate') { const stopped = main.stopped; resetMain(); if (!stopped) notify('대신 쓰기 끝'); settle(); return; }
            // 오류로 답이 안 그려지면 그리기 신호가 끝내 안 오니, 요청이 다 끝났는데도 그대로면 기다림을 접음(깨워 두던 소리도 멈춤)
            const was = main.type;
            setTimeout(() => { if (main.active && main.type === was && pendingGen === 0) { resetMain(); settle(); } }, 5000);
            return;
        }
        if (!quiet.active) return;
        quiet.active = false;
        if (quiet.stopped) { settle(); return; }
        const token = quiet.token;
        quiet.waiting = true;
        void (async () => {
            const end = Date.now() + 30 * 60 * 1000;
            while (pendingGen > 0 && quiet.token === token && Date.now() < end) await sleep(500);
            await sleep(1200);   // 스크립트가 바로 다음 생성을 이어 하는지
            if (quiet.token !== token) return log('이어서 다른 생성 — 기다림 넘김');
            quiet.waiting = false;
            if (['error', 'aborted'].includes(lastGen)) log(`조용한 생성 요청 ${lastGen} — 안 울림`);
            else notify('조용한 생성 끝');
            settle();
        })();
    });
    on(ev.CHAT_CHANGED, () => { resetMain(); chatOpenedAt = Date.now(); settle(); });
    for (const t of ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown']) document.addEventListener(t, unlock, { capture: true, passive: true });
    listenSignals();
    if (!origPlay) {
        origPlay = HTMLMediaElement.prototype.play;
        myPlay = HTMLMediaElement.prototype.play = function () {
            if (!ours && this.tagName === 'AUDIO') lastOtherPlay = Date.now();
            return origPlay.apply(this, arguments);
        };
    }
}

export function stop() {
    stopFinding?.();
    unwatchSignals?.();
    const { eventSource } = api.ctx();
    for (const [n, fn] of listeners) eventSource.removeListener?.(n, fn);
    for (const [n, fn] of docListeners) { eventSource.removeListener?.(n, fn); document.removeEventListener(n, fn); }
    listeners = []; docListeners = [];
    // 우리 뒤에 다른 확장이 또 감쌌으면 그쪽 것을 지우지 않게 그대로 둠(시각만 적는 감싸개라 남아도 하는 일 없음)
    if (origPlay && HTMLMediaElement.prototype.play === myPlay) { HTMLMediaElement.prototype.play = origPlay; origPlay = null; myPlay = null; }
    for (const t of ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown']) document.removeEventListener(t, unlock, { capture: true });
    keepAudio?.pause(); busy = () => false;
    unwrapFetch();
}

export function options(box, a) {
    api ??= a;
    const o = a.options();
    o.tone ??= 'chime';
    mySounds();
    o.toneFor ??= {};
    const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    // 소리 고르는 칸의 선택지: 소리 넷 + 내 소리(알림마다 같은 목록)
    const toneOptions = () => Object.entries(TONES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')
        + mySounds().map(x => `<option value="file:${esc(x.url)}">${esc(x.name)}</option>`).join('');
    box.innerHTML = `
        <div class="etk-form">
            <label>크기</label><input type="range" min="0" max="1" step="0.05" data-k="volume">
        </div>
        ${isIOS() ? '' : `<label class="checkbox_label" title="실리태번 탭을 보고 있을 땐 안 울리고, 다른 탭 · 다른 앱을 보거나 창을 내려 두었을 때만 울려요"><input type="checkbox" data-k="onlyHidden"><span>실리태번을 안 보고 있을 때만 울리기</span></label>
        <label class="checkbox_label" title="휴대폰은 화면을 끄면 페이지 소리를 멈춰서 알림이 안 날 수 있어요. 메시지를 만드는 동안 들리지 않는 소리를 틀어 두어 페이지가 잠들지 않게 해요"><input type="checkbox" data-k="keepAlive"><span>휴대폰 화면을 꺼도 알림 받기</span></label>`}
        <div class="etk-sub">알림음</div>
        <div class="etk-tone-chips"></div>
        <div class="etk-sound-list"></div>
        <div class="menu_button etk-sound-pick"><i class="fa-solid fa-plus"></i> 알림음 파일 올리기</div>
        <div class="etk-sub">알림 설정</div>
        <small>체크한 일이 끝나면 오른쪽에서 고른 알림음이 울려요.</small>
        <div class="etk-sig-main"></div>
        <div class="etk-sub">다른 확장이 일을 끝낼 때도 알리기</div>
        <div class="etk-sig-list"><div class="etk-signals"></div></div>`;
    const f = k => box.querySelector(`[data-k="${k}"]`);
    // 알림 한 줄: 체크칸 + 이름 + 소리 칸
    const sigRow = (key, label, { fixed = false, ai = false } = {}) => {
        const row = document.createElement('div');
        row.className = 'etk-flex etk-sig-row';
        row.innerHTML = `<label class="checkbox_label"><input type="checkbox"><span></span></label><select class="text_pole etk-sig-tone" title="이 알림의 알림음">${toneOptions()}</select>`;
        row.querySelector('span').textContent = label;
        const cb = row.querySelector('input');
        if (fixed) { cb.checked = true; cb.disabled = true; cb.title = '이 알림은 이 기능을 끄면 꺼져요'; }
        else {
            if (ai) {
                const folder = key.slice(0, -3);
                cb.checked = (o.aiOn || []).includes(folder);
                cb.addEventListener('change', () => { const on = (o.aiOn || []).filter(k => k !== folder); o.aiOn = cb.checked ? [...on, folder] : on; a.save(); });
            } else {
                cb.checked = !(o.otherOff || []).includes(key);
                cb.addEventListener('change', () => { const off = (o.otherOff || []).filter(k => k !== key); o.otherOff = cb.checked ? off : [...off, key]; a.save(); listenSignals(); });
            }
        }
        const sel = row.querySelector('select');
        sel.value = toneOf(key);
        if (sel.value !== toneOf(key)) sel.value = 'chime';   // 지운 소리를 가리키면 첫 소리
        sel.addEventListener('change', () => { o.toneFor[key] = sel.value; a.save(); beep(sel.value); });
        return row;
    };
    const drawMain = () => { const m = box.querySelector('.etk-sig-main'); m.replaceChildren(sigRow('main', '메시지 생성이 끝날 때', { fixed: true })); };
    const drawSounds = () => {
        const list = box.querySelector('.etk-sound-list');
        list.innerHTML = '';
        // 기본 알림음은 한 줄에 작은 ▶ 칩으로(한 줄씩 두면 칸을 너무 차지했음), 아래 목록엔 올린 파일만
        const chips = box.querySelector('.etk-tone-chips');
        chips.innerHTML = '';
        for (const [k, v] of Object.entries(TONES)) {
            const c = document.createElement('div');
            c.className = 'menu_button etk-tone-chip';
            c.title = '듣기';
            c.innerHTML = '<i class="fa-solid fa-play"></i><span></span>';
            c.querySelector('span').textContent = v.name;
            c.addEventListener('click', () => beep(k));
            chips.append(c);
        }
        list.hidden = !mySounds().length;
        for (const x of mySounds()) {
            const row = document.createElement('div');
            row.className = 'etk-flex etk-sound-row';
            row.innerHTML = '<span></span><div class="menu_button etk-sound-play" title="듣기"><i class="fa-solid fa-play"></i></div><div class="menu_button etk-sound-del" title="지우기"><i class="fa-solid fa-trash-can"></i></div>';
            row.querySelector('span').textContent = x.name;
            row.querySelector('.etk-sound-play').addEventListener('click', () => beep(`file:${x.url}`));
            row.querySelector('.etk-sound-del').addEventListener('click', async () => {
                const v = `file:${x.url}`;
                o.sounds = mySounds().filter(y => y !== x);
                // 이 소리를 쓰던 알림은 첫 소리로
                for (const k of Object.keys(o.toneFor)) if (o.toneFor[k] === v) delete o.toneFor[k];
                if (o.tone === v) o.tone = 'chime';
                a.save();
                const c = SillyTavern.getContext();
                fetch('/api/files/delete', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ path: x.url.replace(/^\//, '') }) }).catch(() => {});
                redrawAll();
            });
            list.append(row);
        }
    };
    const show = () => {
        f('volume').value = o.volume ?? 0.5;
        if (f('onlyHidden')) f('onlyHidden').checked = !!o.onlyHidden;
        if (f('keepAlive')) f('keepAlive').checked = o.keepAlive !== false;
    };
    show();
    f('volume').addEventListener('input', e => { o.volume = Number(e.target.value); a.save(); });
    f('onlyHidden')?.addEventListener('change', e => { o.onlyHidden = e.target.checked; a.save(); });
    f('keepAlive')?.addEventListener('change', e => { o.keepAlive = e.target.checked; a.save(); if (!o.keepAlive) keepAudio?.pause(); });
    const host = box.querySelector('.etk-signals');
    let scanning = true;
    const drawSignals = async () => {
        if (!host.isConnected) { redrawSeen = null; return; }
        const pairs = new Map();   // ‘확장 · 하는 일’ → 같은 글은 한 번
        // 같은 신호 이름이 여러 확장 코드에 있으면(한 확장이 다른 확장의 기능을 통째로 담은 경우 — 그 기능을 꺼 둬도 코드는 있음),
        // 실제로 그 신호를 낸 적이 있는 확장만 보임. 한 확장에만 있는 신호는 그대로
        for (const [n, folders] of autoSignals) {
            const j = jobOf(n); if (!j) continue;
            const list = folders.split('|');
            for (const folder of list) if (list.length < 2 || (o.confirmed || []).includes(`${folder}#${n}`)) pairs.set(`${folder}#${j}`, [folder, j]);
        }
        for (const [n, info] of seen) { const j = jobOf(n); if (j && info.from && !NOT_DONE.test(n) && DONE_WORD.test(n)) pairs.set(`${info.from}#${j}`, [info.from, j]); }
        if (!pairs.size && !(o.aiSeen || []).length) { host.innerHTML = scanning ? '<small>깔린 확장에서 찾는 중…</small>' : ''; return; }
        const rows = await Promise.all([...pairs].map(async ([key, [folder, j]]) => [key, `${await extensionName(folder)}: ${j}이 끝날 때`]));
        if (!host.isConnected) return;
        // 자기 끝 신호를 내는 확장은 그 신호 줄이 같은 일(번역 요청 끝 = 번역 끝)을 알려서 'AI 요청' 줄은 뺌. 이미 켜 둔 줄은 끌 수 있게 남김
        const hasOwn = new Set([...pairs.values()].map(([folder]) => folder));
        const aiRows = await Promise.all((o.aiSeen || []).filter(folder => !hasOwn.has(folder) || (o.aiOn || []).includes(folder)).map(async folder => [`${folder}#ai`, `${await extensionName(folder)}: AI 요청이 끝날 때`]));
        if (!host.isConnected) return;
        host.replaceChildren(...rows.sort((x, y) => x[1].localeCompare(y[1])).map(([key, label]) => sigRow(key, label)),
            ...aiRows.sort((x, y) => x[1].localeCompare(y[1])).map(([key, label]) => sigRow(key, label, { ai: true })));
    };
    const redrawAll = () => { show(); drawSounds(); drawMain(); drawSignals(); };
    drawSounds(); drawMain(); drawSignals();
    redrawSeen = drawSignals;
    scanSignals().then(m => { autoSignals = m; scanning = false; listenSignals(); drawSignals(); });
    // 여러 파일을 한 번에 고를 수 있음. 3MB 넘는 파일은 빼고 알림
    box.querySelector('.etk-sound-pick').addEventListener('click', async () => {
        const files = await pickFiles('audio/*');
        if (!files.length) return;
        const big = files.filter(x => x.size > 3 * 1024 * 1024);
        if (big.length) toastr.warning(`3MB가 넘어서 뺐어요: ${big.map(x => x.name).join(', ')}`);
        let last = null;
        for (const [n, file] of files.filter(x => !big.includes(x)).entries()) {
            try {
                // 올릴 때마다 새 이름(같은 이름에 덮으면 먼저 올린 알림음이 사라짐). 목록엔 원래 파일 이름
                const url = await saveUserFile(`breeze-sound-${Date.now().toString(36)}${n}.${extOf(file)}`, file);
                mySounds().push({ name: file.name, url });
                last = url;
            } catch (err) { toastr.error(`${file.name}: ${String(err.message || err)}`); }
        }
        a.save(); redrawAll();
        if (last) beep(`file:${last}`);
    });

}
