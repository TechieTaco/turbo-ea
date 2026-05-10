import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import LinearProgress from "@mui/material/LinearProgress";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import Link from "@mui/material/Link";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/api/client";
import type {
  ArchiveImpact,
  ArchiveImpactRelatedCard,
  CardArchiveDeleteRequest,
  ChildStrategy,
} from "@/types";

const TYPED_CONFIRM_THRESHOLD = 50;
const WARNING_THRESHOLD = 10;

// Bulk archive/delete dispatches one HTTP request per card. Firing them all
// in parallel exhausts the browser's per-origin socket pool with selections
// in the thousands (Chrome surfaces this as ERR_INSUFFICIENT_RESOURCES, with
// requests failing before they even leave the tab). A small worker pool keeps
// the browser happy and the backend unhammered while still draining the queue
// quickly.
const BULK_CONCURRENCY = 5;

interface SingleProps {
  open: boolean;
  mode: "archive" | "delete";
  scope: "single";
  cardId: string;
  cardName: string;
  onClose: () => void;
  onConfirmed: () => void;
}

interface BulkProps {
  open: boolean;
  mode: "archive" | "delete";
  scope: "bulk";
  cardIds: string[];
  onClose: () => void;
  onConfirmed: () => void;
}

type Props = SingleProps | BulkProps;

interface GroupedRelations {
  key: string;
  label: string;
  cards: ArchiveImpactRelatedCard[];
}

function groupRelated(rows: ArchiveImpactRelatedCard[]): GroupedRelations[] {
  const buckets = new Map<string, GroupedRelations>();
  for (const row of rows) {
    const key = `${row.relation_type_key}::${row.direction}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.cards.push(row);
    } else {
      buckets.set(key, { key, label: row.relation_label, cards: [row] });
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export default function ArchiveDeleteDialog(props: Props) {
  const { open, mode, scope, onClose, onConfirmed } = props;
  const { t } = useTranslation(["cards", "inventory", "common"]);
  const [impact, setImpact] = useState<ArchiveImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState("");
  const [strategy, setStrategy] = useState<ChildStrategy | null>(null);
  const [tickedRelated, setTickedRelated] = useState<Set<string>>(new Set());
  const [cascadeAllRelated, setCascadeAllRelated] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
    failed: number;
  } | null>(null);

  // Reset on open/close.
  useEffect(() => {
    if (!open) {
      setImpact(null);
      setImpactError("");
      setStrategy(null);
      setTickedRelated(new Set());
      setCascadeAllRelated(false);
      setTypedName("");
      setSubmitError("");
      return;
    }
    if (scope === "single") {
      const cardId = (props as SingleProps).cardId;
      setImpactLoading(true);
      api
        .get<ArchiveImpact>(`/cards/${cardId}/archive-impact`)
        .then((data) => {
          setImpact(data);
          // If the only sensible default is `cascade` (when there's no
          // grandparent and the user expects the simplest answer), do not
          // pre-pick — force them to choose deliberately.
        })
        .catch((e: unknown) => {
          setImpactError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setImpactLoading(false));
    }
  }, [open, scope, props]);

  const groupedRelated = useMemo(
    () => (impact ? groupRelated(impact.related_cards) : []),
    [impact],
  );

  const showChildrenSection =
    scope === "bulk" || (impact && impact.child_count > 0);
  const showRelatedSection =
    scope === "single" && impact && impact.related_cards.length > 0;
  const hasGrandparent =
    scope === "single" && impact?.grandparent !== null && impact?.grandparent !== undefined;

  const tickedCount = tickedRelated.size;
  const requiresTypedConfirm =
    scope === "single" &&
    tickedCount >= TYPED_CONFIRM_THRESHOLD;
  const showLargeImpactWarning =
    scope === "single" &&
    tickedCount >= WARNING_THRESHOLD &&
    tickedCount < TYPED_CONFIRM_THRESHOLD;

  const submitDisabled =
    submitting ||
    (showChildrenSection && strategy === null) ||
    (requiresTypedConfirm &&
      scope === "single" &&
      typedName.trim() !== (props as SingleProps).cardName.trim());

  const toggleRelated = (cardId: string) => {
    setTickedRelated((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  };

  const setGroupAll = (group: GroupedRelations, ticked: boolean) => {
    setTickedRelated((prev) => {
      const next = new Set(prev);
      for (const c of group.cards) {
        if (ticked) {
          next.add(c.id);
        } else {
          next.delete(c.id);
        }
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    setSubmitError("");
    setSubmitting(true);
    setBulkProgress(null);
    try {
      const body: CardArchiveDeleteRequest = {};
      if (showChildrenSection && strategy) body.child_strategy = strategy;
      if (scope === "single" && tickedCount > 0) {
        body.related_card_ids = Array.from(tickedRelated);
      }
      if (scope === "bulk" && cascadeAllRelated) {
        body.cascade_all_related = true;
      }
      if (scope === "single") {
        const cardId = (props as SingleProps).cardId;
        if (mode === "archive") {
          await api.post(`/cards/${cardId}/archive`, body);
        } else {
          await api.delete(`/cards/${cardId}`, body);
        }
        onConfirmed();
      } else {
        const cardIds = (props as BulkProps).cardIds;
        const queue = [...cardIds];
        const failures: { id: string; error: unknown }[] = [];
        let done = 0;
        setBulkProgress({ done: 0, total: cardIds.length, failed: 0 });

        const worker = async () => {
          while (queue.length > 0) {
            const id = queue.shift();
            if (id === undefined) break;
            try {
              if (mode === "archive") {
                await api.post(`/cards/${id}/archive`, body);
              } else {
                await api.delete(`/cards/${id}`, body);
              }
            } catch (err) {
              failures.push({ id, error: err });
            }
            done += 1;
            setBulkProgress({ done, total: cardIds.length, failed: failures.length });
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(BULK_CONCURRENCY, cardIds.length) }, () => worker()),
        );

        if (failures.length === 0) {
          onConfirmed();
        } else {
          // Report partial-failure inline; keep the dialog open so the user
          // sees what didn't land instead of silently closing on success-ish.
          const sample = failures[0].error;
          const sampleMsg =
            sample instanceof ApiError
              ? sample.detail || sample.message
              : sample instanceof Error
                ? sample.message
                : String(sample);
          setSubmitError(
            t(
              mode === "archive"
                ? "inventory:massArchive.partialFailure"
                : "inventory:massDelete.partialFailure",
              {
                succeeded: cardIds.length - failures.length,
                total: cardIds.length,
                failed: failures.length,
                error: sampleMsg,
              },
            ),
          );
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setSubmitError(t("cards:detail.dialogs.children.serverError409"));
      } else {
        setSubmitError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const titleKey =
    mode === "archive"
      ? scope === "single"
        ? "cards:detail.dialogs.archive.title"
        : "inventory:massArchive.dialogTitle"
      : scope === "single"
        ? "cards:detail.dialogs.delete.title"
        : "inventory:massDelete.dialogTitle";

  const cardName = scope === "single" ? (props as SingleProps).cardName : "";
  const selectedCount = scope === "bulk" ? (props as BulkProps).cardIds.length : 1;

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {scope === "single"
          ? t(titleKey, { name: cardName })
          : t(titleKey, { count: selectedCount })}
      </DialogTitle>
      <DialogContent>
        {impactLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {!impactLoading && (
          <Stack spacing={2}>
            {impactError && <Alert severity="error">{impactError}</Alert>}

            {scope === "single" && (
              <Typography>
                <span
                  dangerouslySetInnerHTML={{
                    __html: t(
                      mode === "archive"
                        ? "cards:detail.dialogs.archive.confirm"
                        : "cards:detail.dialogs.delete.confirm",
                      { name: cardName },
                    ),
                  }}
                />
              </Typography>
            )}
            {scope === "bulk" && (
              <Typography>
                {t(
                  mode === "archive"
                    ? "inventory:massArchive.confirmMessage"
                    : "inventory:massDelete.confirmMessage",
                  { count: selectedCount },
                )}
              </Typography>
            )}

            {/* Children section */}
            {showChildrenSection && (
              <Box>
                <Divider sx={{ mb: 2 }} />
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">
                    {t("cards:detail.dialogs.children.title")}
                  </Typography>
                  {scope === "single" && impact && impact.child_count > 0 && (
                    <Chip
                      label={t("cards:detail.dialogs.children.countChip", {
                        count: impact.child_count,
                        descendants: impact.descendant_count,
                      })}
                      size="small"
                      color="warning"
                      variant="outlined"
                    />
                  )}
                </Stack>
                <FormControl>
                  <RadioGroup
                    value={strategy ?? ""}
                    onChange={(e) => setStrategy(e.target.value as ChildStrategy)}
                  >
                    <FormControlLabel
                      value="cascade"
                      control={<Radio />}
                      label={t(
                        mode === "archive"
                          ? "cards:detail.dialogs.children.cascadeArchive"
                          : "cards:detail.dialogs.children.cascadeDelete",
                      )}
                    />
                    <FormHelperText sx={{ ml: 4, mt: -1 }}>
                      {t(
                        mode === "archive"
                          ? "cards:detail.dialogs.children.cascadeHelpArchive"
                          : "cards:detail.dialogs.children.cascadeHelpDelete",
                      )}
                    </FormHelperText>
                    <FormControlLabel
                      value="disconnect"
                      control={<Radio />}
                      label={t("cards:detail.dialogs.children.disconnect")}
                    />
                    <FormHelperText sx={{ ml: 4, mt: -1 }}>
                      {t("cards:detail.dialogs.children.disconnectHelp")}
                    </FormHelperText>
                    {hasGrandparent && impact?.grandparent && (
                      <>
                        <FormControlLabel
                          value="reparent"
                          control={<Radio />}
                          label={t("cards:detail.dialogs.children.reparent", {
                            parent: impact.grandparent.name,
                          })}
                        />
                        <FormHelperText sx={{ ml: 4, mt: -1 }}>
                          {t("cards:detail.dialogs.children.reparentHelp")}
                        </FormHelperText>
                      </>
                    )}
                  </RadioGroup>
                </FormControl>
                {scope === "single" &&
                  impact &&
                  impact.approved_descendant_count > 0 &&
                  (strategy === "disconnect" || strategy === "reparent") && (
                    <Alert severity="warning" sx={{ mt: 1 }}>
                      {t("cards:detail.dialogs.children.approvalBreak", {
                        count: impact.approved_descendant_count,
                      })}
                    </Alert>
                  )}
              </Box>
            )}

            {/* Bulk: cascade-all-related toggle */}
            {scope === "bulk" && (
              <Box>
                <Divider sx={{ mb: 1 }} />
                <FormControlLabel
                  control={
                    <Switch
                      checked={cascadeAllRelated}
                      onChange={(_, v) => setCascadeAllRelated(v)}
                    />
                  }
                  label={t(
                    mode === "archive"
                      ? "inventory:massArchive.cascadeRelatedToggle"
                      : "inventory:massDelete.cascadeRelatedToggle",
                  )}
                />
                <FormHelperText>
                  {t(
                    mode === "archive"
                      ? "inventory:massArchive.cascadeRelatedHelp"
                      : "inventory:massDelete.cascadeRelatedHelp",
                  )}
                </FormHelperText>
              </Box>
            )}

            {/* Related cards section (single mode only) */}
            {showRelatedSection && impact && (
              <Box>
                <Divider sx={{ mb: 2 }} />
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">
                    {t("cards:detail.dialogs.related.title")}
                  </Typography>
                  <Chip
                    label={t("cards:detail.dialogs.related.countChip", {
                      count: impact.related_cards.length,
                    })}
                    size="small"
                    color="info"
                    variant="outlined"
                  />
                  {tickedCount > 0 && (
                    <Chip
                      label={t("cards:detail.dialogs.related.tickedChip", {
                        count: tickedCount,
                      })}
                      size="small"
                      color={
                        tickedCount >= TYPED_CONFIRM_THRESHOLD
                          ? "error"
                          : tickedCount >= WARNING_THRESHOLD
                            ? "warning"
                            : "primary"
                      }
                    />
                  )}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t("cards:detail.dialogs.related.tickPrompt")}
                </Typography>
                <Stack spacing={1.5}>
                  {groupedRelated.map((group) => {
                    const groupTicked = group.cards.every((c) => tickedRelated.has(c.id));
                    return (
                      <Box key={group.key}>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {group.label}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            ({group.cards.length})
                          </Typography>
                          <Link
                            component="button"
                            type="button"
                            variant="caption"
                            onClick={() => setGroupAll(group, !groupTicked)}
                          >
                            {groupTicked
                              ? t("cards:detail.dialogs.related.selectNone")
                              : t("cards:detail.dialogs.related.selectAll")}
                          </Link>
                        </Stack>
                        {group.cards.map((c) => (
                          <FormControlLabel
                            key={c.id}
                            sx={{ display: "flex", ml: 1 }}
                            control={
                              <Checkbox
                                checked={tickedRelated.has(c.id)}
                                onChange={() => toggleRelated(c.id)}
                                size="small"
                              />
                            }
                            label={
                              <Stack direction="row" alignItems="center" spacing={1}>
                                <Typography variant="body2">{c.name}</Typography>
                                <Chip label={c.type} size="small" variant="outlined" />
                              </Stack>
                            }
                          />
                        ))}
                      </Box>
                    );
                  })}
                </Stack>
                {showLargeImpactWarning && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    {t("cards:detail.dialogs.related.largeImpactWarning", {
                      count: tickedCount,
                    })}
                  </Alert>
                )}
                {requiresTypedConfirm && (
                  <Box sx={{ mt: 2 }}>
                    <Alert severity="error" sx={{ mb: 1 }}>
                      {t("cards:detail.dialogs.related.confirmTypePrompt", {
                        name: cardName,
                        count: tickedCount,
                      })}
                    </Alert>
                    <TextField
                      fullWidth
                      size="small"
                      value={typedName}
                      onChange={(e) => setTypedName(e.target.value)}
                      placeholder={cardName}
                    />
                  </Box>
                )}
              </Box>
            )}

            {/* Restore-cascade warning for archive mode (single, when children exist). */}
            {mode === "archive" && scope === "single" && impact && impact.descendant_count > 0 && (
              <Alert severity="info">{t("cards:detail.restoreCascadeWarning")}</Alert>
            )}

            {/* Generic destructive copy for delete mode. */}
            {mode === "delete" && (
              <Alert severity="error">
                {scope === "single"
                  ? t("cards:detail.dialogs.delete.description")
                  : t("inventory:massDelete.cannotBeUndone")}
              </Alert>
            )}

            {submitting && bulkProgress && bulkProgress.total > 1 && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t(
                    mode === "archive"
                      ? "inventory:massArchive.progressing"
                      : "inventory:massDelete.progressing",
                    { done: bulkProgress.done, total: bulkProgress.total },
                  )}
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={(bulkProgress.done / bulkProgress.total) * 100}
                  sx={{ mt: 0.5 }}
                />
              </Box>
            )}

            {submitError && <Alert severity="error">{submitError}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          variant="contained"
          color={mode === "archive" ? "warning" : "error"}
          onClick={handleConfirm}
          disabled={submitDisabled}
        >
          {submitting
            ? mode === "archive"
              ? t("cards:detail.dialogs.archive.archiving")
              : t("cards:detail.dialogs.delete.deleting")
            : mode === "archive"
              ? t("common:actions.archive")
              : t("cards:detail.dialogs.delete.submit")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
