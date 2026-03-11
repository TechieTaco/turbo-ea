import { useState, useEffect, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import Avatar from "@mui/material/Avatar";
import { useTheme, alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import PpmTaskCard from "./PpmTaskCard";
import PpmTaskDialog from "./PpmTaskDialog";
import type { PpmTask, PpmTaskStatus } from "@/types";

const COLUMNS: PpmTaskStatus[] = ["todo", "in_progress", "done", "blocked"];

const STATUS_COLORS: Record<string, string> = {
  todo: "#9e9e9e",
  in_progress: "#2196f3",
  done: "#4caf50",
  blocked: "#f44336",
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "#d32f2f",
  high: "#f57c00",
  medium: "#fbc02d",
  low: "#66bb6a",
};

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface Props {
  initiativeId: string;
}

function DroppableColumn({
  status,
  children,
}: {
  status: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const theme = useTheme();
  return (
    <Box
      ref={setNodeRef}
      sx={{
        minHeight: 200,
        p: 1,
        borderRadius: 1,
        bgcolor: isOver
          ? alpha(theme.palette.primary.main, 0.08)
          : "transparent",
        transition: "background-color 0.15s",
      }}
    >
      {children}
    </Box>
  );
}

export default function PpmTaskBoard({ initiativeId }: Props) {
  const { t } = useTranslation("ppm");
  const [tasks, setTasks] = useState<PpmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [activeTask, setActiveTask] = useState<PpmTask | null>(null);
  const [taskDialog, setTaskDialog] = useState<{
    open: boolean;
    task?: PpmTask;
    defaultStatus?: PpmTaskStatus;
  }>({ open: false });
  const [quickAdd, setQuickAdd] = useState<{
    status: PpmTaskStatus;
    title: string;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const loadTasks = useCallback(async () => {
    try {
      const data = await api.get<PpmTask[]>(
        `/ppm/initiatives/${initiativeId}/tasks`,
      );
      setTasks(data);
    } finally {
      setLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const tasksByStatus = useMemo(() => {
    const map: Record<string, PpmTask[]> = {};
    for (const col of COLUMNS) map[col] = [];
    for (const task of tasks) {
      if (map[task.status]) map[task.status].push(task);
      else map.todo.push(task);
    }
    return map;
  }, [tasks]);

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task || null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Determine the target status (column)
    const targetStatus = COLUMNS.includes(overId as PpmTaskStatus)
      ? (overId as PpmTaskStatus)
      : tasks.find((t) => t.id === overId)?.status;

    if (!targetStatus) return;

    setTasks((prev) => {
      const activeTask = prev.find((t) => t.id === activeId);
      if (!activeTask || activeTask.status === targetStatus) return prev;
      return prev.map((t) =>
        t.id === activeId ? { ...t, status: targetStatus } : t,
      );
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active } = event;
    const activeId = active.id as string;
    const task = tasks.find((t) => t.id === activeId);
    if (!task) return;

    // Persist the status change
    await api.patch(`/ppm/tasks/${activeId}`, { status: task.status });
  };

  const handleQuickAdd = async (status: PpmTaskStatus) => {
    if (!quickAdd || !quickAdd.title.trim()) {
      setQuickAdd(null);
      return;
    }
    await api.post(`/ppm/initiatives/${initiativeId}/tasks`, {
      title: quickAdd.title.trim(),
      status,
    });
    setQuickAdd(null);
    loadTasks();
  };

  const handleMarkDone = async (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: "done" as PpmTaskStatus } : t)),
    );
    await api.patch(`/ppm/tasks/${taskId}`, { status: "done" });
  };

  const handleTaskSaved = () => {
    setTaskDialog({ open: false });
    loadTasks();
  };

  // ── Kanban View ──
  const renderKanban = () => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLUMNS.length}, 1fr)`,
          gap: 2,
          minHeight: 400,
        }}
      >
        {COLUMNS.map((status) => {
          const columnTasks = tasksByStatus[status] || [];
          return (
            <Paper
              key={status}
              variant="outlined"
              sx={{
                display: "flex",
                flexDirection: "column",
                borderTop: `3px solid ${STATUS_COLORS[status]}`,
              }}
            >
              {/* Column Header */}
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Box display="flex" alignItems="center" gap={1}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    {t(
                      `status${status.charAt(0).toUpperCase()}${status.slice(1).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`,
                    )}
                  </Typography>
                  <Chip
                    label={columnTasks.length}
                    size="small"
                    sx={{ height: 20, fontSize: "0.7rem" }}
                  />
                </Box>
              </Box>

              {/* Cards */}
              <SortableContext
                items={columnTasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <DroppableColumn status={status}>
                  {columnTasks.map((task) => (
                    <PpmTaskCard
                      key={task.id}
                      task={task}
                      onClick={() => setTaskDialog({ open: true, task })}
                      onMarkDone={handleMarkDone}
                    />
                  ))}
                </DroppableColumn>
              </SortableContext>

              {/* Quick Add */}
              <Box sx={{ p: 1, mt: "auto" }}>
                {quickAdd?.status === status ? (
                  <TextField
                    autoFocus
                    size="small"
                    fullWidth
                    placeholder={t("taskTitle")}
                    value={quickAdd.title}
                    onChange={(e) =>
                      setQuickAdd({ ...quickAdd, title: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleQuickAdd(status);
                      if (e.key === "Escape") setQuickAdd(null);
                    }}
                    onBlur={() => handleQuickAdd(status)}
                  />
                ) : (
                  <Button
                    size="small"
                    fullWidth
                    startIcon={<MaterialSymbol icon="add" size={16} />}
                    onClick={() => setQuickAdd({ status, title: "" })}
                    sx={{ justifyContent: "flex-start", textTransform: "none" }}
                  >
                    {t("quickAdd")}
                  </Button>
                )}
              </Box>
            </Paper>
          );
        })}
      </Box>

      <DragOverlay>
        {activeTask && (
          <PpmTaskCard task={activeTask} onClick={() => {}} isDragOverlay />
        )}
      </DragOverlay>
    </DndContext>
  );

  // ── List View ──
  const renderList = () => (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t("taskTitle")}</TableCell>
            <TableCell>{t("taskPriority")}</TableCell>
            <TableCell>{t("taskAssignee")}</TableCell>
            <TableCell>{t("taskDueDate")}</TableCell>
            <TableCell>{t("taskStatus")}</TableCell>
            <TableCell width={80} />
          </TableRow>
        </TableHead>
        <TableBody>
          {tasks.map((task) => {
            const isOverdue =
              task.due_date &&
              new Date(task.due_date) < new Date() &&
              task.status !== "done";
            return (
              <TableRow key={task.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={500}>
                    {task.title}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={t(
                      `priority${task.priority.charAt(0).toUpperCase()}${task.priority.slice(1)}`,
                    )}
                    size="small"
                    variant="outlined"
                    sx={{
                      borderColor: PRIORITY_COLORS[task.priority],
                      color: PRIORITY_COLORS[task.priority],
                      fontWeight: 600,
                    }}
                  />
                </TableCell>
                <TableCell>
                  {task.assignee_name ? (
                    <Box display="flex" alignItems="center" gap={0.5}>
                      <Avatar
                        sx={{
                          width: 22,
                          height: 22,
                          fontSize: "0.6rem",
                          bgcolor: "primary.main",
                        }}
                      >
                        {initials(task.assignee_name)}
                      </Avatar>
                      <Typography variant="caption">
                        {task.assignee_name}
                      </Typography>
                    </Box>
                  ) : (
                    "\u2014"
                  )}
                </TableCell>
                <TableCell>
                  <Typography
                    variant="caption"
                    color={isOverdue ? "error" : "text.secondary"}
                    fontWeight={isOverdue ? 600 : 400}
                  >
                    {task.due_date
                      ? new Date(task.due_date).toLocaleDateString()
                      : "\u2014"}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={t(
                      `status${task.status.charAt(0).toUpperCase()}${task.status.slice(1).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`,
                    )}
                    size="small"
                    sx={{
                      bgcolor: STATUS_COLORS[task.status],
                      color: "#fff",
                      fontWeight: 600,
                      fontSize: "0.7rem",
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Box display="flex" gap={0.5}>
                    {task.status !== "done" && (
                      <IconButton
                        size="small"
                        onClick={async () => {
                          await handleMarkDone(task.id);
                        }}
                      >
                        <MaterialSymbol icon="check_circle" size={16} />
                      </IconButton>
                    )}
                    <IconButton
                      size="small"
                      onClick={() => setTaskDialog({ open: true, task })}
                    >
                      <MaterialSymbol icon="edit" size={16} />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={async () => {
                        await api.delete(`/ppm/tasks/${task.id}`);
                        loadTasks();
                      }}
                    >
                      <MaterialSymbol icon="delete" size={16} />
                    </IconButton>
                  </Box>
                </TableCell>
              </TableRow>
            );
          })}
          {tasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                <Typography color="text.secondary">
                  {t("noTasks")}
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );

  return (
    <Box>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography variant="subtitle1" fontWeight={600}>
          {t("tasks")} ({tasks.length})
        </Typography>
        <Box display="flex" gap={1}>
          <ToggleButtonGroup
            value={view}
            exclusive
            onChange={(_, v) => v && setView(v)}
            size="small"
          >
            <ToggleButton value="kanban">
              <MaterialSymbol icon="view_kanban" size={18} />
            </ToggleButton>
            <ToggleButton value="list">
              <MaterialSymbol icon="view_list" size={18} />
            </ToggleButton>
          </ToggleButtonGroup>
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            onClick={() => setTaskDialog({ open: true })}
          >
            {t("createTask")}
          </Button>
        </Box>
      </Box>

      {loading ? null : view === "kanban" ? renderKanban() : renderList()}

      {taskDialog.open && (
        <PpmTaskDialog
          initiativeId={initiativeId}
          task={taskDialog.task}
          onClose={() => setTaskDialog({ open: false })}
          onSaved={handleTaskSaved}
        />
      )}
    </Box>
  );
}
