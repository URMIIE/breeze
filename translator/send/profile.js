// 번역 요청을 실리태번 연결 프로필로 보낸다. 키 · 주소 · 프록시는 프로필 것을 그대로 쓰고, 번역에만 모델 · 온도 · 생각 수준을 덮어쓴다. 최대 출력 토큰은 보내는 글에 맞춰 정한다(send/room.js).
//
// 멈춤 알아채기: 첫 글이 올 때까지의 기다림과, 글이 오다가 멈춘 사이를 따로 잰다.
//   글 사이 멈춤(idle)은 받은 조각이 남아 있으니 부르는 쪽이 남은 부분만 다시 보낼 수 있다.
//   첫 글 기다림(first)이 넘쳐도 끊기만 하고 다시 보내지 않는다: 공급자가 앞 요청을 아직 처리 중이면 두 번 청구된다(2026-11-07 사용자 결정).
//   첫 글 시계는 기본으로 걸지 않는다(store/settings.js stallFirst 의 주석).
//   생각 조각(reasoning)이 와도 모델이 일하는 중이라 살아 있는 것으로 본다(글만 세면 답 중간에 생각하는 모델을 끊었다).
// 다시 보내기: 오류가 나도 저절로 다시 보내지 않는다(2026-11-27 사용자 결정). 글이 오다 멈췄을 때만 job/run.js 가 남은 부분을 다시 보낸다.

import { outputRoom, learnFromCut, learnCap } from './room.js';
import { limitsOf } from '../core/model-limits.js';

/** 오류 글: 실리태번은 'API request failed' 로 감싸고 진짜 까닭을 cause 에 둔다 */
const errorText = error => [error?.message, error?.cause?.message, error?.cause?.cause?.message].filter(Boolean).join(' / ');

/**
 * 첫 글 기다림과 글 사이 멈춤을 따로 재는 시계.
 * @param {{ firstMs: number, idleMs: number, onStall: (kind: 'first' | 'idle') => void, timers?: { set: Function, clear: Function }, now?: () => number }} o
 *   firstMs · idleMs 가 0 이면 그 시계는 걸지 않는다
 */
export function stallClock({ firstMs, idleMs, onStall, timers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) }, now = Date.now }) {
    let timer = null, started = 0, last = 0, first = -1, gap = 0;
    const arm = (ms, kind) => {
        if (timer !== null) timers.clear(timer);
        timer = ms > 0 ? timers.set(() => { timer = null; onStall(kind); }, ms) : null;
    };
    return {
        start() { started = last = now(); arm(firstMs, 'first'); },
        /** 글이나 생각 조각이 왔다 */
        alive() {
            const t = now();
            if (first < 0) first = t - started; else gap = Math.max(gap, t - last);
            last = t;
            arm(idleMs, 'idle');
        },
        stop() { if (timer !== null) timers.clear(timer); timer = null; },
        /** 잰 것: 첫 글까지(ms, 안 왔으면 -1) · 가장 긴 글 사이 멈춤(ms) */
        measured: () => ({ first, gap }),
    };
}

/** 프로필을 찾는다. 없으면 보낼 수 없다 */
function profileOf(context, settings) {
    if (!context.ConnectionManagerRequestService || context.extensionSettings?.disabledExtensions?.includes('connection-manager')) {
        throw new Error('실리태번 연결 관리(Connection Manager) 확장을 켜 주세요.');
    }
    const profile = context.extensionSettings?.connectionManager?.profiles?.find(p => p.id === settings.profileId);
    if (!profile) throw new Error('번역에 쓸 연결 프로필을 골라 주세요.');
    return profile;
}

/** 번역에 쓰는 모델 이름: 번역에만 덮어쓴 모델 → 프로필의 모델 */
export function modelOf(context, settings) {
    const profile = context.extensionSettings?.connectionManager?.profiles?.find(p => p.id === settings.profileId);
    return String(settings.model || profile?.model || '');
}

// custom 연결(OpenAI 꼴 주소)에서 생각 수준을 받지 않는다고 거절한 모델. 거절된 요청은 값이 들지 않아 생각 수준을 빼고 한 번 다시 보낸다
const noEffort = new Set();

/** 프로필에 묶인 프리셋의 덧붙이는 본문(실리태번이 그 프리셋으로 요청을 짤 때 싣는 글) */
function presetIncludeBody(context, profile) {
    if (!profile.preset) return '';
    const preset = context.getPresetManager?.('openai')?.getCompletionPresetByName?.(profile.preset);
    const text = String(preset?.custom_include_body ?? '');
    return context.substituteParams ? context.substituteParams(text) : text;
}

/** 덧붙이는 본문(YAML)에 reasoning_effort 줄을 잇는다. 이미 적혀 있으면 사용자가 적은 값을 그대로 둔다 */
function withEffort(body, effort) {
    const text = String(body ?? '').replace(/\s+$/, '');
    if (/^\s*-?\s*reasoning_effort\s*:/m.test(text)) return text;
    if (!text) return `reasoning_effort: ${effort}`;
    // 목록 꼴('- 칸: 값')로 적은 본문에는 같은 꼴로 잇는다
    return /^\s*-\s/.test(text) ? `${text}\n- reasoning_effort: ${effort}` : `${text}\nreasoning_effort: ${effort}`;
}

/** 번역에만 덮어쓸 값. Vertex 는 실리태번이 지역만 넘기므로 인증 방식 · 프로젝트를 같이 넘긴다 */
function payloadFor(context, settings, profile, model) {
    const payload = { custom_prompt_post_processing: 'merge' };
    if (settings.model) payload.model = settings.model;
    // 온도를 거절하는 모델에는 싣지 않는다(실으면 요청이 통째로 거절된다)
    if (settings.temperature !== null && limitsOf(model).temperature !== 'rejected') payload.temperature = settings.temperature;
    // 생각 수준: 고른 값이 있을 때만 덮어쓴다(비어 있으면 프로필 · 프리셋의 값 그대로)
    if (settings.reasoning) payload.reasoning_effort = settings.reasoning;
    // custom 연결: 실리태번 서버는 reasoning_effort 를 OpenAI 의 정해진 모델 이름일 때만 나가는 본문에 옮기고 그 밖에는 버린다
    //   (src/endpoints/backends/chat-completions.js 'A few of OpenAIs reasoning models' 줄). 그래서 고른 생각 수준이 모델에 닿지 않고
    //   모델 기본 생각으로 돌았다. 서버가 그대로 옮겨 주는 덧붙이는 본문 칸으로 싣는다(프리셋의 덧붙이는 본문이 있으면 그 뒤에 잇는다)
    if (settings.reasoning && profile.api === 'custom' && !noEffort.has(model)) {
        payload.custom_include_body = withEffort(presetIncludeBody(context, profile), settings.reasoning);
    }
    if (profile.api === 'vertexai') {
        const cc = context.chatCompletionSettings || {};
        payload.vertexai_auth_mode = cc.vertexai_auth_mode || 'express';
        if (cc.vertexai_express_project_id) payload.vertexai_express_project_id = cc.vertexai_express_project_id;
    }
    return payload;
}

/** 흘려 받은 답을 끝까지 읽는다. 글이 늘 때마다 onText, 글이나 생각이 늘 때마다 clock.alive. 받은 글은 got.text 에 둔다(도중에 끊겨도 받은 데까지 쓰게) */
async function readStream(stream, { onText, clock, got }) {
    let thought = 0;
    for await (const chunk of stream()) {
        const now = typeof chunk?.text === 'string' ? chunk.text : got.text;
        const thinking = String(chunk?.state?.reasoning ?? '').length;
        if (now.length > got.text.length || thinking > thought) clock.alive();
        thought = thinking;
        if (now.length <= got.text.length) continue;
        got.text = now;
        try { onText?.(now); } catch { /* 받는 중 보여 주기는 받기를 막지 않는다 */ }
    }
}

/** 오류를 사용자에게 보일 꼴로: 실리태번은 'API request failed' 로 감싸 진짜 까닭을 cause 에 둔다 */
function failure(error) {
    const detail = (error?.cause?.message || error?.message || '').slice(0, 80);
    return Object.assign(new Error(`번역 요청이 실패했어요 (${detail})`), { cause: error });
}

/**
 * 요청 한 번(다시 보내기 없이). 늘 흘려 받는다(2026-11-26 사용자 결정).
 * 글을 받다가 연결이 끊기면 받은 데까지를 답으로 돌려준다: 같은 요청을 통째로 다시 보내면 값이 두 번 든다.
 * 엔진이 그것을 끊긴 답으로 보고 남은 조각만 이어 받는다. 한 글자도 못 받은 오류만 던진다(부르는 쪽이 한 번 더 보낼 수 있다).
 * @param {number} o.room 실을 최대 출력 토큰
 * @returns {Promise<string>} 답 글
 */
async function sendOnce(context, settings, prompt, { onText, signal, model, room }) {
    const profile = profileOf(context, settings);
    const controller = new AbortController();
    const forward = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', forward, { once: true });
    if (signal?.aborted) forward();
    let stalled = '';
    const clock = stallClock({ firstMs: settings.stallFirst * 1000, idleMs: settings.stallIdle * 1000, onStall: kind => { stalled = kind; controller.abort(); } });
    const custom = { stream: true, signal: controller.signal, extractData: true, includePreset: true };
    const got = { text: '' };
    try {
        clock.start();
        // 프리필(send/prefill.js 가 설정에 얹은 글)이 있으면 맨 끝에 모델의 말로 붙인다. 맨 끝이 AI 의 말인 요청을 거절하는 모델에는 붙이지 않는다
        const prefill = settings.prefill && limitsOf(model).prefill !== 'rejected';
        const messages = [{ role: 'user', content: prompt }, ...(prefill ? [{ role: 'assistant', content: settings.prefill }] : [])];
        const stream = await context.ConnectionManagerRequestService.sendRequest(profile.id, messages, room, custom, payloadFor(context, settings, profile, model));
        if (typeof stream !== 'function') throw new Error('연결 프로필이 흘려 주는 답을 내주지 않았어요.');
        await readStream(stream, { onText, clock, got });
        if (!got.text.trim()) throw Object.assign(new Error('연결 프로필에서 빈 답을 받았어요.'), { empty: true });
        learnFromCut(prompt, model, got.text, room);
        return got.text;
    } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        if (stalled) throw stallError(stalled, settings);
        if (error?.empty) throw error;
        if (!got.text.trim()) throw failure(error);
        console.info('[번역] 받다가 끊겨서 받은 데까지만 써요:', errorText(error).slice(0, 120));
        return got.text;
    } finally {
        clock.stop();
        signal?.removeEventListener('abort', forward);
    }
}

/** 실은 최대 출력 토큰이 모델 한도를 넘어 거절되면, 오류 글에서 한도를 배워 그 값으로 한 번 다시 보낸다(거절된 요청은 값이 들지 않았다) */
async function withinCap(attempt, model, room) {
    try {
        return await attempt(room);
    } catch (error) {
        const cap = learnCap(model, errorText(error), room);
        if (!cap) throw error;
        return attempt(cap);
    }
}

/** 실은 생각 수준을 그 모델이 받지 않는다고 거절하면 그 모델에는 싣지 않고 한 번 다시 보낸다(거절된 요청은 값이 들지 않았다) */
async function withinEffort(attempt, model, sentEffort) {
    try {
        return await attempt();
    } catch (error) {
        if (!sentEffort || noEffort.has(model) || !/reasoning[_ ]?effort/i.test(errorText(error))) throw error;
        noEffort.add(model);
        console.info(`[번역] ${model} 이 생각 수준을 받지 않아 빼고 다시 보내요`);
        return attempt();
    }
}

function stallError(kind, settings) {
    const message = kind === 'first'
        ? `첫 글이 ${settings.stallFirst}초 동안 오지 않아 끊었어요.`
        : `${settings.stallIdle}초 동안 글이 더 오지 않아 끊었어요.`;
    return Object.assign(new Error(message), { stall: kind });
}

/**
 * 엔진(run/translate.js)에 내주는 보내기 함수를 만든다.
 * @param {object} context 실리태번 getContext()
 * @param {ReturnType<import('../store/settings.js').readSettings>} settings
 * @returns {(prompt: string, o: { onText?: Function, signal?: AbortSignal }) => Promise<string>}
 */
export function profileSender(context, settings) {
    return (prompt, { onText, signal } = {}) => {
        const model = modelOf(context, settings);
        const attempt = room => sendOnce(context, settings, prompt, { onText, signal, model, room });
        const profile = context.extensionSettings?.connectionManager?.profiles?.find(p => p.id === settings.profileId);
        const sentEffort = Boolean(settings.reasoning) && profile?.api === 'custom';
        // 오류가 나도 저절로 다시 보내지 않는다(저절로 다시 보내는 것은 글이 오다 멈췄을 때뿐: job/run.js). 위 둘은 거절된 요청이라 값이 들지 않았다
        return withinEffort(() => withinCap(attempt, model, outputRoom(prompt, model)), model, sentEffort);
    };
}
