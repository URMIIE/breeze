// 이 채팅 기억: 채팅마다 쓰던 설정(프롬프트 · 연결 · 정규식 · 월드인포 · 페르소나 AU · 캐릭터 AU)을 기억했다가 그 채팅을 다시 열면 그대로 맞춘다.
// 본체는 ../chat_memory/. 설정과 기억 파일은 따로 깔아 쓰던 때의 자리 그대로(extension_settings.chatPresetMemory · user/files/chat-preset-memory.*.json).
// 같은 일을 하는 따로 깔린 확장이 올라와 있으면 이쪽은 쉰다(둘이 같이 돌면 채팅을 열 때 두 번 맞춘다). 설정 · 기억 파일 자리가 같아 어느 쪽이 돌든 같은 값을 쓴다.
let app = null, screen = null, resting = null;

export async function start(api) {
    app = await import('../chat_memory/app.js');
    screen = await import('../chat_memory/options.js');   // 세부 설정 칸은 열 때 바로 그려야 해서(breeze 가 그 뒤에 줄을 끼움) 미리 불러 둠
    const rest = () => { resting = app.REST_INFO; api.rest('same', resting); };
    resting = null;
    if (!(await app.start(rest)) && app.otherRunning()) rest();
}

export function stop() {
    app?.stop();
    resting = null;
}

export function options(box) {
    if (resting) { box.innerHTML = `<small>${resting.saw}. ${resting.back}</small>`; return; }
    screen?.fillOptions(box);
}
