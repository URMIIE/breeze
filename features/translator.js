// 번역: 원하는 LLM으로 채팅 · 내 글을 번역(본체는 ../translator/).
// 설정은 breeze 설정 창의 이 기능 세부 설정에 보이고, '확장 창에도 보이기'를 켜면 확장 칸에도 '번역' 줄이 생긴다.
// 번역기는 이벤트 · 메시지 버튼 · 슬래시 명령을 실리태번에 달아서 새로고침 없이 끌 수 없다(stop 없음 → breeze 가 '새로고침해야 꺼져요').
// 옵션: separate(확장 창에도 보이기)
let api = null, panel = null, home = null, fresh = null;
let resting = null;   // 같은 뿌리의 다른 번역 확장이 먼저 올라와 있어 이쪽이 쉴 때의 알림 글(../translator/overlap.js REST_INFO)

const opts = () => api.options();
function homeBox() {
    if (!home) { home = document.createElement('div'); home.id = 'etk_translator_home'; home.hidden = true; document.body.append(home); }
    return home;
}
// 확장 칸 줄: 접는 줄 하나이고, 펼치면 번역 설정 첫 화면이 그 안에 그려진다(보일 때 그린다)
function freshPanel() {
    const el = document.createElement('div');
    el.className = 'btr-drawer';
    el.innerHTML = `<div class="inline-drawer">
<div class="inline-drawer-toggle inline-drawer-header"><b><i class="fa-solid fa-language"></i> 번역</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
<div class="inline-drawer-content"></div></div>`;
    fresh.fillOptions(el.querySelector('.inline-drawer-content'));
    return el;
}
// 확장 칸에 보일 줄을 둘 자리로: 따로 보이기면 확장 칸(실리태번 번역 칸 자리), 아니면 숨긴 보관함
function place() {
    if (!panel && opts().separate) panel = freshPanel();   // 줄은 처음 켤 때 만든다
    if (!panel) return;
    const drawer = document.getElementById('translation_container');
    const was = panel.parentElement;
    if (opts().separate && drawer) drawer.append(panel); else homeBox().append(panel);
    // 확장 칸을 정리해 보여 주는 도구(breeze ‘확장 창 정리’ 등)는 확장 칸 바로 아래에 칸이 생기고 없어지는 것만 지켜본다. 번역 칸은 이미 있는 자리 안으로 들어가고 나와서
    // 그 도구가 몰랐고, 목록에서 ‘번역’을 눌러도 빈 화면이었다 → 자리가 바뀌면 확장 칸에 표시 하나를 넣었다 빼서 알림
    if (was !== panel.parentElement && drawer?.parentElement) { const mark = document.createComment('breeze'); drawer.parentElement.append(mark); mark.remove(); }
}

/** 마법봉 메뉴의 '번역' 줄: 번역 설정 전체(번역 설정 판)를 연다. 번역기가 돌지 않으면 false(breeze 창의 세부 설정으로) */
export async function openFromWand() {
    if (!fresh) return false;
    const panels = await import('../translator/ui/panel/open.js');
    return panels.openSettings();
}

export async function start(a) {
    api = a;
    // 같은 뿌리의 번역 확장이 이미 올라와 있으면 쉰다(둘 다 돌면 답 하나에 요청이 두 번 나간다). 없으면 이쪽이 맡는다고 표시한다
    const overlap = await import('../translator/overlap.js');
    if (!overlap.claim()) { resting = overlap.REST_INFO; api.rest('same', resting); return; }
    try {
        const app = await import('../translator/app.js');
        await app.ready;
        fresh = app;
    } catch (error) {
        overlap.release();   // 시작하다 죽으면 세운 표시를 물린다(남겨 두면 같은 뿌리의 다른 확장이 그 표시를 보고 쉰다)
        throw error;         // breeze 가 이 기능 칸에 오류로 표시한다
    }
    place();
}

// 세부 설정 칸: '확장 창에도 보이기'와, 번역 설정 첫 화면(떠 있는 판을 열지 않고 여기서 바로 고친다)
export function options(box, a) {
    api = a;
    if (resting) { box.innerHTML = `<small>${resting.saw}. ${resting.back}</small>`; return; }
    if (!fresh) { box.innerHTML = '<small>번역을 켜지 못했어요. 새로고침해 주세요.</small>'; return; }
    const o = opts();
    box.innerHTML = `<label class="checkbox_label btr-sep"><input type="checkbox" data-k="separate"><span>확장 창에도 보이기</span></label>
<small class="btr-sep-note">켜면 확장 창에도 ‘번역’ 줄이 생기고, 펼치면 아래와 같은 설정이 보여요.</small>
<div class="etk-translator-box"></div>`;
    const sep = box.querySelector('[data-k="separate"]');
    sep.checked = !!o.separate;
    sep.addEventListener('change', () => { o.separate = sep.checked; api.save(); place(); });
    fresh.fillOptions(box.querySelector('.etk-translator-box'));
}
