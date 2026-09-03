// worker/index.ts

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
    <form method="POST" action="/">
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

function loginPage(error = false): Response {
  const html = LOGIN_HTML.replace(
    '{{ERROR}}',
    error ? '<div class="error">❌ 密码错误，请重新输入</div>' : '',
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

// ========== 认证中间件 ==========
app.use('*', async (c, next) => {
  const url = new URL(c.req.url)

  // ✅ 所有 /api/* 路径完全放行（后台接口不受网站密码保护）
  if (url.pathname.startsWith('/api/')) {
    return next()
  }

  // 静态资源可以公开加载
  const isStaticAsset = url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|json|map|webmanifest)$/i)
  if (isStaticAsset) return next()

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

  // 已认证用户的 POST 请求 → 重定向到首页
  if (isAuthed && c.req.method === 'POST') {
    return new Response(null, {
      status: 303,
      headers: {
        Location: '/',
        'Cache-Control': 'no-store',
      },
    })
  }

  // 已认证 → 放行
  if (isAuthed) return next()

  // POST 请求 → 处理登录表单
  if (c.req.method === 'POST') {
    const formData = await c.req.formData().catch(() => null)
    const inputPassword = formData?.get('password')
    
    if (typeof inputPassword === 'string' && inputPassword === password) {
      const token = await createSiteAuthToken(password)
      return new Response(null, {
        status: 303,
        headers: {
          Location: '/',
          'Set-Cookie': `${SITE_AUTH_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`,
          'Cache-Control': 'no-store',
        },
      })
    }
    return loginPage(true)
  }

  // GET 请求且未认证 → 显示登录页
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
