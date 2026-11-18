// 월드인포 항목 편집 창의 토큰 숫자는 원문 그대로 세서 {{// … }} 주석까지 들어간다.
// 보낼 때는 매크로 치환에서 주석이 지워지므로, 이 칸도 주석을 뺀 숫자로 보여 준다.
// 주석만 뺀다 — 다른 매크로({{setvar}} 등)는 실행하지 않는다(편집 창을 열 때마다 변수가 바뀌면 안 되니까).
// 마우스를 올리면 주석 포함 숫자가 보인다. 주석이 없는 항목은 건드리지 않는다.

const COMMENT_SRC = String.raw`\{\{\/\/\}\}[\s\S]*?\{\{\/\/\/\}\}|\{\{\s*\/\/[\s\S]*?\}\}`;
const HAS_COMMENT = new RegExp(COMMENT_SRC);
const COMMENTS = new RegExp(COMMENT_SRC, 'g');
const COUNTER = '.world_entry_form_token_counter';
let shown = new WeakMap();   // 칸 → 이 기능이 넣은 숫자
// 다른 쪽이 같은 일을 하는지: ① 실리태번 숫자 자리에 이미 주석을 뺀 숫자가 나와 있거나 ② 우리가 넣은 숫자를, 항목 글은 그대로인데 다른 숫자로 바꿔 씀
let replaced = new WeakMap();   // 칸 → { raw: 우리가 바꾸기 전 숫자, value: 그때 항목 글 }
let api = null;
const SAME_BACK = '그쪽을 끄면 다음에 월드인포 창을 열 때 breeze가 맡아요.';
let observer = null;

async function recount(counter) {
    const raw = counter.textContent.trim();
    if (!/^\d+$/.test(raw) || shown.get(counter) === raw) return;   // 'counting...' 이거나 우리가 넣은 값
    const value = counter.closest('.world_entry')?.querySelector('textarea[name="content"]')?.value || '';
    const prev = replaced.get(counter);
    if (prev && shown.has(counter) && prev.value === value && raw !== prev.raw) {
        api?.rest('same', { saw: '항목 글은 그대로인데, breeze가 넣은 토큰 숫자를 다른 쪽이 다른 숫자로 바꿔 썼어요', who: { kind: 'unknown' }, back: SAME_BACK });
        return;   // 번갈아 바꾸지 않게 그쪽 숫자를 둠
    }
    if (!HAS_COMMENT.test(value)) { counter.removeAttribute('title'); return; }
    let real;
    try { real = await SillyTavern.getContext().getTokenCountAsync(value.replace(COMMENTS, '')); }
    catch { return; }
    if (counter.textContent.trim() !== raw) return;   // 그 사이 실리태번이 다시 셈
    const text = String(real);
    if (text === raw) { api?.rest('same', { saw: '토큰 숫자가 이미 주석을 뺀 숫자로 나와 있어요', who: { kind: 'unknown' }, back: SAME_BACK }); return; }
    replaced.set(counter, { raw, value });
    shown.set(counter, text);
    counter.textContent = text;
    counter.title = `주석({{// }})을 빼고 센 실제 토큰 수예요. 주석 포함: ${raw}`;
}

export function start(a) {
    api = a;
    const list = document.getElementById('world_popup_entries_list');
    if (!list) return;
    observer = new MutationObserver(muts => {
        const seen = new Set();
        for (const m of muts) {
            const el = m.target.nodeType === Node.TEXT_NODE ? m.target.parentElement : m.target;
            el?.closest?.(COUNTER) && seen.add(el.closest(COUNTER));
            m.addedNodes.forEach(n => n.querySelectorAll?.(COUNTER).forEach(c => seen.add(c)));
        }
        seen.forEach(recount);
    });
    observer.observe(list, { subtree: true, childList: true, characterData: true });
    list.querySelectorAll(COUNTER).forEach(recount);
}

// 끄면 감시만 멈춘다. 이미 바꿔 놓은 숫자는 실리태번이 다시 셀 때(항목을 고치거나 창을 다시 열 때) 원래대로 돌아간다.
export function stop() {
    observer?.disconnect();
    observer = null;
    shown = new WeakMap();
    replaced = new WeakMap();
}
