import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallRecordService } from './call-record.service';
import { CallRecord } from './entities/call-record.entity';

describe('CallRecordService', () => {
  let service: CallRecordService;
  let repository: Repository<CallRecord>;

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      getMany: jest.fn(),
      getRawMany: jest.fn(),
    })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallRecordService,
        {
          provide: getRepositoryToken(CallRecord),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<CallRecordService>(CallRecordService);
    repository = module.get<Repository<CallRecord>>(
      getRepositoryToken(CallRecord),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a call record', async () => {
      const dto = {
        recordType: 'get_peer_status',
        url: 'https://example.com/api/get_peer_status',
        responseBody: '{"status":"online"}',
        dataHash: 'abc123',
        statusCode: 200,
      };

      const mockRecord = { id: 'uuid-123', ...dto };
      mockRepository.create.mockReturnValue(mockRecord);
      mockRepository.save.mockResolvedValue(mockRecord);

      const result = await service.create(dto);

      expect(mockRepository.create).toHaveBeenCalledWith(dto);
      expect(mockRepository.save).toHaveBeenCalledWith(mockRecord);
      expect(result).toEqual(mockRecord);
    });
  });

  describe('findLatestByType', () => {
    it('should return the latest record for a given type', async () => {
      const mockRecord = {
        id: 'uuid-123',
        recordType: 'get_peer_status',
        dataHash: 'abc123',
        createdAt: new Date(),
      };

      mockRepository.findOne.mockResolvedValue(mockRecord);

      const result = await service.findLatestByType('get_peer_status');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { recordType: 'get_peer_status' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual(mockRecord);
    });

    it('should return null if no record exists', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findLatestByType('get_peer_status');

      expect(result).toBeNull();
    });
  });

  describe('hasDataChanged', () => {
    it('should return true when no previous record exists', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.hasDataChanged(
        'get_peer_status',
        '{"status":"online"}',
      );

      expect(result.changed).toBe(true);
      expect(result.hash).toBeDefined();
      expect(typeof result.hash).toBe('string');
    });

    it('should return true when data has changed', async () => {
      const oldRecord = {
        dataHash: 'old-hash-123',
      } as CallRecord;

      mockRepository.findOne.mockResolvedValue(oldRecord);

      const result = await service.hasDataChanged(
        'get_peer_status',
        '{"status":"offline"}',
      );

      expect(result.changed).toBe(true);
      expect(result.hash).not.toBe('old-hash-123');
    });

    it('should return false when data is unchanged', async () => {
      const responseBody = '{"status":"online"}';
      // 预先计算哈希值
      const crypto = require('crypto');
      const expectedHash = crypto
        .createHash('md5')
        .update(responseBody)
        .digest('hex');

      const oldRecord = {
        dataHash: expectedHash,
      } as CallRecord;

      mockRepository.findOne.mockResolvedValue(oldRecord);

      const result = await service.hasDataChanged(
        'get_peer_status',
        responseBody,
      );

      expect(result.changed).toBe(false);
      expect(result.hash).toBe(expectedHash);
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const mockRecords = [
        { id: 'uuid-1', recordType: 'get_peer_status' },
        { id: 'uuid-2', recordType: 'get_peer_status' },
      ];

      mockRepository.findAndCount.mockResolvedValue([mockRecords, 2]);

      const result = await service.findAll({
        page: 1,
        limit: 10,
      });

      expect(result).toEqual({
        items: mockRecords,
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it('should filter by recordType', async () => {
      const mockRecords = [
        { id: 'uuid-1', recordType: 'get_peer_status' },
      ];

      mockRepository.findAndCount.mockResolvedValue([mockRecords, 1]);

      await service.findAll({
        page: 1,
        limit: 10,
        recordType: 'get_peer_status',
      });

      expect(mockRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            recordType: 'get_peer_status',
          }),
        }),
      );
    });
  });
});
