import CataloguePage from "@/features/reference-catalogue/CataloguePage";
import type { CatalogueKindConfig } from "@/features/reference-catalogue/types";

const config: CatalogueKindConfig = {
  kind: "capability",
  basePath: "/capability-catalogue",
  payloadKey: "capabilities",
  idPrefix: "BC-",
  i18nNamespace: "catalogue",
  inventoryCardType: "BusinessCapability",
  // Brand navy used across the EA app for capabilities (see HierarchySection,
  // CapabilityMapReport.CapabilityCard, the public catalogue site at
  // capabilities.turbo-ea.org).
  accentColor: "#003399",
  selectionColor: "#D63384",
  levelLabel: (level) => `L${level}`,
  heroIcon: "account_tree",
};

export default function CapabilityCataloguePage() {
  return <CataloguePage config={config} />;
}
