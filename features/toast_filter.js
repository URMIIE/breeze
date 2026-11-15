// 자꾸 뜨는 알림 숨기기.
// 알림이 뜰 때마다 최근 것 60개까지 기억해 두었다가(메모리에만 — 새로고침하면 비워짐), 설정 창에서 ‘최근에 뜬 알림’ 목록으로 보여 준다.
// 거기서 숨기기를 누르면 그 알림의 제목(없으면 내용 앞부분)을 차단 글귀로 적어 두고, 제목이나 내용에 그 글귀가 든 알림은 띄우지 않는다.
// 실리태번이 화면 언어로 번역해 띄우는 알림도 걸리게, 차단 글귀의 번역문도 같이 견준다.
const KINDS = ['info', 'success', 'warning', 'error'];
const KEEP = 60;
let originals = null, mine = null, active = false, api = null, recent = [], redraw = null;

// 알림 글을 한 줄로: 줄마다 · 칸마다 나뉜 글 사이에 띄어쓰기를 넣고(안 넣으면 글이 붙어 버림), 누르는 글(되돌리기 같은 밑줄 · 링크 · 버튼)은 뺌
const plain = (v) => {
    const d = document.createElement('div');
    d.innerHTML = String(v ?? '');
    d.querySelectorAll('u, a, button').forEach(el => el.remove());
    const parts = [];
    const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) parts.push(w.currentNode.nodeValue);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
};
const phrases = () => (api.options().phrases ??= []);
// 실리태번은 알림을 영어 원문으로 받아 화면 언어로 바꿔 띄워서, 적어 둔 글귀가 영어일 수 있음 — 목록에는 화면 언어로 보여 줌
const inUiLang = (text) => { try { const tr = SillyTavern.getContext().t([text]); return tr && tr !== text ? tr : text; } catch { return text; } };

// 목록에 보일 첫 줄: 줄바꿈 · 칸이 나뉜 곳에서 끊어 맨 앞 줄만(여러 줄 알림의 오류 내용 · 안내가 한 줄로 길게 이어졌음). 숨기는 기준은 그대로 전체 글
const firstLine = (v) => {
    const d = document.createElement('div');
    d.innerHTML = String(v ?? '');
    d.querySelectorAll('u, a, button').forEach(el => el.remove());
    d.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
    d.querySelectorAll('div, p, li, small').forEach(el => el.append('\n'));
    const parts = [];
    const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) parts.push(w.currentNode.nodeValue);
    return parts.join(' ').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
};

// 숨길 글귀: 제목이 있으면 ‘제목 + 내용 첫 줄’ 두 조각(줄바꿈으로 이음) — 제목만 적으면 제목이 같은 다른 알림(다른 오류 내용)까지 숨었음
const phraseOf = (title, line, message = '') => (title ? `${title}\n${String(line || '').slice(0, 60)}`.trim() : String(message).slice(0, 40));
function blocked(title, message) {
    const text = `${title}\n${message}`;
    const t = SillyTavern.getContext().t;
    const has = (part) => { if (text.includes(part)) return true; try { const tr = t([part]); return !!tr && tr !== part && text.includes(tr); } catch { return false; } };
    return phrases().some(p => { const parts = p.split('\n').map(x => x.trim()).filter(Boolean); return parts.length > 0 && parts.every(has); });
}
const shownPhrase = (p) => p.split('\n').map(x => x.trim()).filter(Boolean).map(inUiLang).join(': ');

function remember(kind, title, message, line = message) {
    const key = `${title}\n${message}`.slice(0, 120);
    const hit = recent.find(r => r.key === key);
    if (hit) { hit.count++; hit.at = Date.now(); } else recent.unshift({ key, kind, title, message, line, count: 1, at: Date.now() });
    recent.sort((a, b) => b.at - a.at);
    recent.length = Math.min(recent.length, KEEP);
    redraw?.();
}

export function start(a) {
    api = a;
    active = true;
    if (originals || !window.toastr) return;   // 끌 때 못 빠져 남아 있던 것은 다시 켜기만
    originals = {}; mine = {};
    for (const kind of KINDS) {
        const orig = originals[kind] = toastr[kind].bind(toastr);
        toastr[kind] = mine[kind] = (message, title, options) => {
            if (!active) return orig(message, title, options);   // 꺼진 채 남아 있을 때는 그냥 지나가게
            const tt = plain(title), mm = plain(message);
            // 숨긴 알림도 빈 알림 묶음을 돌려줌 — 아무것도 안 돌려주면 그 알림을 지우려고 부르는 toastr.clear(알림)이 toastr.clear() 가 되어 떠 있는 알림을 전부 지웠음
            if (blocked(tt, mm)) return $();
            remember(kind, tt, mm, firstLine(message));
            const $t = orig(message, title, options);
            addHideButton($t, tt, mm, firstLine(message));
            return $t;
        };
    }
}

// 알림창 오른쪽 아래 작은 ‘숨기기’ — 설정 창을 열어 그 알림이 다시 뜨길 기다리지 않고, 뜬 그 자리에서 다음부터 안 뜨게
function addHideButton($t, tt, mm, line) {
    const el = $t?.[0];
    if (!el || el.querySelector('.etk-toast-hide') || api.options().toastButton === false) return;   // 숨길 알림이 더 없으면 설정에서 버튼을 끌 수 있음
    const phrase = phraseOf(tt, plain(line), mm);
    if (!phrase) return;
    const btn = document.createElement('div');
    btn.className = 'etk-toast-hide fa-solid fa-eye-slash';
    btn.title = '이 알림 다음부터 안 띄우기';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!phrases().includes(phrase)) phrases().push(phrase);
        api.save(); redraw?.();
        toastr.clear($t);
    });
    el.append(btn);
}

// 우리 뒤에 다른 확장이 알림 띄우기를 또 감쌌으면 우리 것만 빼낼 수 없음: 무조건 원래 것으로 되돌리면 그 확장이 감싼 것까지 지워짐.
// 그럴 땐 그대로 두고 그냥 지나가게만 함
export function stop() {
    active = false;
    redraw = null;
    if (!originals) return;
    let stuck = false;
    for (const kind of KINDS) { if (toastr[kind] === mine[kind]) toastr[kind] = originals[kind]; else stuck = true; }
    if (stuck) return;   // 남아 있어도 그냥 지나가게만 하므로 꺼진 것과 같음
    originals = null; mine = null;
}

export function options(box, a) {
    api ??= a;
    const render = () => {
        if (!box.isConnected) { redraw = null; return; }
        box.innerHTML = '<label class="checkbox_label"><input type="checkbox" class="etk-toast-btn-on"><span>알림에 숨기기 버튼 띄우기</span></label><div class="etk-sub">최근에 뜬 알림</div><small>알림 오른쪽 아래 눈 모양이나 여기서 ‘숨기기’를 누르면 다음부터 안 떠요.</small><div class="etk-toast-recent"></div><div class="etk-sub">숨긴 알림</div><div class="etk-toast-hidden"></div>';
        const rec = box.querySelector('.etk-toast-recent');
        const shown = recent.filter(r => !blocked(r.title, r.message));
        if (!shown.length) rec.innerHTML = '<div class="etk-empty-line">아직 없어요. 알림이 뜬 뒤 다시 열면 보여요.</div>';
        for (const r of shown) {
            const row = document.createElement('div');
            row.className = 'etk-flex etk-toast-row';
            row.innerHTML = '<span></span><div class="menu_button"><i class="fa-solid fa-eye-slash"></i> 숨기기</div>';
            const name = [r.title, r.line ?? r.message].filter(Boolean).map(inUiLang).join(': ');
            const span = row.querySelector('span');
            span.textContent = name + (r.count > 1 ? ` (${r.count}번)` : r.count === 0 ? ' (방금 다시 보이게 함)' : '');
            span.title = [r.title, r.message].filter(Boolean).join('\n');   // 마우스를 올리면 알림 글 전체
            row.querySelector('.menu_button').addEventListener('click', () => { const p = phraseOf(r.title, r.line ?? r.message, r.message); if (!phrases().includes(p)) phrases().push(p); a.save(); render(); });
            rec.append(row);
        }
        const onBox = box.querySelector('.etk-toast-btn-on');
        onBox.checked = api.options().toastButton !== false;
        onBox.addEventListener('change', () => { api.options().toastButton = onBox.checked; a.save(); });
        const hid = box.querySelector('.etk-toast-hidden');
        if (!phrases().length) hid.innerHTML = '<div class="etk-empty-line">아직 없어요.</div>';
        phrases().forEach((p, i) => {
            const row = document.createElement('div');
            row.className = 'etk-flex etk-toast-row';
            row.innerHTML = '<span></span><div class="menu_button"><i class="fa-solid fa-eye"></i> 다시 보이기</div>';
            row.querySelector('span').textContent = shownPhrase(p);
            row.querySelector('.menu_button').addEventListener('click', () => {
                phrases().splice(i, 1); a.save();
                // 다시 보이게 한 알림은 위 ‘최근에 뜬 알림’에 바로 올려 둠 — 마음이 바뀌면 그 알림이 다시 뜰 때까지 기다리지 않고 바로 숨길 수 있게
                if (!recent.some(r => phraseOf(r.title, r.line ?? r.message, r.message) === p)) { const [title, line = ''] = p.split('\n'); recent.unshift({ key: `${p}\n`, kind: 'info', title: line ? title : '', message: line || title, line: line || title, count: 0, at: Date.now() }); }
                render();
            });
            hid.append(row);
        });
    };
    redraw = render;
    render();
}
