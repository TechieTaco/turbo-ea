import Chip from "@mui/material/Chip";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "./MaterialSymbol";

interface Props {
  status: string;
  size?: "small" | "medium";
}

const STATUS_CONFIG: Record<
  string,
  { color: "default" | "success" | "warning" | "error"; icon: string }
> = {
  DRAFT: { color: "default", icon: "edit_note" },
  APPROVED: { color: "success", icon: "verified" },
  BROKEN: { color: "warning", icon: "warning" },
  REJECTED: { color: "error", icon: "cancel" },
};

export default function ApprovalStatusBadge({ status, size = "small" }: Props) {
  const { t } = useTranslation("common");
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return null;
  return (
    <Chip
      size={size}
      label={t(`status.${status.toLowerCase()}`)}
      color={cfg.color}
      icon={<MaterialSymbol icon={cfg.icon} size={16} />}
    />
  );
}
