import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Snackbar from "@mui/material/Snackbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Card as CardType } from "@/types";
import CardTypePill from "./CardTypePill";
import SectionPaper, { EmptyState } from "./SectionPaper";

interface FavoriteRow {
  id: string;
  card_id: string;
  created_at: string | null;
}

const MAX_VISIBLE = 8;
const UNDO_TIMEOUT_MS = 6000;

export default function MyFavoritesSection() {
  const { t } = useTranslation(["common", "cards"]);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<CardType[]>([]);
  const [undoSnack, setUndoSnack] = useState<CardType | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const favorites = await api.get<FavoriteRow[]>("/favorites");
      const slice = favorites.slice(0, MAX_VISIBLE);
      const fetched = await Promise.all(
        slice.map((f) => api.get<CardType>(`/cards/${f.card_id}`).catch(() => null)),
      );
      setCards(fetched.filter((c): c is CardType => c !== null));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const removeFavorite = async (card: CardType) => {
    try {
      await api.delete(`/favorites/${card.id}`);
      setCards((prev) => prev.filter((c) => c.id !== card.id));
      setUndoSnack(card);
    } catch {
      // best effort
    }
  };

  const undoRemove = async () => {
    if (!undoSnack) return;
    const card = undoSnack;
    setUndoSnack(null);
    try {
      await api.post(`/favorites/${card.id}`, undefined);
      setCards((prev) =>
        prev.some((c) => c.id === card.id) ? prev : [card, ...prev].slice(0, MAX_VISIBLE),
      );
    } catch {
      // best effort
    }
  };

  return (
    <SectionPaper
      icon="star"
      iconColor="#fbc02d"
      title={t("common:dashboard.workspace.myFavorites")}
    >
      {loading ? (
        <LinearProgress />
      ) : cards.length === 0 ? (
        <EmptyState message={t("common:dashboard.workspace.empty.favorites")} />
      ) : (
        <Box>
          {cards.map((card) => (
            <Box
              key={card.id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                py: 0.75,
                px: 1,
                borderRadius: 1,
                cursor: "pointer",
                "&:hover": { bgcolor: "action.hover" },
              }}
              onClick={() => navigate(`/cards/${card.id}`)}
            >
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {card.name}
              </Typography>
              <CardTypePill typeKey={card.type} />
              <Tooltip title={t("cards:actions.removeFromFavorites")}>
                <IconButton
                  size="small"
                  aria-label={t("cards:actions.removeFromFavorites")}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFavorite(card);
                  }}
                >
                  <MaterialSymbol icon="star" size={18} color="#fbc02d" />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}
      <Snackbar
        open={!!undoSnack}
        autoHideDuration={UNDO_TIMEOUT_MS}
        onClose={() => setUndoSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={
          undoSnack
            ? t("common:dashboard.workspace.favoriteRemoved", { name: undoSnack.name })
            : ""
        }
        action={
          <Button color="secondary" size="small" onClick={undoRemove}>
            {t("common:actions.undo")}
          </Button>
        }
      />
    </SectionPaper>
  );
}
