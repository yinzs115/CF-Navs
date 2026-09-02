import { Hono } from 'hono'
import { ErrCode } from '../shared/types'
import { withAssetCacheHeaders } from './lib/assetHeaders'
import { fail, ok } from './lib/response'
import { authRequired } from './middleware/auth'
import adminRoutes from './routes/admin'
import authRoutes from './routes/auth'
import bookmarksRoutes from './routes/bookmarks'
import categoriesRoutes from './routes/categories'
import dataRoutes from './routes/data'
import errorReportRoutes from './routes/errorReport'
import faviconRoutes from './routes/favicon'
import installRoutes from './routes/install'
import { iconRoutes } from './routes/icon'
import publicRoutes from './routes/public'
import settingsRoutes from './routes/settings'
import type { HonoEnv } from './types'

const app = new Hono<HonoEnv>()

// ===== 测试标记：确认 Worker 是否执行 =====
app.use('*', async (c, next) => {
  console.log(`[GATE] ${c.req.method} ${new URL(c.req.url).pathname}`)
  await next()
})
// ===== 测试标记结束 =====

app.get('/api/health', (c) => c.json(ok({ status: 'ok' })))

app.route('/api', authRoutes)
app.route('/api', installRoutes)
app.route('/api', publicRoutes)
app.route('/api', errorReportRoutes)

app.use('/api/admin', authRequired)
app.use('/api/admin/*', authRequired)
app.route('/api/admin', adminRoutes)

app.use('/api/categories', authRequired)
app.use('/api/categories/*', authRequired)
app.route('/api/categories', categoriesRoutes)

app.use('/api/bookmarks', authRequired)
app.use('/api/bookmarks/*', authRequired)
app.route('/api/bookmarks', bookmarksRoutes)

app.use('/api/fetch-favicon', authRequired)
app.use('/api/fetch-site-meta', authRequired)
app.route('/api', faviconRoutes)

app.use('/api/iconify-search', authRequired)
app.route('/api', iconRoutes)

app.use('/api/settings', authRequired)
app.use('/api/settings/*', authRequired)
app.route('/api/settings', settingsRoutes)

app.use('/api/import', authRequired)
app.route('/api', dataRoutes)

// ========== 入口密码保护 v2 ==========
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>访问验证</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0f172a;font-family:system-ui,-apple-system,sans-serif}
    .box{background:#1e293b;padding:2.5rem;border-radius:1rem;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);width:100%;max-width:360px;text-align:center}
    h2{color:#f8fafc;margin-bottom:.5rem;font-size:1.5rem}
    p{color:#94a3b8;margin-bottom:1.5rem;font-size:.875rem}
    .ver{color:#64748b;margin-bottom:1rem;font-size:.75rem}
    input{width:100%;padding:.75rem 1rem;margin-bottom:1rem;border:1px solid #334155;border-radius:.5rem;background:#0f172a;color:#f8fafc;font-size:1rem;outline:none;transition:border-color .2s}
    input:focus{border-color:#3b82f6}
    button{width:100%;padding:.75rem;border:none;border-radius:.5rem;background:#3b82f6;color:#fff;font-size:1rem;font-weight:500;cursor:pointer;transition:background .2s}
    button:hover{background:#2563eb}
    .error{color:#ef4444;margin-top:.75rem;font-size:.875rem}
  </style>
</head>
<body>
  <div class="box">
    <h2>🔒 访问验证</h2>
    <p class="ver">v2.0 | 强制密码保护</p>
    <p>请输入密码继续访问</p>
    <form method="POST" action="">
      <input type="password" name="password" placeholder="密码" required autofocus>
      <button type="submit">进入</button>
    </form>
    <div class="error" id="err" style="display:none">密码错误</div>
  </div>
  <script>if(location.search.includes('error=1'))document.getElementById('err').style.display='block'</script>
</body>
</html>`

app.use('*', async (c, next) => {
  const url = new URL(c.req.url)

  // 优先读取环境变量，fallback 硬编码密码（确保绝对生效）
  const envPwd = c.env.SITE_PASSWORD
  const password = envPwd || 'fanxy2026'

  console.log(`[GATE] envPwd=${envPwd ? '有(' + envPwd.length + ')' : '无'} | 使用=${envPwd ? '环境变量' : '硬编码'} | path=${url.pathname}`)

  // API 放行
  if (url.pathname.startsWith('/api/')) {
    console.log('[GATE] API 放行')
    return next()
  }

  // 静态资源放行
  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|json|map|webmanifest)$/)) {
    console.log('[GATE] 静态资源放行')
    return next()
  }

  const cookie = c.req.header('Cookie') || ''
  const authCookie = `site_auth=${btoa(password)}`
  const isAuthed = cookie.includes(authCookie)

  console.log(`[GATE] isAuthed=${isAuthed} | cookie=${cookie.includes('site_auth')}`)

  // POST 提交密码
  if (c.req.method === 'POST' && !isAuthed) {
    const formData = await c.req.formData()
    const inputPwd = formData.get('password') as string
    console.log(`[GATE] POST 密码=${inputPwd === password ? '正确' : '错误'}`)

    if (inputPwd === password) {
      const response = await c.env.ASSETS.fetch(c.req.raw)
      const newHeaders = new Headers(response.headers)
      newHeaders.set('Set-Cookie', `${authCookie}; Path=/; HttpOnly; Secure; SameSite=Strict`)
      console.log('[GATE] 设置 Cookie 放行')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      })
    }

    return c.html(LOGIN_HTML.replace('id="err" style="display:none"', 'id="err" style="display:block"'), 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    })
  }

  if (isAuthed) {
    console.log('[GATE] 已认证放行')
    return next()
  }

  console.log('[GATE] 返回登录页')
  return c.html(LOGIN_HTML, 200, {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  })
})
// ========== 入口密码保护结束 ==========

app.onError((err, c) => {
  console.error(err)
  if (new URL(c.req.url).pathname.startsWith('/api/')) {
    return c.json(fail(ErrCode.SERVER_ERROR, 'internal server error'))
  }
  return new Response('Internal Server Error', { status: 500 })
})

app.all('*', async (c) => {
  if (new URL(c.req.url).pathname.startsWith('/api/')) {
    return c.json(fail(ErrCode.NOT_FOUND, 'not found'))
  }
  const response = await c.env.ASSETS.fetch(c.req.raw)
  return withAssetCacheHeaders(c.req.raw, response)
})

export default app
