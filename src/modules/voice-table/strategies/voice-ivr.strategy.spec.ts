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
      result: '語音通話',
    });
    expect(result.rows[0].callDate?.toISOString()).toContain('2026-05-14');
    expect(result.rows[1]).toMatchObject({
      recordId: '96027',
      statusType: '振鈴狀態',
      result: '無人接聽',
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
});
