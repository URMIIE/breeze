// 연결: 연결 프로필 고르기와 모델 · 온도 · 생각 수준(시안 t2-settings-plan.html 의 modelPart).
// 판의 '연결' 화면과 breeze 설정 창의 번역 칸(inline.js)이 같은 것을 그린다.
// 연결 프로필은 쓰는 곳 층(layers 의 설정 model)에 적는다. 모델 · 온도 · 생각 수준은 번역이 읽는 자리(옛 번역 확장의 저장 자리,
// store/settings.js readSettings 의 profile_model · profile_temperature · profile_reasoning)에 그대로 적는다.
//
// drawConnection(box, api, { label, pc }) → { refresh(), close() }
//   label: 줄 앞에 '연결' 이름을 둘지(번역 칸). pc: 모델 · 온도 · 생각 수준을 접지 않고 펴 둘지

import { registerScreen } from './screens.js';
import { limitsOf } from '../../core/model-limits.js';
import { esc, SV, IC } from './text.js';
import { foldHtml, selHtml, picksHtml, wire, openFolds, setFold } from './motion.js';
import { connectionOf } from './open-data.js';
import { pickModels } from '../../core/model-list.js';

const OLD_SLOT = 'llm-translator-custom';
const THINK = [['auto', '프리셋 그대로'], ['min', '최소'], ['low', '낮게'], ['medium', '보통'], ['high', '높게']];
const thinkName = value => (THINK.find(([id]) => id === value) ?? THINK[0])[1];
// 세 칸 아래 한 줄 안내: 모델이 온도를 쓰지 않거나(그대로 보낸다) 받지 않을 때(빼고 보낸다: send/profile.js)
const TEMPERATURE_NOTE = { ignored: name => `${name} 모델은 온도를 쓰지 않아서 값을 바꿔도 번역이 달라지지 않아요`, rejected: name => `${name} 모델은 온도를 받지 않아서 빼고 보내요` };

const TYPE_MODEL = '::type::';   // 모델 목록의 '직접 적기' 줄(모델 이름과 겹치지 않는 값)

// 연결 주소가 내주는 모델 이름들: 주소 → 이름들. 그 주소에 한 번 물어 받아 둔다(실리태번이 API 연결 화면에서 모델 목록을 받는 것과 같은 길)
const offered = new Map();
const addressOf = profile => `${profile?.api ?? ''} ${profile?.['api-url'] ?? ''}`;
/** 주소를 직접 적지 않는 연결(구글, Vertex, Claude 등): 실리태번 API 연결 화면의 그 연결 모델 고르는 칸에 든 이름들 */
function builtInModels(api) {
    const select = api && api !== 'custom' ? document.getElementById(`model_${api}_select`) : null;
    return select ? [...select.options].map(option => option.value).filter(Boolean) : [];
}
/** 고른 프로필의 주소에 모델 목록을 물어 둔다. 새로 받았으면 done(주소) 를 부른다. 주소를 직접 적는 연결(custom)만 묻는다 */
async function loadOffered(context, profile, done) {
    const address = addressOf(profile);
    if (!profile || profile.api !== 'custom' || !profile['api-url'] || offered.has(address)) return;
    offered.set(address, []);
    try {
        const response = await fetch('/api/backends/chat-completions/status', {
            method: 'POST', headers: context.getRequestHeaders(),
            body: JSON.stringify({ chat_completion_source: 'custom', custom_url: profile['api-url'], secret_id: profile['secret-id'] }),
        });
        const names = ((await response.json())?.data ?? []).map(model => model?.id).filter(Boolean).sort();
        if (names.length) { offered.set(address, names); done(address); }
    } catch (error) {
        console.debug('[번역] 모델 목록을 받지 못했어요', error);   // 못 받으면 프로필들에 적힌 이름으로 보여 준다
    }
}

function html(context, layers, { label, pc, typeModel }) {
    const { profiles, id, label: profile, model: given } = connectionOf(context, layers), own = context.extensionSettings[OLD_SLOT] ?? {};
    const think = own.profile_reasoning || 'low', temperature = own.profile_temperature ?? '', model = String(own.profile_model ?? '');
    // 온도를 쓰지 않거나 받지 않는 모델이면 까닭까지 적은 한 문장을 세 칸 아래에 온 폭으로 둔다(온도 칸 폭에는 까닭까지 들어가지 않는다)
    const said = TEMPERATURE_NOTE[limitsOf(model || given).temperature]?.(esc(model || given));
    const ignored = said ? `<div class="note btr-temp-note">${said}</div>` : '';
    // 모델 칸을 누르면 고른 프로필과 같은 주소로 가는 프로필들의 모델 이름이 고를 것으로 뜬다(다른 주소의 모델 이름은 이 주소에서 통하지 않는다). 목록에 없는 이름은 그대로 적는다
    const address = profiles.find(each => each.id === id)?.address, sameAddress = each => each.address === address;
    const fromProfiles = [...new Set(profiles.filter(sameAddress).map(each => each.model).filter(Boolean))].sort();
    // 주소가 내준 목록(또는 그 연결의 정해진 모델 목록)은 번역에 고를 만한 것만 추린다(core/model-list.js). 프로필에 적힌 모델과 지금 모델은 늘 남긴다
    const all = offered.get(address)?.length ? offered.get(address) : builtInModels(address?.split(' ')[0]);
    const modelNames = all.length ? pickModels(all, [...fromProfiles, model || given]) : fromProfiles;
    // 모델은 목록에서 고른다(적어 둔 이름이 목록에 없으면 그 이름도 한 줄로). '직접 적기'를 고르면 적는 칸으로 바뀐다
    const now = model || given, listed = modelNames.includes(now) || !now ? modelNames : [now, ...modelNames];
    const modelField = typeModel
        ? `<input type="text" class="input" data-k="profile_model" value="${esc(model)}" placeholder="${esc(given || '모델 이름')}" spellcheck="false" aria-label="모델">`
        : `<span class="btr-think"><select class="sel" data-k="profile_model" aria-label="모델">${listed.map(name => `<option value="${esc(name)}"${name === now ? ' selected' : ''}>${esc(name)}</option>`).join('')}<option value="${TYPE_MODEL}">직접 적기</option></select>${SV('down')}</span>`;
    // 모델 칸이 비면 프로필의 모델로 보낸다: 그 이름을 흐린 글로 보여 주어 무엇이 쓰이는지 바로 알게 한다
    const three = `<div class="three">
<div><div class="lab">모델</div>${modelField}</div>
<div><div class="lab">온도</div><input type="number" class="input" data-k="profile_temperature" min="0" max="2" step="0.05" value="${esc(temperature)}" placeholder="프리셋 값" aria-label="온도"></div>
<div><div class="lab">생각 수준</div><span class="btr-think"><select class="sel" data-k="profile_reasoning" aria-label="생각 수준">${THINK.map(([value, text]) => `<option value="${value}"${value === think ? ' selected' : ''}>${text}</option>`).join('')}</select>${SV('down')}</span></div></div>${ignored}`;
    const summary = [model || given, temperature === '' ? '프리셋 값' : `온도 ${temperature}`, thinkName(think)].filter(Boolean).join(', ');
    const more = pc ? `<div class="kids">${three}</div>`
        : `<div class="subl" data-t="more" role="button" tabindex="0">${IC('microchip')}<div class="k">모델, 온도, 생각 수준<small>${esc(summary)}</small></div>${SV('down')}</div>${foldHtml('more', false, three)}`;
    return `<div class="two${label ? '' : ' solo'}">${label ? `<span>${IC('plug')}연결</span>` : ''}${selHtml('profile', profile || '연결 프로필을 골라 주세요', { need: !profile })}</div>
${profile ? '' : '<div class="note" style="margin-top:8px">프로필은 실리태번 API 연결 화면에서 만들어요</div>'}
${foldHtml('profile', false, picksHtml('profile', profiles.map(p => ({ value: p.id, label: p.label })), id))}
${more}`;
}

export function drawConnection(box, api, options = {}) {
    const root = document.createElement('div');
    root.className = 'btr-connection';
    box.append(root);
    const context = () => SillyTavern.getContext();

    let typeModel = false;   // 모델을 목록 대신 직접 적는 중
    function paint() {
        // 적는 중에는 다시 그리지 않는다. 포커스는 판이 그려진 root 에서 읽는다(판이 shadow root 안이면 문서의 activeElement 는 그 겉 칸)
        const now = root.getRootNode().activeElement;
        if (now && root.contains(now) && now.matches('input')) return;
        const open = openFolds(root);
        root.innerHTML = html(context(), api.layers, { ...options, typeModel });
        // 프로필들의 주소마다 모델 목록을 미리 받아 둔다(주소 하나에 한 번): 프로필을 바꾸자마자 목록을 열어도 다 받은 목록이 보이게
        // 다시 그리는 것은 지금 고른 프로필의 주소 것을 받았을 때만(다른 주소 것이 올 때마다 그리면 열어 둔 목록이 닫힌다)
        const profiles = () => context().extensionSettings.connectionManager?.profiles ?? [];
        const nowAddress = () => addressOf(profiles().find(profile => profile.id === connectionOf(context(), api.layers).id));
        for (const profile of profiles()) loadOffered(context(), profile, address => { if (address === nowAddress()) paint(); });
        for (const id of open) setFold(root, id, true);
    }
    /** 옛 자리의 한 칸을 적는다(번역이 거기서 읽는다) */
    function writeOld(key, value) {
        const es = context().extensionSettings, own = es[OLD_SLOT] ?? (es[OLD_SLOT] = {});
        own[key] = value;
        context().saveSettingsDebounced();
    }
    function onPick(id, value) {
        if (id === 'profile') {
            api.layers.setSetting('model', value);
            // 모델 칸도 고른 프로필의 모델로 바꾼다: 앞 프로필에 맞춰 적어 둔 이름이 남으면 새 프로필로 그 모델을 보내게 된다
            const picked = (context().extensionSettings.connectionManager?.profiles ?? []).find(profile => profile.id === value);
            writeOld('profile_model', String(picked?.model ?? ''));
            typeModel = false;
        }
        api.refresh();
    }
    function onChange(event) {
        const key = event.target.dataset?.k;
        if (!key) return;
        if (event.target.value === TYPE_MODEL) { typeModel = true; paint(); root.querySelector('input[data-k="profile_model"]')?.focus(); return; }
        if (key === 'profile_model') typeModel = false;
        const text = event.target.value.trim();
        writeOld(key, key === 'profile_temperature' && text !== '' ? Math.max(0, Math.min(2, Number(text) || 0)) : text);
        event.target.blur();
        api.refresh();
    }
    const off = wire(root, onPick);
    root.addEventListener('change', onChange);
    paint();
    return { refresh: paint, close() { off(); root.removeEventListener('change', onChange); root.remove(); } };
}

registerScreen('connection', {
    title: '연결', icon: 'plug',
    render: (box, api) => drawConnection(box, api, { label: false, pc: api.wide }),
});
