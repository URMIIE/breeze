// 번역 버튼 넷의 순서(맨 앞 버튼 · 수정 · 번역 지우기 · 설정). 실리태번 · 다른 확장에 기대지 않는 계산만 둔다(브라우저 없이 시험).
// 맨 앞 버튼은 종류가 둘(번역 / 원문 바꾸기)이라 순서에서는 한 덩이('first')로 친다.
//
//   unitOf(key, units)                        종류 이름 → 덩이 이름(번역 버튼이 아니면 '')
//   orderOf(lists, units)                     메시지 버튼 관리의 두 목록(pins 바로 표시, menuOrder ⋯ 메뉴)에서 지금 보이는 덩이 차례
//   reorder(lists, order, units)              → 새 { pins, menuOrder }: 두 목록 안에서 번역 버튼끼리 자리만 바꾼다
//     다른 확장 버튼의 자리, 바로 표시 칸과 ⋯ 메뉴 칸 구분은 그대로. 두 목록 어디에도 없던 덩이는 ⋯ 메뉴 목록 끝에 지금 차례대로 붙인 뒤 바꾼다
//     (목록에 없는 버튼은 목록의 것 뒤에 놓인다: 번역 버튼은 ⋯ 메뉴 맨 앞에 붙어 있어 목록 끝에 붙여도 보이는 자리가 같다)
//   units: { 덩이 이름: [그 덩이의 종류 이름들] } 차례가 기본 차례

export const unitOf = (key, units) => Object.keys(units).find(unit => units[unit].includes(key)) ?? '';

/** 목록 안에서 덩이가 처음 나오는 차례 */
const unitsIn = (list, units) => [...new Set(list.map(key => unitOf(key, units)).filter(Boolean))];

export function orderOf({ pins = [], menuOrder = [] } = {}, units) {
    const listed = [...unitsIn(pins, units), ...unitsIn(menuOrder, units)];
    const seen = [...new Set(listed)];
    return [...seen, ...Object.keys(units).filter(unit => !seen.includes(unit))];
}

/**
 * 한 목록 안에서 번역 덩이들이 차지한 자리를 새 차례로 다시 채운다. 덩이의 자리는 그 덩이가 처음 나온 자리(다른 버튼 몇 개 뒤인가)이고,
 * 덩이 안의 종류들은 그 자리에 붙여 둔다(맨 앞 버튼의 두 종류 사이에 다른 버튼이 끼어 있어도 한 덩이로 움직인다)
 */
function refill(list, order, units) {
    const others = [], seats = [], groups = new Map();
    for (const key of list) {
        const unit = unitOf(key, units);
        if (!unit) { others.push(key); continue; }
        if (!groups.has(unit)) { groups.set(unit, []); seats.push(others.length); }
        groups.get(unit).push(key);
    }
    const placed = order.filter(unit => groups.has(unit));
    const out = [];
    let seat = 0;
    for (let i = 0; i <= others.length; i++) {
        while (seat < seats.length && seats[seat] === i) out.push(...groups.get(placed[seat++]));
        if (i < others.length) out.push(others[i]);
    }
    return out;
}

export function reorder({ pins = [], menuOrder = [] } = {}, order, units) {
    const present = new Set([...unitsIn(pins, units), ...unitsIn(menuOrder, units)]);
    const missing = orderOf({ pins, menuOrder }, units).filter(unit => !present.has(unit)).flatMap(unit => units[unit]);
    return { pins: refill(pins, order, units), menuOrder: refill([...menuOrder, ...missing], order, units) };
}
