// Shared PDF helper for edge functions.
// Uses pdf-lib (works fine in Deno via the npm: specifier — no native deps).

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'npm:pdf-lib@1.17.1';

export const COMPANY_NAME = Deno.env.get('COMPANY_NAME') ?? 'FieldFlow Services';
export const COMPANY_ADDRESS = Deno.env.get('COMPANY_ADDRESS') ?? '';
export const COMPANY_PHONE = Deno.env.get('COMPANY_PHONE') ?? '';
export const COMPANY_EMAIL = Deno.env.get('COMPANY_EMAIL') ?? '';

const INK = rgb(0.1, 0.11, 0.13);
const SOFT = rgb(0.45, 0.47, 0.5);
const AMBER = rgb(0.85, 0.55, 0.1);
const LINE = rgb(0.85, 0.86, 0.88);

const PAGE_W = 595.28; // A4 pt
const PAGE_H = 841.89;
const MARGIN = 48;

export interface PdfBuilder {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
}

export async function newPdf(): Promise<PdfBuilder> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, page, font, bold, y: PAGE_H - MARGIN };
}

export function text(b: PdfBuilder, str: string, x: number, size = 10, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
  b.page.drawText(str || '', {
    x,
    y: b.y,
    size,
    font: opts.bold ? b.bold : b.font,
    color: opts.color ?? INK
  });
}

export function line(b: PdfBuilder, y = b.y - 4) {
  b.page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.75, color: LINE });
}

export function down(b: PdfBuilder, amount = 16) {
  b.y -= amount;
}

/**
 * Draws word-wrapped text starting at x, advancing b.y as it goes.
 * Returns the number of lines drawn.
 */
export function paragraph(b: PdfBuilder, str: string, x: number, maxWidth: number, size = 10): number {
  const words = (str || '—').replace(/\r/g, '').split(/\s+/);
  let lineStr = '';
  let lines = 0;
  const flush = () => {
    if (b.y < 60) {
      b.page = b.doc.addPage([PAGE_W, PAGE_H]);
      b.y = PAGE_H - MARGIN;
    }
    b.page.drawText(lineStr, { x, y: b.y, size, font: b.font, color: INK });
    down(b, size + 5);
    lines++;
  };
  for (const word of words) {
    const candidate = lineStr ? `${lineStr} ${word}` : word;
    if (b.font.widthOfTextAtSize(candidate, size) > maxWidth && lineStr) {
      flush();
      lineStr = word;
    } else {
      lineStr = candidate;
    }
  }
  if (lineStr) flush();
  return lines;
}

export function header(b: PdfBuilder, docTitle: string, docNumber: string) {
  text(b, COMPANY_NAME, MARGIN, 16, { bold: true });
  text(b, docTitle, PAGE_W - MARGIN - b.bold.widthOfTextAtSize(docTitle, 16), 16, { bold: true, color: AMBER });
  down(b, 18);
  const subLines = [COMPANY_ADDRESS, [COMPANY_PHONE, COMPANY_EMAIL].filter(Boolean).join('  ·  ')].filter(Boolean);
  for (const l of subLines) {
    text(b, l, MARGIN, 9, { color: SOFT });
    down(b, 12);
  }
  text(b, `# ${docNumber}`, PAGE_W - MARGIN - b.font.widthOfTextAtSize(`# ${docNumber}`, 10), 10, { color: SOFT });
  down(b, 14);
  line(b);
  down(b, 20);
}

export function footer(b: PdfBuilder, note: string) {
  b.page.drawText(note, { x: MARGIN, y: 28, size: 8, font: b.font, color: SOFT });
}

export function keyValueRow(b: PdfBuilder, label: string, value: string, x = MARGIN) {
  text(b, label, x, 9, { color: SOFT });
  down(b, 13);
  text(b, value || '—', x, 11, { bold: true });
  down(b, 18);
}

/**
 * Draws a simple line-item table. Returns the builder with y advanced past the table.
 */
export function table(
  b: PdfBuilder,
  columns: { label: string; width: number; align?: 'left' | 'right' }[],
  rows: string[][]
) {
  const startX = MARGIN;
  const tableW = PAGE_W - MARGIN * 2;

  // header row
  b.page.drawRectangle({ x: startX, y: b.y - 6, width: tableW, height: 22, color: rgb(0.96, 0.96, 0.97) });
  let cx = startX + 8;
  for (const col of columns) {
    const w = b.bold.widthOfTextAtSize(col.label, 9);
    const tx = col.align === 'right' ? cx + col.width - w - 8 : cx;
    b.page.drawText(col.label, { x: tx, y: b.y, size: 9, font: b.bold, color: SOFT });
    cx += col.width;
  }
  down(b, 24);

  for (const row of rows) {
    if (b.y < 90) {
      b.page = b.doc.addPage([PAGE_W, PAGE_H]);
      b.y = PAGE_H - MARGIN;
    }
    cx = startX + 8;
    row.forEach((cell, i) => {
      const col = columns[i];
      const w = b.font.widthOfTextAtSize(cell, 9.5);
      const tx = col.align === 'right' ? cx + col.width - w - 8 : cx;
      b.page.drawText(cell, { x: tx, y: b.y, size: 9.5, font: b.font, color: INK });
      cx += col.width;
    });
    down(b, 20);
    line(b, b.y + 8);
  }
  down(b, 6);
}

export function totalsBlock(b: PdfBuilder, rows: { label: string; value: string; emphasize?: boolean }[]) {
  const x = PAGE_W - MARGIN - 200;
  for (const r of rows) {
    text(b, r.label, x, r.emphasize ? 11 : 9.5, { color: r.emphasize ? INK : SOFT, bold: !!r.emphasize });
    const w = (r.emphasize ? b.bold : b.font).widthOfTextAtSize(r.value, r.emphasize ? 11 : 9.5);
    text(b, r.value, PAGE_W - MARGIN - w, r.emphasize ? 11 : 9.5, { bold: !!r.emphasize });
    down(b, r.emphasize ? 18 : 15);
  }
}

export async function toBytes(b: PdfBuilder): Promise<Uint8Array> {
  return b.doc.save();
}