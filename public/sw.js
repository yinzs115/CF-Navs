// CF-Navs service worker.
// Strategy:
// - App shell and hashed assets: cache first.
// - Navigations: stale-while-revalidate — serve the cached shell immediately, refresh in the background.
// - /api/category-icon/*: cache first because category icons are low volume.
// - /api/icon/* and /api/iconify/*: do not write to Cache Storage; rely on HTTP and edge caching.
// - Other /api/* requests: network only.

const CACHE = 'cf-navs-v15'
const RUNTIME_CACHE_PREFIX = 'cf-navs-v'
const APP_SHELL = ['/manifest.webmanifest', '/icon.ico', '/icon.png']
const ICON_FALLBACK_TTL_MS = 5 * 60 * 1000
const ICON_FALLBACK_CACHED_AT = 'X-CF-Navs-Fallback-Cached-At'
const MAX_ICON_CACHE_BYTES = 512 * 1024
const SHELL_URL = '/index.html'

function cacheResponse(request, response) {
  if (!response.ok) return

  const copy = response.clone()
  caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined)
}

function isIconFallback(response) {
  return response.headers.get('X-Icon-Fallback') === '1'
}

function fallbackResponseForCache(response) {
  const headers = new Headers(response.headers)
  headers.set(ICON_FALLBACK_CACHED_AT, String(Date.now()))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function matchCachedIcon(request) {
  const cached = await caches.match(request)
  if (!cached) return null

  if (!isIconFallback(cached)) {
    return cached
  }

  const cachedAt = Number(cached.headers.get(ICON_FALLBACK_CACHED_AT) || '0')
  if (cachedAt > 0 && Date.now() - cachedAt <= ICON_FALLBACK_TTL_MS) {
    return cached
  }

  caches.open(CACHE).then((cache) => cache.delete(request)).catch(() => undefined)
  return null
}

function cacheIconResponse(request, response) {
  if (!response.ok) return
  if (response.type === 'opaque') return

  const contentLength = Number(response.headers.get('Content-Length') || '0')
  if (contentLength > MAX_ICON_CACHE_BYTES) return

  const copy = response.clone()
  const cached = isIconFallback(copy) ? fallbackResponseForCache(copy) : copy
  caches.open(CACHE).then((cache) => cache.put(request, cached)).catch(() => undefined)
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => undefined),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(RUNTIME_CACHE_PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

// 构建产物预热。
//
// APP_SHELL 里没有 /assets/*（文件名带 hash，写死会立刻失效），而 SW 在首次访问时
// 还没接管页面，拦不到当次的 JS/CSS 请求。结果是第一次访问结束后 Cache Storage 里
// 一个构建产物都没有，`/assets/*` 的 cache-first 要到第三次访问才真正生效。
//
// 让页面把自己实际用到的资源清单发过来，不需要构建插件，也不会因为 hash 变化失效。
self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'precache-assets' || !Array.isArray(data.urls)) return

  const urls = data.urls
    .filter((value) => typeof value === 'string')
    .filter((value) => {
      try {
        const url = new URL(value, self.location.origin)
        return url.origin === self.location.origin && url.pathname.startsWith('/assets/')
      } catch {
        return false
      }
    })
    .slice(0, 50)

  if (urls.length === 0) return

  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // 逐个写入而不是 addAll：任何一个失败都不该让整批预热落空。
      await Promise.all(urls.map((url) => cache.match(url).then((hit) => (
        hit ? undefined : cache.add(url).catch(() => undefined)
      ))))
    }).catch(() => undefined),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  const isIconifyAsset =
    url.protocol === 'https:' &&
    url.hostname === 'api.iconify.design' &&
    url.pathname.endsWith('.svg')
  if (isIconifyAsset) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            cacheIconResponse(request, response)
            return response
          }),
      ),
    )
    return
  }

  if (url.origin !== self.location.origin) return

  const isCategoryIconProxy = url.pathname.startsWith('/api/category-icon/')
  if (isCategoryIconProxy) {
    event.respondWith(
      matchCachedIcon(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            cacheIconResponse(request, response)
            return response
          }),
      ),
    )
    return
  }

  if (url.pathname.startsWith('/api/')) return

  // 导航请求绝不从 Cache Storage 直接返回。
  // 入口密码由 Worker 在每次导航请求时验证；如果这里直接命中缓存，
  // 新的浏览器会话可能绕过密码页面。静态 JS/CSS/图片仍然可以正常缓存。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html')),
    )
    return
  }

  const isStatic = url.pathname.startsWith('/assets/') || APP_SHELL.includes(url.pathname)
  if (isStatic) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            cacheResponse(request, response)
            return response
          }),
      ),
    )
  }
})

async function shellChanged(cached, response) {
  try {
    const [before, after] = await Promise.all([cached.clone().text(), response.clone().text()])
    return before !== after
  } catch {
    return false
  }
}

function notifyClients(message) {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const client of clients) client.postMessage(message)
  }).catch(() => undefined)
}
