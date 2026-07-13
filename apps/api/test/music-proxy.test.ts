import { createServer } from 'node:http'
import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createMusicProxyTransport, normalizeMusicProxyUrl } from '../src/modules/admin/music-proxy.js'

const closers: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())) })

describe('music proxy URL', () => {
  it('accepts authenticated HTTP and HTTPS proxies', () => {
    expect(normalizeMusicProxyUrl('http://user:password@proxy.example:3128')).toBe('http://user:password@proxy.example:3128/')
    expect(normalizeMusicProxyUrl('https://proxy.example')).toBe('https://proxy.example/')
  })

  it('rejects unsupported or invalid proxy values', () => {
    expect(() => normalizeMusicProxyUrl('socks5://proxy.example:1080')).toThrow(/http/)
    expect(() => normalizeMusicProxyUrl('not a URL')).toThrow(/invalid/)
  })

  it('sends requests through an HTTP CONNECT proxy', async () => {
    let tunnels = 0
    const target = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ via: 'proxy' }))
    })
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    closers.push(() => new Promise((resolve, reject) => target.close((error) => error ? reject(error) : resolve())))

    const proxy = createServer()
    proxy.on('connect', (request, clientSocket, head) => {
      tunnels += 1
      const [host, rawPort] = String(request.url).split(':')
      const upstream = connect(Number(rawPort), host, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        upstream.pipe(clientSocket)
        clientSocket.pipe(upstream)
      })
      upstream.on('error', () => clientSocket.destroy())
    })
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    closers.push(() => new Promise((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve())))

    const targetAddress = target.address()
    const proxyAddress = proxy.address()
    if (!targetAddress || typeof targetAddress === 'string' || !proxyAddress || typeof proxyAddress === 'string') throw new Error('Test servers did not bind')
    const transport = createMusicProxyTransport(`http://127.0.0.1:${proxyAddress.port}`)
    if (!transport) throw new Error('Proxy transport was not created')
    const response = await transport.fetchImpl(`http://127.0.0.1:${targetAddress.port}/health`)
    expect(await response.json()).toEqual({ via: 'proxy' })
    expect(tunnels).toBe(1)
    await transport.close()
  })
})
