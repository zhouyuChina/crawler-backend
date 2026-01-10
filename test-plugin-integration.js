const http = require('http');

/**
 * 测试插件新格式的集成
 *
 * 模拟插件发送的数据格式：
 * {
 *   "requestId": "12345",
 *   "dataType": "request",
 *   "url": "http://example.com/api/data",
 *   "method": "GET",
 *   "requestHeaders": [
 *     {"name": "Cookie", "value": "PHPSESSID=abc123..."},
 *     {"name": "User-Agent", "value": "Mozilla/5.0..."}
 *   ]
 * }
 */

function testPluginIntegration() {
  // 模拟插件发送的数据（新格式）
  const pluginData = {
    requestId: 'test-' + Date.now(),
    dataType: 'request',  // 标识这是一个需要代理的请求
    url: 'http://203.175.165.11:50221/modules/cc_monitor/get_curcall_out.php?date=' + Date.now(),
    method: 'GET',
    requestHeaders: [
      { name: 'Cookie', value: 'PHPSESSID=test123456; user_id=789' },
      { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      { name: 'Referer', value: 'http://203.175.165.11:50221/' },
      { name: 'Accept', value: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      { name: 'Accept-Language', value: 'zh-CN,zh;q=0.9,en;q=0.8' }
    ]
  };

  const data = JSON.stringify(pluginData);

  const options = {
    hostname: 'localhost',
    port: 9000,
    path: '/api/plugin/requests',  // 使用 /requests 端点
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  console.log('\n🚀 测试插件新格式集成');
  console.log('=' .repeat(50));
  console.log('插件请求 ID:', pluginData.requestId);
  console.log('数据类型:', pluginData.dataType);
  console.log('目标 URL:', pluginData.url);
  console.log('请求方法:', pluginData.method);
  console.log('请求头数量:', pluginData.requestHeaders.length);
  console.log('=' .repeat(50));

  const req = http.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => {
      responseData += chunk;
    });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(responseData);
        console.log('\n✅ 后端响应:');
        console.log('  成功:', parsed.success);
        console.log('  消息:', parsed.message);
        if (parsed.statusCode) {
          console.log('  状态码:', parsed.statusCode);
        }
        if (parsed.webpageId) {
          console.log('  网页 ID:', parsed.webpageId);
        }
        if (parsed.responseBody) {
          console.log('  响应体长度:', parsed.responseBody.length, '字符');
          console.log('  响应体预览:', parsed.responseBody.substring(0, 200) + '...');
        }

        console.log('\n💡 后续步骤:');
        console.log('  1. 打开监控页面: http://localhost:9000/api/monitor');
        console.log('  2. 查看实时请求状态和响应体');
        console.log('  3. 在浏览器插件中使用相同的数据格式发送请求');

        if (parsed.statusCode === 403) {
          console.log('\n⚠️  收到 403 FORBIDDEN');
          console.log('  这是正常的，因为测试 Cookie 是假的');
          console.log('  在实际插件中使用真实的 Cookie 即可');
        }

        console.log('\n✨ 集成测试完成！\n');
      } catch (error) {
        console.error('❌ 解析响应失败:', error.message);
        console.log('原始响应:', responseData);
      }
    });
  });

  req.on('error', (error) => {
    console.error('❌ 请求失败:', error.message);
  });

  req.write(data);
  req.end();
}

// 运行测试
console.log('\n📋 插件集成测试说明');
console.log('=' .repeat(50));
console.log('此脚本模拟浏览器插件发送新格式的数据：');
console.log('1. dataType: "request" 标识需要代理的请求');
console.log('2. requestHeaders: 数组格式的请求头');
console.log('3. 后端会自动：');
console.log('   - 识别新格式');
console.log('   - 转换请求头格式（数组 -> 对象）');
console.log('   - 调用代理服务获取响应体');
console.log('   - 存储到数据库');
console.log('   - 通过 WebSocket 实时推送到监控页面');
console.log('=' .repeat(50) + '\n');

testPluginIntegration();
