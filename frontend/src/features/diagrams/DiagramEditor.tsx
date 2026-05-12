import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import InsertCardsDialog from "./InsertCardsDialog";
import CreateOnDiagramDialog from "./CreateOnDiagramDialog";
import RelationPickerDialog from "./RelationPickerDialog";
import type { EdgeEndpoints } from "./RelationPickerDialog";
import DiagramSyncPanel from "./DiagramSyncPanel";
import type {
  PendingCard,
  PendingRelation,
  StaleItem,
} from "./DiagramSyncPanel";
import {
  buildCardCellData,
  insertCardIntoGraph,
  getVisibleCenter,
  addExpandOverlay,
  addResyncOverlay,
  addChevronOverlay,
  expandCardGroup,
  expandCardGroupAt,
  collapseCardGroup,
  getGroupChildCardIds,
  refreshCardOverlays,
  insertPendingCard,
  stampEdgeAsRelation,
  markCellSynced,
  markEdgeSynced,
  updateCellLabel,
  removeDiagramCell,
  scanDiagramItems,
  attachCellLifecycleListeners,
  dedupClonedCell,
  unlinkCell,
  relinkCell,
  getCellLabel,
  convertShapeToPendingCard,
  applyViewToGraph,
  resetViewColors,
} from "./drawio-shapes";
import type {
  ExpandChildData,
  RemovedTombstone,
  RemovedCardTombstone,
  RemovedRelationTombstone,
} from "./drawio-shapes";
import ExpandMenu from "./ExpandMenu";
import type {
  ExpandMenuTarget,
  ExpandMode,
  RelationSummaryEntry,
} from "./ExpandMenu";
import ViewSelector, { buildColorMap, extractCardValue } from "./ViewSelector";
import type { ColorEntry, ViewSource } from "./ViewSelector";
import DiagramViewLegend from "./DiagramViewLegend";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
import { useAuthContext } from "@/hooks/AuthContext";
import type { Card, CardType, Relation, RelationType } from "@/types";

/* ------------------------------------------------------------------ */
/*  DrawIO configuration                                               */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _meta = import.meta as any;
const DRAWIO_BASE_URL: string =
  _meta.env?.VITE_DRAWIO_URL || "/drawio/index.html";

const DRAWIO_URL_PARAMS = new URLSearchParams({
  embed: "1",
  proto: "json",
  spin: "1",
  modified: "unsavedChanges",
  saveAndExit: "1",
  noSaveBtn: "0",
  noExitBtn: "0",
  libs: "general;uml;c4;azure;sap",
}).toString();

const EMPTY_DIAGRAM =
  '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DiagramData {
  id: string;
  name: string;
  type: string;
  data: { xml?: string; thumbnail?: string; view?: ViewSource };
}

interface DrawIOMessage {
  event:
    | "init"
    | "save"
    | "exit"
    | "export"
    | "configure"
    | "insertCard"
    | "createCard"
    | "edgeConnected"
    | "cardClicked"
    | "unlinkCell"
    | "relinkCell"
    | "convertCell";
  xml?: string;
  data?: string;
  modified?: boolean;
  x?: number;
  y?: number;
  cardId?: string;
  cellId?: string;
  edgeCellId?: string;
  sourceCardId?: string;
  targetCardId?: string;
  sourceType?: string;
  targetType?: string;
  sourceName?: string;
  targetName?: string;
  sourceColor?: string;
  targetColor?: string;
}

/* ------------------------------------------------------------------ */
/*  Bootstrap: graph ref, context menu, edge interception              */
/* ------------------------------------------------------------------ */

function bootstrapDrawIO(iframe: HTMLIFrameElement) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = iframe.contentWindow as any;
    if (!win?.Draw?.loadPlugin) return;

    // Remove PWA manifest link so it doesn't trigger auth-proxy redirects
    // (e.g. Cloudflare Access) — browser manifest fetches omit cookies.
    const manifestLink = win.document.querySelector('link[rel="manifest"]');
    if (manifestLink) manifestLink.remove();

    win.Draw.loadPlugin((ui: Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = ui.editor as any;
      const graph = editor?.graph;
      if (graph) {
        win.__turboGraph = graph;
      }

      /* ---------- Right-click context menu ---------- */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const menus = ui.menus as any;
      if (menus?.createPopupMenu) {
        const origFactory = menus.createPopupMenu;
        menus.createPopupMenu = function (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          menu: any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cell: any,
          evt: MouseEvent,
        ) {
          origFactory.apply(this, arguments);
          menu.addSeparator();

          const mxEvent = win.mxEvent;
          const container = graph.container;
          const offset = container.getBoundingClientRect();
          const s = graph.view.scale;
          const tr = graph.view.translate;
          const gx = Math.round(
            (mxEvent.getClientX(evt) - offset.left + container.scrollLeft) / s - tr.x,
          );
          const gy = Math.round(
            (mxEvent.getClientY(evt) - offset.top + container.scrollTop) / s - tr.y,
          );

          // If the right-click landed on (or inside) a card cell, surface
          // the card-details shortcut. Walk up so clicks on inner labels
          // still resolve to the card.
          let cardCell = cell;
          while (cardCell && !cardCell.value?.getAttribute?.("cardId")) {
            cardCell = cardCell.parent;
          }
          const cardId = cardCell?.value?.getAttribute?.("cardId");
          const isPending = cardCell?.value?.getAttribute?.("pending") === "1";
          const isSyncedCard = !!cardId && !isPending && !cardId.startsWith("pending-");
          const isVertex = cell && !cell.edge;
          const hasNoCardId = isVertex && !cardId;

          if (cardId) {
            menu.addItem("View Card Details\u2026", null, () => {
              win.parent.postMessage(
                JSON.stringify({ event: "cardClicked", cardId }),
                "*",
              );
            });
          }
          if (isSyncedCard && cardCell) {
            menu.addItem("Change Linked Card\u2026", null, () => {
              win.parent.postMessage(
                JSON.stringify({ event: "relinkCell", cellId: cardCell.id }),
                "*",
              );
            });
            menu.addItem("Unlink Card", null, () => {
              win.parent.postMessage(
                JSON.stringify({ event: "unlinkCell", cellId: cardCell.id }),
                "*",
              );
            });
          }
          if (hasNoCardId && cell) {
            menu.addItem("Link to Existing Card\u2026", null, () => {
              win.parent.postMessage(
                JSON.stringify({ event: "relinkCell", cellId: cell.id }),
                "*",
              );
            });
            menu.addItem("Convert to Card\u2026", null, () => {
              win.parent.postMessage(
                JSON.stringify({ event: "convertCell", cellId: cell.id }),
                "*",
              );
            });
          }
          if (cardId || hasNoCardId) menu.addSeparator();

          menu.addItem("Insert Existing Card\u2026", null, () => {
            win.parent.postMessage(
              JSON.stringify({ event: "insertCard", x: gx, y: gy }),
              "*",
            );
          });

          menu.addItem("Create New Card\u2026", null, () => {
            win.parent.postMessage(
              JSON.stringify({ event: "createCard", x: gx, y: gy }),
              "*",
            );
          });
        };
      }

      /* ---------- Edge connection interception ---------- */
      const connHandler = graph.connectionHandler;
      if (connHandler) {
        connHandler.addListener(win.mxEvent.CONNECT, function (
          _sender: unknown,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          evt: any,
        ) {
          const edge = evt.getProperty("cell");
          if (!edge) return;

          const model = graph.getModel();
          const src = model.getTerminal(edge, true);
          const tgt = model.getTerminal(edge, false);
          if (!src || !tgt) return;

          const srcFsId = src.value?.getAttribute?.("cardId");
          const tgtFsId = tgt.value?.getAttribute?.("cardId");
          const srcType = src.value?.getAttribute?.("cardType");
          const tgtType = tgt.value?.getAttribute?.("cardType");

          if (srcFsId && tgtFsId && srcType && tgtType) {
            // Resolve colors via stored style (fillColor)
            const srcStyle = model.getStyle(src) || "";
            const tgtStyle = model.getStyle(tgt) || "";
            const pick = (s: string) => {
              const m = /fillColor=([^;]+)/.exec(s);
              return m ? m[1] : "#999";
            };

            win.parent.postMessage(
              JSON.stringify({
                event: "edgeConnected",
                edgeCellId: edge.id,
                sourceCardId: srcFsId,
                targetCardId: tgtFsId,
                sourceType: srcType,
                targetType: tgtType,
                sourceName: src.value.getAttribute("label") || "",
                targetName: tgt.value.getAttribute("label") || "",
                sourceColor: pick(srcStyle),
                targetColor: pick(tgtStyle),
              }),
              "*",
            );
          }
        });
      }
    });
  } catch {
    // Cross-origin or editor not ready
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DiagramEditor() {
  const { t } = useTranslation(["diagrams", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const canManage = useMemo(() => {
    const perms = user?.permissions;
    if (!perms) return false;
    return !!perms["*"] || !!perms["diagrams.manage"];
  }, [user?.permissions]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [diagram, setDiagram] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snackMsg, setSnackMsg] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Metamodel
  const { types: fsTypes, relationTypes } = useMetamodel();
  const rml = useResolveMetaLabel();
  const fsTypesRef = useRef(fsTypes);
  fsTypesRef.current = fsTypes;
  const relTypesRef = useRef(relationTypes);
  relTypesRef.current = relationTypes;

  // Refs
  const pendingSaveXmlRef = useRef<string | null>(null);
  const contextInsertPosRef = useRef<{ x: number; y: number } | null>(null);

  // Expand/collapse caches — survive collapse/expand cycles so locally
  // deleted children don't reappear.
  const expandCacheRef = useRef<Map<string, ExpandChildData[]>>(new Map());
  const deletedChildrenRef = useRef<Map<string, Set<string>>>(new Map());

  // Dialog states
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [relPickerOpen, setRelPickerOpen] = useState(false);
  const pendingEdgeRef = useRef<EdgeEndpoints | null>(null);

  // Sync panel
  const [syncOpen, setSyncOpen] = useState(false);
  const [pendingCards, setPendingFS] = useState<PendingCard[]>([]);
  const [pendingRels, setPendingRels] = useState<PendingRelation[]>([]);
  const [staleItems, setStaleItems] = useState<StaleItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  // Deletion tombstones — populated when the user removes a synced card cell
  // or a synced relation edge on the canvas. Kept in component state so the
  // sync panel can surface them and Sync All can issue the API deletes.
  const [pendingCardRemovals, setPendingCardRemovals] = useState<RemovedCardTombstone[]>([]);
  const [pendingRelRemovals, setPendingRelRemovals] = useState<RemovedRelationTombstone[]>([]);
  // Cells the user has opted in to also archive (default: remove from
  // diagram only — keeps the card in inventory).
  const [archiveOnSync, setArchiveOnSync] = useState<Set<string>>(new Set());

  // Phase 2 context-menu actions
  const [relinkTargetCellId, setRelinkTargetCellId] = useState<string | null>(null);
  const [convertTargetCellId, setConvertTargetCellId] = useState<string | null>(null);
  const [convertPrefillName, setConvertPrefillName] = useState<string>("");

  // Phase 3 — chevron expand menu
  const [expandMenuTarget, setExpandMenuTarget] = useState<ExpandMenuTarget | null>(null);

  // Phase 5 — view perspectives (color cells by attribute)
  const [view, setView] = useState<ViewSource>({ kind: "card_type" });
  const [viewLegendEntries, setViewLegendEntries] = useState<ColorEntry[]>([]);
  const [viewAppliedCount, setViewAppliedCount] = useState(0);
  const [activeTypeKeys, setActiveTypeKeys] = useState<string[]>([]);

  // Local autosave restore prompt
  const [restoreBanner, setRestoreBanner] = useState<{ xml: string; savedAt: string } | null>(null);
  const restoreCheckedRef = useRef(false);

  /* ---------- Load diagram ---------- */
  useEffect(() => {
    if (!id) return;
    api
      .get<DiagramData>(`/diagrams/${id}`)
      .then((d) => {
        setDiagram(d);
        if (d.data?.view) setView(d.data.view);
        // Check for a newer locally-autosaved draft once per mount.
        if (!restoreCheckedRef.current) {
          restoreCheckedRef.current = true;
          try {
            const raw = localStorage.getItem(`turbo-ea-diagram-draft-${id}`);
            if (raw) {
              const draft = JSON.parse(raw) as { xml: string; savedAt: string };
              // Only prompt when the autosave is non-trivially different from
              // what's already persisted on the server.
              if (draft.xml && draft.xml !== d.data?.xml) {
                setRestoreBanner({ xml: draft.xml, savedAt: draft.savedAt });
              } else {
                localStorage.removeItem(`turbo-ea-diagram-draft-${id}`);
              }
            }
          } catch {
            // Corrupt JSON — ignore
          }
        }
      })
      .catch(() => setSnackMsg(t("editor.errors.loadFailed")))
      .finally(() => setLoading(false));
  }, [id]);

  const postToDrawIO = useCallback((msg: Record<string, unknown>) => {
    const frame = iframeRef.current;
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage(JSON.stringify(msg), "*");
    }
  }, []);

  const saveDiagram = useCallback(
    async (xml: string, thumbnail?: string) => {
      if (!diagram) return;
      setSaving(true);
      try {
        const payload: Record<string, unknown> = {
          data: {
            ...diagram.data,
            xml,
            ...(thumbnail ? { thumbnail } : {}),
            view,
          },
        };
        await api.patch(`/diagrams/${diagram.id}`, payload);
        setDiagram((prev) =>
          prev
            ? {
                ...prev,
                data: {
                  ...prev.data,
                  xml,
                  ...(thumbnail ? { thumbnail } : {}),
                  view,
                },
              }
            : prev,
        );
        // Persisted on the server — drop the local autosave snapshot so we
        // don't keep prompting to restore an older draft on reload.
        try {
          localStorage.removeItem(`turbo-ea-diagram-draft-${diagram.id}`);
        } catch {
          // localStorage may be disabled — non-fatal.
        }
        setSnackMsg(t("editor.saved"));
      } catch {
        setSnackMsg(t("editor.errors.saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [diagram, view],
  );

  /* ---------- Expand / collapse ---------- */

  /** Expand children into the graph and wire up overlays. */
  const doExpand = useCallback(
    (frame: HTMLIFrameElement, cellId: string, cardId: string, children: ExpandChildData[]) => {
      const deleted = deletedChildrenRef.current.get(cellId);
      const visible = deleted?.size
        ? children.filter((c) => !deleted.has(c.id))
        : children;

      if (visible.length === 0) {
        setSnackMsg(t("editor.noRelatedCards"));
        return;
      }

      const inserted = expandCardGroup(frame, cellId, visible);
      addExpandOverlay(frame, cellId, true, () =>
        handleCollapseGroup(cellId, cardId),
      );
      // If some children were locally removed, show resync icon
      if (deleted?.size) {
        addResyncOverlay(frame, cellId, () =>
          handleResync(cellId, cardId),
        );
      }
      // Each newly-inserted child gets its own chevron so the user can
      // recursively explore the dependency graph from any node.
      for (const child of inserted) {
        addChevronOverlay(frame, child.cellId, (anchor) =>
          setExpandMenuTarget({ cellId: child.cellId, cardId: child.cardId, anchor }),
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Collapse an expanded card group; called from the minus overlay. */
  const handleCollapseGroup = useCallback(
    (cellId: string, cardId: string) => {
      const frame = iframeRef.current;
      if (!frame) return;

      // Before collapsing, detect children the user removed while expanded.
      const cached = expandCacheRef.current.get(cellId);
      if (cached) {
        const stillPresent = getGroupChildCardIds(frame, cellId);
        const nowDeleted = cached.filter((c) => !stillPresent.has(c.id)).map((c) => c.id);
        if (nowDeleted.length > 0) {
          const existing = deletedChildrenRef.current.get(cellId) ?? new Set<string>();
          nowDeleted.forEach((id) => existing.add(id));
          deletedChildrenRef.current.set(cellId, existing);
        }
      }

      collapseCardGroup(frame, cellId);
      // Switch back to chevron so the user can pick a different relation
      // type or direction for the next expansion.
      addChevronOverlay(frame, cellId, (anchor) =>
        setExpandMenuTarget({ cellId, cardId, anchor }),
      );
      if (deletedChildrenRef.current.get(cellId)?.size) {
        addResyncOverlay(frame, cellId, () => handleResync(cellId, cardId));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Backwards-compatible signature still passed around as `handleToggleGroup`
   *  so callers that ask "expand from a fresh state" keep working. New code
   *  should use the chevron overlay route which opens the ExpandMenu. */
  const handleToggleGroup = useCallback(
    (cellId: string, cardId: string, currentlyExpanded: boolean) => {
      if (currentlyExpanded) {
        handleCollapseGroup(cellId, cardId);
        return;
      }
      // Default expand falls back to "all relations" — used by the
      // resync path. Newly-inserted cells get the chevron instead so the
      // user always sees the per-relation-type picker first.
      const frame = iframeRef.current;
      if (!frame) return;
      const cached = expandCacheRef.current.get(cellId);
      if (cached) {
        doExpand(frame, cellId, cardId, cached);
        return;
      }
      api
        .get<Relation[]>(`/relations?card_id=${cardId}`)
        .then((rels) => {
          if (!iframeRef.current) return;
          const seen = new Set<string>();
          const children: ExpandChildData[] = [];
          for (const r of rels) {
            const other = r.source_id === cardId ? r.target : r.source;
            if (!other || seen.has(other.id)) continue;
            seen.add(other.id);
            const ct = fsTypesRef.current.find((tp) => tp.key === other.type);
            children.push({
              id: other.id,
              name: other.name,
              type: other.type,
              color: ct?.color || "#999",
              relationType: r.type,
            });
          }
          if (children.length === 0) {
            setSnackMsg(t("editor.noRelatedCards"));
            return;
          }
          children.sort((a, b) => {
            const sa = fsTypesRef.current.find((tp) => tp.key === a.type)?.sort_order ?? 99;
            const sb = fsTypesRef.current.find((tp) => tp.key === b.type)?.sort_order ?? 99;
            if (sa !== sb) return sa - sb;
            return a.name.localeCompare(b.name);
          });
          expandCacheRef.current.set(cellId, children);
          doExpand(iframeRef.current!, cellId, cardId, children);
        })
        .catch(() => setSnackMsg(t("editor.errors.loadRelationsFailed")));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doExpand, handleCollapseGroup],
  );

  /** Open the per-relation-type ExpandMenu for a card. Wired to the
   *  chevron overlay on every collapsed synced cell. */
  const handleChevron = useCallback(
    (cellId: string, cardId: string, anchor: { x: number; y: number }) => {
      setExpandMenuTarget({ cellId, cardId, anchor });
    },
    [],
  );

  /** User picked a relation type + direction from the ExpandMenu. Fetch
   *  matching neighbours and insert them with placement that reflects the
   *  chosen mode (Show Dependency = right, Drill-Down = below, Roll-Up =
   *  above). Skips peers that are already on the canvas to avoid
   *  duplicates. */
  const handleExpandPick = useCallback(
    async (mode: ExpandMode, entry: RelationSummaryEntry, target: ExpandMenuTarget) => {
      const frame = iframeRef.current;
      if (!frame) return;
      try {
        const params = new URLSearchParams({
          card_id: target.cardId,
          type: entry.relation_type_key,
        });
        const rels = await api.get<Relation[]>(`/relations?${params}`);
        const seen = new Set<string>();
        const children: ExpandChildData[] = [];
        for (const r of rels) {
          // Filter to the user's chosen direction so the picked menu row
          // matches what they actually see.
          const isOutgoing = r.source_id === target.cardId;
          if (entry.direction === "outgoing" && !isOutgoing) continue;
          if (entry.direction === "incoming" && isOutgoing) continue;
          const other = isOutgoing ? r.target : r.source;
          if (!other || seen.has(other.id)) continue;
          seen.add(other.id);
          const ct = fsTypesRef.current.find((tp) => tp.key === other.type);
          children.push({
            id: other.id,
            name: other.name,
            type: other.type,
            color: ct?.color || "#999",
            relationType: r.type,
          });
        }
        if (children.length === 0) {
          setSnackMsg(t("editor.noRelatedCards"));
          return;
        }
        children.sort((a, b) => a.name.localeCompare(b.name));
        const placement =
          mode === "show" ? "right" : mode === "drill_down" ? "below" : "above";
        const inserted = expandCardGroupAt(frame, target.cellId, children, placement);
        // Bind chevrons + collapse on the parent + new neighbours so the
        // user can keep exploring.
        addExpandOverlay(frame, target.cellId, true, () =>
          handleCollapseGroup(target.cellId, target.cardId),
        );
        for (const child of inserted) {
          addChevronOverlay(frame, child.cellId, (anchor) =>
            setExpandMenuTarget({ cellId: child.cellId, cardId: child.cardId, anchor }),
          );
        }
      } catch {
        setSnackMsg(t("editor.errors.loadRelationsFailed"));
      }
    },
    [t, handleCollapseGroup],
  );

  /** Clear local caches and re-fetch relations from inventory. */
  const handleResync = useCallback(
    (cellId: string, cardId: string) => {
      const frame = iframeRef.current;
      if (!frame) return;

      // Clear caches
      expandCacheRef.current.delete(cellId);
      deletedChildrenRef.current.delete(cellId);

      // Collapse first if currently expanded
      collapseCardGroup(frame, cellId);

      // Re-fetch and expand
      api
        .get<Relation[]>(`/relations?card_id=${cardId}`)
        .then((rels) => {
          if (!iframeRef.current) return;
          const seen = new Set<string>();
          const children: ExpandChildData[] = [];
          for (const r of rels) {
            const other = r.source_id === cardId ? r.target : r.source;
            if (!other || seen.has(other.id)) continue;
            seen.add(other.id);
            const ct = fsTypesRef.current.find((tp) => tp.key === other.type);
            children.push({
              id: other.id,
              name: other.name,
              type: other.type,
              color: ct?.color || "#999",
              relationType: r.type,
            });
          }
          if (children.length === 0) {
            addExpandOverlay(iframeRef.current!, cellId, false, () =>
              handleToggleGroup(cellId, cardId, false),
            );
            setSnackMsg(t("editor.noRelatedCards"));
            return;
          }
          children.sort((a, b) => {
            const sa = fsTypesRef.current.find((tp) => tp.key === a.type)?.sort_order ?? 99;
            const sb = fsTypesRef.current.find((tp) => tp.key === b.type)?.sort_order ?? 99;
            if (sa !== sb) return sa - sb;
            return a.name.localeCompare(b.name);
          });
          expandCacheRef.current.set(cellId, children);
          doExpand(iframeRef.current!, cellId, cardId, children);
          setSnackMsg(t("editor.relationsRestored"));
        })
        .catch(() => setSnackMsg(t("editor.errors.resyncFailed")));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doExpand],
  );

  /* ---------- Cell lifecycle (dedup paste + tombstone deletes) ---------- */

  const lifecycleAttachedRef = useRef(false);

  const handleDuplicate = useCallback(
    (cellId: string, sharedCardId: string, wasPending: boolean) => {
      const frame = iframeRef.current;
      if (!frame) return;
      // Defer one tick so mxGraph finishes its transaction before we mutate.
      setTimeout(() => {
        const result = dedupClonedCell(frame, cellId, wasPending);
        if (!result) return;
        if (result.mode === "regenerated") {
          setSnackMsg(t("editor.duplicate.pendingRegen"));
        } else {
          setSnackMsg(t("editor.duplicate.unlinked"));
        }
        // sharedCardId is intentionally not surfaced to the user — the snackbar
        // covers the user-facing explanation.
        void sharedCardId;
        refreshSyncPanel();
      }, 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleTombstones = useCallback((tombstones: RemovedTombstone[]) => {
    if (tombstones.length === 0) return;
    setPendingCardRemovals((prev) => {
      const next = [...prev];
      for (const t of tombstones) {
        if (t.kind !== "card") continue;
        // De-duplicate by cellId — undo + redo can fire repeated events.
        if (!next.some((existing) => existing.cellId === t.cellId)) next.push(t);
      }
      return next;
    });
    setPendingRelRemovals((prev) => {
      const next = [...prev];
      for (const t of tombstones) {
        if (t.kind !== "relation") continue;
        if (!next.some((existing) => existing.edgeCellId === t.edgeCellId)) next.push(t);
      }
      return next;
    });
  }, []);

  const attachLifecycleListenersOnce = useCallback(
    (frame: HTMLIFrameElement) => {
      if (lifecycleAttachedRef.current) return;
      lifecycleAttachedRef.current = true;
      attachCellLifecycleListeners(frame, {
        onDuplicate: handleDuplicate,
        onRemoved: handleTombstones,
      });
    },
    [handleDuplicate, handleTombstones],
  );

  /* ---------- Insert existing card(s) ---------- */
  const handleInsertCard = useCallback(
    (cards: Card[], cardTypeKeysByCardId: Map<string, CardType>) => {
      const frame = iframeRef.current;
      if (!frame || cards.length === 0) return;

      // Relink mode: rewrite the target cell instead of inserting new ones.
      // The dialog opens in mode="single" so we only ever see one card here.
      if (relinkTargetCellId) {
        const card = cards[0];
        const ct = cardTypeKeysByCardId.get(card.id);
        if (!ct) {
          setRelinkTargetCellId(null);
          return;
        }
        const ok = relinkCell(frame, relinkTargetCellId, {
          cardId: card.id,
          cardType: card.type,
          name: card.name,
          color: ct.color,
        });
        if (ok) {
          const targetCellId = relinkTargetCellId;
          addChevronOverlay(frame, targetCellId, (anchor) =>
            setExpandMenuTarget({ cellId: targetCellId, cardId: card.id, anchor }),
          );
          setSnackMsg(t("editor.linkedTo", { name: card.name }));
        } else {
          setSnackMsg(t("editor.errors.editorNotReady"));
        }
        setRelinkTargetCellId(null);
        return;
      }

      // Multi-card insert: lay them out in a grid centered on the insertion
      // point so they don't overlap. The 4-cell-wide grid mirrors LeanIX's
      // "Insert selected" behaviour for batches.
      let baseX: number;
      let baseY: number;
      if (contextInsertPosRef.current) {
        baseX = contextInsertPosRef.current.x;
        baseY = contextInsertPosRef.current.y;
        contextInsertPosRef.current = null;
      } else {
        const center = getVisibleCenter(frame);
        baseX = center ? center.x - 90 : 100;
        baseY = center ? center.y - 30 : 100;
      }

      const cols = Math.min(4, cards.length);
      const cellW = 200;
      const cellH = 80;
      let insertedCount = 0;
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const ct = cardTypeKeysByCardId.get(c.id);
        if (!ct) continue;
        const x = baseX + (i % cols) * cellW;
        const y = baseY + Math.floor(i / cols) * cellH;
        const data = buildCardCellData({
          cardId: c.id,
          cardType: c.type,
          name: c.name,
          color: ct.color,
          x,
          y,
        });
        const ok = insertCardIntoGraph(frame, data);
        if (ok) {
          const insertedCellId = data.cellId;
          const insertedCardId = c.id;
          addChevronOverlay(frame, insertedCellId, (anchor) =>
            setExpandMenuTarget({
              cellId: insertedCellId,
              cardId: insertedCardId,
              anchor,
            }),
          );
          insertedCount += 1;
        }
      }
      if (insertedCount === 0) {
        setSnackMsg(t("editor.errors.editorNotReady"));
      } else if (insertedCount === 1) {
        setSnackMsg(t("editor.inserted", { name: cards[0].name }));
      } else {
        setSnackMsg(t("editor.insertedMany", { count: insertedCount }));
      }
    },
    [handleToggleGroup, relinkTargetCellId],
  );

  /* ---------- Unlink / Convert handlers (Phase 2) ---------- */

  const handleUnlinkRequest = useCallback(
    (cellId: string) => {
      const frame = iframeRef.current;
      if (!frame) return;
      const previousId = unlinkCell(frame, cellId);
      if (previousId) {
        setSnackMsg(t("editor.unlinked"));
        refreshSyncPanel();
      }
    },
    // refreshSyncPanel is a stable useCallback; declared later in the file —
    // ESLint warns about exhaustive deps but TS would also block referencing
    // it here before its declaration line, so we capture it via closure only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  const handleRelinkRequest = useCallback((cellId: string) => {
    setRelinkTargetCellId(cellId);
    setPickerOpen(true);
  }, []);

  const handleConvertRequest = useCallback((cellId: string) => {
    const frame = iframeRef.current;
    if (!frame) return;
    const label = getCellLabel(frame, cellId);
    setConvertTargetCellId(cellId);
    setConvertPrefillName(label);
    setCreateOpen(true);
  }, []);

  /* ---------- Sync panel helpers ---------- */
  const refreshSyncPanel = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame) return;

    const { pendingCards: pfs, pendingRels: prels, syncedFS: _ } = scanDiagramItems(frame);

    setPendingFS(
      pfs.map((p) => {
        const typeInfo = fsTypesRef.current.find((t) => t.key === p.type);
        return {
          cellId: p.cellId,
          type: p.type,
          typeLabel: rml(typeInfo?.key ?? "", typeInfo?.translations, "label") || p.type,
          typeColor: typeInfo?.color || "#999",
          name: p.name,
        };
      }),
    );

    setPendingRels(
      prels.map((p) => {
        const srcType = fsTypesRef.current.find((t) =>
          pfs.some((f) => f.tempId === p.sourceCardId && f.type === t.key),
        );
        return {
          edgeCellId: p.edgeCellId,
          relationType: p.relationType,
          relationLabel: p.relationLabel,
          sourceName: p.sourceName,
          targetName: p.targetName,
          sourceColor: srcType?.color || "#999",
          targetColor: "#999",
          sourceCardId: p.sourceCardId,
          targetCardId: p.targetCardId,
        };
      }),
    );
  }, []);

  /* ---------- Create new (pending) card ---------- */
  const handleCreateCard = useCallback(
    (data: { type: string; name: string; description?: string }) => {
      const frame = iframeRef.current;
      if (!frame) return;

      const typeInfo = fsTypesRef.current.find((t) => t.key === data.type);
      const color = typeInfo?.color || "#999";
      const tempId = `pending-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

      // Convert mode: replace an existing plain shape rather than create a
      // new one. Keeps the user's geometry intact so the shape they laid out
      // becomes the card.
      if (convertTargetCellId) {
        const ok = convertShapeToPendingCard(frame, convertTargetCellId, {
          tempId,
          type: data.type,
          name: data.name,
          color,
        });
        if (ok) {
          setSnackMsg(t("editor.convertedPending", { name: data.name }));
          refreshSyncPanel();
        }
        setConvertTargetCellId(null);
        setConvertPrefillName("");
        setCreateOpen(false);
        return;
      }

      let x: number, y: number;
      if (contextInsertPosRef.current) {
        ({ x, y } = contextInsertPosRef.current);
        contextInsertPosRef.current = null;
      } else {
        const center = getVisibleCenter(frame);
        x = center ? center.x - 90 : 100;
        y = center ? center.y - 30 : 100;
      }

      const cellId = insertPendingCard(frame, {
        tempId,
        type: data.type,
        name: data.name,
        color,
        x,
        y,
      });

      if (cellId) {
        setSnackMsg(t("editor.addedPending", { name: data.name }));
        refreshSyncPanel();
      }
      setCreateOpen(false);
    },
    [refreshSyncPanel, convertTargetCellId],
  );

  /* ---------- Relation picker result ---------- */
  const handleRelationPicked = useCallback(
    (relType: RelationType, direction: "as-is" | "reversed") => {
      const frame = iframeRef.current;
      const ep = pendingEdgeRef.current;
      if (!frame || !ep) return;

      const color = direction === "as-is" ? ep.sourceColor : ep.targetColor;

      stampEdgeAsRelation(frame, ep.edgeCellId, relType.key, relType.label, color, true);

      setRelPickerOpen(false);
      pendingEdgeRef.current = null;
      setSnackMsg(t("editor.relationAddedPending", { label: relType.label }));
      refreshSyncPanel();
    },
    [refreshSyncPanel],
  );

  const handleRelationCancelled = useCallback(() => {
    // User cancelled — remove the edge
    const frame = iframeRef.current;
    const ep = pendingEdgeRef.current;
    if (frame && ep) {
      removeDiagramCell(frame, ep.edgeCellId);
    }
    setRelPickerOpen(false);
    pendingEdgeRef.current = null;
  }, []);

  const handleSyncFS = useCallback(
    async (cellId: string) => {
      const frame = iframeRef.current;
      if (!frame) return;
      const item = pendingCards.find((p) => p.cellId === cellId);
      if (!item) return;

      setSyncing(true);
      try {
        const scanned = scanDiagramItems(frame);
        const raw = scanned.pendingCards.find((p) => p.cellId === cellId);
        const resp = await api.post<Card>("/cards", {
          type: item.type,
          name: item.name,
        });
        markCellSynced(frame, cellId, resp.id, item.typeColor);
        // Attach chevron now that it has a real ID and the per-relation
        // expand menu can resolve its neighbours.
        addChevronOverlay(frame, cellId, (anchor) =>
          setExpandMenuTarget({ cellId, cardId: resp.id, anchor }),
        );
        // Update any pending relations that reference the old temp ID
        const tempId = raw?.tempId;
        if (tempId) {
          const { pendingRels: currentRels } = scanDiagramItems(frame);
          for (const rel of currentRels) {
            if (rel.sourceCardId === tempId || rel.targetCardId === tempId) {
              // The edge endpoints are already connected to the cell — the cell's
              // cardId attribute was just updated, so the next scan will pick
              // up the real ID. No extra action needed.
            }
          }
        }
        setSnackMsg(t("editor.pushedToInventory", { name: item.name }));
        refreshSyncPanel();
      } catch {
        setSnackMsg(t("editor.errors.createCardFailed"));
      } finally {
        setSyncing(false);
      }
    },
    [pendingCards, handleToggleGroup, refreshSyncPanel],
  );

  const handleSyncRel = useCallback(
    async (edgeCellId: string) => {
      const frame = iframeRef.current;
      if (!frame) return;

      setSyncing(true);
      try {
        // Re-scan to get fresh IDs (in case FS was just synced)
        const { pendingRels } = scanDiagramItems(frame);
        const rel = pendingRels.find((r) => r.edgeCellId === edgeCellId);
        if (!rel) return;

        // Both endpoints must have real (non-pending) IDs
        if (rel.sourceCardId.startsWith("pending-") || rel.targetCardId.startsWith("pending-")) {
          setSnackMsg(t("editor.errors.syncCardsFirst"));
          return;
        }

        const created = await api.post<Relation>("/relations", {
          type: rel.relationType,
          source_id: rel.sourceCardId,
          target_id: rel.targetCardId,
        });

        markEdgeSynced(frame, edgeCellId, "#666", created.id);
        setSnackMsg(t("editor.relationPushed", { label: rel.relationLabel }));
        refreshSyncPanel();
      } catch {
        setSnackMsg(t("editor.errors.createRelationFailed"));
      } finally {
        setSyncing(false);
      }
    },
    [refreshSyncPanel],
  );

  const handleSyncAll = useCallback(async () => {
    const frame = iframeRef.current;
    if (!frame) return;
    setSyncing(true);

    try {
      // 1. Sync all pending cards first
      const { pendingCards: pfs } = scanDiagramItems(frame);
      for (const p of pfs) {
        const typeInfo = fsTypesRef.current.find((t) => t.key === p.type);
        try {
          const resp = await api.post<Card>("/cards", {
            type: p.type,
            name: p.name,
          });
          markCellSynced(frame, p.cellId, resp.id, typeInfo?.color || "#999");
          const insertedCellId = p.cellId;
          const insertedCardId = resp.id;
          addChevronOverlay(frame, insertedCellId, (anchor) =>
            setExpandMenuTarget({
              cellId: insertedCellId,
              cardId: insertedCardId,
              anchor,
            }),
          );
        } catch {
          setSnackMsg(t("editor.errors.syncFailed", { name: p.name }));
        }
      }

      // 2. Sync all pending relations
      const { pendingRels: prels } = scanDiagramItems(frame);
      for (const r of prels) {
        if (r.sourceCardId.startsWith("pending-") || r.targetCardId.startsWith("pending-")) {
          continue; // skip if endpoints still pending
        }
        try {
          const created = await api.post<Relation>("/relations", {
            type: r.relationType,
            source_id: r.sourceCardId,
            target_id: r.targetCardId,
          });
          markEdgeSynced(frame, r.edgeCellId, "#666", created.id);
        } catch {
          setSnackMsg(t("editor.errors.syncRelationFailed", { label: r.relationLabel }));
        }
      }

      // 3. Process relation deletions (canvas edges that were removed)
      const relRemovals = pendingRelRemovals;
      for (const r of relRemovals) {
        try {
          await api.delete(`/relations/${r.relationId}`);
        } catch {
          setSnackMsg(t("editor.errors.deleteRelationFailed", { label: r.relationLabel }));
        }
      }
      if (relRemovals.length > 0) setPendingRelRemovals([]);

      // 4. Process card removals — archive only when the user opted in.
      const cardRemovals = pendingCardRemovals;
      for (const c of cardRemovals) {
        if (archiveOnSync.has(c.cellId)) {
          try {
            await api.delete(`/cards/${c.cardId}`);
          } catch {
            setSnackMsg(t("editor.errors.archiveCardFailed", { name: c.name }));
          }
        }
      }
      if (cardRemovals.length > 0) {
        setPendingCardRemovals([]);
        setArchiveOnSync(new Set());
      }

      refreshSyncPanel();
      setSnackMsg(t("editor.syncComplete"));
    } finally {
      setSyncing(false);
    }
  }, [handleToggleGroup, refreshSyncPanel, pendingRelRemovals, pendingCardRemovals, archiveOnSync]);

  const handleRemoveFS = useCallback(
    (cellId: string) => {
      const frame = iframeRef.current;
      if (frame) removeDiagramCell(frame, cellId);
      refreshSyncPanel();
    },
    [refreshSyncPanel],
  );

  const handleRemoveRel = useCallback(
    (edgeCellId: string) => {
      const frame = iframeRef.current;
      if (frame) removeDiagramCell(frame, edgeCellId);
      refreshSyncPanel();
    },
    [refreshSyncPanel],
  );

  /** Discard a tombstoned card removal (keeps the card in inventory). */
  const handleDiscardCardRemoval = useCallback((cellId: string) => {
    setPendingCardRemovals((prev) => prev.filter((c) => c.cellId !== cellId));
    setArchiveOnSync((prev) => {
      if (!prev.has(cellId)) return prev;
      const next = new Set(prev);
      next.delete(cellId);
      return next;
    });
  }, []);

  /** Discard a tombstoned relation removal (keeps the relation in inventory). */
  const handleDiscardRelRemoval = useCallback((edgeCellId: string) => {
    setPendingRelRemovals((prev) => prev.filter((r) => r.edgeCellId !== edgeCellId));
  }, []);

  /** Toggle whether a tombstoned card removal should also archive the card. */
  const handleToggleArchive = useCallback((cellId: string) => {
    setArchiveOnSync((prev) => {
      const next = new Set(prev);
      if (next.has(cellId)) next.delete(cellId);
      else next.add(cellId);
      return next;
    });
  }, []);

  /** Sync a single relation deletion immediately. */
  const handleSyncRelRemoval = useCallback(
    async (edgeCellId: string) => {
      const target = pendingRelRemovals.find((r) => r.edgeCellId === edgeCellId);
      if (!target) return;
      setSyncing(true);
      try {
        await api.delete(`/relations/${target.relationId}`);
        setPendingRelRemovals((prev) => prev.filter((r) => r.edgeCellId !== edgeCellId));
        setSnackMsg(t("editor.relationDeleted", { label: target.relationLabel }));
      } catch {
        setSnackMsg(t("editor.errors.deleteRelationFailed", { label: target.relationLabel }));
      } finally {
        setSyncing(false);
      }
    },
    [pendingRelRemovals, t],
  );

  /** Sync a single card removal immediately (archive if opted in). */
  const handleSyncCardRemoval = useCallback(
    async (cellId: string) => {
      const target = pendingCardRemovals.find((c) => c.cellId === cellId);
      if (!target) return;
      setSyncing(true);
      try {
        if (archiveOnSync.has(cellId)) {
          await api.delete(`/cards/${target.cardId}`);
          setSnackMsg(t("editor.cardArchived", { name: target.name }));
        } else {
          setSnackMsg(t("editor.removedFromDiagram", { name: target.name }));
        }
        setPendingCardRemovals((prev) => prev.filter((c) => c.cellId !== cellId));
        setArchiveOnSync((prev) => {
          if (!prev.has(cellId)) return prev;
          const next = new Set(prev);
          next.delete(cellId);
          return next;
        });
      } catch {
        setSnackMsg(t("editor.errors.archiveCardFailed", { name: target.name }));
      } finally {
        setSyncing(false);
      }
    },
    [pendingCardRemovals, archiveOnSync, t],
  );

  const handleCheckUpdates = useCallback(async () => {
    const frame = iframeRef.current;
    if (!frame) return;
    setCheckingUpdates(true);

    try {
      const { syncedFS } = scanDiagramItems(frame);
      const stale: StaleItem[] = [];

      for (const item of syncedFS) {
        try {
          const card = await api.get<Card>(`/cards/${item.cardId}`);
          if (card.name !== item.name) {
            const typeInfo = fsTypesRef.current.find((t) => t.key === item.type);
            stale.push({
              cellId: item.cellId,
              cardId: item.cardId,
              diagramName: item.name,
              inventoryName: card.name,
              typeColor: typeInfo?.color || "#999",
            });
          }
        } catch {
          // Card may have been deleted — skip
        }
      }

      setStaleItems(stale);
      if (stale.length === 0) setSnackMsg(t("editor.allUpToDate"));
    } finally {
      setCheckingUpdates(false);
    }
  }, []);

  const handleAcceptStale = useCallback(
    (cellId: string) => {
      const frame = iframeRef.current;
      const item = staleItems.find((s) => s.cellId === cellId);
      if (!frame || !item) return;
      updateCellLabel(frame, cellId, item.inventoryName);
      setStaleItems((prev) => prev.filter((s) => s.cellId !== cellId));
      setSnackMsg(t("editor.updatedTo", { name: item.inventoryName }));
    },
    [staleItems],
  );

  /* ---------- PostMessage handler ---------- */
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      let msg: DrawIOMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      switch (msg.event) {
        case "init":
          postToDrawIO({
            action: "load",
            xml: diagram?.data?.xml || EMPTY_DIAGRAM,
            autosave: 0,
          });
          // Poll for Draw.loadPlugin instead of a hardcoded delay — behind
          // Cloudflare (or slow networks) the iframe may need more than 300 ms.
          (function tryBootstrap(attempt: number) {
            const frame = iframeRef.current;
            if (!frame) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const win = frame.contentWindow as any;
            if (win?.Draw?.loadPlugin) {
              bootstrapDrawIO(frame);
              setTimeout(() => {
                if (iframeRef.current) {
                  refreshCardOverlays(
                    iframeRef.current,
                    handleCollapseGroup,
                    handleChevron,
                  );
                  attachLifecycleListenersOnce(iframeRef.current);
                }
              }, 200);
            } else if (attempt < 50) {
              setTimeout(() => tryBootstrap(attempt + 1), 200);
            }
          })(0);
          break;

        case "save":
          if (msg.xml) {
            pendingSaveXmlRef.current = msg.xml;
            postToDrawIO({ action: "export", format: "svg", spinKey: "saving" });
            postToDrawIO({ action: "status", messageKey: "allChangesSaved", modified: false });
          }
          break;

        case "export":
          if (pendingSaveXmlRef.current) {
            const xml = pendingSaveXmlRef.current;
            pendingSaveXmlRef.current = null;
            saveDiagram(xml, msg.data);
          }
          break;

        case "exit":
          if (msg.modified && msg.xml) {
            saveDiagram(msg.xml).then(() => navigate(`/diagrams/${id}`));
          } else {
            navigate(`/diagrams/${id}`);
          }
          break;

        case "insertCard":
          contextInsertPosRef.current = { x: msg.x ?? 100, y: msg.y ?? 100 };
          setPickerOpen(true);
          break;

        case "createCard":
          contextInsertPosRef.current = { x: msg.x ?? 100, y: msg.y ?? 100 };
          setCreateOpen(true);
          break;

        case "cardClicked":
          if (msg.cardId) setSelectedCardId(msg.cardId);
          break;

        case "edgeConnected":
          if (msg.edgeCellId && msg.sourceType && msg.targetType) {
            pendingEdgeRef.current = {
              edgeCellId: msg.edgeCellId,
              sourceType: msg.sourceType,
              targetType: msg.targetType,
              sourceName: msg.sourceName || "?",
              targetName: msg.targetName || "?",
              sourceColor: msg.sourceColor || "#999",
              targetColor: msg.targetColor || "#999",
            };
            setRelPickerOpen(true);
          }
          break;

        case "unlinkCell":
          if (msg.cellId) handleUnlinkRequest(msg.cellId);
          break;

        case "relinkCell":
          if (msg.cellId) handleRelinkRequest(msg.cellId);
          break;

        case "convertCell":
          if (msg.cellId) handleConvertRequest(msg.cellId);
          break;

        default:
          break;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [
    diagram,
    postToDrawIO,
    saveDiagram,
    navigate,
    handleToggleGroup,
    handleUnlinkRequest,
    handleRelinkRequest,
    handleConvertRequest,
  ]);

  // Refresh sync panel counts whenever it opens
  useEffect(() => {
    if (syncOpen) refreshSyncPanel();
  }, [syncOpen, refreshSyncPanel]);

  /* ---------- Derived ---------- */
  const totalPending =
    pendingCards.length + pendingRels.length + pendingCardRemovals.length + pendingRelRemovals.length;

  /* ---------- Warn on unload when there are unsynced changes ---------- */
  useEffect(() => {
    if (totalPending === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the message but still display a generic
      // confirmation dialog when returnValue is set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [totalPending]);

  /* ---------- Local autosave of the in-flight XML ---------- */
  useEffect(() => {
    if (!id) return;
    const intervalId = window.setInterval(() => {
      const frame = iframeRef.current;
      if (!frame) return;
      // Pull current XML from DrawIO via its event-driven export — but for a
      // lightweight autosave we just read the serialised model directly via
      // mxGraph's codec. This avoids round-tripping through postMessage.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = frame.contentWindow as any;
        if (!win?.__turboGraph || !win.mxUtils || !win.mxCodec) return;
        const enc = new win.mxCodec();
        const node = enc.encode(win.__turboGraph.getModel());
        const xml = win.mxUtils.getXml(node);
        if (!xml) return;
        const draft = { xml, savedAt: new Date().toISOString() };
        localStorage.setItem(`turbo-ea-diagram-draft-${id}`, JSON.stringify(draft));
      } catch {
        // Editor not ready — try next tick
      }
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [id]);

  /* ---------- Phase 5 — apply view perspective to the canvas ---------- */

  /** Snapshot the synced card cells so we know which ids to fetch + recolor. */
  const collectCanvasCards = useCallback(():
    | { ids: string[]; types: Set<string> }
    | null => {
    const frame = iframeRef.current;
    if (!frame) return null;
    const { syncedFS } = scanDiagramItems(frame);
    return {
      ids: syncedFS.map((c) => c.cardId),
      types: new Set(syncedFS.map((c) => c.type)),
    };
  }, []);

  /** Recompute and apply the active view to the canvas. Pulls a batch
   *  card payload via /cards?ids=... so a single round-trip recolors
   *  every cell. */
  const applyView = useCallback(async () => {
    const frame = iframeRef.current;
    if (!frame) return;
    const snapshot = collectCanvasCards();
    if (!snapshot) return;
    setActiveTypeKeys(Array.from(snapshot.types));

    if (view.kind === "card_type") {
      // Reset to per-type colours, then drop the legend.
      const colorByType = new Map(
        fsTypesRef.current.map((tp) => [tp.key, tp.color] as const),
      );
      const touched = resetViewColors(frame, colorByType, "#999");
      setViewLegendEntries([]);
      setViewAppliedCount(touched);
      return;
    }

    if (snapshot.ids.length === 0) {
      setViewLegendEntries(Array.from(buildColorMap(view, fsTypesRef.current).values()));
      setViewAppliedCount(0);
      return;
    }

    try {
      const params = new URLSearchParams({ ids: snapshot.ids.join(",") });
      const resp = await api.get<{ items: Card[] }>(`/cards?${params.toString()}`);
      const cardById = new Map(resp.items.map((c) => [c.id, c] as const));
      const colorMap = buildColorMap(view, fsTypesRef.current);
      const colorByCardId = new Map<string, string>();
      let coverable = 0;
      for (const id of snapshot.ids) {
        const c = cardById.get(id);
        if (!c) continue;
        const value = extractCardValue(view, c);
        if (value == null) continue;
        const entry = colorMap.get(value);
        if (!entry) continue;
        colorByCardId.set(id, entry.color);
        coverable += 1;
      }
      const touched = applyViewToGraph(frame, colorByCardId, "#cbd5e1");
      setViewLegendEntries(Array.from(colorMap.values()));
      // Show how many cells the user can see colored vs total — helps debug
      // when a field isn't populated on most cards.
      setViewAppliedCount(coverable > 0 ? coverable : touched);
    } catch {
      setSnackMsg(t("editor.errors.applyViewFailed"));
    }
  }, [view, collectCanvasCards, t]);

  // Re-apply the view whenever the user picks a new perspective or the
  // diagram object changes (xml loaded / saved). Synced-cell additions
  // also trigger re-application via syncOpen / refreshSyncPanel hooks.
  useEffect(() => {
    if (!diagram) return;
    void applyView();
  }, [diagram, view, applyView]);

  /* ---------- Restore banner: replace the XML with the locally-saved draft ---------- */
  const acceptRestore = useCallback(() => {
    if (!restoreBanner) return;
    postToDrawIO({ action: "load", xml: restoreBanner.xml, autosave: 0 });
    setRestoreBanner(null);
    setSnackMsg(t("editor.restored"));
  }, [restoreBanner, postToDrawIO, t]);

  const dismissRestore = useCallback(() => {
    if (id) localStorage.removeItem(`turbo-ea-diagram-draft-${id}`);
    setRestoreBanner(null);
  }, [id]);

  /* ---------- Render ---------- */
  if (!canManage) {
    return <Navigate to={`/diagrams/${id ?? ""}`} replace />;
  }
  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!diagram) return <Typography color="error">{t("editor.notFound")}</Typography>;

  const iframeSrc = `${DRAWIO_BASE_URL}?${DRAWIO_URL_PARAMS}`;

  return (
    <Box
      sx={{
        // Dynamic viewport height (Safari 15.4+, Chrome, Firefox); falls back
        // to `vh` on older browsers via @supports. `100vh` on iPad Safari
        // returns the larger layout-viewport size while the URL bar is
        // visible, so the editor extended past the visible area and the
        // toolbar drifted out of reach. `dvh` tracks the actual visible
        // viewport, which keeps the toolbar inside it.
        height: "calc(100vh - 64px)",
        "@supports (height: 100dvh)": {
          height: "calc(100dvh - 64px)",
        },
        m: -3,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Toolbar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          minHeight: 48,
        }}
      >
        <IconButton size="small" onClick={() => navigate(`/diagrams/${id}`)}>
          <MaterialSymbol icon="arrow_back" size={20} />
        </IconButton>
        <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ flex: 1 }}>
          {diagram.name}
        </Typography>
        {saving && <CircularProgress size={16} sx={{ ml: 1 }} />}

        {/* View perspective dropdown (Phase 5) */}
        <ViewSelector
          activeTypeKeys={activeTypeKeys}
          types={fsTypes}
          current={view}
          onChange={setView}
        />

        {/* Sync button — louder when there are unsynced changes so users
            don't accidentally walk away with pending work. */}
        <Tooltip
          title={
            totalPending > 0
              ? t("editor.toolbar.syncTooltipPending", { count: totalPending })
              : t("editor.toolbar.syncTooltip")
          }
        >
          <Button
            size="small"
            variant={totalPending > 0 ? "contained" : "outlined"}
            color={totalPending > 0 ? "warning" : "inherit"}
            startIcon={
              <MaterialSymbol
                icon={totalPending > 0 ? "warning" : "sync"}
                size={18}
              />
            }
            onClick={() => setSyncOpen(true)}
            sx={{
              textTransform: "none",
              minWidth: 0,
              px: 1.5,
              py: 0.25,
              fontSize: "0.8rem",
              fontWeight: totalPending > 0 ? 700 : 500,
              animation:
                totalPending > 0 ? "turboea-pulse 1.6s ease-in-out infinite" : "none",
              "@keyframes turboea-pulse": {
                "0%,100%": { boxShadow: "0 0 0 0 rgba(237,108,2,0.5)" },
                "50%": { boxShadow: "0 0 0 6px rgba(237,108,2,0)" },
              },
            }}
          >
            {totalPending > 0
              ? t("editor.toolbar.unsyncedCount", { count: totalPending })
              : t("editor.toolbar.sync")}
          </Button>
        </Tooltip>
      </Box>

      {restoreBanner && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 2,
            py: 1,
            bgcolor: "warning.light",
            color: "warning.contrastText",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <MaterialSymbol icon="history" size={20} />
          <Typography variant="body2" sx={{ flex: 1 }}>
            {t("editor.restore.banner", {
              when: new Date(restoreBanner.savedAt).toLocaleString(),
            })}
          </Typography>
          <Button size="small" variant="contained" onClick={acceptRestore}>
            {t("editor.restore.accept")}
          </Button>
          <Button size="small" onClick={dismissRestore}>
            {t("editor.restore.discard")}
          </Button>
        </Box>
      )}

      {/* DrawIO canvas */}
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Box sx={{ flex: 1, position: "relative" }}>
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
            title={t("editor.title")}
          />
          {view.kind !== "card_type" && (
            <DiagramViewLegend
              title={
                view.kind === "approval_status"
                  ? t("viewSelector.approvalStatus")
                  : (() => {
                      const tp = fsTypes.find((x) => x.key === view.type_key);
                      const f = (tp?.fields_schema ?? [])
                        .flatMap((s) => s.fields ?? [])
                        .find((x) => x.key === view.field_key);
                      return tp && f ? `${tp.label} · ${f.label}` : t("viewSelector.cardType");
                    })()
              }
              entries={viewLegendEntries}
              appliedCount={viewAppliedCount}
              onReset={() => setView({ kind: "card_type" })}
            />
          )}
        </Box>
      </Box>

      {/* Dialogs */}
      <InsertCardsDialog
        open={pickerOpen}
        // Change Linked Card / Link to Existing Card open this dialog with a
        // relink target set — pick a single card and apply it immediately.
        mode={relinkTargetCellId ? "single" : "multi"}
        onClose={() => {
          setPickerOpen(false);
          contextInsertPosRef.current = null;
          setRelinkTargetCellId(null);
        }}
        onInsert={handleInsertCard}
      />

      <CreateOnDiagramDialog
        open={createOpen}
        types={fsTypes}
        prefillName={convertPrefillName}
        onClose={() => {
          setCreateOpen(false);
          contextInsertPosRef.current = null;
          setConvertTargetCellId(null);
          setConvertPrefillName("");
        }}
        onCreate={handleCreateCard}
      />

      <RelationPickerDialog
        open={relPickerOpen}
        endpoints={pendingEdgeRef.current}
        relationTypes={relationTypes}
        onClose={handleRelationCancelled}
        onSelect={handleRelationPicked}
      />

      <DiagramSyncPanel
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        pendingCards={pendingCards}
        pendingRels={pendingRels}
        pendingCardRemovals={pendingCardRemovals}
        pendingRelRemovals={pendingRelRemovals}
        archiveOnSync={archiveOnSync}
        staleItems={staleItems}
        syncing={syncing}
        onSyncAll={handleSyncAll}
        onSyncFS={handleSyncFS}
        onSyncRel={handleSyncRel}
        onRemoveFS={handleRemoveFS}
        onRemoveRel={handleRemoveRel}
        onSyncCardRemoval={handleSyncCardRemoval}
        onSyncRelRemoval={handleSyncRelRemoval}
        onDiscardCardRemoval={handleDiscardCardRemoval}
        onDiscardRelRemoval={handleDiscardRelRemoval}
        onToggleArchive={handleToggleArchive}
        onAcceptStale={handleAcceptStale}
        onCheckUpdates={handleCheckUpdates}
        checkingUpdates={checkingUpdates}
      />

      <CardDetailSidePanel
        cardId={selectedCardId}
        open={!!selectedCardId}
        onClose={() => setSelectedCardId(null)}
      />

      <ExpandMenu
        target={expandMenuTarget}
        onClose={() => setExpandMenuTarget(null)}
        onPick={handleExpandPick}
      />

      <Snackbar
        open={!!snackMsg}
        autoHideDuration={3000}
        onClose={() => setSnackMsg("")}
        message={snackMsg}
      />
    </Box>
  );
}
