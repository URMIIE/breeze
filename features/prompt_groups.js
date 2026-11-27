// 프롬프트 그룹: 프롬프트 관리자의 토글을 접고 펼치는 그룹으로 묶어 보여 준다(본체는 ../prompt_groups/app.js).
// 저장 자리는 따로 쓰던 프롬프트 그룹 확장과 같다(extension_settings.promptFolders, 프리셋 파일 extensions.promptFolders):
// 그 확장으로 만든 그룹이 그대로 보이고, 둘이 같이 돌면 같은 목록을 서로 다시 그리므로 그 확장이 켜져 있으면 이쪽이 쉰다.
// 옵션: 없음(설정은 위 저장 자리에 그 확장과 같은 이름으로 둔다)
let api = null, app = null, wanted = false, recheck = 0;
let resting = false;

const REST_INFO = Object.freeze({
    saw: '따로 깔린 프롬프트 그룹 확장이 켜져 있어 그쪽이 맡고 있어요',
    who: { kind: 'ext', name: '프롬프트 토글 그룹' },
    back: '그룹과 설정은 같은 자리를 써서 그대로예요.',
});

// 따로 깔린 확장이 이 화면에 올라와 있나: 그 확장이 문서에 듣기를 달며 세우는 표시 둘, 확장 창에 넣는 설정 칸
const standaloneOn = () => Boolean(window.__pfExclusiveHooked || window.__pfFreeDocHooked || document.getElementById('pf_settings'));

// 확장들이 다 올라온 뒤(실리태번 준비 끝)에 판단한다: breeze 가 먼저 올라오면 그 확장의 표시가 아직 없다. 이미 준비가 끝났으면 바로 넘어간다
function appReady() {
    const { eventSource, event_types } = api.ctx();
    return new Promise(done => eventSource.once(event_types.APP_READY, done));
}

function rest() {
    resting = true;
    api.rest('same', REST_INFO);
}

export async function start(a) {
    api = a;
    wanted = true;
    resting = false;
    await appReady();
    if (!wanted) return;
    if (standaloneOn()) { rest(); return; }
    app ||= await import('../prompt_groups/app.js');
    if (!wanted) return;
    await app.start();
    // 그 확장이 준비 끝 신호보다 늦게 올라온 경우: 한 번 더 보고 이쪽이 물러난다
    recheck = setTimeout(() => { if (wanted && standaloneOn()) { app.stop(); rest(); } }, 3000);
}

export function stop() {
    wanted = false;
    resting = false;
    clearTimeout(recheck);
    app?.stop();
}

export function options(box, a) {
    api = a;
    if (resting) { box.innerHTML = `<small>${REST_INFO.saw}. ${REST_INFO.back}</small>`; return; }
    // 설정 칸은 조금 뒤에 채워진다(파일을 읽음): breeze 가 이 칸에 바로 덧붙이는 줄이 지워지지 않게 안쪽 칸에 그린다
    const slot = document.createElement('div');
    box.append(slot);
    if (app) void app.fillSettings(slot);
    else slot.innerHTML = '<small>프롬프트 그룹을 불러오는 중이에요. 잠시 뒤 다시 열어 주세요.</small>';
}
