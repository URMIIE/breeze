// 채팅 목록 · 홈 화면 최근 채팅의 ‘마지막 말’ 미리보기를 화면에 보이는 글처럼.
// 서버는 마지막 메시지 원문(mes)을 그대로 주므로 맨 앞 생각 글 · 화면에선 정규식이 지우는 태그 · 번역 전 원문이 보인다.
// 응답을 받아 생각 칸을 빼고 → 화면 표시용 정규식(전역 · 그 답의 프리셋 · 그 캐릭터 카드, 허용된 것, 켜진 것만)을 돌리고 → 보이는 글자만 남긴다.
// 짝 서버 플러그인이 있으면 서버가 보이는 번역문(display_mes) · 내 말 여부 · 그 답의 프리셋을 같이 주고, 없으면 원문으로 같은 일을 한다.
// 실리태번 자신이 부른 요청만 바꾼다(다른 확장이 채팅 목록을 읽는 건 그대로). 다른 확장이 같은 변환을 쓰려면 Symbol.for('breeze.toScreen').

import { loadPresetRegex, presetRegexOf, wouldBlock } from '../lib/preset-regex.js';
import { runRegexScript, getScriptsByType, SCRIPT_TYPES, regex_placement } from '../../../regex/engine.js';

const PATHS = ['/api/characters/chats', '/api/chats/recent', '/api/chats/search'];
const CALLERS = /welcome-screen\.js|\/script\.js[?:]/;
const PREVIEW_LEN = 400;

function reasoningTags() {
    const r = SillyTavern.getContext().powerUserSettings?.reasoning || {};
    const pairs = [['<thinking>', '</thinking>'], ['<think>', '</think>'], ['<reasoning>', '</reasoning>']];
    if (r.prefix && r.suffix) pairs.push([r.prefix.trim(), r.suffix.trim()]);
    return pairs;
}

function dropReasoning(text) {
    let t = text;
    for (const [open, close] of reasoningTags()) {
        // 모델이 <Think> 처럼 대소문자를 섞어 씀
        const lo = () => t.toLowerCase();
        const o = open.toLowerCase(), cl = close.toLowerCase();
        let i;
        while ((i = lo().indexOf(o)) !== -1) {
            const j = lo().indexOf(cl, i + o.length);
            // 닫는 태그가 없으면 생각이 끝까지 이어진 것 — 뒤를 다 뺌
            t = j === -1 ? t.slice(0, i) : t.slice(0, i) + t.slice(j + cl.length);
        }
    }
    return t;
}

// 화면은 답마다 그 답을 만든 프리셋(extra.regex_preset, 허용된 것)의 정규식으로 그림 → 미리보기도 같게
const nfc = s => String(s ?? '').normalize('NFC');
function presetScriptsFor(name) {
    const c = SillyTavern.getContext();
    const pm = c.getPresetManager?.('openai');
    const current = pm?.getSelectedPresetName?.();
    if (pm && name && nfc(name) !== nfc(current)) {
        const allowed = c.extensionSettings.preset_allowed_regex?.openai || [];
        // 읽으면 화면이 멈추는(쓸 때만 받기) 프리셋은 서버 표가 올 때까지 지금 프리셋 정규식으로
        const scripts = wouldBlock(pm, name) ? null : presetRegexOf(pm, name);
        if (Array.isArray(scripts) && allowed.some(n => nfc(n) === nfc(name))) return scripts;
    }
    return getScriptsByType(SCRIPT_TYPES.PRESET, { allowedOnly: true });
}

function displayScripts(avatar, isUser, preset) {
    const c = SillyTavern.getContext();
    const placement = isUser ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
    const list = [...(c.extensionSettings.regex || []), ...presetScriptsFor(preset)];
    const ch = avatar ? c.characters.find(x => x.avatar === avatar) : null;
    if (ch && (c.extensionSettings.character_allowed_regex || []).includes(avatar)) list.push(...(ch.data?.extensions?.regex_scripts || []));
    // 저장된 글엔 ‘표시 전용 아님’ 정규식이 이미 걸려 있으므로 화면에서 더 거는 표시 전용만. 미리보기는 마지막 메시지 = 깊이 0.
    const scripts = list.filter(s => s && !s.disabled && s.markdownOnly && Array.isArray(s.placement) && s.placement.includes(placement)
        && !(Number.isFinite(s.minDepth) && s.minDepth > 0));
    return { scripts, name: ch?.name };
}

function visibleText(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    doc.querySelectorAll('style, script, template, iframe, noscript, [hidden]').forEach(n => n.remove());
    doc.querySelectorAll('[style]').forEach(n => { if (/display\s*:\s*none/i.test(n.getAttribute('style'))) n.remove(); });
    doc.querySelectorAll('br, p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach(n => n.append(' '));
    const all = doc.body.textContent || '';
    // 정규식이 그린 카드(상태창 · 작업 메모 등 class · style 을 단 덩어리)를 빼고 본문 글만 — 미리보기 끝 400자가 카드 글로 채워지지 않게.
    // 본문까지 카드 안에 든 답이면 남는 게 거의 없으므로 그땐 카드 글까지 다 씀
    doc.querySelectorAll('[class], [style], details, table').forEach(n => n.remove());
    const prose = doc.body.textContent || '';
    return prose.replace(/\s+/g, '').length >= 40 ? prose : all;
}

export function toScreen(raw, avatar, isUser, preset) {
    if (typeof raw !== 'string' || !raw || raw.startsWith('[The ')) return raw;
    let t = dropReasoning(raw);
    const { scripts, name } = displayScripts(avatar, isUser, preset);
    for (const s of scripts) {
        try { t = runRegexScript(s, t, { characterOverride: name }); } catch { /* 깨진 정규식은 건너뜀 */ }
    }
    t = t.replace(/```[\s\S]*?```/g, m => (m.includes('<') ? ' ' : m.replace(/```\w*/g, ' ')));   // HTML 카드 코드 덩어리는 화면에선 카드
    t = visibleText(t)
        .replace(/\*+/g, '')
        .replace(/◆\d+◆/g, ' ')   // 번역문 안의 칸 자리 표시(화면에선 원래 칸 모양으로 그려짐)
        .replace(/^\s*#{1,6}\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    // 생각 칸 · 화면에서 지워지는 것만 있던 글이면 원문(태그째) 대신 빈 미리보기
    return t;
}

function bodyOf(init) {
    try { return typeof init?.body === 'string' ? JSON.parse(init.body) : {}; } catch { return {}; }
}

let orig = null, wrapped = null, on = false;
// 우리가 바꾼 글이 화면에 그대로 나오는지: 실리태번이 목록을 그린 조금 뒤 미리보기 칸을 우리가 만든 글과 견줌.
// 칸 두 개 이상이 전부 우리 글이 아니면 다른 쪽이 그린 뒤에 고쳐 쓰는 것(그쪽 글이 보이므로 우리 일은 헛일) → 쉬는 중 표시만(바꾸기는 계속, 그쪽이 꺼지면 바로 보이게)
const PREVIEW_CELLS = '.select_chat_block_mes, .recentChat .chatMessage';
const flat = (t) => String(t || '').replace(/\s+/g, ' ').trim();
let produced = new Set(), lookTimer = 0;
function lookLater() {
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => {
        const cells = [...document.querySelectorAll(PREVIEW_CELLS)].map(el => flat(el.textContent)).filter(Boolean);
        if (cells.length < 2 || !produced.size) return;
        const ours = cells.filter(t => produced.has(t) || [...produced].some(p => p.endsWith(t.replace(/^\.\.\./, '')))).length;
        if (ours) { api?.rest(null); return; }
        api?.rest('same', { saw: 'breeze가 다듬은 미리보기 글을 화면에 그린 뒤, 다른 쪽이 또 고쳐 썼어요', who: { kind: 'unknown' }, back: '그쪽을 끄면 다음에 목록을 열 때부터 breeze 글이 보여요.' });
    }, 1500);
}
let api = null;
export function start(a) {
    api = a;
    loadPresetRegex();
    globalThis[Symbol.for('breeze.toScreen')] = toScreen;
    on = true;
    if (wrapped) return;
    orig = window.fetch;
    wrapped = async function (input, init) {
        const url = typeof input === 'string' ? input : input?.url || '';
        const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        if (!on || !PATHS.includes(path) || !CALLERS.test(new Error().stack || '')) return orig.apply(this, arguments);
        const res = await orig.apply(this, arguments);
        if (!res.ok) return res;
        try {
            const data = await res.clone().json();
            if (!Array.isArray(data)) return res;
            const body = bodyOf(init);
            produced = new Set();
            for (const item of data) {
                if (!item || typeof item !== 'object') continue;
                const avatar = item.avatar || body.avatar_url || null;
                if (path === '/api/chats/search') {
                    // 채팅 파일 관리 창 기능이 켜져 있으면 그쪽이 줄 글을 따로 그려서 여기 일은 헛일 → 건너뜀
                    if (globalThis[Symbol.for('breeze.chatFileList')] && item.preview_head) continue;
                    // 서버가 마지막 글 조각을 못 준 항목(마지막 줄을 못 읽음)은 실리태번 미리보기 글(끝 400자)이라도 다듬음 — 안 하면 태그가 그대로 보였음
                    const raw = item.preview_tail || (item.display_mes || item.preview_source || item.preview_message);
                    if (typeof raw !== 'string') continue;
                    const t = toScreen(raw, avatar, item.mes_is_user, item.mes_preset);
                    item.preview_message = t.length > PREVIEW_LEN ? '...' + t.slice(-PREVIEW_LEN) : t;
                    produced.add(flat(item.preview_message));
                } else if (typeof item.mes === 'string') {
                    item.mes = toScreen(item.display_mes || item.mes, avatar, item.mes_is_user, item.mes_preset);
                    produced.add(flat(item.mes));
                }
            }
            lookLater();
            return new Response(JSON.stringify(data), { status: res.status, statusText: res.statusText, headers: res.headers });
        } catch (error) {
            console.warn('[Breeze] 미리보기 다듬기', error);
            return res;
        }
    };
    window.fetch = wrapped;
}

// 다른 확장이 그 뒤에 fetch 를 또 감쌌으면 우리 것만 빼낼 수 없어, 그땐 감싼 채로 두고 그냥 지나가게 한다
export function stop() {
    on = false;
    delete globalThis[Symbol.for('breeze.toScreen')];
    if (window.fetch === wrapped) { window.fetch = orig; wrapped = null; }
}
