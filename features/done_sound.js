import { gate } from '../translator/gates.js';
import { fromStack } from '../lib/who.js';
// 답 · 번역이 끝나면 소리로 알리기.
// 답 생성이 끝났을 때, 그리고 ‘답 말고도 알릴 때’에 등록해 둔 다른 확장의 끝남 신호(번역 완료 등)가 왔을 때 짧은 소리를 낸다.
// 신호마다 알아볼 이름을 붙여 체크칸으로 켜고 끈다(옵션 signals = [{ name, event, on }]).
// 어떤 신호가 있는지는 기능이 켜져 있는 동안 저절로 모은다: 다른 확장이 신호를 낼 때 그 이름 · 횟수 · 낸 확장(파일 주소의 third-party/폴더)을
// 메모리에 적어 두고(신호마다 한 줄 거쳐 감 — 지켜보는 일은 없음), 세부 설정에서 ‘최근에 다른 확장이 낸 신호’로 보여 준다. 실리태번 자체 신호는 뺌.
// 기본 소리는 브라우저가 직접 만드는 음이라 따로 받을 파일이 없고, 내 소리 파일을 고르면 그 파일을 쓴다(user/files 에 저장).
// 다른 쪽이 이미 알림 소리를 내면 쉰다: 실리태번의 ‘메시지 소리’가 켜져 있거나, 끝난 직후 잠깐 사이에 다른 코드가 소리를 틀었으면 내지 않는다
// (소리 재생을 한 줄 거쳐 가게 해 ‘방금 누가 틀었는지’ 시각만 적어 둠 — 지켜보는 일은 없음).
// 오류 알림음: 답 요청이 실패하거나(429 · 500 같은 오류 응답, 연결 끊김) 빨간 오류 알림이 뜨면 따로 고른 소리(기본은 낮게 두 번).
// 실리태번 메시지 소리는 오류엔 안 울려서 그게 켜져 있어도 울림. 요청 실패와 그 오류 알림이 같이 와도 한 번만(잠깐 사이 겹친 소리는 건너뜀).
// 왜 울렸는지 · 안 울렸는지는 콘솔 디버그에 ‘[Breeze] 완료 소리: …’로 남긴다.
import { saveUserFile, pickFiles, extOf } from '../lib/files.js';

// 기본 소리: notes = [주파수, 시작 초, (있으면) 미끄러져 닿을 주파수] 들.
// 얌전한 소리는 같은 방식에 세 가지만 더함: attack(소리가 차오르는 초, 길수록 부드럽게 시작) · len(꼬리가 사라질 때까지의 초) · gain(음이 겹쳐 울릴 때 음마다 줄일 크기)
// 이 확장의 폴더 이름(설치한 주소에 따라 달라짐)
const OWN = decodeURIComponent(import.meta.url.match(/\/third-party\/([^/]+)\//)?.[1] || 'breeze');
const TONES = {
    chime: { name: '맑은 두 음', notes: [[880, 0], [1320, 0.13]] },
    single: { name: '짧은 한 음', notes: [[1047, 0]] },
    soft: { name: '낮은 두 음', notes: [[523, 0], [659, 0.15]] },
    rise: { name: '올라가는 세 음', notes: [[659, 0], [880, 0.12], [1175, 0.24]] },
    low2: { name: '낮게 두 번', notes: [[392, 0], [392, 0.18]] },
    dull: { name: '둔탁하게 내려감', notes: [[330, 0], [262, 0.16]] },
    hum: { name: '낮고 길게 한 음', notes: [[294, 0]], attack: 0.09, len: 1.1 },
    drop: { name: '물방울', notes: [[660, 0, 1320]], attack: 0.008, len: 0.2 },
    wood: { name: '나무 두드림', notes: [[784, 0], [784, 0.15]], attack: 0.004, len: 0.07 },
    chord: { name: '잔잔한 화음', notes: [[392, 0], [494, 0.06], [587, 0.12]], attack: 0.07, len: 1.3, gain: 0.5 },
};
let myPlay = null;
let lastOtherStack = '';
// live = 기능이 켜져 있는지. 끌 때 되돌리지 못하는 것(우리 뒤에 다른 코드가 또 감싼 요청 함수, 이미 기다리던 일)이 꺼진 뒤에 소리를 내지 않게 본다
let live = false;
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
const toneOf = (key) => (key && api.options().toneFor?.[key]) || (key === 'error' ? 'low2' : api.options().tone);
// 실제 크기 = 전체 크기(volume) × 그 알림의 크기(volumeFor[알림 열쇠], 0~1, 없으면 1)
const unit = (v, base) => { const n = Number(v ?? base); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : base; };
const volumeOf = (key) => unit(api.options().volume, 0.5) * unit(key ? api.options().volumeFor?.[key] : 1, 1);
function beep(tone, key = '') {
    const o = api.options();
    mySounds();
    tone ??= o.tone;
    const volume = volumeOf(key);
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
    const def = TONES[tone] || TONES[o.tone] || TONES.chime;
    const attack = def.attack ?? 0.02, len = def.len ?? 0.25;
    // 휴대폰은 노래와 섞여 울리면 묻혀서 더 크게(컴퓨터의 3배까지)
    const peak = volume * (isPhone() ? 0.9 : 0.3) * (def.gain ?? 1);
    const t0 = ctxAudio.currentTime;
    for (const [freq, at, slideTo] of def.notes) {
        const osc = ctxAudio.createOscillator(), gain = ctxAudio.createGain(), from = t0 + at;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, from);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, from + len * 0.4);
        gain.gain.setValueAtTime(0, from);
        gain.gain.linearRampToValueAtTime(peak, from + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, from + len);
        osc.connect(gain).connect(ctxAudio.destination);
        osc.start(from);
        osc.stop(from + len + 0.02);
    }
}

// 같은 일을 두 신호가 알릴 때(답이 그려짐 + 다른 확장의 ‘답 붙음’) 한 번만
const COOLDOWN = 1500;
const SOUND_CORE = { saw: "실리태번 설정의 '메시지 소리'가 켜져 있어요", who: { kind: 'core' }, back: '실리태번의 메시지 소리를 끄면 breeze가 울려요.' };
let lastBeep = 0;
// every = 방금 울렸어도 건너뛰지 않음(요청마다 따로 끝나는 일)
function notify(why = '', key = 'main', every = false) {
    if (!live) return;
    if (api.ctx().powerUserSettings?.play_message_sound) { api.rest('same', SOUND_CORE); return; }   // 실리태번이 직접 냄
    // 아이폰에서 노래와 섞어 울릴 땐 다른 탭에선 소리를 못 내서 이 칸은 안 씀(켜 두면 아예 안 울림)
    if (api.options().onlyHidden && !quietIOS() && document.visibilityState === 'visible' && document.hasFocus()) return;
    const at = Date.now();
    if (!every && at - lastBeep < COOLDOWN) { log(`${why} — 방금 울려서 건너뜀`); return; }
    lastBeep = at;
    log(why);
    // 다른 확장이 같은 순간에 소리를 내는지 잠깐 보고
    setTimeout(() => {
        if (lastOtherPlay < at - 300) { api.rest(null); beep(toneOf(key), key); return; }
        api.rest('same', { saw: '답이 끝난 순간 다른 쪽이 이미 소리를 냈어요', who: fromStack(lastOtherStack), back: '그쪽 소리가 멈추면 다음 답부터 breeze가 울려요.' });
    }, 250);
}
const log = (why) => { if (why) console.debug(`[Breeze] 완료 소리: ${why}`); };
function notifyError(why) {
    if (!live || !api || (api.options().otherOff || []).includes('error')) return;
    if (api.options().onlyHidden && !quietIOS() && document.visibilityState === 'visible' && document.hasFocus()) return;
    const at = Date.now();
    if (at - lastError < 4000) return;   // 요청 실패 · 그 오류 알림 · 다시 시도가 잇따라 와도 한 번
    lastError = at; lastBeep = at;
    log(`오류: ${why}`);
    beep(toneOf('error'), 'error');
}
let lastError = 0, toastWatch = null;
// 빨간 오류 알림이 뜨는지: 알림 상자(#toast-container, 알림이 하나도 없으면 사라졌다가 다음 알림 때 다시 생김)에 붙는 것만 봄.
// 상자는 첫 알림을 품은 채로 생겨서, 상자를 잡은 뒤부터만 보면 그 첫 알림을 놓침 → 새로 생긴 상자는 이미 든 오류 알림도 한 번 봄
const toastError = (n) => { if (n.nodeType === 1 && n.classList.contains('toast-error')) notifyError(`오류 알림: ${(n.querySelector('.toast-title')?.textContent || n.textContent || '').trim().slice(0, 40)}`); };
function watchErrorToasts() {
    const inner = new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(toastError); });
    let box = null;
    // created = 지켜보는 동안 새로 생긴 상자(기능을 켜는 순간 이미 떠 있던 알림은 지난 일이라 안 봄)
    const hook = (created) => {
        const b = document.getElementById('toast-container');
        if (!b || b === box) return;
        box = b; inner.disconnect(); inner.observe(b, { childList: true });
        if (created) [...b.children].forEach(toastError);
    };
    const outer = new MutationObserver(() => hook(true));
    outer.observe(document.body, { childList: true });
    hook(false);
    toastWatch = () => { inner.disconnect(); outer.disconnect(); };
}

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
// 앞 신호에서 넘긴 일(가져온 번역 · 전체 번역의 한 메시지)도 뒤 신호로 울렸고, 저장이 1.5초를 넘기면 같은 일에 두 번 울렸음 → 낸 쪽과 메시지 번호가 같으면 한 일로 묶음.
// 묶는 기준은 시간이 아니라 신호 이름: 그 일을 먼저 알린 신호와 이름이 다르면 같은 일의 뒤 신호라 넘기고(짝이 끝났으니 적어 둔 것도 지움),
// 이름이 같으면 그 메시지에 새로 한 일이다(가져온 번역 · 멈춘 번역 뒤에 다시 번역하면 울려야 함). 넘긴 앞 신호도 '먼저 알린 신호'로는 적어 둠: 그 뒤 신호가 울리지 않게
const firstSignal = new Map();   // '낸 쪽#메시지 번호' → 그 일을 먼저 알린 신호 이름
const jobKey = (detail) => { const d = detail?.detail ?? detail; const i = Number(d?.messageId ?? d?.index); return Number.isInteger(i) ? i : null; };
function isSecondSignal(first, key, name) {
    const before = first.get(key);
    if (before !== undefined && before !== name) { first.delete(key); return true; }
    first.set(key, name);
    return false;
}
function onSignal(name, who, detail, toneKey = null) {
    if (!live) return;
    const id = jobKey(detail);
    if (id !== null && isSecondSignal(firstSignal, `${who}#${id}`, name)) return;
    if (isFreshDone(detail) && !finishedBeforeOpen(detail)) notify('다른 확장의 끝남 신호', toneKey);
}

// 생성 요청이 실제로 끝났는지: 실리태번이 보낸 생성 요청(주소에 generate)이 몇 개 걸려 있고 마지막 것이 어떻게 끝났는지만 적어 둠.
// 다른 확장이 생성을 뒤로 넘겨 ‘생성 끝’ 신호가 먼저 와도(입력창만 먼저 풀어 줌), 실리태번의 요청은 진짜 답이 올 때까지 걸려 있다.
const GEN = /^\/api\/.*generate/;
let genBusy = () => false;
// 확장이 보낸 AI 요청: 답이 다 오면(이어 받는 답은 끝까지) 요청 하나가 끝날 때마다 울림. 같은 확장이 여러 개를 동시에 보냈으면 걸린 요청이 0이 되는 마지막 것에서 한 번.
// (끝난 뒤 한동안 다음 요청이 없기를 기다렸다 울리면, 요청을 하나씩 차례로 보내는 확장은 맨 끝에만 울렸음)
// 목록엔 요청을 한 번이라도 보낸 확장만(aiSeen) 오르고, 체크해 둔 확장(aiOn)만 울림 — 번역처럼 따로 끝 신호를 내는 확장과 겹치지 않게 기본은 꺼 둠
const extPending = new Map();   // 확장 폴더 → 진행 중 요청 수(보낼 때 세고, 끝 · 실패 · 끊김에 내림)
const extRequestStarted = (folder) => extPending.set(folder, (extPending.get(folder) || 0) + 1);
// how: 'done'(답이 다 옴) · 'error'(200 으로 온 답의 내용이 오류) · 'cut'(실패 응답 · 연결 끊김 · 멈춤 · 답을 읽다 끊김)
function extRequestEnded(folder, how) {
    const n = Math.max(0, (extPending.get(folder) || 1) - 1);
    extPending.set(folder, n);
    if (!live || !api) return;
    if (how === 'error') { notifyError(`${folder} AI 요청의 답이 오류`); return; }
    if (how !== 'done' || n > 0 || !(api.options().aiOn || []).includes(folder)) return;
    // 차례로 보낸 요청은 1.5초 안에 잇따라 끝나기도 해서, 이 길은 '방금 울렸으면 건너뜀'을 타지 않음
    notify(`${folder} AI 요청 끝`, `${folder}#ai`, true);
}
function noteAiSender(folder) {
    const o = api.options();
    o.aiSeen ??= [];
    if (!o.aiSeen.includes(folder)) { o.aiSeen.push(folder); api.save(); redrawSeen?.(); }
}
// 답 내용이 오류인지: 서버가 오류를 200 응답의 JSON({ error: … })으로 돌려주기도 함. 이어 받는 답(JSON 이 아님)은 해당 없음
function bodySaysError(res, data) {
    if (!/json/i.test(res.headers.get('content-type') || '')) return false;
    try { return !!JSON.parse(new TextDecoder().decode(data))?.error; } catch { return false; }
}
// 답을 끝까지 읽은 뒤에 끝난 것으로 봄. 읽다가 끊기면(멈춤 · 중간 끊김) 끝난 게 아님
function extResponseArrived(folder, res) {
    if (live && api) noteAiSender(folder);
    res.arrayBuffer().then(data => extRequestEnded(folder, bodySaysError(res, data) ? 'error' : 'done'), () => extRequestEnded(folder, 'cut'));
}
// 요청을 보낸 확장 찾기(호출 기록에서).
//  · 기록은 기본 10줄에서 잘림: 요청 함수(fetch)를 감싸 둔 확장이 몇 개 끼고 실리태번의 연결 프로필 요청 함수를 거치면, 정작 보낸 확장은 10줄 밖이라
//    안 보였다 → 체크해 둔 확장은 안 울리고, 대신 감싸 둔 확장이 '보낸 확장'으로 잘못 적혔다. 이때만 기록 길이를 늘려 읽음.
//  · 요청 함수를 감싸 둔 확장은 보낸 쪽이 아님: 실리태번이 스스로 보내는 생성 요청에도 늘 끼어 있는 확장을 그런 확장으로 기억해 두고 뺌
//    (실리태번 코드보다 요청 쪽에 가까이 있는 확장 줄 = 감싼 확장).
const fetchWrappers = new Set();
function requesterOf(coreBusy) {
    const keep = Error.stackTraceLimit;
    let lines = [];
    try { Error.stackTraceLimit = 80; lines = (new Error().stack || '').split('\n').slice(1); } finally { Error.stackTraceLimit = keep; }
    const frames = lines.map(l => { const m = l.match(/\/third-party\/([^/]+)\//); return m ? decodeURIComponent(m[1]) : (/\/(scripts\/|script\.js|lib\.js)/.test(l) ? ':core' : ''); });
    const firstCore = frames.indexOf(':core');
    const inner = (firstCore < 0 ? [] : frames.slice(0, firstCore)).filter(f => f && f !== ':core' && f !== OWN);          // 실리태번 코드보다 요청 쪽에 가까운 확장들
    const outer = (firstCore < 0 ? frames : frames.slice(firstCore)).filter(f => f && f !== ':core' && f !== OWN);        // 실리태번 코드를 부른 쪽 확장들
    // 실리태번을 거친 요청(생성 중이거나, 부른 확장이 따로 있음): 요청 쪽에 가까이 낀 확장은 감싼 확장
    if (firstCore >= 0 && (coreBusy || outer.length)) for (const f of inner) fetchWrappers.add(f);
    if (coreBusy) return '';
    if (outer.length) return outer[outer.length - 1];                                    // 맨 바깥 = 보낸 확장
    return [...inner].reverse().find(f => !fetchWrappers.has(f)) || '';                   // 실리태번을 안 거치고 직접 보낸 확장(감싼 확장은 뺌)
}
let pendingGen = 0, lastGen = '', origFetch = null, wrappedFetch = null;
function wrapFetch() {
    if (wrappedFetch) return;
    origFetch = window.fetch;
    wrappedFetch = async function (input) {
        // 기능을 끈 뒤에도 불릴 수 있음(우리 뒤에 다른 코드가 또 감싸서 되돌리지 못한 때) → 그냥 지나가게만
        if (!live) return origFetch.apply(this, arguments);
        const url = typeof input === 'string' ? input : input?.url || '';
        if (!GEN.test(url.replace(/^https?:\/\/[^/]+/, '').split('?')[0])) return origFetch.apply(this, arguments);
        // 확장이 직접 보낸 AI 요청(실리태번 생성 중이 아닐 때, 부른 코드가 그 확장 파일): 요청이 끝나면 그 확장 줄로 알림
        const ext = requesterOf(genBusy());
        pendingGen++;
        if (ext) extRequestStarted(ext);
        try {
            const res = await origFetch.apply(this, arguments);
            lastGen = res.ok ? 'done' : 'error';
            if (!res.ok) notifyError(`요청 실패 ${res.status}`);
            if (ext && res.ok) extResponseArrived(ext, res.clone()); else if (ext) extRequestEnded(ext, 'cut');
            return res;
        } catch (e) {
            lastGen = e?.name === 'AbortError' ? 'aborted' : 'error';
            if (lastGen === 'error') notifyError('요청 연결 끊김');
            if (ext) extRequestEnded(ext, 'cut');
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
// breeze 안에 든 번역 기능이 낸 신호: 폴더가 breeze 라 '낸 확장 없음'으로 잡혀, 목록에서 끌 수 없는 채 늘 울렸음 → 따로 표시(확장 폴더 이름이 될 수 없는 글자로)
const OWN_PART = ':translator';
const OWN_SIGNALS = ['EXTENSION_LLM_TRANSLATE_DONE'];   // 그 번역 기능의 '번역 끝' 신호(다른 확장이 같은 이름을 안 써도 듣게)
const OWN_PART_DIRS = ['translator'];   // 그 번역 기능의 파일이 든 폴더들
const fromOwnPart = (stack) => [OWN, encodeURIComponent(OWN)].some(own => OWN_PART_DIRS.some(dir => stack.includes(`/${own}/${dir}/`)));
const ownPartOn = () => { try { return !!globalThis[Symbol.for('breeze.api')]?.isOn?.('translator'); } catch { return false; } };
const partName = async (folder) => (folder === OWN_PART ? 'breeze 번역' : extensionName(folder));
// 신호를 낸 확장 폴더(호출 기록에서 breeze · 신호 보내기를 감싼 칸은 건너뜀)
const emitterOf = () => { const stack = new Error().stack || ''; return stack.split('\n').filter(l => !/at (?:\S+\.)?(?:emit|dispatchEvent) \(/.test(l)).map(l => l.match(/\/third-party\/([^/]+)\//)?.[1]).filter(Boolean).map(decodeURIComponent).find(f => f !== OWN) || (fromOwnPart(stack) ? OWN_PART : ''); };
// 신호를 낸 확장은 내는 순간에 적어 둔다. 듣는 쪽에서 호출 기록으로 찾으면, 신호 통로가 앞선 듣는 쪽을 기다린(await) 뒤에 우리를 부를 때
// 기록이 끊겨 낸 확장을 못 찾았고, 그래서 꺼 둔 '확장#하는 일' 줄을 가리지 못해 울렸음.
// 신호에 실린 객체(화면 신호는 그 신호 객체)를 열쇠로 적고, 객체가 안 실린 신호는 신호 이름마다 낸 차례대로 줄을 세워 듣는 쪽이 앞에서부터 꺼냄(시간으로 어림하지 않음)
const emitterByObject = new WeakMap();   // 신호에 실린 객체 → 낸 확장
const emitterInOrder = new Map();        // 신호 이름 → 낸 확장들(낸 차례)
const heardNames = new Set();            // 지금 듣고 있는 신호 이름(이것만 적음)
const isObject = (v) => (typeof v === 'object' && v !== null) || typeof v === 'function';
function markEmitter(name, carried) {
    if (!heardNames.has(name)) return;
    const who = emitterOf();
    if (isObject(carried)) { emitterByObject.set(carried, who); return; }
    const line = emitterInOrder.get(name) || [];
    line.push(who);
    emitterInOrder.set(name, line.slice(-50));   // 듣는 쪽이 불리지 않은 채 쌓이기만 하는 일이 없게
}
// 적어 둔 낸 확장('' = 내는 순간에도 못 가림). 적힌 게 없으면(우리를 거치지 않고 나온 신호) undefined
function markedEmitter(name, got) {
    if (!isObject(got)) return emitterInOrder.get(name)?.shift();
    return emitterByObject.get(got) ?? (isObject(got.detail) ? emitterByObject.get(got.detail) : undefined);
}
// 기본은 다 켜 두고, 설정에서 뺀 ‘확장 · 하는 일’(otherOff)만 무시 — 같은 번역 신호를 두 확장이 내도 실제로 낸 쪽으로 가름
function onNamedSignal(name, detail) {
    const off = api.options().otherOff || [];
    // 낸 쪽: 내는 순간 적어 둔 것 → 없으면 지금 호출 기록 → 그래도 없으면 신호에 적힌 표시로 breeze 안 번역 기능을 알아봄
    const d0 = detail?.detail ?? detail;
    const j = jobOf(name), who = markedEmitter(name, detail) || emitterOf() || (d0?.by === 'llmt' ? OWN_PART : '');
    if (j && who && off.includes(`${who}#${j}`)) return;
    const tone = j && who ? `${who}#${j}` : null;
    // breeze 안 번역 기능의 '번역 끝'은 본문 번역이 끝난 때다. 그 뒤 상태창 · 카드 글자 번역이 이어지면 그것까지 끝난 뒤에 알린다(3분 넘으면 그냥 알림)
    const wait = who === OWN_PART && j === '번역' ? globalThis[gate('screen-work')]?.wait : null;
    if (typeof wait === 'function') { Promise.race([wait(d0?.messageId), new Promise(r => setTimeout(r, 180000))]).catch(() => {}).then(() => onSignal(name, who, detail, tone)); return; }
    onSignal(name, who, detail, tone);
}
function listenSignals() {
    const { eventSource } = api.ctx();
    for (const [name, fn] of docListeners) { eventSource.removeListener?.(name, fn); document.removeEventListener(name, fn); }
    docListeners = [];
    const names = new Set([...autoSignals.keys()].filter(jobOf));
    for (const sig of signals()) if (sig.on && sig.event?.trim()) names.add(sig.event.trim());   // 예전에 골라 둔 신호도 그대로
    if (ownPartOn()) for (const n of OWN_SIGNALS) names.add(n);
    heardNames.clear(); emitterInOrder.clear();
    for (const name of names) {
        heardNames.add(name);
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
        const from = emitterOf();
        const hit = seen.get(name) || { count: 0, from };
        hit.count++; hit.last = Date.now(); if (!hit.from) hit.from = from;
        seen.set(name, hit);
        // 실제로 이 신호를 낸 확장을 기억(같은 신호 이름을 여러 확장이 코드에 갖고 있을 때 목록에 누구를 보일지).
        // 목록에 줄로 오를 수 있는 끝 신호만 적음: 확장이 내는 신호를 다 적으면 설정이 끝없이 커짐
        if (from && api && jobOf(name) && isDoneName(name)) { const o = api.options(), k = `${from}#${name}`; o.confirmed ??= []; if (!o.confirmed.includes(k)) { o.confirmed.push(k); api.save(); } }
        // 진행 신호(running · done · total 을 싣고 일 내내 나오는 신호 — 여러 메시지를 한꺼번에 하는 일)는 이름에 ‘끝’이 없어 미리 못 찾음 —
        // 처음 나올 때 알아보고 듣기 시작해, 그 일이 다 끝날 때 울림
        const d = detail?.detail ?? detail;
        if (d && typeof d === 'object' && typeof d.running === 'boolean' && 'total' in d && jobOf(name) && from && !autoSignals.has(name)) { autoSignals.set(name, from); if (api) listenSignals(); }
        redrawSeen?.();
    };
    const emit = eventSource.emit, dispatch = document.dispatchEvent;
    let watching = true;
    // 이 둘은 신호를 낸 코드와 같은 호출 기록 안에서 돈다: 낸 확장을 여기서 적어 둠(markEmitter)
    const myEmit = function (name) { if (watching) { markEmitter(name, arguments[1]); note(name, arguments[1]); } return emit.apply(this, arguments); };
    const myDispatch = function (ev) { if (watching && ev instanceof Event) { markEmitter(ev.type, ev); if (ev instanceof CustomEvent) note(ev.type, ev.detail); } return dispatch.apply(this, arguments); };
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
const isDoneName = (n) => DONE_WORD.test(n) && !NOT_DONE.test(n);
function scanSignals() {
    if (scanned) return scanned;
    const core = new Set(Object.values(api.ctx().eventTypes || {}));
    // AI 요청을 보낼 수 있는 확장도 미리 알아 둠(코드에 생성 요청을 부르는 곳이 있는지): 요청을 한 번 보낸 뒤에야 목록에 오르면,
    //   처음 쓰는 확장은 한 번은 소리 없이 지나가고 나서야 켤 수 있었음. '::ai' 는 신호 이름이 될 수 없는 표시
    const AI_CALL = /generateRaw|generateQuietPrompt|ConnectionManagerRequestService|sendRequest\s*\(|\/api\/backends\/[\w-]+\/generate|chat-completions\/generate|\/api\/openai\/generate/;
    const grab = (code, out) => {
        if (AI_CALL.test(code)) out.add('::ai');
        for (const m of code.matchAll(/(?:\.emit|\.emitAndWait|new CustomEvent|dispatchEvent\(\s*new Event)\(\s*['"`]([\w:.\-]{3,60})['"`]/g)) if (isDoneName(m[1]) && !core.has(m[1])) out.add(m[1]);
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
                try { cache = JSON.parse(localStorage.getItem('etk-signal-scan-2') || '{}'); } catch { /* 없음 */ }
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
                    try { let now = {}; try { now = JSON.parse(localStorage.getItem('etk-signal-scan-2') || '{}'); } catch { /* 없음 */ } for (const k of Object.keys(now)) if (k.startsWith(`${folder}@`)) delete now[k]; now[cacheKey] = [...names]; localStorage.setItem('etk-signal-scan-2', JSON.stringify(now)); } catch { /* 저장 못 함 */ }
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
    live = true;
    if (api.ctx().powerUserSettings?.play_message_sound) api.rest('same', SOUND_CORE);
    watchSignals();
    // 깔린 확장의 ‘일 끝남’ 신호를 한가할 때 찾아 저절로 들음(찾은 결과는 확장 판이 같으면 기억해 둔 것을 씀)
    (window.requestIdleCallback || setTimeout)(() => scanSignals().then(m => { autoSignals = m; if (api) listenSignals(); }));
    const { eventSource, eventTypes: ev } = a.ctx();
    wrapFetch();
    watchErrorToasts();
    // 답이 실제로 끝났을 때만 울림. ‘생성 끝’(GENERATION_ENDED) 신호는 실리태번이 멈춤 버튼을 숨길 때 나와서 믿지 않는다:
    //   · 본문 도중 다른 생성이 버튼을 먼저 숨기면 진짜 끝엔 안 나옴
    //   · 다른 확장이 생성을 뒤로 넘기며 입력창을 풀어 주면 답이 오기 전에 나옴(보내자마자 울렸음)
    // 본문(보내기 · 스와이프 · 다시 생성 · 이어 쓰기)은 답이 다 그려졌다는 신호로, 대신 쓰기는 채팅에 그리지 않으니 끝 신호로,
    // 조용한 생성(/gen 등)은 끝 신호 뒤 걸려 있는 생성 요청이 다 끝나고 이어지는 생성이 없을 때 울린다(요청이 실패 · 취소면 안 울림).
    // 멈춤 신호 중 번호가 붙은 것은 스크립트 확장이 자기 생성을 멈춘 것이라 지금 답과 상관없다.
    const MAIN = new Set(['normal', 'swipe', 'regenerate', 'continue', 'impersonate']);
    const RENDER = new Set(['normal', 'swipe', 'regenerate', 'continue']);
    const main = { active: false, type: '', stopped: false, run: 0 };   // run = 몇 번째 본문 생성인지
    const quiet = { active: false, stopped: false, waiting: false, token: 0 };
    const resetMain = () => { main.active = false; main.type = ''; main.stopped = false; };
    busy = () => main.active || quiet.active || quiet.waiting;
    genBusy = () => main.active || quiet.active;
    const settle = () => { if (!busy()) keepAlive(false); };
    const on = (name, fn) => { if (name) { eventSource.on(name, fn); listeners.push([name, fn]); } };
    if (document.getElementById('preloader')) on(ev.APP_READY, () => { appReadyAt = Date.now(); }); else appReadyAt = Date.now();
    on(ev.GENERATION_STARTED, (t, _o, dryRun) => {
        if (dryRun) return;
        const type = String(t || 'normal');
        if (MAIN.has(type)) { main.run++; main.active = true; main.type = type; main.stopped = false; }
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
            // 그사이 새로 시작한 생성의 상태는 지우지 않게, 종류가 아니라 몇 번째 생성인지로 가림
            const run = main.run;
            setTimeout(() => { if (main.active && main.run === run && pendingGen === 0) { resetMain(); settle(); } }, 5000);
            return;
        }
        if (!quiet.active) return;
        quiet.active = false;
        // 앞선 조용한 생성의 기다림은 이 생성이 시작될 때 접혔음(아래 '이어서 다른 생성') → 이 생성이 멈춰 끝나면 기다리는 일이 없음
        if (quiet.stopped) { quiet.waiting = false; settle(); return; }
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
    on(ev.CHAT_CHANGED, () => { resetMain(); chatOpenedAt = Date.now(); firstSignal.clear(); settle(); });
    for (const t of ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown']) document.addEventListener(t, unlock, { capture: true, passive: true });
    listenSignals();
    if (!origPlay) {
        origPlay = HTMLMediaElement.prototype.play;
        myPlay = HTMLMediaElement.prototype.play = function () {
            if (!ours && this.tagName === 'AUDIO') { lastOtherPlay = Date.now(); lastOtherStack = new Error().stack || ''; }
            return origPlay.apply(this, arguments);
        };
    }
}

export function stop() {
    live = false;
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
    toastWatch?.(); toastWatch = null;
}

// ── 세부 설정 화면 ──
// 알림마다 한 줄. 줄을 누르면 그 자리에서 그 알림의 알림음 고르기와 크기가 펼쳐진다.
// 다른 확장의 줄은 켜 둔 것만 보이고 나머지는 '확장 더 보기'에 접힌다. 파일 올리기와 지우기는 맨 아래 '내 알림음 관리'에.
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// 고를 수 있는 소리: 기본 소리 뒤에 내 알림음 파일(알림마다 같은 목록)
const allSounds = () => [...Object.entries(TONES).map(([value, v]) => ({ value, name: v.name })), ...mySounds().map(x => ({ value: `file:${x.url}`, name: x.name }))];
const percentOf = (v, base) => Math.round(unit(v, base) * 100);
const CHEVRON = '<span class="etk-snd-more"><i class="fa-solid fa-chevron-down"></i></span>';   // 펼치면 CSS 가 돌림
const tickHtml = (on, label, tag = 'label') => `<${tag} class="etk-snd-tick"><input type="checkbox"${on ? ' checked' : ''} aria-label="${esc(label)}"><span class="etk-snd-mark" aria-hidden="true"></span></${tag}>`;
const rangeHtml = (percent, label) => `<input type="range" class="etk-snd-range" min="0" max="100" step="5" value="${percent}" style="--p:${percent}%" aria-label="${esc(label)}"><span class="etk-snd-num">${percent}</span>`;
const noteEl = (text) => Object.assign(document.createElement('small'), { className: 'etk-snd-note', textContent: text });
const AI_NOTE = "'AI 요청이 끝날 때'는 그 확장이 보낸 요청이 끝날 때마다 울려요.";

// 크기 줄: 끌면 채워진 길이와 옆 숫자를 같이 바꾸고 값(0~1)을 넘김. 놓으면(onRelease) 그 크기로 한 번 들려줌
function wireRange(input, onValue, onRelease) {
    input.addEventListener('input', () => {
        const percent = Number(input.value);
        input.style.setProperty('--p', `${percent}%`);
        input.nextElementSibling.textContent = percent;
        onValue(percent / 100);
    });
    input.addEventListener('change', onRelease);
}
// 줄 · 버튼을 누르거나 글쇠(Enter · 빈칸)로 누름. 줄 안의 체크는 따로 눌림
function pressable(el, fn) {
    el.addEventListener('click', (e) => { if (!e.target.closest('.etk-snd-tick')) fn(); });
    el.addEventListener('keydown', (e) => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fn(); } });
}
// 펼치는 줄의 머리(체크 없는 줄): 이름과 펼침 화살표
function headRow(label, cls = '') {
    const row = document.createElement('div');
    row.className = `etk-snd-row ${cls}`.trim();
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.innerHTML = `<div class="etk-snd-tx"><b>${esc(label)}</b></div>${CHEVRON}<span class="etk-snd-gap"></span>`;
    return row;
}
// 펼치는 칸 한 덩어리: 머리 줄 + 안쪽. 안쪽 내용은 펼칠 때 만들고(fill) 다 접힌 뒤 지운다.
// 높이와 흐림은 CSS 가 부드럽게 바꾸므로 여기선 표시(etk-snd-opened)만 붙였다 뗀다
function foldItem(head, open, fill) {
    const item = document.createElement('div'), body = document.createElement('div'), inner = document.createElement('div');
    item.className = 'etk-snd-item'; body.className = 'etk-snd-body'; inner.className = 'etk-snd-inner';
    body.append(inner); item.append(head, body);
    let clear = 0;
    const set = (on, smooth = true) => {
        clearTimeout(clear);
        head.setAttribute('aria-expanded', String(on));
        if (!on) { item.classList.remove('etk-snd-opened'); clear = setTimeout(() => inner.replaceChildren(), 240); return; }
        if (!inner.firstChild) fill(inner);
        if (smooth) void body.offsetHeight;   // 접힌 모습을 한 번 그린 뒤 펼쳐야 부드럽게 열림
        item.classList.add('etk-snd-opened');
    };
    set(open, false);
    return { item, set };
}

// 알림 줄이 켜져 있는지: 다른 확장의 끝 신호 · 오류는 꺼 둔 것만 적고(otherOff), 확장의 AI 요청은 켜 둔 것만 적음(aiOn)
const aiFolder = (key) => key.slice(0, -3);
function isRowOn(o, row) {
    if (row.kind === 'fixed') return true;
    return row.kind === 'ai' ? (o.aiOn || []).includes(aiFolder(row.key)) : !(o.otherOff || []).includes(row.key);
}
function setRowOn(o, row, on) {
    if (row.kind === 'ai') { const rest = (o.aiOn || []).filter(k => k !== aiFolder(row.key)); o.aiOn = on ? [...rest, aiFolder(row.key)] : rest; return; }
    const rest = (o.otherOff || []).filter(k => k !== row.key);
    o.otherOff = on ? rest : [...rest, row.key];
    listenSignals();
}

// 알림음 고르기: 이름이 옆으로 늘어선 한 줄에서 가운데에 온 이름이 고른 소리.
// 밀기 · 끌기 · 화살표 · 휠 · 글쇠 어느 것으로 움직여도 멈춘 자리에서 한 번만 고른다(지나가는 이름마다 소리가 나면 시끄러움).
// 사람이 움직였을 때만 고른다: 창 크기가 바뀌어 줄이 저절로 다시 맞춰질 때 고른 소리가 바뀌면 안 됨
const SETTLE_MS = 160;   // 마지막 움직임 뒤 이만큼 가만히 있으면 멈춘 것으로 봄
function tonePicker(list, start, onPick, onShow) {
    const row = document.createElement('div');
    row.className = 'etk-snd-reelrow';
    const arrow = (by, label) => `<div class="etk-snd-step" role="button" tabindex="0" data-step="${by}" aria-label="${label}"><i class="fa-solid fa-chevron-${by < 0 ? 'left' : 'right'}"></i></div>`;
    row.innerHTML = `${arrow(-1, '앞 알림음')}<div class="etk-snd-reel" tabindex="0" role="listbox" aria-label="알림음">${list.map((x, i) => `<span role="option" data-i="${i}">${esc(x.name)}</span>`).join('')}</div>${arrow(1, '다음 알림음')}`;
    const reel = row.querySelector('.etk-snd-reel');
    const r = { reel, names: [...reel.children], list, shown: -1, picked: start, aim: start, byHand: false, down: false, timer: 0, onPick, onShow };
    showName(r, start);
    reel.addEventListener('scroll', () => { if (r.byHand) { showName(r, nearestName(r)); waitSettle(r); } }, { passive: true });
    wireReelTouch(r); wireReelMouse(r); wireReelKeys(r);
    for (const btn of row.querySelectorAll('.etk-snd-step')) wireStep(r, btn);
    // 줄의 폭이 정해질 때(숨은 칸에서 만들어졌다가 보일 때 포함)와 바뀔 때마다 고른 이름을 가운데로: 한 번만 맞추면 폭이 0일 때 만들어진 줄은 첫 이름이 오른쪽으로 치우친 채 남았음
    new ResizeObserver(() => { if (!r.byHand) centerOn(r, r.picked, false); }).observe(reel);
    return row;
}
const nameMid = (n) => n.offsetLeft + n.offsetWidth / 2;
function nearestName(r) {
    const mid = r.reel.scrollLeft + r.reel.clientWidth / 2;
    let best = 0;
    r.names.forEach((n, i) => { if (Math.abs(nameMid(n) - mid) < Math.abs(nameMid(r.names[best]) - mid)) best = i; });
    return best;
}
function showName(r, i) {
    if (i === r.shown) return;
    r.names[r.shown]?.classList.remove('etk-snd-cur');
    r.shown = i;
    r.names[i].classList.add('etk-snd-cur');
    r.onShow(i);
}
function centerOn(r, i, smooth = true) {
    if (r.reel.clientWidth) r.reel.scrollTo({ left: nameMid(r.names[i]) - r.reel.clientWidth / 2, behavior: smooth ? 'smooth' : 'auto' });
}
function waitSettle(r) { clearTimeout(r.timer); r.timer = setTimeout(() => settled(r), SETTLE_MS); }
// 멈춘 자리: 손가락 · 마우스를 아직 떼지 않았으면 기다리고, 아니면 가운데 이름을 고름(전과 같은 이름이면 아무 일도 없음)
function settled(r) {
    if (r.down || !r.reel.isConnected || !r.reel.clientWidth) return;
    const i = nearestName(r);
    r.byHand = false; r.aim = i;
    showName(r, i);
    if (i !== r.picked) { r.picked = i; r.onPick(r.list[i]); }
}
// 사람이 고른 이름으로 가기(화살표 · 글쇠 · 휠 · 이름 누르기 · 끌다 놓기)
function aimAt(r, i) {
    r.aim = Math.min(r.names.length - 1, Math.max(0, i));
    r.byHand = true;
    waitSettle(r);
    centerOn(r, r.aim);
}
// 손가락으로 밀기: 넘기는 것은 브라우저가 하고, 손을 뗀 뒤 멈추면 고름
function wireReelTouch(r) {
    r.reel.addEventListener('touchstart', () => { r.down = true; r.byHand = true; }, { passive: true });
    for (const t of ['touchend', 'touchcancel']) r.reel.addEventListener(t, () => { r.down = false; waitSettle(r); }, { passive: true });
}
// 마우스로 끌기, 옆 이름 누르기
function wireReelMouse(r) {
    const { reel } = r;
    let dragged = false;
    reel.addEventListener('pointerdown', (e) => {
        dragged = false;
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        const x0 = e.clientX, left0 = reel.scrollLeft;
        const move = (ev) => {
            if (!dragged && Math.abs(ev.clientX - x0) < 4) return;
            dragged = true; r.down = true; r.byHand = true;
            reel.classList.add('etk-snd-drag');
            reel.scrollLeft = left0 - (ev.clientX - x0);
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            if (!dragged) return;
            r.down = false;
            reel.classList.remove('etk-snd-drag');
            aimAt(r, nearestName(r));
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, { once: true });
    });
    // 끌다 놓은 것은 누름이 아님
    reel.addEventListener('click', (e) => {
        const name = e.target.closest('[data-i]');
        if (!dragged && name) aimAt(r, Number(name.dataset.i));
        dragged = false;
    });
}
function wireReelKeys(r) {
    r.reel.addEventListener('keydown', (e) => {
        const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        if (by) { e.preventDefault(); aimAt(r, r.aim + by); }
    });
    // 세로 휠은 이 줄을 눌러 둔 동안만 넘김: 설정 화면을 휠로 내리다 이 줄 위를 지날 때 알림음이 바뀌면 안 됨. 옆으로 굴리는 휠은 브라우저가 그대로 넘김
    let last = 0;
    r.reel.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { r.byHand = true; waitSettle(r); return; }
        if (document.activeElement !== r.reel) return;
        e.preventDefault();
        if (e.timeStamp - last < 90) return;
        last = e.timeStamp;
        aimAt(r, r.aim + Math.sign(e.deltaY));
    }, { passive: false });
}
// 양 끝 화살표: 누르면 한 칸, 길게 누르면 빠르게 이어서 넘김
function wireStep(r, btn) {
    const by = Number(btn.dataset.step);
    let hold = 0, repeat = 0, held = false;
    const end = () => { clearTimeout(hold); clearInterval(repeat); };
    const fast = () => { held = true; repeat = setInterval(() => (btn.isConnected ? aimAt(r, r.aim + by) : end()), 110); };
    btn.addEventListener('pointerdown', () => { end(); held = false; hold = setTimeout(fast, 400); });
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(t, end);
    btn.addEventListener('click', () => { if (!held) aimAt(r, r.aim + by); held = false; });
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aimAt(r, r.aim + by); } });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());   // 휴대폰에서 길게 누르면 뜨는 메뉴
}

// 펼친 알림 줄의 안쪽: 알림음 고르기와 그 알림의 크기
function rowDetail(view, row, inner) {
    const { o, a } = view, list = allSounds();
    inner.innerHTML = `<div class="etk-snd-reelhd"><span>알림음</span><span class="etk-snd-cnt"></span></div><div class="etk-snd-fld"><span class="etk-snd-lb">크기</span>${rangeHtml(percentOf(o.volumeFor?.[row.key], 1), '이 알림의 크기')}</div>`;
    const count = inner.querySelector('.etk-snd-cnt');
    const start = Math.max(0, list.findIndex(x => x.value === toneOf(row.key)));   // 지운 소리를 가리키면 첫 소리
    const pick = (sound) => { o.toneFor[row.key] = sound.value; a.save(); beep(sound.value, row.key); };
    inner.firstElementChild.after(tonePicker(list, start, pick, (i) => { count.textContent = `${i + 1}/${list.length}`; }));
    wireRange(inner.querySelector('.etk-snd-range'), (v) => { (o.volumeFor ??= {})[row.key] = v; a.save(); }, () => beep(toneOf(row.key), row.key));
}
// 알림 한 줄: 이름(+ 흐린 작은 글), 펼침 화살표, 체크. row = { key, name, job, kind: 'fixed' | 'signal' | 'ai' }
function alertRow(view, row) {
    const { o, a } = view, on = isRowOn(o, row);
    const head = document.createElement('div');
    head.className = `etk-snd-row${on ? '' : ' etk-snd-off'}`;
    head.tabIndex = 0;
    head.setAttribute('role', 'button');
    const tick = row.kind === 'fixed' ? '<span class="etk-snd-gap"></span>' : tickHtml(on, [row.name, row.job].filter(Boolean).join(' '));
    head.innerHTML = `<div class="etk-snd-tx"><b>${esc(row.name)}</b>${row.job ? `<span class="etk-snd-job">${esc(row.job)}</span>` : ''}</div>${CHEVRON}${tick}`;
    const fold = foldItem(head, view.open.has(row.key), (inner) => rowDetail(view, row, inner));
    pressable(head, () => {
        const open = !view.open.has(row.key);
        if (open) view.open.add(row.key); else view.open.delete(row.key);
        fold.set(open);
    });
    head.querySelector('input')?.addEventListener('change', (e) => { setRowOn(o, row, e.target.checked); a.save(); head.classList.toggle('etk-snd-off', !e.target.checked); view.showCount(); });
    return fold.item;
}
function drawMain(view) {
    view.part('main').replaceChildren(alertRow(view, { key: 'main', name: '메시지 생성이 끝날 때', kind: 'fixed' }), alertRow(view, { key: 'error', name: '오류가 날 때', kind: 'signal' }));
}

// 다른 확장의 줄: 끝 신호를 내는 확장(확장 + 하는 일)과, AI 요청을 직접 보내는 확장
async function extRows(o) {
    const pairs = new Map();   // '확장#하는 일' → 같은 줄은 한 번
    // 같은 신호 이름이 여러 확장 코드에 있으면(한 확장이 다른 확장의 기능을 통째로 담은 경우: 그 기능을 꺼 둬도 코드는 있음),
    // 실제로 그 신호를 낸 적이 있는 확장만 보임. 한 확장에만 있는 신호는 그대로
    for (const [n, folders] of autoSignals) {
        const j = jobOf(n); if (!j) continue;
        const list = folders.split('|');
        for (const folder of list) if (list.length < 2 || (o.confirmed || []).includes(`${folder}#${n}`)) pairs.set(`${folder}#${j}`, [folder, j]);
    }
    for (const [n, info] of seen) { const j = jobOf(n); if (j && info.from && isDoneName(n)) pairs.set(`${info.from}#${j}`, [info.from, j]); }
    if (ownPartOn()) pairs.set(`${OWN_PART}#번역`, [OWN_PART, '번역']);
    const signalRows = await Promise.all([...pairs].map(async ([key, [folder, j]]) => ({ key, name: await partName(folder), job: `${j}이 끝날 때`, kind: 'signal' })));
    // 자기 끝 신호를 내는 확장은 그 신호 줄이 같은 일(번역 요청 끝 = 번역 끝)을 알려서 'AI 요청' 줄은 뺌. 이미 켜 둔 줄은 끌 수 있게 남김
    const hasOwn = new Set([...pairs.values()].map(([folder]) => folder));
    // 요청을 본 적 있는 확장 + 코드에 AI 요청을 부르는 곳이 있는 확장(아직 한 번도 안 보냈어도 미리 보임)
    const aiCan = [...new Set([...(o.aiSeen || []), ...String(autoSignals.get('::ai') || '').split('|').filter(Boolean)])];
    const aiRows = await Promise.all(aiCan.filter(folder => !hasOwn.has(folder) || (o.aiOn || []).includes(folder)).map(async folder => ({ key: `${folder}#ai`, name: await extensionName(folder), job: 'AI 요청이 끝날 때', kind: 'ai' })));
    const byName = (x, y) => x.name.localeCompare(y.name);
    return [...signalRows.sort(byName), ...aiRows.sort(byName)];
}
// 켜 둔 줄만 밖에 보이고 나머지는 '확장 더 보기'에 접힘. 밖에 보일 줄은 그 줄을 처음 그릴 때 정함:
// 체크를 바꿀 때마다 줄이 자리를 옮기면 방금 누른 줄이 눈앞에서 사라짐
async function drawExt(view, force = false) {
    const host = view.part('ext');
    if (!host?.isConnected) { redrawSeen = null; return; }
    const rows = await extRows(view.o);
    if (!host.isConnected) return;
    // 줄이 그대로면 다시 그리지 않음: 다른 확장이 신호를 낼 때마다 다시 그리면 펼쳐서 고르던 알림음 줄이 닫힘
    const sig = `${view.scanning}\n${rows.map(r => r.key).join('\n')}`;
    if (!force && sig === view.extSig) return;
    view.extSig = sig; view.ext = rows;
    for (const r of rows) if (!view.met.has(r.key)) { view.met.add(r.key); if (isRowOn(view.o, r)) view.front.add(r.key); }
    const rest = rows.filter(r => !view.front.has(r.key));
    const front = rows.filter(r => view.front.has(r.key));
    const parts = front.map(r => alertRow(view, r));
    // AI 요청 줄의 설명은 그 줄이 보이는 곳에: 밖에 나온 줄에 있으면 그 묶음 아래, 접힌 줄에만 있으면 펼친 안쪽
    const noteOutside = front.some(r => r.kind === 'ai');
    if (noteOutside) parts.push(noteEl(AI_NOTE));
    if (rest.length) parts.push(moreItem(view, rest, !noteOutside));
    if (!rows.length && view.scanning) parts.push(noteEl('깔린 확장에서 찾는 중이에요'));
    host.replaceChildren(...parts);
    view.part('ext-head').hidden = !rows.length && !view.scanning;
    view.showCount();
}
// '확장 더 보기': 접혀 있던 줄들이 그 자리에서 펼쳐짐. 안의 줄을 펼치면 그 줄이 바탕을 가지므로 이 칸은 바탕 없이 줄만 늘어놓음
function moreItem(view, rest, withAiNote) {
    const label = () => (view.more ? '접기' : `확장 더 보기 (${rest.length}개)`);
    const head = headRow(label(), 'etk-snd-fold');
    const fold = foldItem(head, view.more, (inner) => {
        inner.append(...rest.map(r => alertRow(view, r)));
        if (withAiNote && rest.some(r => r.kind === 'ai')) inner.append(noteEl(AI_NOTE));
    });
    fold.item.classList.add('etk-snd-plain');
    pressable(head, () => { view.more = !view.more; head.querySelector('b').textContent = label(); fold.set(view.more); });
    return fold.item;
}

// 그 밖에: 체크 줄 둘(이름 아래 작은 글로 설명)과 내 알림음 관리
function optRow(view, k, name, desc, after) {
    const { o, a } = view, row = document.createElement('label');
    row.className = 'etk-snd-row';
    row.innerHTML = `<div class="etk-snd-tx"><b>${name}</b><small>${desc}</small></div>${tickHtml(k === 'keepAlive' ? o.keepAlive !== false : !!o[k], name, 'span')}`;
    row.querySelector('input').addEventListener('change', (e) => { o[k] = e.target.checked; a.save(); after?.(); });
    return row;
}
function drawEtc(view) {
    const parts = [];
    // 아이폰은 탭을 보고 있을 때만 울릴 수 있어 이 두 줄을 두지 않음
    if (!isIOS()) {
        parts.push(optRow(view, 'onlyHidden', '실리태번을 안 보고 있을 때만 울리기', '다른 탭이나 다른 앱을 볼 때만 울려요'));
        // 휴대폰에서만 하는 일이라(keepOn) 컴퓨터에서는 줄을 두지 않음
        if (isPhone()) parts.push(optRow(view, 'keepAlive', '휴대폰 화면을 꺼도 알림 받기', '메시지를 만드는 동안 페이지가 잠들지 않게 해요', () => { if (!view.o.keepAlive) keepAudio?.pause(); }));
    }
    const head = headRow('내 알림음 관리');
    const fold = foldItem(head, view.manage, (inner) => manageBox(view, inner));
    pressable(head, () => { view.manage = !view.manage; fold.set(view.manage); });
    parts.push(fold.item);
    view.part('etc').replaceChildren(...parts);
}
// 내 알림음 관리: 올린 파일마다 한 줄(듣기 · 지우기)과 올리기 버튼. 하나도 없으면 없다는 한 줄
function manageBox(view, inner) {
    const files = mySounds();
    inner.append(...(files.length ? files.map(x => fileRow(view, x)) : [noteEl('올린 알림음이 없어요')]));
    const add = document.createElement('div');
    add.className = 'etk-snd-btn';
    add.tabIndex = 0;
    add.setAttribute('role', 'button');
    add.innerHTML = '<i class="fa-solid fa-plus"></i>알림음 파일 올리기';
    pressable(add, () => uploadSounds(view));
    inner.append(add);
}
function fileRow(view, x) {
    const row = document.createElement('div');
    row.className = 'etk-snd-file';
    const icon = (name, label) => `<div class="etk-snd-ic" role="button" tabindex="0" aria-label="${label}"><i class="fa-solid fa-${name}"></i></div>`;
    row.innerHTML = `<span>${esc(x.name)}</span>${icon('play', '듣기')}${icon('trash-can', '지우기')}`;
    const [play, del] = row.querySelectorAll('.etk-snd-ic');
    pressable(play, () => beep(`file:${x.url}`));
    pressable(del, () => removeSound(view, x));
    return row;
}
function removeSound(view, x) {
    const { o, a } = view, value = `file:${x.url}`;
    // 주소로 가려 지움: 설정을 다른 기기 것과 합칠 때 목록이 새 사본으로 바뀌어, 줄이 쥐고 있던 항목과 같은 것인지로는 못 찾을 수 있음
    o.sounds = mySounds().filter(y => y.url !== x.url);
    // 이 소리를 쓰던 알림은 첫 소리로
    for (const k of Object.keys(o.toneFor)) if (o.toneFor[k] === value) delete o.toneFor[k];
    if (o.tone === value) o.tone = 'chime';
    a.save();
    fetch('/api/files/delete', { method: 'POST', headers: SillyTavern.getContext().getRequestHeaders(), body: JSON.stringify({ path: x.url.replace(/^\//, '') }) }).catch(() => {});
    view.redraw();
}
// 여러 파일을 한 번에 고를 수 있음. 3MB 넘는 파일은 빼고 알림
async function uploadSounds(view) {
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
    view.a.save();
    view.redraw();
    if (last) beep(`file:${last}`);
}

export function options(box, a) {
    api ??= a;
    const o = a.options();
    o.tone ??= 'chime';
    mySounds();
    o.toneFor ??= {};
    box.innerHTML = `<div class="etk-snd">
        <div class="etk-snd-fld etk-snd-top"><span class="etk-snd-lb">전체 크기</span>${rangeHtml(percentOf(o.volume, 0.5), '전체 크기')}</div>
        <div class="etk-snd-sec"><span>언제 울릴까요</span></div><div data-part="main"></div>
        <div class="etk-snd-sec" data-part="ext-head"><span>다른 확장이 일을 끝낼 때도 알리기</span><em data-part="count"></em></div><div data-part="ext"></div>
        <div class="etk-snd-sec"><span>그 밖에</span></div><div data-part="etc"></div>
    </div>`;
    // 이 화면의 상태: 펼친 알림 줄(open) · 확장 더 보기(more) · 내 알림음 관리(manage) · 밖에 보일 확장 줄(front, 한 번 본 줄은 met)
    const view = { a, o, open: new Set(), more: false, manage: false, scanning: true, front: new Set(), met: new Set(), ext: [], extSig: '', part: (name) => box.querySelector(`[data-part="${name}"]`) };
    view.showCount = () => { const n = view.ext.filter(r => isRowOn(o, r)).length; view.part('count').textContent = n ? `${n}개 켜짐` : ''; };
    view.redraw = () => { drawMain(view); drawEtc(view); drawExt(view, true); };
    wireRange(box.querySelector('.etk-snd-top .etk-snd-range'), (v) => { o.volume = v; a.save(); }, () => beep(toneOf('main'), 'main'));
    drawMain(view); drawEtc(view); drawExt(view);
    redrawSeen = () => drawExt(view);
    scanSignals().then(m => { autoSignals = m; view.scanning = false; listenSignals(); drawExt(view); });
}
