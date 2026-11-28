// 번역기와 다른 기능이 서로를 import 하지 않고 주고받는 통로의 이름표.
//
// 통로로 주고받는 까닭: 내는 쪽이 아직 안 켜졌거나 못 켜져도 쓰는 쪽은 돌아야 한다. 그래서 내는 쪽이 값을 올려 두고,
// 쓰는 쪽은 있으면 쓴다(없으면 undefined).
// 값은 globalThis[Symbol.for('llmt.이름')] 에 있다. 번역기 밖의 기능도 같은 열쇠로 읽으므로 이름을 바꾸면 그쪽이 끊긴다.
//
//   내는 쪽:  globalThis[gate('screen-work')] = { wait }
//   쓰는 쪽:  globalThis[gate('screen-work')]?.wait(메시지 번호)

/** 통로 이름 → 하는 일 (내는 곳) */
export const GATES = Object.freeze({
    'screen-work': '상태창 번역까지 끝났는지 기다리는 것 (api.js)',
    'edit-here': '이 문단 고치기 창 열기 (문단 눌러 고치기가 읽는다)',
});

/** 통로의 열쇠. 목록에 없는 이름이면 오류(오타로 아무도 안 읽는 통로가 생기지 않게) */
export function gate(name) {
    if (!Object.hasOwn(GATES, name)) throw new Error(`없는 통로예요: ${name}`);
    return Symbol.for(`llmt.${name}`);
}
