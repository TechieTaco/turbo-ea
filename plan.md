# Plan: Redesign Phase 3a/4 — Dependency-Aware Architecture Visualization

## Overview

Replace the current Phase 3a (solution options) and Phase 4 (architecture diagram) with a flow that:

1. **Phase 3 (new)**: Asks the user to select existing Objective(s), fetches their dependency subgraph, then uses AI to determine if the proposed solution requires new Business Capabilities or improves existing ones
2. **Phase 4 (new)**: Renders a **dependency diagram** (reusing `C4DiagramView` + `c4Layout.ts`) showing the selected Objective(s), existing dependencies, and proposed new cards/relations — all grouped by metamodel categories

## Key Design Decisions

- **Reuse C4DiagramView**: The existing C4 diagram already groups nodes by metamodel category (`Strategy & Transformation`, `Business Architecture`, `Application & Data`, `Technical Architecture`), has proper edge routing, and renders card type icons/colors. We pass it `GNode[]` + `GEdge[]` — we just need to build those arrays from a mix of real DB cards and AI-proposed cards.
- **Visual distinction**: Proposed/new nodes get a dashed border and a "NEW" badge (similar to the existing `ArchitectureDiagram` approach). We add a `proposed?: boolean` field to `C4NodeData` and style accordingly in `C4Node`.
- **No card/relation creation yet**: This is visualization only. The dependency diagram shows what *would* be created, not what exists.
- **Session persistence**: The selected objectives and dependency context are stored in the `ArchSession` (sessionStorage).

---

## Implementation Steps

### Step 1: Backend — New endpoint to search Objective cards

**File**: `backend/app/api/v1/archlens.py`

Add `GET /archlens/architect/objectives`:
- **Input**: `search` (optional text filter)
- **Output**: `[{ id, name, description, subtype, attributes }]`
- **Logic**: Query `cards` table where `type = 'Objective'`, `status != 'ARCHIVED'`, optional ILIKE on name
- Permission: `archlens.manage`

### Step 2: Backend — New endpoint to fetch Objective dependency subgraph

**File**: `backend/app/api/v1/archlens.py`

Add `GET /archlens/architect/objective-dependencies`:
- **Input**: `objective_ids` (comma-separated UUIDs)
- **Output**: `{ nodes: GNode[], edges: GEdge[] }` — same shape as `/reports/dependencies`
- **Logic**: BFS from the given Objective cards, depth=3, traversing all relation types connected to found nodes (similar to the existing `/reports/dependencies` endpoint logic with `center_id`)
- Reuse the same node/edge format as the existing dependency report
- Permission: `archlens.manage`

### Step 3: Backend — New AI function for capability mapping

**File**: `backend/app/services/archlens_architect.py`

Add `phase3_capability_mapping()`:

**Signature**:
```python
async def phase3_capability_mapping(
    db: AsyncSession,
    requirement: str,
    all_qa: list[dict[str, Any]],
    objective_ids: list[str],
    existing_dependencies: dict[str, Any],  # The GNode/GEdge subgraph
) -> dict[str, Any]
```

**AI prompt asks the LLM to**:
1. Review the requirement, Q&A answers, and the existing dependency subgraph
2. Determine which **existing Business Capabilities** are relevant
3. Propose **new Business Capabilities** if the solution introduces capabilities not in the landscape
4. For each capability (existing or new), list what Applications/ITComponents/Interfaces/DataObjects support it or need to be added
5. Define the **proposed relations** using real relation type keys from the metamodel

**Response JSON structure**:
```json
{
  "summary": "Analysis of capability impact...",
  "capabilities": [
    {
      "id": "existing-uuid-or-new_cap_1",
      "name": "Customer Data Management",
      "isNew": false,
      "existingCardId": "uuid",
      "rationale": "This capability is directly impacted"
    },
    {
      "id": "new_cap_1",
      "name": "Data Enrichment Orchestration",
      "isNew": true,
      "rationale": "New capability needed for the enrichment pipeline"
    }
  ],
  "proposedCards": [
    {
      "id": "new_app_1",
      "name": "Enrichment Orchestrator",
      "cardTypeKey": "Application",
      "subtype": "Business Application",
      "isNew": true,
      "rationale": "Orchestrates the data enrichment pipeline"
    }
  ],
  "proposedRelations": [
    {
      "sourceId": "new_cap_1",
      "targetId": "new_app_1",
      "relationType": "relAppToBC",
      "label": "supports"
    }
  ]
}
```

The prompt injects: valid metamodel card type keys + subtypes, valid relation type keys with source/target types, the existing dependency subgraph, compact landscape context, all Q&A.

### Step 4: Backend — Modify Phase 3 route

**File**: `backend/app/api/v1/archlens.py`

Change `POST /archlens/architect/phase3/options` to accept `objective_ids` in the request body. The handler:
1. Fetches the dependency subgraph for the selected objectives (reuse Step 2 logic)
2. Passes the subgraph + Q&A to `phase3_capability_mapping()`
3. Returns the capability mapping result

### Step 5: Frontend — New types

**File**: `frontend/src/types/index.ts`

```typescript
export interface CapabilityMapping {
  id: string;
  name: string;
  isNew: boolean;
  existingCardId?: string;
  rationale?: string;
}

export interface ProposedCard {
  id: string;
  name: string;
  cardTypeKey: string;
  subtype?: string;
  isNew: boolean;
  rationale?: string;
}

export interface ProposedRelation {
  sourceId: string;
  targetId: string;
  relationType: string;
  label?: string;
}

export interface CapabilityMappingResult {
  summary?: string;
  capabilities: CapabilityMapping[];
  proposedCards: ProposedCard[];
  proposedRelations: ProposedRelation[];
}
```

### Step 6: Frontend — Objective selection UI

**File**: `frontend/src/features/archlens/ArchLensArchitect.tsx`

After Phase 2 answers are submitted, show a new intermediate step (still part of Phase 2 UI, before calling Phase 3):
- Render an autocomplete/search field that queries `GET /archlens/architect/objectives`
- Allow multi-select of 1-3 Objectives
- Store in session: `selectedObjectiveIds: string[]`, `selectedObjectiveNames: string[]`
- "Generate Dependency Analysis" button calls modified `runPhase(3)` with objective IDs

Update `ArchSession` with new fields:
```typescript
selectedObjectiveIds: string[];
selectedObjectiveNames: string[];
capabilityMapping: CapabilityMappingResult | null;
dependencyGraph: { nodes: GNode[]; edges: GEdge[] } | null;
```

### Step 7: Frontend — Build merged dependency graph

**File**: `frontend/src/features/archlens/ArchLensArchitect.tsx` (helper function)

Create `buildMergedDependencyGraph()` that:
1. Takes the existing dependency subgraph (`GNode[]` + `GEdge[]`) from the backend
2. Takes the capability mapping result (proposed cards + relations)
3. Merges them: existing nodes keep real IDs, proposed nodes get `proposed-` prefix, proposed nodes get `attributes: { __proposed: true }`
4. Proposed relations become `GEdge` entries with proper relation type keys
5. Returns merged `GNode[]` + `GEdge[]` ready for `C4DiagramView`

### Step 8: Frontend — Enhance C4Node for proposed cards

**File**: `frontend/src/features/reports/C4DiagramView.tsx`

Small change to `C4Node`: check `data.proposed` flag.  When true:
- Border: dashed instead of solid
- Small "NEW" badge at top-left (green chip)
- Slightly more transparent background

Also pass `proposed` through in `c4Layout.ts` `C4NodeData`.

### Step 9: Frontend — Render dependency diagram in Phase 3/4

**File**: `frontend/src/features/archlens/ArchLensArchitect.tsx`

When `archPhase === 3` and capability mapping is ready:
- Call `buildMergedDependencyGraph()` to get merged nodes/edges
- Render `C4DiagramView` with the merged data (import from `@/features/reports/C4DiagramView`)
- Below the diagram, show:
  - Summary text from the capability mapping
  - List of new capabilities with rationale
  - List of proposed new cards with type icons
  - "Start Over" / "Choose Different Objectives" buttons
  - Optional "Generate Detailed Architecture" button → runs Phase 4 (existing architecture generation flow)

Phase 4 becomes optional — user clicks "Generate Detailed Architecture" to get the full layered view with gaps/integrations/risks (the existing `ArchitectureResultView`).

### Step 10: Translations

Add i18n keys to all 8 locales (`en`, `de`, `fr`, `es`, `it`, `pt`, `zh`, `ru`):
- `archlens_architect_select_objectives` — "Select Business Objectives"
- `archlens_architect_select_objectives_intro` — "Select the business objectives this solution should support..."
- `archlens_architect_search_objectives` — "Search objectives..."
- `archlens_architect_capability_mapping` — "Capability Impact Analysis"
- `archlens_architect_new_capability` — "New Capability"
- `archlens_architect_existing_capability` — "Existing Capability"
- `archlens_architect_proposed_cards` — "Proposed New Cards"
- `archlens_architect_generating_mapping` — "AI is analyzing capability impact..."
- `archlens_architect_dependency_diagram` — "Dependency Diagram"
- `archlens_architect_choose_objectives` — "Choose Different Objectives"
- `archlens_architect_generate_detailed` — "Generate Detailed Architecture"

### Step 11: Linting

- `cd backend && ruff format . && ruff check .`

---

## Phase Flow Summary

```
Phase 0: Enter requirement
Phase 1: Business questions (unchanged)
Phase 2: Technical questions (unchanged) → Objective selection step
Phase 3: AI capability mapping → Dependency diagram (C4DiagramView)
Phase 4: (Optional) Detailed architecture (existing ArchitectureResultView)
```

## Files Modified

| File | Change |
|------|--------|
| `backend/app/api/v1/archlens.py` | Add objective search + dependency endpoints, modify Phase 3 route |
| `backend/app/services/archlens_architect.py` | Add `phase3_capability_mapping()`, inject relation type keys into prompt |
| `frontend/src/features/archlens/ArchLensArchitect.tsx` | Objective selection UI, dependency diagram view, merged graph builder, session state |
| `frontend/src/features/reports/C4DiagramView.tsx` | Add `proposed` dashed-border styling to C4Node |
| `frontend/src/features/reports/c4Layout.ts` | Pass through `proposed` flag in C4NodeData |
| `frontend/src/types/index.ts` | Add `CapabilityMapping`, `ProposedCard`, `ProposedRelation`, `CapabilityMappingResult` |
| `frontend/src/i18n/locales/*/admin.json` | New translation keys (8 locales) |

## Files NOT Modified

- `ArchitectureDiagram.tsx` — Kept for the optional detailed architecture view (Phase 4)
- `DependencyReport.tsx` — Untouched; we reuse its C4DiagramView component
- Database schema — No new tables; all proposed data is transient (session only)
