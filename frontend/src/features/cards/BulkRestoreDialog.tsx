import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

interface BulkRestoreResponse {
  requested: number;
  restored_card_ids: string[];
  skipped: { card_id: string; reason: string }[];
}

interface Props {
  open: boolean;
  cardIds: string[];
  onClose: () => void;
  onConfirmed: () => void;
}

export default function BulkRestoreDialog({ open, cardIds, onClose, onConfirmed }: Props) {
  const { t } = useTranslation(["inventory", "common"]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    setSubmitting(true);
    setError("");
    try {
      await api.post<BulkRestoreResponse>("/cards/bulk-restore", { card_ids: cardIds });
      onConfirmed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {t("inventory:massRestore.dialogTitle", { count: cardIds.length })}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2">
            {t("inventory:massRestore.confirmMessage", { count: cardIds.length })}
          </Typography>
          {submitting && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("inventory:massRestore.progressing", { count: cardIds.length })}
              </Typography>
              <LinearProgress sx={{ mt: 0.5 }} />
            </Box>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleConfirm}
          disabled={submitting}
          startIcon={<MaterialSymbol icon="restore" size={18} />}
        >
          {submitting ? t("inventory:massRestore.restoring") : t("common:actions.restore")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
