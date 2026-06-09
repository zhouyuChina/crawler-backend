import * as cheerio from 'cheerio';
import {
  ParseResult,
  ParsedRowVoiceIvr,
  ParsedSummaryVoiceIvr,
  VoiceTableStrategy,
} from './strategy.types';
import {
  cleanText,
  extractTotalPages,
  parseDateTime,
  parseIntSafe,
} from './parse-utils';

const SUMMARY_PATTERNS = {
  totalRecords: /語音紀錄分析[：:]\s*(\d+)/,
  connectFail: /接通失敗[：:]\s*(\d+)/,
  busy: /被叫忙線[：:]\s*(\d+)/,
  noAnswer: /無人接聽[：:]\s*(\d+)/,
  connected: /語音通話[：:]\s*(\d+)/,
};

function extractIvrSummary(html: string): ParsedSummaryVoiceIvr {
  const pick = (re: RegExp) => {
    const m = html.match(re);
    return m ? parseInt(m[1], 10) : 0;
  };
  return {
    totalRecords: pick(SUMMARY_PATTERNS.totalRecords),
    connectFail: pick(SUMMARY_PATTERNS.connectFail),
    busy: pick(SUMMARY_PATTERNS.busy),
    noAnswer: pick(SUMMARY_PATTERNS.noAnswer),
    connected: pick(SUMMARY_PATTERNS.connected),
  };
}

function hasIvrSummary(html: string): boolean {
  return SUMMARY_PATTERNS.totalRecords.test(html);
}

/**
 * 从整页 HTML 中截取 listDiv 表格片段，减少 Cheerio 需要解析的 DOM 体积。
 * listDiv 通常只占全页 HTML 的 10-20%，可以显著降低每页内存峰值。
 */
function sliceToListDiv(html: string): string {
  const start = html.indexOf('<div id="listDiv"');
  if (start === -1) return html;
  const tableStart = html.indexOf('<table', start);
  if (tableStart === -1) return html.slice(start);
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableEnd === -1) return html.slice(start);
  return html.slice(start, tableEnd + 8) + '</div>';
}

function extractIvrRows(html: string): ParsedRowVoiceIvr[] {
  const fragment = sliceToListDiv(html);
  const $ = cheerio.load(fragment);
  const rows: ParsedRowVoiceIvr[] = [];

  // 仅在 listDiv 内寻找带 checkbox 的行(排除表头)
  $('#listDiv tr').each((_, tr) => {
    const $tr = $(tr);
    const checkbox = $tr.find('input[type="checkbox"][name="checkboxes[]"]');
    if (checkbox.length === 0) return;

    const recordId = checkbox.attr('value')?.trim();
    if (!recordId) return;

    const $tds = $tr.find('> td');
    const td = (i: number) => cleanText($tds.eq(i).text());

    // 0:checkbox 1:src 2:dst 3:statusType 4:reason 5:task 6:callDate 7:操作
    rows.push({
      recordId,
      src: td(1) || null,
      dst: td(2) || null,
      statusType: td(3) || null,
      reason: td(4) || null,
      task: td(5) || null,
      callDate: parseDateTime(td(6)),
    });
  });

  return rows;
}

export const voiceIvrStrategy: VoiceTableStrategy<
  ParsedRowVoiceIvr,
  ParsedSummaryVoiceIvr
> = {
  module: 'voice_ivr',

  matchUrl(url: string): boolean {
    return /\/cc_voiceivr(\/|\?|$)/i.test(url);
  },

  parse(html: string): ParseResult<ParsedRowVoiceIvr, ParsedSummaryVoiceIvr> {
    return {
      totalPages: extractTotalPages(html),
      summary: extractIvrSummary(html),
      summaryMatched: hasIvrSummary(html),
      rows: extractIvrRows(html),
    };
  },

  buildPageUrl(baseUrl: string, pageId: number): string {
    return baseUrl.replace(/([?&])pageID=\d+/i, `$1pageID=${pageId}`);
  },
};

// 仅供测试导出
export const __testables = { extractIvrSummary, extractIvrRows, hasIvrSummary };
