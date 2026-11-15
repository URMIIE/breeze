// 지금 보는 답을 새 스와이프로 하나 더 — 글만이 아니라 메시지 정보(extra: 번역 등)까지.
// 글만 복사하면 복사한 쪽으로 넘겼다 오면 번역 같은 덧붙은 정보가 사라진다.
// 메시지 ⋯ 메뉴 버튼과 명령 /dup(예전 이름 /swipe-dup 도 됨) 둘 다.

async function duplicateSwipe(messageId) {
    const c = SillyTavern.getContext();
    const chat = c.chat;
    let id = Number.isInteger(messageId) ? messageId : chat.length - 1;
    if (!Number.isInteger(messageId)) while (id >= 0 && (chat[id]?.is_user || chat[id]?.is_system)) id--;
    const m = chat[id];
    if (!m || m.is_user) { toastr.info('복사할 AI 메시지가 없어요.'); return ''; }
    if (!Array.isArray(m.swipes) || !m.swipes.length) {
        m.swipes = [m.mes]; m.swipe_id = 0;
        m.swipe_info = [{ send_date: m.send_date, gen_started: m.gen_started ?? null, gen_finished: m.gen_finished ?? null, extra: structuredClone(m.extra || {}) }];
    }
    if (!Array.isArray(m.swipe_info)) m.swipe_info = m.swipes.map(() => ({ extra: {} }));
    // 기록 칸이 스와이프보다 짧은 답이 있음 — 그대로 push 하면 새 정보가 새 스와이프가 아닌 앞쪽 빈 번호에 들어감
    while (m.swipe_info.length < m.swipes.length) m.swipe_info.push({ extra: {} });
    const cur = Number.isInteger(m.swipe_id) ? m.swipe_id : 0;
    // 지금 보는 답의 최신 글 · 정보는 mes / extra 에 있음 → 원래 칸에도 맞춰 두고 그대로 복사
    m.swipes[cur] = m.mes;
    m.swipe_info[cur] = { ...(m.swipe_info[cur] || {}), extra: structuredClone(m.extra || {}) };
    m.swipes.push(m.mes);
    m.swipe_info.push({ send_date: m.send_date, gen_started: m.gen_started ?? null, gen_finished: m.gen_finished ?? null, extra: structuredClone(m.extra || {}) });
    m.swipe_id = m.swipes.length - 1;
    c.updateMessageBlock(id, m);
    try { c.swipe?.refresh?.(true, false); } catch { /* 스와이프 버튼 없는 판 */ }
    await c.saveChat();
    await c.eventSource.emit(c.eventTypes.MESSAGE_UPDATED, id);
    toastr.success(`#${id} 메시지를 새 스와이프(${m.swipe_id + 1}/${m.swipes.length})로 복사했어요.`);
    return '';
}

let active = false, commandAdded = false;
const BTN = 'etk_swipe_dup';

// ⋯ 메뉴 버튼은 메시지 틀(#message_template)에 넣어 두면 새로 그리는 메시지마다 따라온다. 이미 그려진 메시지엔 직접.
function addButtons() {
    const make = () => {
        const b = document.createElement('div');
        b.className = `mes_button ${BTN} interactable`;   // 아이콘은 style.css 의 가는 선 화살표(테마가 가는 선으로 그리는 다른 버튼들과 굵기를 맞춤)
        b.title = '지금 메시지를 새 스와이프로 복사';
        b.tabIndex = 0;
        return b;
    };
    for (const extra of document.querySelectorAll('#message_template .extraMesButtons, #chat .mes:not([is_user="true"]) .extraMesButtons')) {
        if (!extra.querySelector(`.${BTN}`)) extra.prepend(make());
    }
}

function onClick(e) {
    const btn = e.target.closest?.(`.${BTN}`);
    if (!btn || !active) return;
    const id = Number(btn.closest('.mes')?.getAttribute('mesid'));
    if (Number.isInteger(id)) duplicateSwipe(id);
}

export function start() {
    active = true;
    addButtons();
    document.addEventListener('click', onClick);
    document.dispatchEvent(new Event('etk-buttons-changed'));   // 열려 있는 버튼 목록이 바로 다시 그려지게
    if (commandAdded) return;
    const c = SillyTavern.getContext();
    try {
        c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
            name: 'dup',
            aliases: ['swipe-dup'],   // 예전 이름으로 만든 빠른 답장도 그대로 돌게
            callback: async (args) => (active ? duplicateSwipe(args?.message !== undefined && args.message !== '' ? Number(args.message) : undefined) : ''),
            namedArgumentList: [c.SlashCommandNamedArgument?.fromProps?.({ name: 'message', description: '메시지 번호 (없으면 마지막 AI 메시지)', isRequired: false })].filter(Boolean),
            helpString: '지금 보는 메시지(번역 등 메시지 정보 포함)를 새 스와이프로 하나 더 만들어요.',
        }));
        commandAdded = true;
    } catch (error) { console.warn('[Breeze] /dup', error); }
}

// 명령은 실리태번에서 지울 수 없어 남지만, 꺼져 있으면 아무 일도 안 함
export function stop() {
    active = false;
    document.removeEventListener('click', onClick);
    document.querySelectorAll(`.${BTN}`).forEach(b => b.remove());
    document.dispatchEvent(new Event('etk-buttons-changed'));
}
