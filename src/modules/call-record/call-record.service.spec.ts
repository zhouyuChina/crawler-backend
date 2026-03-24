import { Repository } from 'typeorm';
import { CallRecordService } from './call-record.service';
import { Webpage } from '../webpage/entities/webpage.entity';
import { WebsocketGateway } from '../websocket/websocket.gateway';

describe('CallRecordService', () => {
  let service: CallRecordService;
  let webpageRepository: Pick<Repository<Webpage>, 'createQueryBuilder'>;
  let websocketGateway: Pick<
    WebsocketGateway,
    'broadcastCallStatusChanged'
  >;

  beforeEach(() => {
    webpageRepository = {
      createQueryBuilder: jest.fn(),
    };

    websocketGateway = {
      broadcastCallStatusChanged: jest.fn(),
    };

    service = new CallRecordService(
      webpageRepository as Repository<Webpage>,
      websocketGateway as WebsocketGateway,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('does not query the database when there are no active calls', async () => {
    await service.checkCallStatus();

    expect(webpageRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(
      websocketGateway.broadcastCallStatusChanged,
    ).not.toHaveBeenCalled();
  });

  it('broadcasts ended for stale active calls without querying the database', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-19T12:00:00.000Z'));

    service.recordCallUpdate('get_curcall_in', 'call-1');

    jest.setSystemTime(new Date('2026-03-19T12:00:04.000Z'));
    await service.checkCallStatus();

    expect(webpageRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(
      websocketGateway.broadcastCallStatusChanged,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'call-1',
        recordType: 'get_curcall_in',
        status: 'ended',
      }),
    );
  });

  it('ignores non-call record types when tracking active calls', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-19T12:00:00.000Z'));

    service.recordCallUpdate('get_peer_status', 'peer-1');

    jest.setSystemTime(new Date('2026-03-19T12:00:04.000Z'));
    await service.checkCallStatus();

    expect(webpageRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(
      websocketGateway.broadcastCallStatusChanged,
    ).not.toHaveBeenCalled();
  });
});
