import * as cheerio from 'cheerio';
import * as crypto from 'crypto';
import {
  ParseResult,
  ParsedRowVoiceOp,
  ParsedSummaryVoiceOp,
  VoiceTableStrategy,
} from './strategy.types';
import {
  cleanText,
  extractTotalPages,
  parseDateTime,
  parseIntSafe,
  parsePercent,
} from './parse-utils';

const SUMMARY_PATTERNS = {
  totalRecords: /通話紀錄[：:]\s*(\d+)/,
  initCount: /初始[：:]\s*(\d+)/,
  ringing: /振鈴[：:]\s*(\d+)/,
  // "通話: N" 出现在 "通話接通率" 之前,用反向断言确保只取数字
  connected: /(?<!接通率)\s通話[：:]\s*(\d+)(?!\s*[%％])/,
  agentCount: /座席[：:]\s*(\d+)/,
  connectRate: /通話接通率[：:]\s*([\d.]+)\s*%/,
  callbackRate: /座席回撥率[：:]\s*([\d.]+)\s*%/,
};

function extractOpSummary(html: string): ParsedSummaryVoiceOp {
  const pickInt = (re: RegExp) => {
    const m = html.match(re);
    return m ? parseInt(m[1], 10) : 0;
  };
  const pickFloat = (re: RegExp) => {
    const m = html.match(re);
    return m ? parseFloat(m[1]) : 0;
  };

  return {
    totalRecords: pickInt(SUMMARY_PATTERNS.totalRecords),
    initCount: pickInt(SUMMARY_PATTERNS.initCount),
    ringing: pickInt(SUMMARY_PATTERNS.ringing),
    connected: pickInt(SUMMARY_PATTERNS.connected),
    agentCount: pickInt(SUMMARY_PATTERNS.agentCount),
    connectRate: pickFloat(SUMMARY_PATTERNS.connectRate),
    callbackRate: pickFloat(SUMMARY_PATTERNS.callbackRate),
  };
}

/** 截取第一个 </body> 之前的部分,丢掉拼接的"座席接聽明細" HTML */
function truncateAtFirstBody(html: string): string {
  const idx = html.toLowerCase().indexOf('</body>');
  return idx > 0 ? html.slice(0, idx + '</body>'.length) : html;
}

function buildOpRecordKey(row: {
  src: string | null;
  dst: string | null;
  callDate: Date | null;
  endDate: Date | null;
}): string {
  const raw = [
    row.src ?? '',
    row.dst ?? '',
    row.callDate ? row.callDate.toISOString() : '',
    row.endDate ? row.endDate.toISOString() : '',
  ].join('|');
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 32);
}

function extractOpRows(html: string): ParsedRowVoiceOp[] {
  const truncated = truncateAtFirstBody(html);
  const $ = cheerio.load(truncated);
  const rows: ParsedRowVoiceOp[] = [];

  // 列序: 0:序号 1:任務 2:主叫 3:被叫 4:座席 5:終止原因 6:轉呼時長 7:呼叫時間 8:終止時間
  $('#listDiv tr').each((_, tr) => {
    const $tr = $(tr);
    const $tds = $tr.find('> td');
    if ($tds.length < 9) return; // 跳过表头/不完整行

    const td = (i: number) => cleanText($tds.eq(i).text());

    const callDate = parseDateTime(td(7));
    const endDate = parseDateTime(td(8));
    const src = td(2) || null;
    const dst = td(3) || null;

    if (!callDate && !src && !dst) return; // 全空跳过

    const row: ParsedRowVoiceOp = {
      recordKey: '',
      task: td(1) || null,
      src,
      dst,
      agent: td(4) || null,
      reason: td(5) || null,
      duration: td(6) || null,
      callDate,
      endDate,
    };
    row.recordKey = buildOpRecordKey(row);
    rows.push(row);
  });

  return rows;
}

export const voiceOpStrategy: VoiceTableStrategy<
  ParsedRowVoiceOp,
  ParsedSummaryVoiceOp
> = {
  module: 'voice_op',

  matchUrl(url: string): boolean {
    return /\/cc_voiceop(\/|\?|$)/i.test(url);
  },

  parse(html: string): ParseResult<ParsedRowVoiceOp, ParsedSummaryVoiceOp> {
    const truncated = truncateAtFirstBody(html);
    return {
      totalPages: extractTotalPages(truncated),
      summary: extractOpSummary(truncated),
      rows: extractOpRows(html),
    };
  },

  buildPageUrl(baseUrl: string, pageId: number): string {
    return baseUrl.replace(/([?&])pageID=\d+/i, `$1pageID=${pageId}`);
  },
};

export const __testables = {
  extractOpSummary,
  extractOpRows,
  buildOpRecordKey,
  truncateAtFirstBody,
};
