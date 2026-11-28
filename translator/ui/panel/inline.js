// breeze 설정 창의 번역 칸과 확장 창의 '번역' 줄(시안 t2-settings-plan.html 의 'breeze 번역 칸').
// 모든 채팅에 쓰는 두 가지(연결, 번역 프롬프트)를 그 자리에서 고친다: 채팅을 열지 않아도 보인다.
// 맨 아래 한 줄은 세부 설정(보기, 내 규칙, 용어집, 상태창 번역, 그 밖의 설정)이 있는 판을 연다.
// 높이를 정해 두지 않는다: 칸을 품은 화면이 스크롤한다.
//
// mount(host, api) → { refresh(), close() }
//   api.layers, api.refresh(), api.notice(text)
//   api.chatName(): string    열린 채팅의 캐릭터(그룹) 이름, 채팅이 없으면 ''
//   api.onDetail()            맨 아래 줄을 눌렀을 때

import { esc, SV, IC } from './text.js';
import { drawConnection } from './connection.js';
import { drawPrompts } from './prompts.js';

const PC_MIN = 480;   // 칸이 이 폭 이상이면 모델 · 온도 · 생각 수준을 펴 둔다(시안의 PC 그림)

export function mount(host, api) {
    const root = document.createElement('div');
    root.className = 'btr-inline btr-plan phone fix';
    root.innerHTML = `<div class="tr inst"><div class="sec"><span>모든 채팅</span><small></small></div>
<div class="group"><div class="open" style="padding-top:12px" data-part="connection"></div><div class="open" style="padding-top:2px" data-part="prompts"></div></div>
<div class="group" style="margin-top:12px"><div class="line" data-detail role="button" tabindex="0">${IC('sliders')}<div class="k"><span></span><small>보기, 내 규칙, 용어집, 상태창 번역, 그 밖의 설정</small></div>${SV('right')}</div></div></div>`;
    host.append(root);
    const pc = root.clientWidth >= PC_MIN;
    const parts = [
        drawConnection(root.querySelector('[data-part="connection"]'), api, { label: true, pc }),
        drawPrompts(root.querySelector('[data-part="prompts"]'), api, { label: true, list: false }),
    ];
    function head() {
        const name = api.chatName();
        root.querySelector('.sec small').textContent = name ? `지금 채팅: ${name}` : '';
        root.querySelector('[data-detail] .k span').textContent = name ? '지금 채팅의 세부 설정' : '모든 채팅에 쓸 세부 설정';
    }
    const onClick = event => { if (event.target.closest('[data-detail]')) api.onDetail(); };
    const onKey = event => { if (event.key === 'Enter' && event.target.matches('[data-detail]')) api.onDetail(); };
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    head();
    return {
        refresh() { head(); for (const part of parts) part.refresh(); },
        close() { root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); for (const part of parts) part.close(); root.remove(); },
    };
}
