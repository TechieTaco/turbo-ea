# Plan: ArchLens Dual Data Source — MCP + SQLite

## Context

ArchLens currently uses a **sync-button ETL** approach: pull all cards from Turbo EA via HTTP+JWT, normalize them into a local SQLite `fact_sheets` table, then run AI analyses against that snapshot. This works but has drawbacks (stale data, stored credentials, single-user RBAC scope).

Turbo EA already ships an **MCP server** with read-only tools (`search_cards`, `get_card`, `get_card_relations`, `list_card_types`, `get_landscape`, `get_dashboard`) that respect per-user RBAC via OAuth 2.1.

**Goal:** Let ArchLens use the MCP server as a live data source (no sync button needed) while keeping the SQLite path for non-MCP sources (LeanIX, other tools).

---

## Architecture: Data Provider Abstraction

### Core Idea

Introduce a **`DataProvider` interface** in ArchLens that abstracts all card/landscape reads. Two implementations:

```
┌─────────────────────────────────────────────────┐
│  ArchLens Analysis Engines                       │
│  (vendor analysis, duplicates, architect)        │
│                                                  │
│  loadLandscape() / getCards() / getVendors()     │
└──────────────────┬──────────────────────────────┘
                   │
          ┌────────▼────────┐
          │  DataProvider    │
          │  interface       │
          └──┬───────────┬──┘
             │           │
   ┌─────────▼──┐  ┌─────▼──────────┐
   │ SqliteDP   │  │   McpDP        │
   │ (existing) │  │   (new)        │
   │            │  │                │
   │ fact_sheets│  │ Turbo EA API   │
   │ table      │  │ via MCP OAuth  │
   └────────────┘  └────────────────┘
```

### DataProvider Interface

A JS module exporting an object with these methods (matching the 5 distinct read patterns identified in the codebase):

```javascript
// dataProvider.js — interface contract

/** All apps, ITCs, interfaces, providers with full fields.
 *  Used by: resolution.js (duplicates, vendor resolution, modernization) */
async loadFullLandscape(workspace)
// → { apps[], itcs[], ifaces[], providers[], counts }

/** Vendor-analyzed landscape for architect context.
 *  Used by: architect.js phases 1-3
 *  NOTE: vendors[] comes from vendor_analysis (local), apps[] from live data */
async loadArchitectLandscape(workspace)
// → { vendors[], apps[], byCategory, vendorCount, appCount, totalTechFS }

/** Cards with vendor relationships for vendor analysis input.
 *  Used by: ai.js vendor analysis */
async getCardsWithVendors(workspace)
// → { cards[], providerCount, providers[] }

/** Aggregated stats for overview dashboard.
 *  Used by: index.js /api/data/overview */
async getOverviewStats(workspace)
// → { byType, lockers, eol, noOwner, costByType, topIssues[] }

/** Paginated card listing with filters.
 *  Used by: index.js /api/data/factsheets */
async searchCards(workspace, { type, locker, search, page, pageSize })
// → { total, page, items[] }
```

### Analysis result tables stay in SQLite regardless

`vendor_analysis`, `vendor_hierarchy`, `duplicate_clusters`, `modernization_assessments`, `sync_jobs` — these are ArchLens's own computed outputs. Only the **input data** (fact_sheets) changes source.

---

## Implementation Steps

### Step 1: Extract SqliteDataProvider (pure refactor)

**New file:** `archlens/server/services/sqliteDataProvider.js`

Move all existing SQLite queries for card data into this module. No behavior change — just consolidation from their current locations:

| Method | Current location | SQL query |
|---|---|---|
| `loadFullLandscape()` | `resolution.js` lines 70-91 | 4 parallel SELECTs (apps, ITCs, interfaces, providers) |
| `loadArchitectLandscape()` | `architect.js` lines 92-176 | vendor_analysis + fact_sheets WHERE fs_type IN (...) |
| `getCardsWithVendors()` | `ai.js` lines 273-290 | fact_sheets WHERE vendors != '[]' + Provider count/list |
| `getOverviewStats()` | `index.js` lines 252-281 | 6 aggregate queries (by type, locker, EOL, no-owner, costs, worst quality) |
| `searchCards()` | `index.js` lines 300-332 | Dynamic WHERE with pagination |
| `exportCards()` | `index.js` lines 334-355 | Full export without pagination |

**Key point:** The `loadArchitectLandscape()` method reads from both `fact_sheets` (live cards) and `vendor_analysis` (local analysis results). In the SQLite provider, both come from the same DB. In the MCP provider, only `fact_sheets` changes source — `vendor_analysis` is always local.

### Step 2: Create provider factory + update consumers

**New file:** `archlens/server/services/dataProvider.js`

```javascript
const { SqliteDataProvider } = require('./sqliteDataProvider');

function createDataProvider(workspace) {
  // For now, always returns SQLite. MCP added in Step 4.
  return new SqliteDataProvider(workspace);
}

module.exports = { createDataProvider };
```

Update all consumers to get a provider instead of querying the DB directly:

- **`architect.js`** — `loadLandscape(workspace)` → `provider.loadArchitectLandscape()`
- **`ai.js`** — inline queries in `analyseVendors()` → `provider.getCardsWithVendors()`
- **`resolution.js`** — `loadFullLandscape()` → `provider.loadFullLandscape()`
- **`index.js`** — overview/stats/factsheets route handlers → provider methods

Each analysis function receives the provider as a parameter:

```javascript
// Before:
async function phase3Architecture(requirement, allQA, landscape) { ... }
// Called: phase3Architecture(req, qa, await loadLandscape(workspace))

// After — identical signature, just the data source is abstracted:
async function phase3Architecture(requirement, allQA, landscape) { ... }
// Called: phase3Architecture(req, qa, await provider.loadArchitectLandscape())
```

### Step 3: Add bulk cards endpoint to Turbo EA backend

**File:** `backend/app/api/v1/cards.py`

Add `GET /cards/export/json` that returns all cards of given types in one request with stakeholders and provider relations pre-joined:

```python
@router.get("/cards/export/json")
async def export_json(
    types: str,  # comma-separated type keys
    include_relations: bool = False,
    include_stakeholders: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
```

This avoids the N+1 pagination problem. Returns the same card shape as `GET /cards` but without a page_size limit, and optionally embeds related Provider names and stakeholder owner in each card.

### Step 4: Create McpDataProvider

**New file:** `archlens/server/services/mcpDataProvider.js`

Uses Turbo EA's REST API directly (not the MCP protocol layer) with an OAuth token for auth. The MCP OAuth flow is used only for token acquisition.

```javascript
class McpDataProvider {
  constructor(config) {
    this.baseUrl = config.turbo_ea_url;  // e.g. http://backend:8000/api/v1
    this.token = null;
  }

  async loadFullLandscape() {
    // Single call: GET /cards/export/json?types=Application,ITComponent,Interface,Provider
    //              &include_relations=true&include_stakeholders=true
    const raw = await this._fetch('/cards/export/json', { ... });
    // Normalize Turbo EA cards → ArchLens fact_sheet shape
    return {
      apps: raw.filter(c => c.type === 'Application').map(this._normalize),
      itcs: raw.filter(c => c.type === 'ITComponent').map(this._normalize),
      ifaces: raw.filter(c => c.type === 'Interface').map(this._normalize),
      providers: raw.filter(c => c.type === 'Provider').map(this._normalize),
    };
  }

  // Map Turbo EA card → ArchLens fact_sheet shape
  _normalize(card) {
    return {
      id: card.id,
      fs_type: card.type,
      name: card.name,
      description: card.description,
      lifecycle: extractLatestPhase(card.lifecycle),
      owner: card._stakeholders?.find(s => s.role === 'responsible')?.display_name || null,
      owner_email: card._stakeholders?.find(s => s.role === 'responsible')?.email || null,
      completion: (card.data_quality || 0) / 100,
      vendors: card._provider_names || [],  // pre-joined by bulk endpoint
      tags: (card.tags || []).map(t => t.name),
      criticality: card.attributes?.businessCriticality || null,
      tech_fit: card.attributes?.technicalSuitability || card.attributes?.technicalFit || null,
      annual_cost: card.attributes?.costTotalAnnual || null,
      quality_score: computeQualityScore(card),
      // ... derived fields (locker, issues)
    };
  }
}
```

**In-memory cache strategy:** Each `McpDataProvider` instance caches the fetched data for the duration of one analysis run. Multiple method calls within the same run reuse the cache. Cache is discarded when the provider is garbage-collected (no persistent state).

### Step 5: Update workspace model + connection UI

**ArchLens DB (`db.js`):**
- `workspaces` table: `source_type` now supports `'mcp'` in addition to `'turboea'`, `'leanix'`
- For MCP workspaces: store Turbo EA base URL + OAuth refresh token (no email/password)

**ArchLens server (`index.js`):**
- `POST /api/connect` accepts `source_type: 'mcp'`
- For MCP connections: test connectivity with a lightweight API call, skip sync
- Provider factory reads `source_type` to pick SqliteDP or McpDP

**Turbo EA frontend (`ArchLensAdmin.tsx`):**
- Connection dialog gets a source type selector:
  - **MCP (recommended for Turbo EA)** — only requires Turbo EA URL. No credentials. Shows "Live data" badge. Hides "Sync Data" button.
  - **Direct Sync** — current behavior with email+password+sync button. For non-MCP sources.

**Turbo EA backend (`archlens.py`):**
- `GET /archlens/status` treats MCP connections as always "synced":
  ```python
  or_(
      ArchLensConnection.sync_status == "completed",  # Direct sync
      ArchLensConnection.source_type == "mcp",        # MCP = always live
  )
  ```

### Step 6: Add ArchLens MCP connection type to DB model

**File:** `backend/app/models/archlens.py`

Add `source_type` column to `ArchLensConnection`:

```python
source_type = Column(String(20), default="sync", nullable=False)
# Values: "sync" (traditional), "mcp" (live via MCP/API)
```

**Migration:** New Alembic migration to add the column.

---

## Migration Path

| Phase | Scope | Risk |
|---|---|---|
| **A — Refactor** (Steps 1-2) | Extract SqliteDataProvider, update consumers. Pure refactor, no behavior change. | Low — same queries, just moved |
| **B — MCP path** (Steps 3-5) | Add bulk endpoint, McpDataProvider, connection UI. MCP becomes available alongside sync. | Medium — new code path, needs testing |
| **C — Default MCP** (Step 6) | For Turbo EA deployments, default new connections to MCP. Direct sync remains for others. | Low — UI default only |

---

## What Stays the Same

- ArchLens analysis tables (`vendor_analysis`, `duplicate_clusters`, etc.) always in SQLite
- AI analysis logic (prompts, categorization, clustering) unchanged
- Architect 3-phase flow unchanged
- ArchLens UI tabs (vendors, duplicates, architect, history) unchanged
- The normalized `fact_sheet` shape is the **interface contract** — both providers output the same shape

## What Changes

| Aspect | Before | After (MCP path) |
|---|---|---|
| Data source | Always SQLite snapshot | Live API (MCP) or SQLite (legacy) |
| Freshness | Manual sync button | Real-time (MCP) or manual (SQLite) |
| Auth for data | Stored email+password | OAuth token (MCP) or stored creds (SQLite) |
| RBAC scope | Single sync user's view | Per-request user permissions (MCP) |
| Sync button | Always required | Hidden for MCP connections |
| Credential storage | Email+password in ArchLens DB | None for MCP connections |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| MCP path slower than SQLite for large landscapes (500+ cards) | Bulk endpoint returns all cards in one call; in-memory cache per analysis run |
| Token expiry mid-analysis | Auto-refresh before each API call; analysis runs are typically < 2 min |
| Network failure during MCP fetch | Return clear error; user can retry; SQLite path always available as fallback |
| Two code paths = double maintenance | DataProvider interface enforces consistent shape; shared normalization; integration tests for both providers |
| Bulk endpoint could be abused | Rate-limit it; require `inventory.export` permission; cap at 5000 cards |
