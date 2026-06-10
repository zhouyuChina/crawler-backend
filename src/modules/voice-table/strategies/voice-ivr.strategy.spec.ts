import * as fs from 'fs';
import * as path from 'path';
import { voiceIvrStrategy } from './voice-ivr.strategy';

describe('voiceIvrStrategy', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '__fixtures__/voice-ivr.sample.html'),
    'utf-8',
  );

  it('matches cc_voiceivr URL', () => {
    expect(
      voiceIvrStrategy.matchUrl(
        'http://45.32.124.36:62361/modules/cc_voiceivr/index.php?mid=24&pageID=1',
      ),
    ).toBe(true);
    expect(
      voiceIvrStrategy.matchUrl(
        'http://45.32.124.36:62361/modules/cc_voiceop/index.php?mid=25',
      ),
    ).toBe(false);
  });

  it('parses summary, totalPages and rows', () => {
    const result = voiceIvrStrategy.parse(html);
    expect(result.totalPages).toBe(7730);
    expect(result.summaryMatched).toBe(true);
    expect(result.summary).toEqual({
      totalRecords: 77300,
      connectFail: 0,
      busy: 0,
      noAnswer: 46788,
      connected: 30512,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      recordId: '96029',
      src: '186000',
      dst: '0433274378',
      statusType: '通話狀態',
      reason: '語音通話',
      task: null,
    });
    expect(result.rows[0].callDate?.toISOString()).toContain('2026-05-14');
    expect(result.rows[1]).toMatchObject({
      recordId: '96027',
      statusType: '振鈴狀態',
      reason: '無人接聽',
    });
  });

  it('marks summary as unmatched when summary text is absent', () => {
    const result = voiceIvrStrategy.parse('<html><body>login</body></html>');
    expect(result.summaryMatched).toBe(false);
    expect(result.summary.totalRecords).toBe(0);
  });

  it('builds page url by replacing pageID', () => {
    const url = voiceIvrStrategy.buildPageUrl(
      'http://x/?mid=24&pageID=1',
      5,
    );
    expect(url).toBe('http://x/?mid=24&pageID=5');
  });

  it('parses callDate when reason is nested inside status column', () => {
    const nestedHtml = `<html><body><div id="listDiv"><table><tr>
      <td class="first-cell"><input type="checkbox" name="checkboxes[]" value="96029">&nbsp;1</td>
      <td>186000</td><td>0433274378</td>
      <td align="center">通話狀態<td align='center'><font color='green'>語音通話</font></td></td>
      <td align="center"></td>
      <td align="center">2026-06-10 14:04:43</td>
      <td align="center"><a href="javascript:delete_voicecallee('96029')">刪除</a></td>
    </tr></table></div></body></html>`;
    const result = voiceIvrStrategy.parse(nestedHtml);
    expect(result.rows[0].callDate?.toISOString()).toContain('2026-06-10');
  });

  it('parses 8-column row: 狀態/終止原因/任務/呼叫時間', () => {
    const html = `<html><body><div id="listDiv"><table><tr>
      <td class="first-cell"><input type="checkbox" name="checkboxes[]" value="217082">&nbsp;1</td>
      <td>732100</td><td>0452585340</td>
      <td align="center">通話狀態</td><td align="center"><font color="green">語音通話</font></td>
      <td align="center"></td>
      <td align="center">2026-06-06 13:59:48</td>
      <td align="center"><a href="javascript:delete_voicecallee('217082')">刪除</a></td>
    </tr></table></div></body></html>`;
    const result = voiceIvrStrategy.parse(html);
    expect(result.rows[0]).toMatchObject({
      recordId: '217082',
      src: '732100',
      dst: '0452585340',
      statusType: '通話狀態',
      reason: '語音通話',
      task: null,
    });
    expect(result.rows[0].callDate?.toISOString()).toContain('2026-06-06');
  });
});
