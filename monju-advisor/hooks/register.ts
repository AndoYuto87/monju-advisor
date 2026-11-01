import type { EngineInterface, Register } from 'claude-code'

const COMMAND = 'monju-advisor'

// 見ないターン:バックグラウンドの作業の完了通知(今回決めたこと6)
const NOTIFICATION = '<task-notification>'

// 材料(D-004・D-008)。メインスレッドだけを見る。値はこのセッションの間だけ持ち、読み直しで消える
let text = '' // 今回の発言
let isSkipped = false // このターンを見ないか(今回決めたこと6)
let turns = 0 // 往復の数(K-13)
let isPlan = false // 最後に届いた印で覚えた今のモード(K-14)
let tools: Record<string, number> = {} // このターンのツール名と回数
const edited: Record<string, { count: number; mtimeMs?: number }> = {} // Claude が編集したファイル → セッションでの編集回数と、編集直後の mtime(C-3・C-5)

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

  // 今回の発言を覚えるだけで、送信は遅らせない(D-004)。コマンド・メタ・通知のターンは見ない(今回決めたこと6)
  on('prompt.submit', async ($, e, next) => {
    text = e.text
    isSkipped = Boolean(e.command || e.isMeta) || e.text.trim().startsWith(NOTIFICATION)
    return next(e)
  }).catch(($, e, next) => next(e)) // 覚え損ねても発言は止めない

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      if (e.text.trim().startsWith(NOTIFICATION)) isSkipped = true
      turns++
      tools = {}
    }
    return next(e)
  })

  // モードの印は発言の後に届く(oni-coach と同じ)
  on('prompt.attachment', async ($, e, next) => {
    if (e.agentId === undefined) {
      if (e.type === 'plan_mode' || e.type === 'plan_mode_reentry') isPlan = true
      if (e.type === 'plan_mode_exit') isPlan = false
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // 覚え損ねても添付は止めない

  // ツールの回数と、Edit・Write で編集したファイルと直後の mtime(D-008・C-3・C-5)
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      tools[e.tool] = (tools[e.tool] ?? 0) + 1
      if (e.tool === 'Edit' || e.tool === 'Write') {
        const path = e.file_path
        const file = (edited[path] ??= { count: 0 })
        file.count++
        try {
          file.mtimeMs = (await $.fs.stat(path)).mtimeMs
        } catch {}
      }
    }
    return r
  }).catch(($, e, next) => next(e)) // 覚え損ねてもツールは止めない
}
