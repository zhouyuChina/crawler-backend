import * as cheerio from 'cheerio';
import * as crypto from 'crypto';
import {
  ParseResult,
  ParsedRowVoiceOp,
  ParsedSummaryVoiceOp,
  VoiceTableStrategy,
} from './strategy.types';
import { cleanText, extractTotalPages, parseDateTime } from './parse-utils';

const SUMMARY_PATTERNS = {
  totalRecords: /手撥總筆數[：:]\s*(\d+)/,
  initCount: /初始[：:]\s*(\d+)/,
  ringing: /振鈴[：:]\s*(\d+)/,
  connected: /(?<!接通率)\s通話[：:]\s*(\d+)(?!\s*[%％])/,
  agentCount: /座席[：:]\s*(\d+)/,
  connectRate: /通話接通率[：:]\s*([\d.]+)\s*%/,
  callbackRate: /座席轉接率[：:]\s*([\d.]+)\s*%/,
};

function extractDmOpSummary(html: string): ParsedSummaryVoiceOp {
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

function hasDmOpSummary(html: string): boolean {
  return SUMMARY_PATTERNS.totalRecords.test(html);
}

/** 截取第一个 </body> 之前内容，避免拼接的统计次页面板污染 */
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

function extractDmOpRows(html: string): ParsedRowVoiceOp[] {
  const truncated = truncateAtFirstBody(html);
  const $ = cheerio.load(truncated);
  const rows: ParsedRowVoiceOp[] = [];

  // 列序: 0:序号 1:任務 2:主叫 3:被叫 4:座席 5:通話時長 6:呼叫時間 7:終止時間 8:終止原因
  $('#listDiv tr').each((_, tr) => {
    const $tr = $(tr);
    const $tds = $tr.find('> td');
    if ($tds.length < 9) return;

    const td = (i: number) => cleanText($tds.eq(i).text());
    const callDate = parseDateTime(td(6));
    const endDate = parseDateTime(td(7));
    const src = td(2) || null;
    const dst = td(3) || null;
    if (!callDate && !src && !dst) return;

    const row: ParsedRowVoiceOp = {
      recordKey: '',
      task: td(1) || null,
      src,
      dst,
      agent: td(4) || null,
      reason: td(8) || null,
      duration: td(5) || null,
      callDate,
      endDate,
    };
    row.recordKey = buildOpRecordKey(row);
    rows.push(row);
  });

  return rows;
}

export const voiceDmOpStrategy: VoiceTableStrategy<
  ParsedRowVoiceOp,
  ParsedSummaryVoiceOp
> = {
  module: 'voice_dm_op',

  matchUrl(url: string): boolean {
    return /\/dm_voiceop(\/|\/index\.php|\?|$)/i.test(url);
  },

  parse(html: string): ParseResult<ParsedRowVoiceOp, ParsedSummaryVoiceOp> {
    const truncated = truncateAtFirstBody(html);
    return {
      totalPages: extractTotalPages(truncated),
      summary: extractDmOpSummary(truncated),
      summaryMatched: hasDmOpSummary(truncated),
      rows: extractDmOpRows(html),
    };
  },

  buildPageUrl(baseUrl: string, pageId: number): string {
    return baseUrl.replace(/([?&])pageID=\d+/i, `$1pageID=${pageId}`);
  },
};

