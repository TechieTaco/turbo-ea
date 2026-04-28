import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";

const PINNED_NAMES = new Set(
  ["cross-industry", "cross industry"].map((s) => s.toLowerCase()),
);

function isPinned(name: string): boolean {
  return PINNED_NAMES.has(name.trim().toLowerCase());
}

interface Props {
  industries: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

export default function IndustryFilter({ industries, selected, onChange }: Props) {
  const { t } = useTranslation(["cards"]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Snapshot the trigger's screen position at open time and pin the menu
  // there. Selecting an industry filters the BC tree below, which can show
  // or hide the page scrollbar; that ~16px viewport-width swing was making
  // the menu visibly slide left/right on every toggle. With a captured
  // anchorPosition the menu stays put for the lifetime of the open state.
  const [anchorPos, setAnchorPos] = useState<{ top: number; left: number } | null>(null);
  // The Menu portals to <body>, so it can't inherit the .tcc-root--dark class
  // we set on the catalogue browser. Tag the menu directly instead.
  const isDark = useTheme().palette.mode === "dark";

  const { pinned, rest } = useMemo(() => {
    const p: string[] = [];
    const r: string[] = [];
    for (const name of industries) (isPinned(name) ? p : r).push(name);
    return { pinned: p, rest: r };
  }, [industries]);

  const valueText = useMemo(() => {
    const arr = Array.from(selected);
    if (arr.length === 0) return t("cards:catalogue.industryValueAll");
    if (arr.length === 1) return arr[0];
    return t("cards:catalogue.industryValueNSelected", { count: arr.length });
  }, [selected, t]);

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  const clearAll = () => {
    onChange(new Set());
    setOpen(false);
  };

  const openMenu = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setAnchorPos({ top: rect.bottom, left: rect.left });
    }
    setOpen(true);
  };

  const renderRow = (name: string) => {
    const checked = selected.has(name);
    return (
      <MenuItem
        key={name}
        className={`tcc-industry-row${checked ? " is-selected" : ""}`}
        onClick={() => toggle(name)}
        disableRipple
      >
        <Checkbox
          size="small"
          checked={checked}
          tabIndex={-1}
          disableRipple
          className="tcc-industry-checkbox"
        />
        <span className="tcc-industry-row-label">{name}</span>
      </MenuItem>
    );
  };

  const selectionCount = selected.size;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`tcc-industry-trigger${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span className="tcc-industry-trigger-label">
          {t("cards:catalogue.industryTriggerLabel")}
        </span>
        <span className="tcc-industry-trigger-value">{valueText}</span>
        <span className="tcc-industry-trigger-chevron" aria-hidden="true">
          <MaterialSymbol icon="expand_more" size={20} />
        </span>
      </button>

      <Menu
        className={`tcc-industry-menu${isDark ? " tcc-industry-menu--dark" : ""}`}
        anchorReference="anchorPosition"
        anchorPosition={anchorPos ?? undefined}
        open={open && anchorPos !== null}
        onClose={() => setOpen(false)}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            className: "tcc-industry-menu-paper",
            elevation: 0,
          },
          list: {
            dense: true,
            disablePadding: true,
          },
        }}
      >
        {selectionCount > 0 && (
          <MenuItem
            key="__clear"
            className="tcc-industry-clear"
            onClick={clearAll}
            disableRipple
          >
            {t("cards:catalogue.industryClearN", { count: selectionCount })}
          </MenuItem>
        )}
        {pinned.map(renderRow)}
        {pinned.length > 0 && rest.length > 0 && (
          <li className="tcc-industry-separator" aria-hidden="true" />
        )}
        {rest.map(renderRow)}
      </Menu>
    </>
  );
}
