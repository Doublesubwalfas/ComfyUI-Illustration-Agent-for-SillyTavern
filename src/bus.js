// Tiny pub/sub so modules never import each other in cycles.
//   'status'  (state: 'idle'|'evaluating'|'generating', detail)
//   'gallery' ()                      gallery records changed
//   'ui'      ()                      a UI-affecting setting changed
const subs = new Map();

export function on(event, fn) {
    if (!subs.has(event)) subs.set(event, new Set());
    subs.get(event).add(fn);
    return () => subs.get(event)?.delete(fn);
}

export function emit(event, ...args) {
    subs.get(event)?.forEach(fn => {
        try { fn(...args); } catch (e) { console.error('[Illustration Agent] listener error', e); }
    });
}
