# @designroom/diagram

An architecture-diagram component for React: boxes in draw.io / cloud-architecture shapes, arrows routed at right angles **around** other boxes, labels, and in-place renaming.

It knows boxes, arrows and zones, and nothing about DesignRoom. The app maps its own concepts onto it (e.g. "a database" → `shape: 'cylinder'`). Why it exists: [ADR-004](../../docs/decisions.md).

```tsx
import { Diagram, DiagramPanel, useDiagramViewport } from '@designroom/diagram';

<Diagram
  nodes={[
    { id: 'api', label: 'Orders API', position: { x: 0, y: 0 }, shape: 'rectangle' },
    { id: 'db', label: 'Postgres', position: { x: 300, y: 0 }, shape: 'cylinder', color: 'green' },
  ]}
  edges={[{ id: 'e1', source: 'api', target: 'db', label: 'SQL' }]}
  onConnect={(source, target) => …}
  onNodeMove={(id, position) => …}
  onDelete={(nodeIds, edgeIds) => …}
/>
```

## Controlled

The diagram draws what you pass and **tells** you what the user did; it never changes its own content. Your state (a store, Yjs…) stays the single source of truth. The canvas keeps only what it alone knows: selection, measured sizes, and a node's position mid-drag.

| Prop | |
|---|---|
| `nodes`, `edges` | What to draw (`DiagramNode`, `DiagramEdge`). Keep them stable between renders (e.g. `useMemo`). |
| `canConnect(source, target)` | Live check while dragging a new arrow. |
| `onConnect`, `onNodeMove`, `onDelete` | User actions. `onNodeMove` fires once, when the drag ends. `onDelete` lists a deleted node's edges too. |
| `editingNodeId`, `onEditStart`, `onLabelCommit`, `onEditEnd` | In-place renaming: double-click or Enter → `onEditStart`; you set `editingNodeId`. |
| `router` | Default: libavoid, loaded on first use. `null`: simple right-angle arrows. Or your own `DiagramRouter`. |
| `children` | Panels over the diagram: `<DiagramPanel position="top-left">`. Inside, `useDiagramViewport().center()` gives the point under the middle of the view. |

Nodes: `shape` (one of `SHAPES`), `color` (any CSS colour), `icon` (a React node), `ghost` (a proposal: faded, read-only). Edges: `label`, `dashed`, `ghost`.

## Theming

`<Diagram>` brings its own stylesheet. Set these CSS variables to match your app: `--dr-diagram-accent`, `--dr-diagram-edge`, `--dr-diagram-node`, `--dr-diagram-text`, `--dr-diagram-muted`, `--dr-diagram-focus`, `--dr-diagram-surface`.

## Accessibility

Nodes are focusable groups named after their label (ghosts: "Proposed: …"). Edges are named "From A to B". Delete/Backspace removes the selection, and Enter renames the focused node. Drawing a new arrow is mouse-only for now.

## Under the hood

- [React Flow](https://reactflow.dev) (MIT) renders and handles interaction.
- [libavoid-js](https://github.com/Aksem/libavoid-js) routes the arrows. It's a WebAssembly build of libavoid from the Adaptagrams project, **LGPL-2.1-or-later**. It's loaded unmodified, as a separate file, on first use.
- Only `src/flow/toReactFlow.ts` and the components know React Flow, and only `src/router/avoid.ts` knows libavoid, so either can be replaced without changing this API.

## Tests

`pnpm --filter @designroom/diagram test`:
- component behaviour in jsdom
- routing quality in plain Node, with the real wasm (`router/avoid.test.ts`: right angles only, no arrow crosses another box)
