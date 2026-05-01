import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  icon: string;
  iconColor?: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}

export default function SectionPaper({
  icon,
  iconColor = "#1976d2",
  title,
  action,
  children,
}: Props) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <MaterialSymbol icon={icon} size={20} color={iconColor} />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          {title}
        </Typography>
        {action}
      </Box>
      <Box sx={{ flex: 1 }}>{children}</Box>
    </Paper>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
      {message}
    </Typography>
  );
}

export function ViewAllLink({ to, label }: { to: string; label: string }) {
  return (
    <Typography
      component="a"
      href={to}
      variant="caption"
      sx={{
        color: "primary.main",
        textDecoration: "none",
        "&:hover": { textDecoration: "underline" },
      }}
    >
      {label} →
    </Typography>
  );
}
