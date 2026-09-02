export const onRequest: PagesFunction = async (context) => {
  const { request, env } = context;
  
  // 从环境变量读取密码
  const AUTH_PASSWORD = env.SITE_PASSWORD;
  if (!AUTH_PASSWORD) {
    return context.next();
  }

  // 检查 Authorization 头
  const auth = request.headers.get("Authorization");
  if (auth) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      const [, password] = decoded.split(":");
      if (password === AUTH_PASSWORD) {
        return context.next();
      }
    }
  }

  // 未认证，返回 401 弹窗
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Secure Area"',
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
};
