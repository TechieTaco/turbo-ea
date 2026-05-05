import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { api } from "@/api/client";
import { useAuthContext } from "@/hooks/AuthContext";

/* ------------------------------------------------------------------ */
/*  DrawIO native viewer (GraphViewer) loader                          */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const win = window as any;
const VIEWER_SCRIPT = "/drawio/js/viewer.min.js";

let viewerScriptPromise: Promise<void> | null = null;

function loadViewerScript(): Promise<void> {
  if (win.GraphViewer) return Promise.resolve();
  if (viewerScriptPromise) return viewerScriptPromise;
  viewerScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${VIEWER_SCRIPT}"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      if (win.GraphViewer) resolve();
      else existing.addEventListener("load", () => resolve());
      return;
    }
    const s = document.createElement("script");
    s.src = VIEWER_SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load DrawIO viewer"));
    document.head.appendChild(s);
  });
  return viewerScriptPromise;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DiagramData {
  id: string;
  name: string;
  type: string;
  data: { xml?: string; thumbnail?: string };
}

const EMPTY_DIAGRAM =
  '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DiagramViewer() {
  const { t } = useTranslation(["diagrams", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthContext();

  const containerRef = useRef<HTMLDivElement>(null);
  const [diagram, setDiagram] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [snackMsg, setSnackMsg] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const canEdit = useMemo(() => {
    const perms = user?.permissions;
    if (!perms) return false;
    return !!perms["*"] || !!perms["diagrams.manage"];
  }, [user?.permissions]);

  /* ---------- Load diagram metadata ---------- */
  useEffect(() => {
    if (!id) return;
    api
      .get<DiagramData>(`/diagrams/${id}`)
      .then(setDiagram)
      .catch(() => setSnackMsg(t("editor.errors.loadFailed")))
      .finally(() => setLoading(false));
  }, [id, t]);

  /* ---------- Render with GraphViewer ---------- */
  useEffect(() => {
    if (!diagram) return;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let viewer: { destroy?: () => void; graph?: unknown } | null = null;

    loadViewerScript()
      .then(() => {
        if (cancelled) return;
        if (!win.GraphViewer || !win.mxUtils) {
          setSnackMsg(t("editor.errors.loadFailed"));
          return;
        }
        // Disable MathJax: DrawIO defaults to fetching it from
        // viewer.diagrams.net, which violates the app's script-src 'self'
        // CSP. EA cards never contain LaTeX, so math support is dead weight.
        if (win.Editor) win.Editor.mathDefault = false;
        if (win.Graph) win.Graph.prototype.mathEnabled = false;
        container.innerHTML = "";
        const xml = diagram.data?.xml || EMPTY_DIAGRAM;
        const xmlDoc = win.mxUtils.parseXml(xml);
        // Strip math="1" off the root if the diagram was saved with it on,
        // so the per-diagram override doesn't re-enable MathJax loading.
        const rootEl = xmlDoc.documentElement;
        if (rootEl?.hasAttribute?.("math")) rootEl.setAttribute("math", "0");

        // GraphViewer reads its config from data-mxgraph on the container,
        // or from a config object passed to the constructor. We construct
        // it directly so we can attach event listeners afterwards.
        viewer = new win.GraphViewer(container, xmlDoc.documentElement, {
          highlight: "#3572b0",
          nav: true,
          resize: true,
          lightbox: false,
          // GraphViewer's floating toolbar — space-separated item list.
          // Includes zoom in/out/reset, page navigation, layers, fullscreen.
          toolbar: "pages zoom layers lightbox",
          "toolbar-position": "top",
          "auto-fit": true,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const graph = (viewer as any)?.graph;
        if (!graph || !win.mxEvent) return;

        // GraphViewer attaches its own click handler (for hyperlink
        // navigation) that fires before mxGraph's mouseListener pipeline.
        // mxEvent.CLICK is dispatched by that handler, so listening here
        // intercepts every cell click reliably.
        graph.addListener(
          win.mxEvent.CLICK,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (_sender: unknown, evt: any) => {
            let cell = evt.getProperty("cell");
            while (cell && !cell.value?.getAttribute?.("cardId")) {
              cell = cell.parent;
            }
            const cardId = cell?.value?.getAttribute?.("cardId");
            if (cardId) {
              setSelectedCardId(cardId);
              evt.consume();
            }
          },
        );

        // Pointer cursor on cards so users see they're clickable.
        graph.getCursorForCell = (cell: unknown) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const c = cell as any;
          return c?.value?.getAttribute?.("cardId") ? "pointer" : "default";
        };
      })
      .catch(() => {
        if (!cancelled) setSnackMsg(t("editor.errors.loadFailed"));
      });

    return () => {
      cancelled = true;
      try {
        viewer?.destroy?.();
      } catch {
        // best-effort cleanup
      }
      if (container) container.innerHTML = "";
    };
  }, [diagram, t]);

  /* ---------- Render ---------- */
  if (!id) return <Navigate to="/diagrams" replace />;

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!diagram) {
    return <Typography color="error">{t("viewer.notFound")}</Typography>;
  }

  return (
    <Box sx={{ height: "calc(100vh - 64px)", m: -3, display: "flex", flexDirection: "column" }}>
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
        <IconButton size="small" onClick={() => navigate("/diagrams")}>
          <MaterialSymbol icon="arrow_back" size={20} />
        </IconButton>
        <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ flex: 1 }}>
          {diagram.name}
        </Typography>

        {canEdit && (
          <Tooltip title={t("viewer.toolbar.editTooltip")}>
            <Button
              size="small"
              variant="contained"
              startIcon={<MaterialSymbol icon="edit" size={18} />}
              onClick={() => navigate(`/diagrams/${id}/edit`)}
              sx={{ textTransform: "none", minWidth: 0, px: 1.5, py: 0.25, fontSize: "0.8rem" }}
            >
              {t("viewer.toolbar.edit")}
            </Button>
          </Tooltip>
        )}
      </Box>

      {/* GraphViewer canvas */}
      <Box sx={{ flex: 1, position: "relative", overflow: "hidden", bgcolor: "background.default" }}>
        <div
          ref={containerRef}
          style={{ width: "100%", height: "100%", overflow: "auto" }}
        />
      </Box>

      <CardDetailSidePanel
        cardId={selectedCardId}
        open={!!selectedCardId}
        onClose={() => setSelectedCardId(null)}
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
