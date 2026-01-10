const { createConnection } = require('typeorm');
const { config } = require('dotenv');

// 加载环境变量
config();

async function queryDatabase() {
  console.log('📊 连接数据库...\n');

  const connection = await createConnection({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'crm_db',
  });

  console.log('✅ 数据库连接成功\n');

  // 查询所有表
  const tables = await connection.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);

  console.log('📋 数据库表列表:');
  tables.forEach(table => {
    console.log(`  - ${table.table_name}`);
  });
  console.log('');

  // 查询 webpages 表的统计信息
  const webpageStats = await connection.query(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN metadata->>'proxied' = 'true' THEN 1 END) as proxied_count,
      COUNT(CASE WHEN "sourcePluginId" = 'browser-extension-proxy' THEN 1 END) as proxy_count,
      COUNT(CASE WHEN "sourcePluginId" = 'browser-extension' THEN 1 END) as browser_count
    FROM webpages
  `);

  console.log('📊 Webpages 表统计:');
  console.log(`  总记录数: ${webpageStats[0].total}`);
  console.log(`  代理请求: ${webpageStats[0].proxied_count}`);
  console.log(`  插件请求: ${webpageStats[0].browser_count}`);
  console.log('');

  // 查询最近 10 条记录
  const recentWebpages = await connection.query(`
    SELECT
      id,
      url,
      title,
      domain,
      "sourcePluginId",
      metadata->>'statusCode' as status_code,
      metadata->>'requestMethod' as method,
      "createdAt"
    FROM webpages
    ORDER BY "createdAt" DESC
    LIMIT 10
  `);

  console.log('📄 最近 10 条记录:');
  console.log('');
  recentWebpages.forEach((record, index) => {
    console.log(`${index + 1}. ${record.method || 'GET'} - 状态码: ${record.status_code || 'N/A'}`);
    console.log(`   URL: ${record.url}`);
    console.log(`   来源: ${record.sourcePluginId}`);
    console.log(`   时间: ${new Date(record.createdAt).toLocaleString('zh-CN')}`);
    console.log('');
  });

  // 按状态码统计
  const statusCodeStats = await connection.query(`
    SELECT
      metadata->>'statusCode' as status_code,
      COUNT(*) as count
    FROM webpages
    WHERE metadata->>'statusCode' IS NOT NULL
    GROUP BY metadata->>'statusCode'
    ORDER BY count DESC
  `);

  console.log('📈 状态码分布:');
  statusCodeStats.forEach(stat => {
    console.log(`  ${stat.status_code}: ${stat.count} 条`);
  });
  console.log('');

  // 查询带响应体的记录数
  const contentStats = await connection.query(`
    SELECT
      COUNT(*) as total_with_content,
      COUNT(CASE WHEN "htmlContent" != '' THEN 1 END) as html_count,
      COUNT(CASE WHEN content != '' THEN 1 END) as content_count
    FROM webpages
  `);

  console.log('📝 内容统计:');
  console.log(`  有内容的记录: ${contentStats[0].total_with_content}`);
  console.log(`  HTML 内容: ${contentStats[0].html_count}`);
  console.log(`  JSON/文本内容: ${contentStats[0].content_count}`);
  console.log('');

  await connection.close();
  console.log('✅ 数据库查询完成');
}

// 运行查询
queryDatabase().catch(error => {
  console.error('❌ 查询失败:', error.message);
  process.exit(1);
});
