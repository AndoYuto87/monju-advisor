import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { RULES } from '../hooks/judge'

const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const REPLY = 'b にします(別視点:a は手間が増えます)'
const SURFACES = ['vscode', 'terminal'] as const

type Call = { model?: string; effort?: unknown; system?: string; prompt: string; maxTokens?: number; timeoutMs?: number }

let calls: Call[] = [] // モデルに頼んだ中身
let filled: { text: string; mode?: string }[] = []
let toasts: string[] = []
let reply: string | undefined // undefined なら返事が無い(aborted)
let drafts: string[] = [] // prompt.read が順に返す入力欄。最後の値を返し続ける
let delayMs = 0 // 返事が来るまで

function engine(on: Parameters<Parameters<typeof test>[1]>[1]) {
  calls = []
  filled = []
  toasts = []
  reply = REPLY
  drafts = ['']
  delayMs = 0
  const clock = mock.clock(on, { now: 0 })
  on('model.complete', async (_, e) => {
    calls.push({ model: e.model, effort: e.effort, system: e.system, prompt: e.prompt, maxTokens: e.maxTokens, timeoutMs: e.timeoutMs })
    if (delayMs > 0) await clock.sleep(delayMs)
    return {
      value: reply === undefined
        ? { isAnswered: false, reason: 'aborted', usage }
        : { isAnswered: true, text: reply, usage },
    }
  })
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'a と b どちらにしますか、と聞かれた', toolUses: [] },
      { role: 'assistant', text: 'a を推奨します。どうしますか?', toolUses: [] },
    ],
  }))
  on('prompt.read', () => {
    const text = drafts.length > 1 ? drafts.shift()! : drafts[0]!
    return { value: { text, cursor: text.length } }
  })
  on('prompt.fill', (_, e) => (filled.push({ text: e.text, mode: e.mode }), { isFilled: true }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  // エンジン自身の帯(アンケート)の代わり。mod が next に渡したときだけ届く
  on('ui.render', () => ({ type: 'Text', children: ['アンケート'] }) as never)
  return clock
}

function band($: Engine, surface: (typeof SURFACES)[number], hasSurvey = false) {
  return $.ui.mount({
    plugin: 'monju-advisor',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey, isWorking: false } as never,
  })
}

for (const surface of SURFACES) {
  test(`${surface}:押すと、Opus 5.5・low・4000・60秒で1回呼び、人の発言と打ちかけを渡す`, async ($, on) => {
    engine(on)
    drafts = ['c はどう?']
    const ui = await band($, surface)
    await ui.press({ key: 'monju' })
    expect(calls.length).toBe(1)
    const c = calls[0]!
    expect(c.model).toBe('claude-opus-5-5')
    expect(c.effort).toBe('low')
    expect(c.maxTokens).toBe(4000)
    expect(c.timeoutMs).toBe(60000)
    expect(c.system).toBe(RULES)
    expect(c.prompt.includes('[人] a と b どちらにしますか、と聞かれた')).toBe(true)
    expect(c.prompt.includes('[Claude] a を推奨します。どうしますか?')).toBe(true)
    expect(c.prompt.includes('# 入力欄の打ちかけ\nc はどう?')).toBe(true)
    expect(toasts[0]).toBe('monju: 考えています')
    await ui.unmount()
  })

  test(`${surface}:返事を入力欄の後ろに足す。打ちかけがあれば改行してから`, async ($, on) => {
    engine(on)
    const ui = await band($, surface)
    await ui.press({ key: 'monju' })
    expect(filled).toEqual([{ text: REPLY, mode: 'append' }])
    // 待つ間に人が打った文も、読み直して改行してから足す
    drafts = ['', 'あいう']
    reply = `  ${REPLY}\n`
    await ui.press({ key: 'monju' })
    expect(filled[1]).toEqual({ text: `\n${REPLY}`, mode: 'append' })
    await ui.unmount()
  })

  test(`${surface}:返事が無い・空なら、入力欄は触らず、失敗の toast を出す`, async ($, on) => {
    engine(on)
    const ui = await band($, surface)
    reply = undefined
    await ui.press({ key: 'monju' })
    reply = '  '
    await ui.press({ key: 'monju' })
    expect(filled).toEqual([])
    expect(toasts).toEqual([
      'monju: 考えています',
      'monju: 下書きを作れませんでした(aborted)',
      'monju: 考えています',
      'monju: 下書きを作れませんでした(空の返事)',
    ])
    await ui.unmount()
  })

  test(`${surface}:作っている間にもう一度押しても、呼ぶのは1回。済んだらまた押せる`, async ($, on) => {
    const clock = engine(on)
    delayMs = 3000
    const ui = await band($, surface)
    const first = ui.press({ key: 'monju' })
    await clock.settle()
    await ui.press({ key: 'monju' })
    expect(calls.length).toBe(1)
    await clock.advance(3000)
    await first
    expect(filled.length).toBe(1)
    delayMs = 0
    await ui.press({ key: 'monju' })
    expect(calls.length).toBe(2)
    await ui.unmount()
  })

  test(`${surface}:アンケートが帯にあるときは、ボタンを出さない`, async ($, on) => {
    engine(on)
    const ui = await band($, surface, true)
    expect(await ui.find({ key: 'monju' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /アンケート/ })).toBeDefined()
    await ui.unmount()
  })
}

test('押さなければ、発言・回答があってもモデルを呼ばない', async ($, on) => {
  const clock = engine(on)
  await $.prompt.submit({ text: '直して', wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.complete({ turnId: 't', answer: '直しました', durationMs: 0, isAborted: false, reason: 'answer' } as never)
  await clock.settle()
  expect(calls.length).toBe(0)
  expect(filled).toEqual([])
})
