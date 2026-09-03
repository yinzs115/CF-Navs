// worker/index.ts

// ✅ 删除 import { authMiddleware } from './auth'; 这一行，因为下面已经有完整的验证逻辑了

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

// ========== 网站入口密码保护 ==========
// 密码通过 Cloudflare Secret 注入：SITE_PASSWORD。
// 不把密码写进前端，也不把明文密码写入 Cookie。
const SITE_AUTH_COOKIE = 'site_auth'
const SITE_AUTH_PAYLOAD = 'cf-navs-site-access-v1'
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex,nofollow">
  <title>访问验证 - CF-Navs</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px;background:#0f172a;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .box{width:100%;max-width:380px;padding:32px;background:#1e293b;border-radius:18px;box-shadow:0 25px 50px -12px rgba(0,0,0,.5);text-align:center}
    h2{color:#f8fafc;margin-bottom:8px;font-size:24px}
    p{color:#94a3b8;margin-bottom:24px;font-size:14px}
    input{width:100%;padding:12px 14px;margin-bottom:12px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f8fafc;font-size:16px;outline:none}
    input:focus{border-color:#3b82f6}
    button{width:100%;padding:12px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
    button:hover{background:#2563eb}
    .error{color:#f87171;margin-top:12px;font-size:14px}
  </style>
</head>
<body>
  <div class="box">
    <h2>🔒 访问验证</h2>
    <p>请输入访问密码继续</p>
    <form method="POST">
      <input type="password" name="password" placeholder="请输入密码" autocomplete="current-password" required autofocus>
      <button type="submit">进入网站</button>
    </form>
    {{ERROR}}
  </div>
</body>
</html>`

function base64Url(bytes: ArrayBuffer): string {
  let binary = ''
  const data = new Uint8Array(bytes)
  for (const byte of data) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function createSiteAuthToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(SITE_AUTH_PAYLOAD),
  )
  return base64Url(signature)
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie') || ''
  for (const item of cookieHeader.split(';')) {
    const index = item.indexOf('=')
    if (index < 0) continue
    const key = item.slice(0, index).trim()
    if (key === name) return item.slice(index + 1).trim()
  }
  return null
}

function safeNextPath(pathname: string): string {
  // 只允许站内绝对路径，防止利用登录流程做开放重定向。
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return '/'
  return pathname || '/'
}

function loginPage(error = false): Response {
  const html = LOGIN_HTML.replace(
    '{{ERROR}}',
    error ? '<div class="error">密码错误，请重新输入</div>' : '',
  )
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  })
}

app.use('*', async (c, next) => {
  const url = new URL(c.req.url)

  // 健康检查保留公开访问，方便 Cloudflare / 监控检查 Worker 是否正常。
  if (url.pathname === '/api/health') return next()

  const password = c.env.SITE_PASSWORD
  if (!password) {
    return new Response('SITE_PASSWORD is not configured', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' },
    })
  }

  const expectedToken = await createSiteAuthToken(password)
  const currentToken = getCookie(c.req.raw, SITE_AUTH_COOKIE)
  const isAuthed = currentToken === expectedToken

  if (isAuthed) return next()

  // 静态 JS/CSS/图片可以公开加载；真正的 HTML 导航请求必须经过验证。
  // API 不在这里绕过，避免别人直接调用 API 获取导航数据。
  const isStaticAsset = url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|json|map|webmanifest)$/i)
  if (isStaticAsset) return next()

  if (c.req.method === 'POST') {
    const formData = await c.req.formData().catch(() => null)
    const inputPassword = formData?.get('password')
    if (typeof inputPassword === 'string' && inputPassword === password) {
      const token = await createSiteAuthToken(password)
      const redirectPath = safeNextPath(url.pathname)
      return new Response(null, {
        status: 303,
        headers: {
          Location: redirectPath,
          // 没有 Max-Age/Expires，因此这是会话 Cookie；关闭浏览器后需要重新输入。
          'Set-Cookie': `${SITE_AUTH_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`,
          'Cache-Control': 'no-store',
        },
      })
    }
    return loginPage(true)
  }

  return loginPage()
})
// ========== 网站入口密码保护结束 ==========

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
