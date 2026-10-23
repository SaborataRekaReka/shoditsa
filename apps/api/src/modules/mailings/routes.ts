import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AppConfig } from '@shoditsa/config'
import type { Database } from '@shoditsa/database'
import type { Auth } from '../auth/auth.js'
import { requireAdmin } from '../auth/session.js'
import { ApiError } from '../../lib/errors.js'
import { loadMailingContent } from './content.js'
import { findUnsubscribeRecipient, mailingOverview, queueMailing, suppressMailingAddress } from './service.js'

const BASE = '/api/v1/admin/mailings'
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
export const mailingPage = (title: string, body: string) => `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(title)} — Сходится!</title><style>body{margin:0;background:#fdfcfd;color:#211f26;font:17px/1.55 system-ui,sans-serif}main{max-width:780px;margin:40px auto;padding:0 24px}a{color:#6550b9}h1{font-size:32px;line-height:1.2}h2{font-size:23px}section{border-top:1px solid #e3dfe6;margin-top:28px;padding-top:20px}button{font:inherit;background:#211f26;color:white;border:0;border-radius:12px;padding:12px 20px;cursor:pointer}button:disabled{opacity:.5;cursor:default}textarea{display:block;box-sizing:border-box;width:100%;min-height:90px;font:inherit;padding:12px;border:1px solid #bbb;border-radius:8px;margin:10px 0}form{margin:16px 0}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #e3dfe6;padding:10px}pre{white-space:pre-wrap;font:inherit;font-size:15px}small{color:#625d66}img{max-width:100%}</style><main><a href="/">Сходится!</a>${body}</main></html>`
const sendPage = (reply: FastifyReply, title: string, body: string) => reply.type('text/html; charset=utf-8').send(mailingPage(title, body))
const statuses: Record<string, string> = { draft: 'Черновик', sending: 'Идёт отправка', paused: 'На паузе', completed: 'Завершена', queued: 'В очереди', accepted: 'Принято SMTP', sending_recipient: 'Передаётся SMTP', failed: 'Отклонено', unknown: 'Результат неизвестен', suppressed: 'Исключено' }

export function registerMailingRoutes(app: FastifyInstance, deps: { db: Database; config: AppConfig; auth: Auth }) {
  const { db, config, auth } = deps
  app.register(async scoped => {
    scoped.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 4096 }, (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))))
    })
    scoped.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer') })
    const admin = (request: FastifyRequest) => requireAdmin(request, auth, db, config)
    scoped.get(BASE, async request => { await admin(request); return mailingOverview(db) })
    scoped.get(`${BASE}/console`, async (request, reply) => {
      await admin(request)
      const [overview, content] = await Promise.all([mailingOverview(db), loadMailingContent()])
      const status = String(overview.campaign?.status ?? 'draft')
      const rows = overview.counts.map(r => `<tr><td>${r.kind === 'test' ? 'Тест' : 'Выпуск'}</td><td>${escape(r.status === 'sending' ? statuses.sending_recipient : statuses[String(r.status)] ?? r.status)}</td><td>${Number(r.count)}</td></tr>`).join('')
      return sendPage(reply, 'Рассылка', `<p><a href="/admin">Админка</a></p><h1>Осеннее письмо</h1><p>${escape(content.subject)}</p><p><strong>${escape(statuses[status])}</strong>. Подходящих адресов сейчас: ${overview.eligible}.</p><p><small>SMTP подтверждает приём письма. Доставку во входящие этот счётчик не подтверждает. Адреса получателей не показываются.</small></p>
        <p><a href="${BASE}/console">Обновить статус</a></p><table><thead><tr><th>Тип</th><th>Состояние</th><th>Писем</th></tr></thead><tbody>${rows || '<tr><td colspan="3">Отправок ещё нет</td></tr>'}</tbody></table>
        ${overview.campaign?.last_error ? `<p>Код остановки: ${escape(overview.campaign.last_error)}</p>` : ''}
        <section><h2>Проверить письмо</h2><p>Один тест на email вашего аккаунта администратора. Он не запускает рассылку по базе.</p><form method="post" action="${BASE}/actions/test"><button>Отправить тест себе</button></form></section>
        <section><h2>Отправка по базе</h2><p>Выпуск отправляется каждому адресу один раз, по одному письму каждые 10 секунд. При первом запуске фиксируется список зарегистрированных пользователей с email. Анонимные, заблокированные и отписавшиеся исключаются.</p><form method="post" action="${BASE}/actions/start"><label>Источник согласий пользователей на новости<textarea name="consentSource" maxlength="1000" required>${escape(overview.campaign?.consent_source)}</textarea></label><button${status === 'completed' || status === 'sending' ? ' disabled' : ''}>${status === 'paused' ? 'Продолжить оставшуюся очередь' : 'Запустить рассылку'}</button></form><form method="post" action="${BASE}/actions/pause"><button${status !== 'sending' ? ' disabled' : ''}>Поставить на паузу</button></form><small>Пауза действует на очередь. Уже передаваемое SMTP письмо может быть принято. Письма с неизвестным результатом автоматически не повторяются.</small></section>
        <section><h2>Содержание выпуска</h2><p><a href="${BASE}/preview" target="_blank" rel="noopener">Открыть HTML письма</a></p><pre>${escape(content.text.replace('{{unsubscribeUrl}}', '(личная ссылка получателя)'))}</pre></section>`)
    })
    scoped.get(`${BASE}/preview`, async (request, reply) => {
      await admin(request)
      const content = await loadMailingContent()
      let html = content.html.replaceAll('{{unsubscribeUrl}}', '#unsubscribe-preview')
      for (const asset of content.attachments) html = html.replaceAll(`cid:${asset.cid}`, `data:${asset.contentType};base64,${asset.content.toString('base64')}`)
      return reply.header('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'").type('text/html; charset=utf-8').send(html)
    })
    scoped.post<{ Params: { action: string }; Body: { consentSource?: string } }>(`${BASE}/actions/:action`, { bodyLimit: 4096, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
      const actor = await admin(request)
      const origin = request.headers.origin
      if (!origin || !config.trustedOrigins.includes(origin)) throw new ApiError(403, 'ORIGIN_REQUIRED', 'Действие доступно только с сайта')
      const action = request.params.action
      if (action !== 'start' && action !== 'test' && action !== 'pause') throw new ApiError(404, 'MAILING_ACTION_UNKNOWN', 'Действие не найдено')
      await queueMailing(db, config, actor, action, String(request.body?.consentSource ?? ''))
      return reply.redirect(`${BASE}/console`, 303)
    })
    const unsubscribePath = '/api/v1/mailings/unsubscribe/:id/:token'
    scoped.get<{ Params: { id: string; token: string } }>(unsubscribePath, { logLevel: 'silent' }, async (request, reply) => {
      const addressHash = await findUnsubscribeRecipient(db, config, request.params.id, request.params.token)
      if (!addressHash) return sendPage(reply.code(400), 'Ссылка недействительна', '<h1>Ссылка недействительна</h1><p>Чтобы отписаться, ответьте на письмо «Отписаться».</p>')
      // GET is deliberately read-only: mail security scanners follow links.
      return sendPage(reply, 'Отписаться от новостей', `<h1>Отписаться от новостей?</h1><p>После подтверждения мы больше не будем отправлять новости «Сходится!» на этот адрес.</p><form method="post"><button>Отписаться</button></form>`)
    })
    scoped.post<{ Params: { id: string; token: string } }>(unsubscribePath, { logLevel: 'silent', bodyLimit: 1024 }, async (request, reply) => {
      const addressHash = await findUnsubscribeRecipient(db, config, request.params.id, request.params.token)
      if (!addressHash) return sendPage(reply.code(400), 'Ссылка недействительна', '<h1>Ссылка недействительна</h1><p>Чтобы отписаться, ответьте на письмо «Отписаться».</p>')
      await suppressMailingAddress(db, addressHash)
      return sendPage(reply, 'Вы отписались', '<h1>Вы отписались от новостей</h1><p>Больше не будем отправлять новости на этот адрес.</p><p><a href="/">Вернуться на сайт</a></p>')
    })
  })
}
