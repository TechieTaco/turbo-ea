import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import CataloguePage from "@/features/reference-catalogue/CataloguePage";
import type {
  CatalogueKindConfig,
  CatalogueNode,
} from "@/features/reference-catalogue/types";

function ProcessDetailExtras({ node }: { node: CatalogueNode }) {
  const { t } = useTranslation(["cards"]);
  const refs = node.framework_refs ?? [];
  const realizes = node.realizes_capability_ids ?? [];
  if (refs.length === 0 && realizes.length === 0) return null;
  return (
    <Stack spacing={1.5} sx={{ mb: 2 }}>
      {refs.length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            {t("cards:processCatalogue.frameworkRefsLabel")}
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {refs.map((r, i) => (
              <Chip
                key={`${r.framework}-${r.external_id}-${i}`}
                size="small"
                label={`${r.framework} ${r.external_id}${r.version ? ` (v${r.version})` : ""}`}
                variant="outlined"
              />
            ))}
          </Stack>
        </Box>
      )}
      {realizes.length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            {t("cards:processCatalogue.realizesCapabilitiesLabel")}
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {realizes.map((bc) => (
              <Chip key={bc} size="small" label={bc} variant="outlined" color="primary" />
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

const config: CatalogueKindConfig = {
  kind: "process",
  basePath: "/process-catalogue",
  payloadKey: "processes",
  idPrefix: "BP-",
  i18nNamespace: "processCatalogue",
  inventoryCardType: "BusinessProcess",
  // Matches the BusinessProcess card-type colour in the metamodel seed.
  accentColor: "#e65100",
  selectionColor: "#D63384",
  levelLabel: (level) => `L${level}`,
  heroIcon: "route",
  renderDetailExtras: (node) => <ProcessDetailExtras node={node} />,
};

export default function ProcessCataloguePage() {
  return <CataloguePage config={config} />;
}
