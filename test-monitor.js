const http = require('http');

// 模拟发送浏览器请求数据
function sendRequest(url, method, hasResponse = true) {
  const data = JSON.stringify({
    url: url,
    method: method || 'GET',
    statusCode: 200,
    timestamp: new Date().toISOString(),
    requestBody: hasResponse ? null : null,
    responseBody: hasResponse ? JSON.stringify({ success: true, data: 'test data' }) : null,
    requestHeaders: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    },
    responseHeaders: {
      'Content-Type': 'application/json'
    }
  });

  const options = {
    hostname: 'localhost',
    port: 9000,
    path: '/api/plugin/requests',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = http.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => {
      responseData += chunk;
    });
    res.on('end', () => {
      console.log(`✅ 发送成功: ${method} ${url}`);
      console.log(`   响应: ${responseData}\n`);
    });
  });

  req.on('error', (error) => {
    console.error(`❌ 发送失败: ${error.message}\n`);
  });

  req.write(data);
  req.end();
}

// 测试场景
console.log('🚀 开始测试监控页面实时更新功能\n');
console.log('📌 请在浏览器中打开: http://localhost:9000/api/monitor\n');

// 发送一些测试请求
setTimeout(() => {
  console.log('📤 发送测试请求 1/5');
  sendRequest('https://api.example.com/users', 'GET');
}, 1000);

setTimeout(() => {
  console.log('📤 发送测试请求 2/5');
  sendRequest('https://api.example.com/posts', 'POST');
}, 2000);

setTimeout(() => {
  console.log('📤 发送测试请求 3/5');
  sendRequest('https://api.example.com/comments', 'GET');
}, 3000);

setTimeout(() => {
  console.log('📤 发送测试请求 4/5 (无响应体，应该被跳过)');
  sendRequest('https://api.example.com/ping', 'GET', false);
}, 4000);

setTimeout(() => {
  console.log('📤 发送测试请求 5/5');
  sendRequest('https://api.example.com/users/123', 'PUT');
}, 5000);

setTimeout(() => {
  console.log('\n✨ 测试完成！');
  console.log('💡 请检查监控页面 http://localhost:9000/api/monitor 查看实时更新\n');
}, 6000);
