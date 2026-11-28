// 번역하는 동안 대상이 그대로인지 지켜본다. 바뀌었으면 그만둔다(받은 답을 엉뚱한 메시지에 붙이지 않게).
//
// 그만두는 때: 그 메시지가 지워짐, 글이 바뀜, 편집 신호가 옴, 보이는 글(display_text)이 바뀜.
// 그만두지 않는 때:
//   - 다른 채팅으로 감. 메시지 번역은 요청을 끊지 않고 끝까지 받는다(watch 의 stay). 그동안 대상은 '다른 채팅에 있음'(away, why 는 'chat')이라
//     붙이지는 못한다: 받은 문단은 번역 기억에 남고, 부르는 쪽이 '그 채팅을 열면 붙일 답'으로 적어 둔다(job/away.js).
//     시작한 채팅으로 돌아오면 같은 자리 · 같은 글 · 같은 스와이프의 새 객체로 옮겨 타 다시 그대로인 것으로 본다.
//     다른 채팅에 있는 동안에는 옮겨 타지 않는다: 갈라 낸 채팅은 같은 자리에 날짜와 글이 같은 메시지가 있다.
//   - 그 메시지를 스와이프로 넘김(새 답을 받는 중이어도). 메시지 번역은 끊지 않는다(watch 의 stay). 붙잡은 스와이프의 원문(swipes[n])이
//     그대로면 '다른 스와이프가 보이는 중'(otherSwipe, why 는 'swipe')이고, 받은 번역은 그 스와이프의 사본에 적는다(job/run.js).
//     그 스와이프로 돌아오면 다시 그대로인 것으로 본다. 편집 신호는 스와이프마다 따로 센다(다른 스와이프를 고친 것은 이 번역과 상관없다).
//   - 같은 채팅을 제자리에서 다시 불러옴(정규식 저장 같은 일로 실리태번이 채팅을 다시 읽음). 채팅 열쇠가 그대로면 세대를 올리지 않고,
//     메시지가 새 객체가 됐으면 같은 자리 · 같은 글 · 같은 스와이프의 새 객체로 옮겨 탄다. 다시 읽는 사이(배열이 비어 있음)는 '아직 모름'.
//   - 그룹 채팅에서 말하는 캐릭터가 바뀜. 실리태번은 그룹에서 답을 만드는 동안만 characterId 를 그 캐릭터로 두므로 그룹은 그것을 보지 않는다.
//   - 그림 확장이 그림 표시만 바꿈(sameText 로 넘겨받는다).
// 실리태번을 직접 부르지 않는다: getContext 를 넘겨받아 브라우저 없이 시험할 수 있다.

/** 채팅 열쇠: 그룹 · (그룹이 아니면) 캐릭터 · 채팅 id */
function chatKey(context) {
    const inGroup = context.groupId !== undefined && context.groupId !== null;
    const chat = context.getCurrentChatId?.() ?? context.chatId ?? null;
    return JSON.stringify([inGroup ? context.groupId : null, inGroup ? null : context.characterId ?? null, chat]);
}

/**
 * 붙잡은 것이 그대로인지 보는 판정. 차례가 '왜 달라졌나'(why)의 차례이고 이름이 그 까닭이다.
 * 제자리 다시 읽기로 생긴 새 객체에 옮겨 탈 때도 같은 판정을 전부 지나야 한다(옮겨 탄 뒤 바로 다른 까닭으로 그만두지 않게).
 */
const STAYS = ['swipe', 'text', 'display'];

function staysOf(was, sameText) {
    return {
        swipe: item => item.swipe_id === was.swipe,
        text: item => item.mes === was.mes || sameText(was.mes, item.mes),
        display: item => item.extra?.display_text === was.shown,
    };
}

/** 같은 메시지로 태어났나: 보낸 시각 · 이름 · 사용자 여부(새 객체로 다시 읽어도 그대로인 것) */
const sameBirth = (item, was) => item.send_date === was.sent && item.name === was.name && item.is_user === was.user;

/** 편집 신호를 메시지 · 스와이프마다 센다 */
function editCounter() {
    const counts = new WeakMap();
    return {
        of: (message, swipe) => counts.get(message)?.get(swipe ?? 0) ?? 0,
        bump(message) {
            if (!message) return;
            const mine = counts.get(message) ?? new Map(), swipe = message.swipe_id ?? 0;
            counts.set(message, mine.set(swipe, (mine.get(swipe) ?? 0) + 1));
        },
    };
}

export function createGuards(getContext) {
    let lastKey = null;
    const edits = editCounter();

    /**
     * 지금 채팅 배열에서 붙잡은 메시지를 찾는다(spot 을 고친다). 같은 객체가 없으면 그 자리의 새 객체가 canTakeOver 를 지날 때 옮겨 탄다.
     * @returns {boolean} 찾았나
     */
    function findAgain(spot, list, canTakeOver) {
        const at = Array.isArray(list) ? list.indexOf(spot.target) : -1;
        if (at >= 0) { spot.index = at; return true; }
        const again = Array.isArray(list) && spot.index >= 0 ? list[spot.index] : null;
        if (!again || !canTakeOver(again)) return false;
        spot.target = again;
        spot.edits = edits.of(again, spot.swipe);
        return true;
    }

    /**
     * 메시지 하나를 붙잡는다. sameText(옛 글, 지금 글): 글이 달라도 같은 글로 칠 때.
     * home: 지금 열려 있지 않은 채팅의 메시지를 붙잡을 때 그 채팅의 열쇠(key())와 그 메시지의 자리
     */
    function capture(message, { sameText = () => false, home = null } = {}) {
        const key = home?.key ?? chatKey(getContext());
        if (lastKey === null) lastKey = chatKey(getContext());
        const was = { mes: message.mes, swipe: message.swipe_id, sent: message.send_date, name: message.name, user: message.is_user, shown: message.extra?.display_text };
        const stays = staysOf(was, sameText);
        const spot = { target: message, swipe: was.swipe, edits: edits.of(message, was.swipe), index: home?.index ?? getContext().chat?.indexOf(message) ?? -1 };
        const here = () => key === chatKey(getContext());
        const canTakeOver = item => sameBirth(item, was) && STAYS.every(name => stays[name](item));
        const found = () => here() && findAgain(spot, getContext().chat, canTakeOver);

        function why() {
            if (!here()) return 'chat';
            if (!found()) return 'gone';
            if (edits.of(spot.target, was.swipe) !== spot.edits) return 'edited';
            return STAYS.find(name => !stays[name](spot.target)) ?? '';
        }
        return {
            valid: () => why() === '',
            why,
            /** 지금 판단해도 되나: 같은 채팅인데 대상이 없고 배열이 그 자리까지 안 찼으면 다시 읽는 중일 수 있다 */
            settled() {
                const { chat } = getContext();
                return !here() || !Array.isArray(chat) || chat.includes(spot.target) || chat.length > spot.index;
            },
            /** 지금 가리키는 메시지 객체(다시 읽은 뒤엔 새 객체) */
            target: () => spot.target,
            index: () => (why() === '' ? spot.index : -1),
            /** 시작할 때의 글(매크로를 풀기 전 mes) */
            source: () => was.mes,
            /** 이 메시지 · 이 스와이프 · 이 글에 대한 번역인가(진행 표시 · 버튼 모양을 번호가 아니라 이것으로 붙인다) */
            holds: other => !!other && (other === spot.target || (found() && other === spot.target)) && stays.swipe(other) && stays.text(other),
            /** 번역을 붙인 뒤: 보이는 글이 바뀐 것은 우리가 한 일이다 */
            acceptShown() { was.shown = spot.target.extra?.display_text; },
            /** 그 메시지의 다른 스와이프가 보이는 중이고, 붙잡은 스와이프의 원문은 그대로인가(받은 번역을 그 스와이프의 사본에 적을 수 있다) */
            otherSwipe: () => why() === 'swipe' && Array.isArray(spot.target.swipes) && stays.text({ mes: spot.target.swipes[was.swipe ?? 0] }),
            /** 시작한 채팅이 지금 열려 있지 않은가 */
            away: () => !here(),
            /** 시작할 때의 자리와 글: 그 채팅을 다시 열었을 때 같은 답인지 견줄 것 */
            note: () => ({ index: spot.index, sent: was.sent ?? null, swipe: was.swipe ?? null, mes: was.mes }),
        };
    }

    return {
        capture,
        /** 지금 채팅의 열쇠(capture 의 home.key 로 넘길 것) */
        key: () => chatKey(getContext()),
        /** 채팅이 바뀐 신호. 열쇠가 그대로면 제자리 다시 읽기다. @returns {boolean} 정말 다른 채팅인가 */
        chatChanged() {
            const now = chatKey(getContext()), changed = lastKey === null || now !== lastKey;
            lastKey = now;
            return changed;
        },
        /** 편집 신호(메시지 번호): 지금 보이는 스와이프의 글이 바뀌었다 */
        messageChanged(id) {
            edits.bump(getContext().chat?.[Number(id)]);
        },
    };
}

const REASONS = {
    chat: '채팅이 바뀌어 번역을 멈췄어요.',
    gone: '메시지가 지워져 번역을 멈췄어요.',
    edited: '글이 바뀌어 번역을 멈췄어요.',
    text: '글이 바뀌어 번역을 멈췄어요.',
    swipe: '스와이프가 바뀌어 번역을 멈췄어요.',
    display: '보이는 글이 바뀌어 번역을 멈췄어요.',
};

/** 그만둔 까닭의 오류 */
export function cancelled(reason) {
    return Object.assign(new Error(REASONS[reason] || '번역을 멈췄어요.'), { cancelled: true, reason });
}

/** 지켜보는 동안 끊지 않고 넘길 까닭인가(stay: 다른 채팅으로 감 · 붙잡은 스와이프가 그대로인 채 다른 스와이프가 보임) */
const staysThrough = (why, guard) => why === 'chat' || (why === 'swipe' && guard.otherSwipe());

/**
 * 번역하는 동안 정해진 간격으로 대상과 연결 설정을 본다. 바뀌면 controller 를 끊는다.
 * @param {ReturnType<ReturnType<typeof createGuards>['capture']>} guard
 * @param {AbortController} controller
 * @param {{ connection?: () => string, every?: number, stay?: boolean }} [o] connection: 연결 설정의 지문(바뀌면 멈춤).
 *   stay: 다른 채팅으로 가거나 그 메시지를 스와이프로 넘겨도 끊지 않는다(메시지 번역). 안 주면 그것도 끊는다(다시 번역)
 * @returns {() => void} 멈추는 함수
 */
export function watch(guard, controller, { connection = () => '', every = 500, stay = false } = {}) {
    const mark = connection();
    const look = () => {
        if (controller.signal.aborted) return;
        if (connection() !== mark) {
            controller.abort(Object.assign(new Error('연결이나 모델이 바뀌어 멈췄어요. 재번역해 주세요.'), { cancelled: true, reason: 'connection' }));
            return;
        }
        const why = guard.settled() ? guard.why() : '';
        if (why && !(stay && staysThrough(why, guard))) controller.abort(cancelled(why));
    };
    const timer = setInterval(look, every);
    return () => clearInterval(timer);
}
