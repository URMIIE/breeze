// 내 글을 번역해 보낼 때 요청에 같이 넣는 참고 글: 이름 · 용어 · 말투를 맞추라고 주는 것(번역할 글이 아니다). 켠 것만 넣는다.
// 실리태번 getContext() 로 받은 것만 쓴다.
//
// 옛 번역기에서 옮긴 판단:
//   자르는 자리가 두 단위짜리 글자(그림 글자)의 가운데면 한 단위 덜 자른다: 앞 반쪽만 남은 글자는 요청 본문에서 깨진 글자라
//     공급자가 요청을 통째로 거절할 수 있다.
//   최근 대화는 화면에 보이는 이야기 글만 넣는다: 답의 글을 그대로 자르면 맨 앞의 생각 덩이나, 화면에서는 정규식이 가려 둔
//     덩이(계획 · 요약 · 상태 코드)가 자리를 다 차지해 말투를 맞출 이야기 글이 한 줄도 안 들어갔다.
//     그래서 화면용 정규식을 실리태번이 그릴 때처럼 먼저 거치고(shown), 남은 생각 덩이 · 꾸밈 코드 · 태그를 뺀다.
//   월드인포는 실리태번이 프롬프트를 만들 때처럼 최근 글과 새 글을 훑어 걸리는 것만(시늉으로만 돌려 채팅에 남는 것이 없다).
// 자르는 글자 수와 월드인포 예산은 옛 번역기의 값 그대로다(재 본 기록은 없다).

const LIMIT = { persona: 1500, description: 2500, personality: 800, scenario: 800, note: 1500, world: 4000, message: 600 };
const WORLD_BUDGET = 8192;

export const REFERENCE_HEAD = '[Reference: use only to keep names, terms and speech style consistent. Do NOT translate or repeat it in the output]';

/** max 자에서 자른다(잘랐으면 끝에 …) */
export function clip(value, max) {
    const text = String(value ?? '').trim();
    if (text.length <= max) return text;
    const lead = text.charCodeAt(max - 1);
    return `${text.slice(0, lead >= 0xD800 && lead <= 0xDBFF ? max - 1 : max)}…`;
}

/** 화면에 글로 보이는 것만: 생각 덩이 · 꾸밈 코드 · 태그를 뺀다 */
function storyOf(text) {
    return String(text ?? '')
        .replace(/<(thinking|think|thought)>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '')
        .replace(/<\/?[a-zA-Z][^>\n]{0,200}>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function personaPart(context) {
    const text = clip(context.powerUserSettings?.persona_description, LIMIT.persona);
    return text ? `<persona name="${context.name1}">\n${text}\n</persona>` : '';
}

function characterPart(context) {
    const card = context.characters?.[context.characterId];
    if (!card) return '';
    const body = [
        card.description && `Description: ${clip(card.description, LIMIT.description)}`,
        card.personality && `Personality: ${clip(card.personality, LIMIT.personality)}`,
        card.scenario && `Scenario: ${clip(card.scenario, LIMIT.scenario)}`,
    ].filter(Boolean).join('\n');
    return body ? `<character name="${card.name}">\n${body}\n</character>` : '';
}

function notePart(context) {
    const text = clip(context.chatMetadata?.note_prompt, LIMIT.note);
    return text ? `<authors_note>\n${text}\n</authors_note>` : '';
}

async function worldPart(context, recent, text) {
    try {
        const scan = [...recent.map(m => m.mes), text].reverse();
        const { worldInfoString } = await context.getWorldInfoPrompt(scan, WORLD_BUDGET, true);
        const found = clip(worldInfoString, LIMIT.world);
        return found ? `<world_info>\n${found}\n</world_info>` : '';
    } catch (error) {
        console.warn('[번역] 참고로 넣을 월드인포를 만들지 못했어요:', error);
        return '';
    }
}

function recentPart(recent, shown) {
    const lines = recent.map(m => [m.name, clip(storyOf(shown(m)), LIMIT.message)]).filter(([, text]) => text);
    return lines.length ? `<recent_chat>\n${lines.map(([name, text]) => `${name}: ${text}`).join('\n\n')}\n</recent_chat>` : '';
}

/**
 * @param {object} context 실리태번 getContext()
 * @param {{ refPersona: boolean, refChar: boolean, refNote: boolean, refWorld: boolean, refRecent: boolean }} s store/outgoing.js readOutgoing 의 값
 * @param {{ text: string, at: number, count: number, shown?: (message: object) => string }} o
 *   text: 보내는 글, at: 그 글의 메시지 번호(이 앞의 글만 최근 대화로 본다), count: 최근 대화로 볼 메시지 수, shown: 그 메시지가 화면에 보이는 글
 * @returns {Promise<string>} 요청에 붙일 글('' 이면 붙일 것 없음)
 */
export async function buildReference(context, s, { text, at, count, shown = m => m.mes }) {
    const chat = context.chat || [];
    const recent = chat.slice(Math.max(0, at - count), at).filter(m => m && !m.is_system);
    const safeShown = m => { try { return shown(m); } catch { return m.mes; } };
    const parts = [
        s.refPersona ? personaPart(context) : '',
        s.refChar ? characterPart(context) : '',
        s.refNote ? notePart(context) : '',
        s.refWorld ? await worldPart(context, recent, text) : '',
        s.refRecent ? recentPart(recent, safeShown) : '',
    ].filter(Boolean);
    return parts.length ? `${REFERENCE_HEAD}\n${parts.join('\n')}` : '';
}
