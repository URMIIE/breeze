// 사람 화면과 새 이름 화면(시안 t2-settings-plan-more.html 의 '사람' 탭).
// 사람: 머리(그림 또는 사람 모양 + 더하기, 이름) → 이름(원문 → 한글) · 원문의 다른 표기 → 말투(누구에게나 / 상대별) · 상대 더하기
//       → 그 사람의 대사 한 줄 → 쓰는 곳 셋 → 저장 · 그 사람 대사 다시 번역 · 이 사람 지우기.
// 새 이름: 번역에 나온 표기가 미리 든 이름 칸, 사람인지 아닌지, 쓰는 곳, 이 표기로 저장, 목록에서 빼기.
// 그림: 저절로 잡히는 사람(카드의 캐릭터 · 그룹 멤버 · 페르소나와 같은 이름)은 그 그림. 머리의 동그라미를 누르면 그 아래로 펼쳐져
//       내 캐릭터 카드 그림에서 고르기 · 파일 올리기 · 그림 빼기. 사람의 다른 값과 같은 쓰는 곳에 그림의 주소(face)만 적는다.
// 고친 내용은 이 화면 안에만 들고 있다가 저장 버튼을 누를 때 한 번에 적는다.

import { registerScreen } from './screens.js';
import { esc, SV } from './text.js';
import { peopleOf, personFrom } from './open-data.js';
import { ownerOf } from '../../job/sources.js';
import { hashOf } from '../../store/layers.js';
import { fold } from '../../core/find.js';
import { viewOf } from '../../store/message.js';

const PLACE_NAMES = { all: '모든 채팅', card: '이 캐릭터', chat: '지금 채팅만' };
const PLACE_ORDER = ['all', 'card', 'chat'];
const FACE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
// 고르는 그림 줄에 한 번에 보일 카드 수: 휴대폰 폭(358)에 36px 동그라미가 8 간격으로 한 줄에 들어가는 수

const contextOf = api => (typeof api.context === 'function' ? api.context() : api.context ?? SillyTavern.getContext());
const toast = (text, kind = 'info') => globalThis.toastr?.[kind]?.(text, '', { timeOut: 3500 });
const icon = (name, cls = '') => `<i class="fa-solid fa-${name} ${cls}" aria-hidden="true"></i>`;
const targetLabel = to => (to ? `${to}에게` : '누구에게나');

// ── 그림 ──

const thumbOf = (context, type, file) => context.getThumbnailUrl?.(type, file) ?? `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`;

/** 지금 채팅의 캐릭터들(그룹이면 멤버 전부) */
function cardsOf(context) {
    if (!context?.groupId) return [context?.characters?.[context?.characterId]].filter(Boolean);
    const members = ownerOf(context)?.members ?? [];
    return members.map(avatar => context.characters?.find(c => c?.avatar === avatar)).filter(Boolean);
}

/** 페르소나 이름 → 그 페르소나의 그림 파일 */
function personaFile(context, keys) {
    const personas = context?.powerUserSettings?.personas ?? {};
    return Object.keys(personas).find(file => keys.has(fold(personas[file]))) ?? '';
}

/**
 * 사람의 그림 주소. 따로 넣은 그림(face)이 먼저고, 없으면 저절로 잡히는 그림: 이 채팅의 캐릭터(그룹 멤버)와 같은 이름이면 그 카드 그림,
 * 페르소나와 같은 이름이면 페르소나 그림. 없으면 ''.
 * @param {object} person 쓰는 곳 층의 사람({ names, ko, face }) 또는 화면의 사람 줄({ src, name, alts, face })
 * @param {object} context 실리태번 getContext()
 * @returns {string}
 */
export function faceOf(person, context) {
    if (person?.face) return String(person.face);
    const names = [...(person?.names ?? []), person?.src, person?.name, person?.ko, ...(person?.alts ?? [])];
    const keys = new Set(names.map(fold).filter(Boolean));
    if (!keys.size) return '';
    const card = cardsOf(context).find(c => keys.has(fold(c.name)));
    if (card?.avatar && card.avatar !== 'none') return thumbOf(context, 'avatar', card.avatar);
    const persona = personaFile(context, keys);
    return persona ? thumbOf(context, 'persona', persona) : '';
}

/** 파일을 user/files 에 올리고 주소를 돌려준다. 이름: 하는 일의 영어 이름 + 그 사람의 지문 */
async function uploadFace(context, file, key) {
    const ext = FACE_TYPES[file.type];
    if (!ext) throw new Error('png · jpg · webp · gif 그림만 올릴 수 있어요.');
    const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('파일을 읽지 못했어요.'));
        reader.readAsDataURL(file);
    });
    const name = `translation-person-face-${hashOf(key)}.${ext}`;
    const res = await fetch('/api/files/upload', { method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify({ name, data }) });
    if (!res.ok) throw new Error(`그림을 올리지 못했어요 (${res.status})`);
    return (await res.json().catch(() => null))?.path ?? `/user/files/${name}`;
}

// ── 그리기 ──

function faceHtml(url) {
    // 주소는 이미 인코딩된 것이다(getThumbnailUrl · encodeURIComponent): 한 번 더 encodeURI 하면 % 가 %25 로 바뀌어 이름에 띄어쓰기가 든 그림이 404 였다
    if (url) return `<span class="face pic" style="background-image:url(&quot;${esc(url)}&quot;)"></span>`;
    return `<span class="face icon">${icon('user')}<b class="plus">${icon('plus')}</b></span>`;
}

function headHtml(draft, isNew, url, open) {
    return `<button type="button" class="phead" data-act="pic" aria-expanded="${open}" aria-label="그림 넣기">${faceHtml(url)}<div><b class="pname">${esc(draft.name || draft.src)}</b>${isNew ? '<div class="pnew">새 이름</div>' : ''}</div></button>`;
}

/** 고를 카드: 이 채팅의 캐릭터 먼저, 그다음 최근에 대화한 차례. 찾는 글이 있으면 이름에 그 글이 든 것만 */
function pickCards(context, query) {
    const here = new Set(cardsOf(context).map(c => c.avatar)), recent = c => Number(c.date_last_chat) || 0;
    return (context.characters ?? [])
        .filter(c => c?.avatar && c.avatar !== 'none' && (!query || fold(c.name).includes(query)))
        .sort((a, b) => (here.has(b.avatar) - here.has(a.avatar)) || recent(b) - recent(a));
}

/** 카드 그림 하나: 그림과 그 아래 이름(그림만으로는 누구인지 모른다. 휴대폰에는 마우스 올리기가 없다) */
function thumbHtml(context, card, picked) {
    const url = thumbOf(context, 'avatar', card.avatar);
    return `<span role="button" tabindex="0" class="thumb${picked === url ? ' s' : ''}" data-face="${esc(url)}" aria-label="${esc(card.name)}"><img src="${esc(url)}" alt="" loading="lazy" decoding="async"><small>${esc(card.name)}</small></span>`;
}

function thumbsHtml(state, context) {
    const cards = pickCards(context, fold(state.query));
    const inner = cards.length ? cards.map(card => thumbHtml(context, card, state.draft.face)).join('') : '<span class="none">찾는 이름의 캐릭터가 없어요</span>';
    return `<div class="thumbs">${inner}</div>`;
}

function picHtml(state, context) {
    return `<div class="picbox"><div class="lab">${icon('image', 'lic')} 내 캐릭터 카드 그림에서 고르기</div>
<input type="text" class="input" data-field="query" placeholder="캐릭터 이름으로 찾기" value="${esc(state.query)}" aria-label="캐릭터 이름으로 찾기">
${thumbsHtml(state, context)}
<div class="btns"><button type="button" class="go sm line" data-act="upload">${icon('upload', 'rose')}&nbsp;파일 올리기</button><button type="button" class="go sm line" data-act="unpic"${state.draft.face ? '' : ' disabled'}>그림 빼기</button></div>
<div class="note">이 채팅의 캐릭터와 최근에 대화한 캐릭터부터 보여요.</div></div>`;
}

function nameHtml(draft) {
    // 두 칸이 무엇인지 칸 안의 흐린 글과 사이의 화살표로 보인다(이름표 오른쪽 끝에 따로 적으면 어느 칸이 어느 것인지 짝이 안 맞았다)
    return `<div class="lab">${icon('id-badge', 'lic')} 이름</div>
<div class="pair"><input type="text" class="input" data-field="src" value="${esc(draft.src)}" placeholder="원문 이름" aria-label="원문 이름"><span class="parrow" aria-hidden="true">→</span><input type="text" class="input" data-field="name" value="${esc(draft.name)}" placeholder="한글 표기" aria-label="한글 표기"></div>`;
}

function altsHtml(alts, adding) {
    const chips = alts.map((alt, i) => `<span class="chipx">${esc(alt)} <button type="button" data-alt="${i}" aria-label="${esc(alt)} 지우기">${SV('x')}</button></span>`).join('');
    const add = adding
        ? '<input type="text" class="input altin" data-field="alt" enterkeyhint="done" placeholder="다른 표기를 적고 Enter" aria-label="원문의 다른 표기">'
        : `<button type="button" class="add" data-act="alt-add">${SV('plus')}${alts.length ? '다른 표기 넣기' : '원문의 다른 표기 넣기'}</button>`;
    return `<div class="palts">${chips}${add}</div>`;
}


/** 말투 칸 처음 줄 수(글 길이로 어림). 글에 맞춰 늘어나는 것은 css(field-sizing)가 하고, 그것을 모르는 브라우저에서만 이 줄 수가 남는다 */
const toneRows = how => Math.min(5, 1 + Math.floor(String(how ?? '').length / 24));
/** 적는 동안 칸 높이를 글에 맞춘다: 한 줄 칸이면 몇 문장짜리 말투가 잘려 보였다(줄바꿈은 받지 않고 칸 안에서만 꺾인다) */
function fitTone(box) {
    if (CSS.supports('field-sizing', 'content') || !box.getClientRects().length) return;   // css 가 맞추거나, 아직 화면에 없어 잴 수 없다
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
}

function tonesHtml(state, others, said, wide) {
    const { tones } = state.draft;
    // 상대 칸은 고치는 칸이 아니라 이름표다(상대는 '상대 더하기'로 고른다). 줄 끝 x: 상대 줄은 줄째 빼고, '누구에게나' 줄은 적은 말투만 비운다
    const rows = tones.map((tone, i) => `<div class="pair ptonerow"><span class="ptarget">${esc(targetLabel(tone.to))}</span>
<textarea class="input ptonein" data-field="how" data-i="${i}" rows="${toneRows(tone.how)}" placeholder="비워 둠" aria-label="${esc(targetLabel(tone.to))} 말투">${esc(tone.how)}</textarea>
<button type="button" class="pdel${tone.to || tone.how ? '' : ' off'}" data-tone-del="${i}" aria-label="${esc(targetLabel(tone.to))} 말투 지우기">${SV('x')}</button></div>`).join('');
    const pick = state.picking ? `<div class="btns pto">${others.map(name => `<button type="button" class="go sm line" data-to="${esc(name)}">${esc(name)}</button>`).join('')}</div>` : '';
    const add = others.length ? `<button type="button" class="add" data-act="to-add" aria-expanded="${state.picking}">${SV('plus')}상대 더하기</button>` : '';
    const note = tones.filter(t => t.to).length > 1 ? '따로 적은 상대가 먼저예요.' : '원문에서 사이가 달라지면 적은 말투보다 원문을 따라요.';
    return `<div class="lab two2 ptone"><span>${icon('comment-dots', 'lic')} 말투</span><span>누구에게 → 어떤 말투</span></div>${rows}${add}${pick}
${said ? `<div class="demo psaid"><p>${esc(said)}</p></div>` : ''}${wide ? '' : `<div class="note">${note}</div>`}`;
}

function kindHtml(kind, seen) {
    const list = (seen ?? []).map(s => `'${s.text}' ${s.times}번`).join(', ');   // 번역에 이 이름이 어떤 표기로 몇 번 나왔는지
    const option = (id, label) => `<span role="button" tabindex="0" data-kind="${id}" class="${kind === id ? 's' : ''}">${label}</span>`;
    return `${list ? `<div class="note">번역에 나온 표기: ${esc(list)}</div>` : ''}<div class="lab">${icon('tags', 'lic')} 이 이름은</div><div class="seg h pkind">${option('person', '사람')}${option('thing', '사람이 아닌 이름')}</div>`;
}

function placeHtml(places, value, wide) {
    return `<div class="lab">${icon('location-dot', 'lic')} 쓰는 곳</div><div class="seg${wide ? ' h h3' : ''}">${places.map(place => `<span role="button" tabindex="0" data-place="${place}" class="${place === value ? 's' : ''}">${PLACE_NAMES[place]}</span>`).join('')}</div>`;
}

/** 새 이름: 지금 적은 표기와 다르게 나온 표기들 → 다시 번역할 문단 */
function otherSpellings(seen, name) {
    const other = (seen ?? []).filter(s => s.text !== name.trim());
    return { texts: other.map(s => `'${s.text}'`).join(', '), paras: other.reduce((sum, s) => sum + (s.paras || 0), 0) };
}

function tailHtml(draft, person, wide) {
    let redo = '';
    if (person.isNew) {
        const other = otherSpellings(person.seen, draft.name);
        if (other.paras) redo = `${wide ? '' : '저장하고 '}${esc(other.texts)} 문단 ${other.paras}개 재번역`;
    } else if (person.lines) redo = `${wide ? '' : '저장하고 '}${esc(draft.name || draft.src)} 대사 ${person.lines}개 재번역`;
    return `<div class="btns ptail"><button type="button" class="go sm solid" data-act="save">${person.isNew ? '이 표기로 저장' : '저장'}</button>${redo ? `<button type="button" class="go sm line" data-act="redo">${redo}</button>` : ''}</div>
<button type="button" class="quiet" data-act="remove">${person.isNew ? '이름이 아니에요, 목록에서 빼기' : '이 사람 지우기'}</button>`;
}

// ── 자료 ──

function draftOf(person, stored) {
    const tones = (person.tones ?? []).map(t => ({ to: t.to ?? '', how: t.how ?? '' }));
    if (!tones.some(t => !t.to)) tones.unshift({ to: '', how: '' });     // '누구에게나' 줄은 늘 맨 위에
    tones.sort((a, b) => (a.to ? 1 : 0) - (b.to ? 1 : 0));
    return {
        id: person.id, src: person.src ?? '', name: person.name ?? '', alts: [...(person.alts ?? [])], tones,
        place: stored?.place ?? 'card', kind: person.kind ?? 'person', face: stored?.face ?? '',
    };
}

// ── 그 사람 대사 다시 번역 ──

/**
 * 저장한 사람의 대사가 든 답 가운데 화면에 보이는 맨 끝 답을 찾아, 다시 번역 판을 그 대사가 골라진 채로 연다.
 * 요청은 그 판에서 사용자가 눌렀을 때만 나간다. 새 이름은 대사 주인이 아직 그 이름이 아닐 수 있어, 번역에 그 표기가 든 대사도 고른다.
 * @param {object} draft 이 화면에서 적은 것  @param {object} row 저장하기 전의 그 사람(open-data.js peopleOf 의 꼴)
 */
async function redoPerson(api, draft, row, notice) {
    const names = new Set([draft.name, draft.src, ...(draft.alts ?? []), row.name, row.src].map(fold).filter(Boolean));
    const spelled = row.isNew ? [row.name, ...(row.seen ?? []).map(seen => seen.text)].filter(Boolean) : [];
    const mine = line => [line.who].flat().some(name => names.has(fold(name))) || spelled.some(text => String(line.text).includes(text));
    const redo = api.tools?.redo, chat = contextOf(api).chat;
    if (!redo) { notice('저장했어요. 재번역은 메시지의 재번역 버튼으로 해 주세요.'); return; }
    const shown = [...document.querySelectorAll('#chat > .mes[mesid]')].map(el => Number(el.getAttribute('mesid'))).reverse();
    for (const at of shown) {
        const message = chat[at];
        if (!message || message.is_user || message.is_system || viewOf(message) === 'none') continue;
        const picked = (await redo(message)).data().rows.filter(line => line.said && mine(line)).map(line => line.at);
        if (!picked.length) continue;
        const panel = await import('./open.js');      // 다시 번역 판은 틀이 연다(누를 때만 불러와 서로 불러오는 고리를 피한다)
        await panel.openRedo(message, { picked });
        return;
    }
    notice('저장했어요. 화면에 보이는 번역에는 이 사람의 대사가 없어서 재번역할 답이 없어요.');
}

// ── 화면 ──

function render(box, api, args = api.args) {
    const id = typeof args === 'object' && args ? args.id : args;
    const root = Object.assign(document.createElement('div'), { className: 'pscreen' });
    const picker = Object.assign(document.createElement('input'), { type: 'file', accept: Object.keys(FACE_TYPES).join(','), hidden: true });
    box.append(root, picker);
    const { layers } = api;
    const context = () => contextOf(api);
    const wide = () => api.wide ?? Boolean(box.closest('.pop'));     // PC 창의 오른쪽 칸: 쓰는 곳을 가로로, 버튼 글을 짧게
    const notice = (text, kind = 'info') => (api.notice ?? toast)(text, kind);
    const state = { person: null, draft: null, query: '', picOpen: false, adding: false, picking: false };

    const rowsNow = () => peopleOf(context(), layers.view());
    const storedNow = () => layers.view().people.find(p => p.id === id);

    function load() {
        state.person = rowsNow().find(p => p.id === id) ?? { id, src: '', name: '', tones: [] };
        state.draft = draftOf(state.person, storedNow());
        Object.assign(state, { adding: false, picking: false });
    }

    const others = () => rowsNow().filter(p => !p.isNew && p.id !== id).map(p => p.name || p.src).filter(name => name && !state.draft.tones.some(t => t.to === name));
    const faceNow = () => faceOf({ ...state.draft, names: [state.draft.src] }, context());

    function paint(focus) {
        const { draft, person } = state, c = context();
        root.innerHTML = headHtml(draft, person.isNew, faceNow(), state.picOpen)
            + `<div class="fold ${state.picOpen ? 'on' : ''}"><div>${state.picOpen ? picHtml(state, c) : ''}</div></div>`
            + nameHtml(draft)
            + (person.isNew ? kindHtml(draft.kind, person.seen) : altsHtml(draft.alts, state.adding) + tonesHtml(state, others(), person.said, wide()))
            + placeHtml(PLACE_ORDER, draft.place, wide())
            + tailHtml(draft, person, wide());
        if (focus) root.querySelector(focus)?.focus({ preventScroll: true });
    }

    /** 저장할 사람: 이름과 말투는 open-data.js 의 꼴 바꾸기로, 그림 주소는 따로 넣은 것이 있을 때만 */
    function personToSave() {
        const draft = { ...state.draft, tones: state.draft.tones.filter(t => t.how.trim()).map(t => ({ to: t.to, how: t.how.trim() })) };
        const person = personFrom(draft, storedNow(), layers.view().people);
        if (state.draft.face) person.face = state.draft.face;
        return person;
    }

    function save() {
        const { draft } = state;
        try {
            if (draft.kind === 'thing') {
                if (!draft.src.trim()) { notice('원문 이름을 적어 주세요.'); return false; }
                layers.addName(draft.place, draft.src, draft.name);
                layers.ignoreName(draft.place, String(id).replace(/^new:/, ''));
            } else {
                const person = personToSave();
                if (!person.names.length && !person.ko) { notice('이름을 적어 주세요.'); return false; }
                layers.savePerson(person, draft.place);
            }
        } catch (error) { notice(error.message || '저장하지 못했어요.', 'warning'); return false; }
        api.refresh?.();
        return true;
    }

    function remove() {
        try {
            if (String(id).startsWith('new:')) layers.ignoreName(state.draft.place, String(id).slice(4));
            else {
                const stored = storedNow();
                if (!stored) { notice('저장된 사람이 아니라 지울 것이 없어요.'); return; }
                layers.removePerson(stored);
            }
        } catch (error) { notice(error.message || '지우지 못했어요.', 'warning'); return; }
        api.refresh?.();
        // 지운 사람의 화면에 머물지 않는다: 틀이 뒤로 가기를 주면 그것으로, 아니면 지웠다는 글만 남긴다
        if (api.back) api.back();
        else root.innerHTML = '<div class="note">목록에서 지웠어요.</div>';
    }

    function addAlt(input) {
        const text = input.value.trim(), { draft } = state;
        if (text && !draft.alts.includes(text) && text !== draft.src) draft.alts.push(text);
        state.adding = false;
        paint('[data-act="alt-add"]');
    }

    async function readPicked() {
        const file = picker.files?.[0];
        picker.value = '';
        if (!file) return;
        try { state.draft.face = await uploadFace(context(), file, `${ownerOf(context())?.key ?? ''}|${id}`); } catch (error) { notice(error.message, 'warning'); return; }
        paint();
    }

    /** 말투 줄 지우기: 상대 줄은 줄째 빼고, '누구에게나' 줄(늘 맨 위에 있는 줄)은 적은 말투만 비운다 */
    function removeTone(i) {
        const tone = state.draft.tones[i];
        if (!tone) return;
        if (tone.to) state.draft.tones.splice(i, 1); else tone.how = '';
        paint();
    }

    const ACTS = {
        pic: () => { state.picOpen = !state.picOpen; paint(); },
        upload: () => picker.click(),
        unpic: () => { state.draft.face = ''; paint(); },
        'alt-add': () => { state.adding = true; paint('[data-field="alt"]'); },
        'to-add': () => { state.picking = !state.picking; paint(); },
        save: () => { if (save()) { notice('저장했어요.'); (api.back ?? (() => { load(); paint(); }))(); } },
        // 다시 번역 판은 틀이 연다(요청은 그 판에서 눌렀을 때만 나간다)
        redo: () => { const row = state.person, draft = { ...state.draft }; if (save()) redoPerson(api, draft, row, notice); },
        remove,
    };

    function onClick(event) {
        const hit = name => event.target.closest(`[data-${name}]`);
        const act = hit('act'), face = hit('face'), alt = hit('alt'), to = hit('to'), kind = hit('kind'), place = hit('place'), toneDel = hit('tone-del');
        if (act) ACTS[act.dataset.act]?.();
        else if (toneDel) removeTone(Number(toneDel.dataset.toneDel));
        else if (face) { state.draft.face = face.dataset.face; paint(); }
        else if (alt) { state.draft.alts.splice(Number(alt.dataset.alt), 1); paint(); }
        else if (to) { state.draft.tones.push({ to: to.dataset.to, how: '' }); state.picking = false; paint(`[data-field="how"][data-i="${state.draft.tones.length - 1}"]`); }
        else if (kind) { state.draft.kind = kind.dataset.kind; paint(); }
        else if (place) { state.draft.place = place.dataset.place; paint(); }
    }

    // 칸에 적는 동안은 다시 그리지 않는다(커서를 지키려고). 이름이 바뀌면 머리와 버튼 글만, 찾는 글이 바뀌면 그림 줄만 고친다
    function onInput(event) {
        const t = event.target, field = t.dataset.field, { draft } = state;
        if (field === 'src' || field === 'name') {
            draft[field] = t.value;
            root.querySelector('.pname').textContent = draft.name || draft.src;
            root.querySelector('.ptail').nextElementSibling.remove();
            root.querySelector('.ptail').outerHTML = tailHtml(draft, state.person, wide());
        } else if (field === 'how') { draft.tones[Number(t.dataset.i)].how = t.value; fitTone(t); }
        else if (field === 'query') {
            state.query = t.value;
            const fresh = document.createElement('div');
            fresh.innerHTML = thumbsHtml(state, context());
            root.querySelector('.thumbs').replaceWith(fresh.firstElementChild);
        }
    }

    function onKey(event) {
        if (event.key !== 'Enter' || event.isComposing) return;
        if (event.target.dataset.field === 'how') event.preventDefault();   // 말투는 한 줄 글(요청의 사람 줄에 한 줄로 들어간다)
        else if (event.target.dataset.field === 'alt') { event.preventDefault(); addAlt(event.target); }
        else if (event.target.matches('[role="button"]')) { event.preventDefault(); event.target.click(); }
    }
    // 다른 표기 칸에서 벗어나면 적은 것을 넣고 닫는다
    function onBlur(event) {
        if (event.target.dataset?.field === 'alt' && state.adding) addAlt(event.target);
    }

    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKey);
    root.addEventListener('focusout', onBlur);
    picker.addEventListener('change', readPicked);
    load();
    paint();
    // 틀의 refresh 로는 다시 읽지 않는다: 적던 내용(저장 전)이 다른 화면의 고침에 지워지지 않게
    return { refresh() {}, close() { root.remove(); picker.remove(); } };
}

registerScreen('person', {
    title: '사람', icon: 'user', summary: () => '', render,
    face: person => faceOf(person, SillyTavern.getContext()),
});
