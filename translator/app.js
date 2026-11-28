// 새 번역기가 시작하는 곳. 부분들을 묶는다: 저장(store/hands.js), 일 줄(job), 메시지 버튼과 보기 방식(ui/message), 판과 아래 한 줄(ui/panel).
// 저장하는 손은 여기서 한 번 만들어 번역 일과 화면에 넘겨준다(화면은 저장에 직접 닿지 않는다).
// features/translator.js 가 불러온다.

import { createQueue } from './job/queue.js';
import { createGuards } from './job/guard.js';
import { translateMessage, prepare, refusalFilter } from './job/run.js';
import { openRedo as redoOf, undoRedo, undoState } from './job/redo.js';
import { createBatch } from './job/batch.js';
import { createClear } from './job/clear.js';
import { remembered, forget, offerPrior, rememberEdited } from './job/engine.js';
import { gatherNow } from './job/sources.js';
import { chatName, pinChat, findAgain, rowOf, createReturn, keepAnswer, keptAnswer, forgetKept } from './job/away.js';
import { createLater } from './store/later.js';
import { readRedoPrompt } from './store/redo-prompts.js';
import { fillSlot } from './job/earlier.js';
import { picturesOnly } from './core/picture.js';
import { createHands } from './store/hands.js';
import { readSettings, connectionMark } from './store/settings.js';
import { viewOf, showOriginal, showTranslation, detach } from './store/message.js';
import { install as installWordReplacements } from './store/word-replacements.js';
import { noteAttached, sourceEdited, priorFor } from './store/edited.js';
import { holdRules } from './rules/hold.js';
import { keptRules } from './rules/kept.js';
import { frameRules } from './rules/frame.js';
import { spacerRules, spacedSender } from './rules/spacer.js';
import { modelOf } from './send/profile.js';
import { prefillSender } from './send/prefill.js';
import { mountButtons } from './ui/message/buttons.js';
import { mountShow } from './ui/message/show.js';
import * as bar from './ui/panel/progress.js';
import * as panels from './ui/panel/open.js';
import { getStringHash } from '/scripts/utils.js';
import { getRegexScripts } from '/scripts/extensions/regex/engine.js';

const context = () => SillyTavern.getContext();
const store = createHands(context);
const { layers, memory } = store;
const queue = createQueue();
const guards = createGuards(context);
let ui = null, show = null;
let screen = null;   // 상태창 번역(screen/start.js startScreen 이 내준 것). 켜지 못했으면 null
let booked = null;   // 답이 써지는 동안 누른 번역: { message, swipe, timer }
let doneSignal = '';   // 번역 끝 신호의 이름(api.js 를 켠 뒤에 안다)
const later = createLater();   // 다른 채팅에 있는 동안 받아, 그 채팅을 열면 붙일 답(store/later.js)

const DEFAULT_VIEW = { main: 'tr', when: 'tap' };
// 보기 설정. 문단을 그릴 때마다 쓰는 곳 셋을 합쳐 읽지 않게 여기 두고, 채팅이 바뀌거나 설정 판에서 바꿨을 때만 다시 읽는다
let viewSetting = DEFAULT_VIEW;
const notice = (text, kind = 'info') => globalThis.toastr?.[kind]?.(text, '', { timeOut: 3500 });

function loadStyle() {
    for (const [id, path] of [['btr-style', './style.css'], ['btr-view-style', './ui/message/view.css'], ['btr-edit-style', './ui/message/edit.css']]) {
        if (document.getElementById(id)) continue;
        document.head.append(Object.assign(document.createElement('link'), { id, rel: 'stylesheet', href: new URL(path, import.meta.url).href }));
    }
}

// ── 맨 앞 버튼의 상태 ──

function stateOf(id) {
    const message = context().chat?.[id];
    if (!message) return 'none';
    if (queue.find(message) || booked?.message === message) return 'busy';
    return viewOf(message);
}

/** 그 메시지의 버튼과 보기 방식을 다시 그린다 */
const paintMessage = id => {
    const el = document.querySelector(`#chat > .mes[mesid="${id}"]`);
    if (!el) return;
    ui?.paint(el);
    show?.paint(id);
};

const paintAll = () => { ui?.paint(); show?.paintAll(); };

// ── 답이 써지는 중에 누른 번역: 그때는 보내지 않고 답이 끝나면 한 번 돌린다 ──

/** 이 메시지에 지금 답이 써지는 중인가(스와이프로 새 답을 받는 중인 '...' 포함) */
function writing(id, message) {
    const mes = String(message.mes ?? '').trim();
    if (mes === '...' || mes === '…') return true;
    const p = context().streamingProcessor;
    return !!p && Number(p.messageId) === Number(id) && !p.isFinished && !p.isStopped;
}

function unbook() {
    if (!booked) return;
    clearInterval(booked.timer);
    const message = booked.message;
    booked = null;
    const id = context().chat?.indexOf(message) ?? -1;
    if (id >= 0) paintMessage(id);
}

/** 예약한 답이 끝났는지 본다: 끝났으면 번역하고, 사용자가 멈춘 답이나 넘긴 스와이프면 예약만 푼다 */
function checkBooked(mine) {
    const message = mine.message, now = context().chat?.indexOf(message) ?? -1;
    if (booked !== mine) return;
    if (now < 0 || (message.swipe_id ?? 0) !== mine.swipe) { unbook(); return; }
    if (writing(now, message)) return;
    const stopped = !!context().streamingProcessor?.isStopped;
    unbook();
    if (!stopped) translate(message);
}

function book(id, message) {
    unbook();
    const mine = booked = { message, swipe: message.swipe_id ?? 0, timer: 0 };
    mine.timer = setInterval(() => checkBooked(mine), 500);
    paintMessage(id);
    notice('답이 끝나면 바로 번역할게요. 한 번 더 누르면 풀어요.');
}

// ── 번역 ──

/** 지금 설정과 쓰는 곳 셋으로 모은 재료(쓰는 곳 셋을 다 읽은 뒤에 부른다) */
function gathered() {
    const c = context();
    return gatherNow(c, layers, readSettings(c.extensionSettings));
}

/** 그 메시지의 번역 재료(요청 수 어림, 다시 번역) */
function planFor(message) {
    const picked = gathered();
    return prepare({ context: context(), settings: picked.settings, message, picked, memory, holdFor });
}

/**
 * 지금 채팅의 정보를 붙잡아 둔다(job/away.js): 다른 채팅에 가 있는 동안 시작하는 번역은 이것으로 재료를 만든다.
 * 답마다의 화면용 정규식 목록은 번역할 답들(messages)의 것만 붙잡고, 앞 대화로 실리는 다른 답에는 지금 켜진 목록을 쓴다.
 * 쓰는 곳 셋의 사람 · 이름 · 규칙(picked)은 다 읽은 뒤에 붙잡는다: 그 전에 채팅이 바뀌었으면 비어 있고, 그 번역은 시작하지 못한다.
 */
function holdChat(messages) {
    const c = context(), all = getRegexScripts({ allowedOnly: true });
    const scripts = new Map(messages.map(m => [m, scriptsFor(c.chat?.indexOf(m) ?? -1)]));
    const pin = { home: chatName(c), key: guards.key(), context: pinChat(c), picked: null };
    pin.holdFor = message => holdRulesFor(pin.context, scripts.get(message) ?? all, message);
    pin.spacersFor = message => spacerRules(scripts.get(message) ?? all);
    layers.ready().then(() => { if (chatName(context()) === pin.home) pin.picked = gathered(); });
    return pin;
}

/**
 * 다 받았는데 그 채팅이 열려 있지 않은 답을 적어 둔다. 그새 그 채팅으로 돌아와 있으면 그 번역 일이 끝난 뒤 바로 붙는다(onQueue).
 * 받은 번역 그대로(out)도 기억 저장소에 둔다(job/away.js keepAnswer): 확인에 걸린 문단은 문단 기억에 안 들어가서, 문단 기억만으로는 그 답을 못 붙인다
 */
const keepFor = pin => (guard, plan, out) => {
    const row = rowOf(guard, plan);
    later.add(pin.home, row);
    if (out) keepAnswer(memory, row, out).catch(error => console.warn('[번역] 받은 번역을 적어 두지 못했어요', error));
};

/**
 * 번역 버튼과 채팅 전부 번역이 같이 부르는 번역: 줄에 세운다. 다른 채팅으로 가도 그만두지 않는다.
 * @param {object} message  @param {object} [pin] 그 답의 채팅을 붙잡아 둔 것(채팅 전부 번역이 시작할 때 붙잡은 것). 안 주면 지금 채팅을 붙잡는다
 * @returns {Promise<{ result?, error? }>}
 */
function translate(message, pin = holdChat([message])) {
    const guard = guards.capture(message, { sameText: picturesOnly, home: { key: pin.key, index: pin.context.chat.indexOf(message) } });
    const job = {
        guard,
        holds: item => guard.holds(item),
        run: (signal, notify) => translateMessage({
            context: context(), guard, signal, notify, hash: getStringHash, layers, memory, extrasFor: screen?.extrasFor,
            holdFor: holdWithPrior(message, guard), spacersFor, pinned: pin, keep: keepFor(pin),
            writing: target => writing(context().chat?.indexOf(target) ?? -1, target), onNames: saveNames, redraw: drawPlaced,
        }),
    };
    return queue.add(job, message);
}

/**
 * 번역이 막 붙은 답을 화면에 한 번에 그린다(job/run.js place 가 부른다).
 * 원문 먼저 보기이고 본문이 아직 원문 그대로면 다시 그리지 않고 그 본문에 붙이기만 한다: 번역문으로 다시 그렸다가 문단을 원문으로 되돌리면
 *   글과 높이가 두 번 바뀌고, 카드 화면 틀(iframe)도 새로 만들어져 출렁였다.
 * 그 밖에는 실리태번의 메시지 다시 그리기 뒤 같은 차례 안에서 보기 방식을 그리고 메시지가 바뀌었다고 알린다:
 *   실리태번의 메시지 다시 그리기는 알림을 내지 않아, 코드 칸에 든 카드 화면 틀을 iframe 으로 그리는 쪽이 다음 알림까지 HTML 글을 그대로 두었다.
 */
function drawPlaced(id, message, { fromSource }) {
    const c = context();
    if (fromSource && viewSetting.main === 'src' && show?.keepDrawn(id)) return;
    c.updateMessageBlock(id, message);
    show?.paintNow(id);
    c.eventSource.emit(c.eventTypes.MESSAGE_UPDATED, id);
}

/**
 * 번역에서 처음 나온 이름 표기를 그 사람의 한글 표기로 적는다. 표기가 이미 적힌 사람은 건드리지 않는다(사용자가 적은 것이 이긴다).
 * 쓰는 곳 어디에도 없는 사람(카드 · 페르소나 이름만으로 넣은 사람)은 이 캐릭터의 사람으로 새로 적는다:
 * 안 적으면 이 답의 번역 기억은 그 표기로 적혔는데 다음에는 표기가 비어 있어, 그 사람이 걸린 문단이 전부 다시 나간다.
 */
function saveNames(names) {
    for (const { id, ko, names: sourceNames } of names) {
        const person = layers.view().people.find(p => p.id === id);
        if (person?.ko) continue;
        if (!person) { if (sourceNames?.length) layers.savePerson({ id, names: [...sourceNames], ko, gender: '', style: '', to: [] }, 'card'); continue; }
        const { place, places, ...plain } = person;
        layers.savePerson({ ...plain, ko }, place);
    }
}

/**
 * 원문을 고친 답이면, 붙어 있던 번역에서 글이 그대로인 문단의 번역을 엔진에 맡긴 뒤의 뺄 글 규칙 함수(store/edited.js, job/engine.js offerPrior).
 * 그 문단은 다시 보내지 않는다. 고친 답이 아니면 holdFor 그대로다.
 */
function holdWithPrior(message, guard) {
    const prior = priorFor(message, sourceOf(message), holdFor(message));
    if (!prior) return holdFor;
    return other => (other === guard.target() ? offerPrior(holdFor(other), prior) : holdFor(other));
}

function jumpTo(job) {
    const id = job.guard.index();
    document.querySelector(`#chat > .mes[mesid="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/**
 * 문제 표시의 버튼이 할 일. 보통 번역은 같은 메시지를 다시 번역한다(받은 문단은 기억에 있어 나머지만 보낸다).
 * 다시 번역이 실패한 것이면 보통 번역을 부르지 않고 다시 번역 판을 연다: 보통 번역은 고른 대사 · 이번 말투 · 바로잡은 주인을 모른다.
 */
const again = job => () => {
    bar.hide();
    if (job.guard.away()) return;   // 그 답의 채팅이 지금 열려 있지 않다
    if (job.redo) panels.openRedo(job.guard.target()); else translate(job.guard.target());
};

/** 끊겼거나 일부만 받은 것을 아래 한 줄에 보인다. 다시 번역은 '이어서'가 없다(판을 다시 연다) */
function showProblem(job, text, requests = 0) {
    bar.showProblem({ text, requests: job.redo ? 0 : requests, onAction: again(job), onJump: () => jumpTo(job) });
}

function onEnd(job, { result, error }) {
    if (batch.running()) return;   // 채팅 전부 번역 중에는 답마다 알리지 않고 끝에 한 번 알린다
    if (result?.away) { bar.hide(); notice('번역을 다 받았어요. 그 채팅을 열면 붙어요.'); return; }
    if (result?.swiped) { bar.hide(); notice('번역을 다 받았어요. 그 스와이프로 돌아가면 보여요.'); return; }
    if (error && !error.stopped && job.guard.away()) { bar.hide(); notice(`다른 채팅의 번역을 끝내지 못했어요. ${error.message || ''}`.trim(), 'warning'); console.warn('[번역]', error); return; }
    if (error?.stopped) { bar.hide(); notice('번역을 멈췄어요. 다시 누르면 받은 문단은 두고 나머지만 번역해요.'); return; }
    if (error?.cancelled) { bar.hide(); notice(error.message); console.info(`[번역] 그만둠: ${error.reason}`); return; }
    if (error?.kept) { showProblem(job, `${error.kept.failed}문단을 못 받았어요`, error.kept.retryRequests); return; }
    if (error) { console.warn('[번역]', error); showProblem(job, error.message || '번역하지 못했어요.'); return; }
    if (result?.failed) { showProblem(job, `${result.failed}문단을 못 받았어요`, result.retryRequests); return; }
    bar.hide();
}

function onQueue({ type, job, info, result, error }) {
    // 채팅 전부 번역 중이면 멈추기 · 누르기는 채팅 전부 번역의 것(onBatch 가 적어 둔 batchShown)이고, 몇 번째 답인지를 같이 보인다
    const running = progress => bar.showRunning(batchShown
        ? { ...progress, ...batchShown }
        : { ...progress, onStop: () => queue.stop(job.guard.target()), onJump: () => jumpTo(job) });
    const alone = !batch.running();
    if (alone && type === 'start') running({});
    if ((alone || batchShown) && type === 'progress' && info?.type === 'pieces') running({ done: info.done, total: info.total });
    if (type === 'progress' && info?.type === 'retry') notice(`번역이 멈춰서 남은 부분을 다시 요청해요 (${info.count}/${info.of})`);
    if (type === 'end') { noteShown(job.guard.target()); onEnd(job, { result, error }); }
    // 받아서 적어 둔 답: 그새 그 채팅으로 돌아와 있으면 바로 붙인다(그 일이 줄에서 빠진 뒤라 지금 붙일 수 있다)
    if (type === 'end' && result?.away) attachReturned();
    if (type !== 'progress') {
        const id = job.guard.index();
        if (id >= 0) paintMessage(id); else paintAll();
    }
}

/** 매크로를 푼 원문 */
function sourceOf(message) {
    const c = context();
    return c.substituteParams(message.mes, c.name1, message.name);
}

/** 번역 일이 끝난 뒤: 번역이 붙어 있으면 그때의 원문을 적어 둔다(뒤에 그림 표시만 바뀐 것을 가리려고) */
function noteShown(message) {
    if (message && viewOf(message) !== 'none') noteAttached(message, sourceOf(message));
}

/**
 * 메시지가 바뀌었다는 신호: 번역이 붙은 답의 원문이 바뀌었으면 옛 글의 번역을 뗀다(그림 표시만 바뀌었으면 번역문의 그 자리만 바꾼다).
 * 뗀 번역은 store/edited.js 가 맡아 두고, 다시 번역할 때 글이 그대로인 문단에 쓴다.
 */
// 실리태번 메시지 수정에 들어간 메시지 번호. 수정을 끝내거나 취소하면 실리태번이 본문을 번역(display_text)이 아닌 원문(mes)으로 다시 그린다
// (public/script.js messageEditCancel · messageEditDone). 원문이 그대로면 번역 보기로 되돌려야 해서 들어간 것을 적어 둔다
const sourceEditing = new Set();

function onMessageUpdated(id) {
    const c = context(), message = c.chat?.[Number(id)];
    const fromEdit = sourceEditing.delete(Number(id));
    if (!message || queue.find(message)) return;
    const source = sourceOf(message);
    const done = sourceEdited(message, source, String(getStringHash(source)), holdFor(message));
    if (done === 'same') {
        if (fromEdit && viewOf(message) === 'shown') c.updateMessageBlock(Number(id), message);
        return;
    }
    c.updateMessageBlock(Number(id), message);
    paintMessage(Number(id));
    // 편집 저장은 실리태번이 이 신호 뒤에 저장한다. 그림 표시만 바뀐 것, 수정 밖에서 원문이 바뀐 것(다른 확장이 낸 신호)은 여기서 저장한다
    if (done === 'pictures' || (done === 'kept' && !fromEdit)) c.saveChat();
}

// ── 채팅 전부 번역 ──

/** 시작 전 화면에 보일 프롬프트와 모델 이름 */
function usingNow() {
    const c = context(), picked = gathered(), last = [...(c.chat || [])].reverse().find(m => m && !m.is_user && !m.is_system);
    const plan = last ? prepare({ context: c, settings: picked.settings, message: last, picked, memory, holdFor }) : null;
    return { prompt: plan?.promptTitle ?? '', model: modelOf(c, picked.settings) };
}

/** 끝난 뒤 한 번 알린다. 그 채팅이 열려 있지 않은 채 끝났으면 어느 채팅의 것인지와, 열면 붙는다는 것을 같이 알린다 */
function batchEnded({ done, failed, left, end, away, kept }, label) {
    bar.hide();
    const missed = failed ? ` ${failed}개는 못 했어요.` : '';
    const where = away && label ? `'${label}' 채팅의 ` : '';
    const tail = kept ? ' 그 채팅을 열면 붙어요.' : '';
    if (end === 'finished') notice(`${where}답 ${done - failed}개를 번역했어요.${missed}${tail}`);
    else notice(`${where}번역을 멈췄어요. 남은 답은 ${left}개예요.${missed}${tail}`);
    paintAll();
    attachReturned();
}

let batchLabel = '';   // 채팅 전부 번역을 시작한 채팅의 이름(끝 알림에 쓴다)
let batchShown = null;   // 채팅 전부 번역 중 진행 표시에 줄 것: { answers: { at, total }, onStop, onJump }

function onBatch(event) {
    if (event.type === 'start') batchLabel = context().groupId ? '' : context().name2 || '';
    if (event.type === 'end') { batchShown = null; batchEnded(event, batchLabel); return; }
    if (event.type !== 'message') return;
    const jump = () => document.querySelector(`#chat > .mes[mesid="${context().chat.indexOf(event.message)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    batchShown = { answers: { at: event.at, total: event.total }, onStop: () => batch.stop({ now: true }), onJump: jump };
    bar.showRunning(batchShown);
}

const batch = createBatch({
    chat: () => context().chat,
    chatKey: () => String(context().getCurrentChatId?.() ?? ''),
    translate: message => translate(message),
    stop: message => queue.stop(message),
    pin: holdChat,
    translateAway: (message, pin) => translate(message, pin),
    locate: (message, index) => findAgain(context().chat, message, index),
    prepare: planFor, known: remembered, using: usingNow, onEvent: onBatch,
});

// ── 다시 번역 ──

/** 이번 말투를 그 사람의 말투로 적어 둔다(그 사람이 저장된 쓰는 곳에, 없으면 이 캐릭터의 채팅 전체에) */
function saveTone(name, tone) {
    const person = layers.view().people.find(p => p.ko === name || (p.names || []).includes(name));
    if (!person) return;
    const { place, places, ...plain } = person;
    layers.savePerson({ ...plain, style: tone }, place === 'chat' ? 'chat' : 'card');
}

/** 다시 번역 판에 줄 것(ui/panel/open.js 의 api.redo 꼴) */
async function redoFor(message) {
    await layers.ready();
    const c = context(), settings = gathered().settings;
    const save = async target => { c.updateMessageBlock(c.chat.indexOf(target), target); paintAll(); await c.saveChat(); };
    const redo = redoOf(message, {
        prepare: planFor, save, saveTone, hash: getStringHash,
        substitute: text => context().substituteParams(text),
        // 적어 둔 다시 번역 프롬프트(store/redo-prompts.js). 비었으면 평소 번역 프롬프트로 보낸다. 앞 대화 자리는 비운다
        redoPrompt: () => context().substituteParams(fillSlot(readRedoPrompt(layers.view()).text)),
        // 번역 버튼의 보내기와 같은 차례: 프리필 → 띄어쓰기 대신 쓴 글자 바꾸기 → 거절 가리기(job/run.js translateMessage)
        send: refusalFilter(spacedSender(prefillSender(c, settings), spacersFor(message))),
        stallRetries: settings.stallRetries,
        connection: () => connectionMark(readSettings(context().extensionSettings)) + '|' + layers.mark(),
    });
    return {
        data: redo.data, onWho: redo.onWho,
        go: choice => queue.add(redo.job(choice, guards.capture(message, { sameText: picturesOnly })), message),
        undoState: () => undoState(message),
        undo: async () => { if (undoRedo(message)) await save(message); },
    };
}

function openRedo(message, picked = []) {
    if (queue.find(message)) { notice('번역하는 중에는 재번역할 수 없어요.'); return; }
    if (viewOf(message) === 'none') { notice('재번역할 번역이 없어요. 먼저 번역해 주세요.'); return; }
    panels.openRedo(message, { picked });
}

// ── 버튼 ──

/** 원문과 번역 바꾸기: 요청을 보내지 않는다 */
function swap(id, message) {
    const c = context();
    const done = viewOf(message) === 'shown'
        ? showOriginal(message, c.substituteParams(message.mes, c.name1, message.name))
        : showTranslation(message);
    if (!done) return;
    c.updateMessageBlock(id, message);
    paintMessage(id);
}

function pressFirst(id) {
    const message = context().chat?.[id];
    if (!message) return;
    // 번역하는 중이면 멈추기만 한다. 곧바로 다시 요청하지 않는다(끊은 요청을 공급자가 처리 중이면 두 번 청구된다)
    if (queue.stop(message)) return;
    if (booked?.message === message) { unbook(); notice('번역 예약을 풀었어요.'); return; }
    if (writing(id, message)) { book(id, message); return; }
    if (viewOf(message) !== 'none') { swap(id, message); return; }
    translate(message);
}

async function erase(id) {
    const c = context(), message = c.chat?.[id];
    if (!message) return;
    if (queue.find(message)) { notice('번역하는 중에는 지울 수 없어요.'); return; }
    if (viewOf(message) === 'none') { notice('지울 번역이 없어요.'); return; }
    show?.closeEdit();
    await forgetMemory(message);
    detach(message);
    c.updateMessageBlock(id, message);
    paintMessage(id);
    await c.saveChat();
}

/** 번역을 지울 때 그 답의 문단 번역 기억도 지운다(지운 뒤 번역을 누르면 요청 없이 같은 번역이 다시 붙지 않게) */
async function forgetMemory(message) {
    await layers.ready();
    const plan = planFor(message);
    if (plan) await forget(plan);
}

/** 번역을 손으로 고쳐 저장했을 때 바뀐 문단을 문단 번역 기억에 적는다 */
async function rememberEdit(message, { pairs, before, after }) {
    await layers.ready();
    const plan = planFor(message);
    if (plan) await rememberEdited(plan, pairs, before, after);
}

/** 이 채팅의 번역을 지운 뒤: 화면에 올라와 있는 메시지만 다시 그린다 */
function redrawCleared(ids) {
    const c = context();
    show?.closeEdit();
    for (const id of ids) if (document.querySelector(`#chat > .mes[mesid="${id}"]`)) c.updateMessageBlock(id, c.chat[id]);
    paintAll();
}

/** 이 채팅 번역 모두 지우기(job/clear.js). 번역 기억은 그대로 둔다: 설정 판의 '이 채팅 것 비우기'가 따로 있다 */
const clearAll = createClear({
    chat: () => context().chat,
    busy: () => queue.size() > 0 || Boolean(batch.running()) || Boolean(booked),
    redraw: redrawCleared,
    save: () => context().saveChat(),
});

// ── 보기 방식과 수정 화면 ──

/** 그 메시지에 걸리는 화면용 정규식: 그 메시지를 만들 때 켜져 있던 목록을 아는 기능이 있으면 그것, 없으면 지금 켜진 목록 */
const scriptsFor = id => globalThis[Symbol.for('preset-regex-keep')]?.scriptsFor?.(id) ?? getRegexScripts({ allowedOnly: true });

/**
 * 그 메시지의 뺄 글 규칙: 설정의 규칙에, 사용자가 '원문으로 볼 정규식' · '통째로 가릴 정규식'으로 골라 둔 화면용 정규식의 블록(rules/kept.js)과
 * 화면용 정규식의 틀(rules/frame.js)을 더한다.
 * 번역 재료와 화면의 문단 짝이 같은 규칙으로 글을 나누게 둘 다 이것을 쓴다.
 */
function holdFor(message) {
    const c = context();
    return holdRulesFor(c, scriptsFor(c.chat?.indexOf(message) ?? -1), message);
}

/** 그 채팅(c)의 그 답에 걸리는 화면용 정규식 목록(scripts)으로 만든 뺄 글 규칙. 붙잡아 둔 채팅의 답에도 같은 것을 쓴다(holdChat) */
function holdRulesFor(c, scripts, message) {
    const source = c.substituteParams(message.mes, c.name1, message.name);
    const kept = keptRules(c.extensionSettings, scripts, source);
    // 그 답을 그리는 정규식이 글자 그대로 찾는 틀 · 칸 이름 · 【…】(rules/frame.js)
    const frame = frameRules(c.extensionSettings, scripts, source);
    return holdRules(readSettings(c.extensionSettings), c, [...kept, ...frame]);
}

/** 그 답을 그리는 정규식 가운데 띄어쓰기 대신 쓴 글자를 띄어쓰기로 되돌리는 것(rules/spacer.js) */
const spacersFor = message => spacerRules(scriptsFor(context().chat?.indexOf(message) ?? -1));

// 원문 칸에 살려 둘 글자 꾸밈 태그(굵게, 기울임, 밑줄, 인용, 줄바꿈). 그 밖의 태그는 글자만 남긴다
const TEXT_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'q', 'br', 'span'];
const cleanHtml = html => globalThis.SillyTavern?.libs?.DOMPurify?.sanitize(html, { ALLOWED_TAGS: TEXT_TAGS, ALLOWED_ATTR: [] }) ?? '';

function mountMessages() {
    ui = mountButtons({ stateOf, on: { first: pressFirst, edit: id => show.edit(id), erase, settings: () => panels.openSettings() } });
    show = mountShow({
        context, guards, scripts: scriptsFor, clean: cleanHtml,
        view: () => viewSetting,
        hold: holdFor,
        busy: message => Boolean(queue.find(message)),
        onRedo: openRedo, onErase: forgetMemory, onEdited: rememberEdit,
        onSaved: id => ui.paint(document.querySelector(`#chat > .mes[mesid="${id}"]`)),
    });
}

// ── 실리태번 신호 ──

const readView = () => { viewSetting = layers.view().settings.view ?? DEFAULT_VIEW; };
/** 쓰는 곳 셋을 다 읽은 뒤: 보기 설정을 읽고 메시지들을 다시 그린다 */
const showAgain = () => { readView(); paintAll(); };

function onChatChanged() {
    show?.closeEdit();
    // 쓰는 곳 셋(이 채팅의 보기 설정)을 다 읽은 뒤에 보기 방식을 그린다
    layers.ready().then(showAgain);
    // 이 채팅에 남은 옛 상태창 번역을 캐릭터의 기록에 보태고(없는 줄만, 채팅 파일은 저장하지 않는다) 상태창 번역이 바로 쓰게 넘긴다
    store.takeChat().then(added => added && screen?.takeChat()).catch(error => console.warn('[번역] 이 채팅의 옛 상태창 번역을 받아 오지 못했어요', error));
    if (!guards.chatChanged()) return;
    unbook();
    // 번역은 다른 채팅으로 가도 계속 받는다: 진행 표시와 멈추기 버튼을 그대로 둔다
    if (!batch.running() && !queue.size()) bar.hide();
    else if (queue.running()?.guard?.away?.()) notice('번역은 계속 받고 있어요. 그 채팅을 다시 열면 붙어요. 멈추려면 진행 표시의 멈추기를 누르세요.');
    attachReturned();
}

/** 다른 채팅에 있는 동안 받은 번역을 붙인 뒤: 그 답을 다시 그리고, 요청 없이 붙였다고 알린다(api.js 의 번역 끝 신호와 같은 꼴) */
function onReturned(id, message) {
    const c = context();
    noteShown(message);
    c.updateMessageBlock(id, message);
    paintMessage(id);
    if (doneSignal) c.eventSource.emit(doneSignal, { by: 'llmt', messageId: id, chatId: c.getCurrentChatId?.() ?? '', type: 'translation', translator: null, cached: true });
}

/** 지금 채팅에 적어 둔 답(다른 채팅에 있는 동안 받은 번역)을 번역 기억에서 붙인다. 요청을 보내지 않는다(job/away.js) */
const attachReturned = createReturn({
    context, later, ready: () => layers.ready(), planFor, hash: getStringHash,
    kept: row => keptAnswer(memory, row), forgetKept: rows => forgetKept(memory, rows),
    busy: message => Boolean(queue.find(message)) || booked?.message === message,
    onAttached: onReturned,
});

function listen() {
    const { eventSource, eventTypes } = context();
    const repaint = id => paintMessage(Number(id));
    eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
    eventSource.on(eventTypes.MESSAGE_EDITED, id => { guards.messageChanged(id); repaint(id); });
    // 스와이프로 넘긴 것은 번역을 끊지 않는다: 번역하던 스와이프의 글이 그대로인지는 붙잡은 쪽이 스스로 본다(job/guard.js otherSwipe)
    eventSource.on(eventTypes.MESSAGE_SWIPED, repaint);
    eventSource.on(eventTypes.MESSAGE_UPDATED, id => { onMessageUpdated(id); repaint(id); });
    for (const type of [eventTypes.CHARACTER_MESSAGE_RENDERED, eventTypes.USER_MESSAGE_RENDERED]) eventSource.on(type, repaint);
    for (const type of [eventTypes.MESSAGE_DELETED, eventTypes.MORE_MESSAGES_LOADED]) eventSource.on(type, paintAll);
    // 실리태번 메시지 수정(연필)에 들어가는 것: 잡는 단계에서 번호만 적는다(onMessageUpdated 가 읽는다)
    document.getElementById('chat')?.addEventListener('click', event => {
        const mes = event.target.closest?.('.mes_edit') && event.target.closest('.mes');
        if (mes) sourceEditing.add(Number(mes.getAttribute('mesid')));
    }, true);
    // 캐릭터 이름을 바꾸면 캐릭터 파일 이름이 바뀐다: 그 이름으로 묶인 번역 자료를 새 이름으로도 적는다(다 적은 뒤에 실리태번이 새 이름으로 다시 연다)
    if (eventTypes.CHARACTER_RENAMED) eventSource.on(eventTypes.CHARACTER_RENAMED, (from, to) => store.renamed(String(from ?? ''), String(to ?? '')));
}

/** 내 글 번역(보낼 때 번역해 보내기, 입력창 옆 버튼으로 입력창 글 번역: ui/input/start.js)을 켠다. 못 켜도 답 번역은 돈다 */
function startInput() {
    import('./ui/input/start.js')
        .then(input => input.install({ context, guards, layers, translate, hash: getStringHash }))
        .catch(error => console.warn('[번역] 내 글 번역을 켜지 못했어요', error));
}

async function start() {
    loadStyle();
    store.startFromOrigin();   // 원작 확장의 설정만 있는 설치본이면 그 설정으로 시작한다(store/migrate.js)
    installWordReplacements(context());   // 번역문에서 바꿀 낱말 목록을 번역문 붙이는 길에 잇는다(store/word-replacements.js). 목록은 쓸 때마다 설정에서 읽는다
    panels.usePanels({ layers, memory, status: store.status, books: store.books, batch, redo: redoFor, clearAll, onView: () => { readView(); show?.refresh(); } });
    mountMessages();
    queue.listen(onQueue);
    import('./api.js').then(api => { doneSignal = api.DONE; api.start({ queue, context, layers, inBatch: () => Boolean(batch.running()) }); }, error => console.warn('[번역] 번역 끝 신호를 켜지 못했어요', error));   // 다른 기능이 듣는 번역 끝 신호(api.js). 못 켜도 번역은 돈다
    import('./screen/start.js').then(module => { screen = module.startScreen({ queue, context, layers, status: store.status }); }, error => console.warn('[번역] 상태창 번역을 켜지 못했어요', error));   // 상태창 번역과 카드 한글 글꼴(screen/start.js). 못 켜도 본문 번역은 돈다
    import('./ui/rename.js').then(rename => rename.startRename({ context, hash: getStringHash, hold: holdFor }), error => console.warn('[번역] 채팅 기록 이름 바꾸기를 켜지 못했어요', error));   // 채팅 글 속 이름 바꾸기(ui/rename.js). 못 켜도 번역은 돈다
    import('./store/mirror.js').then(mirror => mirror.mirrorStyles(layers, context), error => console.warn('[번역] 옛 자리에 말투를 같이 적는 것을 켜지 못했어요', error));   // 사람의 말투를 옛 자리에도 같이 적기(store/mirror.js)
    startInput();
    listen();
    layers.ready().then(showAgain);
    attachReturned();   // 새로고침 전에 다른 채팅에 있는 동안 받아 둔 번역
    console.info('[번역] 새 번역기를 켰어요');
}

/**
 * 번역 설정 첫 화면을 넘겨받은 칸에 그린다(breeze 설정 창의 번역 칸, 확장 창의 '번역' 줄).
 * 떠 있는 판을 열지 않고 그 자리에서 고친다. 칸이 화면에 보일 때 그린다(ui/panel/open.js mountInline).
 * @param {HTMLElement} host  @returns {{ close(): void }}
 */
export function fillOptions(host) {
    return panels.mountInline(host);
}

/** 시작이 끝나면 풀리는 약속 */
export const ready = start();
