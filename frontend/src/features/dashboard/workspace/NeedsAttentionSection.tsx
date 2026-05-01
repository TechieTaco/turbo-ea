import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";

interface Props {
  overdueTodoCount: number;
  brokenCardCount: number;
}

export default function NeedsAttentionSection({ overdueTodoCount, brokenCardCount }: Props) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();

  return (
    <Alert severity="warning" icon={false} sx={{ "& .MuiAlert-message": { width: "100%" } }}>
      <AlertTitle sx={{ fontWeight: 600 }}>
        {t("dashboard.workspace.needsAttention")}
      </AlertTitle>
      <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
        {overdueTodoCount > 0 && (
          <Link
            component="button"
            onClick={() => navigate("/todos")}
            sx={{ textAlign: "left" }}
          >
            {t("dashboard.workspace.attention.overdueTodos", { count: overdueTodoCount })}
          </Link>
        )}
        {brokenCardCount > 0 && (
          <Link
            component="button"
            onClick={() => navigate("/inventory?approval_status=BROKEN")}
            sx={{ textAlign: "left" }}
          >
            {t("dashboard.workspace.attention.brokenCards", { count: brokenCardCount })}
          </Link>
        )}
      </Box>
    </Alert>
  );
}
