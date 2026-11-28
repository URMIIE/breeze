// 연결 주소가 내주는 모델 이름들 가운데 번역에 고를 만한 것만 남긴다.
//   1. 글을 번역하지 못하는 모델(목소리 · 받아쓰기 · 그림 · 음악 · 영상 · 임베딩)을 뺀다. omni 는 영상을 만드는 모델 이름이다
//   2. 같은 모델의 날짜 · 차수 붙은 판(…-03-25, …-20250219, …-002, …-exp)은 날짜 없는 이름이 있으면 뺀다
//   3. 같은 갈래(이름에서 판 번호만 뺀 것: gemini-#-flash)마다 판 번호가 높은 둘만 남긴다
//   4. 같은 회사 이름(첫 숫자 앞 글: gemini-) 안에서 가장 높은 큰 번호보다 둘 이상 낮은 것은 뺀다
// 판 번호를 읽을 수 없는 이름은 그대로 둔다. keep 에 준 이름(프로필에 적힌 모델, 지금 고른 모델)은 늘 남긴다.

const NOT_TEXT = /(?:^|[-_/.])(?:omni|robotics|tts|transcribe|whisper|speech|audio|embed(?:ding)?s?|imagen?|image|banana|lyria|veo|sora|dall-e|rerank|moderation)(?:$|[-_/.\d])/i;
const SNAPSHOT = /(?:[-@_](?:\d{8}|\d{6}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|0\d{2})|-exp)(?=$|[-@_])/gi;
const VERSION = /(\d+)(?:[.-](\d{1,2})(?![\d]))?/;
const PER_FAMILY = 2;

function read(name) {
    const base = name.replace(SNAPSHOT, ''), hit = VERSION.exec(base);
    if (!hit) return null;
    return {
        name, base, dated: base !== name,
        vendor: base.slice(0, hit.index).toLowerCase(),
        family: (base.slice(0, hit.index) + '#' + base.slice(hit.index + hit[0].length)).toLowerCase(),
        major: Number(hit[1]), version: Number(hit[1]) + Number(hit[2] ?? 0) / 100,
    };
}

/**
 * @param {string[]} names 주소가 내준 모델 이름들
 * @param {string[]} [keep] 늘 남길 이름들
 * @returns {string[]} 고를 만한 이름들(받은 차례 그대로)
 */
export function pickModels(names, keep = []) {
    const kept = new Set(keep), text = names.filter(name => kept.has(name) || !NOT_TEXT.test(name));
    const rows = text.map(read), plain = new Set(rows.filter(row => row && !row.dated).map(row => row.base.toLowerCase()));
    const top = new Map(), families = new Map();
    for (const row of rows) {
        if (!row) continue;
        top.set(row.vendor, Math.max(top.get(row.vendor) ?? 0, row.major));
        const list = families.get(row.family) ?? families.set(row.family, []).get(row.family);
        if (!list.includes(row.version)) list.push(row.version);
    }
    for (const list of families.values()) list.sort((a, b) => b - a).splice(PER_FAMILY);
    return text.filter((name, at) => {
        const row = rows[at];
        if (!row || kept.has(name)) return true;
        if (row.dated && plain.has(row.base.toLowerCase())) return false;
        return families.get(row.family).includes(row.version) && row.major > top.get(row.vendor) - 2;
    });
}
