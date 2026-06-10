import * as fs from 'fs';
import * as path from 'path';
import { voiceOpStrategy } from './voice-op.strategy';

describe('voiceOpStrategy', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '__fixtures__/voice-op.sample.html'),
    'utf-8',
  );

  it('matches cc_voiceop URL', () => {
    expect(
      voiceOpStrategy.matchUrl(
        'http://x/modules/cc_voiceop/index.php?mid=25&pageID=2',
      ),
    ).toBe(true);
    expect(
      voiceOpStrategy.matchUrl(
        'http://x/modules/cc_voiceivr/index.php?mid=24',
      ),
    ).toBe(false);
  });

  it('parses summary including rates', () => {
    const result = voiceOpStrategy.parse(html);
    expect(result.totalPages).toBe(32);
    expect(result.summaryMatched).toBe(true);
    expect(result.summary).toEqual({
      totalRecords: 77619,
      initCount: 0,
      ringing: 46788,
      connected: 30512,
      agentCount: 319,
      connectRate: 39.72,
      callbackRate: 1.03,
    });
  });

  it('marks summary as unmatched when summary text is absent', () => {
    const result = voiceOpStrategy.parse('<html><body>login</body></html>');
    expect(result.summaryMatched).toBe(false);
    expect(result.summary.totalRecords).toBe(0);
  });

  it('parses rows ignoring trailing 座席接聽明細 HTML', () => {
    const result = voiceOpStrategy.parse(html);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      task: null,
      src: '186000',
      dst: '0401433393',
      agent: '(186102)',
      reason: '用戶掛機',
      duration: '00:00:02',
    });
    expect(result.rows[0].callDate?.toISOString()).toContain('2026-05-14');
    expect(result.rows[0].endDate?.toISOString()).toContain('2026-05-14');
    expect(result.rows[0].recordKey).toMatch(/^[a-f0-9]{32}$/);
    expect(result.rows[1].task).toBe('040182@');
    expect(result.rows[1].reason).toBe('座席掛機');
  });

  it('builds page url by replacing pageID', () => {
    const url = voiceOpStrategy.buildPageUrl(
      'http://x/?mid=25&pageID=1',
      11,
    );
    expect(url).toBe('http://x/?mid=25&pageID=11');
  });
});
