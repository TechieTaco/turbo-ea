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

/** SVG data URI for the chevron overlay (replaces +/− with a richer menu) */
const CHEVRON_OVERLAY = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
    '<circle cx="10" cy="10" r="9" fill="rgba(255,255,255,0.95)" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>' +
    '<path d="M6 8l4 4 4-4" stroke="rgba(0,0,0,0.65)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
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
  /** Backend relation id, when known. Stamped onto the connecting edge so
   *  canvas deletions can fire `DELETE /relations/{id}`. */
  relationId?: string;
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
/** Edge metadata threaded back from expansion helpers so the editor can
 *  populate its cellId → relation-meta side-table. */
export interface ExpandedEdgeInfo {
  cellId: string;
  cardId: string;
  edgeCellId: string;
  relationId?: string;
  relationType?: string;
  relationLabel?: string;
}

export function expandCardGroup(
  iframe: HTMLIFrameElement,
  parentCellId: string,
  children: ExpandChildData[],
): ExpandedEdgeInfo[] {
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

  const inserted: ExpandedEdgeInfo[] = [];
  model.beginUpdate();
  try {
    let yOff = 0;
    for (let i = 0; i < children.length; i++) {
      if (i > 0) {
        yOff += children[i].type !== children[i - 1].type ? TYPE_GROUP_GAP : CHILD_GAP_Y;
      }
      const ch = children[i];
      const cid = `fsg-${ch.id.slice(0, 8)}-${Date.now()}-${i}`;
      const edgeCellId = `fse-${cid}`;
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

      // Stamp the connecting edge with the backend relation id (when known)
      // so canvas-side deletions can fire DELETE /relations/{id}. Insert
      // with an empty value first, then setValue so the XML user-object
      // survives mxGraph's silent string-coercion of the insertEdge value.
      // The editor also maintains a cellId → relation-meta side-table as
      // the authoritative source for in-session deletes, since DrawIO
      // sometimes drops user-object attributes on edges created inside an
      // open transaction.
      const edge = graph.insertEdge(
        root, edgeCellId, "",
        parentCell, vertex,
        `edgeStyle=entityRelationEdgeStyle;strokeColor=${ch.color};strokeWidth=1.5;endArrow=none;startArrow=none`,
      );
      const edgeObj = xmlDoc.createElement("object");
      edgeObj.setAttribute("label", "");
      if (ch.relationType) edgeObj.setAttribute("relationType", ch.relationType);
      if (ch.relationId) edgeObj.setAttribute("relationId", ch.relationId);
      model.setValue(edge, edgeObj);

      inserted.push({
        cellId: cid,
        cardId: ch.id,
        edgeCellId,
        relationId: ch.relationId,
        relationType: ch.relationType,
      });
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
/**
 * Remove all descendant cells (and their edges) belonging to a parent group.
 * Recurses into children that are themselves expanded, so nested expansions
 * are cleaned up correctly.
 *
 * Returns the cellIds of every cell that was actually removed (vertices
 * AND their connecting edges). Callers need this so they can scrub
 * matching entries from their own side-tables (e.g. the editor's
 * edgeRelationMap) — otherwise the diff-based edge-deletion detector
 * would mistake a collapse for a user delete and prompt the confirm
 * dialog for every edge that disappeared.
 */
export function collapseCardGroup(
  iframe: HTMLIFrameElement,
  parentCellId: string,
): { removedCellIds: string[] } {
  const ctx = getMxGraph(iframe);
  if (!ctx) return { removedCellIds: [] };
  const { graph } = ctx;

  const model = graph.getModel();
  const parentCell = model.getCell(parentCellId);
  if (!parentCell) return { removedCellIds: [] };

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

  if (toRemove.length === 0) return { removedCellIds: [] };

  // Compute the full set of cellIds that mxGraph will actually remove —
  // `removeCells(toRemove, true)` also collects every edge connected to
  // any cell in `toRemove`. We need those edge cellIds to scrub the
  // editor's side-table.
  const removedSet = new Set<string>();
  const collectEdges = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cell: any,
  ) => {
    if (!cell?.edges) return;
    for (const e of cell.edges) {
      if (e?.id) removedSet.add(e.id);
    }
  };
  for (const c of toRemove) {
    if (c.id) removedSet.add(c.id);
    collectEdges(c);
  }

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

  return { removedCellIds: Array.from(removedSet) };
}

/**
 * Scan all cells and add expand/collapse overlays to every card cell
 * (including children from previous expansions).
 *
 * For collapsed cells we render a chevron that opens the per-relation-type
 * ExpandMenu (Phase 3). For already-expanded cells we keep the minus icon
 * so the user can collapse with one click.
 */
export function refreshCardOverlays(
  iframe: HTMLIFrameElement,
  onCollapse: (cellId: string, cardId: string) => void,
  onChevron: (cellId: string, cardId: string, anchor: { x: number; y: number }) => void,
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
    if (fsId.startsWith("pending-")) continue; // pending cells get the chevron only after sync

    let expanded = cell.value.getAttribute("expanded") === "1";
    // If marked expanded but children were deleted, treat as collapsed
    if (expanded && !parentsWithChildren.has(cell.id)) expanded = false;

    if (expanded) {
      addExpandOverlay(iframe, cell.id, true, () => onCollapse(cell.id, fsId));
    } else {
      addChevronOverlay(iframe, cell.id, (anchor) => onChevron(cell.id, fsId, anchor));
    }
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
  /** Captured at removal time so a "No, abort" confirmation can re-insert
   *  the edge between the same vertices with the same style. */
  sourceCellId: string | null;
  targetCellId: string | null;
  style: string;
}

export type RemovedTombstone = RemovedCardTombstone | RemovedRelationTombstone;

export interface ResolvedRelationMeta {
  relationId: string;
  relationType: string;
  relationLabel: string;
  sourceName: string;
  targetName: string;
  /** Endpoint cellIds captured at registration time so the
   *  abort-deletion path can re-insert the edge between the same
   *  vertices, even when the deletion was detected via the periodic
   *  side-table diff instead of a live CELLS_REMOVED event. */
  sourceCellId?: string | null;
  targetCellId?: string | null;
  /** Style captured at registration time; falls back to a sane
   *  default in restoreRemovedEdge when missing. */
  style?: string;
}

export interface CellLifecycleHandlers {
  onDuplicate: (cellId: string, sharedCardId: string, wasPending: boolean) => void;
  onRemoved: (tombstones: RemovedTombstone[]) => void;
  /** Returns the set of cellIds we have deliberately inserted ourselves.
   *  Any cell with a cardId attribute whose cellId is NOT in this set is
   *  treated as a paste/clone and routed through onDuplicate. */
  isRegistered: (cellId: string) => boolean;
  /** Optional fallback resolver for edges where the XML user-object
   *  doesn't expose `relationId`. DrawIO occasionally drops or never
   *  serialises user-object attributes for edges inserted inside an open
   *  `beginUpdate / endUpdate` transaction — the editor maintains its own
   *  cellId → metadata map so deletion sync stays reliable. */
  getRelationIdForEdge?: (cellId: string) => ResolvedRelationMeta | null;
}

/**
 * Hook the graph model so we can:
 *   - detect copy/paste/duplicate adding a cell that reuses an existing
 *     cardId, and call onDuplicate so the parent can either regenerate the
 *     temp id (pending clone) or strip the cardId (synced clone). We use
 *     a "is this cellId one we deliberately inserted" check rather than
 *     "is this cardId duplicated in the model" — DrawIO's clipboard goes
 *     through paths that don't always end up in CELLS_ADDED, and the
 *     registered-set check stays correct even when our listener missed
 *     the synchronous event.
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

  /** Fire onDuplicate for any card cell whose cellId we don't recognise. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checkCell = (cell: any) => {
    if (!cell?.value?.getAttribute) return;
    if (cell.edge) return;
    // Cells nested inside containers (expansion / drill-down / roll-up)
    // are managed by their parent and must not be treated as paste
    // candidates — their cardId is intentional, not a clone.
    if (cell.value.getAttribute("parentGroupCell")) return;
    if (cell.value.getAttribute("drillDownChild") === "1") return;
    if (cell.value.getAttribute("rollUpChild") === "1") return;
    const cardId = cell.value.getAttribute("cardId");
    if (!cardId) return;
    if (handlers.isRegistered(cell.id)) return;
    const wasPending = cell.value.getAttribute("pending") === "1";
    handlers.onDuplicate(cell.id, cardId, wasPending);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addedListener = (_sender: unknown, evt: any) => {
    const cells = evt.getProperty("cells") || [];
    if (cells.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const cell of cells as any[]) checkCell(cell);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const removedListener = (_sender: unknown, evt: any) => {
    const cells = evt.getProperty("cells") || [];
    if (cells.length === 0) return;
    const tombstones: RemovedTombstone[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const cell of cells as any[]) {
      // ---- Edge branch ----
      // Edges are checked separately so we can fall back to the editor's
      // cellId → relation-meta side-table when the XML user-object lookup
      // returns nothing (DrawIO drops user-object attributes on some edge
      // insertion paths, esp. ones nested inside an open transaction).
      if (cell.edge) {
        const value = cell.value;
        let relationId: string | null = null;
        let relationType = "";
        let relationLabel = "";
        if (value?.getAttribute) {
          relationId = value.getAttribute("relationId");
          relationType = value.getAttribute("relationType") || "";
          relationLabel = value.getAttribute("label") || relationType;
        }
        let srcName = "";
        let tgtName = "";
        if (!relationId && handlers.getRelationIdForEdge) {
          const meta = handlers.getRelationIdForEdge(cell.id);
          if (meta) {
            relationId = meta.relationId;
            relationType = meta.relationType;
            relationLabel = meta.relationLabel;
            srcName = meta.sourceName;
            tgtName = meta.targetName;
          }
        }
        if (!relationId) continue;
        const src = cell.source;
        const tgt = cell.target;
        const srcLabel: string =
          srcName ||
          src?.value?.getAttribute?.("label") ||
          (typeof src?.value === "string" ? src.value : "") ||
          "";
        const tgtLabel: string =
          tgtName ||
          tgt?.value?.getAttribute?.("label") ||
          (typeof tgt?.value === "string" ? tgt.value : "") ||
          "";
        const style = model.getStyle(cell) || "";
        tombstones.push({
          kind: "relation",
          edgeCellId: cell.id,
          relationId,
          relationType,
          relationLabel,
          sourceName: String(srcLabel),
          targetName: String(tgtLabel),
          sourceCellId: src?.id ?? null,
          targetCellId: tgt?.id ?? null,
          style: String(style),
        });
        continue;
      }
      // ---- Vertex branch ----
      const value = cell?.value;
      if (!value?.getAttribute) continue;
      const cardId = value.getAttribute("cardId");
      const isPending = value.getAttribute("pending") === "1";
      const isChild = !!value.getAttribute("parentGroupCell");

      if (cardId && !isPending && !isChild && !cardId.startsWith("pending-")) {
        // Only tombstone top-level synced cards. Expanded children, drill-
        // down children, and roll-up children disappear when their parent
        // container is removed — they don't represent a user intent to
        // remove the underlying card from inventory.
        if (
          value.getAttribute("drillDownChild") === "1" ||
          value.getAttribute("rollUpChild") === "1"
        ) {
          continue;
        }
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
 * Walk every cell in the graph and route any unregistered card cell through
 * `onDuplicate`. Used as a periodic safety net because DrawIO's clipboard
 * sometimes inserts cells via paths that don't fire `CELLS_ADDED` on the
 * model in a way our listener sees (e.g. cross-tab paste deserialises XML
 * and skips the standard transaction batching).
 */
export function scanForDuplicateCells(
  iframe: HTMLIFrameElement,
  isRegistered: (cellId: string) => boolean,
  onDuplicate: (cellId: string, sharedCardId: string, wasPending: boolean) => void,
): void {
  const ctx = getMxGraph(iframe);
  if (!ctx) return;
  const { graph } = ctx;
  const cells = graph.getModel().cells || {};
  for (const k of Object.keys(cells)) {
    const cell = cells[k];
    if (!cell?.value?.getAttribute) continue;
    if (cell.edge) continue;
    if (cell.value.getAttribute("parentGroupCell")) continue;
    const cardId = cell.value.getAttribute("cardId");
    if (!cardId) continue;
    if (isRegistered(cell.id)) continue;
    const wasPending = cell.value.getAttribute("pending") === "1";
    onDuplicate(cell.id, cardId, wasPending);
  }
}

/**
 * Re-insert an edge that was just removed from the canvas (used for the
 * "No, abort" path of the relation-deletion confirmation). Re-creates a
 * fresh edge between the original source/target cells with the captured
 * style + relationId. Falls back to a no-op if either endpoint has since
 * disappeared (e.g. the user also removed the source card).
 */
export function restoreRemovedEdge(
  iframe: HTMLIFrameElement,
  tombstone: RemovedRelationTombstone,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;
  const model = graph.getModel();
  const src = tombstone.sourceCellId ? model.getCell(tombstone.sourceCellId) : null;
  const tgt = tombstone.targetCellId ? model.getCell(tombstone.targetCellId) : null;
  if (!src || !tgt) return false;

  model.beginUpdate();
  try {
    const xmlDoc = win.mxUtils.createXmlDocument();
    const obj = xmlDoc.createElement("object");
    obj.setAttribute("label", tombstone.relationLabel);
    if (tombstone.relationType) obj.setAttribute("relationType", tombstone.relationType);
    obj.setAttribute("relationId", tombstone.relationId);
    graph.insertEdge(
      graph.getDefaultParent(),
      tombstone.edgeCellId,
      obj,
      src,
      tgt,
      tombstone.style ||
        "edgeStyle=entityRelationEdgeStyle;strokeColor=#666;strokeWidth=1.5;endArrow=none;startArrow=none;",
    );
  } finally {
    model.endUpdate();
  }
  return true;
}

/** Return the set of cellIds currently present in the model that are
 *  edges. Used by the editor's periodic diff against its side-table —
 *  any edge that was registered as a relation but is no longer in the
 *  model has been deleted and should land in the confirm-dialog queue.
 *  This is more reliable than the synchronous `CELLS_REMOVED` listener,
 *  which DrawIO doesn't always fire for the deletion paths a user can
 *  trigger (keyboard Delete, right-click → Delete, edge tool, …). */
export function collectLiveEdgeCellIds(iframe: HTMLIFrameElement): Set<string> {
  const out = new Set<string>();
  const ctx = getMxGraph(iframe);
  if (!ctx) return out;
  const cells = ctx.graph.getModel().cells || {};
  for (const k of Object.keys(cells)) {
    if (cells[k]?.edge) out.add(k);
  }
  return out;
}

/** Snapshot a single edge before deletion — used to surface human-
 *  readable source/target names in the confirmation dialog. */
export function describeEdgeEndpoints(
  iframe: HTMLIFrameElement,
  edgeCellId: string,
): { sourceName: string; targetName: string; sourceCellId: string | null; targetCellId: string | null } {
  const ctx = getMxGraph(iframe);
  if (!ctx) return { sourceName: "", targetName: "", sourceCellId: null, targetCellId: null };
  const cell = ctx.graph.getModel().getCell(edgeCellId);
  if (!cell) return { sourceName: "", targetName: "", sourceCellId: null, targetCellId: null };
  const labelOf = (c: { value?: { getAttribute?: (k: string) => string | null } | string | null } | null | undefined) => {
    if (!c?.value) return "";
    if (typeof c.value === "string") return c.value;
    return c.value.getAttribute?.("label") || "";
  };
  return {
    sourceName: labelOf(cell.source),
    targetName: labelOf(cell.target),
    sourceCellId: cell.source?.id ?? null,
    targetCellId: cell.target?.id ?? null,
  };
}

/** Scan the in-memory graph for every edge that already carries a
 *  relationId attribute on its XML user-object, returning a list of
 *  metadata records the editor can drop into its side-table. Used on
 *  bootstrap to bridge saved diagrams into the in-session cache. */
export function collectExistingEdgeRelations(
  iframe: HTMLIFrameElement,
): Array<{
  edgeCellId: string;
  relationId: string;
  relationType: string;
  relationLabel: string;
}> {
  const ctx = getMxGraph(iframe);
  if (!ctx) return [];
  const { graph } = ctx;
  const cells = graph.getModel().cells || {};
  const result: Array<{
    edgeCellId: string;
    relationId: string;
    relationType: string;
    relationLabel: string;
  }> = [];
  for (const k of Object.keys(cells)) {
    const cell = cells[k];
    if (!cell?.edge) continue;
    if (!cell.value?.getAttribute) continue;
    const relationId = cell.value.getAttribute("relationId");
    if (!relationId) continue;
    result.push({
      edgeCellId: cell.id,
      relationId,
      relationType: cell.value.getAttribute("relationType") || "",
      relationLabel: cell.value.getAttribute("label") || "",
    });
  }
  return result;
}

/** Parse a diagram XML string and extract every card-cell cellId so the
 *  editor can pre-seed the registered-cells set before loading restored
 *  draft XML. Without this, the lifecycle listener sees the restored
 *  cells as "unregistered" and silently dedupes them into grey stubs. */
export function extractCardCellIdsFromXml(xml: string): string[] {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const ids: string[] = [];
    const objects = doc.querySelectorAll("object[cardId]");
    objects.forEach((obj) => {
      // mxGraph serialises card cells as <object cardId="..."><mxCell id="..." vertex="1"/></object>
      const inner = obj.querySelector("mxCell");
      if (!inner) return;
      // Skip edges — only vertex card cells need registration.
      if (inner.getAttribute("edge") === "1") return;
      const id = inner.getAttribute("id");
      if (id) ids.push(id);
    });
    return ids;
  } catch {
    return [];
  }
}

/** Same as collectExistingEdgeRelations but reads from a raw XML string
 *  rather than the in-memory graph. Used on restore to seed the side-
 *  table BEFORE handing the XML to DrawIO — otherwise the brief window
 *  between load and our post-load scan would leave edge deletions
 *  un-tombstoneable. */
export function extractEdgeRelationsFromXml(
  xml: string,
): Array<{
  edgeCellId: string;
  relationId: string;
  relationType: string;
  relationLabel: string;
}> {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const result: Array<{
      edgeCellId: string;
      relationId: string;
      relationType: string;
      relationLabel: string;
    }> = [];
    const objects = doc.querySelectorAll("object[relationId]");
    objects.forEach((obj) => {
      const inner = obj.querySelector("mxCell[edge='1']");
      if (!inner) return;
      const edgeCellId = inner.getAttribute("id");
      if (!edgeCellId) return;
      result.push({
        edgeCellId,
        relationId: obj.getAttribute("relationId") || "",
        relationType: obj.getAttribute("relationType") || "",
        relationLabel: obj.getAttribute("label") || "",
      });
    });
    return result;
  } catch {
    return [];
  }
}

/**
 * Seed the registered-cells set with every card cellId currently in the
 * graph. Call this once on bootstrap right after the diagram XML loads,
 * before attaching the lifecycle listener — otherwise the listener will
 * see the loaded cells as "unregistered" and mistakenly dedupe them.
 */
export function collectExistingCardCellIds(iframe: HTMLIFrameElement): string[] {
  const ctx = getMxGraph(iframe);
  if (!ctx) return [];
  const { graph } = ctx;
  const cells = graph.getModel().cells || {};
  const ids: string[] = [];
  for (const k of Object.keys(cells)) {
    const cell = cells[k];
    if (!cell?.value?.getAttribute) continue;
    if (cell.edge) continue;
    if (cell.value.getAttribute("parentGroupCell")) continue;
    const cardId = cell.value.getAttribute("cardId");
    if (cardId) ids.push(cell.id);
  }
  return ids;
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
 * Re-link a cell (synced, unlinked, or plain DrawIO shape) to a different
 * card. Rewrites cardId, cardType, label so the cell points at the new
 * backend card.
 *
 * For cells that were already card-shaped (currently linked or previously
 * unlinked), we swap to the target card type's full `buildSyncedStyle` so
 * the visual is consistent with cards inserted via the picker.
 *
 * For plain DrawIO shapes — rectangles, ellipses, swimlanes the user drew
 * from the toolbar — we KEEP the user's original shape style and only
 * update fillColor + strokeColor + fontColor so the shape they drew gains
 * the card-type colour without losing its geometry. This is what users
 * expect from "Link to Existing Card" on a hand-drawn shape.
 */
export function relinkCell(
  iframe: HTMLIFrameElement,
  cellId: string,
  opts: { cardId: string; cardType: string; name: string; color: string },
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;

  const model = graph.getModel();
  const cell = model.getCell(cellId);
  if (!cell) return false;

  model.beginUpdate();
  try {
    let value = cell.value;
    // Was this cell previously associated with a card? If so we treat it
    // as card-shaped and replace the visual style entirely.
    const wasCardShaped =
      !!value?.getAttribute && (
        !!value.getAttribute("cardId") || !!value.getAttribute("cardType")
      );

    if (!value?.setAttribute) {
      // Plain shape with a string label (or null) — wrap it in an XML
      // user-object so we have somewhere to write cardId / cardType.
      const xmlDoc = win.mxUtils.createXmlDocument();
      const obj = xmlDoc.createElement("object");
      obj.setAttribute("label", typeof value === "string" ? value : "");
      model.setValue(cell, obj);
      value = obj;
    }
    value.setAttribute("cardId", opts.cardId);
    value.setAttribute("cardType", opts.cardType);
    value.setAttribute("label", opts.name);
    if (value.removeAttribute) {
      value.removeAttribute("pending");
      value.removeAttribute("expanded");
      value.removeAttribute("childCellIds");
    }
    if (wasCardShaped) {
      model.setStyle(cell, buildSyncedStyle(opts.color));
    } else {
      // Preserve the user's shape — only update fill + stroke + font
      // colour so the cell visibly belongs to the target card type
      // without losing the rectangle / ellipse / swimlane shape.
      const current = (model.getStyle(cell) || "") as string;
      const stroke = darken(opts.color);
      const next = current
        .split(";")
        .filter(Boolean)
        .filter(
          (p) =>
            !p.startsWith("fillColor=") &&
            !p.startsWith("strokeColor=") &&
            !p.startsWith("fontColor="),
        )
        .concat([
          `fillColor=${opts.color}`,
          `strokeColor=${stroke}`,
          "fontColor=#ffffff",
        ])
        .join(";");
      model.setStyle(cell, next);
    }
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

/* ------------------------------------------------------------------ */
/*  Phase 3 — chevron expand menu (per relation type)                  */
/* ------------------------------------------------------------------ */

/**
 * Replace the +/- overlay with a chevron that opens an MUI Menu in the
 * parent window. Click position is captured so the menu can anchor near the
 * overlay regardless of canvas zoom/scroll.
 */
export function addChevronOverlay(
  iframe: HTMLIFrameElement,
  cellId: string,
  onClick: (anchor: { x: number; y: number }) => void,
): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { win, graph } = ctx;
  const cell = graph.getModel().getCell(cellId);
  if (!cell) return false;

  graph.removeCellOverlays(cell);
  const overlay = new win.mxCellOverlay(
    new win.mxImage(CHEVRON_OVERLAY, 20, 20),
    "Expand related cards",
    win.mxConstants.ALIGN_RIGHT,
    win.mxConstants.ALIGN_MIDDLE,
    new win.mxPoint(0, 0),
  );
  overlay.cursor = "pointer";
  overlay.addListener(win.mxEvent.CLICK, (_s: unknown, evt: { properties?: { event?: MouseEvent } }) => {
    // mxCellOverlay's CLICK fires with the wrapped DOM event in
    // `properties.event` (mxGraph's own event abstraction). Fall back to
    // the cell's screen position when the event isn't surfaced.
    const e = evt?.properties?.event;
    let x = 0;
    let y = 0;
    if (e && typeof e.clientX === "number") {
      // The overlay lives inside the iframe; translate to the parent's
      // viewport so the MUI Menu anchor lands where the user clicked.
      const rect = iframe.getBoundingClientRect();
      x = rect.left + e.clientX;
      y = rect.top + e.clientY;
    } else {
      const rect = iframe.getBoundingClientRect();
      const geo = graph.getCellGeometry(cell);
      const s = graph.view.scale;
      const tr = graph.view.translate;
      const container = graph.container as HTMLElement;
      if (geo) {
        x = rect.left + ((geo.x + geo.width + tr.x) * s - container.scrollLeft);
        y = rect.top + ((geo.y + geo.height / 2 + tr.y) * s - container.scrollTop);
      } else {
        x = rect.left + 100;
        y = rect.top + 100;
      }
    }
    onClick({ x, y });
  });
  graph.addCellOverlay(cell, overlay);
  return true;
}

export type ExpandPlacement = "right" | "below" | "above";

/**
 * Insert child cells around a parent. Variant of expandCardGroup that
 * accepts a placement direction so the same helper backs Show Dependency
 * (right), Drill-Down (below) and Roll-Up (above).
 */
export function expandCardGroupAt(
  iframe: HTMLIFrameElement,
  parentCellId: string,
  children: ExpandChildData[],
  placement: ExpandPlacement,
): ExpandedEdgeInfo[] {
  const ctx = getMxGraph(iframe);
  if (!ctx) return [];
  const { win, graph } = ctx;

  const model = graph.getModel();
  const root = graph.getDefaultParent();
  const parentCell = model.getCell(parentCellId);
  if (!parentCell) return [];

  const geo = graph.getCellGeometry(parentCell);
  if (!geo) return [];

  const inserted: ExpandedEdgeInfo[] = [];
  model.beginUpdate();
  try {
    if (placement === "right") {
      // Stack children vertically to the right (matches the original
      // expandCardGroup behaviour).
      let totalH = 0;
      for (let i = 0; i < children.length; i++) {
        if (i > 0) {
          totalH +=
            children[i].type !== children[i - 1].type ? TYPE_GROUP_GAP : CHILD_GAP_Y;
        }
        totalH += CHILD_CARD_H;
      }
      const startX = geo.x + geo.width + CHILD_GAP_X;
      const startY = geo.y + geo.height / 2 - totalH / 2;
      let yOff = 0;
      for (let i = 0; i < children.length; i++) {
        if (i > 0) {
          yOff += children[i].type !== children[i - 1].type ? TYPE_GROUP_GAP : CHILD_GAP_Y;
        }
        const ch = children[i];
        inserted.push(
          insertChildVertex(win, graph, root, parentCell, parentCellId, ch, startX, startY + yOff, i),
        );
        yOff += CHILD_CARD_H;
      }
    } else {
      // Below or above: tile children in rows, centered horizontally on the
      // parent. We use simple wrapping so wide expansions don't run off the
      // canvas.
      const perRow = Math.max(1, Math.floor((geo.width + CHILD_GAP_X) / (CHILD_CARD_W + CHILD_GAP_X)));
      const cols = Math.min(perRow, Math.max(1, Math.ceil(Math.sqrt(children.length))));
      const rowCount = Math.ceil(children.length / cols);
      const rowH = CHILD_CARD_H + CHILD_GAP_Y;
      const totalH = rowCount * rowH - CHILD_GAP_Y;
      const totalW = cols * CHILD_CARD_W + (cols - 1) * CHILD_GAP_X;
      const startX = geo.x + geo.width / 2 - totalW / 2;
      const startY =
        placement === "below"
          ? geo.y + geo.height + CHILD_GAP_X
          : geo.y - CHILD_GAP_X - totalH;
      for (let i = 0; i < children.length; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const x = startX + c * (CHILD_CARD_W + CHILD_GAP_X);
        const y = startY + r * rowH;
        inserted.push(
          insertChildVertex(win, graph, root, parentCell, parentCellId, children[i], x, y, i),
        );
      }
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

function insertChildVertex(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  win: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graph: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parentCell: any,
  parentCellId: string,
  ch: ExpandChildData,
  x: number,
  y: number,
  index: number,
): ExpandedEdgeInfo {
  const cid = `fsg-${ch.id.slice(0, 8)}-${Date.now()}-${index}`;
  const edgeCellId = `fse-${cid}`;
  const stroke = darken(ch.color);
  const style = [
    "rounded=1",
    "whiteSpace=wrap",
    "html=1",
    `fillColor=${ch.color}`,
    "fontColor=#ffffff",
    `strokeColor=${stroke}`,
    "fontSize=11",
    "fontStyle=1",
    "arcSize=12",
  ].join(";");

  const xmlDoc = win.mxUtils.createXmlDocument();
  const obj = xmlDoc.createElement("object");
  obj.setAttribute("label", ch.name);
  obj.setAttribute("cardId", ch.id);
  obj.setAttribute("cardType", ch.type);
  obj.setAttribute("parentGroupCell", parentCellId);

  const vertex = graph.insertVertex(
    root,
    cid,
    obj,
    x,
    y,
    CHILD_CARD_W,
    CHILD_CARD_H,
    style,
  );
  // Stamp the edge with relationId both on the XML user-object (so saves
  // serialise correctly) and via the returned info so the editor's
  // cellId → relation-meta side-table can mirror it. The side-table is
  // the authoritative source for in-session deletes — see the
  // `getRelationIdForEdge` resolver in CellLifecycleHandlers.
  const edge = graph.insertEdge(
    root,
    edgeCellId,
    "",
    parentCell,
    vertex,
    `edgeStyle=entityRelationEdgeStyle;strokeColor=${ch.color};strokeWidth=1.5;endArrow=none;startArrow=none`,
  );
  const edgeObj = xmlDoc.createElement("object");
  edgeObj.setAttribute("label", "");
  if (ch.relationType) edgeObj.setAttribute("relationType", ch.relationType);
  if (ch.relationId) edgeObj.setAttribute("relationId", ch.relationId);
  graph.getModel().setValue(edge, edgeObj);
  return {
    cellId: cid,
    cardId: ch.id,
    edgeCellId,
    relationId: ch.relationId,
    relationType: ch.relationType,
  };
}

/* ------------------------------------------------------------------ */
/*  Hierarchy container rendering — Drill-Down + Roll-Up               */
/* ------------------------------------------------------------------ */

/** Return true when the cell already renders as a swimlane container —
 *  i.e. the user previously drilled down into it. */
export function isContainerCell(iframe: HTMLIFrameElement, cellId: string): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;
  const cell = graph.getModel().getCell(cellId);
  if (!cell) return false;
  const style = String(graph.getModel().getStyle(cell) || "");
  return style.includes("shape=swimlane");
}

/** Return true when the cell currently lives INSIDE another swimlane
 *  container — i.e. the user previously rolled it up or drilled into its
 *  parent. Used to block double-roll-ups that would create a phantom
 *  duplicate container on top. */
export function isInsideContainer(iframe: HTMLIFrameElement, cellId: string): boolean {
  const ctx = getMxGraph(iframe);
  if (!ctx) return false;
  const { graph } = ctx;
  const cell = graph.getModel().getCell(cellId);
  if (!cell) return false;
  const parent = cell.getParent ? cell.getParent() : cell.parent;
  if (!parent) return false;
  // Default parent / layer cells are not containers.
  if (parent === graph.getDefaultParent()) return false;
  if (!parent.value?.getAttribute) return false;
  const parentStyle = String(graph.getModel().getStyle(parent) || "");
  return parentStyle.includes("shape=swimlane");
}

/** Return the cellId of an existing on-canvas card cell for the given
 *  cardId (top-level, non-container, non-child-of-container). Used to
 *  detect "this card is already on the diagram, don't duplicate". */
export function findExistingCardCellId(
  iframe: HTMLIFrameElement,
  cardId: string,
): string | null {
  const ctx = getMxGraph(iframe);
  if (!ctx) return null;
  const { graph } = ctx;
  const cells = graph.getModel().cells || {};
  for (const k of Object.keys(cells)) {
    const cell = cells[k];
    if (!cell?.value?.getAttribute) continue;
    if (cell.edge) continue;
    if (cell.value.getAttribute("cardId") !== cardId) continue;
    if (cell.value.getAttribute("parentGroupCell")) continue;
    return cell.id;
  }
  return null;
}


export interface HierarchyChild {
  id: string;
  name: string;
  type: string;
  color: string;
}

/**
 * Turn the current card cell into a swimlane container holding the given
 * hierarchy children inside it. The header bar keeps the parent's label
 * and colour; children are tiled in a 3-wide grid below the header.
 *
 * Returns the inserted child cellIds + cardIds (registered by the caller
 * so the periodic dedup scan ignores them).
 */
export function drillDownInto(
  iframe: HTMLIFrameElement,
  parentCellId: string,
  children: HierarchyChild[],
): Array<{ cellId: string; cardId: string }> {
  const ctx = getMxGraph(iframe);
  if (!ctx) return [];
  const { win, graph } = ctx;
  const model = graph.getModel();
  const parentCell = model.getCell(parentCellId);
  if (!parentCell) return [];

  const geo = graph.getCellGeometry(parentCell);
  if (!geo) return [];

  // Layout constants tuned to feel like LeanIX's container drill-down.
  const HEADER = 28;
  const PAD = 12;
  const CHILD_W = 150;
  const CHILD_H = 50;
  const GAP = 10;
  const COLS = Math.min(3, Math.max(1, children.length));
  const ROWS = Math.ceil(children.length / COLS);
  const containerW = Math.max(geo.width, COLS * CHILD_W + (COLS - 1) * GAP + PAD * 2);
  const containerH = HEADER + PAD + ROWS * CHILD_H + (ROWS - 1) * GAP + PAD;

  const inserted: Array<{ cellId: string; cardId: string }> = [];
  model.beginUpdate();
  try {
    // Resize the parent cell + restyle as a swimlane container.
    const parentColor =
      /fillColor=([^;]+)/.exec(model.getStyle(parentCell) || "")?.[1] || "#0f7eb5";
    graph.resizeCell(
      parentCell,
      new win.mxRectangle(geo.x, geo.y, containerW, containerH),
    );
    const stroke = darken(parentColor);
    model.setStyle(
      parentCell,
      [
        "shape=swimlane",
        "startSize=" + HEADER,
        "horizontal=1",
        `fillColor=${parentColor}`,
        "fontColor=#ffffff",
        `strokeColor=${stroke}`,
        "fontSize=12",
        "fontStyle=1",
        "rounded=1",
        "arcSize=12",
        "html=1",
        "whiteSpace=wrap",
        "swimlaneLine=0",
      ].join(";"),
    );

    // Insert each child INSIDE the parent so it moves with the container.
    for (let i = 0; i < children.length; i++) {
      const ch = children[i];
      const r = Math.floor(i / COLS);
      const c = i % COLS;
      const x = PAD + c * (CHILD_W + GAP);
      const y = HEADER + PAD + r * (CHILD_H + GAP);

      const cellId = `dd-${ch.id.slice(0, 8)}-${Date.now()}-${i}`;
      const childStroke = darken(ch.color);
      const childStyle = [
        "rounded=1",
        "whiteSpace=wrap",
        "html=1",
        `fillColor=${ch.color}`,
        "fontColor=#ffffff",
        `strokeColor=${childStroke}`,
        "fontSize=11",
        "fontStyle=1",
        "arcSize=12",
      ].join(";");

      const xmlDoc = win.mxUtils.createXmlDocument();
      const obj = xmlDoc.createElement("object");
      obj.setAttribute("label", ch.name);
      obj.setAttribute("cardId", ch.id);
      obj.setAttribute("cardType", ch.type);
      // Mark as a drill-down child so future scans don't mistake the inner
      // cells for top-level cards.
      obj.setAttribute("drillDownChild", "1");

      graph.insertVertex(parentCell, cellId, obj, x, y, CHILD_W, CHILD_H, childStyle);
      inserted.push({ cellId, cardId: ch.id });
    }

    // Stash the inner cell ids on the parent so collapse can find them.
    const pv = parentCell.value;
    if (pv?.setAttribute) {
      pv.setAttribute("drillDownChildIds", inserted.map((c) => c.cellId).join(","));
    }
  } finally {
    model.endUpdate();
  }

  return inserted;
}

/**
 * Roll-Up — wrap the current card cell + selected siblings inside a new
 * parent container. The container goes to the canvas root and the existing
 * cells are re-parented inside it. The original cells keep their identity
 * (cardId, cellId) so the dedup scan stays happy.
 */
export function rollUpInto(
  iframe: HTMLIFrameElement,
  currentCellId: string,
  parent: { id: string; name: string; type: string; color: string },
  siblings: Array<{ cellId: string | null; card: HierarchyChild }>,
): { parentCellId: string; insertedSiblings: Array<{ cellId: string; cardId: string }> } | null {
  const ctx = getMxGraph(iframe);
  if (!ctx) return null;
  const { win, graph } = ctx;
  const model = graph.getModel();
  const current = model.getCell(currentCellId);
  if (!current) return null;
  const currentGeo = graph.getCellGeometry(current);
  if (!currentGeo) return null;

  // Build the list of vertices to nest: the current card + a vertex per
  // sibling. Siblings that already exist on the canvas keep their cell;
  // missing ones are freshly inserted.
  const HEADER = 28;
  const PAD = 12;
  const CHILD_W = 150;
  const CHILD_H = 50;
  const GAP = 10;
  const count = 1 + siblings.length;
  const COLS = Math.min(3, Math.max(1, count));
  const ROWS = Math.ceil(count / COLS);
  const containerW = COLS * CHILD_W + (COLS - 1) * GAP + PAD * 2;
  const containerH = HEADER + PAD + ROWS * CHILD_H + (ROWS - 1) * GAP + PAD;

  const parentStroke = darken(parent.color);
  const parentCellId = `ru-${parent.id.slice(0, 8)}-${Date.now()}`;

  const inserted: Array<{ cellId: string; cardId: string }> = [];

  model.beginUpdate();
  try {
    // Insert the new container at the canvas root, anchored near the
    // current card so the user sees the relationship.
    const xmlDoc = win.mxUtils.createXmlDocument();
    const parentObj = xmlDoc.createElement("object");
    parentObj.setAttribute("label", parent.name);
    parentObj.setAttribute("cardId", parent.id);
    parentObj.setAttribute("cardType", parent.type);

    const containerX = Math.max(0, currentGeo.x - PAD);
    const containerY = Math.max(0, currentGeo.y - HEADER - PAD);
    const containerVertex = graph.insertVertex(
      graph.getDefaultParent(),
      parentCellId,
      parentObj,
      containerX,
      containerY,
      containerW,
      containerH,
      [
        "shape=swimlane",
        "startSize=" + HEADER,
        "horizontal=1",
        `fillColor=${parent.color}`,
        "fontColor=#ffffff",
        `strokeColor=${parentStroke}`,
        "fontSize=12",
        "fontStyle=1",
        "rounded=1",
        "arcSize=12",
        "html=1",
        "whiteSpace=wrap",
        "swimlaneLine=0",
      ].join(";"),
    );

    // Reposition + reparent the current card as the first child.
    graph.resizeCell(
      current,
      new win.mxRectangle(PAD, HEADER + PAD, CHILD_W, CHILD_H),
    );
    model.add(containerVertex, current);

    // Insert one cell per sibling. We always create a fresh cell — the
    // sibling may not be on the canvas yet, and even if it is, the user
    // explicitly asked to see it nested here.
    siblings.forEach(({ card }, i) => {
      const slot = i + 1;
      const r = Math.floor(slot / COLS);
      const c = slot % COLS;
      const x = PAD + c * (CHILD_W + GAP);
      const y = HEADER + PAD + r * (CHILD_H + GAP);
      const cellId = `ruc-${card.id.slice(0, 8)}-${Date.now()}-${i}`;
      const childStroke = darken(card.color);
      const childStyle = [
        "rounded=1",
        "whiteSpace=wrap",
        "html=1",
        `fillColor=${card.color}`,
        "fontColor=#ffffff",
        `strokeColor=${childStroke}`,
        "fontSize=11",
        "fontStyle=1",
        "arcSize=12",
      ].join(";");

      const childObj = xmlDoc.createElement("object");
      childObj.setAttribute("label", card.name);
      childObj.setAttribute("cardId", card.id);
      childObj.setAttribute("cardType", card.type);
      childObj.setAttribute("rollUpChild", "1");

      graph.insertVertex(
        containerVertex,
        cellId,
        childObj,
        x,
        y,
        CHILD_W,
        CHILD_H,
        childStyle,
      );
      inserted.push({ cellId, cardId: card.id });
    });
  } finally {
    model.endUpdate();
  }

  return { parentCellId, insertedSiblings: inserted };
}

/* ------------------------------------------------------------------ */
/*  Phase 5 — view perspectives (color cells by attribute)             */
/* ------------------------------------------------------------------ */

/**
 * Iterate over every synced card cell and apply a fill color taken from
 * `colorByCardId`. Falls back to `defaultColor` when a card id is missing
 * or has no entry in the map. Used by the View Selector to recolor cells
 * by an attribute (lifecycle, criticality, …).
 */
export function applyViewToGraph(
  iframe: HTMLIFrameElement,
  colorByCardId: Map<string, string>,
  defaultColor: string,
): number {
  const ctx = getMxGraph(iframe);
  if (!ctx) return 0;
  const { graph } = ctx;
  const model = graph.getModel();
  const cells = model.cells || {};

  let touched = 0;
  model.beginUpdate();
  try {
    for (const k of Object.keys(cells)) {
      const cell = cells[k];
      if (!cell?.value?.getAttribute) continue;
      // Skip edges + child group cells (they take the parent's color anyway).
      if (cell.edge) continue;
      const cardId = cell.value.getAttribute("cardId");
      if (!cardId || cardId.startsWith("pending-")) continue;
      const color = colorByCardId.get(cardId) || defaultColor;
      const stroke = darken(color);
      const styleStr = (model.getStyle(cell) || "") as string;
      const next = styleStr
        .split(";")
        .filter(Boolean)
        .filter((p) => !p.startsWith("fillColor=") && !p.startsWith("strokeColor="))
        .concat([`fillColor=${color}`, `strokeColor=${stroke}`])
        .join(";");
      model.setStyle(cell, next);
      touched += 1;
    }
  } finally {
    model.endUpdate();
  }
  return touched;
}

/**
 * Restore each synced cell's style to its card-type color. Called when the
 * user switches the view back to "Card colors".
 */
export function resetViewColors(
  iframe: HTMLIFrameElement,
  colorByType: Map<string, string>,
  fallback: string,
): number {
  const ctx = getMxGraph(iframe);
  if (!ctx) return 0;
  const { graph } = ctx;
  const model = graph.getModel();
  const cells = model.cells || {};
  let touched = 0;
  model.beginUpdate();
  try {
    for (const k of Object.keys(cells)) {
      const cell = cells[k];
      if (!cell?.value?.getAttribute) continue;
      if (cell.edge) continue;
      const cardId = cell.value.getAttribute("cardId");
      if (!cardId) continue;
      const cardType = cell.value.getAttribute("cardType") || "";
      const color = colorByType.get(cardType) || fallback;
      const stroke = darken(color);
      const styleStr = (model.getStyle(cell) || "") as string;
      const next = styleStr
        .split(";")
        .filter(Boolean)
        .filter((p) => !p.startsWith("fillColor=") && !p.startsWith("strokeColor="))
        .concat([`fillColor=${color}`, `strokeColor=${stroke}`])
        .join(";");
      model.setStyle(cell, next);
      touched += 1;
    }
  } finally {
    model.endUpdate();
  }
  return touched;
}
