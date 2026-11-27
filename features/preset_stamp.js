// 프리셋 스탬프: 답(스와이프)마다 어떤 모델 · 프리셋으로 만들었는지 그 메시지에 도장처럼 적어 두고, AI 메시지의 캐릭터 이름을 누르면 알림으로 보여 줌.
// 하는 일은 ../lib/preset-stamp-core.js 에 있고, 여기는 설정 칸과 켜고 끄기만 맡는다.
// 알림에 보일 것은 extension_settings.presetStamp.show(따로 깔아 쓰던 같은 확장과 같은 칸 · 같은 도장 기록이라 쓰던 설정 · 기록이 그대로 이어짐).
// 같은 확장이 따로 깔려 돌고 있으면(그 확장의 설정 칸이 확장 칸에 있음) 도장 · 알림이 두 번 되지 않게 쉰다.
// 옵션: separate(확장 칸에 따로 보이기 — 켜면 확장 칸에 ‘프리셋 스탬프’ 줄, 끄면 설정은 breeze 세부 설정에만)

import { getGeneratingModel, getGeneratingApi, main_api, saveChatDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { power_user } from '../../../../power-user.js';
import { createPresetStamp, SHOW_ROWS as CORE_ROWS } from '../lib/preset-stamp-core.js';

// 번역 모델 줄은 번역을 마친 신호가 번역 모델을 실어 줄 때만 채워지는데, 이 묶음에는 그 신호를 내는 번역 기능이 없어 늘 빈 줄이라 뺌
const SHOW_ROWS = CORE_ROWS.filter(([key]) => key !== 'translation');

const ctx = () => SillyTavern.getContext();
let api = null;
const core = createPresetStamp({
    getGeneratingModel, getGeneratingApi, mainApi: () => main_api, saveChatDebounced,
    extensionSettings: extension_settings, powerUser: power_user,
    warn: (err) => console.warn('[Breeze] 프리셋 스탬프', err),
});

// ---------------- 설정 칸 · 켜기 · 끄기 ----------------

const DRAWER_ID = 'etk_preset_stamp_drawer';
function showBoxes(box) {
    box.insertAdjacentHTML('beforeend', `<small>AI 메시지의 캐릭터 이름을 누르면 뜨는 알림에 보일 정보</small>${SHOW_ROWS.map(([k, t]) => `<label class="checkbox_label"><input type="checkbox" data-show="${k}"><span>${t}</span></label>`).join('')}`);
    const show = core.settings().show;
    for (const input of box.querySelectorAll('input[data-show]')) {
        input.checked = !!show[input.dataset.show];
        input.addEventListener('change', () => {
            core.settings().show[input.dataset.show] = input.checked;
            ctx().saveSettingsDebounced();
            // 같은 칸이 다른 곳(확장 칸 · breeze 세부 설정)에도 떠 있으면 같이 맞춤
            document.querySelectorAll(`input[data-show="${input.dataset.show}"]`).forEach(other => { if (other !== input && other.closest(`#${DRAWER_ID}, .etk-ps-box`)) other.checked = input.checked; });
        });
    }
}
// 확장 칸에 따로 보이기
function placeDrawer() {
    document.getElementById(DRAWER_ID)?.remove();
    if (!api?.options().separate) return;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return;
    host.insertAdjacentHTML('beforeend', `<div id="${DRAWER_ID}"><div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b><i class="fa-solid fa-tag" style="margin-right: 4px;"></i>프리셋 스탬프</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"></div></div></div>`);
    showBoxes(document.querySelector(`#${DRAWER_ID} .inline-drawer-content`));
}

let on = false;

export function start(a) {
    api = a;
    // 같은 확장이 따로 깔려 돌고 있으면 쉼(그 확장이 만든 설정 칸으로 알아봄 · 이름은 그 칸에 적힌 것)
    const other = document.getElementById('ps_settings');
    if (other) { api.rest('same', { saw: '확장 창에 같은 일을 하는 확장의 설정이 있어요', who: { kind: 'ext', name: other.querySelector('b')?.textContent.trim() || '' }, back: '그 확장을 끄고 새로고침하면 breeze가 맡아요.' }); return; }
    api.rest(null);
    core.attach();
    on = true;
    placeDrawer();
}
export function stop() {
    core.detach();
    on = false;
    document.getElementById(DRAWER_ID)?.remove();
}
export function options(box, a) {
    api = a;
    const o = a.options();
    box.innerHTML = `<label class="checkbox_label"><input type="checkbox" data-k="separate"><span>확장 창에도 보이기</span></label>
<small>켜면 확장 창에도 ‘프리셋 스탬프’ 줄이 생겨요.</small><div class="etk-sub">알림에 보일 정보</div><div class="etk-ps-box"></div>`;
    const sep = box.querySelector('[data-k="separate"]');
    sep.checked = !!o.separate;
    sep.addEventListener('change', () => { o.separate = sep.checked; a.save(); if (on) placeDrawer(); });
    showBoxes(box.querySelector('.etk-ps-box'));
    box.querySelector('.etk-ps-box > small')?.remove();   // 위 작은 제목과 같은 말
}
