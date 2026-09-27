import type { TreeNode } from './kruskal';

export const GEOMETRY = { radius: 15, xGap: 44, yGap: 52, margin: 20 };

export interface Placed {
  id: number;
  colour: number;
  x: number;
  y: number;
}

export interface Figure {
  nodes: Placed[];
  edges: Array<{ key: string; from: Placed; to: Placed }>;
  width: number;
  height: number;
}

/**
 * Leaves are spread evenly and every parent is centred over its children, which
 * keeps these small trees readable and, more importantly, keeps siblings visibly
 * side by side: the whole game turns on which vertices are siblings and which
 * are ancestors.
 */
export function layout(tree: TreeNode): Figure {
  const { radius, xGap, yGap, margin } = GEOMETRY;
  const nodes: Placed[] = [];
  const edges: Figure['edges'] = [];
  let nextLeaf = 0;

  const place = (node: TreeNode, depth: number): Placed => {
    const kids = node.children.map((child) => place(child, depth + 1));

    const x = kids.length
      ? (kids[0].x + kids[kids.length - 1].x) / 2
      : (nextLeaf++ * xGap);

    const here: Placed = { id: node.id, colour: node.colour, x, y: depth * yGap };
    nodes.push(here);
    for (const kid of kids) edges.push({ key: `${here.id}-${kid.id}`, from: here, to: kid });
    return here;
  };

  place(tree, 0);

  const left = Math.min(...nodes.map((node) => node.x));
  for (const node of nodes) {
    node.x += margin + radius - left;
    node.y += margin + radius;
  }

  const width = Math.max(...nodes.map((node) => node.x)) + radius + margin;
  const height = Math.max(...nodes.map((node) => node.y)) + radius + margin;
  return { nodes, edges, width, height };
}
