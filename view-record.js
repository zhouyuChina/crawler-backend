const { createConnection } = require('typeorm');
const { config } = require('dotenv');

// 加载环境变量
config();

async function viewRecord(recordId) {
  const connection = await createConnection({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'crm_db',
  });

  if (recordId) {
    // 查看指定记录
    const record = await connection.query(
      `SELECT * FROM webpages WHERE id = $1`,
      [recordId]
    );

    if (record.length === 0) {
      console.log('❌ 未找到记录');
      await connection.close();
      return;
    }

    const r = record[0];
    console.log('\n📄 记录详情:');
    console.log('='.repeat(60));
    console.log(`ID: ${r.id}`);
    console.log(`URL: ${r.url}`);
    console.log(`标题: ${r.title}`);
    console.log(`域名: ${r.domain}`);
    console.log(`来源: ${r.sourcePluginId}`);
    console.log(`浏览器: ${r.browserType}`);
    console.log(`创建时间: ${new Date(r.createdAt).toLocaleString('zh-CN')}`);
    console.log('='.repeat(60));

    if (r.metadata) {
      console.log('\n📋 元数据:');
      console.log(JSON.stringify(r.metadata, null, 2));
    }

    if (r.content) {
      console.log('\n📝 内容 (content):');
      console.log('-'.repeat(60));
      console.log(r.content.substring(0, 500));
      if (r.content.length > 500) {
        console.log(`\n... (还有 ${r.content.length - 500} 个字符)`);
      }
    }

    if (r.htmlContent) {
      console.log('\n🌐 HTML 内容 (htmlContent):');
      console.log('-'.repeat(60));
      console.log(r.htmlContent.substring(0, 500));
      if (r.htmlContent.length > 500) {
        console.log(`\n... (还有 ${r.htmlContent.length - 500} 个字符)`);
      }
    }
  } else {
    // 列出最近的记录供选择
    const records = await connection.query(`
      SELECT
        id,
        url,
        metadata->>'statusCode' as status_code,
        metadata->>'requestMethod' as method,
        LENGTH(content) as content_length,
        LENGTH("htmlContent") as html_length,
        "createdAt"
      FROM webpages
      ORDER BY "createdAt" DESC
      LIMIT 20
    `);

    console.log('\n📋 最近 20 条记录（使用 ID 查看详情）:');
    console.log('使用方法: node view-record.js <record-id>\n');

    records.forEach((r, index) => {
      const contentInfo = r.content_length > 0 ? `📝 ${r.content_length}字符` : '';
      const htmlInfo = r.html_length > 0 ? `🌐 ${r.html_length}字符` : '';
      const statusIcon = r.status_code === '200' ? '✅' : '❌';

      console.log(`${index + 1}. ${statusIcon} ${r.method || 'GET'} - ${r.status_code || 'N/A'}`);
      console.log(`   ID: ${r.id}`);
      console.log(`   URL: ${r.url.substring(0, 80)}${r.url.length > 80 ? '...' : ''}`);
      console.log(`   内容: ${contentInfo} ${htmlInfo}`);
      console.log(`   时间: ${new Date(r.createdAt).toLocaleString('zh-CN')}`);
      console.log('');
    });

    console.log('💡 查看完整记录内容:');
    console.log(`   node view-record.js ${records[0].id}`);
    console.log('');
  }

  await connection.close();
}

// 从命令行参数获取记录 ID
const recordId = process.argv[2];
viewRecord(recordId).catch(error => {
  console.error('❌ 查询失败:', error.message);
  process.exit(1);
});
