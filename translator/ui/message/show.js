// 메시지 본문에 보기 방식(view.js)과 번역 수정 화면(edit.js)을 잇는다.
// 보기 방식에 줄 자료(문단 짝)를 메시지의 짝 기록에서 만들고, 수정 화면이 돌려준 저장 꼴을 메시지에 붙인다.
// 다시 그리는 것은 바뀐 메시지에만, 부르는 쪽(app.js)이 실리태번 신호를 받아 메시지마다 한 번 부른다.
//
// mountShow(api) 의 api
//   context()                 실리태번 getContext
//   view()                    보기 설정 { main, when }
//   hold(message) → RegExp[]  번역에 보내지 않는 글의 규칙(짝 기록이 이 규칙으로 문단을 나눴다)
//   scripts(id) → object[]    그 메시지에 걸리는 화면용 정규식(실리태번 정규식 꼴: findRegex, replaceString, placement …)
//   clean(html) → string      글자 꾸밈 태그만 남긴 HTML
//   guards                    job/guard.js createGuards 의 것(저장 전에 메시지와 스와이프가 그대로인지 본다)
//   busy(message) → boolean   번역하는 중인 메시지인가(고치지 못하게)
//   onRedo(message, picked)   다시 번역 판 열기. picked = 골라 둘 번역 문단 번호들
//   onErase?(message)         번역을 비워 저장해 지울 때, 지우기 전에(그 답의 번역 기억을 지우게)
//   onSaved(id)               번역을 고쳐 저장하거나 지운 뒤(버튼 모양을 다시 그리게)

import { mount as mountView } from './view.js';
import { mount as mountEdit } from './edit.js';
import { mount as mountLive } from './live.js';
import { applyOrigSize } from './prefs.js';
import { onClosed } from '../../job/closed.js';
import { match, mark } from '../../store/pairs.js';
import { viewOf, translationOf, attach, detach } from '../../store/message.js';
import { shownText, screenRule } from '../../core/shown.js';

const SIDE_KEY = 'breeze.translator.editSide';
const USER_INPUT = 1, AI_OUTPUT = 2;   // 실리태번 정규식의 placement 값
const notice = (text, kind = 'info') => globalThis.toastr?.[kind]?.(text, '', { timeOut: 3500 });
const bodyOf = id => document.querySelector(`#chat > .mes[mesid="${id}"] .mes_text`);
const readSide = () => { try { return localStorage.getItem(SIDE_KEY) === '1'; } catch { return false; } };
const keepSide = on => { try { localStorage.setItem(SIDE_KEY, on ? '1' : '0'); } catch { /* 기억은 없어도 된다 */ } };

/** 실리태번 정규식 목록 → 화면 글자를 바꾸거나 지우는 규칙(core/shown.js). 프롬프트에만 쓰는 것, 꺼진 것, 이 글 종류에 안 걸리는 것은 뺀다 */
export function screenRules(scripts, isUser) {
    const placed = isUser ? USER_INPUT : AI_OUTPUT;
    return (scripts || [])
        .filter(s => s && !s.disabled && !s.promptOnly && (s.placement || []).includes(placed))
        .map(s => screenRule(s.findRegex, s.replaceString))
        .filter(Boolean);
}

export function mountShow(api) {
    const chat = document.getElementById('chat');
    applyOrigSize();
    let editing = null;   // 열린 수정 화면: { id, body, host, handle }

    const rulesFor = (id, message) => screenRules(api.scripts(id), Boolean(message.is_user));
    const sourceOf = message => { const c = api.context(); return c.substituteParams(message.mes, c.name1, message.name); };

    /** 보기 방식에 줄 자료. 번역이 없거나, 원문으로 바꿔 보는 중이거나, 짝 기록이 이 글과 안 맞으면 null */
    function dataFor(id, message) {
        if (!message || viewOf(message) !== 'shown') return null;
        const source = sourceOf(message), translation = message.extra.display_text;
        const found = match(message.extra.llmt_pairs, source, translation, api.hold(message));
        if (!found) return null;
        const rules = rulesFor(id, message), shown = part => shownText(part.body, rules);
        return { key: `${mark(source)}|${mark(translation)}`, source: found.source.map(shown), translation: found.translation.map(shown), map: found.map };
    }

    const messageOf = body => { const id = Number(body.closest('.mes')?.getAttribute('mesid')); return { id, message: api.context().chat?.[id] }; };

    const view = mountView(chat, {
        view: api.view, clean: api.clean,
        busy: body => editing?.body === body,
        onEdit: hit => { const { id } = messageOf(hit.body); openEdit(id, hit.at); },
        onRedo: hit => { const { message } = messageOf(hit.body); if (message) api.onRedo(message, [hit.at]); },
    });

    /** 받는 중 미리 보기를 그려도 되는 본문: 원문이 보이는 메시지이고, 글을 고치는 칸이 열려 있지 않을 때 */
    function liveBody(id) {
        const message = api.context().chat?.[id], body = bodyOf(id);
        if (!message || !body || viewOf(message) === 'shown' || editing?.body === body) return null;
        return body.closest('.mes').querySelector('.edit_textarea') ? null : body;
    }
    const live = mountLive({
        bodyOf: liveBody, clean: api.clean, keepSource: () => api.view().main === 'src',
        shown: (text, id) => { const message = api.context().chat?.[id]; return message ? shownText(text, rulesFor(id, message)) : ''; },
    });
    onClosed(live.handle);

    function paint(id) {
        const body = bodyOf(id);
        if (body) view.paint(body, dataFor(id, api.context().chat?.[id]));
    }

    /** repaint: 닫은 뒤 보기 방식을 다시 그린다. 실리태번 수정으로 넘어갈 때는 그리지 않는다(곧 본문이 비워져 수정 칸만 남는데,
     *  그 빈 본문을 그린 것으로 적어 두면 수정을 끝낸 뒤 다시 그릴 때 이미 그린 것으로 보고 건너뛰었다) */
    function closeEdit({ repaint = true } = {}) {
        if (!editing) return;
        const { id, body, host, handle } = editing;
        editing = null;
        handle.close();
        host.remove();
        body.hidden = false;
        if (repaint) paint(id);
    }

    /** 고친 번역을 붙인다. 열어 둔 사이 메시지나 스와이프가 바뀌었으면 붙이지 않는다 */
    async function save(id, guard, shape) {
        if (!guard.valid()) { notice('그 사이 메시지가 바뀌어서 저장하지 않았어요.', 'warning'); closeEdit(); return; }
        if (shape.same) { closeEdit(); return; }
        const c = api.context(), message = guard.target();
        const before = translationOf(message);
        if (shape.erase) { await api.onErase?.(message); detach(message); } else attach(message, { text: shape.text, pairs: shape.pairs, hash: shape.hash });
        if (!shape.erase) api.onEdited?.(message, { pairs: shape.pairs, before, after: shape.text })?.catch?.(error => console.warn('[번역] 고친 번역을 기억에 적지 못했어요', error));
        closeEdit();
        c.updateMessageBlock(id, message);
        api.onSaved(id);
        await c.saveChat();
    }

    /** 번역문에서 그 번역 문단이 시작하는 자리(수정 화면이 그 문단부터 보이게) */
    function offsetOf(message, at) {
        if (!(at >= 0)) return undefined;
        const found = match(message.extra?.llmt_pairs, sourceOf(message), translationOf(message), api.hold(message));
        return found?.translation[at]?.start;
    }

    function openEdit(id, at = -1) {
        const message = api.context().chat?.[id], body = bodyOf(id);
        if (!message || !body) return;
        // 실리태번 메시지 수정 칸은 본문(.mes_text) 안에 들어간다: 본문을 가리면 그 칸도 가려진다
        if (body.querySelector('.edit_textarea')) { notice('메시지 수정을 먼저 끝내 주세요.'); return; }
        if (api.busy(message)) { notice('번역하는 중에는 고칠 수 없어요.'); return; }
        if (viewOf(message) === 'none') { notice('고칠 번역이 없어요. 먼저 번역해 주세요.'); return; }
        closeEdit();
        const guard = api.guards.capture(message);
        const host = Object.assign(document.createElement('div'), { className: 'btr-edit-host' });
        view.paint(body, null);
        view.flush();
        body.hidden = true;
        body.after(host);
        const handle = mountEdit(host, {
            translation: translationOf(message), source: sourceOf(message), rules: rulesFor(id, message),
            kept: { pairs: message.extra.llmt_pairs ?? null, hash: message.extra.original_text_hash },
            offset: offsetOf(message, at), side: readSide(), onSide: keepSide,
            onRedo: () => { closeEdit(); api.onRedo(message, []); },
            onCancel: closeEdit,
            onSave: shape => save(id, guard, shape),
        });
        editing = { id, body, host, handle };
    }

    // 번역 수정이 열린 메시지에서 실리태번 메시지 수정(연필)을 누르면 번역 수정을 먼저 닫는다(취소와 같다).
    // 실리태번은 본문(.mes_text)을 비우고 그 안에 수정 칸을 넣는데, 번역 수정이 본문을 가려 둔 채라 수정 칸이 보이지 않았다.
    // 잡는 단계에서 받아 실리태번의 처리보다 먼저 닫는다
    chat.addEventListener('click', event => {
        if (!editing || !event.target.closest?.('.mes_edit')) return;
        const id = Number(event.target.closest('.mes')?.getAttribute('mesid'));
        if (id === editing.id) closeEdit({ repaint: false });
    }, true);

    return {
        /** 그 메시지의 보기 방식을 다시 그린다 */
        paint,
        /** 그 메시지의 보기 방식을 지금 그린다(다음 화면 그리기를 기다리지 않는다: 실리태번이 본문을 막 다시 그린 뒤 그 모습이 한 번도 보이지 않게) */
        paintNow(id) { paint(id); view.flush(); },
        /**
         * 번역이 막 붙은 메시지가 원문 그대로 그려져 있을 때: 원문 먼저 보기면 다시 그리지 않고 그 본문에 붙인다(view.js paintDrawn).
         * @returns {boolean} 붙였나(false 면 부르는 쪽이 평소처럼 다시 그린다)
         */
        keepDrawn(id) {
            const body = bodyOf(id), data = dataFor(id, api.context().chat?.[id]);
            return Boolean(body && data && !editing && view.paintDrawn(body, data));
        },
        paintAll() { for (const mes of chat.querySelectorAll(':scope > .mes')) paint(Number(mes.getAttribute('mesid'))); },
        /** 보기 설정이 바뀌었을 때 */
        refresh: () => view.refresh(),
        /** 메시지의 수정 버튼 */
        edit: id => openEdit(id),
        closeEdit,
    };
}
