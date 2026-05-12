import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Chip from "@mui/material/Chip";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
import type { Card, CardListResponse, CardType } from "@/types";

interface CountsResponse {
  by_type: { type: string; count: number }[];
  total: number;
}

export type InsertMode = "multi" | "single";

interface Props {
  open: boolean;
  /** "multi" lets the user pick many cards via checkboxes (default).
   *  "single" closes the dialog as soon as one is picked — used for the
   *  Change-Linked-Card and Link-to-Existing-Card flows. */
  mode?: InsertMode;
  onClose: () => void;
  onInsert: (cards: Card[], cardTypeKeysByCardId: Map<string, CardType>) => void;
}

/**
 * LeanIX-style multi-select Insert Cards dialog.
 *
 * Left pane: type chips with live counts from /cards/counts.
 * Right pane: paginated search results with per-row checkboxes.
 * Footer: Insert selected / Insert all (with confirmation when > 50).
 */
export default function InsertCardsDialog({
  open,
  mode = "multi",
  onClose,
  onInsert,
}: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const rml = useResolveMetaLabel();
  const { types: allTypes } = useMetamodel();
  const visibleTypes = useMemo(() => allTypes.filter((tp) => !tp.is_hidden), [allTypes]);
  const typeMap = useMemo(
    () => new Map(visibleTypes.map((tp) => [tp.key, tp] as const)),
    [visibleTypes],
  );

  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [selectedTypeKeys, setSelectedTypeKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [confirmInsertAll, setConfirmInsertAll] = useState(false);

  // Reset state when dialog closes.
  useEffect(() => {
    if (open) return;
    setSelectedTypeKeys(new Set());
    setSearch("");
    setResults([]);
    setTotal(0);
    setSelectedCardIds(new Set());
    setConfirmInsertAll(false);
  }, [open]);

  // Fetch type counts once per open.
  useEffect(() => {
    if (!open) return;
    api
      .get<CountsResponse>("/cards/counts")
      .then((r) => setCounts(new Map(r.by_type.map((e) => [e.type, e.count]))))
      .catch(() => setCounts(new Map()));
  }, [open]);

  // Search whenever filters change. Debounced to avoid hammering the API.
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({ page_size: "200" });
      if (selectedTypeKeys.size === 1) {
        params.set("type", Array.from(selectedTypeKeys)[0]);
      }
      if (search.trim()) params.set("search", search.trim());

      // Skip the initial empty query in single-mode picker (no chips, no
      // search) — wait for the user to narrow it.
      if (selectedTypeKeys.size === 0 && !search.trim()) {
        setResults([]);
        setTotal(0);
        return;
      }

      setLoading(true);
      api
        .get<CardListResponse>(`/cards?${params.toString()}`)
        .then((r) => {
          let items = r.items;
          // Client-side filter when multiple types are selected.
          if (selectedTypeKeys.size > 1) {
            items = items.filter((c) => selectedTypeKeys.has(c.type));
          }
          setResults(items);
          setTotal(items.length);
        })
        .catch(() => {
          setResults([]);
          setTotal(0);
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [open, selectedTypeKeys, search]);

  const toggleType = useCallback((key: string) => {
    setSelectedTypeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleRow = useCallback((id: string) => {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const buildTypeMapForCards = useCallback(
    (cards: Card[]) => {
      const result = new Map<string, CardType>();
      for (const c of cards) {
        const ct = typeMap.get(c.type);
        if (ct) result.set(c.id, ct);
      }
      return result;
    },
    [typeMap],
  );

  const handleInsertSelected = useCallback(() => {
    const picked = results.filter((c) => selectedCardIds.has(c.id));
    if (picked.length === 0) return;
    onInsert(picked, buildTypeMapForCards(picked));
    onClose();
  }, [results, selectedCardIds, onInsert, onClose, buildTypeMapForCards]);

  const handleInsertSingle = useCallback(
    (card: Card) => {
      onInsert([card], buildTypeMapForCards([card]));
      onClose();
    },
    [onInsert, onClose, buildTypeMapForCards],
  );

  const handleInsertAll = useCallback(() => {
    if (results.length > 50 && !confirmInsertAll) {
      setConfirmInsertAll(true);
      return;
    }
    onInsert(results, buildTypeMapForCards(results));
    onClose();
  }, [results, confirmInsertAll, onInsert, onClose, buildTypeMapForCards]);

  if (!open) return null;
  const isMulti = mode === "multi";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          pb: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <MaterialSymbol icon="library_add" size={22} color="#1976d2" />
        {isMulti ? t("insertDialog.titleMulti") : t("insertDialog.titleSingle")}
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" onClick={onClose}>
          <MaterialSymbol icon="close" size={18} />
        </IconButton>
      </DialogTitle>

      <DialogContent
        sx={{
          display: "flex",
          gap: 0,
          p: 0,
          height: "min(70vh, 640px)",
          overflow: "hidden",
        }}
      >
        {/* Left filter sidebar — type chips with counts */}
        <Box
          sx={{
            width: 220,
            flexShrink: 0,
            borderRight: "1px solid",
            borderColor: "divider",
            overflow: "auto",
            p: 2,
          }}
        >
          <Typography variant="overline" color="text.secondary">
            {t("insertDialog.typeFilter")}
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 1 }}>
            {visibleTypes
              .slice()
              .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99))
              .map((tp) => {
                const count = counts.get(tp.key) ?? 0;
                const active = selectedTypeKeys.has(tp.key);
                return (
                  <Chip
                    key={tp.key}
                    size="small"
                    label={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box sx={{ flex: 1, textAlign: "left" }}>
                          {rml(tp.key, tp.translations, "label")}
                        </Box>
                        <Box
                          sx={{
                            fontSize: "0.7rem",
                            opacity: active ? 0.9 : 0.65,
                          }}
                        >
                          {count}
                        </Box>
                      </Box>
                    }
                    variant={active ? "filled" : "outlined"}
                    sx={{
                      justifyContent: "flex-start",
                      bgcolor: active ? tp.color : "transparent",
                      color: active ? "#fff" : "text.primary",
                      borderColor: tp.color,
                      "& .MuiChip-label": { width: "100%", px: 1 },
                      cursor: "pointer",
                    }}
                    onClick={() => toggleType(tp.key)}
                  />
                );
              })}
          </Box>
        </Box>

        {/* Right pane: search + results */}
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Box sx={{ p: 2, pb: 1 }}>
            <TextField
              size="small"
              fullWidth
              autoFocus
              placeholder={t("insertDialog.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <MaterialSymbol icon="search" size={18} color="#999" />
                  </InputAdornment>
                ),
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              {selectedTypeKeys.size === 0 && !search.trim()
                ? t("insertDialog.selectOrSearch")
                : t("insertDialog.resultsCount", { count: total })}
            </Typography>
          </Box>

          <Divider />

          <Box sx={{ flex: 1, overflow: "auto" }}>
            {loading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <CircularProgress size={24} />
              </Box>
            ) : results.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 6, color: "text.disabled" }}>
                <MaterialSymbol icon="search_off" size={36} color="#bbb" />
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {selectedTypeKeys.size === 0 && !search.trim()
                    ? t("insertDialog.selectOrSearch")
                    : t("insertDialog.empty")}
                </Typography>
              </Box>
            ) : (
              <Box>
                {results.map((c) => {
                  const ct = typeMap.get(c.type);
                  const selected = selectedCardIds.has(c.id);
                  return (
                    <Box
                      key={c.id}
                      onClick={() => {
                        if (isMulti) toggleRow(c.id);
                        else handleInsertSingle(c);
                      }}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                        px: 2,
                        py: 0.75,
                        cursor: "pointer",
                        borderBottom: "1px solid",
                        borderColor: "divider",
                        bgcolor: selected ? "action.selected" : "transparent",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      {isMulti && (
                        <Checkbox
                          size="small"
                          checked={selected}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleRow(c.id);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          sx={{ p: 0.5 }}
                        />
                      )}
                      {ct && (
                        <Box
                          sx={{
                            width: 24,
                            height: 24,
                            borderRadius: "4px",
                            bgcolor: ct.color,
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <MaterialSymbol icon={ct.icon} size={14} color="#fff" />
                        </Box>
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" noWrap fontWeight={500}>
                          {c.name}
                        </Typography>
                        {c.description && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            sx={{ display: "block" }}
                          >
                            {c.description}
                          </Typography>
                        )}
                      </Box>
                      {ct && (
                        <Chip
                          size="small"
                          label={rml(ct.key, ct.translations, "label")}
                          sx={{
                            height: 20,
                            fontSize: "0.7rem",
                            bgcolor: ct.color,
                            color: "#fff",
                          }}
                        />
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>

      {isMulti && (
        <DialogActions
          sx={{
            display: "flex",
            justifyContent: "space-between",
            px: 2,
            py: 1,
            borderTop: "1px solid",
            borderColor: "divider",
          }}
        >
          <Box>
            {selectedCardIds.size > 0 && (
              <Typography variant="caption" color="text.secondary">
                {t("insertDialog.selectedCount", { count: selectedCardIds.size })}
              </Typography>
            )}
            {confirmInsertAll && (
              <Typography variant="caption" color="warning.main" sx={{ ml: 1 }}>
                {t("insertDialog.confirmInsertAll", { count: results.length })}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
            <Button
              variant="outlined"
              disabled={results.length === 0}
              onClick={handleInsertAll}
            >
              {confirmInsertAll
                ? t("insertDialog.insertAllConfirm")
                : t("insertDialog.insertAll", { count: results.length })}
            </Button>
            <Button
              variant="contained"
              disabled={selectedCardIds.size === 0}
              onClick={handleInsertSelected}
            >
              {t("insertDialog.insertSelected", { count: selectedCardIds.size })}
            </Button>
          </Box>
        </DialogActions>
      )}
    </Dialog>
  );
}
