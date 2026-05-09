import { useCallback, useEffect, useMemo, useState } from "react";
import Fab from "@mui/material/Fab";
import Fade from "@mui/material/Fade";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import { api } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import MaterialSymbol from "@/components/MaterialSymbol";
import CatalogueBrowser from "./CatalogueBrowser";
import RelatedImportDialog from "./RelatedImportDialog";
import type {
  CatalogueKindConfig,
  CatalogueNode,
  CataloguePayload,
  UpdateStatus,
} from "./types";

interface Props {
  config: CatalogueKindConfig;
}

export default function CataloguePage({ config }: Props) {
  const { t, i18n } = useTranslation(["cards", "common"]);
  const { user } = useAuth();
  const ns = config.i18nNamespace;

  const can = (key: string): boolean => {
    const p = user?.permissions;
    if (!p) return false;
    if (p["*"]) return true;
    return !!p[key];
  };
  const canCreate = can("inventory.create");
  const canManageUpdates = can("admin.metamodel");

  const [payload, setPayload] = useState<CataloguePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateFetching, setUpdateFetching] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const activeLocale = i18n.resolvedLanguage || i18n.language || "en";
  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<CataloguePayload>(
        `${config.basePath}?locale=${encodeURIComponent(activeLocale)}`,
      );
      setPayload(data);
    } catch (e: any) {
      setLoadError(e?.detail || e?.message || "Failed to load catalogue");
    } finally {
      setLoading(false);
    }
  }, [activeLocale, config.basePath]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** The data array is at a different key per catalogue (`capabilities` vs
   *  `processes` vs `value_streams`); pull whichever is present. */
  const nodes: CatalogueNode[] = useMemo(() => {
    if (!payload) return [];
    return (payload[config.payloadKey] as CatalogueNode[] | undefined) ?? [];
  }, [payload, config.payloadKey]);

  const byId = useMemo(() => {
    const m = new Map<string, CatalogueNode>();
    for (const c of nodes) m.set(c.id, c);
    return m;
  }, [nodes]);

  const selectedCaps = useMemo(
    () => Array.from(selected).map((id) => byId.get(id)).filter(Boolean) as CatalogueNode[],
    [selected, byId],
  );

  const handleCheckUpdate = async () => {
    setUpdateChecking(true);
    try {
      const status = await api.get<UpdateStatus>(`${config.basePath}/update-status`);
      setUpdateStatus(status);
      if (!status.update_available && !status.error) {
        setSnackbar(t(`cards:${ns}.updateUpToDate`));
      }
    } catch (e: any) {
      setSnackbar(e?.detail || "Update check failed");
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleFetchUpdate = async () => {
    setUpdateFetching(true);
    try {
      const r = await api.post<{ catalogue_version: string }>(
        `${config.basePath}/update-fetch`,
        {},
      );
      setSnackbar(
        t(`cards:${ns}.updateFetched`, { version: r.catalogue_version || "?" }),
      );
      setUpdateStatus(null);
      await reload();
    } catch (e: any) {
      setSnackbar(e?.detail || "Update fetch failed");
    } finally {
      setUpdateFetching(false);
    }
  };

  const handleDialogClose = useCallback(async () => {
    setImportOpen(false);
    // Refresh the catalogue so newly-imported items show their green tick.
    setSelected(new Set());
    await reload();
  }, [reload]);

  if (loading) {
    return (
      <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (loadError || !payload) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{loadError || "No data"}</Alert>
      </Box>
    );
  }

  const v = payload.version;
  const totalCount = v.node_count ?? v.process_count ?? v.value_stream_count ?? nodes.length;
  const sourceLabel =
    v.source === "remote"
      ? t(`cards:${ns}.sourceRemote`, { version: v.bundled_version })
      : t(`cards:${ns}.sourceBundled`);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems={{ xs: "flex-start", md: "center" }}
        sx={{ mb: 2 }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" component="h1">
            {t(`cards:${ns}.pageTitle`)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(`cards:${ns}.subtitle`)}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Tooltip title={sourceLabel}>
            <Chip
              size="small"
              icon={<MaterialSymbol icon={v.source === "remote" ? "cloud_done" : "inventory_2"} size={16} />}
              label={t(`cards:${ns}.versionChip`, {
                version: v.catalogue_version,
                count: totalCount,
              })}
              variant="outlined"
            />
          </Tooltip>

          {canManageUpdates && (
            <>
              <Button
                size="small"
                variant="outlined"
                onClick={handleCheckUpdate}
                disabled={updateChecking}
                startIcon={
                  updateChecking ? (
                    <CircularProgress size={14} />
                  ) : (
                    <MaterialSymbol icon="refresh" size={16} />
                  )
                }
              >
                {t(`cards:${ns}.checkUpdate`)}
              </Button>
              {updateStatus?.update_available && (
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  onClick={handleFetchUpdate}
                  disabled={updateFetching}
                  startIcon={
                    updateFetching ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <MaterialSymbol icon="cloud_download" size={16} />
                    )
                  }
                >
                  {t(`cards:${ns}.fetchUpdate`, {
                    version: updateStatus.remote?.catalogue_version || "?",
                  })}
                </Button>
              )}
            </>
          )}
        </Stack>
      </Stack>

      {updateStatus?.error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {updateStatus.error}
        </Alert>
      )}
      {updateStatus && !updateStatus.update_available && !updateStatus.error && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setUpdateStatus(null)}>
          {t(`cards:${ns}.upToDateBanner`, { version: updateStatus.active_version })}
        </Alert>
      )}

      <CatalogueBrowser
        data={nodes}
        selected={selected}
        onSelectedChange={setSelected}
        onOpenDetail={setDetailId}
        config={config}
      />

      {selected.size > 0 && (
        <Paper
          elevation={4}
          sx={{
            position: { xs: "static", sm: "sticky" },
            bottom: { sm: 16 },
            mt: 2,
            p: 1.5,
            display: "flex",
            alignItems: "center",
            gap: 2,
          }}
        >
          <Typography variant="body2" sx={{ flex: 1 }}>
            {t(`cards:${ns}.readyToImport`, { count: selected.size })}
          </Typography>
          <Button onClick={() => setSelected(new Set())}>
            {t(`cards:${ns}.clearSelection`)}
          </Button>
          <Tooltip
            title={canCreate ? "" : t(`cards:${ns}.noCreatePermission`)}
            disableHoverListener={canCreate}
          >
            <span>
              <Button
                variant="contained"
                color="primary"
                disabled={!canCreate}
                onClick={() => setImportOpen(true)}
                startIcon={<MaterialSymbol icon="add_task" size={18} />}
              >
                {t(`cards:${ns}.createSelected`, { count: selected.size })}
              </Button>
            </span>
          </Tooltip>
        </Paper>
      )}

      {/* Cross-catalogue bundle import dialog. Replaces the simple
          single-catalogue confirmation: on open it fetches related items
          from the other two catalogues and lets the user opt them in via
          checkboxes. On confirm it issues a single bundled import that
          runs the three per-catalogue imports in dependency order so
          auto-relations land correctly. */}
      <RelatedImportDialog
        open={importOpen}
        onClose={handleDialogClose}
        primaryConfig={config}
        primaryNodes={selectedCaps}
        locale={activeLocale}
      />

      {detailId && byId.get(detailId) && (
        <DetailDialog
          node={byId.get(detailId)!}
          byId={byId}
          byParent={(() => {
            const m = new Map<string | null, CatalogueNode[]>();
            for (const c of nodes) {
              const list = m.get(c.parent_id) ?? [];
              list.push(c);
              m.set(c.parent_id, list);
            }
            return m;
          })()}
          onOpen={setDetailId}
          onClose={() => setDetailId(null)}
          config={config}
        />
      )}

      <Snackbar
        open={!!snackbar}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />

      <Fade in={showScrollTop}>
        <Fab
          size="small"
          aria-label={t(`cards:${ns}.backToTop`)}
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          sx={{
            position: "fixed",
            bottom: selected.size > 0 ? 88 : 24,
            right: 24,
            zIndex: 200,
            transition: "bottom 0.2s ease",
          }}
        >
          <MaterialSymbol icon="arrow_upward" size={20} />
        </Fab>
      </Fade>
    </Box>
  );
}

interface DetailDialogProps {
  node: CatalogueNode;
  byId: Map<string, CatalogueNode>;
  byParent: Map<string | null, CatalogueNode[]>;
  onOpen: (id: string) => void;
  onClose: () => void;
  config: CatalogueKindConfig;
}

function DetailDialog({ node, byId, byParent, onOpen, onClose, config }: DetailDialogProps) {
  const { t } = useTranslation(["cards", "common"]);
  const ns = config.i18nNamespace;

  const ancestors: CatalogueNode[] = [];
  let cursor = node.parent_id;
  while (cursor) {
    const a = byId.get(cursor);
    if (!a) break;
    ancestors.unshift(a);
    cursor = a.parent_id;
  }

  const directChildren = byParent.get(node.id) ?? [];
  const descendantCount = (() => {
    let total = 0;
    const stack = [...directChildren];
    while (stack.length > 0) {
      const c = stack.pop()!;
      total += 1;
      for (const k of byParent.get(c.id) ?? []) stack.push(k);
    }
    return total;
  })();

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
          {ancestors.map((a) => (
            <Box key={a.id} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
              <Button size="small" onClick={() => onOpen(a.id)} sx={{ minWidth: 0, p: 0.25 }}>
                {a.name}
              </Button>
              <Typography color="text.secondary" sx={{ mx: 0.25 }}>/</Typography>
            </Box>
          ))}
          <Typography variant="h6" component="span">{node.name}</Typography>
        </Stack>
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }} alignItems="center">
          <Chip size="small" label={node.id} variant="outlined" />
          <Chip size="small" color="primary" label={config.levelLabel(node.level)} />
          {node.deprecated && (
            <Chip size="small" color="warning" label={t(`cards:${ns}.deprecatedLabel`)} />
          )}
          {node.existing_card_id && (
            <Chip
              size="small"
              color="success"
              icon={<MaterialSymbol icon="check_circle" size={14} />}
              label={t(`cards:${ns}.alreadyExists`)}
            />
          )}
        </Stack>

        {node.deprecated && node.deprecation_reason && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <strong>{t(`cards:${ns}.deprecatedLabel`)}.</strong> {node.deprecation_reason}
          </Alert>
        )}

        {node.description && (
          <Typography variant="body1" sx={{ mb: 2 }}>
            {node.description}
          </Typography>
        )}

        <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          {splitIndustries(node.industry).length > 0 && (
            <MetaCell label={t(`cards:${ns}.industryLabel`)}>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {splitIndustries(node.industry).map((i) => (
                  <Chip key={i} size="small" label={i} variant="outlined" />
                ))}
              </Stack>
            </MetaCell>
          )}
          {(node.aliases ?? []).length > 0 && (
            <MetaCell label={t(`cards:${ns}.aliasesLabel`)}>
              <Typography variant="body2">{(node.aliases ?? []).join(", ")}</Typography>
            </MetaCell>
          )}
          {(node.references ?? []).length > 0 && (
            <MetaCell label={t(`cards:${ns}.referencesLabel`)}>
              <Stack spacing={0.5}>
                {(node.references ?? []).map((r) => (
                  <a key={r} href={r} target="_blank" rel="noopener noreferrer">
                    {r}
                  </a>
                ))}
              </Stack>
            </MetaCell>
          )}
        </Stack>

        {/* Per-catalogue extras (e.g. framework_refs for processes,
            stage details for value streams). */}
        {config.renderDetailExtras?.(node)}

        {directChildren.length > 0 && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t(`cards:${ns}.subtreeHeader`, { count: descendantCount })}
            </Typography>
            <Box className="tcc-root">
              <div className="tcc-detail-tree">
                {directChildren.map((c) => (
                  <DetailTreeNode key={c.id} node={c} byParent={byParent} levelLabel={config.levelLabel} />
                ))}
              </div>
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 160 }}>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Box>{children}</Box>
    </Box>
  );
}

function DetailTreeNode({
  node,
  byParent,
  levelLabel,
}: {
  node: CatalogueNode;
  byParent: Map<string | null, CatalogueNode[]>;
  levelLabel: (level: number) => string;
}) {
  const kids = byParent.get(node.id) ?? [];
  return (
    <Box>
      <div className="tcc-detail-tree-row">
        <span className="tcc-cap-id">{node.id}</span>
        <span className="tcc-cap-level">{levelLabel(node.level)}</span>
        {node.deprecated && <span className="tcc-deprecated-badge">Dep.</span>}
        {node.existing_card_id && (
          <Tooltip title="Already exists as a card">
            <span className="tcc-existing-tick">
              <MaterialSymbol icon="check_circle" size={14} />
            </span>
          </Tooltip>
        )}
        <span className="tcc-tree-name">{node.name}</span>
        {node.description && <span className="tcc-tree-desc">{node.description}</span>}
      </div>
      {kids.length > 0 && (
        <div className="tcc-detail-tree-children">
          {kids.map((k) => (
            <DetailTreeNode key={k.id} node={k} byParent={byParent} levelLabel={levelLabel} />
          ))}
        </div>
      )}
    </Box>
  );
}

function splitIndustries(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(";").map((x) => x.trim()).filter(Boolean);
}
