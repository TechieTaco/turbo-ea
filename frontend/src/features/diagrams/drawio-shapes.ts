/**
 * Helpers for DrawIO card shape insertion and extraction.
 *
 * Insertion uses same-origin access to the DrawIO iframe — we call
 * graph.insertVertex() directly from the parent window, bypassing
 * postMessage entirely.  This is the most reliable approach because
 * it avoids XML merge root-cell conflicts and plugin lifecycle issues.
 */

/** Darken a hex color by a factor (0-1) for stroke color */
function darken(hex: string, factor = 0.25): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const d = (v: number) =>
    Math.round(v * (1 - factor))
      .toString(16)
      .padStart(2, "0");
  return `#${d(r)}${d(g)}${d(b)}`;
}

export interface InsertCardOpts {
  cardId: string;
  cardType: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

/** Shape data needed for direct mxGraph API insertion */
export interface CardCellData {
  cellId: string;
  label: string;
  cardId: string;
  cardType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: string;
}

/**
 * Build the data for inserting a card shape via the mxGraph API.
 */
export function buildCardCellData(opts: InsertCardOpts): CardCellData {
  const { cardId, cardType, name, color, x, y } = opts;
  const stroke = darken(color);
  const cellId = `card-${cardId.slice(0, 8)}-${Date.now()}`;

  const style = [
    "rounded=1",
    "whiteSpace=wrap",
    "html=1",
    `fillColor=${color}`,
    "fontColor=#ffffff",
    `strokeColor=${stroke}`,
    "fontSize=12",
    "fontStyle=1",
    "arcSize=12",
    "shadow=1",
  ].join(";");

  return {
    cellId,
    label: name,
    cardId,
    cardType,
    x,
    y,
    width: 180,
    height: 60,
    style,
  };
}

/**
 * Insert a card shape directly into the DrawIO graph via same-origin
 * iframe access.  Returns true on success, false if the graph isn't ready.
 */
export function insertCardIntoGraph(
  iframe: HTMLIFrameElement,
  data: CardCellData
): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = iframe.contentWindow as any;
    if (!win) return false;

    // Obtain the graph.  After DrawIO init the reference is stored by our
    // bootstrap (see DiagramEditor's init handler) on window.__turboGraph.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graph: any = win.__turboGraph;
    if (!graph) return false;

    const model = graph.getModel();
    const parent = graph.getDefaultParent();

    // Create the user-object in an XML document — NOT the HTML document.
    // Using iframe.contentDocument.createElement("object") produces an
    // HTMLObjectElement which mxGraph's XML codec silently drops during
    // serialization, causing labels and custom attributes to be lost.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const xmlDoc = (win.mxUtils as any).createXmlDocument();
    const obj = xmlDoc.createElement("object");
    obj.setAttribute("label", data.label);
    obj.setAttribute("cardId", data.cardId);
    obj.setAttribute("cardType", data.cardType);

    model.beginUpdate();
    try {
      graph.insertVertex(
        parent,
        data.cellId,
        obj,
        data.x,
        data.y,
        data.width,
        data.height,
        data.style
      );
    } finally {
      model.endUpdate();
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Return the graph-space coordinates of the center of the currently visible
 * portion of the DrawIO canvas.  Useful as a fallback insertion position.
 */
export function getVisibleCenter(iframe: HTMLIFrameElement): { x: number; y: number } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = iframe.contentWindow as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graph: any = win?.__turboGraph;
    if (!graph) return null;

    const container = graph.container as HTMLElement;
    const s = graph.view.scale as number;
    const tr = graph.view.translate as { x: number; y: number };

    const cx = (container.scrollLeft + container.clientWidth / 2) / s - tr.x;
    const cy = (container.scrollTop + container.clientHeight / 2) / s - tr.y;

    return { x: Math.round(cx), y: Math.round(cy) };
  } catch {
    return null;
  }
}

/**
 * Parse diagram XML and return the set of cardId values found.
 * Used client-side for display; the backend does its own authoritative parse.
 */
export function extractCardIds(xml: string): string[] {
  const ids: string[] = [];
  const re = /cardId="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/*  Pending (unsynchronised) cell helpers                              */
/* ------------------------------------------------------------------ */

/** Style for a pending (not-yet-synced) card cell — dashed border */
function buildPendingStyle(color: string): string {
  const stroke = darken(color);
  return [
    "rounded=1", "whiteSpace=wrap", "html=1",
    `fillColor=${color}`, "fontColor=#ffffff",
    `strokeColor=${stroke}`, "fontSize=12",
    "fontStyle=1", "arcSize=12",
    "dashed=1", "dashPattern=5 3",
  ].join(";");
}

/** Style for a synced (normal) card cell */
function buildSyncedStyle(color: string): string {
  const stroke = darken(color);
  return [
    "rounded=1", "whiteSpace=wrap", "html=1",
    `fillColor=${color}`, "fontColor=#ffffff",
    `strokeColor=${stroke}`, "fontSize=12",
    "fontStyle=1", "arcSize=12", "shadow=1",
  ].join(";");
}

/**
 * Insert a pending (not-yet-synced) card cell.
 * Uses a dashed border to distinguish it from synced cells.
 */
export function insertPendingCard(
  iframe: HTMLIFrameElement,
  opts: { tempId: string; type: string; name: string; color: string; x: number; y: number },
): string | null {
  const ctx = getMxGraph(iframe);
  if (!ctx) return null;
  const { win, graph } = ctx;

  const model = graph.getModel();
  const parent = graph.getDefaultParent();
  const cellId = `pfs-${Date.now()}`;

  const xmlDoc = win.mxUtils.createXmlDocument();
  const obj = xmlDoc.createElement("object");
  obj.setAttribute("label", opts.name);
  obj.setAttribute("cardId", opts.tempId);
  obj.setAttribute("cardType", opts.type);
  obj.setAttribute("pending", "1");

  model.beginUpdate();
  try {
    graph.insertVertex(parent, cellId, obj, opts.x, opts.y, 180, 60, buildPendingStyle(opts.color));
  } finally {
    model.endUpdate();
  }
  return cellId;
}

/**
 * After the user draws an edge between two FS cells and picks a relation type,
 * stamp the edge with relation metadata and apply entity-relation style.
 */
export function stampEdgeAsRelation(
  iframe: HTMLIFrameElement,
  edgeCellId: string,
  relationType: string,
  relationLabel: string,
  color: string,
  pending: boolean,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;

  const model = graph.getModel();
  const edge = model.getCell(edgeCellId);
  if (!edge) return false;

  model.beginUpdate();
  try {
    // Replace user object with rich metadata
    const xmlDoc = win.mxUtils.createXmlDocument();
    const obj = xmlDoc.createElement("object");
    obj.setAttribute("label", relationLabel);
    obj.setAttribute("relationType", relationType);
    if (pending) obj.setAttribute("pending", "1");
    model.setValue(edge, obj);

    const dash = pending ? "dashed=1;dashPattern=5 3;" : "";
    const style =
      `edgeStyle=entityRelationEdgeStyle;strokeColor=${color};strokeWidth=1.5;` +
      `endArrow=none;startArrow=none;fontSize=10;fontColor=#666;${dash}`;
    graph.setCellStyles("edgeStyle", "entityRelationEdgeStyle", [edge]);
    model.setStyle(edge, style);
  } finally {
    model.endUpdate();
  }
  return true;
}

/**
 * Mark a pending cell as synced: update its cardId to the real one
 * and switch from dashed to solid style.
 */
export function markCellSynced(
  iframe: HTMLIFrameElement,
  cellId: string,
  realCardId: string,
  color: string,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell) return false;

  model.beginUpdate();
  try {
    const obj = cell.value;
    if (obj?.setAttribute) {
      obj.setAttribute("cardId", realCardId);
      if (obj.removeAttribute) obj.removeAttribute("pending");
    }
    model.setStyle(cell, buildSyncedStyle(color));
  } finally {
    model.endUpdate();
  }
  return true;
}

/**
 * Mark a pending relation edge as synced (remove dashed style).
 * Optionally stamps the edge with the real backend relation id so that
 * canvas deletions can fire a DELETE /relations/{id}.
 */
export function markEdgeSynced(
  iframe: HTMLIFrameElement,
  edgeCellId: string,
  color: string,
  relationId?: string,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;

  const model = graph.getModel();
  const edge = model.getCell(edgeCellId);
  if (!edge) return false;

  model.beginUpdate();
  try {
    const obj = edge.value;
    if (obj?.removeAttribute) obj.removeAttribute("pending");
    if (relationId && obj?.setAttribute) obj.setAttribute("relationId", relationId);
    const style =
      `edgeStyle=entityRelationEdgeStyle;strokeColor=${color};strokeWidth=1.5;` +
      `endArrow=none;startArrow=none;fontSize=10;fontColor=#666;`;
    model.setStyle(edge, style);
  } finally {
    model.endUpdate();
  }
  return true;
}

/**
 * Update a cell's label (e.g. after accepting an inventory name change).
 */
export function updateCellLabel(
  iframe: HTMLIFrameElement,
  cellId: string,
  newLabel: string,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell) return false;

  model.beginUpdate();
  try {
    if (cell.value?.setAttribute) {
      cell.value.setAttribute("label", newLabel);
    }
    graph.refresh(cell);
  } finally {
    model.endUpdate();
  }
  return true;
}

/**
 * Remove a cell (vertex or edge) and its connected edges from the graph.
 */
export function removeDiagramCell(
  iframe: HTMLIFrameElement,
  cellId: string,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;

  const cell = graph.getModel().getCell(cellId);
  if (!cell) return false;

  graph.removeCells([cell], true);
  return true;
}

export interface ScannedPendingFS {
  cellId: string;
  tempId: string;
  type: string;
  name: string;
}

export interface ScannedPendingRel {
  edgeCellId: string;
  relationType: string;
  relationLabel: string;
  sourceCardId: string;
  targetCardId: string;
  sourceName: string;
  targetName: string;
}

export interface ScannedSyncedFS {
  cellId: string;
  cardId: string;
  name: string;
  type: string;
}

/**
 * Scan the graph for pending and synced items.
 */
export function scanDiagramItems(iframe: HTMLIFrameElement): {
  pendingCards: ScannedPendingFS[];
  pendingRels: ScannedPendingRel[];
  syncedFS: ScannedSyncedFS[];
} {
  const pendingCards: ScannedPendingFS[] = [];
  const pendingRels: ScannedPendingRel[] = [];
  const syncedFS: ScannedSyncedFS[] = [];

  const ctx = getMxGraph(iframe);
  if (!ctx) return { pendingCards, pendingRels, syncedFS };
  const { graph } = ctx;

  const cells = graph.getModel().cells || {};
  for (const k of Object.keys(cells)) {
    const cell = cells[k];
    if (!cell?.value?.getAttribute) continue;

    const isPending = cell.value.getAttribute("pending") === "1";
    const fsId = cell.value.getAttribute("cardId");
    const relType = cell.value.getAttribute("relationType");

    if (relType && isPending) {
      // Pending relation edge
      const src = graph.getModel().getTerminal(cell, true);
      const tgt = graph.getModel().getTerminal(cell, false);
      pendingRels.push({
        edgeCellId: cell.id,
        relationType: relType,
        relationLabel: cell.value.getAttribute("label") || relType,
        sourceCardId: src?.value?.getAttribute?.("cardId") || "",
        targetCardId: tgt?.value?.getAttribute?.("cardId") || "",
        sourceName: src?.value?.getAttribute?.("label") || "?",
        targetName: tgt?.value?.getAttribute?.("label") || "?",
      });
    } else if (fsId && isPending) {
      // Pending card vertex
      pendingCards.push({
        cellId: cell.id,
        tempId: fsId,
        type: cell.value.getAttribute("cardType") || "",
        name: cell.value.getAttribute("label") || "",
      });
    } else if (fsId && !isPending && !cell.value.getAttribute("parentGroupCell")) {
      // Synced top-level card vertex
      syncedFS.push({
        cellId: cell.id,
        cardId: fsId,
        name: cell.value.getAttribute("label") || "",
        type: cell.value.getAttribute("cardType") || "",
      });
    }
  }

  return { pendingCards, pendingRels, syncedFS };
}

/** SVG data URI for the "out of sync" resync overlay icon (orange !) */
const RESYNC_OVERLAY = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
    '<circle cx="10" cy="10" r="9" fill="#ff9800" stroke="#e65100" stroke-width="1"/>' +
    '<rect x="9" y="5" width="2" height="7" rx="1" fill="#fff"/>' +
    '<circle cx="10" cy="14.5" r="1.2" fill="#fff"/>' +
    '</svg>',
)}`;

/** SVG data URI for the + overlay icon */
const PLUS_OVERLAY = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
    '<circle cx="10" cy="10" r="9" fill="rgba(255,255,255,0.9)" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>' +
    '<path d="M10 5v10M5 10h10" stroke="rgba(0,0,0,0.55)" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>',
)}`;

/** SVG data URI for the − overlay icon */
const MINUS_OVERLAY = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
    '<circle cx="10" cy="10" r="9" fill="rgba(255,255,255,0.9)" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>' +
    '<path d="M5 10h10" stroke="rgba(0,0,0,0.55)" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>',
)}`;

const CHILD_CARD_W = 160;
const CHILD_CARD_H = 40;
const CHILD_GAP_Y = 10;
const CHILD_GAP_X = 60;
const TYPE_GROUP_GAP = 16;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMxGraph(iframe: HTMLIFrameElement): { win: any; graph: any } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = iframe.contentWindow as any;
    const graph = win?.__turboGraph;
    return graph ? { win, graph } : null;
  } catch {
    return null;
  }
}

export interface ExpandChildData {
  id: string;
  name: string;
  type: string;
  color: string;
  relationType: string;
}

/**
 * Add a +/− overlay icon to a card cell.
 */
export function addExpandOverlay(
  iframe: HTMLIFrameElement,
  cellId: string,
  expanded: boolean,
  onClick: () => void,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;

  const cell = graph.getModel().getCell(cellId);
  if (!cell) return false;

  graph.removeCellOverlays(cell);

  const overlay = new win.mxCellOverlay(
    new win.mxImage(expanded ? MINUS_OVERLAY : PLUS_OVERLAY, 20, 20),
    expanded ? "Collapse" : "Expand related cards",
    win.mxConstants.ALIGN_RIGHT,
    win.mxConstants.ALIGN_MIDDLE,
    new win.mxPoint(0, 0),
  );
  overlay.cursor = "pointer";
  overlay.addListener(win.mxEvent.CLICK, () => onClick());

  graph.addCellOverlay(cell, overlay);
  return true;
}

/**
 * Insert child vertices + edges around a parent card cell.
 * Children are laid out in a column to the right, grouped by type.
 */
export function expandCardGroup(
  iframe: HTMLIFrameElement,
  parentCellId: string,
  children: ExpandChildData[],
): Array<{ cellId: string; cardId: string }> {
  const ctx = getMxGraph(iframe);
  if (!ctx) return [];
  const { win, graph } = ctx;

  const model = graph.getModel();
  const root = graph.getDefaultParent();
  const parentCell = model.getCell(parentCellId);
  if (!parentCell) return [];

  const geo = graph.getCellGeometry(parentCell);
  if (!geo) return [];

  // Compute total height with gaps between type groups
  let totalH = 0;
  for (let i = 0; i < children.length; i++) {
    if (i > 0) {
      totalH += children[i].type !== children[i - 1].type ? TYPE_GROUP_GAP : CHILD_GAP_Y;
    }
    totalH += CHILD_CARD_H;
  }

  const startX = geo.x + geo.width + CHILD_GAP_X;
  const startY = geo.y + geo.height / 2 - totalH / 2;

  const inserted: Array<{ cellId: string; cardId: string }> = [];
  model.beginUpdate();
  try {
    let yOff = 0;
    for (let i = 0; i < children.length; i++) {
      if (i > 0) {
        yOff += children[i].type !== children[i - 1].type ? TYPE_GROUP_GAP : CHILD_GAP_Y;
      }
      const ch = children[i];
      const cid = `fsg-${ch.id.slice(0, 8)}-${Date.now()}-${i}`;
      const stroke = darken(ch.color);
      const style = [
        "rounded=1", "whiteSpace=wrap", "html=1",
        `fillColor=${ch.color}`, "fontColor=#ffffff",
        `strokeColor=${stroke}`, "fontSize=11",
        "fontStyle=1", "arcSize=12",
      ].join(";");

      const xmlDoc = win.mxUtils.createXmlDocument();
      const obj = xmlDoc.createElement("object");
      obj.setAttribute("label", ch.name);
      obj.setAttribute("cardId", ch.id);
      obj.setAttribute("cardType", ch.type);
      obj.setAttribute("parentGroupCell", parentCellId);

      const vertex = graph.insertVertex(
        root, cid, obj, startX, startY + yOff, CHILD_CARD_W, CHILD_CARD_H, style,
      );

      graph.insertEdge(
        root, `fse-${cid}`, "",
        parentCell, vertex,
        `edgeStyle=entityRelationEdgeStyle;strokeColor=${ch.color};strokeWidth=1.5;endArrow=none;startArrow=none`,
      );

      inserted.push({ cellId: cid, cardId: ch.id });
      yOff += CHILD_CARD_H;
    }

    const pv = parentCell.value;
    if (pv?.setAttribute) {
      pv.setAttribute("expanded", "1");
      pv.setAttribute("childCellIds", inserted.map((c) => c.cellId).join(","));
    }
  } finally {
    model.endUpdate();
  }

  return inserted;
}

/**
 * Remove all descendant cells (and their edges) belonging to a parent group.
 * Recurses into children that are themselves expanded, so nested expansions
 * are cleaned up correctly.
 */
export function collapseCardGroup(
  iframe: HTMLIFrameElement,
  parentCellId: string,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;

  const model = graph.getModel();
  const parentCell = model.getCell(parentCellId);
  if (!parentCell) return false;

  const cells = model.cells || {};

  // Build parent→children index so we can walk the tree
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const childrenOf = new Map<string, any[]>();
  for (const k of Object.keys(cells)) {
    const c = cells[k];
    const pgc = c?.value?.getAttribute?.("parentGroupCell");
    if (pgc) {
      if (!childrenOf.has(pgc)) childrenOf.set(pgc, []);
      childrenOf.get(pgc)!.push(c);
    }
  }

  // Collect all descendants recursively
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toRemove: any[] = [];
  const queue = [parentCellId];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    for (const c of childrenOf.get(pid) || []) {
      toRemove.push(c);
      queue.push(c.id);
    }
  }

  if (toRemove.length === 0) return false;

  model.beginUpdate();
  try {
    graph.removeCells(toRemove, true);
    const pv = parentCell.value;
    if (pv?.setAttribute) {
      pv.setAttribute("expanded", "0");
      if (pv.removeAttribute) pv.removeAttribute("childCellIds");
    }
  } finally {
    model.endUpdate();
  }

  return true;
}

/**
 * Scan all cells and add expand/collapse overlays to every card cell
 * (including children from previous expansions).
 */
export function refreshCardOverlays(
  iframe: HTMLIFrameElement,
  onToggle: (cellId: string, cardId: string, currentlyExpanded: boolean) => void,
): void {
  const ctx = getMxGraph(iframe);
  if (!ctx) return;
  const { graph } = ctx;

  const cells = graph.getModel().cells || {};

  // Detect which parent cells actually have children present in the graph
  const parentsWithChildren = new Set<string>();
  for (const k of Object.keys(cells)) {
    const pgc = cells[k]?.value?.getAttribute?.("parentGroupCell");
    if (pgc) parentsWithChildren.add(pgc);
  }

  for (const k of Object.keys(cells)) {
    const cell = cells[k];
    if (!cell?.value?.getAttribute) continue;

    const fsId = cell.value.getAttribute("cardId");
    if (!fsId) continue;

    let expanded = cell.value.getAttribute("expanded") === "1";
    // If marked expanded but children were deleted, treat as collapsed
    if (expanded && !parentsWithChildren.has(cell.id)) expanded = false;

    addExpandOverlay(iframe, cell.id, expanded, () => {
      onToggle(cell.id, fsId, expanded);
    });
  }
}

/**
 * Return the set of cardId values for children currently connected to a
 * parent cell.  A child is "connected" only if its vertex is still present AND
 * it still has at least one edge linking it to the parent.  This catches both
 * vertex deletions (user deleted the child) and edge-only deletions (user
 * deleted the relation line but left the child shape).
 */
export function getGroupChildCardIds(
  iframe: HTMLIFrameElement,
  parentCellId: string,
): Set<string> {
  const ctx = getMxGraph(iframe);
  if (!ctx) return new Set();
  const { graph } = ctx;

  const model = graph.getModel();
  const parentCell = model.getCell(parentCellId);
  if (!parentCell) return new Set();

  const result = new Set<string>();
  const cells = model.cells || {};
  for (const k of Object.keys(cells)) {
    const c = cells[k];
    if (c?.value?.getAttribute?.("parentGroupCell") !== parentCellId) continue;
    const fsId = c.value.getAttribute("cardId");
    if (!fsId) continue;

    // Verify the child still has an edge to the parent
    const edges = graph.getEdgesBetween(parentCell, c, false);
    if (edges && edges.length > 0) {
      result.add(fsId);
    }
  }
  return result;
}

/**
 * Add a resync overlay (orange "!" icon) at the top-left of a card cell.
 * Indicates the cell's expanded children are out of sync with inventory.
 * Must be called AFTER addExpandOverlay (which clears all overlays first).
 */
export function addResyncOverlay(
  iframe: HTMLIFrameElement,
  cellId: string,
  onClick: () => void,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;

  const cell = graph.getModel().getCell(cellId);
  if (!cell) return false;

  const overlay = new win.mxCellOverlay(
    new win.mxImage(RESYNC_OVERLAY, 18, 18),
    "Restore removed relations (click to resync)",
    win.mxConstants.ALIGN_LEFT,
    win.mxConstants.ALIGN_TOP,
    new win.mxPoint(0, 0),
  );
  overlay.cursor = "pointer";
  overlay.addListener(win.mxEvent.CLICK, () => onClick());

  graph.addCellOverlay(cell, overlay);
  return true;
}

/* ------------------------------------------------------------------ */
/*  Cell lifecycle (paste/duplicate dedup + deletion tombstones)       */
/* ------------------------------------------------------------------ */

export interface RemovedCardTombstone {
  kind: "card";
  cellId: string;
  cardId: string;
  cardType: string;
  name: string;
  /** True if the cell was the original (still synced) or a pending one. */
  wasPending: boolean;
}

export interface RemovedRelationTombstone {
  kind: "relation";
  edgeCellId: string;
  relationId: string;
  relationType: string;
  relationLabel: string;
  sourceName: string;
  targetName: string;
}

export type RemovedTombstone = RemovedCardTombstone | RemovedRelationTombstone;

export interface CellLifecycleHandlers {
  onDuplicate: (cellId: string, sharedCardId: string, wasPending: boolean) => void;
  onRemoved: (tombstones: RemovedTombstone[]) => void;
}

/**
 * Hook the graph model so we can:
 *   - detect copy/paste/duplicate adding a cell that reuses an existing
 *     cardId, and call onDuplicate so the parent can either regenerate the
 *     temp id (pending clone) or strip the cardId (synced clone)
 *   - detect cell removals carrying a real cardId / relationId so the parent
 *     can tombstone them for the next sync.
 *
 * Returns a cleanup function that removes the listeners.
 */
export function attachCellLifecycleListeners(
  iframe: HTMLIFrameElement,
  handlers: CellLifecycleHandlers,
): () => void {
  const ctx = getMxGraph(iframe);
  if (!ctx) return () => {};
  const { win, graph } = ctx;
  const model = graph.getModel();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addedListener = (_sender: unknown, evt: any) => {
    const cells = evt.getProperty("cells") || [];
    if (cells.length === 0) return;
    // Build a map cardId -> cellIds across the whole graph so we can decide
    // which freshly-added cells are duplicates.
    const allCells = model.cells || {};
    const cardCells = new Map<string, string[]>();
    for (const k of Object.keys(allCells)) {
      const c = allCells[k];
      const cid = c?.value?.getAttribute?.("cardId");
      if (cid) {
        if (!cardCells.has(cid)) cardCells.set(cid, []);
        cardCells.get(cid)!.push(c.id);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const cell of cells as any[]) {
      const cardId = cell?.value?.getAttribute?.("cardId");
      if (!cardId) continue;
      const peers = cardCells.get(cardId) || [];
      // If another cell already owned this cardId before the paste, this
      // cell is the clone. Compare against the cell that was added — peers
      // includes the freshly-added cell, so duplicates means peers.length > 1.
      if (peers.length > 1 && peers.indexOf(cell.id) > 0) {
        const wasPending = cell.value.getAttribute("pending") === "1";
        handlers.onDuplicate(cell.id, cardId, wasPending);
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const removedListener = (_sender: unknown, evt: any) => {
    const cells = evt.getProperty("cells") || [];
    if (cells.length === 0) return;
    const tombstones: RemovedTombstone[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const cell of cells as any[]) {
      const value = cell?.value;
      if (!value?.getAttribute) continue;
      const relationId = value.getAttribute("relationId");
      const cardId = value.getAttribute("cardId");
      const isPending = value.getAttribute("pending") === "1";
      const isChild = !!value.getAttribute("parentGroupCell");

      if (relationId) {
        tombstones.push({
          kind: "relation",
          edgeCellId: cell.id,
          relationId,
          relationType: value.getAttribute("relationType") || "",
          relationLabel: value.getAttribute("label") || value.getAttribute("relationType") || "",
          sourceName: "",
          targetName: "",
        });
      } else if (cardId && !isPending && !isChild && !cardId.startsWith("pending-")) {
        // Only tombstone top-level synced cards. Expanded children disappear
        // and reappear regularly via collapse/expand — they don't represent
        // a user intent to remove the underlying card.
        tombstones.push({
          kind: "card",
          cellId: cell.id,
          cardId,
          cardType: value.getAttribute("cardType") || "",
          name: value.getAttribute("label") || "",
          wasPending: false,
        });
      }
    }
    if (tombstones.length > 0) handlers.onRemoved(tombstones);
  };

  model.addListener(win.mxEvent.CELLS_ADDED, addedListener);
  model.addListener(win.mxEvent.CELLS_REMOVED, removedListener);

  return () => {
    try {
      model.removeListener(addedListener);
      model.removeListener(removedListener);
    } catch {
      // graph may have been torn down already
    }
  };
}

/**
 * Dedup a duplicate (pasted) card cell.
 *   - If the clone was pending, give it a fresh temp id so users can sync it
 *     as a separate card.
 *   - If the clone was synced, strip the cardId so it becomes an unlinked
 *     shape — the user can then re-link it via the context menu.
 *
 * Returns the new temp id for pending clones, "unlinked" for synced clones,
 * or null on failure.
 */
export function dedupClonedCell(
  iframe: HTMLIFrameElement,
  cellId: string,
  wasPending: boolean,
): { mode: "regenerated"; tempId: string } | { mode: "unlinked" } | null {
  const ctx = getMxGraph(iframe);
  if (!ctx) return null;
  const { graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell?.value?.setAttribute) return null;

  model.beginUpdate();
  try {
    // Children we don't dedupe — they're expansion artifacts.
    if (cell.value.getAttribute("parentGroupCell")) return null;

    if (wasPending) {
      const tempId = `pending-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      cell.value.setAttribute("cardId", tempId);
      return { mode: "regenerated", tempId };
    }

    cell.value.removeAttribute("cardId");
    if (cell.value.removeAttribute) {
      cell.value.removeAttribute("expanded");
      cell.value.removeAttribute("childCellIds");
    }
    // Repaint as an "unlinked" stub: solid grey dashed border.
    model.setStyle(cell, buildUnlinkedStyle());
    graph.removeCellOverlays(cell);
    return { mode: "unlinked" };
  } finally {
    model.endUpdate();
  }
}

/** Visual style for an unlinked (was-synced) stub after copy/paste. */
function buildUnlinkedStyle(): string {
  return [
    "rounded=1",
    "whiteSpace=wrap",
    "html=1",
    "fillColor=#f5f5f5",
    "fontColor=#616161",
    "strokeColor=#9e9e9e",
    "fontSize=12",
    "fontStyle=0",
    "arcSize=12",
    "dashed=1",
    "dashPattern=4 3",
  ].join(";");
}

/* ------------------------------------------------------------------ */
/*  Link / unlink / relink helpers (Phase 2)                           */
/* ------------------------------------------------------------------ */

/**
 * Strip a synced cell's link to its card. The shape stays on the canvas
 * but becomes a plain unlinked stub. Returns the previous cardId so the
 * editor can offer "undo" feedback.
 */
export function unlinkCell(
  iframe: HTMLIFrameElement,
  cellId: string,
): string | null {
  const ctx = getMxGraph(iframe);
  if (!ctx) return null;
  const { graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell?.value?.getAttribute) return null;
  const previousId = cell.value.getAttribute("cardId");
  if (!previousId) return null;

  model.beginUpdate();
  try {
    cell.value.removeAttribute("cardId");
    if (cell.value.removeAttribute) {
      cell.value.removeAttribute("pending");
      cell.value.removeAttribute("expanded");
      cell.value.removeAttribute("childCellIds");
      cell.value.removeAttribute("relationId");
    }
    model.setStyle(cell, buildUnlinkedStyle());
    graph.removeCellOverlays(cell);
  } finally {
    model.endUpdate();
  }
  return previousId;
}

/**
 * Re-link a cell (synced or unlinked) to a different card. Rewrites cardId,
 * cardType, label, and repaints with the target card type's color.
 */
export function relinkCell(
  iframe: HTMLIFrameElement,
  cellId: string,
  opts: { cardId: string; cardType: string; name: string; color: string },
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell?.value?.setAttribute) return false;

  model.beginUpdate();
  try {
    cell.value.setAttribute("cardId", opts.cardId);
    cell.value.setAttribute("cardType", opts.cardType);
    cell.value.setAttribute("label", opts.name);
    if (cell.value.removeAttribute) {
      cell.value.removeAttribute("pending");
      cell.value.removeAttribute("expanded");
      cell.value.removeAttribute("childCellIds");
    }
    model.setStyle(cell, buildSyncedStyle(opts.color));
    graph.refresh(cell);
  } finally {
    model.endUpdate();
  }
  return true;
}

/**
 * Identify the kind of cell under the right-click for the context menu.
 * Returns one of: "synced", "pending", "unlinked", "plain", or null.
 */
export function classifyCell(
  iframe: HTMLIFrameElement,
  cellId: string,
): "synced" | "pending" | "unlinked" | "plain" | null {
  const ctx = getMxGraph(iframe);
  if (!ctx) return null;
  const { graph } = ctx;
  const cell = graph.getModel().getCell(cellId);
  if (!cell) return null;
  // Edges are out of scope for link/unlink classification.
  if (cell.edge) return null;

  const cardId = cell.value?.getAttribute?.("cardId");
  const pending = cell.value?.getAttribute?.("pending") === "1";
  if (cardId && pending) return "pending";
  if (cardId) return "synced";
  if (cell.value?.getAttribute) return "unlinked";
  return "plain";
}

/**
 * Read a cell's label — used when "Convert to Card" pre-fills the create
 * dialog from a plain DrawIO shape's label.
 */
export function getCellLabel(iframe: HTMLIFrameElement, cellId: string): string {
  const ctx = getMxGraph(iframe);
  if (!ctx) return "";
  const cell = ctx.graph.getModel().getCell(cellId);
  if (!cell) return "";
  const v = cell.value;
  if (typeof v === "string") return v;
  return v?.getAttribute?.("label") || "";
}

/**
 * Convert a plain DrawIO shape into a pending card cell. Keeps the cell's
 * geometry, but replaces its user object with a pending card user object
 * and re-styles it with the card-type color (dashed border).
 */
export function convertShapeToPendingCard(
  iframe: HTMLIFrameElement,
  cellId: string,
  opts: { tempId: string; type: string; name: string; color: string },
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell) return false;

  model.beginUpdate();
  try {
    const xmlDoc = win.mxUtils.createXmlDocument();
    const obj = xmlDoc.createElement("object");
    obj.setAttribute("label", opts.name);
    obj.setAttribute("cardId", opts.tempId);
    obj.setAttribute("cardType", opts.type);
    obj.setAttribute("pending", "1");
    model.setValue(cell, obj);
    model.setStyle(cell, buildPendingStyle(opts.color));
    graph.refresh(cell);
  } finally {
    model.endUpdate();
  }
  return true;
}
