// 이 채팅 기억: breeze 세부 설정 칸. 값은 extension_settings.chatPresetMemory 에 그대로 적는다(따로 깔아 쓰던 때의 칸).
// 종류 체크칸의 id(cpm_kind_* · cpm_nkind_*)와 지금 채팅 줄 자리(cpm_here)는 다른 파일이 그 id 로 찾으므로 바꾸지 않는다.
import { KINDS, ctx, settings } from './shared.js';
import { syncAuOption } from './kinds.js';
import { renderBar } from './bar.js';
import { renderChars, filterChars, clearCharDefaults } from './char_list.js';

const KIND_NAME = { toggles: '프롬프트', connection: '연결', regex: '정규식', world: '월드인포', persona: '페르소나 AU', card: '캐릭터 AU' };
const GROUPS = [['toggles', 'connection', 'regex'], ['world', 'persona', 'card']];
const kindChecks = pre => GROUPS.map(g => `<span class="cpm-kind-group">${g.map(k => `<label class="cpm-chip" for="${pre}${k}"><input type="checkbox" id="${pre}${k}"><span>${KIND_NAME[k]}</span></label>`).join('')}</span>`).join('');

const HTML = `<div class="cpm-settings cpm-set">
<small class="cpm-help">채팅마다 프롬프트 · 연결 · 정규식 · 월드인포<span class="cpm-au-word"> · AU</span> 상태를 기억했다가, 그 채팅을 다시 열면 그대로 맞춰요. 무엇을 기억할지는 ⓘ 에서 채팅마다 고르고 고쳐요.</small>
<section class="cpm-set-sec">
    <div class="cpm-set-head">지금 채팅</div>
    <div class="cpm-here-wrap"><div id="cpm_here"></div></div>
</section>
<section class="cpm-set-sec">
    <div class="cpm-set-head">새 채팅</div>
    <div class="cpm-set-sub">처음부터 기억할 것</div>
    <div class="cpm-default-kinds">${kindChecks('cpm_kind_')}</div>
    <label class="checkbox_label" for="cpm_charDefault"><input type="checkbox" id="cpm_charDefault"><span>그 캐릭터의 마지막 설정으로 시작</span></label>
    <details class="cpm-group cpm-chars" id="cpm_chars">
        <summary><span class="cpm-g-title">캐릭터별 마지막 설정</span><span class="cpm-count"></span></summary>
        <small class="cpm-help">캐릭터마다 마지막으로 쓴 설정이에요. 지워도 채팅마다 기억한 설정과 지금 설정은 그대로예요.</small>
        <input type="search" class="text_pole cpm-search" placeholder="캐릭터 · 프리셋 검색">
        <ul class="cpm-char-list"></ul>
        <div class="cpm-char-foot"><button type="button" id="cpm_clear_chars" class="cpm-link">모두 지우기</button></div>
    </details>
</section>
<section class="cpm-set-sec">
    <div class="cpm-set-head">보이기</div>
    <label class="checkbox_label" for="cpm_showBar"><input type="checkbox" id="cpm_showBar"><span>프롬프트 칸에 '이 채팅 기억' 줄 보이기</span></label>
    <label class="cpm-set-row" for="cpm_barPos"><span>줄 위치</span>
        <select id="cpm_barPos" class="text_pole">
            <option value="top">목록 위</option>
            <option value="head">'총 토큰' 줄 옆</option>
            <option value="under">'총 토큰' 줄 아래</option>
            <option value="bottom">목록 맨 밑 (토글을 다 지나서)</option>
        </select>
    </label>
    <label class="checkbox_label" for="cpm_notify"><input type="checkbox" id="cpm_notify"><span>설정을 맞췄을 때 알림</span></label>
    <div class="cpm-notify-kinds">
        <div class="cpm-set-sub">알림에 보일 것 (안 고르면 '맞췄어요' 한 줄만)</div>
        <div class="cpm-default-kinds">${kindChecks('cpm_nkind_')}</div>
    </div>
</section>
</div>`;

/** 세부 설정 칸을 그림(열 때마다 새로) */
export function fillOptions(box) {
    box.innerHTML = HTML;
    const s = settings(), save = () => ctx().saveSettingsDebounced();
    const el = id => box.querySelector(`#${id}`);
    // 알림에 보일 것: 알림을 끄면 흐리게
    const syncNotify = () => box.querySelector('.cpm-notify-kinds').classList.toggle('cpm-off', !settings().notify);
    for (const k of KINDS) {
        const now = el(`cpm_kind_${k}`), tell = el(`cpm_nkind_${k}`);
        now.checked = !!s.kinds[k];
        now.addEventListener('change', () => { settings().kinds = { ...settings().kinds, [k]: now.checked }; save(); renderBar(); });
        tell.checked = s.notifyKinds[k] !== false;
        tell.addEventListener('change', () => { settings().notifyKinds = { ...settings().notifyKinds, [k]: tell.checked }; save(); });
    }
    const pos = el('cpm_barPos');
    pos.value = ['top', 'head', 'under', 'bottom'].includes(s.barPos) ? s.barPos : 'top';
    pos.addEventListener('change', () => { settings().barPos = pos.value; save(); renderBar(); });
    for (const key of ['charDefault', 'showBar', 'notify']) {
        const cb = el(`cpm_${key}`);
        cb.checked = !!s[key];
        cb.addEventListener('change', () => { settings()[key] = cb.checked; save(); renderBar(); if (key === 'notify') syncNotify(); });
    }
    syncNotify();
    syncAuOption();
    const chars = el('cpm_chars');
    chars.addEventListener('toggle', () => { if (chars.open) renderChars(); });
    chars.querySelector('.cpm-search').addEventListener('input', filterChars);
    renderChars();
    el('cpm_clear_chars').addEventListener('click', clearCharDefaults);
    renderBar();   // '지금 채팅' 줄을 이 칸에 넣음
}
