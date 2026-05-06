import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { PaneNode } from '@shared/types';
import { useStore } from '../store';
import { Pane } from './Pane';

export function PaneTree() {
  const tree = useStore((s) => s.tree);
  return <NodeView node={tree} path={[]} />;
}

interface NodeViewProps {
  node: PaneNode;
  path: number[];
}

function NodeView({ node, path }: NodeViewProps) {
  const updateSizes = useStore((s) => s.updateSizes);
  if (node.kind === 'leaf') {
    return <Pane id={node.id} />;
  }
  const direction = node.direction;
  const sizes = node.sizes ?? node.children.map(() => 100 / node.children.length);
  return (
    <PanelGroup
      direction={direction}
      onLayout={(s) => updateSizes(path, s)}
      autoSaveId={undefined}
    >
      {node.children.map((child, i) => (
        <ChildSlot
          key={getKey(child)}
          child={child}
          i={i}
          total={node.children.length}
          defaultSize={sizes[i] ?? 100 / node.children.length}
          path={[...path, i]}
        />
      ))}
    </PanelGroup>
  );
}

function ChildSlot({
  child,
  i,
  total,
  defaultSize,
  path,
}: {
  child: PaneNode;
  i: number;
  total: number;
  defaultSize: number;
  path: number[];
}) {
  return (
    <>
      {/* `minSize` is a percentage — the absolute pixel floor for
          splits is enforced in store.splitPane via DOM measurement.
          20% here just keeps manual drag-resize from collapsing a
          pane below half its sibling's space. */}
      <Panel defaultSize={defaultSize} minSize={20} id={getKey(child)} order={i}>
        <NodeView node={child} path={path} />
      </Panel>
      {i < total - 1 && <PanelResizeHandle className="resize-handle" />}
    </>
  );
}

function getKey(node: PaneNode): string {
  if (node.kind === 'leaf') return `leaf:${node.id}`;
  // Stable-ish key for splits; children's ids combined.
  const ids = collect(node);
  return `split:${ids.join('_')}`;
}

function collect(n: PaneNode, out: string[] = []): string[] {
  if (n.kind === 'leaf') out.push(n.id);
  else for (const c of n.children) collect(c, out);
  return out;
}
