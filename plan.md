# Plan: Fix Turbo EA → ArchLens Data Sync

## Root Cause Analysis

The ArchLens AI features (vendor analysis, duplicate detection, architect) operate on the `fact_sheets` table. The sync from Turbo EA populates this table, but several critical columns are empty or wrong due to bugs in `turboea.js`.

### Bug 1: Vendor relations never populate (CRITICAL — blocks vendor analysis)
**File**: `turboea.js` lines 330-336

The code checks `rel.target_type` and `rel.source_type` (flat fields), but the Turbo EA relations API returns nested objects:
```
Response: { source: { id, type, name }, target: { id, type, name }, source_id, target_id }
```
So `rel.target_type` is `undefined`, `rel.source_name` is `undefined`, etc. The vendor map is always empty.

**Fix**: Access nested paths:
- `rel.target_type` → `rel.target?.type`
- `rel.source_type` → `rel.source?.type`
- `rel.target_name` → `rel.target?.name`
- `rel.source_name` → `rel.source?.name`

### Bug 2: tech_fit uses wrong attribute name
**File**: `turboea.js` line 240

Code reads `attrs.technicalFit` but Turbo EA seed uses `technicalSuitability`.

**Fix**: `attrs.technicalSuitability || attrs.technicalFit || null`

### Bug 3: fetchRelations passes unsupported query params
**File**: `turboea.js` line 160

The relations API only supports `card_id` and `type` filters, not `source_type` or `page_size`. Currently works accidentally (params ignored, returns all relations) but is fragile and fetches everything.

**Fix**: Remove unsupported params. Just fetch `/api/v1/relations` (all) once per sync and filter in memory, or fetch per-card.

## Implementation Steps

All fixes are in `temp-archlens-changes/server/services/turboea.js` only (ArchLens side). No Turbo EA backend changes needed.

### Step 1: Fix vendor relation field access in `syncWorkspace()`
Update lines 330-336 to use nested object paths for the relation response format.

### Step 2: Fix tech_fit attribute mapping in `normalise()`
Update line 240 to try `technicalSuitability` first with `technicalFit` fallback.

### Step 3: Clean up fetchRelations query params
Remove `source_type` and `page_size` params that aren't supported by the API.

## What this unblocks

| Feature | Before | After |
|---------|--------|-------|
| **Vendor Analysis** | `vendors` always `[]` → "0 vendor references" → nothing to analyse | Populated with Provider card names → AI categorisation works |
| **Duplicate Detection** | Missing vendor/tech_fit context → weaker AI analysis | Full context for better clustering |
| **Architect** | `loadLandscape()` sees no vendors on apps | Sees vendor relationships → better architecture recommendations |
| **Vendor Resolution** | No vendor data to resolve | Can build vendor hierarchy |

## Files Modified

- `temp-archlens-changes/server/services/turboea.js` — all 3 fixes
