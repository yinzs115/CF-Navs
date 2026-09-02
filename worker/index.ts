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
app
