// worker/auth.ts

// 登录页面HTML - 你可以修改样式，但核心功能保持不变
const LOGIN_PAGE = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>验证访问</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .login-box {
      background: white;
      padding: 40px;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      width: 100%;
      max-width: 380px;
      text-align: center;
    }
    .login-box h1 {
      font-size: 22px;
      color: #333;
      margin-bottom: 8px;
    }
    .login-box p {
      color: #888;
      font-size: 14px;
      margin-bottom: 24px;
    }
    .login-box input[type="password"] {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
      outline: none;
      transition: border-color 0.2s;
    }
    .login-box input[type="password"]:focus {
      border-color: #667eea;
    }
    .login-box button {
      width: 100%;
      padding: 12px;
      margin-top: 16px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .login-box button:hover {
      background: #5a6fd6;
    }
    .error-msg {
      color: #e74c3c;
      font-size: 14px;
      margin-bottom: 16px;
      padding: 8px;
      background: #fde8e8;
      border-radius: 6px;
      display: none;
    }
    .error-msg.show {
      display: block;
    }
  </style>
</head>
<body>
  <div class="login-box">
    <h1>🔐 请输入密码</h1>
    <p>此页面需要密码才能访问</p>
    <div class="error-msg" id="errorMsg">❌ 密码错误，请重试</div>
    <form method="POST" action="/">
      <input type="password" name="password" placeholder="请输入密码" id="pwdInput" autofocus>
      <button type="submit">确认访问</button>
    </form>
  </div>
  <script>
    // 如果URL有错误参数，显示错误提示
    if (window.location.search.includes('error=1')) {
      document.getElementById('errorMsg').classList.add('show');
    }
  </script>
</body>
</html>
`;

// 正确的密码
const CORRECT_PASSWORD = '135';

export async function authMiddleware(request: Request): Promise<Response | null> {
  // 检查Cookie中是否有有效的认证标记
  const cookie = request.headers.get('Cookie') || '';
  const hasValidAuth = cookie.split(';').some(c => c.trim() === 'AUTH=1');

  // 如果有有效认证，放行请求（继续执行导航应用）
  if (hasValidAuth) {
    return null; // 返回null表示继续执行后续逻辑
  }

  // 处理POST请求（用户提交密码）
  if (request.method === 'POST') {
    const formData = await request.formData();
    const password = formData.get('password')?.toString() || '';

    if (password === CORRECT_PASSWORD) {
      // 密码正确！设置Cookie并重定向到主页
      const response = new Response(null, {
        status: 302,
        headers: {
          'Location': '/',
          'Set-Cookie': 'AUTH=1; Path=/; HttpOnly; Secure; SameSite=Strict',
        },
      });
      return response;
    } else {
      // 密码错误，重定向到登录页并带错误参数
      return new Response(null, {
        status: 302,
        headers: { 'Location': '/?error=1' },
      });
    }
  }

  // GET请求且没有认证，显示登录页面
  const isError = new URL(request.url).searchParams.has('error');
  const html = LOGIN_PAGE.replace(
    '<div class="error-msg" id="errorMsg">❌ 密码错误，请重试</div>',
    `<div class="error-msg" id="errorMsg" style="${isError ? 'display:block;' : 'display:none;'}">❌ 密码错误，请重试</div>`
  );
  
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}
