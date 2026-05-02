import * as XLSX from "xlsx";
import { toPng } from "html-to-image";
import PptxGenJS from "pptxgenjs";
import i18n from "@/i18n";

export type ExportColumnType = "text" | "number" | "currency" | "date";

export interface ExportColumn {
  key: string;
  label: string;
  type?: ExportColumnType;
}

export interface ExportSheet {
  name: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
}

export interface ReportExportData {
  title: string;
  subtitle?: string;
  filterSummary?: { label: string; value: string }[];
  sheets: ExportSheet[];
  chartNode?: HTMLElement | null;
}

/**
 * Extract tabular data from any `<table>` elements inside a node so reports
 * don't need bespoke serialization logic. The first preceding heading
 * (h1–h6) is used as the sheet name when available.
 */
export function extractSheetsFromDOM(node: HTMLElement | null): ExportSheet[] {
  if (!node) return [];
  const sheets: ExportSheet[] = [];
  const tables = Array.from(node.querySelectorAll<HTMLTableElement>("table"));

  tables.forEach((tbl, idx) => {
    const headerCells = Array.from(tbl.querySelectorAll<HTMLTableCellElement>("thead th"));
    if (headerCells.length === 0) return;

    const columns: ExportColumn[] = headerCells.map((th, i) => {
      const label = (th.textContent || "").replace(/\s+/g, " ").trim() || `Column ${i + 1}`;
      const align = th.getAttribute("align") || getComputedStyle(th).textAlign;
      return {
        key: `c${i}`,
        label,
        type: align === "right" ? "number" : "text",
      };
    });

    const bodyRows = Array.from(tbl.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    const rows: Record<string, unknown>[] = [];
    for (const tr of bodyRows) {
      const cells = Array.from(tr.querySelectorAll<HTMLTableCellElement>("td"));
      if (cells.length === 0) continue;
      const row: Record<string, unknown> = {};
      cells.forEach((td, i) => {
        const text = (td.textContent || "").replace(/\s+/g, " ").trim();
        if (columns[i]?.type === "number") {
          const num = Number(text.replace(/[^0-9.-]/g, ""));
          row[`c${i}`] = Number.isFinite(num) && text !== "" ? num : text;
        } else {
          row[`c${i}`] = text;
        }
      });
      rows.push(row);
    }
    if (rows.length === 0) return;

    let name = `Sheet ${idx + 1}`;
    let cur: Element | null = tbl;
    while (cur) {
      const heading = cur.previousElementSibling?.querySelector("h1,h2,h3,h4,h5,h6,[data-export-section]")
        ?? (cur.previousElementSibling?.matches("h1,h2,h3,h4,h5,h6,[data-export-section]") ? cur.previousElementSibling : null);
      if (heading?.textContent) {
        name = heading.textContent.replace(/\s+/g, " ").trim().slice(0, 31);
        break;
      }
      cur = cur.parentElement;
      if (cur === node) break;
    }

    sheets.push({ name, columns, rows });
  });

  return sheets;
}

const sanitizeFilename = (s: string): string =>
  s.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 60) || "report";

const sanitizeSheetName = (s: string): string =>
  s.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet";

const formatCellValue = (value: unknown, type?: ExportColumnType): unknown => {
  if (value === null || value === undefined || value === "") return "";
  if (type === "number" || type === "currency") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (type === "date") {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value);
  }
  if (Array.isArray(value)) return value.join(", ");
  return value;
};

export async function exportReportToXlsx(data: ReportExportData): Promise<void> {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  for (const sheet of data.sheets) {
    const headerRow = sheet.columns.map((c) => c.label);
    const aoa: unknown[][] = [headerRow];

    for (const row of sheet.rows) {
      aoa.push(sheet.columns.map((c) => formatCellValue(row[c.key], c.type)));
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Apply currency / number formats per column
    sheet.columns.forEach((col, colIdx) => {
      if (col.type === "currency" || col.type === "number") {
        for (let r = 1; r < aoa.length; r++) {
          const cellRef = XLSX.utils.encode_cell({ r, c: colIdx });
          const cell = ws[cellRef];
          if (cell && typeof cell.v === "number") {
            cell.t = "n";
            cell.z = col.type === "currency" ? "#,##0.00" : "0.##";
          }
        }
      }
    });

    // Auto-size columns
    ws["!cols"] = sheet.columns.map((col, colIdx) => {
      let maxLen = col.label.length;
      for (let r = 1; r < aoa.length; r++) {
        const v = aoa[r][colIdx];
        const s = v === null || v === undefined ? "" : String(v);
        if (s.length > maxLen) maxLen = s.length;
      }
      return { wch: Math.min(maxLen + 2, 60) };
    });

    let name = sanitizeSheetName(sheet.name);
    let suffix = 1;
    while (usedNames.has(name)) {
      name = sanitizeSheetName(`${sheet.name} ${++suffix}`);
    }
    usedNames.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${sanitizeFilename(data.title)}_${date}.xlsx`;
  XLSX.writeFile(wb, filename);
}

const PPT_BRAND_COLOR = "0F7EB5";
const PPT_TEXT_COLOR = "263238";
const PPT_MUTED_COLOR = "607D8B";

async function captureChartImage(node: HTMLElement): Promise<string | null> {
  try {
    return await toPng(node, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: "#ffffff",
    });
  } catch {
    return null;
  }
}

export async function exportReportToPptx(data: ReportExportData): Promise<void> {
  const t = (key: string, fallback: string, opts?: Record<string, unknown>): string =>
    i18n.t(`reports:${key}`, { defaultValue: fallback, ...opts });

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 inches
  pptx.title = data.title;

  const slideWidth = 13.333;
  const slideHeight = 7.5;
  const margin = 0.5;

  // Slide 1: combined title + chart
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: "FFFFFF" };

  titleSlide.addText(data.title, {
    x: margin,
    y: margin,
    w: slideWidth - 2 * margin,
    h: 0.7,
    fontSize: 28,
    bold: true,
    color: PPT_BRAND_COLOR,
    fontFace: "Calibri",
  });

  const generatedAt = new Date().toLocaleString(i18n.language);
  const subtitleParts: string[] = [
    t("export.titleSlide", "Generated {{date}}", { date: generatedAt }),
  ];
  if (data.filterSummary && data.filterSummary.length > 0) {
    const filtersText = data.filterSummary
      .map((f) => `${f.label}: ${f.value}`)
      .join("  •  ");
    subtitleParts.push(filtersText);
  } else if (data.subtitle) {
    subtitleParts.push(data.subtitle);
  }

  titleSlide.addText(subtitleParts.join("    "), {
    x: margin,
    y: margin + 0.7,
    w: slideWidth - 2 * margin,
    h: 0.45,
    fontSize: 12,
    color: PPT_MUTED_COLOR,
    fontFace: "Calibri",
  });

  // Chart area: lower ~70% of the slide
  const chartTop = margin + 1.3;
  const chartHeight = slideHeight - chartTop - margin;
  const chartWidth = slideWidth - 2 * margin;

  if (data.chartNode) {
    const dataUrl = await captureChartImage(data.chartNode);
    if (dataUrl) {
      titleSlide.addImage({
        data: dataUrl,
        x: margin,
        y: chartTop,
        w: chartWidth,
        h: chartHeight,
        sizing: { type: "contain", w: chartWidth, h: chartHeight },
      });
    } else {
      titleSlide.addText(t("export.chartUnavailable", "Chart preview unavailable."), {
        x: margin,
        y: chartTop,
        w: chartWidth,
        h: chartHeight,
        fontSize: 14,
        color: PPT_MUTED_COLOR,
        align: "center",
        valign: "middle",
        italic: true,
      });
    }
  }

  // Data slides: one (or more) per sheet
  const ROWS_PER_SLIDE = 22;
  for (const sheet of data.sheets) {
    if (sheet.rows.length === 0) continue;

    const totalPages = Math.max(1, Math.ceil(sheet.rows.length / ROWS_PER_SLIDE));
    for (let page = 0; page < totalPages; page++) {
      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };

      const headerSuffix =
        totalPages > 1
          ? ` — ${sheet.name} (${page + 1}/${totalPages})`
          : ` — ${sheet.name}`;
      slide.addText(`${data.title}${headerSuffix}`, {
        x: margin,
        y: margin,
        w: slideWidth - 2 * margin,
        h: 0.5,
        fontSize: 18,
        bold: true,
        color: PPT_BRAND_COLOR,
        fontFace: "Calibri",
      });

      const start = page * ROWS_PER_SLIDE;
      const end = Math.min(start + ROWS_PER_SLIDE, sheet.rows.length);
      const pageRows = sheet.rows.slice(start, end);

      const tableHeader = sheet.columns.map((c) => ({
        text: c.label,
        options: {
          bold: true,
          color: "FFFFFF",
          fill: { color: PPT_BRAND_COLOR },
          align: "left" as const,
        },
      }));

      const tableBody = pageRows.map((row) =>
        sheet.columns.map((c) => {
          const v = formatCellValue(row[c.key], c.type);
          let display: string;
          if (v === null || v === undefined || v === "") {
            display = "";
          } else if (typeof v === "number") {
            display =
              c.type === "currency"
                ? v.toLocaleString(i18n.language, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })
                : String(v);
          } else {
            display = String(v);
          }
          return {
            text: display,
            options: {
              color: PPT_TEXT_COLOR,
              align: (c.type === "number" || c.type === "currency"
                ? "right"
                : "left") as "left" | "right",
            },
          };
        }),
      );

      slide.addTable([tableHeader, ...tableBody], {
        x: margin,
        y: margin + 0.7,
        w: slideWidth - 2 * margin,
        fontSize: 10,
        fontFace: "Calibri",
        border: { type: "solid", pt: 0.5, color: "E0E0E0" },
        autoPage: false,
      });
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${sanitizeFilename(data.title)}_${date}.pptx`;
  await pptx.writeFile({ fileName: filename });
}
