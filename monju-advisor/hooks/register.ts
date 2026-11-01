import type { EngineInterface, Register } from 'claude-code'

const COMMAND = 'monju-advisor'

// on / off は次のセッションにも残す。store に値が無ければ on(D-009・今回決めたこと1)
async function isOn($: EngineInterface): Promise<boolean> {
  return (await $.store.get('enabled')) !== false
}

function showStatus($: EngineInterface, on: boolean): void {
  $.ui.status(`${COMMAND}: ${on ? 'on' : 'off'}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: '回答後の助言と答える枠を on / off する',
      argumentHint: 'on|off',
    })
    showStatus($, await isOn($))
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    if (arg !== 'on' && arg !== 'off') {
      const now = (await isOn($)) ? 'on' : 'off'
      return { text: `今は ${now} です。/${COMMAND} on か off で切り替えます` }
    }
    await $.store.set('enabled', arg === 'on')
    showStatus($, arg === 'on')
    return { text: `${COMMAND}: ${arg}` }
  }).catch(() => ({ text: `${COMMAND}: 失敗しました` }))
}
