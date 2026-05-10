# Memoisation conventions

Memoise any renderer component whose work is **expensive AND whose
props are stable across re-renders**. The chat transcript dominates
INZONE's render cost — Pane re-renders on every event from every
agent, and without memoisation every re-render does O(n) work in
transcript length.

## When to memo

| Reach for `React.memo` when… | Skip it when… |
|---|---|
| The component renders inside a list that grows over time (transcript items, sidebar rows) | The component renders once at app root and rarely re-renders anyway |
| The render involves parsing, layout-heavy DOM, or third-party libraries (`react-markdown`, syntax highlighters, complex SVG) | The render is a handful of `<div>`s |
| Props are referentially stable from the Zustand store or from immutable data | Props are recomputed every parent render (functions, fresh objects in JSX) |

## Default vs custom comparator

`React.memo(Component)` uses shallow prop equality (`Object.is` on
each prop). That works when all props are either primitives or
stable references. It **fails** when a parent rebuilds a synthesised
wrapper object on every render — the wrapper's identity changes
even though its meaningful contents didn't.

INZONE's `MessageView` hit exactly that trap. Most chat items
(`user`, `assistant_text`, `tool_use`, `tool_result`) come straight
from the store with stable refs, but `tool_block` items are built
fresh by `buildViewItems()` on every Pane render. Default memo
would invalidate every tool block on every re-render. Solution: a
custom comparator that checks the underlying store refs:

```ts
function areMessagePropsEqual(prev: Props, next: Props): boolean {
  if (prev.paneId !== next.paneId) return false;
  if (prev.item === next.item) return true;            // stable store refs
  if (prev.item.kind !== next.item.kind) return false;
  if (prev.item.id !== next.item.id) return false;
  if (prev.item.kind === 'tool_block') {
    // tool_block is a synthesised wrapper — compare what's inside.
    return (
      prev.item.name === next.item.name &&
      prev.item.input === next.item.input &&
      prev.item.result?.content === next.item.result?.content &&
      prev.item.result?.isError === next.item.result?.isError
    );
  }
  return false;
}

export const MessageView = memo(MessageViewImpl, areMessagePropsEqual);
```

The pattern: if `===` works for the prop, default compare is fine;
if the prop is a synthesised wrapper, write a comparator that
checks the **fields whose values come from the store** rather than
the wrapper identity itself.

## Things that defeat memo

- **Inline lambdas in JSX.** `<Foo onClick={() => x()} />` creates a
  new function every render. If the child memoes on `onClick`, it
  re-renders every time the parent renders. Wrap with `useCallback`
  or accept the cost.
- **Inline object props.** Same problem: `<Foo style={{ ... }} />`
  creates a new object every render.
- **`Array.prototype.find` in a selector returning a non-primitive.**
  Each call returns a reference; if the underlying array changes
  ref, the find returns a new ref. Either use a stable index or
  memoise the lookup in a `useMemo` inside the component.

## When to memoise the store selector vs the component

For functions or stable-by-identity store slices, just call
`useStore((s) => s.something)` — Zustand's `Object.is` check
handles it. For derived shapes (object literals composed of multiple
slices), use `useShallow` from `zustand/react/shallow`:

```ts
import { useShallow } from 'zustand/react/shallow';
const { setActivePane, closePane } = useStore(
  useShallow((s) => ({ setActivePane: s.setActivePane, closePane: s.closePane })),
);
```

This subscribes once but compares the result object shallowly so
two consecutive renders returning `{ setActivePane, closePane }`
with the same refs don't trigger a re-render.

## Sources

- [src/renderer/src/components/Message.tsx](../../../src/renderer/src/components/Message.tsx) — the canonical custom comparator example
- [src/renderer/src/components/Markdown.tsx](../../../src/renderer/src/components/Markdown.tsx) — default memo on a single-string prop
- [src/renderer/src/components/Pane.tsx](../../../src/renderer/src/components/Pane.tsx) — `useShallow` for bundled action getters
- Wiki: [[architecture]] (state model), [[gotchas]], [[perf-measurement]]
