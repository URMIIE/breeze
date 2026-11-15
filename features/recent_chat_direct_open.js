// 홈의 최근 채팅을 누르면 그 채팅을 바로 열기.
// 실리태번은 먼저 그 캐릭터를 골라 ‘마지막으로 열었던 채팅’을 다 그린 다음, 누른 채팅으로 바꿔 한 번 더 그린다(긴 채팅이면 두 번 기다림).
// 누르는 순간 그 캐릭터의 ‘마지막으로 열었던 채팅’을 누른 채팅으로 적어 두면, 실리태번이 캐릭터를 고르면서 곧바로 그 채팅을 연다.
// 실리태번도 채팅을 열 때 같은 칸을 그 채팅으로 고쳐 적으므로 결과는 같고, 그리기만 한 번 줄어든다. 그룹 채팅은 그대로 둔다.
// 캐릭터를 늦게 불러오는 서버 설정(lazyLoadCharacters)에선 캐릭터가 요약본이라, 채팅을 열 때 실리태번이 전체를 새로 받아 그 칸을 덮어쓴다.
// 그럴 땐 누름을 잠깐 붙잡고 전체를 먼저 받은 뒤 칸을 적고, 같은 줄을 다시 눌러 실리태번이 여는 대로 둔다.
let replaying = false;

function onClick(e) {
    if (replaying) return;
    const row = e.target?.closest?.('.welcomePanel .recentChat');
    if (!row || e.target.closest('button, .mes_button, input')) return;   // 줄 안의 고정 · 이름 바꾸기 버튼은 그대로
    const avatar = row.getAttribute('data-avatar'), file = row.getAttribute('data-file');
    if (!avatar || !file || row.getAttribute('data-group')) return;
    const ctx = SillyTavern.getContext();
    const index = ctx.characters.findIndex(x => x.avatar === avatar);
    const ch = ctx.characters[index];
    if (!ch) return;
    if (!ch.shallow) { if (ch.chat !== file) ch.chat = file; return; }
    e.preventDefault(); e.stopImmediatePropagation();
    Promise.resolve(ctx.unshallowCharacter?.(index)).catch(() => {}).finally(() => {
        const full = SillyTavern.getContext().characters.find(x => x.avatar === avatar);
        if (full && full.chat !== file) full.chat = file;
        if (!row.isConnected) return;
        replaying = true;
        try { row.click(); } finally { replaying = false; }
    });
}

export function start() { document.addEventListener('click', onClick, true); }
export function stop() { document.removeEventListener('click', onClick, true); }
