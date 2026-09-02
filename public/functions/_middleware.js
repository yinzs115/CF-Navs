export async function onRequest(context) {
  // 设置你想要的登录账号和密码
  const USERNAME = "fanwb";
  const PASSWORD = "yinzhishang205";

  const authHeader = context.request.headers.get("Authorization");

  if (authHeader) {
    const [scheme, encoded] = authHeader.split(" ");
    if (scheme === "Basic") {
      const decoded = atob(encoded);
      const [user, pass] = decoded.split(":");
      // 校验账号密码
      if (user === USERNAME && pass === PASSWORD) {
        return await context.next(); // 验证成功，放行加载网站
      }
    }
  }

  // 密码错误或未输入，弹出浏览器原生密码框
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Protected Area"',
    },
  });
}
