import configuration from './configuration';

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should disable synchronize by default in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DB_SYNCHRONIZE;

    expect(configuration().database.synchronize).toBe(false);
  });

  it('should allow DB_SYNCHRONIZE to override production default', () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_SYNCHRONIZE = 'true';

    expect(configuration().database.synchronize).toBe(true);
  });
});
