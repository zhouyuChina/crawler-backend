const http = require('http');

// 测试代理请求功能
function testProxyRequest(url, method = 'GET', headers = {}) {
  const data = JSON.stringify({
    url: url,
    method: method,
    headers: headers
  });

  const options = {
    hostname: 'localhost',
    port: 9000,
    path: '/api/plugin/proxy',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  console.log(`\n🔄 测试代理请求: ${method} ${url}`);

  const req = http.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => {
      responseData += chunk;
    });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(responseData);
        console.log(`✅ 代理请求成功`);
        console.log(`   状态码: ${parsed.data.statusCode}`);
        console.log(`   WebpageId: ${parsed.data.webpageId}`);
        console.log(`   响应体长度: ${parsed.data.responseBody?.length || 0} 字符`);
        if (parsed.data.responseBody) {
          console.log(`   响应体预览: ${parsed.data.responseBody.substring(0, 100)}...`);
        }
      } catch (error) {
        console.log(`   原始响应: ${responseData}`);
      }
    });
  });

  req.on('error', (error) => {
    console.error(`❌ 代理请求失败: ${error.message}`);
  });

  req.write(data);
  req.end();
}

console.log('🚀 开始测试代理请求功能\n');
console.log('📌 请在浏览器中打开监控页面: http://localhost:9000/api/monitor\n');

// 测试场景 1：请求一个公开的 API
setTimeout(() => {
  testProxyRequest('https://jsonplaceholder.typicode.com/posts/1', 'GET');
}, 1000);

// 测试场景 2：请求一个 HTML 页面
setTimeout(() => {
  testProxyRequest('https://example.com', 'GET');
}, 3000);

// 测试场景 3：使用你的实际 URL（根据截图中的 URL）
setTimeout(() => {
  testProxyRequest(
    'http://203.175.165.11:50221/modules/cc_monitor/get_curcall_out.php?date=1767958948721',
    'GET'
  );
}, 5000);

setTimeout(() => {
  console.log('\n✨ 测试完成！');
  console.log('💡 请检查监控页面和数据库查看结果\n');
}, 8000);
