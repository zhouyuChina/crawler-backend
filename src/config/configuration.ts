export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  database: {
    type: 'postgres' as const,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'crm_db',
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    synchronize: process.env.NODE_ENV !== 'production',
    logging: process.env.NODE_ENV === 'development',
  },
  upload: {
    dest: process.env.UPLOAD_PATH || './uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10),
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },
});
