import { useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useCurrency } from "@/hooks/useCurrency";
import type { PpmCostLine } from "@/types";

interface Props {
  initiativeId: string;
  costLines: PpmCostLine[];
  onRefresh: () => void;
}

export default function PpmCostTab({ initiativeId, costLines, onRefresh }: Props) {
  const { t } = useTranslation("ppm");
  const { fmt } = useCurrency();
  const [dialog, setDialog] = useState<{ open: boolean; item?: PpmCostLine }>({
    open: false,
  });
  const [form, setForm] = useState({
    description: "",
    category: "capex" as "capex" | "opex",
    planned: 0,
    actual: 0,
  });

  const totalPlanned = costLines.reduce((s, cl) => s + cl.planned, 0);
  const totalActual = costLines.reduce((s, cl) => s + cl.actual, 0);
  const capexPlanned = costLines
    .filter((cl) => cl.category === "capex")
    .reduce((s, cl) => s + cl.planned, 0);
  const capexActual = costLines
    .filter((cl) => cl.category === "capex")
    .reduce((s, cl) => s + cl.actual, 0);
  const opexPlanned = costLines
    .filter((cl) => cl.category === "opex")
    .reduce((s, cl) => s + cl.planned, 0);
  const opexActual = costLines
    .filter((cl) => cl.category === "opex")
    .reduce((s, cl) => s + cl.actual, 0);

  const handleOpen = (item?: PpmCostLine) => {
    if (item) {
      setForm({
        description: item.description,
        category: item.category,
        planned: item.planned,
        actual: item.actual,
      });
    } else {
      setForm({ description: "", category: "capex", planned: 0, actual: 0 });
    }
    setDialog({ open: true, item });
  };

  const handleSave = async () => {
    if (dialog.item) {
      await api.patch(`/ppm/costs/${dialog.item.id}`, form);
    } else {
      await api.post(`/ppm/initiatives/${initiativeId}/costs`, form);
    }
    setDialog({ open: false });
    onRefresh();
  };

  const handleDelete = async (id: string) => {
    await api.delete(`/ppm/costs/${id}`);
    onRefresh();
  };

  return (
    <Box>
      {/* Summary Bar */}
      <Paper
        sx={{
          display: "flex",
          gap: 4,
          px: 3,
          py: 1.5,
          mb: 2,
          flexWrap: "wrap",
          alignItems: "center",
        }}
        variant="outlined"
      >
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("totalPlanned")}
          </Typography>
          <Typography variant="h6" fontWeight={600}>
            {fmt.format(totalPlanned)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("totalActual")}
          </Typography>
          <Typography variant="h6" fontWeight={600}>
            {fmt.format(totalActual)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("variance")}
          </Typography>
          <Typography
            variant="h6"
            fontWeight={600}
            color={totalActual > totalPlanned ? "error" : "success.main"}
          >
            {fmt.format(totalPlanned - totalActual)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("capex")}
          </Typography>
          <Typography variant="body2">
            {fmt.format(capexActual)} / {fmt.format(capexPlanned)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("opex")}
          </Typography>
          <Typography variant="body2">
            {fmt.format(opexActual)} / {fmt.format(opexPlanned)}
          </Typography>
        </Box>
      </Paper>

      {/* Add Button */}
      <Box display="flex" justifyContent="flex-end" mb={2}>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => handleOpen()}
        >
          {t("addCostItem")}
        </Button>
      </Box>

      {/* Table */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("common:description", "Description")}</TableCell>
              <TableCell>{t("category")}</TableCell>
              <TableCell align="right">{t("planned")}</TableCell>
              <TableCell align="right">{t("actual")}</TableCell>
              <TableCell align="right">{t("variance")}</TableCell>
              <TableCell width={80} />
            </TableRow>
          </TableHead>
          <TableBody>
            {costLines.map((cl) => {
              const variance = cl.planned - cl.actual;
              return (
                <TableRow key={cl.id} hover>
                  <TableCell>{cl.description}</TableCell>
                  <TableCell>
                    <Chip
                      label={cl.category === "capex" ? t("capex") : t("opex")}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="right">{fmt.format(cl.planned)}</TableCell>
                  <TableCell align="right">{fmt.format(cl.actual)}</TableCell>
                  <TableCell
                    align="right"
                    sx={{ color: variance < 0 ? "error.main" : "success.main" }}
                  >
                    {fmt.format(variance)}
                  </TableCell>
                  <TableCell>
                    <Box display="flex" gap={0.5}>
                      <IconButton size="small" onClick={() => handleOpen(cl)}>
                        <MaterialSymbol icon="edit" size={16} />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDelete(cl.id)}
                      >
                        <MaterialSymbol icon="delete" size={16} />
                      </IconButton>
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
            {costLines.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                  <Typography color="text.secondary">
                    {t("noCostLines")}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Dialog */}
      {dialog.open && (
        <Dialog
          open
          onClose={() => setDialog({ open: false })}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            {dialog.item ? t("editCostLine") : t("addCostItem")}
          </DialogTitle>
          <DialogContent>
            <Box display="flex" flexDirection="column" gap={2} mt={1}>
              <TextField
                label={t("common:description", "Description")}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                fullWidth
                size="small"
              />
              <FormControl size="small">
                <InputLabel>{t("category")}</InputLabel>
                <Select
                  value={form.category}
                  label={t("category")}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      category: e.target.value as "capex" | "opex",
                    })
                  }
                >
                  <MenuItem value="capex">{t("capex")}</MenuItem>
                  <MenuItem value="opex">{t("opex")}</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label={t("planned")}
                type="number"
                value={form.planned || ""}
                onChange={(e) =>
                  setForm({ ...form, planned: Number(e.target.value) || 0 })
                }
                size="small"
              />
              <TextField
                label={t("actual")}
                type="number"
                value={form.actual || ""}
                onChange={(e) =>
                  setForm({ ...form, actual: Number(e.target.value) || 0 })
                }
                size="small"
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialog({ open: false })}>
              {t("common:actions.cancel", "Cancel")}
            </Button>
            <Button variant="contained" onClick={handleSave}>
              {t("common:actions.save", "Save")}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
