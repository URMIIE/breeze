// 용어(사람이 아닌 낱말: 지명 · 물건 · 호칭 …). 이 답의 원문에 나오는 항목만 고른다. 글만 다룬다.
//
// 항목: { src: 'Guild, Merchant Guild', dst: '길드, 조합' }  쉼표로 여러 표기 · 여러 번역

import { fold, plain, forms, spans } from './find.js';

/**
 * 이 글에 나오는 용어를 고른다: 사람 이름과 용어 표기가 원문에서 나온 자리를 한데 모아, 긴 표기부터 자리를 차지하게 한다.
 * 한 번이라도 자리를 차지한 표기만 싣는다. 그래서 긴 말 안에만 든 짧은 말(Kleinstein 안의 Klein)은 차지할 자리가 없어 저절로 빠지고,
 * 사람 이름과 용어가 같은 자리를 두고 겹치면(같은 길이) 사람이 이긴다.
 * @param {{src: string, dst: string}[]} entries 먼저 온 항목이 이긴다(같은 표기가 겹치면 뒤 것은 뺌)
 * @param {string} text 원문
 * @param {{ skip?: string[] }} [options] skip: 사람 이름 표기(사람 줄로 들어가므로 용어로 싣지 않고, 자리를 먼저 차지한다)
 * @returns {{ lines: string[], choice: boolean, found: { forms: string[], targets: string[] }[] }} found: 실은 항목(지켜졌는지 볼 때 쓴다)
 */
export function pick(entries, text, { skip = [] } = {}) {
    const hay = plain(text), taken = new Set(skip.map(fold)), hits = [], places = [];
    for (const name of skip) for (const [a, b] of spans(hay, name, { strict: true })) places.push({ a, b, who: -1 });
    for (const entry of entries || []) {
        if (!entry?.src || !entry?.dst) continue;
        const sources = forms(entry.src);
        if (sources.some(s => taken.has(fold(s)))) continue;
        for (const s of sources) taken.add(fold(s));
        const at = hits.push({ sources, targets: forms(entry.dst), claimed: new Set() }) - 1;
        for (const form of sources) for (const [a, b] of spans(hay, form)) places.push({ a, b, who: at, form });
    }
    // 긴 자리부터, 같은 길이면 사람 먼저, 그다음 항목 차례
    places.sort((x, y) => (y.b - y.a) - (x.b - x.a) || (x.who < 0 ? -1 : y.who < 0 ? 1 : x.who - y.who));
    const used = [];
    for (const p of places) {
        if (used.some(([a, b]) => p.a < b && a < p.b)) continue;
        used.push([p.a, p.b]);
        if (p.who >= 0) hits[p.who].claimed.add(p.form);
    }
    const found = hits.filter(h => h.claimed.size).map(h => ({ forms: h.sources.filter(f => h.claimed.has(f)), targets: h.targets }));
    return { lines: found.map(h => `${h.forms.join(' / ')} = ${h.targets.join(' / ')}`), choice: found.some(h => h.targets.length > 1), found };
}

/** 번역 문단에 정한 한국어 가운데 하나가 들어 있나(뒤에 조사가 붙어도 된다: 글자 그대로 찾는다). 태그 속성 · 빈칸 차이는 보지 않는다 */
export function kept(translation, targets) {
    const hay = String(translation ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, '');
    return targets.some(t => { const k = String(t).replace(/\s+/g, ''); return k && hay.includes(k); });
}

// 지시는 프롬프트와 상관없이 늘 붙는다(프롬프트에 기대어 줄이지 않는다). 용어 줄이 없으면 블록째 없다
export function block({ lines, choice }) {
    if (!lines.length) return '';
    return `[Terms]\n${lines.join('\n')}\nUse the Korean after "=" every time the term appears, so one thing keeps one name.${choice ? ' Where several are given with " / ", pick one that fits.' : ''}`;
}
