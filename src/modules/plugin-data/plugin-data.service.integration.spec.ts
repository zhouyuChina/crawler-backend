import { Test, TestingModule } from '@nestjs/testing';
import { PluginDataService } from './plugin-data.service';
import { WebpageService } from '../webpage/webpage.service';
import { ScreenshotService } from '../screenshot/screenshot.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { CallRecordService } from '../call-record/call-record.service';

describe('PluginDataService - Call Record Integration', () => {
  let service: PluginDataService;
  let callRecordService: CallRecordService;
  let webpageService: WebpageService;
  let websocketGateway: WebsocketGateway;

  const mockCallRecordService = {
    create: jest.fn(),
    hasDataChanged: jest.fn(),
    findPreviousByType: jest.fn(),
  };

  const mockWebpageService = {
    create: jest.fn(),
  };

  const mockScreenshotService = {
    saveScreenshot: jest.fn(),
  };

  const mockWebsocketGateway = {
    broadcastRequestReceived: jest.fn(),
    broadcastRequestProcessed: jest.fn(),
    broadcastWebpageCreated: jest.fn(),
    broadcastCallRecordCreated: jest.fn(),
    broadcastDataChanged: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PluginDataService,
        {
          provide: CallRecordService,
          useValue: mockCallRecordService,
        },
        {
          provide: WebpageService,
          useValue: mockWebpageService,
        },
        {
          provide: ScreenshotService,
          useValue: mockScreenshotService,
        },
        {
          provide: WebsocketGateway,
          useValue: mockWebsocketGateway,
        },
      ],
    }).compile();

    service = module.get<PluginDataService>(PluginDataService);
    callRecordService = module.get<CallRecordService>(CallRecordService);
    webpageService = module.get<WebpageService>(WebpageService);
    websocketGateway = module.get<WebsocketGateway>(WebsocketGateway);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('URL 关键词识别', () => {
    it('should skip request without keywords', async () => {
      const dto = {
        url: 'https://example.com/api/other',
        method: 'GET',
      };

      const result = await service.processBrowserRequest(dto);

      expect(result.skipped).toBe(true);
      expect(result.message).toContain('不包含关键词');
      expect(mockCallRecordService.create).not.toHaveBeenCalled();
      expect(mockWebpageService.create).not.toHaveBeenCalled();
    });

    it('should process request with get_curcall_in keyword', async () => {
      const dto = {
        url: 'https://pbx.example.com/api/get_curcall_in?ext=1001',
        method: 'GET',
      };

      // Mock HTTP request
      jest.spyOn(service as any, 'makeHttpRequest').mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: '{"status":"ringing"}',
      });

      const mockRecord = {
        id: 'uuid-123',
        recordType: 'get_curcall_in',
        createdAt: new Date(),
      };
      mockCallRecordService.create.mockResolvedValue(mockRecord);

      const result = await service.processBrowserRequest(dto);

      expect(result.success).toBe(true);
      expect(result.recordType).toBe('get_curcall_in');
      expect(mockCallRecordService.create).toHaveBeenCalled();
      expect(mockWebpageService.create).not.toHaveBeenCalled();
    });

    it('should process request with get_peer_status keyword', async () => {
      const dto = {
        url: 'https://pbx.example.com/api/get_peer_status?peer=SIP/1001',
        method: 'GET',
      };

      jest.spyOn(service as any, 'makeHttpRequest').mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: '{"status":"online"}',
      });

      mockCallRecordService.hasDataChanged.mockResolvedValue({
        changed: true,
        hash: 'abc123',
      });

      const mockRecord = {
        id: 'uuid-123',
        recordType: 'get_peer_status',
        createdAt: new Date(),
      };
      mockCallRecordService.create.mockResolvedValue(mockRecord);
      mockCallRecordService.findPreviousByType.mockResolvedValue([]);

      const result = await service.processBrowserRequest(dto);

      expect(result.success).toBe(true);
      expect(result.recordType).toBe('get_peer_status');
      expect(mockCallRecordService.hasDataChanged).toHaveBeenCalled();
    });
  });

  describe('数据变更检测', () => {
    it('should skip saving when data unchanged for get_peer_status', async () => {
      const dto = {
        url: 'https://pbx.example.com/api/get_peer_status?peer=SIP/1001',
        method: 'GET',
      };

      jest.spyOn(service as any, 'makeHttpRequest').mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: '{"status":"online"}',
      });

      mockCallRecordService.hasDataChanged.mockResolvedValue({
        changed: false,
        hash: 'abc123',
      });

      const result = await service.processBrowserRequest(dto);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('data_unchanged');
      expect(mockCallRecordService.create).not.toHaveBeenCalled();
    });

    it('should save when data changed for get_peer_status', async () => {
      const dto = {
        url: 'https://pbx.example.com/api/get_peer_status?peer=SIP/1001',
        method: 'GET',
      };

      jest.spyOn(service as any, 'makeHttpRequest').mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: '{"status":"busy"}',
      });

      mockCallRecordService.hasDataChanged.mockResolvedValue({
        changed: true,
        hash: 'def456',
      });

      const mockRecord = {
        id: 'uuid-123',
        recordType: 'get_peer_status',
        parsedData: { status: 'busy' },
        createdAt: new Date(),
      };
      mockCallRecordService.create.mockResolvedValue(mockRecord);
      mockCallRecordService.findPreviousByType.mockResolvedValue([]);

      const result = await service.processBrowserRequest(dto);

      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(mockCallRecordService.create).toHaveBeenCalled();
      expect(
        mockWebsocketGateway.broadcastCallRecordCreated,
      ).toHaveBeenCalled();
      expect(mockWebsocketGateway.broadcastDataChanged).toHaveBeenCalled();
    });

    it('should NOT check data change for get_curcall_in', async () => {
      const dto = {
        url: 'https://pbx.example.com/api/get_curcall_in?ext=1001',
        method: 'GET',
      };

      jest.spyOn(service as any, 'makeHttpRequest').mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: '{"status":"ringing"}',
      });

      const mockRecord = {
        id: 'uuid-123',
        recordType: 'get_curcall_in',
        createdAt: new Date(),
      };
      mockCallRecordService.create.mockResolvedValue(mockRecord);

      await service.processBrowserRequest(dto);

      expect(mockCallRecordService.hasDataChanged).not.toHaveBeenCalled();
      expect(mockCallRecordService.create).toHaveBeenCalled();
    });
  });

  describe('WebSocket 事件', () => {
    it('should broadcast call-record:created event', async () => {
      const dto = {
        url: 'https://pbx.example.com/api/get_curcall_in?ext=1001',
        method: 'GET',
      };

      jest.spyOn(service as any, 'makeHttpRequest').mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: '{"status":"ringing"}',
      });

      const mockRecord = {
        id: 'uuid-123',
        recordType: 'get_curcall_in',
        url: dto.url,
        parsedData: { status: 'ringing' },
        createdAt: new Date(),
      };
      mockCallRecordService.create.mockResolvedValue(mockRecord);

      await service.processBrowserRequest(dto);

      expect(
        mockWebsocketGateway.broadcastCallRecordCreated,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          id: mockRecord.id,
          recordType: mockRecord.recordType,
          url: mockRecord.url,
          parsedData: mockRecord.parsedData,
        }),
      );
    });

    it('should broadcast data:changed event for get_peer_status', async () => {
      const dto = {
        url: 'https://pbx.example.com/api/get_peer_status?peer=SIP/1001',
        method: 'GET',
      };

      jest.spyOn(service as any, 'makeHttpRequest').mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: '{"status":"busy"}',
      });

      mockCallRecordService.hasDataChanged.mockResolvedValue({
        changed: true,
        hash: 'def456',
      });

      const mockRecord = {
        id: 'uuid-123',
        recordType: 'get_peer_status',
        parsedData: { status: 'busy' },
        createdAt: new Date(),
      };
      mockCallRecordService.create.mockResolvedValue(mockRecord);

      const mockPreviousRecord = {
        parsedData: { status: 'online' },
      };
      mockCallRecordService.findPreviousByType.mockResolvedValue([
        mockPreviousRecord,
      ]);

      await service.processBrowserRequest(dto);

      expect(mockWebsocketGateway.broadcastDataChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          recordType: 'get_peer_status',
          oldData: mockPreviousRecord.parsedData,
          newData: mockRecord.parsedData,
        }),
      );
    });
  });
});
