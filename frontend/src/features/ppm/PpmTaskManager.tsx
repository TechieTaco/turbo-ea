import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Drawer from "@mui/material/Drawer";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Badge from "@mui/material/Badge";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import PpmTaskDialog from "./PpmTaskDialog";
import type { PpmTask, PpmTaskStatus, PpmTaskPriority } from "@/types";

interface Props {
  initiativeId: string;
}

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

export default function PpmTaskManager({ initiativeId }: Props) {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const gridRef = useRef<AgGridReact>(null);
  const [tasks, setTasks] = useState<PpmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task?: PpmTask }>({
    open: false,
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  const loadTasks = useCallback(async () => {
    try {
      const data = await api.get<PpmTask[]>(`/ppm/initiatives/${initiativeId}/tasks`);
      setTasks(data);
    } finally {
      setLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const assignees = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks) {
      if (t.assignee_id && t.assignee_name) map.set(t.assignee_id, t.assignee_name);
    }
    return [...map.entries()];
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let list = tasks;
    if (statusFilter) list = list.filter((t) => t.status === statusFilter);
    if (priorityFilter) list = list.filter((t) => t.priority === priorityFilter);
    if (assigneeFilter) list = list.filter((t) => t.assignee_id === assigneeFilter);
    return list;
  }, [tasks, statusFilter, priorityFilter, assigneeFilter]);

  const activeFilters = [statusFilter, priorityFilter, assigneeFilter].filter(Boolean).length;

  const handleTaskSaved = () => {
    setTaskDialog({ open: false });
    loadTasks();
  };

  const handleDelete = async (taskId: string) => {
    await api.delete(`/ppm/tasks/${taskId}`);
    loadTasks();
  };

  const columnDefs: ColDef<PpmTask>[] = useMemo(
    () => [
      {
        field: "title",
        headerName: t("taskTitle"),
        flex: 2,
        editable: true,
        onCellValueChanged: async (params) => {
          if (params.newValue !== params.oldValue) {
            await api.patch(`/ppm/tasks/${params.data!.id}`, { title: params.newValue });
          }
        },
      },
      {
        field: "status",
        headerName: t("taskStatus"),
        width: 140,
        cellRenderer: (params: ICellRendererParams<PpmTask>) => {
          const status = params.value as PpmTaskStatus;
          return (
            <Chip
              label={t(`status${status.charAt(0).toUpperCase()}${status.slice(1).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`)}
              size="small"
              sx={{
                bgcolor: STATUS_COLORS[status],
                color: "#fff",
                fontWeight: 600,
                fontSize: "0.7rem",
              }}
            />
          );
        },
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: ["todo", "in_progress", "done", "blocked"],
        },
        onCellValueChanged: async (params) => {
          if (params.newValue !== params.oldValue) {
            await api.patch(`/ppm/tasks/${params.data!.id}`, { status: params.newValue });
            loadTasks();
          }
        },
      },
      {
        field: "priority",
        headerName: t("taskPriority"),
        width: 120,
        cellRenderer: (params: ICellRendererParams<PpmTask>) => {
          const priority = params.value as PpmTaskPriority;
          return (
            <Chip
              label={t(`priority${priority.charAt(0).toUpperCase()}${priority.slice(1)}`)}
              size="small"
              variant="outlined"
              sx={{
                borderColor: PRIORITY_COLORS[priority],
                color: PRIORITY_COLORS[priority],
                fontWeight: 600,
                fontSize: "0.7rem",
              }}
            />
          );
        },
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: ["critical", "high", "medium", "low"],
        },
        onCellValueChanged: async (params) => {
          if (params.newValue !== params.oldValue) {
            await api.patch(`/ppm/tasks/${params.data!.id}`, { priority: params.newValue });
            loadTasks();
          }
        },
      },
      {
        field: "assignee_name",
        headerName: t("taskAssignee"),
        width: 140,
        valueFormatter: (params) => params.value || "\u2014",
      },
      {
        field: "due_date",
        headerName: t("taskDueDate"),
        width: 120,
        valueFormatter: (params) => params.value || "\u2014",
      },
      {
        field: "start_date",
        headerName: t("taskStartDate"),
        width: 120,
        valueFormatter: (params) => params.value || "\u2014",
      },
      {
        headerName: "",
        width: 90,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<PpmTask>) => (
          <Box display="flex" gap={0.5}>
            <IconButton
              size="small"
              onClick={() => setTaskDialog({ open: true, task: params.data! })}
            >
              <MaterialSymbol icon="edit" size={16} />
            </IconButton>
            <IconButton size="small" onClick={() => handleDelete(params.data!.id)}>
              <MaterialSymbol icon="delete" size={16} />
            </IconButton>
          </Box>
        ),
      },
    ],
    [t, loadTasks],
  );

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t("tasks")} ({filteredTasks.length})
        </Typography>
        <Box display="flex" gap={1}>
          <Badge badgeContent={activeFilters} color="primary">
            <Button
              size="small"
              variant="outlined"
              startIcon={<MaterialSymbol icon="filter_list" size={18} />}
              onClick={() => setFilterOpen(true)}
            >
              {t("filters")}
            </Button>
          </Badge>
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

      <Box
        className="ag-theme-quartz"
        sx={{
          height: 450,
          width: "100%",
          "& .ag-theme-quartz": {
            "--ag-background-color": theme.palette.background.paper,
            "--ag-header-background-color": theme.palette.background.default,
            "--ag-odd-row-background-color": theme.palette.action.hover,
          },
        }}
      >
        <AgGridReact
          ref={gridRef}
          rowData={filteredTasks}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          animateRows
          domLayout="normal"
          suppressCellFocus
          loading={loading}
        />
      </Box>

      {/* Filter Sidebar */}
      <Drawer anchor="right" open={filterOpen} onClose={() => setFilterOpen(false)}>
        <Box sx={{ width: 280, p: 3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Typography variant="h6" fontWeight={600}>
              {t("filters")}
            </Typography>
            <IconButton onClick={() => setFilterOpen(false)}>
              <MaterialSymbol icon="close" size={20} />
            </IconButton>
          </Box>

          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>{t("taskStatus")}</InputLabel>
            <Select
              value={statusFilter}
              label={t("taskStatus")}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="">{t("common:all", "All")}</MenuItem>
              <MenuItem value="todo">{t("statusTodo")}</MenuItem>
              <MenuItem value="in_progress">{t("statusInProgress")}</MenuItem>
              <MenuItem value="done">{t("statusDone")}</MenuItem>
              <MenuItem value="blocked">{t("statusBlocked")}</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>{t("taskPriority")}</InputLabel>
            <Select
              value={priorityFilter}
              label={t("taskPriority")}
              onChange={(e) => setPriorityFilter(e.target.value)}
            >
              <MenuItem value="">{t("common:all", "All")}</MenuItem>
              <MenuItem value="critical">{t("priorityCritical")}</MenuItem>
              <MenuItem value="high">{t("priorityHigh")}</MenuItem>
              <MenuItem value="medium">{t("priorityMedium")}</MenuItem>
              <MenuItem value="low">{t("priorityLow")}</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth size="small" sx={{ mb: 3 }}>
            <InputLabel>{t("taskAssignee")}</InputLabel>
            <Select
              value={assigneeFilter}
              label={t("taskAssignee")}
              onChange={(e) => setAssigneeFilter(e.target.value)}
            >
              <MenuItem value="">{t("common:all", "All")}</MenuItem>
              {assignees.map(([id, name]) => (
                <MenuItem key={id} value={id}>
                  {name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            fullWidth
            variant="outlined"
            onClick={() => {
              setStatusFilter("");
              setPriorityFilter("");
              setAssigneeFilter("");
            }}
          >
            {t("clearFilters")}
          </Button>
        </Box>
      </Drawer>

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
