import { useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, Send } from 'lucide-react'
import { SUPPORT_EMAIL, SUPPORT_TOPICS, type SupportMessageBody } from '@shoditsa/contracts'
import { ApiClientError, sendSupportMessage } from '../../api/client'
import type { AppHeaderProps } from '../../components/app-shell/AppShell'
import { ActionButton, FormField, InlineAlert, SelectControl, TextArea, TextInput } from '../../components/ui'
import { localPresentationLink } from '../../app/local-presentation'
import { CommunityPage } from '../community/CommunityPage'

export function SupportScreen(props: AppHeaderProps) {
  const [email, setEmail] = useState('')
  const [topic, setTopic] = useState<SupportMessageBody['topic']>('problem')
  const [message, setMessage] = useState('')
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const successRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending.current) return
    setError('')
    if (message.trim().length < 10) {
      setError('Расскажите подробнее: сообщение должно содержать хотя бы 10 символов.')
      requestAnimationFrame(() => errorRef.current?.focus())
      return
    }
    sending.current = true
    setPending(true)
    try {
      const result = await sendSupportMessage({ email: email.trim(), topic, message: message.trim(), consent: true, website })
      if (!result?.sent) throw new Error('Unexpected support response')
      setSent(true)
      setMessage('')
      requestAnimationFrame(() => successRef.current?.focus())
    } catch (cause) {
      setError(cause instanceof ApiClientError && cause.code !== 'NETWORK_ERROR' && cause.code !== 'NETWORK_TIMEOUT'
        ? cause.message
        : 'Не удалось подтвердить отправку. Попробуйте позже или напишите нам на email ниже.')
      requestAnimationFrame(() => errorRef.current?.focus())
    } finally {
      sending.current = false
      setPending(false)
    }
  }

  return <CommunityPage {...props} title="Поддержка" intro="Что-то пошло не так или есть идея? Напишите нам — поможем разобраться.">
    {sent ? <div className="support-success" role="status" tabIndex={-1} ref={successRef}>
      <CheckCircle2 size={32} aria-hidden="true" />
      <h2>Сообщение отправлено</h2>
      <p>Спасибо, что написали! Ответ придёт на <strong>{email.trim()}</strong>.</p>
      <ActionButton variant="secondary" onClick={() => { setSent(false); setConsent(false) }}>Написать ещё</ActionButton>
    </div> : <div className="support-layout">
      <form className="support-form" onSubmit={submit} aria-label="Обращение в поддержку" aria-busy={pending}>
        <fieldset disabled={pending}>
          <FormField label="Ваш email" htmlFor="support-email" hint="На этот адрес отправим ответ." required>
            <TextInput variant="soft" surface="dark" id="support-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" />
          </FormField>
          <FormField label="Тема обращения" htmlFor="support-topic" required>
            <SelectControl variant="soft" surface="dark" id="support-topic" name="topic" value={topic} onChange={event => setTopic(event.target.value as SupportMessageBody['topic'])}>
              {Object.entries(SUPPORT_TOPICS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </SelectControl>
          </FormField>
          <FormField label="Сообщение" htmlFor="support-message" hint="Если это ошибка, напишите, в какой игре и что произошло. Можно вставить ссылку." required>
            <TextArea surface="dark" id="support-message" name="message" required minLength={10} maxLength={5000} rows={7} value={message} onChange={event => setMessage(event.target.value)} placeholder="Расскажите, чем мы можем помочь" />
          </FormField>
          <div className="support-form__trap" aria-hidden="true">
            <label htmlFor="support-website">Сайт</label><TextInput id="support-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} />
          </div>
          <label className="support-form__consent">
            <TextInput type="checkbox" name="consent" required checked={consent} onChange={event => setConsent(event.target.checked)} />
            <span>Даю <a href={localPresentationLink('/legal/personal-data-consent')} target="_blank" rel="noreferrer">согласие на обработку персональных данных</a> для ответа на обращение. <a href={localPresentationLink('/legal/privacy')} target="_blank" rel="noreferrer">Политика конфиденциальности</a>.</span>
          </label>
          <div className="support-form__actions"><ActionButton type="submit" disabled={pending || !consent}><Send size={18} aria-hidden="true" />{pending ? 'Отправляем…' : 'Отправить сообщение'}</ActionButton><small>{message.length} / 5000</small></div>
        </fieldset>
        {error && <div ref={errorRef} tabIndex={-1}><InlineAlert tone="danger">{error}</InlineAlert></div>}
      </form>
      <aside className="support-aside">
        <h2>Можно и письмом</h2>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        <p>Ответим по email. Регистрироваться на сайте для обращения не нужно.</p>
        <p>Не присылайте пароли, коды подтверждения и полные данные банковской карты.</p>
      </aside>
    </div>}
  </CommunityPage>
}
