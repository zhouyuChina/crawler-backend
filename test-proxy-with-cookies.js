const http = require('http');

/**
 * 测试带 cookies 的代理请求
 *
 * 使用方法：
 * 1. 在浏览器中访问目标网站并登录
 * 2. 打开开发者工具 -> Network
 * 3. 找到任意请求，复制 Cookie 值
 * 4. 替换下面的 REPLACE_WITH_YOUR_COOKIE 为实际的 cookie
 * 5. 运行: node test-proxy-with-cookies.js
 */

function testProxyWithCookies(url, cookies) {
  const data = JSON.stringify({
    url: url,
    method: 'GET',
    headers: {
      'Cookie': cookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'http://203.175.165.11:50221/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
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

  console.log(`\n🔄 发送带 cookies 的代理请求`);
  console.log(`URL: ${url}`);
  console.log(`Cookies: ${cookies.substring(0, 50)}...`);

  const req = http.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => {
      responseData += chunk;
    });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(responseData);
        if (parsed.success) {
          console.log(`✅ 代理请求成功`);
          console.log(`   状态码: ${parsed.data.statusCode}`);
          console.log(`   响应体长度: ${parsed.data.responseBody?.length || 0} 字符`);

          if (parsed.data.statusCode === 403) {
            console.log(`\n⚠️  仍然是 403 FORBIDDEN`);
            console.log(`   可能的原因:`);
            console.log(`   1. Cookie 已过期`);
            console.log(`   2. Cookie 格式不正确`);
            console.log(`   3. 需要其他额外的请求头`);
            console.log(`   4. 服务器检查 IP 地址（服务器 IP 与浏览器 IP 不同）`);
          } else if (parsed.data.statusCode === 200) {
            console.log(`\n🎉 成功！响应体预览:`);
            console.log(parsed.data.responseBody.substring(0, 200) + '...');
          }
        } else {
          console.log(`❌ 请求失败:`, parsed);
        }
      } catch (error) {
        console.log(`   原始响应: ${responseData}`);
      }
    });
  });

  req.on('error', (error) => {
    console.error(`❌ 请求失败: ${error.message}`);
  });

  req.write(data);
  req.end();
}

// 测试配置
console.log('🚀 测试带 Cookies 的代理请求\n');
console.log('📌 使用说明:');
console.log('1. 在浏览器中登录目标网站');
console.log('2. 打开开发者工具 (F12) -> Network 标签');
console.log('3. 刷新页面，找到任意请求');
console.log('4. 在 Request Headers 中找到 Cookie 值');
console.log('5. 复制完整的 Cookie 字符串');
console.log('6. 替换下面代码中的 REPLACE_WITH_YOUR_COOKIE\n');

// ⚠️  重要：替换为你的实际 Cookie
const YOUR_COOKIE = 'REPLACE_WITH_YOUR_COOKIE';

// 如果没有替换 cookie，提示用户
if (YOUR_COOKIE === 'REPLACE_WITH_YOUR_COOKIE') {
  console.log('⚠️  请先替换 YOUR_COOKIE 为实际的 Cookie 值！\n');
  console.log('Cookie 格式示例:');
  console.log('PHPSESSID=abc123xyz; user_id=456; session_token=def789\n');
  process.exit(1);
}

// 测试 URL
const testUrl = 'http://203.175.165.11:50221/modules/cc_monitor/get_curcall_out.php?date=' + Date.now();

// 发送测试请求
testProxyWithCookies(testUrl, YOUR_COOKIE);

setTimeout(() => {
  console.log('\n💡 提示:');
  console.log('- 检查监控页面: http://localhost:9000/api/monitor');
  console.log('- 如果仍是 403，可能需要在浏览器插件中实时获取 Cookie');
  console.log('- 参考 BROWSER_PLUGIN_EXAMPLE.md 了解如何在插件中获取 Cookie\n');
}, 2000);
