// 채팅 기록 이름 바꾸기의 화면: 페르소나 이름을 바꿨을 때 뜨는 창과, 페르소나 관리의 이름 바꾸기 버튼 옆 버튼.
// 지금 채팅의 글(내 글, 답, 스와이프, 번역문)에 남은 옛 이름을 새 이름으로 바꾼다. 바꾸는 일과 기록 맞추기는 store/rename.js 가 한다.
// 메시지 위의 이름표는 실리태번의 이름 맞추기가 맡으므로 건드리지 않는다.

import { renameChat, restoreChat, countIn } from '../store/rename.js';
import { user_avatar } from '/scripts/personas.js';

const TITLE = '채팅 기록 이름 바꾸기';
const FIELDS = [['source', 0, '원문', '옛 이름 (쉼표로 여러 개)'], ['source', 1, '', '새 이름'], ['shown', 0, '번역문', '옛 이름 (쉼표로 여러 개)'], ['shown', 1, '', '새 이름']];

function notify(kind, text, options = {}) { globalThis.toastr?.[kind]?.(text, TITLE, { closeButton: true, ...options }); }

/** 창의 내용: 원문과 번역문의 옛 이름, 새 이름 칸과 바꿀 곳 수 */
function buildForm(oldName, newName, count) {
    const root = document.createElement('div'), inputs = [];
    root.append(Object.assign(document.createElement('b'), { textContent: '지금 채팅의 글에서 이름 바꾸기' }));
    for (const [side, at, label, hint] of FIELDS) {
        const input = Object.assign(document.createElement('input'), { className: 'text_pole', placeholder: hint, value: at ? newName : oldName, ariaLabel: `${label || '새 이름'} ${hint}` });
        inputs.push({ side, at, input });
        if (label) root.append(Object.assign(document.createElement('div'), { textContent: label }));
        root.append(input);
    }
    const note = Object.assign(document.createElement('small'), { textContent: '번역문의 이름이 원문과 다르면 번역문 칸에 따로 적어요. 새 이름을 비우면 그쪽은 바꾸지 않아요.' });
    const total = document.createElement('div');
    root.append(note, total);
    const names = () => {
        const out = { source: ['', ''], shown: ['', ''] };
        for (const { side, at, input } of inputs) out[side][at] = input.value.trim();
        return out;
    };
    let timer = 0;
    const recount = () => { const n = count(names()); total.textContent = n ? `바뀌는 곳 ${n.toLocaleString()}곳` : '바꿀 곳이 없어요'; };
    root.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(recount, 250); });
    recount();
    return { root, names };
}

/**
 * @param {object} o
 * @param {() => object} o.context 실리태번 getContext
 * @param {(text: string) => string | number} o.hash 글의 해시(getStringHash)
 * @param {(message: object) => RegExp[]} o.hold 번역에 보내지 않는 글의 규칙
 */
export function startRename({ context, hash, hold }) {
    const tools = {
        hash: text => String(hash(String(text ?? ''))),
        expand: (text, message) => context().substituteParams(String(text ?? ''), context().name1, message.name),
        hold,
    };

    async function undo(chatId, before) {
        const c = context();
        if (c.getCurrentChatId() !== chatId) { notify('warning', '다른 채팅이라 되돌리지 않았어요.'); return; }
        const missed = restoreChat(c.chat, c.chatMetadata, before);
        await c.saveChat();
        await c.reloadCurrentChat();
        notify('info', missed ? `되돌렸어요. 그사이 바뀐 메시지 ${missed}개는 그대로 뒀어요.` : '되돌렸어요.');
    }

    async function open(oldName = '', newName = context().name1) {
        const c = context();
        if (!c.chat?.length) { notify('info', '열린 채팅이 없어요.'); return; }
        const chatId = c.getCurrentChatId(), form = buildForm(oldName, newName, names => countIn(context().chat, names));
        const answer = await c.callGenericPopup(form.root, c.POPUP_TYPE.CONFIRM, '', { okButton: '바꾸기', cancelButton: '취소' });
        if (answer !== c.POPUP_RESULT.AFFIRMATIVE) return;
        const now = context();
        if (now.getCurrentChatId() !== chatId) { notify('warning', '채팅이 바뀌어서 하지 않았어요.'); return; }
        const done = renameChat(now.chat, now.chatMetadata, form.names(), tools);
        if (!done.texts && !done.records) { notify('info', '바꾼 곳이 없어요.'); return; }
        await now.saveChat();
        await now.reloadCurrentChat();
        const records = done.records ? `, 기록 ${done.records.toLocaleString()}곳` : '';
        notify('success', `글 ${done.texts.toLocaleString()}곳${records}을 바꿨어요. 이 알림을 누르면 되돌려요.`, { timeOut: 20000, extendedTimeOut: 10000, onclick: () => undo(chatId, done.before) });
    }

    const { eventSource, eventTypes } = context();
    // 지금 쓰는 페르소나의 이름을 바꿨고 옛 이름이 이 채팅의 글에 있으면 바로 창을 연다
    eventSource.on(eventTypes.PERSONA_RENAMED, ({ avatarId, oldName, newName }) => {
        if (avatarId !== user_avatar || !oldName || oldName === newName) return;
        if (countIn(context().chat, { source: [oldName, newName], shown: [oldName, newName] })) open(oldName, newName);
    });
    const button = Object.assign(document.createElement('div'), { className: 'menu_button fa-solid fa-file-pen', title: '지금 채팅 글 속 이름 바꾸기', ariaLabel: '지금 채팅 글 속 이름 바꾸기' });
    button.addEventListener('click', () => open('', context().name1));
    document.getElementById('persona_rename_button')?.after(button);
    return { open };
}
