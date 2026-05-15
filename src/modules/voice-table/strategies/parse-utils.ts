/** 通用解析辅助:总页数 */
export function extractTotalPages(html: string): number {
  // "共有7730頁77300筆" 或 "共有32 頁 319 筆"
  const match = html.match(/共有\s*(\d+)\s*頁/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 1;
}

/** 把 "2026-05-14 14:04:43" 解析为 Date,失败返回 null */
export function parseDateTime(text: string | null | undefined): Date | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  // 替换空格为 T 让 ISO 解析更稳
  const iso = trimmed.replace(' ', 'T');
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** 文本归一:去 &nbsp; 与多余空白 */
export function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/ /g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 解析 "XX.YY %" 为数字 */
export function parsePercent(text: string | null | undefined): number {
  if (!text) return 0;
  const m = text.match(/(-?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

/** 解析整数 */
export function parseIntSafe(text: string | null | undefined): number {
  if (!text) return 0;
  const m = text.match(/(-?\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}
