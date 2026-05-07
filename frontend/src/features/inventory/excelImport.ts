import * as XLSX from "xlsx";
import i18n from "@/i18n";
import { resolveLabel } from "@/hooks/useResolveLabel";
import type { CalculatedFieldsMap, Card, CardType, FieldDef, TagGroup } from "@/types";
import { api } from "@/api/client";

const t = (key: string, opts?: Record<string, unknown>) =>
  i18n.t(key, { ns: "inventory", ...opts });

// ---- Public types --------------------------------------------------------

export interface ImportError {
  row: number;
  column?: string;
  message: string;
}

export interface ImportWarning {
  row?: number;
  column?: string;
  message: string;
}

export interface ParsedRow {
  rowIndex: number;
  id?: string;
  type: string;
  data: Record<string, unknown>;
  /** Raw parent_id from the file (UUID of existing or of another row in the file). Legacy. */
  parentId?: string;
  /** Decoded parent path segments from the `parent_path` column, root first. */
  parentPath?: string[];
  /**
   * Lookup key for this row's own full path, used so other rows can reference
   * it as a parent: `type|<lowercase_seg1>/<lowercase_seg2>/...`.
   */
  ownPathKey?: string;
  /** Lookup key for this row's parent path (`type|<lowercase parent_path>`). */
  parentPathKey?: string;
  /** Original card when updating an existing record */
  existing?: Card;
  /** For updates: the fields that actually changed (field → { old, new }) */
  changes?: Record<string, { old: unknown; new: unknown }>;
  /** Resolved tag ids to assign (undefined = `tags` column absent / not supplied) */
  tagIds?: string[];
}

export interface ImportReport {
  errors: ImportError[];
  warnings: ImportWarning[];
  creates: ParsedRow[];
  updates: ParsedRow[];
  skipped: number;
  totalRows: number;
}

export interface ImportResult {
  created: number;
  updated: number;
  failed: number;
  failedDetails: { row: number; message: string }[];
}

// ---- Helpers -------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_APPROVAL_STATUSES = new Set(["DRAFT", "APPROVED", "BROKEN", "REJECTED"]);
const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;
const TRUTHY = new Set(["true", "yes", "1"]);
const FALSY = new Set(["false", "no", "0"]);
const MAX_PATH_DEPTH = 8;

/**
 * Decode a `" / "`-separated parent path into an array of segments. The
 * encoder escapes both `\` and `/` (`\\` and `\/`), so we walk char by char
 * to apply each escape correctly. Empty input → empty array.
 */
function decodePath(path: string): string[] {
  if (!path) return [];
  const segments: string[] = [];
  let cur = "";
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === "\\" && i + 1 < path.length) {
      // Escaped character — append the next char literally so both `\\`
      // (literal backslash) and `\/` (literal slash) round-trip cleanly.
      cur += path[i + 1];
      i++;
    } else if (ch === "/") {
      segments.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  segments.push(cur.trim());
  return segments.filter(Boolean);
}

/** Build a case-insensitive index key for `(type, segments)`. */
function pathKey(type: string, segments: string[]): string {
  return `${type}|${segments.map((s) => s.toLowerCase()).join("/")}`;
}

/** Walk parent_id chain to produce the full ancestor segments (root first, including the card itself). */
function fullPathFor(card: Card, byId: Map<string, Card>): string[] {
  const segs: string[] = [];
  const seen = new Set<string>();
  let cur: Card | undefined = card;
  while (cur && !seen.has(cur.id) && segs.length < MAX_PATH_DEPTH) {
    seen.add(cur.id);
    segs.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return segs;
}

function sameTagSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const id of b) if (!setA.has(id)) return false;
  return true;
}

function str(v: unknown): string {
  if (v == null) return "";
  // Excel auto-formats date strings into native Date cells; convert back to
  // YYYY-MM-DD so lifecycle / date-attribute validation still works.
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v).trim();
}

function fieldDefsForType(
  type: string,
  allTypes: CardType[],
): FieldDef[] {
  const ct = allTypes.find((x) => x.key === type);
  if (!ct) return [];
  return ct.fields_schema.flatMap((s) => s.fields);
}

/**
 * Topologically sort rows so that parents come before children.
 * Rows whose parent (by id or by path) references another row in the creates
 * list are placed after that row. Rows with no parent dependency come first.
 */
function topoSortCreates(rows: ParsedRow[]): ParsedRow[] {
  const byId = new Map<string, ParsedRow>();
  const byOwnPath = new Map<string, ParsedRow>();
  for (const r of rows) {
    if (r.id) byId.set(r.id, r);
    if (r.ownPathKey) byOwnPath.set(r.ownPathKey, r);
  }

  const sorted: ParsedRow[] = [];
  const visited = new Set<string | number>();

  function visit(row: ParsedRow) {
    const key = row.id ?? `row:${row.rowIndex}`;
    if (visited.has(key)) return;
    visited.add(key);

    // Path-based parent reference (preferred for cross-instance imports)
    if (row.parentPathKey) {
      const parent = byOwnPath.get(row.parentPathKey);
      if (parent) visit(parent);
    }

    // Legacy id-based parent reference (same-instance round-trips)
    if (row.parentId) {
      const parent = byId.get(row.parentId);
      if (parent) visit(parent);
    }

    sorted.push(row);
  }

  for (const row of rows) visit(row);
  return sorted;
}

// ---- Core: build update patch --------------------------------------------

interface PatchResult {
  patch: Record<string, unknown>;
  /** Human-readable field-level changes: key → { old, new } */
  changes: Record<string, { old: unknown; new: unknown }>;
}

/**
 * Compare imported data against an existing card and return only the fields
 * that actually changed.  Returns an empty patch when nothing differs.
 */
function buildPatch(
  d: Record<string, unknown>,
  ex: Card,
): PatchResult {
  const patch: Record<string, unknown> = {};
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  // Normalise a string for comparison so that trivial whitespace differences
  // (trailing spaces, \r\n vs \n, etc.) introduced by the XLSX round-trip
  // don't flag as changes.
  const norm = (v: unknown): string =>
    (v == null ? "" : String(v)).trim().replace(/\r\n/g, "\n");

  if (d.name && norm(d.name) !== norm(ex.name)) {
    patch.name = d.name;
    changes.name = { old: ex.name, new: d.name };
  }

  for (const key of ["description", "subtype", "parent_id", "external_id", "alias"] as const) {
    const exVal = (ex as unknown as Record<string, unknown>)[key] ?? "";
    if (d[key] !== undefined && norm(d[key]) !== norm(exVal)) {
      patch[key] = d[key] || null;
      changes[key] = { old: exVal || null, new: d[key] || null };
    }
  }

  // Lifecycle: compare phase-by-phase
  if (d.lifecycle) {
    const newLc = d.lifecycle as Record<string, string>;
    const exLc = (ex.lifecycle || {}) as Record<string, string>;
    for (const phase of LIFECYCLE_PHASES) {
      if ((newLc[phase] ?? "") !== (exLc[phase] ?? "")) {
        patch.lifecycle = d.lifecycle;
        changes[`lifecycle_${phase}`] = {
          old: exLc[phase] ?? null,
          new: newLc[phase] ?? null,
        };
      }
    }
  }

  // Attributes: compare field-by-field (JSON.stringify handles arrays for
  // multiple_select round-trips; norm() handles trivial whitespace diffs
  // on plain-string attributes)
  if (d.attributes) {
    const newAttrs = d.attributes as Record<string, unknown>;
    const exAttrs = (ex.attributes || {}) as Record<string, unknown>;
    let attrChanged = false;
    for (const key of Object.keys(newAttrs)) {
      const nv = newAttrs[key];
      const ev = exAttrs[key];
      const differs = typeof nv === "string" && typeof ev === "string"
        ? norm(nv) !== norm(ev)
        : JSON.stringify(nv) !== JSON.stringify(ev);
      if (differs) {
        attrChanged = true;
        changes[`attr_${key}`] = { old: ev ?? null, new: nv };
      }
    }
    if (attrChanged) {
      patch.attributes = { ...exAttrs, ...newAttrs };
    }
  }

  return { patch, changes };
}

// ---- Core: parse workbook ------------------------------------------------

export function parseWorkbook(file: ArrayBuffer): Record<string, unknown>[] {
  // cellDates: true so that Excel-reformatted date cells come back as JS Date
  // objects (handled by str()) instead of opaque serial numbers.
  const wb = XLSX.read(file, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
}

// ---- Core: validate ------------------------------------------------------

export function validateImport(
  rows: Record<string, unknown>[],
  existingCards: Card[],
  allTypes: CardType[],
  preSelectedType?: string,
  tagGroups: TagGroup[] = [],
  calculatedFields: CalculatedFieldsMap = {},
): ImportReport {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const creates: ParsedRow[] = [];
  const updates: ParsedRow[] = [];
  let skipped = 0;

  if (rows.length === 0) {
    errors.push({ row: 0, message: t("import.errors.noDataRows") });
    return { errors, warnings, creates, updates, skipped, totalRows: 0 };
  }

  // Check for required columns
  const headers = Object.keys(rows[0]);
  const hasNameCol = headers.some((h) => h.toLowerCase() === "name");
  const hasTypeCol = headers.some((h) => h.toLowerCase() === "type");

  if (!hasNameCol) {
    errors.push({ row: 0, column: "name", message: t("import.errors.missingColumn", { column: "name" }) });
  }
  if (!hasTypeCol && !preSelectedType) {
    errors.push({
      row: 0,
      column: "type",
      message: t("import.errors.missingTypeColumn"),
    });
  }

  // If structural errors already, return early
  if (errors.length > 0) {
    return { errors, warnings, creates, updates, skipped, totalRows: rows.length };
  }

  // Warn about unrecognised columns
  const knownCoreCols = new Set([
    "id", "type", "name", "description", "subtype", "parent_id", "parent_path",
    "external_id", "alias", "approval_status", "tags",
    ...LIFECYCLE_PHASES.map((p) => `lifecycle_${p}`),
  ]);
  // Build set of all known attribute columns across all types
  const allAttrKeys = new Set<string>();
  for (const t of allTypes) {
    for (const s of t.fields_schema) {
      for (const f of s.fields) {
        allAttrKeys.add(`attr_${f.key}`);
      }
    }
  }
  for (const h of headers) {
    if (!knownCoreCols.has(h) && !knownCoreCols.has(h.toLowerCase()) && !allAttrKeys.has(h) && !h.startsWith("attr_")) {
      warnings.push({ column: h, message: t("import.warnings.unrecognisedColumn", { column: h }) });
    }
  }

  // Index existing cards by id for fast lookup
  const existingById = new Map<string, Card>();
  for (const card of existingCards) {
    existingById.set(card.id, card);
  }

  // Index existing cards by (type, full ancestor path) for parent_path resolution.
  // When two existing cards share the same path key (same name, same parent
  // chain, same type) we mark it as ambiguous so the import emits a warning
  // and the user can disambiguate by including an `id` column.
  const existingByPath = new Map<string, string>();
  const existingPathConflicts = new Set<string>();
  for (const card of existingCards) {
    const segs = fullPathFor(card, existingById);
    const k = pathKey(card.type, segs);
    if (existingByPath.has(k)) existingPathConflicts.add(k);
    else existingByPath.set(k, card.id);
  }

  // Track seen IDs to detect duplicates within the file
  const seenIds = new Map<string, number>(); // id → first row number

  // Collect all ids present in the file (for parent_id cross-referencing)
  // and pre-compute each row's own path key so child rows can reference
  // parent rows by path even when forward-declared.
  const fileIds = new Set<string>();
  const fileByOwnPathKey = new Map<string, number>(); // path key → 0-based row index
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const id = str(raw["id"] ?? raw["Id"] ?? raw["ID"]);
    if (id && UUID_RE.test(id)) fileIds.add(id);
    const ppRaw = str(raw["parent_path"]);
    const name = str(raw["name"] ?? raw["Name"]);
    const rowType = str(raw["type"] ?? raw["Type"]) || preSelectedType || "";
    if (name && rowType) {
      const segs = ppRaw ? [...decodePath(ppRaw), name] : [name];
      const k = pathKey(rowType, segs);
      // First-write-wins; collisions are flagged later as duplicates.
      if (!fileByOwnPathKey.has(k)) fileByOwnPathKey.set(k, i);
    }
  }

  const typeKeys = new Set(allTypes.filter((t) => !t.is_hidden).map((t) => t.key));

  // Tag lookup: "group_name|tag_name" (lowercased) → id. Also allow bare "tag_name"
  // when the tag name is unique across groups so exports that didn't carry the
  // group prefix can still round-trip.
  const tagByGroupTag = new Map<string, string>();
  const tagByNameOnly = new Map<string, string | null>(); // null marks ambiguous
  for (const g of tagGroups) {
    for (const tg of g.tags) {
      const gt = `${g.name.trim().toLowerCase()}|${tg.name.trim().toLowerCase()}`;
      tagByGroupTag.set(gt, tg.id);
      const bare = tg.name.trim().toLowerCase();
      if (tagByNameOnly.has(bare)) tagByNameOnly.set(bare, null);
      else tagByNameOnly.set(bare, tg.id);
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // +2 because row 1 is the header, data starts at 2
    const raw = rows[i];

    // Skip fully blank rows
    const allEmpty = Object.values(raw).every((v) => str(v) === "");
    if (allEmpty) {
      skipped++;
      continue;
    }

    const name = str(raw["name"] ?? raw["Name"]);
    const id = str(raw["id"] ?? raw["Id"] ?? raw["ID"]);
    const type = str(raw["type"] ?? raw["Type"]) || preSelectedType || "";
    const description = str(raw["description"] ?? raw["Description"]);
    const subtype = str(raw["subtype"] ?? raw["Subtype"]);
    let parentId = str(raw["parent_id"]);
    const parentPathRaw = str(raw["parent_path"]);
    const externalId = str(raw["external_id"]);
    const alias = str(raw["alias"] ?? raw["Alias"]);
    const approvalStatus = str(raw["approval_status"]).toUpperCase();

    // Rule 2: name required
    if (!name) {
      errors.push({ row: rowNum, column: "name", message: t("import.errors.nameRequired", { row: rowNum }) });
      continue;
    }

    // Rule 4: type must be valid
    if (!typeKeys.has(type)) {
      errors.push({
        row: rowNum,
        column: "type",
        message: t("import.errors.unknownType", { row: rowNum, type }),
      });
      continue;
    }

    // Rule 5: if id present, must be valid UUID
    let matchedExisting: Card | undefined;
    if (id) {
      if (!UUID_RE.test(id)) {
        errors.push({
          row: rowNum,
          column: "id",
          message: t("import.errors.invalidId", { row: rowNum, id }),
        });
        continue;
      }

      // Rule 8: duplicate id in file
      const prevRow = seenIds.get(id);
      if (prevRow !== undefined) {
        errors.push({
          row: rowNum,
          column: "id",
          message: t("import.errors.duplicateId", { row: rowNum, id, prevRow }),
        });
        continue;
      }
      seenIds.set(id, rowNum);

      // Rule 6: id must match existing — but for cross-instance imports the
      // source UUID won't exist locally, so demote to a "create" with a
      // warning instead of failing the row outright.
      matchedExisting = existingById.get(id);
      if (!matchedExisting) {
        warnings.push({
          row: rowNum,
          column: "id",
          message: t("import.warnings.idNotFoundCreating", { row: rowNum, id }),
        });
        // Fall through: the row will be classified as a create below; we
        // intentionally drop the file id so the server generates a fresh one.
        seenIds.delete(id);
      } else if (matchedExisting.type !== type) {
        // Rule 7: type must match for an update
        errors.push({
          row: rowNum,
          column: "type",
          message: t("import.errors.typeMismatch", { row: rowNum, fileType: type, existingType: matchedExisting.type }),
        });
        continue;
      }
    }

    // Resolve parent_path (preferred for cross-instance imports). Path-based
    // resolution wins over `parent_id` when both are provided, so an exported
    // file from another tenant still wires up hierarchy correctly.
    let parentSegments: string[] | undefined;
    let parentPathKey: string | undefined;
    let pathRowError = false;
    if (parentPathRaw) {
      parentSegments = decodePath(parentPathRaw);
      if (parentSegments.length === 0) {
        // Treat malformed path (only escapes / whitespace) as missing.
        parentSegments = undefined;
      } else {
        parentPathKey = pathKey(type, parentSegments);

        // Self-reference: a row whose parent_path is its own path.
        const ownKey = pathKey(type, [...parentSegments, name]);
        if (parentPathKey === ownKey) {
          errors.push({
            row: rowNum,
            column: "parent_path",
            message: t("import.errors.parentSelfReference", { row: rowNum }),
          });
          continue;
        }

        const existingMatch = existingByPath.get(parentPathKey);
        if (existingMatch) {
          // Use the existing card's id directly — overrides any stale parent_id.
          parentId = existingMatch;
          if (existingPathConflicts.has(parentPathKey)) {
            warnings.push({
              row: rowNum,
              column: "parent_path",
              message: t("import.warnings.ambiguousParentPath", { row: rowNum, path: parentPathRaw }),
            });
          }
        } else if (fileByOwnPathKey.has(parentPathKey)) {
          // Parent will be created earlier in the file via topo sort; clear
          // any legacy parent_id since it would point at the source-instance
          // UUID and confuse executeImport.
          parentId = "";
        } else {
          errors.push({
            row: rowNum,
            column: "parent_path",
            message: t("import.errors.invalidParentPath", { row: rowNum, path: parentPathRaw }),
          });
          pathRowError = true;
        }
      }
    }
    if (pathRowError) continue;

    // Validate parent_id (legacy / same-instance round-trips). Skipped when
    // parent_path already resolved to an existing card or a file row.
    if (parentId && !parentPathKey) {
      if (!UUID_RE.test(parentId)) {
        errors.push({
          row: rowNum,
          column: "parent_id",
          message: t("import.errors.invalidParentId", { row: rowNum, parentId }),
        });
        continue;
      }
      // parent must exist in DB or be another row in the file
      if (!existingById.has(parentId) && !fileIds.has(parentId)) {
        errors.push({
          row: rowNum,
          column: "parent_id",
          message: t("import.errors.parentNotFound", { row: rowNum, parentId }),
        });
        continue;
      }
      // parent must not be self
      if (parentId === id) {
        errors.push({
          row: rowNum,
          column: "parent_id",
          message: t("import.errors.parentSelfReference", { row: rowNum }),
        });
        continue;
      }
    }

    // Rule 9: approval_status validation
    if (approvalStatus && !VALID_APPROVAL_STATUSES.has(approvalStatus)) {
      errors.push({
        row: rowNum,
        column: "approval_status",
        message: t("import.errors.invalidApprovalStatus", { row: rowNum, status: approvalStatus }),
      });
      continue;
    }

    // Build lifecycle object
    const lifecycle: Record<string, string> = {};
    for (const phase of LIFECYCLE_PHASES) {
      const val = str(raw[`lifecycle_${phase}`]);
      if (val) {
        // Rule 13: lifecycle dates
        if (!DATE_RE.test(val)) {
          errors.push({
            row: rowNum,
            column: `lifecycle_${phase}`,
            message: t("import.errors.invalidDate", { row: rowNum, field: `lifecycle_${phase}`, value: val }),
          });
        } else {
          lifecycle[phase] = val;
        }
      }
    }

    // Build attributes object, validating against field defs
    const fieldDefs = fieldDefsForType(type, allTypes);
    const calcFieldsForType = new Set(calculatedFields[type] || []);
    const attributes: Record<string, unknown> = {};
    let rowHasAttrError = false;

    for (const field of fieldDefs) {
      const colKey = `attr_${field.key}`;
      const rawVal = raw[colKey];
      const val = str(rawVal);

      // Read-only fields (admin-marked or calculated) cannot be set via import.
      // If the user supplied a value, warn and skip it; otherwise stay silent.
      const isReadOnly = field.readonly === true || calcFieldsForType.has(field.key);
      if (isReadOnly) {
        if (val) {
          warnings.push({
            row: rowNum,
            column: colKey,
            message: t("import.warnings.readOnlyFieldIgnored", {
              row: rowNum,
              field: resolveLabel(field.key, field.translations, i18n.language),
            }),
          });
        }
        continue;
      }

      if (!val) {
        // A missing required attribute is a data-quality concern, not a data
        // integrity one — the backend creates the card regardless and the
        // quality score will reflect the gap. Surface a warning so users
        // notice, but don't block cross-instance migrations on incomplete
        // source data.
        if (field.required && !matchedExisting) {
          warnings.push({
            row: rowNum,
            column: colKey,
            message: t("import.errors.requiredFieldEmpty", { row: rowNum, field: resolveLabel(field.key, field.translations, i18n.language) }),
          });
        }
        continue;
      }

      // Validate by field type
      switch (field.type) {
        case "cost":
        case "number": {
          // Rule 11
          const num = Number(val);
          if (isNaN(num)) {
            errors.push({
              row: rowNum,
              column: colKey,
              message: t("import.errors.expectsNumber", { row: rowNum, field: resolveLabel(field.key, field.translations, i18n.language), value: val }),
            });
            rowHasAttrError = true;
          } else {
            attributes[field.key] = num;
          }
          break;
        }
        case "boolean": {
          // Rule 12
          const lower = val.toLowerCase();
          if (TRUTHY.has(lower)) {
            attributes[field.key] = true;
          } else if (FALSY.has(lower)) {
            attributes[field.key] = false;
          } else {
            errors.push({
              row: rowNum,
              column: colKey,
              message: t("import.errors.expectsBoolean", { row: rowNum, field: resolveLabel(field.key, field.translations, i18n.language), value: val }),
            });
            rowHasAttrError = true;
          }
          break;
        }
        case "date": {
          // Rule 13
          if (!DATE_RE.test(val)) {
            errors.push({
              row: rowNum,
              column: colKey,
              message: t("import.errors.invalidDate", { row: rowNum, field: resolveLabel(field.key, field.translations, i18n.language), value: val }),
            });
            rowHasAttrError = true;
          } else {
            attributes[field.key] = val;
          }
          break;
        }
        case "single_select": {
          // Rule 10
          if (field.options && field.options.length > 0) {
            const validKeys = field.options.map((o) => o.key);
            if (!validKeys.includes(val)) {
              errors.push({
                row: rowNum,
                column: colKey,
                message: t("import.errors.invalidSelectValue", { row: rowNum, value: val, field: resolveLabel(field.key, field.translations, i18n.language), valid: validKeys.join(", ") }),
              });
              rowHasAttrError = true;
            } else {
              attributes[field.key] = val;
            }
          } else {
            attributes[field.key] = val;
          }
          break;
        }
        case "multiple_select": {
          const parts = val.split(",").map((s) => s.trim()).filter(Boolean);
          if (field.options && field.options.length > 0) {
            const validKeys = field.options.map((o) => o.key);
            for (const part of parts) {
              if (!validKeys.includes(part)) {
                errors.push({
                  row: rowNum,
                  column: colKey,
                  message: t("import.errors.invalidSelectValue", { row: rowNum, value: part, field: resolveLabel(field.key, field.translations, i18n.language), valid: validKeys.join(", ") }),
                });
                rowHasAttrError = true;
              }
            }
            if (!rowHasAttrError) {
              attributes[field.key] = parts;
            }
          } else {
            attributes[field.key] = parts;
          }
          break;
        }
        default:
          // text — accept as-is
          attributes[field.key] = val;
      }
    }

    if (rowHasAttrError) continue;

    // Parse optional Tags column: "Group: Tag, Group: Tag" (or bare "Tag")
    let parsedTagIds: string[] | undefined;
    const tagsCell = str(raw["tags"] ?? raw["Tags"]);
    if (tagsCell !== "") {
      parsedTagIds = [];
      const entries = tagsCell
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const entry of entries) {
        const colonIdx = entry.indexOf(":");
        let resolved: string | null | undefined;
        if (colonIdx > 0) {
          const groupName = entry.slice(0, colonIdx).trim().toLowerCase();
          const tagName = entry.slice(colonIdx + 1).trim().toLowerCase();
          resolved = tagByGroupTag.get(`${groupName}|${tagName}`);
        } else {
          resolved = tagByNameOnly.get(entry.toLowerCase());
        }
        if (resolved == null) {
          warnings.push({
            row: rowNum,
            column: "tags",
            message: t("import.warnings.unknownTag", { row: rowNum, value: entry }),
          });
        } else if (!parsedTagIds.includes(resolved)) {
          parsedTagIds.push(resolved);
        }
      }
    }

    // Build the data payload
    const data: Record<string, unknown> = {
      type,
      name,
    };
    if (description) data.description = description;
    if (subtype) data.subtype = subtype;
    if (parentId) data.parent_id = parentId;
    if (externalId) data.external_id = externalId;
    if (alias) data.alias = alias;
    if (Object.keys(lifecycle).length > 0) data.lifecycle = lifecycle;
    if (Object.keys(attributes).length > 0) data.attributes = attributes;

    const parsed: ParsedRow = {
      rowIndex: rowNum,
      type,
      data,
      parentId: parentId || undefined,
      parentPath: parentSegments,
      parentPathKey,
      ownPathKey: pathKey(type, parentSegments ? [...parentSegments, name] : [name]),
      tagIds: parsedTagIds,
    };

    if (id && matchedExisting) {
      parsed.id = id;
      parsed.existing = matchedExisting;
      // Classify as update when either regular fields or tags actually changed
      const { patch, changes } = buildPatch(data, matchedExisting);
      const tagsChanged =
        parsedTagIds !== undefined &&
        !sameTagSet(
          parsedTagIds,
          (matchedExisting.tags || []).map((tg) => tg.id),
        );
      if (Object.keys(patch).length > 0 || tagsChanged) {
        parsed.changes = changes;
        if (tagsChanged && parsedTagIds) {
          const newTagIds = parsedTagIds;
          parsed.changes = {
            ...(parsed.changes || {}),
            tags: {
              old: (matchedExisting.tags || []).map((tg) => tg.name).join(", "),
              new: newTagIds
                .map((id) => {
                  for (const g of tagGroups) {
                    const tg = g.tags.find((x) => x.id === id);
                    if (tg) return tg.name;
                  }
                  return id;
                })
                .join(", "),
            },
          };
        }
        updates.push(parsed);
      } else {
        skipped++;
      }
    } else {
      creates.push(parsed);
    }
  }

  return { errors, warnings, creates, updates, skipped, totalRows: rows.length };
}

// ---- Core: execute import ------------------------------------------------

export async function executeImport(
  report: ImportReport,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const total = report.creates.length + report.updates.length;
  let done = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;
  const failedDetails: { row: number; message: string }[] = [];

  // Map old id (from file) → new id (from server) for parent_id resolution
  const idMapping = new Map<string, string>();
  // Map row's own path key → server id, so subsequent rows can resolve their
  // parent path against newly-created file rows.
  const pathToId = new Map<string, string>();

  // Topologically sort creates so parents are created before children
  const sortedCreates = topoSortCreates(report.creates);

  // Creates
  for (const row of sortedCreates) {
    try {
      const payload = { ...row.data };

      // Resolve parent reference, in priority order:
      //   1. parent_path that points at another file row → use freshly-created id
      //   2. legacy parent_id mapped via idMapping
      // Existing-card parent paths were already resolved into payload.parent_id
      // during validation, so they pass through unchanged.
      if (row.parentPathKey && pathToId.has(row.parentPathKey)) {
        payload.parent_id = pathToId.get(row.parentPathKey);
      } else if (row.parentId && idMapping.has(row.parentId)) {
        payload.parent_id = idMapping.get(row.parentId);
      }

      const result = await api.post<{ id: string }>("/cards", payload);

      // Track the mapping from file id → server id
      if (row.id && result.id) {
        idMapping.set(row.id, result.id);
      }
      // Track the mapping from own path key → server id for child rows
      if (row.ownPathKey && result.id) {
        pathToId.set(row.ownPathKey, result.id);
      }
      // Assign tags if any were resolved for this row
      if (row.tagIds && row.tagIds.length > 0 && result.id) {
        try {
          await api.post(`/cards/${result.id}/tags`, row.tagIds);
        } catch {
          // Non-fatal: card was created; surface no extra failure here.
        }
      }
      created++;
    } catch (e) {
      failed++;
      failedDetails.push({
        row: row.rowIndex,
        message: e instanceof Error ? e.message : t("import.errors.unknown"),
      });
    }
    done++;
    onProgress?.(done, total);
  }

  // Updates
  for (const row of report.updates) {
    try {
      const { patch } = buildPatch(row.data, row.existing!);
      let didSomething = false;
      if (Object.keys(patch).length > 0) {
        await api.patch(`/cards/${row.id}`, patch);
        didSomething = true;
      }
      // Sync tags when the row supplied a Tags column
      if (row.tagIds !== undefined && row.existing) {
        const oldIds = new Set((row.existing.tags || []).map((tg) => tg.id));
        const newIds = new Set(row.tagIds);
        const toAdd = [...newIds].filter((id) => !oldIds.has(id));
        const toRemove = [...oldIds].filter((id) => !newIds.has(id));
        if (toAdd.length > 0) {
          await api.post(`/cards/${row.id}/tags`, toAdd);
          didSomething = true;
        }
        for (const id of toRemove) {
          await api.delete(`/cards/${row.id}/tags/${id}`);
          didSomething = true;
        }
      }
      if (didSomething) updated++;
    } catch (e) {
      failed++;
      failedDetails.push({
        row: row.rowIndex,
        message: e instanceof Error ? e.message : t("import.errors.unknown"),
      });
    }
    done++;
    onProgress?.(done, total);
  }

  return { created, updated, failed, failedDetails };
}
