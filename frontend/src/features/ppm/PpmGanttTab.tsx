import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import {
  Gantt,
  ViewMode,
  DateStartColumn,
  DateEndColumn,
  GanttDateRoundingTimeUnit,
} from "@wamra/gantt-task-react";
import type {
  Task,
  OnDateChange,
  OnProgressChange,
  OnRelationChange,
  Dependency,
  TaskOrEmpty,
  Column,
  ColumnProps,
  ContextMenuOptionType,
} from "@wamra/gantt-task-react";
import "@wamra/gantt-task-react/dist/style.css";
import Chip from "@mui/material/Chip";
import Popover from "@mui/material/Popover";
import Slider from "@mui/material/Slider";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import PpmWbsDialog from "./PpmWbsDialog";
import PpmTaskDialog from "./PpmTaskDialog";
import type { PpmDependency, PpmWbs, PpmTask, PpmTaskStatus } from "@/types";

/** Bar colors per task status — reuses the standard palette from PpmTaskBoard. */
const TASK_STATUS_BAR_COLORS: Record<
  PpmTaskStatus,
  {
    barBackgroundColor: string;
    barProgressColor: string;
    barBackgroundSelectedColor: string;
    barProgressSelectedColor: string;
  }
> = {
  todo: {
    barBackgroundColor: "#9e9e9e",
    barProgressColor: "#757575",
    barBackgroundSelectedColor: "#757575",
    barProgressSelectedColor: "#616161",
  },
  in_progress: {
    barBackgroundColor: "#90caf9",
    barProgressColor: "#1976d2",
    barBackgroundSelectedColor: "#1565c0",
    barProgressSelectedColor: "#1976d2",
  },
  done: {
    barBackgroundColor: "#a5d6a7",
    barProgressColor: "#2e7d32",
    barBackgroundSelectedColor: "#1b5e20",
    barProgressSelectedColor: "#2e7d32",
  },
  blocked: {
    barBackgroundColor: "#d32f2f",
    barProgressColor: "#c62828",
    barBackgroundSelectedColor: "#b71c1c",
    barProgressSelectedColor: "#c62828",
  },
};

/** Ordered view scale used by both the picker and the +/- zoom buttons.
 *  Index 0 = most zoomed-in (Day), last = most zoomed-out (Year). */
const VIEW_SCALE: ViewMode[] = [
  ViewMode.Day,
  ViewMode.Week,
  ViewMode.Month,
  ViewMode.QuarterYear,
  ViewMode.Year,
];

const VIEW_MODE_KEY = "ppm.gantt.viewMode";

function loadInitialViewMode(): ViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null;
    if (raw && VIEW_SCALE.includes(raw)) return raw;
  } catch {
    /* localStorage unavailable */
  }
  return ViewMode.Week;
}

/** Convert a Gantt task id ("task-uuid" / "wbs-uuid") to the API's
 *  (kind, id) pair. Returns null for the placeholder __empty__ row. */
function parseGanttId(
  ganttId: string,
): { kind: "task" | "wbs"; id: string } | null {
  if (ganttId.startsWith("task-")) return { kind: "task", id: ganttId.slice(5) };
  if (ganttId.startsWith("wbs-")) return { kind: "wbs", id: ganttId.slice(4) };
  return null;
}

/** Build the gantt task id for a (kind, id) pair from a PpmDependency. */
function depEndpointToGanttId(kind: "task" | "wbs", id: string): string {
  return `${kind}-${id}`;
}

/** Geometry passed from parent to the dependency overlay.
 *  Coordinates are in viewport pixels (i.e. `getBoundingClientRect`-relative). */
interface ArrowGeometry {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Visible-area top/bottom — arrows that escape this range are clipped. */
  clipTop: number;
  clipBottom: number;
}

interface DependencyArrowOverlayProps {
  arrows: ArrowGeometry[];
  buildPath: (fromX: number, fromY: number, toX: number, toY: number) => string;
  onClick: (depId: string) => void;
  color: string;
  dangerColor: string;
}

/** Custom SVG overlay that draws dependency arrows on top of the gantt
 *  chart. Sits as a `position: absolute` child of the gantt's `Box` so
 *  it inherits the gantt's clipping (overflow: hidden via the gantt's
 *  scroll container). Coordinates are stored as viewport-pixels by the
 *  parent and converted to overlay-local in `useLayoutEffect`. */
function DependencyArrowOverlay({
  arrows,
  buildPath,
  onClick,
  color,
  dangerColor: _dangerColor,
}: DependencyArrowOverlayProps) {
  const overlayRef = useRef<SVGSVGElement>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  // Convert the parent-supplied viewport coords to overlay-local on every
  // render — synchronous via useLayoutEffect so we don't paint the wrong
  // positions for one frame before correcting. Re-runs when `arrows`
  // changes, which the parent ticks on scroll / resize / data updates.
  useLayoutEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.left !== origin.x || rect.top !== origin.y) {
      setOrigin({ x: rect.left, y: rect.top });
    }
    // origin.x / .y intentionally omitted: comparing against stale state
    // is correct here, and including them would cause an infinite loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrows]);

  return (
    <svg
      ref={overlayRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 5,
      }}
    >
      <defs>
        <marker
          id="ppm-gantt-arrowhead"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      </defs>
      {arrows.map((a) => {
        const fromX = a.fromX - origin.x;
        const fromY = a.fromY - origin.y;
        const toX = a.toX - origin.x;
        const toY = a.toY - origin.y;
        const d = buildPath(fromX, fromY, toX, toY);
        const isHover = hoverId === a.id;
        return (
          <g key={a.id} style={{ pointerEvents: "auto", cursor: "pointer" }}>
            {/* Wide invisible hit target */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              onClick={() => onClick(a.id)}
              onMouseEnter={() => setHoverId(a.id)}
              onMouseLeave={() => setHoverId(null)}
            />
            {/* Visible arrow */}
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={isHover ? 2 : 1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              markerEnd="url(#ppm-gantt-arrowhead)"
              style={{ pointerEvents: "none", transition: "stroke-width 120ms" }}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Extra metadata for Gantt rows, keyed by gantt task id (e.g. "wbs-xxx", "task-xxx"). */
interface GanttRowMeta {
  completion: number;
  assigneeName: string | null;
  hasChildren: boolean;
}

interface Props {
  initiativeId: string;
  card?: { attributes?: Record<string, unknown> };
}

/** Derive timeline range from initiative card dates or sensible defaults. */
function deriveRange(card?: { attributes?: Record<string, unknown> }): {
  start: Date;
  end: Date;
} {
  const now = new Date();
  let start = new Date(now);
  start.setDate(start.getDate() - 14);
  let end = new Date(now);
  end.setDate(end.getDate() + 90);
  if (card?.attributes) {
    const s = card.attributes.startDate;
    const e = card.attributes.endDate;
    if (typeof s === "string" && s) {
      const d = parseDate(s, start);
      if (d !== start) start = d;
    }
    if (typeof e === "string" && e) {
      const d = parseDate(e, end);
      if (d !== end) end = d;
    }
  }
  return { start, end };
}

/** Parse a "YYYY-MM-DD" string as a local-timezone date at start-of-day. */
function parseDate(s: string | null, fallback: Date): Date {
  if (!s) return fallback;
  // "YYYY-MM-DD" → new Date() treats as UTC midnight, which can shift the day
  // in positive timezones. Split and construct as local date instead.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
  const d = new Date(s);
  if (isNaN(d.getTime())) return fallback;
  // Normalize to start-of-day local
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Snap a Date to start-of-day (00:00) in local timezone. */
function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** Snap a Date to end-of-day (23:59:59.999) in local timezone. */
function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

/** Format a Date to "YYYY-MM-DD" using local date components (not UTC). */
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Round a date to day boundaries during drag/resize.
 *  The library passes (date, viewMode, dateExtremity, action). Snap start→00:00, end→23:59. */
function roundToDay(
  date: Date,
  _viewMode?: ViewMode,
  dateExtremity?: string,
): Date {
  if (dateExtremity === "endOfTask") return endOfDay(date);
  return startOfDay(date);
}

/** Check if a date falls on Saturday or Sunday (unused params from library API). */
function checkIsWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** Build a set of WBS IDs that have at least one child. */
function getParentIds(wbsList: PpmWbs[], tasks: PpmTask[]): Set<string> {
  const ids = new Set<string>();
  for (const w of wbsList) {
    if (w.parent_id) ids.add(w.parent_id);
  }
  for (const t of tasks) {
    if (t.wbs_id) ids.add(t.wbs_id);
  }
  return ids;
}

export default function PpmGanttTab({ initiativeId, card }: Props) {
  const { t } = useTranslation("ppm");
  const theme = useTheme();

  const [wbsList, setWbsList] = useState<PpmWbs[]>([]);
  const [tasks, setTasks] = useState<PpmTask[]>([]);
  const [dependencies, setDependencies] = useState<PpmDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, _setViewMode] = useState<ViewMode>(() => loadInitialViewMode());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [snack, setSnack] = useState<string>("");

  /** Persist scale changes so they survive a reload. */
  const setViewMode = useCallback((mode: ViewMode) => {
    _setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  const viewIndex = VIEW_SCALE.indexOf(viewMode);
  const canZoomIn = viewIndex > 0;
  const canZoomOut = viewIndex >= 0 && viewIndex < VIEW_SCALE.length - 1;

  // WBS dialog state
  const [wbsDialogOpen, setWbsDialogOpen] = useState(false);
  const [editingWbs, setEditingWbs] = useState<PpmWbs | undefined>();

  // Milestone default for new WBS
  const [milestoneDefault, setMilestoneDefault] = useState(false);

  // Task dialog state
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<PpmTask | undefined>();
  const [preselectedWbsId, setPreselectedWbsId] = useState<string>("");

  /** Compute a sensible default start date for new items: today if in range, else range start. */
  const defaultNewDate = useMemo(() => {
    const now = new Date();
    const range = deriveRange(card);
    if (now >= range.start && now <= range.end) return toIso(now);
    return toIso(range.start);
  }, [card]);

  // Today button → scroll gantt to current date
  const [viewDate, setViewDate] = useState<Date | undefined>();

  // Initiative timeline range
  const timelineRange = useMemo(() => deriveRange(card), [card]);

  const loadData = useCallback(async () => {
    try {
      const [w, t, d] = await Promise.all([
        api.get<PpmWbs[]>(`/ppm/initiatives/${initiativeId}/wbs`),
        api.get<PpmTask[]>(`/ppm/initiatives/${initiativeId}/tasks`),
        api.get<PpmDependency[]>(`/ppm/initiatives/${initiativeId}/dependencies`),
      ]);
      setWbsList(w);
      setTasks(t);
      setDependencies(d);
    } finally {
      setLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /** Set of WBS IDs that have children (completion auto-rolled up). */
  const parentIds = useMemo(() => getParentIds(wbsList, tasks), [wbsList, tasks]);

  /** Per-successor list of arrows the library should draw.
   *  Library shape: { sourceId, sourceTarget: "endOfTask", ownTarget: "startOfTask" }
   *  for finish-to-start. */
  const depsBySuccessor = useMemo(() => {
    const map = new Map<string, Dependency[]>();
    for (const d of dependencies) {
      const succGanttId = depEndpointToGanttId(d.succ_kind, d.succ_id);
      const predGanttId = depEndpointToGanttId(d.pred_kind, d.pred_id);
      const arr = map.get(succGanttId) ?? [];
      arr.push({
        sourceId: predGanttId,
        sourceTarget: "endOfTask",
        ownTarget: "startOfTask",
      });
      map.set(succGanttId, arr);
    }
    return map;
  }, [dependencies]);

  /** Map WBS + Tasks → gantt-task-react Task[] with trailing empty row. */
  const ganttTasks: TaskOrEmpty[] = useMemo(() => {
    const items: TaskOrEmpty[] = [];
    const defStart = timelineRange.start;
    const defEnd = timelineRange.end;

    // WBS items as "project" or "milestone" type
    for (const w of wbsList) {
      const wbsId = `wbs-${w.id}`;
      const start = startOfDay(parseDate(w.start_date, defStart));
      const deps = depsBySuccessor.get(wbsId);
      if (w.is_milestone) {
        items.push({
          id: wbsId,
          name: w.title,
          type: "milestone",
          start,
          end: start,
          progress: w.completion,
          parent: w.parent_id ? `wbs-${w.parent_id}` : undefined,
          dependencies: deps,
          isDisabled: false,
        });
      } else {
        let end = endOfDay(parseDate(w.end_date, defEnd));
        if (end <= start) {
          end = endOfDay(new Date(start));
          end.setDate(end.getDate() + 7);
        }
        items.push({
          id: wbsId,
          name: w.title,
          type: "project",
          start,
          end,
          progress: w.completion,
          parent: w.parent_id ? `wbs-${w.parent_id}` : undefined,
          hideChildren: collapsed.has(w.id),
          dependencies: deps,
          isDisabled: false,
          styles: {
            projectBackgroundColor: theme.palette.primary.light,
            projectProgressColor: theme.palette.primary.main,
            projectBackgroundSelectedColor: theme.palette.primary.dark,
            projectProgressSelectedColor: theme.palette.primary.main,
          },
        });
      }
    }

    // Tasks as "task" type
    for (const tk of tasks) {
      const taskId = `task-${tk.id}`;
      const start = startOfDay(
        parseDate(tk.start_date, parseDate(tk.created_at, defStart)),
      );
      let end = endOfDay(
        parseDate(tk.due_date, new Date(start.getTime() + 7 * 86400000)),
      );
      if (end <= start) {
        end = endOfDay(new Date(start));
        end.setDate(end.getDate() + 1);
      }
      const progress =
        tk.status === "done" ? 100 : tk.status === "in_progress" ? 50 : 0;
      const barColors = TASK_STATUS_BAR_COLORS[tk.status] ?? TASK_STATUS_BAR_COLORS.todo;
      items.push({
        id: taskId,
        name: tk.title,
        type: "task",
        start,
        end,
        progress,
        parent: tk.wbs_id ? `wbs-${tk.wbs_id}` : undefined,
        dependencies: depsBySuccessor.get(taskId),
        isDisabled: false,
        styles: barColors,
      });
    }

    // Always add an empty row at the bottom for creating new items
    items.push({
      id: "__empty__",
      type: "empty",
      name: "",
    });

    return items;
  }, [wbsList, tasks, collapsed, theme, timelineRange, depsBySuccessor]);

  /** Metadata map for custom Gantt columns (completion, assignee). */
  const rowMeta = useMemo(() => {
    const map = new Map<string, GanttRowMeta>();
    for (const w of wbsList) {
      map.set(`wbs-${w.id}`, {
        completion: w.completion,
        assigneeName: w.assignee_name,
        hasChildren: parentIds.has(w.id),
      });
    }
    for (const tk of tasks) {
      const pct =
        tk.status === "done" ? 100 : tk.status === "in_progress" ? 50 : 0;
      map.set(`task-${tk.id}`, {
        completion: pct,
        assigneeName: tk.assignee_name,
        hasChildren: false,
      });
    }
    return map;
  }, [wbsList, tasks, parentIds]);

  const handleDateChange: OnDateChange = useCallback(
    async (task) => {
      if (!("start" in task)) return;
      const t = task as Task;
      const id = t.id;
      const newStart = toIso(t.start);
      const newEnd = toIso(t.end);

      // Optimistic local update — prevents the bar from jumping back to old dates
      if (id.startsWith("wbs-")) {
        const realId = id.slice(4);
        setWbsList((prev) =>
          prev.map((w) =>
            w.id === realId ? { ...w, start_date: newStart, end_date: newEnd } : w,
          ),
        );
        api.patch(`/ppm/wbs/${realId}`, { start_date: newStart, end_date: newEnd }).then(loadData);
      } else if (id.startsWith("task-")) {
        const realId = id.slice(5);
        setTasks((prev) =>
          prev.map((tk) =>
            tk.id === realId ? { ...tk, start_date: newStart, due_date: newEnd } : tk,
          ),
        );
        api.patch(`/ppm/tasks/${realId}`, { start_date: newStart, due_date: newEnd }).then(loadData);
      }
    },
    [loadData],
  );

  const handleProgressChange: OnProgressChange = useCallback(
    async (task) => {
      const id = task.id;
      if (id.startsWith("wbs-")) {
        // Only allow progress change on leaf WBS (no children)
        if (parentIds.has(id.slice(4))) return;
        const realId = id.slice(4);
        await api.patch(`/ppm/wbs/${realId}`, {
          completion: Math.round(task.progress),
        });
        await loadData();
      }
    },
    [loadData, parentIds],
  );

  /** Drag-create a finish-to-start dependency by connecting the relation handles.
   *  The library passes `isOneDescendant=true` when one row is a descendant of
   *  the other in the WBS hierarchy — a parent-child link doesn't model a
   *  meaningful schedule dependency (and would create implicit cycles via the
   *  WBS rollup), so skip those drags silently. */
  const handleRelationChange: OnRelationChange = useCallback(
    async (from, to, isOneDescendant) => {
      if (isOneDescendant) {
        setSnack(t("dependencyCycleError"));
        return;
      }
      const [fromTask, fromTarget] = from;
      const [toTask] = to;
      // We only model FS today: predecessor's "endOfTask" → successor's "startOfTask".
      // If the user dragged backwards (left dot first, right dot second), swap roles.
      const [predTask, succTask] =
        fromTarget === "endOfTask" ? [fromTask, toTask] : [toTask, fromTask];
      const pred = parseGanttId(predTask.id);
      const succ = parseGanttId(succTask.id);
      if (!pred || !succ) return;
      try {
        await api.post(`/ppm/initiatives/${initiativeId}/dependencies`, {
          pred_kind: pred.kind,
          pred_id: pred.id,
          succ_kind: succ.kind,
          succ_id: succ.id,
        });
        await loadData();
        setSnack(t("dependencyCreated"));
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 409) setSnack(t("dependencyDuplicateError"));
          else if (err.status === 422) setSnack(t("dependencyCycleError"));
          else setSnack(err.message || t("dependencyCreateFailed"));
        } else {
          setSnack(t("dependencyCreateFailed"));
        }
      }
    },
    [initiativeId, loadData, t],
  );

  const ganttRef = useRef<HTMLDivElement>(null);

  /** Open dialog for a given gantt task id. */
  const openDialogForId = useCallback(
    (id: string) => {
      if (id.startsWith("wbs-")) {
        const realId = id.slice(4);
        const wbs = wbsList.find((w) => w.id === realId);
        if (wbs) {
          setEditingWbs(wbs);
          setWbsDialogOpen(true);
        }
      } else if (id.startsWith("task-")) {
        const realId = id.slice(5);
        const tk = tasks.find((t) => t.id === realId);
        if (tk) {
          setEditingTask(tk);
          setTaskDialogOpen(true);
        }
      }
    },
    [wbsList, tasks],
  );

  /**
   * Double-click on SVG bar opens the edit dialog.
   * We intentionally do NOT use onClick — the library fires it synchronously
   * inside onMouseDown, making it impossible to distinguish clicks from drags.
   */
  const handleDoubleClick = useCallback(
    (task: Task) => openDialogForId(task.id),
    [openDialogForId],
  );

  const handleExpanderClick = useCallback((task: Task) => {
    const id = task.id;
    if (id.startsWith("wbs-")) {
      const realId = id.slice(4);
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(realId)) next.delete(realId);
        else next.add(realId);
        return next;
      });
    }
  }, []);

  const contextMenuOptions: ContextMenuOptionType[] = useMemo(
    () => [
      {
        label: t("common:actions.edit", "Edit"),
        icon: <MaterialSymbol icon="edit" size={16} />,
        action: (meta) => openDialogForId(meta.task.id),
      },
      {
        label: t("addTaskUnderWbs"),
        icon: <MaterialSymbol icon="add_task" size={16} />,
        action: (meta) => {
          if (!meta.task.id.startsWith("wbs-")) return;
          const wbsRealId = meta.task.id.slice(4);
          setEditingTask(undefined);
          setPreselectedWbsId(wbsRealId);
          setTaskDialogOpen(true);
        },
        checkIsAvailable: (meta) => meta.task.id.startsWith("wbs-"),
      },
      {
        label: t("addWbs"),
        icon: <MaterialSymbol icon="add" size={16} />,
        action: () => {
          setEditingWbs(undefined);
          setMilestoneDefault(false);
          setWbsDialogOpen(true);
        },
      },
      {
        label: t("addMilestone"),
        icon: <MaterialSymbol icon="flag" size={16} />,
        action: () => {
          setEditingWbs(undefined);
          setMilestoneDefault(true);
          setWbsDialogOpen(true);
        },
      },
      {
        label: t("markDone"),
        icon: <MaterialSymbol icon="check_circle" size={16} />,
        action: async (meta) => {
          const id = meta.task.id;
          if (id.startsWith("task-")) {
            await api.patch(`/ppm/tasks/${id.slice(5)}`, { status: "done" });
          } else if (id.startsWith("wbs-")) {
            await api.patch(`/ppm/wbs/${id.slice(4)}`, { completion: 100 });
          }
          await loadData();
        },
      },
      {
        label: t("common:actions.delete", "Delete"),
        icon: <MaterialSymbol icon="delete" size={16} />,
        action: async (meta) => {
          const id = meta.task.id;
          if (id.startsWith("wbs-")) {
            if (!window.confirm(t("confirmDeleteWbs"))) return;
            await api.delete(`/ppm/wbs/${id.slice(4)}`);
          } else if (id.startsWith("task-")) {
            if (!window.confirm(t("confirmDeleteTask"))) return;
            await api.delete(`/ppm/tasks/${id.slice(5)}`);
          }
          await loadData();
        },
      },
    ],
    [t, openDialogForId, loadData],
  );

  /** State for inline completion slider popover. */
  const [completionAnchor, setCompletionAnchor] =
    useState<HTMLElement | null>(null);
  const [completionEditId, setCompletionEditId] = useState("");
  const [completionEditValue, setCompletionEditValue] = useState(0);

  const handleCompletionSave = useCallback(
    async (val: number) => {
      const id = completionEditId;
      if (id.startsWith("wbs-")) {
        await api.patch(`/ppm/wbs/${id.slice(4)}`, { completion: val });
      } else if (id.startsWith("task-")) {
        const status = val >= 100 ? "done" : val > 0 ? "in_progress" : "todo";
        await api.patch(`/ppm/tasks/${id.slice(5)}`, { status });
      }
      await loadData();
    },
    [completionEditId, loadData],
  );

  /** Custom title column: name is clickable (opens edit dialog), plus
   *  expander arrow for WBS parents. Avoids the library's broken onClick. */
  const NameCell = useMemo(() => {
    const Cell = ({ data }: ColumnProps) => {
      const {
        task,
        hasChildren,
        isClosed,
        depth,
        onExpanderClick,
        distances: { expandIconWidth, nestedTaskNameOffset },
      } = data;
      const handleExpand = () => {
        if (task.type !== "empty") onExpanderClick(task as Task);
      };
      const handleNameClick = (e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        if (task.id === "__empty__") {
          setEditingWbs(undefined);
          setMilestoneDefault(false);
          setWbsDialogOpen(true);
          return;
        }
        openDialogForId(task.id);
      };
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            paddingLeft: depth * nestedTaskNameOffset,
            height: "100%",
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: expandIconWidth,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: hasChildren ? "pointer" : "default",
            }}
            onClick={handleExpand}
          >
            {hasChildren ? (isClosed ? "▶" : "▼") : ""}
          </div>
          <div
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
            onClick={handleNameClick}
            title={task.name}
          >
            {task.name || (task.id === "__empty__" ? "+" : "")}
          </div>
        </div>
      );
    };
    Cell.displayName = "NameCell";
    return Cell;
  }, [openDialogForId]);

  /** Custom column: completion % chip — click to edit with slider popover.
   *  Parent WBS items (with children) show a read-only calculated value. */
  const CompletionCell = useMemo(() => {
    const Cell = ({ data }: ColumnProps) => {
      const meta = rowMeta.get(data.task.id);
      if (!meta) return null;
      const pct = Math.round(meta.completion);
      const isCalculated = meta.hasChildren;
      return (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            cursor: isCalculated ? "default" : "pointer",
          }}
          onClick={
            isCalculated
              ? undefined
              : (e) => {
                  e.stopPropagation();
                  setCompletionEditId(data.task.id);
                  setCompletionEditValue(pct);
                  setCompletionAnchor(e.currentTarget);
                }
          }
        >
          <Chip
            label={`${pct}%`}
            size="small"
            sx={{
              height: 20,
              fontSize: 11,
              fontWeight: 600,
              opacity: isCalculated ? 0.7 : 1,
            }}
            color={pct >= 100 ? "success" : pct > 0 ? "primary" : "default"}
            variant={isCalculated ? "outlined" : "filled"}
          />
        </Box>
      );
    };
    Cell.displayName = "CompletionCell";
    return Cell;
  }, [rowMeta]);

  /** Custom column: assignee name. */
  const AssigneeCell = useMemo(() => {
    const Cell = ({ data }: ColumnProps) => {
      const meta = rowMeta.get(data.task.id);
      if (!meta?.assigneeName) return null;
      return (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            px: 1,
            height: "100%",
            fontSize: 13,
            color: "text.secondary",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {meta.assigneeName}
        </Box>
      );
    };
    Cell.displayName = "AssigneeCell";
    return Cell;
  }, [rowMeta]);

  const ganttColumns: Column[] = useMemo(
    () => [
      {
        id: "title",
        Cell: NameCell,
        width: 200,
        title: t("wbsTitle"),
        canResize: true,
      },
      {
        id: "completion",
        Cell: CompletionCell,
        width: 56,
        title: "%",
        canResize: false,
      },
      {
        id: "assignee",
        Cell: AssigneeCell,
        width: 100,
        title: t("wbsAssignee"),
        canResize: true,
      },
      {
        id: "start",
        Cell: DateStartColumn,
        width: 90,
        title: t("startDate"),
        canResize: true,
      },
      {
        id: "end",
        Cell: DateEndColumn,
        width: 90,
        title: t("endDate"),
        canResize: true,
      },
    ],
    [t, NameCell, CompletionCell, AssigneeCell],
  );

  const columnWidth = useMemo(() => {
    switch (viewMode) {
      case ViewMode.Day:
        return 32;
      case ViewMode.Week:
        return 200;
      case ViewMode.Month:
        return 300;
      case ViewMode.QuarterYear:
        return 180;
      case ViewMode.Year:
        return 240;
      default:
        return 200;
    }
  }, [viewMode]);

  /**
   * Context menu dismiss workaround: the library's ContextMenu uses floating-ui
   * useDismiss but never wires onOpenChange, so outside clicks / escape don't
   * close it. We inject a CSS class to hide it and use a MutationObserver to
   * detect when the library re-renders the menu (which removes our class).
   */
  const ctxMenuHiddenClass = useRef<string>("");
  useEffect(() => {
    // Inject a one-time stylesheet rule for hiding
    if (!ctxMenuHiddenClass.current) {
      ctxMenuHiddenClass.current = "__gantt_ctx_hidden";
      const style = document.createElement("style");
      style.textContent = `
        .${ctxMenuHiddenClass.current} {
          visibility: hidden !important;
          pointer-events: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    const el = ganttRef.current;
    if (!el) return;

    /** Find all visible context menu floating containers inside the gantt. */
    const findMenuContainers = (): HTMLElement[] => {
      const results: HTMLElement[] = [];
      // The menu options have a class containing "menuOption_"
      const opts = el.querySelectorAll('[class*="menuOption_"]');
      const seen = new Set<HTMLElement>();
      opts.forEach((opt) => {
        let parent = opt.parentElement;
        while (parent && parent !== el) {
          if (
            (parent.style.position === "fixed" ||
              parent.style.position === "absolute") &&
            parent.style.boxShadow
          ) {
            if (!seen.has(parent)) {
              seen.add(parent);
              results.push(parent);
            }
            break;
          }
          parent = parent.parentElement;
        }
      });
      return results;
    };

    const hideContextMenu = () => {
      const cls = ctxMenuHiddenClass.current;
      for (const container of findMenuContainers()) {
        container.classList.add(cls);
      }
    };

    const isInsideMenu = (target: Node): boolean => {
      for (const container of findMenuContainers()) {
        if (
          !container.classList.contains(ctxMenuHiddenClass.current) &&
          container.contains(target)
        ) {
          return true;
        }
      }
      return false;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!isInsideMenu(e.target as Node)) hideContextMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideContextMenu();
    };
    // Also hide on scroll anywhere
    const onScroll = () => hideContextMenu();

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  /**
   * When the library re-renders the ContextMenu (on right-click), it creates new
   * DOM elements that don't have our hidden class. A MutationObserver detects this
   * so the menu appears fresh each time it's opened.
   * We also remove the hidden class proactively on contextmenu events.
   */
  useEffect(() => {
    const el = ganttRef.current;
    if (!el) return;
    const cls = ctxMenuHiddenClass.current;

    // On right-click inside the gantt, un-hide so the new menu is visible
    const onContextMenu = () => {
      el.querySelectorAll(`.${cls}`).forEach((node) => {
        node.classList.remove(cls);
      });
    };
    el.addEventListener("contextmenu", onContextMenu);
    return () => el.removeEventListener("contextmenu", onContextMenu);
  }, []);

  /**
   * Touch-scroll workaround: the gantt-task-react library attaches a touchmove
   * handler on the SVG that unconditionally calls preventDefault(), blocking
   * native touch scroll. We intercept in the capture phase with a NON-PASSIVE
   * handler and call stopImmediatePropagation() to prevent the library's
   * handler from firing when the user is scrolling (not dragging a bar).
   */
  useEffect(() => {
    const el = ganttRef.current;
    if (!el) return;

    let scrollContainer: HTMLElement | null = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let scrollStartLeft = 0;
    let scrollMode: "none" | "scroll" | "bar" = "none";
    const DEADZONE = 8; // px before deciding scroll vs bar drag

    const findScrollContainer = (): HTMLElement | null => {
      if (scrollContainer) return scrollContainer;
      scrollContainer = el.querySelector(
        '[class*="ganttTaskRoot"]',
      ) as HTMLElement | null;
      return scrollContainer;
    };

    const isBarElement = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return (
        target.closest(
          '[class*="barWrapper"], [class*="projectWrapper"], [class*="milestoneWrapper"], [class*="barHandle"]',
        ) !== null
      );
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (isBarElement(e.target)) {
        scrollMode = "bar";
        return;
      }
      const sc = findScrollContainer();
      if (!sc) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      scrollStartLeft = sc.scrollLeft;
      scrollMode = "none"; // undecided until deadzone exceeded
    };

    const onTouchMove = (e: TouchEvent) => {
      if (scrollMode === "bar" || e.touches.length !== 1) return;

      const dx = touchStartX - e.touches[0].clientX;
      const dy = touchStartY - e.touches[0].clientY;

      if (scrollMode === "none") {
        // Still in deadzone — wait until movement exceeds threshold
        if (Math.abs(dx) < DEADZONE && Math.abs(dy) < DEADZONE) return;
        // If predominantly vertical, let page scroll naturally
        if (Math.abs(dy) > Math.abs(dx)) {
          scrollMode = "bar"; // give up — let default behavior handle it
          return;
        }
        scrollMode = "scroll";
      }

      // Stop the library's touchmove handler from calling preventDefault()
      e.stopImmediatePropagation();
      e.preventDefault();

      const sc = findScrollContainer();
      if (sc) sc.scrollLeft = scrollStartLeft + dx;
    };

    const onTouchEnd = () => {
      scrollMode = "none";
    };

    el.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    // MUST be non-passive so stopImmediatePropagation + preventDefault work
    el.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    el.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart, true);
      el.removeEventListener("touchmove", onTouchMove, true);
      el.removeEventListener("touchend", onTouchEnd, true);
    };
  }, []);

  /**
   * Vertical scroll synchronization: the gantt library renders the left table
   * (ganttTableWrapper_) and right timeline (ganttTaskContent_) as separate
   * scrollable containers. On iPad, native touch scroll targets each
   * independently, causing vertical misalignment. We sync their scrollTop
   * values via scroll event listeners with a guard flag to prevent infinite
   * feedback loops.
   */
  useEffect(() => {
    const el = ganttRef.current;
    if (!el) return;

    let tableWrapper: HTMLElement | null = null;
    let taskContent: HTMLElement | null = null;
    let isSyncing = false;
    let cleanedUp = false;

    const onTableScroll = () => {
      if (isSyncing || !taskContent || !tableWrapper) return;
      isSyncing = true;
      taskContent.scrollTop = tableWrapper.scrollTop;
      requestAnimationFrame(() => {
        isSyncing = false;
      });
    };

    const onTaskContentScroll = () => {
      if (isSyncing || !taskContent || !tableWrapper) return;
      isSyncing = true;
      tableWrapper.scrollTop = taskContent.scrollTop;
      requestAnimationFrame(() => {
        isSyncing = false;
      });
    };

    const attach = (): boolean => {
      tableWrapper = el.querySelector(
        '[class*="ganttTableWrapper_"]',
      ) as HTMLElement | null;
      taskContent = el.querySelector(
        '[class*="ganttTaskContent_"]',
      ) as HTMLElement | null;
      if (tableWrapper && taskContent) {
        tableWrapper.addEventListener("scroll", onTableScroll, {
          passive: true,
        });
        taskContent.addEventListener("scroll", onTaskContentScroll, {
          passive: true,
        });
        return true;
      }
      return false;
    };

    // If containers aren't in the DOM yet, watch for them
    let observer: MutationObserver | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (!attach() && !cleanedUp) {
      observer = new MutationObserver(() => {
        if (attach()) observer!.disconnect();
      });
      observer.observe(el, { childList: true, subtree: true });
      timeout = setTimeout(() => observer!.disconnect(), 5000);
    }

    return () => {
      cleanedUp = true;
      observer?.disconnect();
      if (timeout) clearTimeout(timeout);
      if (tableWrapper)
        tableWrapper.removeEventListener("scroll", onTableScroll);
      if (taskContent)
        taskContent.removeEventListener("scroll", onTaskContentScroll);
    };
  }, []);

  /**
   * Custom dependency arrow overlay.
   *
   * The underlying gantt library renders dependency arrows as a hard-coded
   * 5-segment staircase with sharp 90° corners and exposes no override.
   * We hide its arrows via CSS (see `arrow_clickable_*` rule below) and
   * draw our own arrows in an absolute-positioned `<svg>` overlay sitting
   * on top of the gantt. Routing follows the milestone-planner project's
   * conventions:
   *   • Forward case (predecessor ends before successor starts): three
   *     segments H–V–H with two rounded corners (SVG arc, r = 6px).
   *   • Loop-back case (overlapping bars): five segments routing around
   *     to the LEFT of both bars, with four rounded corners.
   *   • Same-row case: a single horizontal segment.
   *
   * Coordinates come from `getBoundingClientRect()` of each bar's
   * `<rect class="barBackground_">`, looked up by the per-task SVG's DOM
   * `id` (which the library sets to our gantt task id, e.g. `task-uuid`
   * or `wbs-uuid`). A `tick` counter triggers re-measurement on:
   *   - dependency / data / view-mode changes
   *   - scroll inside either gantt scroll container
   *   - any size change of the gantt or its parents (ResizeObserver)
   *   - mutations to the gantt subtree (catches the lib's animation frames)
   */
  const [arrowTick, setArrowTick] = useState(0);

  useEffect(() => {
    const el = ganttRef.current;
    if (!el) return;
    let raf = 0;
    const bump = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setArrowTick((t) => t + 1));
    };

    // Trigger one measurement after first paint (lib renders bars asynchronously)
    bump();

    const scrollContainers = [
      el.querySelector("[class*='ganttTaskContent_']"),
      el.querySelector("[class*='ganttTaskRoot_']"),
      el.querySelector("[class*='ganttTableWrapper_']"),
    ].filter(Boolean) as HTMLElement[];
    scrollContainers.forEach((c) =>
      c.addEventListener("scroll", bump, { passive: true }),
    );

    const resize = new ResizeObserver(bump);
    resize.observe(el);

    // Catch lib re-renders (drags, view-mode changes) that move bars without scroll
    const mut = new MutationObserver(bump);
    mut.observe(el, { childList: true, subtree: true, attributes: true });

    return () => {
      cancelAnimationFrame(raf);
      scrollContainers.forEach((c) => c.removeEventListener("scroll", bump));
      resize.disconnect();
      mut.disconnect();
    };
  }, []);

  /** Compute pixel coords for every dependency arrow.  Returns viewport-
   *  relative coordinates we then translate to overlay-local in render. */
  const arrowGeometry = useMemo(() => {
    void arrowTick; // re-run when DOM-derived data may have shifted
    const el = ganttRef.current;
    if (!el) return [] as Array<{
      id: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      clipTop: number;
      clipBottom: number;
    }>;

    // Gantt scroll viewport — used to clip arrows to the visible area.
    const viewportEl =
      el.querySelector("[class*='ganttTaskContent_']") ?? el;
    const viewport = viewportEl.getBoundingClientRect();

    const out: Array<{
      id: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      clipTop: number;
      clipBottom: number;
    }> = [];

    for (const d of dependencies) {
      const predId = `${d.pred_kind === "task" ? "task" : "wbs"}-${d.pred_id}`;
      const succId = `${d.succ_kind === "task" ? "task" : "wbs"}-${d.succ_id}`;
      const predEl = document.getElementById(predId);
      const succEl = document.getElementById(succId);
      if (!predEl || !succEl) continue;
      const predBar = predEl.querySelector("[class*='barBackground_']");
      const succBar = succEl.querySelector("[class*='barBackground_']");
      if (!(predBar instanceof Element) || !(succBar instanceof Element)) continue;
      const pr = predBar.getBoundingClientRect();
      const sr = succBar.getBoundingClientRect();
      if (pr.width === 0 || sr.width === 0) continue;
      out.push({
        id: d.id,
        fromX: pr.right,
        fromY: pr.top + pr.height / 2,
        toX: sr.left,
        toY: sr.top + sr.height / 2,
        clipTop: viewport.top,
        clipBottom: viewport.bottom,
      });
    }
    return out;
  }, [dependencies, arrowTick]);

  /** Build the SVG path for one arrow.  Coordinates are already overlay-local. */
  const buildArrowPath = useCallback(
    (fromX: number, fromY: number, toX: number, toY: number): string => {
      const RADIUS = 6;
      const STUB = 14; // horizontal exit/entry length for loop-back routing
      const DETOUR_PAD = 18; // gap between detour line and bars

      // Same row → one straight segment
      if (Math.abs(toY - fromY) < 1) {
        return `M ${fromX} ${fromY} H ${toX}`;
      }

      const vDir = toY > fromY ? 1 : -1; // +1 down, -1 up

      // Forward routing — clean 3-segment H/V/H with 2 rounded corners
      if (toX > fromX + 2 * RADIUS) {
        const midX = (fromX + toX) / 2;
        const r = Math.min(
          RADIUS,
          (toX - fromX) / 4,
          Math.abs(toY - fromY) / 2,
        );
        if (r < 1) {
          return `M ${fromX} ${fromY} H ${midX} V ${toY} H ${toX}`;
        }
        // sweep flags: R→D=1, D→R=0; flip both for vDir=-1
        const s1 = vDir > 0 ? 1 : 0;
        const s2 = vDir > 0 ? 0 : 1;
        return [
          `M ${fromX} ${fromY}`,
          `H ${midX - r}`,
          `A ${r} ${r} 0 0 ${s1} ${midX} ${fromY + vDir * r}`,
          `V ${toY - vDir * r}`,
          `A ${r} ${r} 0 0 ${s2} ${midX + r} ${toY}`,
          `H ${toX}`,
        ].join(" ");
      }

      // Loop-back — exit right, drop past source row, run LEFT past both
      // bars, drop to target row, re-enter target.
      const r = RADIUS;
      const exitX = fromX + STUB;
      const turnY = fromY + vDir * STUB;
      const detourX = Math.min(fromX, toX) - DETOUR_PAD;
      // Sweep flags by direction:
      //   vDir +1 (down):  R→D=1, D→L=1, L→D=0, D→R=0
      //   vDir -1 (up):    R→U=0, U→L=0, L→U=1, U→R=1
      const s1 = vDir > 0 ? 1 : 0;
      const s2 = vDir > 0 ? 1 : 0;
      const s3 = vDir > 0 ? 0 : 1;
      const s4 = vDir > 0 ? 0 : 1;
      return [
        `M ${fromX} ${fromY}`,
        `H ${exitX - r}`,
        `A ${r} ${r} 0 0 ${s1} ${exitX} ${fromY + vDir * r}`,
        `V ${turnY - vDir * r}`,
        `A ${r} ${r} 0 0 ${s2} ${exitX - r} ${turnY}`,
        `H ${detourX + r}`,
        `A ${r} ${r} 0 0 ${s3} ${detourX} ${turnY + vDir * r}`,
        `V ${toY - vDir * r}`,
        `A ${r} ${r} 0 0 ${s4} ${detourX + r} ${toY}`,
        `H ${toX}`,
      ].join(" ");
    },
    [],
  );

  /** Click handler for arrows: confirm + delete. */
  const handleArrowClick = useCallback(
    async (depId: string) => {
      if (!window.confirm(t("confirmDeleteDependency"))) return;
      try {
        await api.delete(`/ppm/dependencies/${depId}`);
        await loadData();
        setSnack(t("dependencyDeleted"));
      } catch {
        setSnack(t("dependencyDeleteFailed"));
      }
    },
    [loadData, t],
  );

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ mx: { xs: -2, md: -3 } }}>
      {/* Toolbar */}
      <Box
        display="flex"
        alignItems="center"
        gap={1}
        mb={2}
        flexWrap="wrap"
        px={{ xs: 2, md: 3 }}
      >
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => {
            setEditingWbs(undefined);
            setMilestoneDefault(false);
            setWbsDialogOpen(true);
          }}
        >
          {t("addWbs")}
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<MaterialSymbol icon="flag" size={18} />}
          onClick={() => {
            setEditingWbs(undefined);
            setMilestoneDefault(true);
            setWbsDialogOpen(true);
          }}
        >
          {t("addMilestone")}
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<MaterialSymbol icon="add_task" size={18} />}
          onClick={() => {
            setEditingTask(undefined);
            setPreselectedWbsId("");
            setTaskDialogOpen(true);
          }}
        >
          {t("createTask")}
        </Button>
        <Box flex={1} />
        <Tooltip title={t("today")}>
          <IconButton size="small" onClick={() => setViewDate(new Date())}>
            <MaterialSymbol icon="today" size={20} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("zoomIn")}>
          {/* span avoids MUI Tooltip warning when the IconButton is disabled */}
          <span>
            <IconButton
              size="small"
              disabled={!canZoomIn}
              onClick={() => setViewMode(VIEW_SCALE[viewIndex - 1])}
            >
              <MaterialSymbol icon="zoom_in" size={20} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("zoomOut")}>
          <span>
            <IconButton
              size="small"
              disabled={!canZoomOut}
              onClick={() => setViewMode(VIEW_SCALE[viewIndex + 1])}
            >
              <MaterialSymbol icon="zoom_out" size={20} />
            </IconButton>
          </span>
        </Tooltip>
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, v) => v && setViewMode(v)}
          size="small"
        >
          <ToggleButton value={ViewMode.Day}>{t("viewDay")}</ToggleButton>
          <ToggleButton value={ViewMode.Week}>{t("viewWeek")}</ToggleButton>
          <ToggleButton value={ViewMode.Month}>{t("viewMonth")}</ToggleButton>
          <ToggleButton value={ViewMode.QuarterYear}>{t("viewQuarter")}</ToggleButton>
          <ToggleButton value={ViewMode.Year}>{t("viewYear")}</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Gantt Chart — always shown, with empty row at bottom */}
      <Box
        ref={ganttRef}
        sx={{
          position: "relative",
          /* ── Base styles ── */
          "& .ganttTable": { fontFamily: theme.typography.fontFamily },
          "& .ganttTable_Header": {
            borderBottom: `1px solid ${theme.palette.divider}`,
          },
          /* White text on bar labels only (SVG), not on table list */
          "& [class*='barLabel_']": { fill: "#fff !important" },
          "& [class*='barLabelOutside_']": {
            fill: `${theme.palette.text.primary} !important`,
          },
          /* Pointer cursor on clickable table rows */
          "& [class*='taskListTableRow_']": { cursor: "pointer" },
          /* Remove 45-degree angled ends on project (WBS) bars — make them rectangular */
          "& [class*='projectTop_']": { display: "none" },
          "& [class*='projectBackground_']": { opacity: "1 !important" },
          /* Hide the library's built-in dependency arrows (hard-coded
             staircase). We render our own rounded-elbow arrows on a
             custom SVG overlay (see DependencyArrowOverlay below).
             The drag-preview `relationLine` is left visible. */
          "& [class*='arrow_clickable_']": { display: "none" },
          /* Context menu: ensure it renders above everything and captures hover */
          "& [class*='menuOption_']": {
            position: "relative",
            zIndex: 9999,
            pointerEvents: "auto",
            "&:hover": {
              backgroundColor: `${theme.palette.action.hover} !important`,
            },
          },
          /* ── Horizontal grid lines on the SVG gantt side ──
             The library sets a solid background on the SVG and renders column
             lines + alternating bands via a wrapper div's backgroundImage.
             We override the wrapper div's gradient in dark mode and add 1px
             horizontal dividers on the SVG itself. */
          "& [class*='ganttTaskContent_'] > div": {
            backgroundImage: `
              linear-gradient(to right, ${theme.palette.divider} 1px, transparent 2px),
              linear-gradient(to bottom, transparent 40px, ${theme.palette.mode === "dark" ? theme.palette.background.paper : "#f5f5f5"} 40px)
            !important`,
          },
          "& [class*='ganttTaskContent_'] > div > svg": {
            backgroundImage: `repeating-linear-gradient(
              to bottom,
              transparent 0px,
              transparent 39px,
              ${theme.palette.divider} 39px,
              ${theme.palette.divider} 40px
            ) !important`,
          },
          /* ── Touch scrolling: allow native pan gestures on all scroll containers ── */
          "& [class*='ganttTaskRoot_']": { touchAction: "pan-x pan-y" },
          "& [class*='ganttTaskContent_']": { touchAction: "pan-x pan-y" },
          "& [class*='ganttTableWrapper_']": { touchAction: "pan-x pan-y" },
          "& [class*='wrapper_'][data-testid='gantt-main']": {
            touchAction: "pan-x pan-y",
          },

          /* ── Dark mode overrides (CSS-class-based elements only;
               inline-style colors are handled via the colors prop) ── */
          ...(theme.palette.mode === "dark" && {
            /* Calendar header cells (SVG rects — CSS class fill) */
            "& [class*='calendarHeader']": {
              fill: `${theme.palette.background.paper} !important`,
              stroke: `${theme.palette.divider} !important`,
            },
            /* Calendar text (SVG — CSS class fill) */
            "& [class*='calendarTopText']": {
              fill: `${theme.palette.text.secondary} !important`,
            },
            "& [class*='calendarBottomText']": {
              fill: `${theme.palette.text.primary} !important`,
            },
            /* Calendar tick lines + borders (CSS class stroke/border) */
            "& [class*='calendarTopTick']": {
              stroke: `${theme.palette.divider} !important`,
            },
            "& [class*='calendarMain']": {
              borderColor: `${theme.palette.divider} !important`,
            },
            /* Table borders (CSS class border) */
            "& [class*='ganttTableRoot']": {
              borderColor: `${theme.palette.divider} !important`,
            },
            "& [class*='ganttTable_Header']": {
              borderColor: `${theme.palette.divider} !important`,
            },
            "& [class*='ganttTable_HeaderSeparator']": {
              borderColor: `${theme.palette.divider} !important`,
            },
            /* Task list resizer (CSS class ::before) */
            "& [class*='taskListResizer']::before": {
              backgroundColor: `${theme.palette.divider} !important`,
            },
            /* Tooltip (CSS class background) */
            "& [class*='tooltipDefaultContainer_']": {
              background: `${theme.palette.background.paper} !important`,
              color: `${theme.palette.text.primary} !important`,
            },
            "& [class*='tooltipDefaultContainerParagraph']": {
              color: `${theme.palette.text.secondary} !important`,
            },
            /* Bar handles + relation lines (SVG CSS class fill/stroke) */
            "& [class*='barHandle']": {
              fill: `${theme.palette.action.selected} !important`,
            },
            "& [class*='relationLine']": {
              stroke: `${theme.palette.text.disabled} !important`,
            },
            /* Scrollbar */
            "& [class*='ganttTableWrapper']::-webkit-scrollbar-thumb": {
              background: "rgba(255, 255, 255, 0.2) !important",
            },
          }),
        }}
      >
        <Gantt
          tasks={ganttTasks}
          viewMode={viewMode}
          viewDate={viewDate}
          columns={ganttColumns}
          canResizeColumns
          onDoubleClick={handleDoubleClick}
          onDateChange={handleDateChange}
          onProgressChange={handleProgressChange}
          onChangeExpandState={handleExpanderClick}
          onRelationChange={handleRelationChange}
          contextMenuOptions={contextMenuOptions}
          enableTableListContextMenu={2}
          roundDate={roundToDay}
          dateMoveStep={{ value: 1, timeUnit: GanttDateRoundingTimeUnit.DAY }}
          checkIsHoliday={checkIsWeekend}
          preStepsCount={2}
          colors={{
            /* Row backgrounds — applied as inline styles by the library,
               so CSS overrides can't reach them. Must be set here. */
            evenTaskBackgroundColor:
              theme.palette.mode === "dark"
                ? theme.palette.background.paper
                : "#f5f5f5",
            oddTaskBackgroundColor: theme.palette.background.default,
            /* Opaque selection colors — semi-transparent values cause white
               flash on some rows because the library's internal MUI theme is
               always "light", which paints white focus/hover overlays. */
            selectedTaskBackgroundColor:
              theme.palette.mode === "dark" ? "#1a3a5c" : "#e3f2fd",
            todayColor:
              theme.palette.mode === "dark"
                ? "rgba(25, 118, 210, 0.15)"
                : "rgba(25, 118, 210, 0.08)",
            holidayBackgroundColor:
              theme.palette.mode === "dark"
                ? "rgba(255, 255, 255, 0.03)"
                : "rgba(0, 0, 0, 0.04)",
            /* Text — barLabelColor defaults to #000, applied as inline
               style on the wrapper div and inherited by table text. */
            barLabelColor: theme.palette.text.primary,
            barLabelWhenOutsideColor: theme.palette.text.primary,
            /* Context menu */
            contextMenuBgColor: theme.palette.background.paper,
            contextMenuTextColor: theme.palette.text.primary,
            contextMenuBoxShadow: theme.shadows[8],
          }}
          dateFormats={{
            dateColumnFormat: "dd MMM ''yy",
            dayBottomHeaderFormat: "d",
            dayTopHeaderFormat: "LLLL yyyy",
            // Bottom row of the Month scale ("Jan" / "Feb" / …). The library
            // renders Year + QuarterYear headers natively (year + "Qn yyyy")
            // and ignores this format for those scales.
            monthBottomHeaderFormat: "LLL",
            monthTopHeaderFormat: "LLLL",
          }}
          distances={{
            columnWidth,
            rowHeight: 40,
            headerHeight: 50,
            barCornerRadius: 4,
          }}
        />
        <DependencyArrowOverlay
          arrows={arrowGeometry}
          buildPath={buildArrowPath}
          onClick={handleArrowClick}
          color={theme.palette.text.secondary}
          dangerColor={theme.palette.error.main}
        />
      </Box>

      {/* Inline completion slider popover */}
      <Popover
        open={Boolean(completionAnchor)}
        anchorEl={completionAnchor}
        onClose={() => {
          handleCompletionSave(completionEditValue);
          setCompletionAnchor(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
        disableRestoreFocus
      >
        <Box sx={{ px: 2, py: 1.5, width: 180 }}>
          <Typography variant="caption" fontWeight={600}>
            {t("completion")}: {Math.round(completionEditValue)}%
          </Typography>
          <Slider
            value={completionEditValue}
            onChange={(_, v) => setCompletionEditValue(v as number)}
            onChangeCommitted={(_, v) => {
              handleCompletionSave(v as number);
              setCompletionAnchor(null);
            }}
            min={0}
            max={100}
            step={5}
            size="small"
          />
        </Box>
      </Popover>

      {/* WBS Dialog */}
      {wbsDialogOpen && (
        <PpmWbsDialog
          initiativeId={initiativeId}
          wbs={editingWbs}
          wbsList={wbsList}
          defaultMilestone={milestoneDefault}
          defaultStartDate={editingWbs ? undefined : defaultNewDate}
          onClose={() => {
            setWbsDialogOpen(false);
            setMilestoneDefault(false);
          }}
          onSaved={() => {
            setWbsDialogOpen(false);
            setMilestoneDefault(false);
            loadData();
          }}
        />
      )}

      {/* Feedback for dependency CRUD + dependency errors */}
      <Snackbar
        open={!!snack}
        autoHideDuration={3000}
        onClose={() => setSnack("")}
        message={snack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />

      {/* Task Dialog */}
      {taskDialogOpen && (
        <PpmTaskDialog
          initiativeId={initiativeId}
          task={editingTask}
          wbsList={wbsList}
          defaultWbsId={preselectedWbsId}
          defaultStartDate={editingTask ? undefined : defaultNewDate}
          onClose={() => {
            setTaskDialogOpen(false);
            setEditingTask(undefined);
            setPreselectedWbsId("");
          }}
          onSaved={() => {
            setTaskDialogOpen(false);
            setEditingTask(undefined);
            setPreselectedWbsId("");
            loadData();
          }}
        />
      )}
    </Box>
  );
}
