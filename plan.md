# Plan: Fix PPM Gantt & Portfolio Remaining Issues

Four issues to fix. Each has a clear root cause identified from library source code analysis.

---

## Issue 1: Alternating Rows Lost in Gantt SVG Area (Both Modes)

**Root cause**: The `@wamra/gantt-task-react` library does **not** render alternating row backgrounds in the SVG gantt area. The SVG gets a single solid `background: colors.oddTaskBackgroundColor` as an inline style (lib line 6175). The only things rendered in the SVG grid are holiday columns and a "today" column. Alternating row colors only exist on the HTML table side via inline `backgroundColor` on each row div.

There is no prop or API to add SVG row striping — it simply doesn't exist in this library.

**Fix**: Post-render DOM injection. After the Gantt mounts, find the SVG's `<g class="gridBody">` element and prepend alternating `<rect>` elements for even-indexed rows.

**Implementation** (in `PpmGanttTab.tsx`):
1. Add a new `useEffect` that runs after render, keyed on `ganttTasks.length` and `theme.palette.mode`
2. Inside the effect:
   - Query `ganttRef.current` for the SVG element, then find `g.gridBody` (or `g.grid`)
   - Get the row height: the library uses 50px default (matching `fullRowHeight`). We can read the SVG's `height` attribute and divide by the number of task rows to confirm.
   - Create/update a `<g id="turbo-row-stripes">` element at the beginning of the SVG (before grid lines and task bars) containing `<rect>` elements: even-indexed rows get `fill=evenTaskBackgroundColor`, odd rows are transparent (the SVG background serves as odd color)
   - Use a `MutationObserver` on the SVG to re-inject when the library re-renders (expand/collapse, scroll)
3. Colors: light mode even = `#f5f5f5`, dark mode even = `theme.palette.background.paper`. The SVG background (`oddTaskBackgroundColor`) handles odd rows.
4. Must also handle the case where tasks expand/collapse (row count changes) — the `MutationObserver` covers this.

---

## Issue 2: Quarter Labels Overlapping (iPad + Desktop First Label)

**Root cause**: The current code uses `window.innerWidth * 0.35` to estimate the timeline column width. This is completely wrong — the actual timeline column is `1fr` in a CSS grid with fixed columns totaling ~610px. On iPad (1024px viewport) the timeline column might be ~165px while the estimate says ~358px, causing `step=1` (show all labels) when they clearly don't fit.

The first-label overlap on desktop happens because the first quarter's start date may precede `windowStart`, clamping its `left` to 0%. The next quarter is close by, and `transform: translateX(-50%)` makes the first label's right half overlap the second label's left half.

**Fix**: Use `useRef` + `ResizeObserver` to measure the actual pixel width of the timeline column container.

**Implementation** (in `PpmPortfolio.tsx`):
1. Add `const timelineRef = useRef<HTMLDivElement>(null)` and `const [timelineWidth, setTimelineWidth] = useState(300)`
2. Add a `useEffect` with `ResizeObserver`:
   ```typescript
   useEffect(() => {
     const el = timelineRef.current;
     if (!el) return;
     const ro = new ResizeObserver(([entry]) => setTimelineWidth(entry.contentRect.width));
     ro.observe(el);
     return () => ro.disconnect();
   }, []);
   ```
3. Attach `ref={timelineRef}` to the quarter labels `<Box>` container
4. Compute step from measured width:
   ```typescript
   const pxPerQuarter = quarters.length > 1 ? timelineWidth / quarters.length : timelineWidth;
   const step = pxPerQuarter >= 60 ? 1 : pxPerQuarter >= 30 ? 2 : 4;
   ```
5. For the first-label clipping: offset the first shown label's `left` to at least `2%` so `translateX(-50%)` doesn't push it out of bounds. Alternatively, use `transform: translateX(0)` for the first label and `translateX(-100%)` for the last label (edge-aware positioning).

---

## Issue 3: Dark Mode — Selected Row Turns White on Table Side

**Root cause**: The library's `selectedTaskBackgroundColor` is applied as an inline `backgroundColor` on the row div (lib line 1258). We set it to `rgba(144, 202, 249, 0.16)` — a semi-transparent value. The issue: the library also creates its own internal MUI theme (lib line 1012, `createTheme(themeOptions)`) which is always a **light** theme (variable named `materialLightTheme`). MUI focus/hover states from this internal light theme may paint white overlays on top. Additionally, semi-transparent colors blend differently depending on what's underneath, and on odd rows vs even rows the underlying color differs, creating inconsistent visual results.

**Fix**: Use **opaque** selection colors that look correct regardless of what's underneath, bypassing any alpha-blending issues.

**Implementation** (in `PpmGanttTab.tsx`):
1. Change `selectedTaskBackgroundColor` from semi-transparent rgba to opaque values:
   - Dark mode: `#1a3a5c` (a dark navy blue — visually similar to the current intent but opaque)
   - Light mode: `#e3f2fd` (MUI blue-50 — a light blue that's clearly highlighted)
2. These opaque colors guarantee the selected row looks identical on even and odd rows, and aren't affected by the library's internal light theme overlays.

---

## Issue 4: Touch Horizontal Scroll Not Working

**Root cause**: The library registers a `touchmove` handler on the SVG element (lib line 7841) that unconditionally calls `event.preventDefault()` (lib line 7801) — even when no task drag is in progress. The `handleMove()` function bails out early when no drag is happening, but `preventDefault()` is called **before** `handleMove()`, killing the browser's native touch scroll.

Our current workaround uses capture-phase **passive** touch handlers. This can't work because:
- `passive: true` means we can't call `stopPropagation()` or `preventDefault()`
- The library's bubble-phase handler fires after ours and still calls `preventDefault()`
- Our manual `scrollLeft` changes are fighting against the blocked native scroll

**Fix**: Use a capture-phase **non-passive** `touchmove` handler that calls `stopImmediatePropagation()` when the user is scrolling (not dragging a task bar). This prevents the library's handler from ever firing.

**Implementation** (in `PpmGanttTab.tsx`):
1. Replace the current passive touch workaround with:
   ```typescript
   const onTouchStart = (e: TouchEvent) => {
     if (e.touches.length !== 1) return;
     // If touch starts on a task bar, let the library handle it (drag)
     if (isBarElement(e.target)) { isManualScroll = false; return; }
     const sc = findScrollContainer();
     if (!sc) return;
     touchStartX = e.touches[0].clientX;
     touchStartY = e.touches[0].clientY;
     scrollStartLeft = sc.scrollLeft;
     isManualScroll = true;
   };

   const onTouchMove = (e: TouchEvent) => {
     if (!isManualScroll || e.touches.length !== 1) return;
     // Key: stopImmediatePropagation prevents the library's touchmove handler
     // from firing, which would call preventDefault() and kill scrolling
     e.stopImmediatePropagation();
     const sc = findScrollContainer();
     if (sc) {
       const dx = touchStartX - e.touches[0].clientX;
       sc.scrollLeft = scrollStartLeft + dx;
     }
   };
   ```
2. Register with `{ capture: true, passive: false }` — non-passive is required so `stopImmediatePropagation()` works before the browser decides whether to scroll natively, and capture phase fires before the library's bubble-phase handler.
3. The `touchstart` handler stays `passive: true` since it doesn't need to prevent anything.
4. Add a deadzone check: only activate manual scroll if horizontal movement exceeds vertical by a threshold (e.g., 10px), so vertical page scrolling still works naturally.

---

## Implementation Order

1. **Touch scroll** (Issue 4) — highest user impact, completely broken
2. **Selected row white** (Issue 3) — simple color change, quick fix
3. **Quarter labels** (Issue 2) — ResizeObserver measurement
4. **SVG alternating rows** (Issue 1) — DOM injection, most complex

## Files Modified

- `frontend/src/features/ppm/PpmGanttTab.tsx` — Issues 1, 3, 4
- `frontend/src/features/ppm/PpmPortfolio.tsx` — Issue 2
