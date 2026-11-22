// 프롬프트 목록 나중에 그리기: 끌기는 누를 때 붙이고, 창이 닫혀 있으면 다시 그리기 · 미리 계산을 창을 열 때로 미룸.
// 실리태번은 채팅을 열 때마다(프롬프트 목록을 다시 그릴 때마다) 목록에 '끌어서 순서 바꾸기'(jQuery UI sortable)를 새로 붙이고,
// 붙일 때 프롬프트 줄마다 위치를 재서 화면 전체 계산을 치름. 프롬프트가 많은 프리셋 · 긴 채팅에서 채팅 하나 열 때 약 0.5초.
// 끌기는 목록을 누를 때만 필요하므로, 다시 그릴 때는 표시만 해 두고 실제로 누르는 순간(mousedown · touchstart, 문서에서 먼저 받음)에 붙임.
// 그 누름이 목록까지 올라가기 전에 붙여서, 처음 누른 그 끌기도 그대로 됨. 이미 붙어 있는 같은 목록이면 다시 붙이지 않음.
// 또 채팅을 열 때마다(답을 받을 때 · 메시지를 고칠 때도) 프롬프트 목록을 다시 그리며 토큰 수를 보이려고 프롬프트를 한 번 다 만들어 봄(미리 계산, 0.3~0.5초).
// 목록 창이 닫혀 있으면 아무도 안 보는 계산이라, 닫혀 있을 땐 '다시 그려야 함'만 적어 두고 창이 열릴 때 한 번 그림. 실제로 답을 보낼 때의 계산은 따로라 그대로.
// 실리태번 프롬프트 관리자(openai.js 의 promptManager)의 makeDraggable · renderDebounced 만 바꾸고, 끄면 원래 것으로 되돌림.
import { promptManager } from '../../../../openai.js';

let api = null, patched = null, onReady = null, dirty = false, panelWatch = null;

function listOf(pm) { return document.getElementById(`${pm.configuration.prefix}prompt_manager_list`); }

function lazyMakeDraggable() {
    const list = listOf(this);
    if (!list) return;
    if (window.jQuery?.(list).sortable('instance')) return;   // 같은 목록에 이미 붙어 있음(끌 때 줄 위치는 sortable 이 그때 다시 잼)
    list.dataset.etkLazySort = '1';
}

// 누르는 순간: 표시해 둔 목록 안이면 원래 함수로 붙임
function onPress(e) {
    if (!patched) return;
    const list = e.target instanceof Element ? e.target.closest('[data-etk-lazy-sort]') : null;
    if (!list || list !== listOf(patched.pm)) return;
    delete list.dataset.etkLazySort;
    try { patched.original.call(patched.pm); } catch (err) { console.warn('[Breeze] 프롬프트 목록 끌기 붙이기', err); }
}

// 목록이 든 창(왼쪽 패널 등 .drawer-content)이 닫혀 있는지. 창 밖에 있거나 못 찾으면 연 것으로 봄(그대로 그림)
function panelOf(pm) { return document.getElementById(`${pm.configuration.prefix}prompt_manager`)?.closest('.drawer-content') || null; }
const isClosed = (panel) => !!panel && !panel.classList.contains('openDrawer') && !panel.classList.contains('pinnedOpen');
function lazyRenderDebounced(...args) {
    const panel = panelOf(this);
    if (isClosed(panel)) { dirty = true; watchPanel(panel); return; }
    return patched.originalRender.apply(this, args);
}
// 창이 열리면(class 에 openDrawer) 미뤄 둔 다시 그리기를 한 번
function watchPanel(panel) {
    if (panelWatch?.panel === panel) return;
    panelWatch?.observer.disconnect();
    const observer = new MutationObserver(() => {
        if (!dirty || !patched || isClosed(panel)) return;
        dirty = false;
        patched.originalRender.call(patched.pm);
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    panelWatch = { panel, observer };
}

function patch() {
    const pm = promptManager;
    if (!pm || typeof pm.makeDraggable !== 'function' || typeof pm.renderDebounced !== 'function') return false;
    if (patched) return true;
    patched = { pm, original: pm.makeDraggable, originalRender: pm.renderDebounced };
    pm.makeDraggable = lazyMakeDraggable;
    pm.renderDebounced = lazyRenderDebounced;
    return true;
}

export function start(a) {
    api = a;
    for (const t of ['mousedown', 'touchstart']) document.addEventListener(t, onPress, { capture: true, passive: true });
    // 프롬프트 관리자는 앱 준비 때 만들어짐 → 아직이면 그때
    if (!patch()) {
        const { eventSource, eventTypes } = a.ctx();
        onReady = () => { onReady = null; if (api) patch(); };
        eventSource.once?.(eventTypes.APP_READY, onReady);
    }
}

export function stop() {
    for (const t of ['mousedown', 'touchstart']) document.removeEventListener(t, onPress, { capture: true });
    if (onReady) { api?.ctx().eventSource.removeListener?.(api.ctx().eventTypes.APP_READY, onReady); onReady = null; }
    if (patched) {
        const { pm, original, originalRender } = patched;
        patched = null;
        if (pm.makeDraggable === lazyMakeDraggable) pm.makeDraggable = original;
        if (pm.renderDebounced === lazyRenderDebounced) pm.renderDebounced = originalRender;
        panelWatch?.observer.disconnect(); panelWatch = null;
        if (dirty) { dirty = false; try { originalRender.call(pm); } catch { /* 다음 신호에서 그림 */ } }
        // 표시만 해 두고 아직 안 붙인 목록이 있으면 지금 붙임(끈 뒤에도 끌 수 있게)
        const list = listOf(pm);
        if (list?.dataset.etkLazySort) { delete list.dataset.etkLazySort; try { original.call(pm); } catch { /* 다음 다시 그리기에서 붙음 */ } }
    }
    api = null;
}
