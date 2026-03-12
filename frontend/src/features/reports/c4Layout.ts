/**
 * C4-notation layout engine for the Dependency Report.
 *
 * Converts GNode / GEdge data into React Flow nodes and edges,
 * using dagre for automatic graph layout. Nodes are grouped by
 * architectural-layer category using React Flow group nodes.
 */

import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { CardType } from "@/types";

/* ------------------------------------------------------------------ */
/*  Input types (same as DependencyReport)                             */
/* ------------------------------------------------------------------ */

export interface GNode {
  id: string;
  name: string;
  type: string;
  lifecycle?: Record<string, string>;
  attributes?: Record<string, unknown>;
  parent_id?: string | null;
  path?: string[];
}

export interface GEdge {
  source: string;
  target: string;
  type: string;
  label?: string;
  reverse_label?: string;
  description?: string;
}

/* ------------------------------------------------------------------ */
/*  Custom node data                                                   */
/* ------------------------------------------------------------------ */

export interface C4NodeData {
  name: string;
  typeKey: string;
  typeLabel: string;
  typeColor: string;
  category: string;
  [key: string]: unknown;
}

export interface C4GroupData {
  label: string;
  color: string;
  [key: string]: unknown;
}

export interface C4EdgeData {
  relLabel: string;
  description?: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const C4_NODE_W = 200;
export const C4_NODE_H = 72;

const CATEGORY_ORDER = [
  "Strategy & Transformation",
  "Business Architecture",
  "Application & Data",
  "Technical Architecture",
];

const CATEGORY_COLORS: Record<string, string> = {
  "Strategy & Transformation": "#33cc58",
  "Business Architecture": "#2889ff",
  "Application & Data": "#0f7eb5",
  "Technical Architecture": "#d29270",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function typeColor(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.color || "#999";
}

function typeLabel(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.label || key;
}

function typeCategory(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.category || "Other";
}

/* ------------------------------------------------------------------ */
/*  Build React Flow nodes + edges with dagre layout                   */
/* ------------------------------------------------------------------ */

export function buildC4Flow(
  gNodes: GNode[],
  gEdges: GEdge[],
  types: CardType[],
): { nodes: Node[]; edges: Edge[] } {
  if (gNodes.length === 0) return { nodes: [], edges: [] };

  // Group nodes by category
  const groups = new Map<string, GNode[]>();
  for (const n of gNodes) {
    const cat = typeCategory(n.type, types);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(n);
  }

  const orderedCats = [
    ...CATEGORY_ORDER.filter((c) => groups.has(c)),
    ...[...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  // Build dagre graph for layout
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 40, marginx: 30, marginy: 30 });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes
  const nodeIdSet = new Set<string>();
  for (const n of gNodes) {
    g.setNode(n.id, { width: C4_NODE_W, height: C4_NODE_H });
    nodeIdSet.add(n.id);
  }

  // Add edges (only between existing nodes)
  for (const e of gEdges) {
    if (nodeIdSet.has(e.source) && nodeIdSet.has(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  // Run dagre layout
  dagre.layout(g);

  // Build React Flow nodes from dagre positions
  const rfNodes: Node[] = [];

  // Gather positioned nodes grouped by category for boundary computation
  const categoryNodes = new Map<string, { id: string; x: number; y: number }[]>();

  for (const n of gNodes) {
    const pos = g.node(n.id);
    if (!pos) continue;
    const cat = typeCategory(n.type, types);
    if (!categoryNodes.has(cat)) categoryNodes.set(cat, []);
    categoryNodes.get(cat)!.push({
      id: n.id,
      x: pos.x - C4_NODE_W / 2,
      y: pos.y - C4_NODE_H / 2,
    });
  }

  // Create group (boundary) nodes for each category
  const PAD = 30;
  const LABEL_H = 36;

  for (const cat of orderedCats) {
    const catNodes = categoryNodes.get(cat);
    if (!catNodes || catNodes.length === 0) continue;

    const minX = Math.min(...catNodes.map((n) => n.x));
    const minY = Math.min(...catNodes.map((n) => n.y));
    const maxX = Math.max(...catNodes.map((n) => n.x + C4_NODE_W));
    const maxY = Math.max(...catNodes.map((n) => n.y + C4_NODE_H));

    const groupId = `group:${cat}`;
    const gx = minX - PAD;
    const gy = minY - PAD - LABEL_H;
    const gw = maxX - minX + 2 * PAD;
    const gh = maxY - minY + 2 * PAD + LABEL_H;

    rfNodes.push({
      id: groupId,
      type: "c4Group",
      position: { x: gx, y: gy },
      data: {
        label: cat,
        color: CATEGORY_COLORS[cat] || "#999",
      } satisfies C4GroupData,
      style: { width: gw, height: gh },
      selectable: false,
      draggable: false,
    });

    // Add child nodes relative to the group
    for (const cn of catNodes) {
      const nd = gNodes.find((n) => n.id === cn.id)!;
      rfNodes.push({
        id: nd.id,
        type: "c4Node",
        position: { x: cn.x - gx, y: cn.y - gy },
        parentId: groupId,
        extent: "parent" as const,
        data: {
          name: nd.name,
          typeKey: nd.type,
          typeLabel: typeLabel(nd.type, types),
          typeColor: typeColor(nd.type, types),
          category: cat,
        } satisfies C4NodeData,
        style: { width: C4_NODE_W, height: C4_NODE_H },
        draggable: false,
      });
    }
  }

  // Build React Flow edges
  const rfEdges: Edge[] = gEdges
    .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
    .map((e, i) => ({
      id: `c4e-${i}`,
      source: e.source,
      target: e.target,
      type: "c4Edge",
      label: e.label || e.type,
      data: {
        relLabel: e.label || e.type,
        description: e.description,
      } satisfies C4EdgeData,
      animated: false,
      markerEnd: { type: "arrowclosed" as const, color: "#888" },
    }));

  return { nodes: rfNodes, edges: rfEdges };
}
