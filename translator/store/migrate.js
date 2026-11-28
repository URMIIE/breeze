// 옛 번역기의 자료 가운데 '쓰는 곳'(store/layers.js)이 맡지 않는 것을 새 번역기가 이어받게 한다.
// 글만 다룬다: 옛 자료는 넘겨받은 것을 읽기만 하고(고치지도 지우지도 않는다), 새 자리에 쓰는 손도 넘겨받는다(store/hands.js 가 잇는다).
//
// 여기서 이어받는 것
// | 옛 자리 | 새 자리 | 때 |
// |---|---|---|
// | chat_metadata.llmt_screen_cache(채팅마다의 상태창 번역 { 글: 번역 }) | 그 캐릭터(그룹)의 상태창 번역 기록(store/status.js)에 없는 줄만 | 그 채팅을 열었을 때. 채팅 파일은 저장하지 않는다 |
// | 원작 확장의 설정 칸(원작 확장의 설정) | 같은 뿌리의 확장들이 함께 읽는 칸 옛 번역 확장의 설정 칸 | 시작할 때, 그 칸이 비어 있을 때만 |
// | 캐릭터 파일 이름이 바뀌기 전의 캐릭터별 파일 | 새 파일 이름으로 된 같은 파일 | 이름을 바꿨을 때(옛 파일은 그대로) |
//
// 다른 곳이 이어받는 것
// | 옛 자리 | 맡는 곳 |
// |---|---|
// | 용어집 · 말투 · 채팅 규칙 · 연결 · 보기 | store/old-layers.js 가 처음 값으로 읽고, 처음 고칠 때 새 자리에 적는다(읽기만으로는 채팅 파일을 저장하지 않으려고) |
// | 옛 번역 확장의 설정 칸 | store/settings.js 가 같은 칸을 그대로 읽는다 |
// | 옛 상태창 파일 user/files/llmt-screen-<해시>.json | store/status.js 가 새 파일이 없을 때 새 꼴로 읽는다 |
// | 메시지의 번역(extra.display_text 등) | 꼴이 같아 그대로 쓴다(store/message.js) |
//
// 이어받지 않는 것과 까닭
// | 옛 자리 | 까닭 |
// |---|---|
// | user/files/llmt-screen-cache.json(모든 채팅의 옛 공용 상태창 기록) · localStorage 'llmt:screen-cache' | 모든 캐릭터 것이 섞여 있어 어느 캐릭터 것인지 모른다 |
// | IndexedDB LLMtranslatorDB(메시지 원문 통째 → 번역 통째) | 새 기억은 문단마다다. 통째 번역의 어느 부분이 어느 문단의 번역인지 적혀 있지 않고, 새 열쇠에 드는 설정 지문(프롬프트 · 모델 · 사람 · 이름 · 규칙)도 그 번역을 만든 때의 것을 모른다 |
// | IndexedDB LLMtranslatorSegments(문단) | 열쇠가 원문 + 옛 설정의 SHA-256 이고 줄에 원문이 없어, 새 열쇠(원문 + 새 설정 지문)를 만들 수 없다. 30일 지난 줄은 옛 번역기도 안 쓴다 |
// | IndexedDB LLMtranslatorProgress(이어 받기) | 하루만 쓰는 자료다 |

const CUSTOM = 'llm-translator-custom', ORIGIN = 'llm-translator', CHAT_STATUS = 'llmt_screen_cache';
const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
const filled = v => isObject(v) && Object.keys(v).length > 0;

/**
 * 원작 확장의 설정만 있는 설치본에서 처음 값으로 삼을 설정. 함께 읽는 칸에 이미 값이 있거나 원작 설정이 없으면 null.
 * @param {object} settings extension_settings(읽기만)
 * @returns {object | null} 베낀 값
 */
export function originSettings(settings) {
    if (filled(settings?.[CUSTOM]) || !filled(settings?.[ORIGIN])) return null;
    return JSON.parse(JSON.stringify(settings[ORIGIN]));
}

/**
 * 그 채팅에 남은 옛 상태창 번역 { 글: 번역 }. 없으면 null.
 * 값이 null 인 줄('이 채팅에선 안 씀')과 번역이 원문과 같은 줄(번역을 못 받은 채 적힌 것)은 뺀다: 다음에 화면에 나오면 새로 묻는다.
 * @param {object | null} meta chat_metadata(읽기만)
 */
export function chatStatus(meta) {
    const cache = meta?.[CHAT_STATUS], records = {};
    if (!isObject(cache)) return null;
    for (const [text, value] of Object.entries(cache)) if (typeof value === 'string' && value && value.trim() !== text.trim()) records[text] = value;
    return Object.keys(records).length ? records : null;
}

/**
 * 그 채팅의 옛 상태창 번역을 캐릭터의 기록에 보탠다: 기록에 없는 줄만(store/status.js adopt). 채팅마다 한 번(기록에 받아 온 채팅으로 적는다).
 * 기록은 바뀐 것으로 표시될 뿐 여기서 저장하지 않는다: 그 기록이 다음에 저장될 때 같이 적힌다.
 * @param {object} rec store/status.js open 의 것  @param {string} chatId  @param {object | null} meta chat_metadata(읽기만)
 * @returns {number} 보탠 줄 수
 */
export function adoptChatStatus(rec, chatId, meta) {
    if (!chatId || rec.took(chatId)) return 0;
    const records = chatStatus(meta);
    if (!records) return 0;
    const before = rec.size();
    rec.adopt(records);
    rec.markTaken(chatId);
    return rec.size() - before;
}

/**
 * 캐릭터 파일 이름이 바뀌었을 때: 옛 이름으로 적힌 파일을 새 이름으로도 적는다. 옛 파일은 그대로 두고, 새 이름의 파일이 이미 있으면 덮지 않는다.
 * @param {[from: string, to: string][]} pairs 파일 이름 쌍(앞 쌍이 적은 파일은 뒤 쌍이 덮지 않는다)
 * @param {{ load: (name: string) => Promise<object | null>, save: (name: string, data: object) => Promise<unknown> }} hands
 * @returns {Promise<string[]>} 새로 적은 파일 이름
 */
export async function followRename(pairs, { load, save }) {
    const written = [];
    for (const [from, to] of pairs) {
        if (from === to || written.includes(to) || await load(to)) continue;
        const data = await load(from);
        if (!data) continue;
        await save(to, data);
        written.push(to);
    }
    return written;
}
