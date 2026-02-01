/**
 * 测试脚本: 从服务端直接发起带 Cookie 的代理请求
 *
 * 使用方法:
 * node test-proxy-with-cookie.js
 */

const http = require('http');

// 配置
const config = {
  // 后端服务地址
  backendHost: 'localhost',
  backendPort: 9000,

  // 目标网站信息
  targetUrl: 'http://203.175.165.11:50221/modules/get_peer_status.php?date=' + Date.now(),

  // Cookie (从浏览器中复制)
  cookie: '_tea_utm_cache_10000007=undefined; PHPSESSID=d4dd8e9a0ca5d6b89e58522cef9c4e75; COOKIE_USER_ID=697d9d830c40a',
};

// 构造请求数据
const requestData = JSON.stringify({
  url: config.targetUrl,
  method: 'GET',
  headers: {
    'Cookie': config.cookie,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept': '*/*',
    'Referer': 'http://203.175.165.11:50221/modules/index.php',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  }
});

// 发起请求
const options = {
  hostname: config.backendHost,
  port: config.backendPort,
  path: '/api/plugin/proxy',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestData)
  }
};

console.log('🚀 发起代理请求...');
console.log('目标URL:', config.targetUrl);
console.log('Cookie:', config.cookie.substring(0, 50) + '...');
console.log('');

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('📨 收到响应:');
    console.log('状态码:', res.statusCode);
    console.log('');

    try {
      const response = JSON.parse(data);

      if (response.success && response.data) {
        const result = response.data;
        console.log('✅ 请求成功!');
        console.log('');
        console.log('📊 响应信息:');
        console.log('- webpageId:', result.webpageId);
        console.log('- statusCode:', result.statusCode);
        console.log('- 响应体长度:', result.responseBody?.length || 0, '字符');
        console.log('');
        console.log('📄 响应体内容:');
        console.log(result.responseBody);
        console.log('');
        console.log('📋 响应头:');
        console.log(JSON.stringify(result.responseHeaders, null, 2));
      } else {
        console.log('❌ 请求失败:', response.message || response.error);
      }
    } catch (error) {
      console.log('❌ 解析响应失败:', error.message);
      console.log('原始响应:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ 请求错误:', error.message);
});

req.write(requestData);
req.end();
