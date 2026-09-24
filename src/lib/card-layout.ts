// ---------- Shared page-layout math for every card print tab ----------
// One «unit» = what is printed for ONE person in ONE grid cell:
//   · front only                         (backMode none / separate)
//   · front + back side by side          (backMode beside)
//   · front above back                   (backMode below)
// In `separate` mode the back is printed on its OWN page that follows the
// page of fronts, mirrored so it lands behind its front after duplexing.

import type { BackPrintMode, CardDesign, CardPrintSettings, CardSide } from './card-types';
import { hasBack, paperDims } from './card-types';

// CSS defines 1in = 96px and 1in = 25.4mm → exact physical scale for print
export const MM_TO_PX = 96 / 25.4;

// the mode that actually applies to this design (no back → none)
export const effectiveBackMode = (design: CardDesign | null | undefined, s: CardPrintSettings): BackPrintMode =>
  hasBack(design) ? (s.backMode ?? 'separate') : 'none';

export interface UnitDims {
  w: number; // mm
  h: number; // mm
  mode: BackPrintMode;
  gap: number; // mm between the two faces (beside / below)
}

// size of one printed unit for this design
export const unitDims = (design: CardDesign, s: CardPrintSettings): UnitDims => {
  const mode = effectiveBackMode(design, s);
  const gap = Math.max(0, s.backGap ?? 4);
  if (mode === 'beside') return { w: design.width * 2 + gap, h: design.height, mode, gap };
  if (mode === 'below') return { w: design.width, h: design.height * 2 + gap, mode, gap };
  return { w: design.width, h: design.height, mode, gap };
};

// faces inside a unit with their offset (mm) from the unit's top-left
export interface UnitFace { side: CardSide; dx: number; dy: number }
export const unitFaces = (design: CardDesign, s: CardPrintSettings): UnitFace[] => {
  const { mode, gap } = unitDims(design, s);
  if (mode === 'beside') {
    // front on the right (reading order in an RTL sheet), back on the left
    return [
      { side: 'front', dx: design.width + gap, dy: 0 },
      { side: 'back', dx: 0, dy: 0 },
    ];
  }
  if (mode === 'below') {
    return [
      { side: 'front', dx: 0, dy: 0 },
      { side: 'back', dx: 0, dy: design.height + gap },
    ];
  }
  return [{ side: 'front', dx: 0, dy: 0 }];
};

export interface PageLayout {
  paper: { w: number; h: number };
  unitW: number;
  unitH: number;
  usableW: number;
  usableH: number;
  cols: number;
  rows: number;
  perPage: number;
  /** physical left (mm) of a FRONT cell */
  cellLeft: (col: number) => number;
  /** physical top (mm) of a FRONT cell */
  cellTop: (row: number) => number;
  /** physical left/top (mm) of the SAME item on the mirrored BACK page (separate mode) */
  backCellLeft: (col: number) => number;
  backCellTop: (row: number) => number;
}

// grid of `unitW × unitH` cells inside the printable area
export const computeLayout = (s: CardPrintSettings, unitW: number, unitH: number): PageLayout => {
  const paper = paperDims(s);
  const usableW = paper.w - s.marginRight - s.marginLeft;
  const usableH = paper.h - s.marginTop - s.marginBottom;
  const cols = unitW > 0 ? Math.max(0, Math.floor((usableW + s.gapX) / (unitW + s.gapX))) : 0;
  const rows = unitH > 0 ? Math.max(0, Math.floor((usableH + s.gapY) / (unitH + s.gapY))) : 0;
  const gridW = cols > 0 ? cols * unitW + (cols - 1) * s.gapX : 0;
  const gridH = rows > 0 ? rows * unitH + (rows - 1) * s.gapY : 0;
  const alignH = s.alignH ?? 'center';
  const alignV = s.alignV ?? 'top';
  const offsetX = alignH === 'left' ? 0 : alignH === 'center' ? (usableW - gridW) / 2 : usableW - gridW;
  const offsetY = alignV === 'top' ? 0 : alignV === 'center' ? (usableH - gridH) / 2 : usableH - gridH;
  const cellLeft = (col: number) => s.marginLeft + offsetX + col * (unitW + s.gapX);
  const cellTop = (row: number) => s.marginTop + offsetY + row * (unitH + s.gapY);
  const mirror = s.duplexMirror ?? 'horizontal';
  // the printer turns the sheet about the page center: mirror the physical
  // position (margins / alignment included) so the back sits behind its front
  const backCellLeft = (col: number) => (mirror === 'horizontal' ? paper.w - cellLeft(col) - unitW : cellLeft(col));
  const backCellTop = (row: number) => (mirror === 'vertical' ? paper.h - cellTop(row) - unitH : cellTop(row));
  return {
    paper, unitW, unitH, usableW, usableH, cols, rows, perPage: cols * rows,
    cellLeft, cellTop, backCellLeft, backCellTop,
  };
};

// CSS transform that mirrors a whole page (preview + print)
export const pageFlipTransform = (s: CardPrintSettings): string | undefined => {
  const parts: string[] = [];
  if (s.flipPageH) parts.push('scaleX(-1)');
  if (s.flipPageV) parts.push('scaleY(-1)');
  return parts.length ? parts.join(' ') : undefined;
};

// split items into pages of `perPage`
export const paginate = <T,>(items: T[], perPage: number): T[][] => {
  if (perPage <= 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) out.push(items.slice(i, i + perPage));
  return out;
};

// number of physical sheets: separate mode doubles the pages (front + back)
export const sheetCount = (pages: number, mode: BackPrintMode): number => (mode === 'separate' ? pages * 2 : pages);
