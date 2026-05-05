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
/*  DrawIO native lightbox viewer                                      */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _meta = import.meta as any;
const DRAWIO_BASE_URL: string =
  _meta.env?.VITE_DRAWIO_URL || "/drawio/index.html";

interface DiagramData {
  id: string;
  name: string;
  type: string;
  data: { xml?: string; thumbnail?: string };
}

const EMPTY_DIAGRAM =
  '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

/** Build the iframe src for DrawIO's stock lightbox viewer. */
function buildViewerSrc(xml: string): string {
  // lightbox=1 = DrawIO's native viewer (the same code path as the
  //              "fullscreen" popup from a static embed).
  // chrome=0   = no editor chrome — just canvas + the floating bottom
  //              toolbar (zoom in / out / reset / fit / page nav / layers).
  // nav=1      = enable page navigation in multi-page diagrams.
  // We deliberately do NOT pass `edit=` — DrawIO only renders its own
  // edit link when that param is set, and our app toolbar already has
  // a context-aware Edit button that goes to /diagrams/:id/edit.
  const params = new URLSearchParams({
    lightbox: "1",
    chrome: "0",
    nav: "1",
  });
  return `${DRAWIO_BASE_URL}?${params.toString()}#R${encodeURIComponent(xml)}`;
}

/** Attach a click listener to the lightbox graph once it's ready. */
function attachClickHandler(
  iframe: HTMLIFrameElement,
  onCardClick: (cardId: string) => void,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = iframe.contentWindow as any;
  if (!win) return;
  let attempt = 0;
  const tryAttach = () => {
    // GraphViewer instances are auto-created by lightbox mode. The first
    // .mxgraph div in the page exposes its viewer via the `graphConfig`
    // / `graph` properties on the editor / GraphViewer global.
    const editor = win.EditorUi?.windowed
      ? win.EditorUi?.instance
      : win.editor;
    const graph = editor?.graph || win.graph;
    if (graph && win.mxEvent) {
      graph.addListener(
        win.mxEvent.CLICK,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (_s: unknown, evt: any) => {
          let cell = evt.getProperty("cell");
          while (cell && !cell.value?.getAttribute?.("cardId")) {
            cell = cell.parent;
          }
          const cardId = cell?.value?.getAttribute?.("cardId");
          if (cardId) {
            onCardClick(cardId);
            evt.consume();
          }
        },
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph.getCursorForCell = (cell: any) =>
        cell?.value?.getAttribute?.("cardId") ? "pointer" : "default";
      return;
    }
    if (attempt++ < 100) setTimeout(tryAttach, 100);
  };
  tryAttach();
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DiagramViewer() {
  const { t } = useTranslation(["diagrams", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthContext();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [diagram, setDiagram] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [snackMsg, setSnackMsg] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const canEdit = useMemo(() => {
    const perms = user?.permissions;
    if (!perms) return false;
    return !!perms["*"] || !!perms["diagrams.manage"];
  }, [user?.permissions]);

  /* ---------- Load diagram ---------- */
  useEffect(() => {
    if (!id) return;
    api
      .get<DiagramData>(`/diagrams/${id}`)
      .then(setDiagram)
      .catch(() => setSnackMsg(t("editor.errors.loadFailed")))
      .finally(() => setLoading(false));
  }, [id, t]);

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

  const xml = diagram.data?.xml || EMPTY_DIAGRAM;
  const iframeSrc = buildViewerSrc(xml);

  return (
    <Box sx={{ height: "calc(100vh - 64px)", m: -3, display: "flex", flexDirection: "column" }}>
      {/* App toolbar */}
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

      {/* DrawIO native lightbox iframe */}
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Box sx={{ flex: 1, position: "relative" }}>
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            onLoad={() => {
              if (iframeRef.current) {
                attachClickHandler(iframeRef.current, (cardId) =>
                  setSelectedCardId(cardId),
                );
              }
            }}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
            title={t("viewer.title")}
          />
        </Box>
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
