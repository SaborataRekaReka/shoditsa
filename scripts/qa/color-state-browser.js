/* Run only inside cua_repl. Browser reads and CSS pseudo-state inspection. */
export default async function initializeColorAudit({ tab, cdp, origin = 'http://127.0.0.1:5190', candidate = null, nativeViewport = false }) {
  const fs = await import('node:fs/promises')
  const directory = 'C:/projects/dev/seans_starter_pack/qa/release-theme-acceptance-2026-10-21'
  const definitions = JSON.parse(await fs.readFile(`${directory}/hover-selectors.json`, 'utf8'))
  const scan = await fs.readFile('C:/projects/dev/seans_starter_pack/scripts/qa/dark-theme-contrast.js', 'utf8')
  const hosts = definitions.hosts.map(entry => entry.host).concat(['button', 'a', 'input:not([type=hidden])', 'textarea', 'select', 'summary', '.application-calendar-day', '.study-panel-grip', '.rating-row'])
  const selector = [...new Set(hosts)].join(',')
  const records = []
  const checkedComponents = new Set()
  for (const file of await fs.readdir(directory)) {
    if (!/^colors-(light|dark)-.*\.json$/.test(file)) continue
    const previous = JSON.parse(await fs.readFile(`${directory}/${file}`, 'utf8'))
    if (previous.candidate === candidate) for (const check of previous.checks) checkedComponents.add(`${previous.tone}|${check.key}`)
  }
  async function audit(path, tone, name, prepare) {
    const url = new URL(path, origin); url.searchParams.set('qa', url.searchParams.get('qa') || 'member'); url.searchParams.set('tone', tone)
    await tab.goto(url.href)
    await tab.playwright.locator(name.startsWith('territory-') ? '.territory-room-game' : 'h1').first().waitFor({ state: 'visible', timeoutMs: 7000 })
    await tab.getAXState({ emit: false })
    await new Promise(resolve => setTimeout(resolve, 850))
    if (prepare) { await prepare(tab); await tab.getAXState({ emit: false }) }
    // Native viewport capture also settles the desktop scrollbar after navigation.
    const screenshot = nativeViewport ? await tab.getScreenshot({ emit: false }) : await tab.screenshot({ fullPage: false })
    const width = await tab.playwright.evaluate(() => innerWidth)
    await fs.writeFile(`${directory}/final-${tone}-${width < 600 ? 'mobile' : 'desktop'}-${name}.png`, screenshot)
    await cdp.send('DOM.enable', {}); await cdp.send('CSS.enable', {})
    const document = await cdp.send('DOM.getDocument', { depth: 0 })
    const nodes = await cdp.send('DOM.querySelectorAll', { nodeId: document.root.nodeId, selector })
    const targets = await tab.playwright.evaluate(selector => {
      const seen = new Set()
      const elements = [...document.querySelectorAll(selector)]
      return elements.flatMap((element, index) => {
        const box = element.getBoundingClientRect(), style = getComputedStyle(element)
        if (!box.width || !box.height || style.visibility === 'hidden' || element.matches(':disabled')) return []
        const context = []
        for (let parent = element; parent && parent !== document.body; parent = parent.parentElement) context.push(`${parent.tagName}.${typeof parent.className === 'string' ? parent.className : parent.getAttribute('class')}#${parent.id}`)
        const key = `${context.join('>')}|${element.getAttribute('type')}|${element.getAttribute('aria-selected')}|${element.getAttribute('aria-expanded')}|${style.color}|${style.backgroundColor}|${style.borderColor}`
        if (seen.has(key)) return []
        seen.add(key)
        const properties = style.transitionProperty.split(',').map(value => value.trim())
        const durations = style.transitionDuration.split(',').map(value => Number.parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000))
        const delays = style.transitionDelay.split(',').map(value => Number.parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000))
        const paintTransitionMs = Math.min(350, Math.max(0, ...properties.map((property, i) => /all|color|background|border|shadow|fill|stroke|outline/.test(property) ? durations[i % durations.length] + delays[i % delays.length] : 0)))
        return [{ index, key, ancestors: elements.flatMap((ancestor, i) => ancestor !== element && ancestor.contains(element) ? [i] : []), label: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 80), paintTransitionMs }]
      })
    }, selector)
    const colors = await tab.playwright.evaluate(() => {
      const colors = new Map()
      for (const element of document.querySelectorAll('body *')) {
        const box = element.getBoundingClientRect(), style = getComputedStyle(element)
        if (!box.width || !box.height || style.visibility === 'hidden' || ['SCRIPT', 'STYLE'].includes(element.tagName)) continue
        for (const property of ['color', 'background-color', 'background-image', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'box-shadow', 'fill', 'stroke']) {
          if (property.startsWith('border-') && style.getPropertyValue(property.replace('color', 'width')) === '0px') continue
          const value = style.getPropertyValue(property)
          if (value && !['none', 'rgba(0, 0, 0, 0)'].includes(value)) {
            const key = `${property}: ${value}`
            colors.set(key, (colors.get(key) || 0) + 1)
          }
        }
      }
      return Object.fromEntries(colors)
    })
    const normal = await tab.playwright.evaluate(`(${scan})()`)
    const structure = await tab.playwright.evaluate(() => ({
      newShell: { navigation: !!document.querySelector('[data-study-shell]'), playerHeader: !!document.querySelector('[data-study-header]'), content: !!document.querySelector('.qg-main') },
      legacyVisible: [...document.querySelectorAll('.app-header, .app-footer')].filter(element => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return box.width && box.height && style.visibility !== 'hidden' && style.display !== 'none' }).map(element => element.className),
      images: [...document.querySelectorAll('img')].map(image => ({ src: image.getAttribute('src'), night: image.hasAttribute('data-night-art'), broken: image.complete && image.naturalWidth === 0 })),
    }))
    const checks = []
    const uniqueTargets = targets.filter(target => !checkedComponents.has(`${tone}|${target.key}`))
    // Independent controls may share a pass. Never force both a parent and its
    // descendant: that would create a different hover context from an isolated control.
    const groups = []
    for (const target of uniqueTargets) {
      let group = groups.find(group => group.every(other => !target.ancestors.includes(other.index) && !other.ancestors.includes(target.index)))
      if (!group) groups.push(group = [])
      group.push(target)
    }
    for (const group of groups) {
      for (const state of ['hover', 'active', 'focus-visible']) {
        await Promise.all(group.map(target => cdp.send('CSS.forcePseudoState', { nodeId: nodes.nodeIds[target.index], forcedPseudoClasses: state === 'focus-visible' ? ['focus', 'focus-visible'] : [state] })))
        const transition = Math.max(...group.map(target => target.paintTransitionMs))
        if (transition) await new Promise(resolve => setTimeout(resolve, transition + 30))
        const appearances = await tab.playwright.evaluate(({ selector, indices }) => indices.map(index => {
          const element = document.querySelectorAll(selector)[index], style = getComputedStyle(element)
          const box = element.getBoundingClientRect()
          const input = element.classList.contains('login-password-toggle') ? element.parentElement.querySelector('input')?.getBoundingClientRect() : null
          const icon = input ? element.querySelector('svg')?.getBoundingClientRect() : null
          return { color: style.color, background: style.backgroundColor, border: style.borderColor, shadow: style.boxShadow, outline: style.outlineColor, width: box.width, height: box.height, ...(input && icon ? { iconCenterOffset: icon.y + icon.height / 2 - input.y - input.height / 2 } : {}) }
        }), { selector, indices: group.map(target => target.index) })
        const measure = await tab.playwright.evaluate(`(${scan})()`)
        checks.push(...group.map((target, index) => ({ ...target, state, ...appearances[index], findings: measure.findings.filter(finding => !finding.disabled) })))
      }
      await Promise.all(group.map(target => cdp.send('CSS.forcePseudoState', { nodeId: nodes.nodeIds[target.index], forcedPseudoClasses: [] })))
      for (const target of group) checkedComponents.add(`${tone}|${target.key}`)
    }
    const record = { candidate, name, path, tone, capturedAt: new Date().toISOString(), width: await tab.playwright.evaluate(() => innerWidth), colors, checks, targets: targets.length, reusedChecks: targets.length - uniqueTargets.length, normal, ...structure }
    records.push(record)
    await fs.writeFile(`${directory}/colors-${tone}-${name}.json`, JSON.stringify(record, null, 2))
    return { name, tone, targets: targets.length, checks: checks.length, reused: record.reusedChecks, normalFindings: normal.findings.filter(f => !f.disabled), overflow: normal.scroll - normal.client, findings: checks.filter(check => check.findings.length).map(check => ({ key: check.key, state: check.state, findings: check.findings })) }
  }
  return { audit, records, fs, directory }
}
