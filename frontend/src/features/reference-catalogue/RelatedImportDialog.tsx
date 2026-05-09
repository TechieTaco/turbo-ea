import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import Collapse from "@mui/material/Collapse";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import type {
  BundleImportRequest,
  BundleImportResult,
  CatalogueKindConfig,
  CatalogueNode,
  RelatedItem,
  RelatedPayload,
} from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The catalogue the user started from. */
  primaryConfig: CatalogueKindConfig;
  /** The nodes selected in the primary catalogue (already filtered against
   *  existing cards by the browser — no green-tick rows reach here). */
  primaryNodes: CatalogueNode[];
  /** BCP-47 locale to pass through. */
  locale: string;
}

interface SectionState {
  /** Section is expanded (visible body). Sections with > AUTO_COLLAPSE_AT
   *  items start collapsed by default to keep the dialog scannable. */
  expanded: boolean;
  /** Set of ticked ids in this section. Existing-card rows are never in
   *  this set — they're rendered with a disabled checkbox. */
  ticked: Set<string>;
}

const AUTO_COLLAPSE_AT = 12;

/** A 2-step dialog: opens with a loading spinner while we fetch related
 *  items, then renders three sections (the user's primary selection +
 *  related capabilities + related processes + related value streams).
 *  All cross-catalogue checkboxes start ticked. On confirm a single
 *  ``POST /reference-catalogue/import-bundle`` runs the three imports
 *  in dependency order. */
export default function RelatedImportDialog({
  open,
  onClose,
  primaryConfig,
  primaryNodes,
  locale,
}: Props) {
  const { t } = useTranslation(["cards", "common"]);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [related, setRelated] = useState<RelatedPayload | null>(null);

  const [sections, setSections] = useState<{
    capabilities: SectionState;
    processes: SectionState;
    value_streams: SectionState;
  }>({
    capabilities: { expanded: true, ticked: new Set() },
    processes: { expanded: true, ticked: new Set() },
    value_streams: { expanded: true, ticked: new Set() },
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<BundleImportResult | null>(null);

  // Fetch related on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setResult(null);
    setSubmitError(null);
    const body: Record<string, unknown> = { locale };
    body[primaryConfig.payloadKey] = primaryNodes.map((n) => n.id);
    api
      .post<RelatedPayload>("/reference-catalogue/related", body)
      .then((data) => {
        if (cancelled) return;
        setRelated(data);
        // All ticked by default. Existing rows aren't tickable so we skip
        // them when seeding the initial set.
        const tickAll = (items: RelatedItem[]): Set<string> =>
          new Set(items.filter((i) => !i.existing_card_id).map((i) => i.id));
        setSections({
          capabilities: {
            expanded: data.capabilities.length <= AUTO_COLLAPSE_AT,
            ticked: tickAll(data.capabilities),
          },
          processes: {
            expanded: data.processes.length <= AUTO_COLLAPSE_AT,
            ticked: tickAll(data.processes),
          },
          value_streams: {
            expanded: data.value_streams.length <= AUTO_COLLAPSE_AT,
            ticked: tickAll(data.value_streams),
          },
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(
          (e as { detail?: string; message?: string })?.detail ||
            (e as { message?: string })?.message ||
            t("cards:referenceCatalogue.relatedLoadFailed"),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, locale, primaryConfig.payloadKey, primaryNodes, t]);

  const toggleRow = (
    section: "capabilities" | "processes" | "value_streams",
    id: string,
  ) => {
    setSections((prev) => {
      const next = new Set(prev[section].ticked);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [section]: { ...prev[section], ticked: next } };
    });
  };

  const tickAllInSection = (
    section: "capabilities" | "processes" | "value_streams",
    on: boolean,
  ) => {
    setSections((prev) => {
      const items = related?.[section] ?? [];
      const ticked = on
        ? new Set(items.filter((i) => !i.existing_card_id).map((i) => i.id))
        : new Set<string>();
      return { ...prev, [section]: { ...prev[section], ticked } };
    });
  };

  const toggleExpand = (
    section: "capabilities" | "processes" | "value_streams",
  ) => {
    setSections((prev) => ({
      ...prev,
      [section]: { ...prev[section], expanded: !prev[section].expanded },
    }));
  };

  const totals = useMemo(() => {
    const primaryCount = primaryNodes.length;
    const cross = sections.capabilities.ticked.size + sections.processes.ticked.size +
      sections.value_streams.ticked.size;
    return { primaryCount, crossCount: cross, total: primaryCount + cross };
  }, [primaryNodes, sections]);

  const handleConfirm = async () => {
    if (!related) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const req: BundleImportRequest = {
        capability_ids: [],
        process_ids: [],
        value_stream_ids: [],
        locale,
      };
      // Primary selection
      const primaryKey =
        primaryConfig.payloadKey === "capabilities"
          ? "capability_ids"
          : primaryConfig.payloadKey === "processes"
          ? "process_ids"
          : "value_stream_ids";
      req[primaryKey] = primaryNodes.map((n) => n.id);
      // Cross-catalogue ticks (skip the section that matches the primary,
      // which is empty anyway because the related endpoint never echoes
      // primary ids back).
      req.capability_ids = [
        ...req.capability_ids,
        ...Array.from(sections.capabilities.ticked),
      ];
      req.process_ids = [
        ...req.process_ids,
        ...Array.from(sections.processes.ticked),
      ];
      req.value_stream_ids = [
        ...req.value_stream_ids,
        ...Array.from(sections.value_streams.ticked),
      ];
      const r = await api.post<BundleImportResult>(
        "/reference-catalogue/import-bundle",
        req,
      );
      setResult(r);
    } catch (e: unknown) {
      setSubmitError(
        (e as { detail?: string; message?: string })?.detail ||
          (e as { message?: string })?.message ||
          "Import failed",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    if (submitting) return;
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        {result
          ? t("cards:referenceCatalogue.importDoneTitle")
          : t("cards:referenceCatalogue.relatedDialogTitle")}
        <IconButton
          aria-label="close"
          onClick={close}
          sx={{ position: "absolute", right: 8, top: 8 }}
          disabled={submitting}
        >
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress />
          </Box>
        ) : loadError ? (
          <Alert severity="error">{loadError}</Alert>
        ) : result ? (
          <>
            <Alert severity="success" sx={{ mb: 2 }}>
              {t("cards:referenceCatalogue.bundleDoneBody", {
                created:
                  result.capabilities.created.length +
                  result.processes.created.length +
                  result.value_streams.created.length,
                skipped:
                  result.capabilities.skipped.length +
                  result.processes.skipped.length +
                  result.value_streams.skipped.length,
              })}
            </Alert>
            {result.total_auto_relations > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("cards:referenceCatalogue.bundleAutoRelations", {
                  count: result.total_auto_relations,
                })}
              </Typography>
            )}
            <Button
              size="small"
              onClick={() =>
                navigate(`/inventory?type=${primaryConfig.inventoryCardType}`)
              }
            >
              {t("cards:referenceCatalogue.openInventory")}
            </Button>
          </>
        ) : (
          related && (
            <>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {t("cards:referenceCatalogue.relatedDialogBody", {
                  count: totals.primaryCount,
                })}
              </Typography>

              {/* Primary section — locked, just shows what they chose */}
              <Section
                title={t(
                  `cards:referenceCatalogue.primarySectionTitle_${primaryConfig.kind}`,
                  { count: primaryNodes.length },
                )}
                items={primaryNodes.map((n) => ({
                  id: n.id,
                  name: n.name,
                  level: n.level,
                  parent_id: n.parent_id,
                  existing_card_id: null,
                }))}
                ticked={new Set(primaryNodes.map((n) => n.id))}
                disabled
                expanded
                levelLabel={primaryConfig.levelLabel}
              />
              <Divider sx={{ my: 2 }} />

              {/* Three cross-catalogue sections, hiding the one that matches
                  the primary kind (no related items would appear there
                  anyway). */}
              {(["capabilities", "processes", "value_streams"] as const)
                .filter((k) => k !== primaryConfig.payloadKey)
                .map((k) => (
                  <Section
                    key={k}
                    title={t(`cards:referenceCatalogue.related_${k}`, {
                      count: related[k].length,
                    })}
                    items={related[k]}
                    ticked={sections[k].ticked}
                    expanded={sections[k].expanded}
                    onToggleRow={(id) => toggleRow(k, id)}
                    onTickAll={(on) => tickAllInSection(k, on)}
                    onToggleExpand={() => toggleExpand(k)}
                    levelLabel={
                      k === "value_streams"
                        ? (lvl) => (lvl === 1 ? "Stream" : "Stage")
                        : (lvl) => `L${lvl}`
                    }
                  />
                ))}

              {submitError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {submitError}
                </Alert>
              )}
            </>
          )
        )}
      </DialogContent>

      <DialogActions>
        {result ? (
          <Button onClick={close}>{t("common:actions.close")}</Button>
        ) : (
          <>
            <Button onClick={close} disabled={submitting}>
              {t("common:actions.cancel")}
            </Button>
            <Button
              variant="contained"
              color="primary"
              onClick={handleConfirm}
              disabled={loading || !!loadError || submitting || totals.total === 0}
              startIcon={
                submitting ? <CircularProgress size={14} color="inherit" /> : null
              }
            >
              {t("cards:referenceCatalogue.bundleConfirmCount", {
                count: totals.total,
              })}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

interface SectionProps {
  title: string;
  items: RelatedItem[];
  ticked: Set<string>;
  expanded: boolean;
  /** Whole section is locked — used for the primary selection. */
  disabled?: boolean;
  onToggleRow?: (id: string) => void;
  onTickAll?: (on: boolean) => void;
  onToggleExpand?: () => void;
  levelLabel: (level: number) => string;
}

function Section({
  title,
  items,
  ticked,
  expanded,
  disabled = false,
  onToggleRow,
  onTickAll,
  onToggleExpand,
  levelLabel,
}: SectionProps) {
  const { t } = useTranslation(["cards"]);
  if (items.length === 0) {
    return (
      <Box sx={{ mb: 1 }}>
        <Typography variant="overline" color="text.secondary">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ pl: 0.5 }}>
          {t("cards:referenceCatalogue.relatedSectionEmpty")}
        </Typography>
      </Box>
    );
  }
  const tickedCount = items.filter((i) => ticked.has(i.id)).length;
  const tickableCount = items.filter((i) => !i.existing_card_id).length;
  const allTicked = tickedCount === tickableCount && tickableCount > 0;
  const someTicked = tickedCount > 0 && tickedCount < tickableCount;

  return (
    <Box sx={{ mb: 1 }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ cursor: onToggleExpand ? "pointer" : "default", py: 0.5 }}
        onClick={() => onToggleExpand?.()}
      >
        {onToggleExpand && (
          <MaterialSymbol
            icon={expanded ? "expand_less" : "expand_more"}
            size={20}
          />
        )}
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {title}
        </Typography>
        {!disabled && onTickAll && tickableCount > 0 && (
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onTickAll(!allTicked);
            }}
          >
            {allTicked
              ? t("cards:referenceCatalogue.untickAll")
              : t("cards:referenceCatalogue.tickAll")}
          </Button>
        )}
      </Stack>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Stack
          spacing={0.5}
          sx={{ pl: 0.5, mt: 0.5, maxHeight: 320, overflowY: "auto" }}
        >
          {items.map((item) => {
            const isExisting = !!item.existing_card_id;
            const checked = isExisting || ticked.has(item.id);
            return (
              <Stack
                key={item.id}
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ minHeight: 32 }}
              >
                {isExisting ? (
                  <Tooltip
                    title={t("cards:referenceCatalogue.alreadyExistsHint")}
                  >
                    <span style={{ display: "inline-flex", padding: 4 }}>
                      <MaterialSymbol
                        icon="check_circle"
                        size={20}
                        color="#2e7d32"
                      />
                    </span>
                  </Tooltip>
                ) : (
                  <Checkbox
                    size="small"
                    checked={checked}
                    indeterminate={!checked && someTicked && false}
                    disabled={disabled || isExisting}
                    onChange={() => onToggleRow?.(item.id)}
                    sx={{ p: 0.5 }}
                  />
                )}
                <Chip
                  size="small"
                  label={item.id}
                  variant="outlined"
                  sx={{ height: 20, fontFamily: "monospace", fontSize: 11 }}
                />
                {item.level != null && (
                  <Chip
                    size="small"
                    label={levelLabel(item.level)}
                    sx={{ height: 20, fontSize: 11 }}
                  />
                )}
                <Typography
                  variant="body2"
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    color: isExisting ? "text.secondary" : "text.primary",
                  }}
                >
                  {item.name}
                </Typography>
              </Stack>
            );
          })}
        </Stack>
      </Collapse>
    </Box>
  );
}
