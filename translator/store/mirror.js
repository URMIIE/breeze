// 이 채팅의 말투를 옛 자리(chat_metadata.llmt_style_profiles_v1)에도 옛 꼴로 같이 적는다.
//
// 까닭: 번역기 밖의 기능이 그 열쇠에서 "이 사람이 누구에게 존댓말을 쓰는가"를 읽는다. 새 번역기는 사람의 말투를 새 자리에만 적으므로,
// 같이 적지 않으면 그쪽은 고치기 전의 말투를 계속 본다.
//
// 옛 꼴: [{ id, speaker, listener, mutual, mode, note }]
//   speaker · listener  이름(쉼표로 여러 표기). listener 가 ''이면 그 사람의 평소 말투
//   mode                'polite' 존댓말 · 'casual' 반말 · 'custom' 글로 적은 말투(note)
// 적는 것은 지금 이 채팅에 실제로 쓰이는 말투(쓰는 곳 셋을 합친 값)다: 읽는 쪽은 이 채팅의 열쇠 하나만 본다.
//
// 적는 때는 사람을 저장하거나 지울 때뿐이다(읽기만으로는 적지 않는다: 채팅을 열기만 해도 채팅 파일이 저장되면 최근 채팅 차례가 바뀐다).
// 옛 자리에 적기 전에 이 채팅의 새 자리를 먼저 만든다: 새 자리가 비어 있으면 번역기가 옛 자리를 처음 값으로 읽는데,
// 거기에 합친 값을 적으면 캐릭터 전체에 둔 말투가 이 채팅의 말투로 다시 읽혀 나중에 캐릭터 쪽을 고쳐도 가려진다.

export const OLD_STYLE_KEY = 'llmt_style_profiles_v1';
const MODE_WORDS = [['존댓말', 'polite'], ['반말', 'casual']];

/** 말투 글 → 옛 꼴의 mode 와 note. '존댓말, 덧붙인 글'처럼 낱말로 시작하면 그 mode 와 나머지 글 */
function modeOf(style) {
    const text = String(style ?? '').replace(/\s+/g, ' ').trim();
    for (const [word, mode] of MODE_WORDS) {
        if (text === word) return { mode, note: '' };
        if (text.startsWith(`${word}, `)) return { mode, note: text.slice(word.length + 2).trim() };
    }
    return { mode: 'custom', note: text };
}

/** 그 사람의 이름 칸: 원문 표기들과 한글 표기 */
const label = person => [...new Set([...(person.names || []), person.ko].filter(Boolean))].join(', ');

/**
 * 새 꼴의 사람들 → 옛 꼴의 말투 줄. 말투가 없는 사람은 줄이 없다.
 * @param {{ id: string, names: string[], ko?: string, style?: string, to?: { who: string, style: string }[] }[]} people
 */
export function oldProfiles(people) {
    const byId = new Map(people.map(person => [person.id, person])), out = [];
    const add = (speaker, listener, style) => {
        if (!speaker || !String(style ?? '').trim()) return;
        out.push({ id: JSON.stringify([speaker, listener, false]), speaker, listener, mutual: false, ...modeOf(style) });
    };
    for (const person of people) {
        add(label(person), '', person.style);
        for (const to of person.to || []) if (byId.has(to.who)) add(label(person), label(byId.get(to.who)), to.style);
    }
    return out;
}

/**
 * 지금 말투를 옛 자리에 적는다. 달라진 것이 없으면 아무것도 하지 않는다.
 * @param {object} layers store/layers.js
 * @param {object | null} meta 지금 채팅의 chat_metadata
 * @returns {boolean} 적었으면 true(저장은 layers 가 이 채팅을 저장할 때 같이 된다)
 */
export function writeOld(layers, meta) {
    if (!meta) return false;
    const next = oldProfiles(layers.view().people);
    if (JSON.stringify(next) === JSON.stringify(meta[OLD_STYLE_KEY] ?? [])) return false;
    layers.edit('chat', () => {});   // 새 자리를 먼저 만들고(위 까닭) 이 채팅을 저장할 것으로 표시한다
    meta[OLD_STYLE_KEY] = next;
    return true;
}

/**
 * 사람을 저장하거나 지울 때마다 옛 자리에도 적게 한다.
 * @param {object} layers
 * @param {() => object} context 실리태번 getContext
 */
export function mirrorStyles(layers, context) {
    const meta = () => (context().getCurrentChatId?.() ? context().chatMetadata : null);
    for (const key of ['savePerson', 'removePerson']) {
        const inner = layers[key];
        layers[key] = (...args) => {
            const out = inner(...args);
            try { writeOld(layers, meta()); } catch (error) { console.warn('[번역] 옛 자리에 말투를 같이 적지 못했어요', error); }
            return out;
        };
    }
}
