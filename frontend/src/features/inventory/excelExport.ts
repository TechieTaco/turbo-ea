import * as XLSX from "xlsx";
import i18n from "@/i18n";
import { resolveMetaLabel } from "@/hooks/useResolveLabel";
import type { Card, CardType } from "@/types";

const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;
const MAX_PATH_DEPTH = 8;

/**
 * Encode a single name for inclusion in a `parent_path`. Both `\` and `/`
 * are escaped (`\` → `\\`, `/` → `\/`) so the path is unambiguous and
 * names containing either character round-trip cleanly through import.
 */
function encodePathSegment(name: string): string {
  return name.replace(/\\/g, "\\\\").replace(/\//g, "\\/");
}

/**
 * Build a `" / "`-separated path of ancestor names for a card, root first,
 * immediate parent last. Returns an empty string for root cards.
 */
function buildParentPath(card: Card, byId: Map<string, Card>): string {
  const segments: string[] = [];
  const seen = new Set<string>();
  let current = card.parent_id ? byId.get(card.parent_id) : undefined;
  while (current && !seen.has(current.id) && segments.length < MAX_PATH_DEPTH) {
    seen.add(current.id);
    segments.unshift(encodePathSegment(current.name));
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return segments.join(" / ");
}

/**
 * Export the given cards to an XLSX file and trigger a download.
 *
 * When a single type is selected its attribute fields are expanded into
 * individual columns.  Otherwise only the core columns are exported.
 */
export function exportToExcel(
  cards: Card[],
  typeConfig: CardType | undefined,
  _allTypes: CardType[],
  options: { canViewCosts?: boolean } = {},
) {
  const { canViewCosts = true } = options;
  const rows: Record<string, unknown>[] = [];

  // Build the list of attribute field keys (only when a single type is active).
  // Drop cost-typed fields when the user lacks the global costs.view perm so
  // the exported sheet doesn't expose empty cost columns. The backend already
  // strips cost values per-row, but the column header would otherwise leak.
  const attrFields = typeConfig
    ? typeConfig.fields_schema.flatMap((s) => s.fields).filter(
        (f) => canViewCosts || f.type !== "cost",
      )
    : [];

  // Index by id so we can resolve ancestor names without re-fetching.
  const byId = new Map<string, Card>();
  for (const card of cards) byId.set(card.id, card);

  for (const card of cards) {
    const row: Record<string, unknown> = {
      id: card.id,
      type: card.type,
      name: card.name,
      description: card.description ?? "",
      subtype: card.subtype ?? "",
      parent_path: buildParentPath(card, byId),
      external_id: card.external_id ?? "",
      alias: card.alias ?? "",
      approval_status: card.approval_status ?? "",
      tags: (card.tags || [])
        .map((tg) => (tg.group_name ? `${tg.group_name}: ${tg.name}` : tg.name))
        .join(", "),
    };

    // Flatten lifecycle phases
    const lc = card.lifecycle || {};
    for (const phase of LIFECYCLE_PHASES) {
      row[`lifecycle_${phase}`] = lc[phase] ?? "";
    }

    // Type-specific attribute columns
    for (const field of attrFields) {
      const val = (card.attributes || {})[field.key];
      if (field.type === "multiple_select" && Array.isArray(val)) {
        row[`attr_${field.key}`] = val.join(", ");
      } else {
        row[`attr_${field.key}`] = val ?? "";
      }
    }

    rows.push(row);
  }

  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns (rough heuristic: max of header length and longest value)
  const headers = Object.keys(rows[0] || {});
  ws["!cols"] = headers.map((h) => {
    let maxLen = h.length;
    for (const r of rows) {
      const v = String(r[h] ?? "");
      if (v.length > maxLen) maxLen = v.length;
    }
    return { wch: Math.min(maxLen + 2, 60) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, i18n.t("common:labels.cards"));

  // Build filename. Local-time YYYY-MM-DD_HHMM so users exporting multiple
  // times in the same day don't end up with colliding filenames.
  const typeLabel = typeConfig
    ? resolveMetaLabel(typeConfig.key, typeConfig.translations, "label", i18n.language)
    : "cards";
  XLSX.writeFile(wb, `${typeLabel}_export_${exportTimestamp()}.xlsx`);
}

function exportTimestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const mi = pad(now.getMinutes());
  return `${y}-${mo}-${d}_${h}${mi}`;
}
