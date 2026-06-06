export type VoiceModule = 'voice_ivr' | 'voice_op';

export interface ParsedRowVoiceIvr {
  recordId: string;
  src: string | null;
  dst: string | null;
  statusType: string | null;
  reason: string | null;
  task: string | null;
  callDate: Date | null;
}

export interface ParsedRowVoiceOp {
  recordKey: string;
  task: string | null;
  src: string | null;
  dst: string | null;
  agent: string | null;
  reason: string | null;
  duration: string | null;
  callDate: Date | null;
  endDate: Date | null;
}

export interface ParsedSummaryVoiceIvr {
  totalRecords: number;
  connectFail: number;
  busy: number;
  noAnswer: number;
  connected: number;
}

export interface ParsedSummaryVoiceOp {
  totalRecords: number;
  initCount: number;
  ringing: number;
  connected: number;
  agentCount: number;
  connectRate: number;
  callbackRate: number;
}

export interface ParseResult<TRow, TSummary> {
  totalPages: number;
  summary: TSummary;
  /** 是否在页面中匹配到了汇总区域，用于区分真实 0 数据和解析失败 */
  summaryMatched: boolean;
  rows: TRow[];
}

export interface VoiceTableStrategy<TRow = any, TSummary = any> {
  module: VoiceModule;
  /** url path 是否归属本策略 */
  matchUrl(url: string): boolean;
  /** 解析单页 HTML */
  parse(html: string): ParseResult<TRow, TSummary>;
  /** 构造分页 URL(替换 pageID) */
  buildPageUrl(baseUrl: string, pageId: number): string;
}
