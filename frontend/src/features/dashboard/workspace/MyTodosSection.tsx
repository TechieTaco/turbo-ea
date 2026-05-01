import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import SectionPaper, { EmptyState, ViewAllLink } from "./SectionPaper";

interface TodoRow {
  id: string;
  card_id: string | null;
  card_name: string | null;
  description: string;
  status: string;
  due_date: string | null;
}

const MAX_VISIBLE = 6;

export default function MyTodosSection() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [todos, setTodos] = useState<TodoRow[]>([]);

  useEffect(() => {
    api
      .get<TodoRow[]>("/todos?status=open")
      .then((rows) => setTodos(rows.slice(0, MAX_VISIBLE)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <SectionPaper
      icon="task_alt"
      iconColor="#43a047"
      title={t("dashboard.workspace.myTodos")}
      action={<ViewAllLink to="/todos" label={t("dashboard.workspace.viewAll")} />}
    >
      {loading ? (
        <LinearProgress />
      ) : todos.length === 0 ? (
        <EmptyState message={t("dashboard.workspace.empty.todos")} />
      ) : (
        <Box>
          {todos.map((todo) => (
            <Box
              key={todo.id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                py: 0.75,
                px: 1,
                borderRadius: 1,
                cursor: todo.card_id ? "pointer" : "default",
                "&:hover": todo.card_id ? { bgcolor: "action.hover" } : {},
              }}
              onClick={() => todo.card_id && navigate(`/cards/${todo.card_id}`)}
            >
              <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                {todo.description}
              </Typography>
              {todo.due_date && (
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {todo.due_date}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}
    </SectionPaper>
  );
}
