// 채우기 화면(시안 t2-settings-plan.html 의 채우기 결과): 첫 화면의 '채우기' 버튼이 여는 화면.
// 버튼 하나, 요청 한 번으로 카드 · 월드인포 · 번역된 답을 재료로 사람과 용어를 같이 찾는다(job/terms-find.js).
// 찾은 것은 저장하지 않고 줄마다 체크로 고르게 한 뒤 '고른 N개 넣기'로 넣는다: 사람은 사람 목록으로, 용어는 용어집으로.
// 요청은 사용자가 누른 때만 나간다: 화면이 다시 그려지는 것만으로는 보내지 않는다(찾는 중 · 찾은 것은 화면 밖에 들고 있는다).

import { registerScreen } from './screens.js';
import { esc } from './text.js';
import { ownerOf } from '../../job/sources.js';
import { find, apply } from '../../job/terms-find.js';
import { SETTINGS_KEY } from '../../store/settings.js';

// 번역된 답의 대사 짝까지 재료에 싣는 갈래. 번역된 답이 없으면 카드 · 월드인포만 실려 한 요청으로 둘을 다 한다
const MODE = 'translated';
const LEVELS = /존댓말|반말|하오체|하게체|해요체|합쇼체|해라체|하십시오체/;

const contextOf = api => (typeof api.context === 'function' ? api.context() : api.context ?? SillyTavern.getContext());
const notice = (text, kind = 'info') => globalThis.toastr?.[kind]?.(text, '', { timeOut: 3500 });
const icon = name => `<i class="fa-solid fa-${name}" aria-hidden="true"></i>`;

// 찾는 일 하나: 화면을 다시 그리거나 다른 화면에 다녀와도 이어지게 화면 밖에 둔다
// step: 'idle' 아직 안 누름 | 'busy' 찾는 중 | 'done' 찾은 것을 고르는 중 | 'stopped' | 'error'
const job = { step: 'idle', rows: [], off: new Set(), stamp: '', cut: false, error: '', abort: null, chat: '', onChange: null };

function reset() {
    Object.assign(job, { step: 'idle', rows: [], off: new Set(), stamp: '', cut: false, error: '', abort: null, chat: '' });
}

/** 번역에 쓸 연결 프로필이 골라져 있고 지금도 있는가 */
function hasConnection(context, layers) {
    const es = context.extensionSettings ?? {};
    const id = layers.view().settings.model || es[SETTINGS_KEY]?.connection_profile_id || '';
    return Boolean(id) && (es.connectionManager?.profiles ?? []).some(profile => profile.id === id);
}

async function start(api) {
    if (job.step === 'busy') return;
    const context = () => contextOf(api);
    reset();
    Object.assign(job, { step: 'busy', abort: new AbortController(), chat: context().getCurrentChatId?.() ?? '' });
    job.onChange?.();
    const mine = job.abort;
    try {
        const found = await find({ context, layers: api.layers, mode: MODE, signal: mine.signal });
        if (job.abort !== mine) return;      // 멈춘 뒤에 온 답은 버린다
        Object.assign(job, { step: 'done', rows: found.rows, stamp: found.stamp, cut: found.cut, off: new Set(found.rows.filter(row => !row.on).map(row => row.id)) });
    } catch (error) {
        if (job.abort !== mine) return;
        Object.assign(job, mine.signal.aborted ? { step: 'stopped' } : { step: 'error', error: error?.message || '찾지 못했어요.' });
    }
    job.onChange?.();
}

function stop() {
    job.abort?.abort();
    Object.assign(job, { step: 'stopped', abort: null });
    job.onChange?.();
}

// ── 그리기 ──

// 요청 수는 누를 버튼 바로 옆에(글 줄 끝에 두면 버튼과 멀리 떨어져 무엇의 요청 수인지 몰랐다)
const startButton = label => `<div class="btns fstart"><button type="button" class="go sm line fillb" data-act="start"><i class="fa-solid fa-list-check" aria-hidden="true"></i>${label}</button><small class="fcost">요청 1번</small></div>`;

/** 사람 줄의 말투 딱지: 찾은 말투 글에서 높임의 갈래만 */
const levelOf = style => LEVELS.exec(String(style ?? ''))?.[0] ?? '';

function candHtml(row, view) {
    const on = !job.off.has(row.id), person = row.kind === 'person';
    const have = person && row.have ? view.people.find(p => p.id === row.have) : null;
    const korean = person ? row.fills.ko || have?.ko || '' : row.dst;
    const level = person ? levelOf(row.fills.style || have?.style) : '';
    return `<div class="cand${on ? '' : ' offc'}" role="checkbox" tabindex="0" aria-checked="${on}" data-cand="${esc(row.id)}"><span class="chk${on ? '' : ' off'}">${on ? icon('check') : ''}</span><em>${esc(row.src)}</em><b>${esc(korean)}</b>${level ? `<span class="bdg">${level}</span>` : '<span></span>'}</div>`;
}

function groupHtml(iconName, name, rows, view) {
    if (!rows.length) return '';
    return `<div class="gh">${icon(iconName)}${name}<small>${rows.length}</small></div><div class="card">${rows.map(row => candHtml(row, view)).join('')}</div>`;
}

function doneHtml(view) {
    const people = job.rows.filter(row => row.kind === 'person'), terms = job.rows.filter(row => row.kind === 'term');
    const picked = job.rows.length - job.off.size;
    if (!job.rows.length) return '<div class="note">새로 찾은 사람이나 용어가 없어요.</div><div class="btns fend"><button type="button" class="go sm line" data-act="close">닫기</button></div>';
    return `<div class="fnote"><span>찾은 것 가운데 체크한 것만 넣어요</span><small>요청 1번</small></div>
${job.cut ? '<div class="note">답이 중간에 끊겨서 끝까지 온 것만 보여요.</div>' : ''}
${groupHtml('user-group', '사람', people, view)}${groupHtml('book', '용어', terms, view)}
<div class="btns fend"><button type="button" class="go sm line" data-act="close">닫기</button><button type="button" class="go sm fill" data-act="apply"${picked ? '' : ' disabled'}>고른 ${picked}개 넣기</button></div>`;
}

function bodyHtml(api) {
    const context = contextOf(api);
    if (!ownerOf(context) || !context.getCurrentChatId?.()) return '<div class="note">채팅을 열면 채울 수 있어요.</div>';
    if (job.step === 'busy') return `<div class="fwait"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>카드 · 월드인포 · 번역된 답에서 사람과 용어를 찾는 중이에요</span><button type="button" class="go sm line" data-act="stop">멈추기</button></div>`;
    if (job.step === 'done') return doneHtml(api.layers.view());
    if (!hasConnection(context, api.layers)) return '<div class="note">연결을 먼저 골라 주세요. 채우기는 번역과 같은 연결로 한 번 요청해요.</div>';
    // 이미 넣어 둔 것이 있으면 빈 첫 모습 대신 지금 있는 수와, 새로 나온 것만 더 찾는다는 것을 보인다
    const view = api.layers.view(), have = view.people.length + view.names.length;
    // 수는 저장해 둔 것만 센다(첫 화면 '나온 사람들'은 아직 저장하지 않은 새 이름까지 보여 수가 다르다)
    const idle = have ? `지금 저장된 사람은 ${view.people.length}명, 용어는 ${view.names.length}개예요. 새로 나온 것만 더 찾아요.` : '카드 · 월드인포 · 번역된 답에서 사람과 용어를 한 번에 찾아요.';
    const said = { stopped: '멈췄어요. 넣은 것은 없어요.', error: job.error, idle }[job.step];
    return `<div class="fnote"><span>${esc(said)}</span></div>${startButton(have ? '더 찾기' : '채우기')}`;
}

// ── 화면 ──

function render(box, api, args = api.args) {
    const root = Object.assign(document.createElement('div'), { className: 'fillscreen' });
    box.append(root);
    const paint = () => { root.innerHTML = bodyHtml(api); };
    /** 이 화면을 떠난다: 틀이 뒤로 가기를 주면 그것으로, 아니면 용어집으로 */
    const leave = () => (api.back ? api.back() : api.open?.('terms'));

    // 다른 채팅에서 찾은 것은 보이지 않는다(넣을 때도 job/terms-find.js 가 막는다)
    if (job.step !== 'idle' && job.chat !== (contextOf(api).getCurrentChatId?.() ?? '')) { job.abort?.abort(); reset(); }
    job.onChange = paint;

    function applyPicked() {
        const rows = job.rows.filter(row => !job.off.has(row.id));
        try {
            const done = apply(api.layers, () => contextOf(api), rows, { place: 'card', stamp: job.stamp });
            notice(`사람 ${done.people + done.filled}명, 용어 ${done.terms}개를 넣었어요.`);
        } catch (error) { notice(error?.message || '넣지 못했어요.', 'warning'); return; }
        reset();
        api.refresh?.();
        leave();
    }

    const ACTS = { start: () => start(api), stop, apply: applyPicked, close: () => { reset(); paint(); leave(); } };

    function onClick(event) {
        const act = event.target.closest('[data-act]'), cand = event.target.closest('[data-cand]');
        if (act) ACTS[act.dataset.act]?.();
        else if (cand) {
            const id = cand.dataset.cand;
            if (!job.off.delete(id)) job.off.add(id);
            paint();
        }
    }
    function onKey(event) {
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-cand]')) { event.preventDefault(); event.target.click(); }
    }

    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    paint();
    // 첫 화면의 채우기 버튼이 연 때(args.start)만, 아직 한 번도 안 보낸 상태에서만 바로 찾기 시작한다.
    // 멈췄거나 실패한 뒤에 화면이 다시 그려져도 요청이 저절로 또 나가지 않는다(그때는 이 화면의 채우기 버튼으로)
    if (args?.start && job.step === 'idle' && hasConnection(contextOf(api), api.layers)) start(api);
    return { refresh: paint, close() { if (job.onChange === paint) job.onChange = null; root.remove(); } };
}

registerScreen('fill', { title: '채우기', icon: 'list-check', summary: () => '', render });
