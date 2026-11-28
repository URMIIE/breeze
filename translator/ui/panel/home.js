// 번역 설정의 첫 화면(시안 t2-settings-plan.html 의 firstPhone 과 PC 창의 왼쪽 칸).
//   연결 / 번역 프롬프트 / 보기 / 내 규칙(값이 줄에 보임) → 나온 사람들(머리 옆 '채우기') → 용어집(줄 둘 + 용어집 열기) → 상태창 번역, 그 밖의 설정.
// 휴대폰(한 칸): 값은 줄 오른쪽에. 보기 · 내 규칙은 그 줄 아래에서 펴지고, 나머지는 판 안의 다음 화면으로 들어간다.
// PC(두 칸의 왼쪽): 값은 이름 아래 작은 글로. 줄을 누르면 오른쪽 칸이 바뀌고, 지금 오른쪽에 보이는 줄은 옅게 칠한다.
// 사람은 보이는 만큼만 그린다('더 보기'를 눌렀을 때 나머지를 그린다). 용어는 줄 둘만 보이고 나머지는 용어집 화면에 있다.
//
// mountHome(box, api) → { refresh(), close(), mark(id) }
//   api.layers                쓰는 곳 셋
//   api.wide(): boolean       두 칸의 왼쪽에 그려지는가
//   api.open(id, args)        화면 열기
//   api.shown(): string|null  지금 오른쪽 칸에 보이는 화면 id
//   api.inside(id, box)       그 화면을 box 안에 그린다(휴대폰의 그 자리 펼침) → { refresh?, close? }

import { screenOf } from './screens.js';
import { esc, SV, IC } from './text.js';
import { foldHtml, wire, setFold } from './motion.js';
import { peopleOf, connectionOf, castFaces, langNow, hasChat } from './open-data.js';
import { promptInUse, LANGUAGES } from '../../store/prompts.js';
import { fold as foldName } from '../../core/find.js';

const UNFOLDS = ['view', 'rules'];          // 휴대폰에서 그 줄 아래로 펴지는 화면
const PEOPLE_SHOWN = { phone: 3, pc: 2 }, TERMS_SHOWN = 2;
const FACE_ADD = '<i class="fa-solid fa-user" aria-hidden="true"></i><b class="plus"><i class="fa-solid fa-plus" aria-hidden="true"></i></b>';
const FOOT = [['status', '상태창 번역', 'table-list'], ['more', '그 밖의 설정', 'gear']];

function viewText({ main, when } = {}) {
    const self = main === 'src' ? '원문' : '번역', other = main === 'src' ? '번역' : '원문';
    if (!when || when === 'tap') return `누르면 아래에 ${other}`;
    if (when === 'bubble') return `누르면 말풍선으로 ${other}`;
    return `${self} (${when === 'every' ? '문단마다' : '대사에'} ${other} 붙임)`;
}

/** 위 네 줄의 값. 다른 화면이 summary 를 등록했으면 그 글을 쓴다 */
function values(context, layers) {
    const view = layers.view(), given = id => { try { return screenOf(id)?.summary?.(); } catch { return ''; } };
    const lang = hasChat(context) ? langNow(context) : LANGUAGES[0];
    return {
        connection: connectionOf(context, layers).label,
        prompts: promptInUse(context.extensionSettings, layers, lang).title,
        view: given('view') || viewText(view.settings.view),
        rules: given('rules') || (view.rules.length ? `${view.rules.length}개` : '없음'),
    };
}
const TOP = [['connection', '연결', 'plug'], ['prompts', '번역 프롬프트', 'pen-nib'], ['view', '보기', 'book-open'], ['rules', '내 규칙', 'scroll']];

function topHtml(v, wide, shown) {
    return TOP.map(([id, name, icon], i) => {
        const value = id === 'connection' && !v[id] ? '<V style="color:var(--rose)">프로필 없음</V>' : `<V>${esc(v[id])}</V>`;
        const line = i ? ' style="border-top:1px solid var(--hair)"' : '';
        if (wide) return `<div class="line${shown === id ? ' cur' : ''}" data-go="${id}" role="button" tabindex="0">${IC(icon)}<div class="k">${name}${value.replaceAll('V', 'small')}</div></div>`;
        const unfold = UNFOLDS.includes(id);
        return `<div class="line" ${unfold ? `data-t="${id}"` : `data-go="${id}"`} role="button" tabindex="0"${line}>${IC(icon)}<div class="k">${name}</div>${value.replace('<V', '<span class="v"').replace('</V>', '</span>')}${SV(unfold ? 'down' : 'right')}</div>${unfold ? foldHtml(id, false, '<div class="open" style="padding-top:10px;border-top:1px solid var(--hair)"></div>') : ''}`;
    }).join('');
}

/** 이름 뒤에 붙는 '로' / '으로': 받침이 없거나 ㄹ 받침이면 '로'. 한글로 끝나지 않으면 '(으)로' */
function toward(name) {
    const code = name.charCodeAt(name.length - 1) - 0xAC00;
    if (code < 0 || code > 11171) return '(으)로';
    return code % 28 === 0 || code % 28 === 8 ? '로' : '으로';
}

function toneText(person, wide) {
    if (person.isNew) return '새 이름 (눌러서 표기 정하기)';
    const tones = (person.tones ?? []).map(t => (t.to ? `${t.to}에게 ${t.how}` : t.how)).filter(Boolean);
    // 한글 표기가 빈 사람: 번역에 그 사람의 표기로 나온 이름(open-data.js joinSpelling)을 후보로 보인다. 누르면 그 이름이 든 사람 화면이 열린다.
    // 물음표로 끝내면 무엇을 묻는지 모른다: 누르면 일어나는 일(그 이름으로 표기 정하기)로 적는다. 표기가 아직 저장되지 않았다는 것만 보인다(말투까지 이어 붙이면 좁은 칸에서 잘려 '…, Sop…'처럼 끝이 보이지 않았다. 말투는 사람 화면에 있다)
    if (person.guess) return `'${person.name}'${toward(person.name)} 표기 정하기`;
    return tones.join(', ') || (wide ? '말투 안 적음' : '말투를 아직 안 적었어요');
}

function personHtml(person, wide, faces, shown) {
    const url = faces(person), none = person.isNew || !(person.tones ?? []).length;
    const face = url ? `<span class="face pic" style="background-image:url(&quot;${esc(url)}&quot;);background-size:cover;background-position:center"></span>` : `<span class="face icon">${FACE_ADD}</span>`;
    // 후보 표기는 아직 정한 이름이 아니라 원문 이름으로 보인다
    const shownName = person.guess ? person.src : person.name || person.src;
    const src = !wide && !person.guess && person.src && person.name ? `<em>${esc(person.src)}</em>` : '';
    return `<div class="person${shown === person.id ? ' cur' : ''}" data-person="${esc(person.id)}" role="button" tabindex="0">${face}<div><div class="pn"><span>${src}${esc(shownName)}</span></div><div class="tone${none ? ' none' : ''}">${esc(toneText(person, wide))}</div></div>${wide ? '<span></span>' : SV('right')}</div>`;
}

function peopleHtml(people, state, wide, faces, shown) {
    const limit = state.allPeople ? people.length : PEOPLE_SHOWN[wide ? 'pc' : 'phone'], rest = people.length - limit;
    const rows = people.slice(0, limit).map(p => personHtml(p, wide, faces, shown)).join('');
    const shownFirst = PEOPLE_SHOWN[wide ? 'pc' : 'phone'];
    const tail = rest > 0 ? `<div class="line more" data-more="people" role="button" tabindex="0"><span style="color:var(--mute)">${rest}명 더 보기</span><span class="v"></span>${SV('down')}</div>`
        : state.allPeople && people.length > shownFirst ? `<div class="line more up" data-less="people" role="button" tabindex="0"><span style="color:var(--mute)">접기</span><span class="v"></span>${SV('down')}</div>`
        : people.every(p => !p.lines) ? '<div class="hint">번역한 답에서 말한 사람이 여기에 모여요</div>' : '';
    return `<div class="sec"><span>나온 사람들</span><span class="go sm ${people.length ? 'line' : 'fill'} fillb${shown === 'fill' ? ' cur' : ''}" data-go="fill" role="button" tabindex="0"><i class="fa-solid fa-list-check" aria-hidden="true"></i>채우기</span></div>
<div class="group" style="overflow:visible">${state.allPeople ? `<div class="btr-home-people-all">${rows}</div>` : rows}${tail}</div>`;
}

// 용어 줄을 눌러도 용어집 화면이 열린다(사람 줄을 누르면 그 사람 화면이 열리는 것과 같게)
const termRow = n => `<div class="term" data-go="terms" role="button" tabindex="0" style="cursor:pointer"><span>${esc(n.src)}</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i><span>${esc(n.dst)}</span></div>`;
/** 용어집: 줄 둘 + '용어집 열기'(용어가 없으면 '용어 넣기'). 누르면 용어집 화면이 열린다 */
function termsHtml(names, shown) {
    const label = names.length ? '<span style="color:var(--mute)">용어집 열기</span>' : `<span class="add" style="height:auto">${SV('plus')}용어 넣기</span>`;
    const more = `<div class="line more${shown === 'terms' ? ' cur' : ''}" data-go="terms" role="button" tabindex="0">${label}<span class="v"></span>${SV('right')}</div>`;
    return `<div class="sec"><span>용어집</span><small>${names.length}개</small></div>
<div class="group">${names.slice(0, TERMS_SHOWN).map(termRow).join('')}${more}</div>`;
}

const footHtml = shown => `<div class="frows lfoot">${FOOT.map(([id, name, icon]) => `<div class="line${shown === id ? ' cur' : ''}" data-go="${id}" role="button" tabindex="0">${IC(icon)}<div class="k">${name}</div>${SV('right')}</div>`).join('')}</div>`;

export function mountHome(box, api) {
    const root = document.createElement('div');
    root.className = 'btr-home inst';
    box.append(root);
    const context = () => SillyTavern.getContext();
    const state = { allPeople: false, wide: null };
    const inside = new Map();   // 휴대폰에서 그 자리에 펴 그린 화면: id → { refresh?, close? }

    function facesOf() {
        const cast = castFaces(context()), own = screenOf('person')?.face;
        return person => { try { const url = own?.(person); if (url) return url; } catch { /* 그림 없이 그린다 */ } return cast.get(foldName(person.name)) || cast.get(foldName(person.src)) || ''; };
    }
    function closeInside() { for (const handle of inside.values()) handle?.close?.(); inside.clear(); }

    function paint() {
        const wide = api.wide(), ctx = context(), chat = hasChat(ctx), view = api.layers.view(), shown = wide ? api.shown() : null;
        const open = wide ? [] : UNFOLDS.filter(id => inside.has(id) && root.querySelector(`.fold.on[data-f="${id}"]`));
        if (state.wide !== wide || !open.length) {
            closeInside();
            state.wide = wide;
            root.innerHTML = `<div class="group" style="overflow:visible">${topHtml(values(ctx, api.layers), wide, shown)}</div>
${chat ? peopleHtml(peopleOf(ctx, view), state, wide, facesOf(), shown) : ''}<div class="btr-home-terms">${termsHtml(view.names, shown)}</div>${footHtml(shown)}`;
            return;
        }
        // 펴 둔 화면이 있으면 통째로 다시 그리지 않는다(그 안에서 적던 것이 날아간다): 줄의 값과 용어집만 고치고 그 화면에 알린다
        const v = values(ctx, api.layers);
        for (const [id] of TOP) { const el = root.querySelector(`[data-t="${id}"] .v, [data-go="${id}"] .v`); if (el && v[id]) el.textContent = v[id]; }
        paintTerms();
        for (const id of open) inside.get(id)?.refresh?.();
    }
    /** 용어집 덩이만 다시 그린다 */
    function paintTerms() {
        const part = root.querySelector('.btr-home-terms');
        if (!part) return;
        part.innerHTML = termsHtml(api.layers.view().names, api.wide() ? api.shown() : null);
    }
    function onFold(id, on) {
        if (!UNFOLDS.includes(id)) return;
        if (!on) return;
        if (inside.has(id)) return;
        const host = root.querySelector(`.fold[data-f="${id}"] .open`);
        inside.set(id, api.inside(id, host));
    }
    function onClick(event) {
        const more = event.target.closest('[data-more]'), person = event.target.closest('[data-person]'), go = event.target.closest('[data-go]');
        if (event.target.closest('[data-less]')) { state.allPeople = false; state.wide = null; paint(); return; }
        if (more) { state.allPeople = true; closeInside(); state.wide = null; paint(); }
        else if (person) api.open('person', person.dataset.person);
        else if (go) api.open(go.dataset.go);
    }
    const off = wire(root, null, onFold);
    root.addEventListener('click', onClick);
    paint();
    return {
        refresh: paint,
        /** 오른쪽 칸에 보이는 화면이 바뀌었다: 칠한 줄만 옮긴다 */
        mark(id, args) {
            for (const el of root.querySelectorAll('.cur')) el.classList.remove('cur');
            const target = id === 'person' ? [...root.querySelectorAll('[data-person]')].find(el => el.dataset.person === args) : root.querySelector(`[data-go="${id}"]`);
            if (state.wide) target?.classList.add('cur');
        },
        close() { off(); root.removeEventListener('click', onClick); closeInside(); root.remove(); },
    };
}
