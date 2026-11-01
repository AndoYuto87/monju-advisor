import type { EngineInterface, Register } from 'claude-code'
import { buildFrames, buildPrompt, buildStatus, type Material, readAdvice, RULES } from './judge'

const COMMAND = 'monju-advisor'

// Haiku の返事の長さと、待つ長さ(今回決めたこと4・D-024)
const MAX_TOKENS = 800
const JUDGE_TIMEOUT_MS = 10000

// 見ないターン:バックグラウンドの作業の完了通知(今回決めたこと6)
const NOTIFICATION = '<task-notification>'

// 材料(D-004・D-008)。メインスレッドだけを見る。値はこのセッションの間だけ持ち、読み直しで消える
let text = '' // 今回の発言
let isSkipped = false // このターンを見ないか(今回決めたこと6)
let turns = 0 // 往復の数(K-13)
let isPlan = false // 最後に届いた印で覚えた今のモード(K-14)
let tools: Record<string, number> = {} // このターンのツール名と回数
const edited: Record<string, { count: number; mtimeMs?: number }> = {} // Claude が編集したファイル → セッションでの編集回数と、編集直後の mtime(C-3・C-5)
let previous = '' // 前の回答
let submits = 0 // 送られた発言の数。返事より先に次が送られたかを見る(今回決めたこと7)

// on / off は次のセッションにも残す。store に値が無ければ on(D-009・今回決めたこと1)
async function isOn($: EngineInterface): Promise<boolean> {
  return (await $.store.get('enabled')) !== false
}

// Claude の編集の後に mtime が変わったファイル。覚えた値は今の値に書き換える(D-008・C-5)
async function changedByHand($: EngineInterface): Promise<string[]> {
  const changed: string[] = []
  for (const [path, file] of Object.entries(edited)) {
    if (file.mtimeMs === undefined) continue
    try {
      const now = (await $.fs.stat(path)).mtimeMs
      if (now !== file.mtimeMs) changed.push(path)
      file.mtimeMs = now
    } catch {}
  }
  return changed
}

// 裏で Haiku に聞き、一言と意見をステータスラインに、問いを答える枠にして出す(D-005・D-006・D-007・C-7・D-023)
async function advise($: EngineInterface, material: Material): Promise<void> {
  const sent = submits
  const r = await $.model.complete({
    model: 'haiku',
    system: RULES,
    prompt: buildPrompt(material),
    maxTokens: MAX_TOKENS,
    timeoutMs: JUDGE_TIMEOUT_MS,
  })
  // 間に合わない・読めないときは何も出さない(今回決めたこと4)
  const advice = r.isAnswered ? readAdvice(r.text) : undefined
  if (!advice) return
  // 一言も意見も空なら、前の一言を残す(D-005・D-026)
  const line = buildStatus(advice)
  if (line) $.ui.status(line)
  // 次の発言がもう送られていたら、枠は入れない(今回決めたこと7)
  if (advice.questions.length === 0 || submits !== sent) return
  const box = await $.prompt.read()
  await $.prompt.fill({ text: buildFrames(advice.questions, box.text), mode: 'append' })
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
    submits++
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

  // 回答が終わったら、1ターン1回だけ裏で判定する。回答は待たせない(D-004・C-4・C-7)
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    // 判定が壊れても回答は止めない
    try {
      // 見ないターン:中断・完了通知・コマンド・off(今回決めたこと6・D-009)
      if (!e.isAborted && !isSkipped && (await isOn($))) {
        // 材料はここで固める。返事を待つ間に次のターンが来ても混ざらない
        const material: Material = {
          text,
          answer: e.answer,
          previous,
          turns,
          isPlan,
          tools: { ...tools },
          edited: Object.fromEntries(Object.entries(edited).map(([path, file]) => [path, file.count])),
          changedByHand: await changedByHand($),
        }
        void advise($, material).catch(() => {})
      }
    } catch {}
    if (e.answer !== '') previous = e.answer
    return r
  })
}
