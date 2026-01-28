import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';

export interface OutgoingCall {
  index: number;
  callerNumber: string;
  calledNumber: string;
  callStatus: string;
  startTime: string;
  seat?: string; // 座席
  remarks?: string; // 備註
}

export interface OutgoingCallSummary {
  totalTasks: string;
  initialStatus: number;
  ringing: number;
  talking: number;
}

export interface OutgoingCallData {
  calls: OutgoingCall[];
  summary: OutgoingCallSummary;
}

export interface IncomingCall {
  index: number;
  calledNumber: string;
  callbackNumber: string;
  callStatus: string;
  startTime: string;
  duration: string;
  channelId?: string;
  seat?: string; // 座席
  remarks?: string; // 備註
}

export interface IncomingCallSummary {
  manualCalls: number;
  stage1: number;
  stage2: number;
  stage3: number;
  stage4: number;
}

export interface IncomingCallData {
  calls: IncomingCall[];
  summary: IncomingCallSummary;
}

@Injectable()
export class HtmlParserService {
  /**
   * 解析呼出通话列表（1.html - get_curcall_out）
   */
  parseOutgoingCalls(html: string): OutgoingCallData {
    const $ = cheerio.load(html);
    const calls: OutgoingCall[] = [];

    // 遍历数据行（跳过表头）
    $('table.adminlist > tr').each((index, element) => {
      const $tr = $(element);
      const tds = $tr.find('td');

      // 跳过表头和统计行
      if (tds.length === 6) {
        const call: OutgoingCall = {
          index: parseInt($(tds[0]).text().trim(), 10),
          callerNumber: $(tds[1]).text().trim(),
          calledNumber: $(tds[2]).text().trim(),
          callStatus: $(tds[3]).text().trim(),
          startTime: $(tds[4]).text().trim(),
          // 座席信息可能在 callStatus 中，如"一段座席"
          seat: this.extractSeat($(tds[3]).text().trim()),
        };

        calls.push(call);
      }
    });

    // 解析统计信息
    const summaryText = $('table.adminlist > thead > th').text();
    const summary = this.parseOutgoingSummary(summaryText);

    return { calls, summary };
  }

  /**
   * 解析呼入通话列表（2.html - get_curcall_in）
   */
  parseIncomingCalls(html: string): IncomingCallData {
    const $ = cheerio.load(html);
    const calls: IncomingCall[] = [];

    // 遍历数据行（跳过表头）
    $('table.adminlist > tr').each((index, element) => {
      const $tr = $(element);
      const tds = $tr.find('td');

      // 跳过表头和统计行
      if (tds.length === 7) {
        // 提取通道 ID（从操作链接中）
        const channelId = this.extractChannelId($(tds[6]).html() || '');

        const call: IncomingCall = {
          index: parseInt($(tds[0]).text().trim(), 10),
          calledNumber: $(tds[1]).text().trim(),
          callbackNumber: $(tds[2]).text().trim(),
          callStatus: $(tds[3]).text().trim(),
          startTime: $(tds[4]).text().trim(),
          duration: $(tds[5]).text().trim(),
          channelId,
          // 座席信息在 callStatus 中，如"一段座席"
          seat: this.extractSeat($(tds[3]).text().trim()),
        };

        calls.push(call);
      }
    });

    // 解析统计信息
    const summaryText = $('table.adminlist > thead > th').text();
    const summary = this.parseIncomingSummary(summaryText);

    return { calls, summary };
  }

  /**
   * 自动识别并解析（根据列数判断类型）
   */
  parseCallRecords(html: string): OutgoingCallData | IncomingCallData {
    const $ = cheerio.load(html);

    // 获取第一个数据行的列数
    const firstDataRow = $('table.adminlist > tr').eq(1);
    const columnCount = firstDataRow.find('td').length;

    if (columnCount === 6) {
      // 呼出通话（6 列）
      return this.parseOutgoingCalls(html);
    } else if (columnCount === 7) {
      // 呼入通话（7 列）
      return this.parseIncomingCalls(html);
    } else {
      throw new Error(`未知的表格格式，列数: ${columnCount}`);
    }
  }

  /**
   * 解析呼出通话统计信息
   */
  private parseOutgoingSummary(text: string): OutgoingCallSummary {
    // 任務筆數: (1:1) 初始狀態: 1 語音振鈴: 0 語音通話: 0
    const totalTasksMatch = text.match(/任務筆數:\s*\(([^)]+)\)/);
    const initialStatusMatch = text.match(/初始狀態:\s*(\d+)/);
    const ringingMatch = text.match(/語音振鈴:\s*(\d+)/);
    const talkingMatch = text.match(/語音通話:\s*(\d+)/);

    return {
      totalTasks: totalTasksMatch ? totalTasksMatch[1] : '0:0',
      initialStatus: initialStatusMatch ? parseInt(initialStatusMatch[1], 10) : 0,
      ringing: ringingMatch ? parseInt(ringingMatch[1], 10) : 0,
      talking: talkingMatch ? parseInt(talkingMatch[1], 10) : 0,
    };
  }

  /**
   * 解析呼入通话统计信息
   */
  private parseIncomingSummary(text: string): IncomingCallSummary {
    // 人工通話： 1 一段：1 二段：0 三段：0 四段：0
    const manualCallsMatch = text.match(/人工通話[：:]\s*(\d+)/);
    const stage1Match = text.match(/一段[：:]\s*(\d+)/);
    const stage2Match = text.match(/二段[：:]\s*(\d+)/);
    const stage3Match = text.match(/三段[：:]\s*(\d+)/);
    const stage4Match = text.match(/四段[：:]\s*(\d+)/);

    return {
      manualCalls: manualCallsMatch ? parseInt(manualCallsMatch[1], 10) : 0,
      stage1: stage1Match ? parseInt(stage1Match[1], 10) : 0,
      stage2: stage2Match ? parseInt(stage2Match[1], 10) : 0,
      stage3: stage3Match ? parseInt(stage3Match[1], 10) : 0,
      stage4: stage4Match ? parseInt(stage4Match[1], 10) : 0,
    };
  }

  /**
   * 从操作链接中提取通道 ID
   */
  private extractChannelId(html: string): string | undefined {
    // <a href="javascript:TranCH('SIP/SIP-PROVIDER-184000-0001b47a')">
    const match = html.match(/TranCH\('([^']+)'\)/);
    return match ? match[1] : undefined;
  }

  /**
   * 从呼叫状态中提取座席信息
   * 例如："一段座席" -> "一段"
   */
  private extractSeat(callStatus: string): string | undefined {
    // 匹配 "一段座席"、"二段座席" 等
    const match = callStatus.match(/([一二三四]段)座席/);
    if (match) {
      return match[1];
    }

    // 如果包含"座席"但没有段数，返回整个状态
    if (callStatus.includes('座席')) {
      return callStatus;
    }

    return undefined;
  }
}
