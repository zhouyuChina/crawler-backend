/**
 * URL 测试脚本 - 找出正确的 API 路径
 *
 * 使用方法:
 * node test-url-finder.js
 */

const http = require('http');

const config = {
  backendHost: 'localhost',
  backendPort: 9000,
  targetHost: '203.175.165.11:50221',
  cookie: '_tea_utm_cache_10000007=undefined; PHPSESSID=d4dd8e9a0ca5d6b89e58522cef9c4e75; COOKIE_USER_ID=697d9d830c40a',
};

// 可能的 URL 路径
const urlsToTest = [
  // 原始路径
  'http://203.175.165.11:50221/modules/get_curcall_in.php',
  'http://203.175.165.11:50221/modules/get_curcall_out.php',
  'http://203.175.165.11:50221/modules/cont_controler.php',
  'http://203.175.165.11:50221/modules/get_peer_status.php',

  // 可能的变体 (不同拼写)
  'http://203.175.165.11:50221/modules/get_cur_call_in.php',
  'http://203.175.165.11:50221/modules/getcurcallin.php',
  'http://203.175.165.11:50221/modules/controller.php',
  'http://203.175.165.11:50221/modules/cont_controller.php',

  // 可能在根目录
  'http://203.175.165.11:50221/get_curcall_in.php',
  'http://203.175.165.11:50221/cont_controler.php',

  // 可能在 api 目录
  'http://203.175.165.11:50221/api/get_curcall_in.php',
  'http://203.175.165.11:50221/api/cont_controler.php',
];

async function testUrl(url) {
  return new Promise((resolve) => {
    const requestData = JSON.stringify({
      url: url + '?date=' + Date.now(),
      method: 'GET',
      headers: {
        'Cookie': config.cookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'http://203.175.165.11:50221/modules/index.php',
      }
    });

    const options = {
      hostname: config.backendHost,
      port: config.backendPort,
      path: '/api/plugin/proxy',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestData)
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const statusCode = response.data?.statusCode || 0;
          const bodyLength = response.data?.responseBody?.length || 0;

          resolve({
            url,
            statusCode,
            bodyLength,
            success: statusCode === 200
          });
        } catch (error) {
          resolve({ url, statusCode: 0, error: error.message });
        }
      });
    });

    req.on('error', (error) => {
      resolve({ url, statusCode: 0, error: error.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ url, statusCode: 0, error: 'Timeout' });
    });

    req.write(requestData);
    req.end();
  });
}

async function main() {
  console.log('🔍 开始测试 URL...\n');
  console.log(`目标服务器: ${config.targetHost}`);
  console.log(`测试 URL 数量: ${urlsToTest.length}\n`);
  console.log('━'.repeat(80));

  const results = [];

  for (const url of urlsToTest) {
    process.stdout.write(`测试: ${url.padEnd(70)} `);
    const result = await testUrl(url);
    results.push(result);

    if (result.success) {
      console.log(`✅ ${result.statusCode} (${result.bodyLength} 字节)`);
    } else if (result.statusCode === 404) {
      console.log(`❌ 404 Not Found`);
    } else if (result.statusCode === 401) {
      console.log(`🔒 401 Unauthorized`);
    } else if (result.error) {
      console.log(`⚠️  ${result.error}`);
    } else {
      console.log(`❓ ${result.statusCode}`);
    }

    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('━'.repeat(80));
  console.log('\n📊 测试结果汇总:\n');

  const successful = results.filter(r => r.success);
  const notFound = results.filter(r => r.statusCode === 404);
  const unauthorized = results.filter(r => r.statusCode === 401);
  const errors = results.filter(r => r.error);

  console.log(`✅ 成功 (200): ${successful.length}`);
  if (successful.length > 0) {
    successful.forEach(r => {
      console.log(`   - ${r.url} (${r.bodyLength} 字节)`);
    });
  }

  console.log(`\n❌ 未找到 (404): ${notFound.length}`);
  console.log(`🔒 未授权 (401): ${unauthorized.length}`);
  console.log(`⚠️  错误: ${errors.length}`);

  if (successful.length > 0) {
    console.log('\n✨ 找到可用的 URL! 请使用上面列出的成功 URL。');
  } else {
    console.log('\n⚠️  没有找到可用的 URL。请检查:');
    console.log('   1. Cookie 是否正确');
    console.log('   2. 目标服务器是否在线');
    console.log('   3. URL 路径是否正确');
  }
}

main().catch(console.error);
