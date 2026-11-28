// 새 설정 판(승인된 시안 t2-settings-plan-more.html)의 '그 밖의 설정' 화면(more).
// 줄을 누르면 그 자리에서 펴진다(한 번에 하나, 고급 안의 줄은 고급을 편 채로 하나).
// 값은 그 기능의 store 함수로 읽고 쓴다. 함수가 따로 없는 옛 설정 칸(참고할 대화 수, 텍스트 보호 줄, 멈춤 감지 초)은
// 번역 설정 칸에 값 하나를 적는 prefs.js 의 write 로 적는다(번역기가 읽는 열쇠 그대로).

import { esc, SV, IC } from './text.js';
import { limitsOf } from '../../core/model-limits.js';
import { foldHtml } from './motion.js';
import { registerScreen } from './screens.js';
import { buttonList, setButtonHidden, setButtonOrder } from '../message/buttons.js';
import { dragOrder } from './drag-order.js';
import { write } from '../message/prefs.js';
import { contextOptions } from '../../job/earlier.js';
import { parsePattern } from '../../rules/hold.js';
import { readSettings } from '../../store/settings.js';
import { wordRows, addWord, removeWord } from '../../store/word-replacements.js';
import { readOutgoing, setOutgoing } from '../../store/outgoing.js';
import { bilingualOn, setBilingual } from '../../rules/bilingual.js';
import { prefillNow, setPrefillOn, setPrefillText } from '../../send/prefill.js';
import { useListHtml, useListClick, useListKey } from './use-list.js';
import { connectionOf } from './open-data.js';

// 프리필 칸 아래 안내: 모델이 프리필을 그대로 쓰지 않거나 받지 않을 때(받지 않으면 빼고 보낸다: send/profile.js)
// 어느 모델 이야기인지 이름을 앞에 적는다
const PREFILL_NOTE = { changed: name => `${name} 모델은 AI 메시지로 끝나는 요청을 받지 않아요. 그래서 프리필이 유저 메시지로 바뀌어서 가요.`, rejected: name => `${name} 모델은 프리필을 받지 않아서 빼고 보내요` };

const fi = (name, cls = '') => `<i class="fa-solid fa-${name} ${cls}" aria-hidden="true"></i>`;
const chk = on => `<span class="chk${on ? '' : ' off'}">${on ? fi('check') : ''}</span>`;
/** 체크 줄(시안의 .keep). key 는 누르면 바꿀 값의 이름 */
const keep = (key, label, on, small = '') => `<div class="keep" data-ck="${key}" role="button" tabindex="0" aria-pressed="${on}">${chk(on)}<span>${label}${small ? `<small>${small}</small>` : ''}</span></div>`;
const num = (key, value, unit, max) => `<span class="num"><input type="number" class="input" data-num="${key}" min="0"${max ? ` max="${max}"` : ''} inputmode="numeric" value="${esc(value)}">${unit}</span>`;

/** 줄 하나와 그 아래 펴지는 자리(시안의 line) */
// 출처와 라이선스: 누르면 그 자리에 펼친다
const CREDIT_LINK = (name, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a>`;
const CREDITS = `<div class="btr-more-credits">
<p>아래 확장을 바탕으로 개조했어요.</p>
<p>${CREDIT_LINK('llm-translator', 'https://github.com/1234anon/llm-translator')} (1234anon)<br>${CREDIT_LINK('llm-translator-custom', 'https://github.com/NamelessKkang/llm-translator-custom')} (NamelessKkang)</p>
<p>용어집, 인물별 말투, 답을 스트리밍으로 받는 아이디어는 Blue Lemonade 의 LLM Translator 애드온을 참고했어요.</p>
<p>라이선스는 ${CREDIT_LINK('AGPL-3.0', 'https://www.gnu.org/licenses/agpl-3.0.html')} 이에요.</p>
</div>`;

function lineHtml(id, icon, name, value, body, open) {
    const on = open === id;
    return `<div class="line${on ? ' up' : ''}" data-t="${id}" role="button" tabindex="0">${IC(icon)}<div class="k">${name}</div><span class="v" data-v="${id}">${value}</span>${SV('down')}</div>${foldHtml(id, on, `<div class="open">${body}</div>`)}`;
}

// ── 메시지에 보일 버튼 ──
const BUTTON_ICON = { first: 'right-left', mes_edit_translation: 'pen-to-square', mes_delete_translation: 'eraser', mes_llmt_settings: 'sliders' };
const buttonsValue = list => list.filter(b => !b.hidden).map(b => fi(BUTTON_ICON[b.key])).join('');
function buttonsBody(list) {
    const icons = list.map(b => `<span${b.hidden ? ' hidden' : ''}>${fi(BUTTON_ICON[b.key])}</span>`).join('');
    return `<div class="mini"><div class="who"><span>캐릭터</span><span class="tools">${icons}<span class="st">${fi('ellipsis')}</span><span class="st">${fi('pencil')}</span></span></div><p>그는 서류철을 덮고 고개를 들었다.</p></div>
<div class="btr-more-btnpick">${list.map(b => `<span class="set${b.hidden ? '' : ' on'}" data-ck="btn:${b.key}" role="button" tabindex="0" aria-pressed="${!b.hidden}">${fi(BUTTON_ICON[b.key])}${esc(b.name)}</span>`).join('')}</div>`;
}

// ── 참고할 최근 대화 ──
// 그림: 번역할 답 앞의 메시지 일곱 가운데 어느 것이 같이 가는지(가까운 것부터 개수만큼, 내 글은 넣기로 했을 때만).
// 지금 번역할 답을 빼지 않으면 그 답도 개수 안에 든다(job/run.js 가 그 답까지 넣고 가까운 것부터 센다)
const TALK = ['ai', 'me', 'ai', 'me', 'ai', 'me', 'ai'];
function talkHtml({ count, includeUser, excludeLast }) {
    let left = excludeLast ? count : count - 1;
    const sent = TALK.map(() => false);
    for (let i = TALK.length - 1; i >= 0 && left > 0; i--) {
        if (TALK[i] === 'me' && !includeUser) continue;
        sent[i] = true; left--;
    }
    const row = (who, on) => `<div class="${who}${on ? ' inc' : ''}">${who === 'ai' ? 'AI 답' : '내 글'}${on ? ' <em>같이 보냄</em>' : ''}</div>`;
    return `<div class="ctx">${TALK.map((who, i) => row(who, sent[i])).join('')}<div class="ai now${excludeLast ? '' : ' inc'}">지금 번역할 답${excludeLast ? '' : ' <em>같이 보냄</em>'}</div></div>`;
}
function contextBody(o) {
    return `<div class="two r btr-more-count"><span>개수</span>${num('context_message_count', o.count, '개')}</div>
${talkHtml(o)}
<div class="btr-more-keeps">${keep('context_include_user', '내가 쓴 글도 참고에 넣기', o.includeUser)}${keep('context_exclude_last', '지금 번역할 답은 참고에서 빼기', o.excludeLast)}</div>
<div class="note">번역 프롬프트에 앞 대화 자리({{llmContext}})가 있을 때만 같이 보내요.</div>`;
}

// ── 텍스트 보호 ──
function holdBody(rules) {
    return `<div class="ba btr-more-holdba"><div><small>원문</small><p><mark class="hold">Name:</mark> Alex<br>The rain has stopped. <mark class="hold">(OOC: next scene)</mark></p></div><div><small>번역</small><p><mark class="hold">Name:</mark> 알렉스<br>비가 그쳤다. <mark class="hold">(OOC: next scene)</mark></p></div></div>
<div class="note">점선으로 두른 부분은 번역하지 않아요.</div>
<div class="lab">보호할 텍스트 (번역 제외)</div>
${rules.map((rule, i) => `<div class="rule"><span class="btr-more-code">${esc(rule)}</span><span class="btr-more-del" data-del="hold:${i}" role="button" tabindex="0" aria-label="지우기">${SV('x')}</span></div>`).join('')}
<div class="inrow btr-more-inrow"><input type="text" class="input" data-draft="hold" placeholder="글자 그대로 또는 /정규식/" enterkeyhint="done" aria-label="보호할 텍스트"><span class="go sm solid" data-add="hold" role="button" tabindex="0">넣기</span></div>`;
}

// ── 번역문 낱말 바꾸기 ──
function wordsBody(rows) {
    // 줄은 찾을 말 · 화살표 · 바꿀 말 세 칸. 지우기 표시는 바꿀 말 칸 끝에 두어 두 칸이 위 본보기 두 칸과 같은 폭이 되게 한다
    const row = (r, i) => `<div class="term btr-more-word"><span class="btr-more-find">${esc(r.find)}</span>${fi('arrow-right')}<span class="btr-more-to"><span>${esc(r.to)}</span><span class="btr-more-del" data-del="word:${i}" role="button" tabindex="0" aria-label="지우기">${SV('x')}</span></span></div>`;
    return `<div class="ba btr-more-wordba"><div><small>번역 그대로</small><p><mark>허나</mark> <mark>그대</mark>는 오지 않았다.</p></div><div><small>바꾼 뒤</small><p><mark>하지만</mark> <mark>당신</mark>은 오지 않았다.</p></div></div>
<div class="term th btr-more-word"><span>찾을 말</span><i></i><span class="btr-more-to"><span>바꿀 말</span></span></div>
${rows.map(row).join('')}
<div class="term add btr-more-word"><input type="text" class="input" data-draft="find" placeholder="찾을 말" aria-label="찾을 말">${fi('arrow-right')}<span class="btr-more-to"><input type="text" class="input" data-draft="to" placeholder="바꿀 말" enterkeyhint="done" aria-label="바꿀 말"><span class="go sm solid" data-add="word" role="button" tabindex="0">넣기</span></span></div>`;
}

// ── 입력 번역(보낼 때 번역 · 입력창 옆 버튼) ──
// 둘 다 같은 프롬프트(llm_prompt_send)와 언어 칸으로 옮긴다. 켜고 끄는 칸만 따로다: send_translate · show_input_translate_button.
// 본보기 글: 내가 쓴 글 하나와, 언어 칸에 적힌 언어로 옮긴 모습. 언어 칸은 아무 말이나 적을 수 있어
// 흔한 몇 언어만 실제 글로 보이고, 그 밖의 언어는 '(언어 이름 서술)'처럼 어느 부분이 어느 언어로 가는지만 보인다.
const SEND_ORIGINAL = { narration: '나는 고개를 저었다.', dialogue: '괜찮아, 먼저 가.' };
const SEND_SAMPLES = [
    [/^(en|eng|english|영어)$/i, { narration: 'I shook my head.', dialogue: 'It\'s okay, go ahead.' }],
    [/^(ja|jp|japanese|日本語|일본어)$/i, { narration: '私は首を横に振った。', dialogue: '大丈夫、先に行って。' }],
    [/^(zh|cn|chinese|中文|중국어)$/i, { narration: '我摇了摇头。', dialogue: '没事，你先走吧。' }],
    [/^(ko|kr|korean|한국어)$/i, SEND_ORIGINAL],
];
function sampleIn(lang, part) {
    const found = SEND_SAMPLES.find(([match]) => match.test(lang.trim()));
    return found ? found[1][part] : `(${lang} ${part === 'narration' ? '서술' : '대사'})`;
}
const sendLine = ({ narration, dialogue }) => `${narration} "${dialogue}"`;
/** 보내지는 글: 서술은 번역할 언어로, 대사는 대사 언어가 있으면 그 언어로(비면 서술과 같은 언어로) */
function sentText(s) {
    const lang = s.lang || 'English';
    return sendLine({ narration: sampleIn(lang, 'narration'), dialogue: sampleIn(s.dialogueLang || lang, 'dialogue') });
}
const SEND_PICKS = [['original', '입력한 글 (원문)'], ['sent', '보낸 글 그대로 (번역문)']];
const SEND_REFS = [['refChar', '캐릭터 설정'], ['refPersona', '페르소나'], ['refWorld', '월드인포'], ['refNote', '작가 노트'], ['refRecent', '최근 대화']];
const inputValue = s => [s.on && '번역해서 보내기', s.showButton && '입력창 버튼'].filter(Boolean).join(', ') || '끔';
/** 프롬프트 글을 고치는 줄: 연필을 누르면 그 아래에 적는 칸이 펴진다 */
const promptRow = (key, name, text, open) => `<div class="two r btr-more-pen"><span>${name}</span><div class="sel${open ? ' up' : ''}" data-t2="${key}" role="button" tabindex="0" aria-label="${name} 고치기">${fi('pen-to-square')}</div></div>
${foldHtml(`p:${key}`, open, `<textarea class="input btr-more-area" data-text="${key}" rows="6" aria-label="${name}">${esc(text)}</textarea>`)}`;

/** 본보기: 입력창(버튼이 보이면 그 버튼도) → 내가 쓴 글 · 번역한 글 · (켜져 있으면) 보낸 뒤 내 화면에 남는 글 */
function inputShown(s) {
    const original = esc(sendLine(SEND_ORIGINAL)), sent = esc(sentText(s));
    const langs = `서술 ${esc(s.lang || 'English')}${s.dialogueLang ? `, 대사 ${esc(s.dialogueLang)}` : ''}`;
    // 본보기는 켜고 끔과 상관없이 쓴 글과 번역한 글을 보여 준다. 켜져 있으면 보낸 뒤 내 화면에 남는 글도 보여 준다
    const sentBox = `<div><small>번역한 글 (${langs})</small><p>${sent}</p></div>`;
    const after = s.on ? `<div class="btr-more-mine"><small>보낸 뒤 내 화면에 보일 글</small><p>${s.display === 'sent' ? sent : original}</p></div>` : '';
    return `<div class="inbar">${fi('wand-magic-sparkles')}<span>${original}</span>${s.showButton ? '<i class="fa-solid fa-font nb" aria-hidden="true"></i>' : ''}${fi('paper-plane')}</div>
<div class="ba v"><div><small>내가 쓴 글</small><p>${original}</p></div>${sentBox}${after}</div>`;
}
function inputBody(s, sub) {
    return `<div data-send-shown>${inputShown(s)}</div>
${keep('send:on', '내가 쓴 글을 번역해서 보내기', s.on)}
<div class="g2"><div><div class="lab">번역할 언어 (서술)</div><input type="text" class="input" data-text="lang" value="${esc(s.lang)}" aria-label="번역할 언어"></div><div><div class="lab">대사 언어 (따옴표 안)</div><input type="text" class="input" data-text="dialogueLang" value="${esc(s.dialogueLang)}" aria-label="대사 언어"></div></div>
<div class="lab">내 화면에 보일 글</div>
<div class="seg">${SEND_PICKS.map(([value, name]) => `<span data-pk="${value}" role="button" tabindex="0"${value === s.display ? ' class="s"' : ''}>${name}</span>`).join('')}</div>
<div class="btr-more-keeps">${keep('send:showButton', '입력창 옆 버튼 보이기', s.showButton, '누르면 켜고 끄기, 길게 누르면 바로 번역')}</div>
<div class="line btr-more-detail${['detail', 'prompt'].includes(sub) ? ' up' : ''}" data-t2="detail" role="button" tabindex="0"><div class="k">자세히<small>참고 정보 / 프롬프트</small></div><span class="v"></span>${SV('down')}</div>
${foldHtml('p:detail', ['detail', 'prompt'].includes(sub), `<div class="lab btr-more-top">참고 정보 함께 보내기 (번역해서 보낼 때)</div><div class="g2 btr-more-refs">${SEND_REFS.map(([key, name]) => keep(`send:${key}`, name, s[key])).join('')}</div>
<div class="note">넣을수록 토큰이 늘어요.</div>
${promptRow('prompt', '입력 번역 프롬프트', s.prompt, sub === 'prompt')}`)}`;
}

// ── 고급 ──
/** 고급의 지금 값 */
function advancedNow(es) {
    const s = readSettings(es), prefill = prefillNow(es);
    return { korean: s.keepKorean, paren: bilingualOn(es), prefill, stall: { stall_idle: s.stallIdle, stall_retries: s.stallRetries, stall_first: s.stallFirst } };
}
// 고급 줄 오른쪽: 켜 둔 것의 이름(하나도 안 켰으면 비운다)
const advancedValue = a => [a.korean && '한국어 건너뛰기', a.paren && '괄호 빼기', a.prefill.on && '프리필'].filter(Boolean).join(', ');
// 켜고 끄는 줄: 줄 오른쪽의 체크칸을 누르면 바로 켜고 끈다. 줄의 나머지를 누르면 본보기가 펴진다
function flipLine(id, icon, name, key, on, body, open) {
    const flip = `<span class="v btr-more-flip" data-ck="${key}" role="switch" tabindex="0" aria-checked="${on}" aria-label="${name}">${chk(on)}</span>`;
    return `<div class="line${open === id ? ' up' : ''}" data-t="${id}" role="button" tabindex="0">${IC(icon)}<div class="k">${name}</div>${flip}${SV('down')}</div>${foldHtml(id, open === id, `<div class="open">${body}</div>`)}`;
}
// 본보기는 켜고 끔과 상관없이 켰을 때의 원문과 번역을 보여 준다(꺼 둔 채로 봐도 무엇을 하는 기능인지 보이게)
// 한국어인 부분: 문단 단위로 가린다. 한국어 문단은 보내지 않고 그대로 둔다(점선)
const KOREAN_SOURCE = ['她把纸条推到桌子对面。', '"내일 세 시, 정문 앞에서 봐요."', '他看了一眼，点了点头。'];
const KOREAN_RESULT = ['그녀가 쪽지를 탁자 건너편으로 밀었다.', '"내일 세 시, 정문 앞에서 봐요."', '그는 한 번 보고 고개를 끄덕였다.'];
const koreanLines = lines => lines.map((line, at) => `<p>${at === 1 ? `<mark class="hold">${line}</mark>` : line}</p>`).join('');
const koreanBody = () => `<div class="ba btr-more-top"><div><small>원문</small>${koreanLines(KOREAN_SOURCE)}</div><div><small>번역</small>${koreanLines(KOREAN_RESULT)}</div></div>
<div class="note">점선으로 표시한 한국어 문단은 AI 에게 보내지 않고 그대로 둬요.</div>`;
// 이중언어 대사: 원문이 대사 뒤 괄호에 다른 언어로 같은 말을 한 번 더 적어 둔 것
const parenBody = () => `<div class="ba btr-more-top"><div><small>원문</small><p>"你受伤了吗？" <mark class="hold">(Are you hurt?)</mark></p></div><div><small>번역</small><p>"다쳤어?" <span class="btr-more-gone">(다쳤어?)</span></p></div></div>
<div class="note">점선으로 표시한 괄호(같은 대사를 다른 언어로 한 번 더 적은 것)는 번역에 넣지 않아요.</div>`;
// 프리필: 꺼져 있으면 무슨 일을 하는지 한 줄만. 켜져 있으면 본보기(글 앞 두 줄만) · 글 칸 · 저장해 둔 목록
const PREFILL_OFF = '프리필은 보내는 글 맨 끝에 붙이는 글이에요.';
/** 글 칸 높이: 글 줄 수만큼(3~14줄). 더 길면 칸 안에서 굴려 본다 */
const prefillRows = text => Math.min(14, Math.max(3, String(text ?? '').split('\n').length + 1));
function prefillBody(a) {
    if (!a.prefill.on) return `<div class="note btr-more-top">${PREFILL_OFF}</div>`;
    return `<div class="btr-more-req"><small>보내는 순서</small><ol><li>번역 프롬프트</li><li>번역할 글</li><li class="on">프리필<code>${esc(a.prefill.text || '<translation>')}</code></li></ol></div>
<div class="lab">프리필</div><textarea class="input btr-more-area btr-more-code" data-text="prefill" rows="${prefillRows(a.prefill.text)}" placeholder="&lt;translation&gt;" spellcheck="false" aria-label="프리필">${esc(a.prefill.text)}</textarea>${a.prefillNote ? `<div class="note">${a.prefillNote}</div>` : ''}${a.prefillList}`;
}
const stallCell = (name, input) => `<div><div class="lab">${name}</div>${input}</div>`;
const stallBody = a => `<div class="btr-more-stall">${stallCell('중간에 멈추면', num('stall_idle', a.stall.stall_idle, '초'))}${stallCell('자동 다시 요청', num('stall_retries', a.stall.stall_retries, '번', 5))}${stallCell('첫 글자가 안 오면', num('stall_first', a.stall.stall_first, '초'))}</div>
<div class="note">정한 시간 동안 글이 오지 않으면 끊어요. 중간에 멈춘 답은 정한 번수만큼 다시 요청해요. 0초로 두면 끊지 않고 기다려요.</div>`;
const stallValue = a => `${a.stall.stall_idle}초, ${a.stall.stall_retries}번`;
function advancedBody(a, open) {
    const sub = open.startsWith('adv:') ? open : '';
    return flipLine('adv:korean', 'spell-check', '이미 한국어인 부분은 보내지 않기', 'korean', a.korean, koreanBody(a), sub)
        + flipLine('adv:paren', 'quote-right', '이중언어 대사 괄호 빼기', 'paren', a.paren, parenBody(a), sub)
        + flipLine('adv:prefill', 'i-cursor', '프리필 사용', 'prefill', a.prefill.on, prefillBody(a), sub)
        + lineHtml('adv:stall', 'stopwatch', '멈춤 감지', stallValue(a), stallBody(a), sub);
}

// ── 데이터 ──
// 지우기: 줄을 펴면 바로 확인 한 번(무엇이 몇 개 지워지는지와 지우기 · 취소)
const clearBody = count => `<div class="note btr-more-top">번역된 답 ${count.messages}개의 번역을 지워요. 원문은 그대로고, 되돌릴 수 없어요.</div><div class="btns"><span class="go sm solid" data-act="clear-yes" role="button" tabindex="0">지우기</span><span class="go sm line" data-act="clear-no" role="button" tabindex="0">취소</span></div>`;
const memoryBody = chat => `<div class="note btr-more-top">번역 기억은 같은 글을 다시 번역하지 않게 이 기기에 기억해 둔 번역이에요. 비워도 채팅의 번역은 그대로예요.</div><div class="btns">${chat ? '<span class="go sm line danger" data-act="memory-chat" role="button" tabindex="0">이 채팅 것만 비우기</span>' : ''}<span class="go sm line danger" data-act="memory-all" role="button" tabindex="0">${fi('trash')}&nbsp;전부 비우기</span></div>`;

/** 화면 전체. state.open: 펴 둔 줄('adv' 는 고급만, 'adv:paren' 은 고급 안의 그 줄), state.sub: 그 줄 안에서 펴 둔 것 */
/** 프리필 글 칸 아래의 저장해 둔 프리필 목록(use-list.js)이 읽는 것. 누름 처리에 쓸 것은 renderMore 가 더한다 */
const prefillListCtx = (api, state) => ({
    use: 'prefill', es: api.context().extensionSettings, layers: api.layers, state: (state.uses ??= {}),
    current: () => prefillNow(api.context().extensionSettings).text,
});

function moreHtml(api, state) {
    const c = api.context(), es = c.extensionSettings, open = state.open;
    const buttons = buttonList(), talk = contextOptions(es), holds = readSettings(es).userRules, words = wordRows(es), send = readOutgoing(c), adv = advancedNow(es);
    adv.prefillList = useListHtml(prefillListCtx(api, state));
    const modelName = es['llm-translator-custom']?.profile_model || connectionOf(c, api.layers).model;
    adv.prefillNote = PREFILL_NOTE[limitsOf(modelName).prefill]?.(esc(modelName)) ?? '';
    const chat = c.getCurrentChatId?.(), count = chat && api.tools?.clearAll ? api.tools.clearAll.count() : null;
    const advOpen = open === 'adv' || open.startsWith('adv:');
    const advLine = `<div class="line${advOpen ? ' up' : ''}" data-t="adv" role="button" tabindex="0">${IC('screwdriver-wrench')}<div class="k">고급</div><span class="v" data-v="adv">${advancedValue(adv)}</span>${SV('down')}</div>${foldHtml('adv', advOpen, `<div class="open btr-more-adv">${advancedBody(adv, open)}</div>`)}`;
    return `<div class="group">${lineHtml('btn', 'hand-pointer', '메시지에 보일 버튼', buttonsValue(buttons), buttonsBody(buttons), open)}${lineHtml('ctx', 'comments', '참고할 최근 대화', `${talk.count}개`, contextBody(talk), open)}${lineHtml('hold', 'shield-halved', '텍스트 보호', `${holds.length}줄`, holdBody(holds), open)}${lineHtml('words', 'arrow-right-arrow-left', '번역문 낱말 바꾸기', `${words.length}개`, wordsBody(words), open)}</div>
<div class="group btr-more-gap">${lineHtml('send', 'font', '입력 번역', inputValue(send), inputBody(send, state.sub), open)}</div>
<div class="group btr-more-gap">${advLine}</div>
<div class="sec"><span>${fi('hard-drive', 'lic')} 데이터</span></div><div class="group">${count?.messages ? lineHtml('clear', 'eraser', '이 채팅 번역 모두 지우기', `번역된 답 ${count.messages}개`, clearBody(count), open) : ''}${lineHtml('memory', 'database', '번역 기억 비우기', '', memoryBody(chat), open)}</div>
<div class="quiet btr-more-credits-line" data-t="credits" role="button" tabindex="0">출처와 라이선스</div>${foldHtml('credits', open === 'credits', CREDITS)}`;
}

function renderMore(box, api) {
    const root = document.createElement('div');
    root.className = 'btr-more-screen';
    box.append(root);
    const state = { open: '', sub: '' };
    const c = () => api.context();
    const say = (text, kind) => (api.notice ? api.notice(text, kind) : globalThis.toastr?.[kind === 'warning' ? 'warning' : 'info'](text));

    function paint() {
        const top = box.scrollTop;
        root.innerHTML = moreHtml(api, state);
        box.scrollTop = top;
    }
    /** 값을 바꾸고 이 화면을 다시 그린다(펴 둔 줄은 state 에 있어 그대로 남는다) */
    function change(fn) {
        try { fn(); } catch (error) { console.warn('[번역]', error); say(error?.message || '저장하지 못했어요.', 'warning'); }
        paint();
    }

    /** 줄을 펴고 접는다. 고급 안의 줄을 접으면 고급은 편 채로 남는다 */
    function toggle(id) {
        const inner = id.startsWith('adv:');
        state.open = state.open === id ? (inner ? 'adv' : '') : (id === 'adv' && state.open.startsWith('adv') ? '' : id);
        // 줄 안에서 펴 둔 것은 줄을 접으면 처음으로 돌린다
        const dirty = state.sub;
        state.sub = '';
        if (dirty) return paint();
        const openIds = new Set([state.open, state.open.startsWith('adv') ? 'adv' : '']);
        for (const each of root.querySelectorAll('.fold[data-f]')) {
            if (each.dataset.f.startsWith('p:')) { each.classList.remove('on'); continue; }
            each.classList.toggle('on', openIds.has(each.dataset.f));
        }
        for (const line of root.querySelectorAll('[data-t]')) line.classList.toggle('up', openIds.has(line.dataset.t));
        for (const pen of root.querySelectorAll('[data-t2]')) pen.classList.remove('up');
    }
    /** 줄 안의 작은 펼침(자세히, 프롬프트 적는 칸) */
    function toggleSub(key) {
        state.sub = state.sub === key ? (key === 'prompt' ? 'detail' : '') : key;
        paint();
    }

    const CHECKS = {
        context_include_user: () => write('context_include_user', !contextOptions(c().extensionSettings).includeUser),
        context_exclude_last: () => write('context_exclude_last', !contextOptions(c().extensionSettings).excludeLast),
        korean: () => write('keep_korean_source', !readSettings(c().extensionSettings).keepKorean),
        paren: () => setBilingual(c(), !bilingualOn(c().extensionSettings)),
        prefill: () => setPrefillOn(c(), !prefillNow(c().extensionSettings).on),
    };
    function check(key) {
        if (key.startsWith('btn:')) { const b = buttonList().find(each => each.key === key.slice(4)); return change(() => setButtonHidden(b.key, !b.hidden)); }
        if (key.startsWith('send:')) { const name = key.slice(5); return change(() => setOutgoing(c(), name, !readOutgoing(c())[name])); }
        return change(CHECKS[key]);
    }

    function addHold() {
        const input = root.querySelector('[data-draft="hold"]'), text = input.value.trim();
        if (!text) return;
        if (!parsePattern(text)) return say('정규식을 읽지 못했어요.', 'warning');
        const rules = readSettings(c().extensionSettings).userRules;
        if (!rules.includes(text)) change(() => write('user_defined_regexes', [...rules, text]));
    }
    function addWordRow() {
        const find = root.querySelector('[data-draft="find"]').value, to = root.querySelector('[data-draft="to"]').value;
        const done = addWord(c(), find, to);
        if (done.ok) paint();
        else if (done.reason === 'same') say('찾을 말과 바꿀 말이 같아요.', 'warning');
    }
    function remove(id) {
        const [kind, at] = id.split(':'), i = Number(at);
        if (kind === 'word') change(() => removeWord(c(), i));
        else change(() => write('user_defined_regexes', readSettings(c().extensionSettings).userRules.filter((_, n) => n !== i)));
    }

    async function clearChat() {
        state.open = '';
        const done = await api.tools.clearAll.run();
        if (done.ok) say(`번역된 답 ${done.messages}개의 번역을 지웠어요.`);
        else say(done.reason === 'busy' ? '번역하는 중에는 지울 수 없어요.' : '번역을 지우지 못했어요.', 'warning');
        paint();
        api.refresh?.();
    }
    async function clearMemory(chat) {
        const n = await api.memory.clear(chat ? { chat } : {});
        say(n ? `번역 기억 ${n}문단을 비웠어요.` : '비울 번역 기억이 없어요.');
    }
    const ACTS = {
        'clear-no': () => toggle('clear'),
        'clear-yes': () => clearChat().catch(error => { console.warn('[번역]', error); say('번역을 지우지 못했어요.', 'warning'); }),
        'memory-chat': () => clearMemory(c().getCurrentChatId?.()),
        'memory-all': () => clearMemory(''),
    };

    // 저장해 둔 프리필을 고르면 프리필 글 칸에 넣는다(글 칸을 고친 것과 같이 저장)
    const prefillList = () => ({ ...prefillListCtx(api, state), repaint: paint, notice: text => say(text), pick: text => change(() => setPrefillText(c(), text)) });

    function onClick(event) {
        const t = event.target;
        if (useListClick(t, prefillList())) return;
        if (t.closest('input, textarea')) return;
        const ck = t.closest('[data-ck]'), del = t.closest('[data-del]'), add = t.closest('[data-add]'), act = t.closest('[data-act]');
        const pick = t.closest('[data-pk]'), sub = t.closest('[data-t2]'), line = t.closest('[data-t]');
        if (ck) check(ck.dataset.ck);
        else if (del) remove(del.dataset.del);
        else if (add) (add.dataset.add === 'hold' ? addHold : addWordRow)();
        else if (act) ACTS[act.dataset.act]();
        else if (pick) change(() => setOutgoing(c(), 'display', pick.dataset.pk));
        else if (sub) toggleSub(sub.dataset.t2);
        else if (line) toggle(line.dataset.t);
    }

    /** 적는 칸은 칸을 떠날 때 저장한다(적는 동안 다시 그리면 커서가 사라진다). 줄의 값 글만 맞춘다 */
    function onChange(event) {
        const t = event.target, es = () => c().extensionSettings;
        if (t.dataset.num) {
            const n = Math.max(0, Math.floor(Number(t.value) || 0)), fixed = t.max ? Math.min(Number(t.max), n) : n;
            // 참고할 대화 수는 0 을 적어도 번역기가 처음 값(5)으로 읽으므로 1 부터 받는다
            write(t.dataset.num, t.dataset.num === 'context_message_count' ? Math.max(1, fixed) : fixed);
            return paint();
        }
        const key = t.dataset.text;
        if (!key) return;
        if (key === 'prefill') setPrefillText(c(), t.value);
        else setOutgoing(c(), key, t.value);
        const send = readOutgoing(c()), value = root.querySelector('[data-v="send"]'), shown = root.querySelector('[data-send-shown]');
        if (value) value.innerHTML = inputValue(send);
        // 언어 칸을 고치면 본보기도 그 언어로(화면 전체를 다시 그리면 다음 칸으로 옮긴 커서가 사라진다)
        if (shown) shown.innerHTML = inputShown(send);
        const prefillShown = root.querySelector('.btr-more-req code');
        if (key === 'prefill' && prefillShown) prefillShown.textContent = prefillNow(es()).text || '<translation>';
    }
    function onKey(event) {
        const t = event.target;
        if (useListKey(event, prefillList())) return;
        if (event.key === 'Enter' && !event.isComposing && t.dataset.draft) { event.preventDefault(); (t.dataset.draft === 'hold' ? addHold : addWordRow)(); return; }
        if ((event.key !== 'Enter' && event.key !== ' ') || !t.matches('[role="button"]')) return;
        event.preventDefault();
        t.click();
    }

    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKey);
    // 메시지에 보일 버튼: 끌어서 차례 바꾸기(짧게 누르면 지금처럼 켜고 끄기). 위 본보기도 다시 그려 같은 차례로
    const offDrag = dragOrder(root, { item: '.btr-more-btnpick .set', key: el => el.dataset.ck.slice(4), onDrop: keys => change(() => setButtonOrder(keys)) });
    paint();
    // 틀이 다시 그리라고 할 때: 적고 있는 칸이 있으면 그 글을 지우지 않게 건너뛴다
    // 포커스는 판이 그려진 root(shadow root 또는 문서)에서 읽는다: 문서의 activeElement 는 shadow 의 겉 칸이라 적는 칸을 못 알아본다
    const typing = () => { const now = root.getRootNode().activeElement; return Boolean(now && root.contains(now) && now.matches('input, textarea')); };
    const refresh = () => { if (!typing()) paint(); };
    return { refresh, close: () => { offDrag(); root.remove(); } };
}

registerScreen('more', { title: '그 밖의 설정', icon: 'gear', summary: () => '', render: renderMore });
