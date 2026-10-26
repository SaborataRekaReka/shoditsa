import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nodemailer from 'nodemailer'
import { afterAll, describe, expect, it } from 'vitest'
import { loadConfig } from '@shoditsa/config'
import { mailingDkimOptions } from '../src/modules/mailings/content.js'

const root = mkdtempSync(join(tmpdir(), 'shoditsa-dkim-test-'))
const config = { ...loadConfig(), smtp: { host: 'smtp.example.test', from: 'support@shoditsa.ru', port: 465, user: '', password: '' } }
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const path = join(root, 'private.pem')
writeFileSync(path, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
const env = { MAILING_DKIM_PRIVATE_KEY_FILE: path, MAILING_DKIM_SELECTOR: 'site20261023' }
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('mailing domain signatures', () => {
  it('verifies the signature and body hash of the generated wire message, including both unsubscribe headers', async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, dkim: mailingDkimOptions(config, env) })
    const result = await transport.sendMail({
      from: config.smtp.from, to: 'owner@example.test', subject: 'Domain authentication test', text: 'A signed test.\n',
      headers: { 'List-Unsubscribe': '<https://shoditsa.ru/unsubscribe/test>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    })
    const [header, ...bodyParts] = result.message.toString().split('\r\n\r\n')
    const headers = header!.split(/\r\n(?![ \t])/)
    const signature = headers.find(value => /^DKIM-Signature:/i.test(value))!
    const tags = Object.fromEntries(signature.replace(/^DKIM-Signature:\s*/i, '').replace(/\r\n[ \t]+/g, ' ').split(';').map(value => {
      const i = value.indexOf('='); return [value.slice(0, i).trim(), value.slice(i + 1).trim()]
    }))
    expect(tags.d).toBe('shoditsa.ru')
    expect(tags.s).toBe('site20261023')
    expect(tags.c).toBe('relaxed/relaxed')
    expect(tags.h!.split(':')).toEqual(expect.arrayContaining(['from', 'list-unsubscribe', 'list-unsubscribe-post']))
    const relaxedBody = bodyParts.join('\r\n\r\n').replace(/\r?\n/g, '\r\n').replace(/[ \t]+/g, ' ').replace(/ +\r\n/g, '\r\n').replace(/(?:\r\n)*$/, '\r\n')
    expect(tags.bh).toBe(createHash('sha256').update(relaxedBody).digest('base64'))
    const canonical = (value: string) => value.replace(/\r\n/g, '').replace(/[ \t]+/g, ' ').replace(/^([^:]+): */, (_, name: string) => `${name.toLowerCase()}:`).trimEnd()
    const remaining = [...headers]
    const signed = tags.h!.split(':').flatMap(name => {
      let index = remaining.length - 1
      while (index >= 0 && remaining[index]!.slice(0, remaining[index]!.indexOf(':')).toLowerCase() !== name) index--
      return index < 0 ? [] : [canonical(remaining.splice(index, 1)[0]!)]
    })
    signed.push(canonical(signature.replace(/\bb=[\s\S]*$/, 'b=')))
    expect(verify('RSA-SHA256', Buffer.from(signed.join('\r\n')), keys.publicKey, Buffer.from(tags.b!.replace(/\s/g, ''), 'base64'))).toBe(true)
    transport.close()
  })
  it('requires a complete configuration and refuses weak or mismatched signing keys', () => {
    expect(mailingDkimOptions(config, {})).toBeUndefined()
    expect(() => mailingDkimOptions(config, { MAILING_DKIM_SELECTOR: 'site20261023' })).toThrow('MAILING_DKIM_CONFIG_INVALID')
    expect(() => mailingDkimOptions({ ...config, smtp: { ...config.smtp, from: 'other@example.test' } }, env)).toThrow('MAILING_DKIM_CONFIG_INVALID')
    const weakPath = join(root, 'weak.pem')
    writeFileSync(weakPath, generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    expect(() => mailingDkimOptions(config, { ...env, MAILING_DKIM_PRIVATE_KEY_FILE: weakPath })).toThrow('MAILING_DKIM_KEY_INVALID')
  })
})
