import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const ADVICE = '{"comment": "どのファイルか書くと伝わりそうです", "questions": []}'

let status: string | undefined
let asked: string[] = [] // Haiku に渡した本文
let maxTokens: (number | undefined)[] = [] // Haiku に頼んだ返事の長さ
let filled: { text: string; mode?: string }[] = []
let reply: string | undefined // undefined なら Haiku が間に合わない
let draft = '' // 入力欄の打ちかけ
let delayMs = 0 // Haiku の返事が来るまで
let mtimes: Record<string, number> = {} // fs.stat が返す mtime。無いパスは読めない

function engine(on: Parameters<Parameters<typeof test>[1]>[1], store: Record<string, unknown> = {}) {
  status = undefined
  asked = []
  maxTokens = []
  filled = []
  reply = ADVICE
  draft = ''
  delayMs = 0
  mock.store(on, store)
  const clock = mock.clock(on, { now: 0 })
  on('model.complete', async (_, e) => {
    asked.push(e.prompt)
    maxTokens.push(e.maxTokens)
    if (delayMs > 0) await clock.sleep(delayMs)
    return {
      value: reply === undefined
        ? { isAnswered: false, reason: 'aborted', usage }
        : { isAnswered: true, text: reply, usage },
    }
  })
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', (_, e) => (filled.push({ text: e.text, mode: e.mode }), { isFilled: true }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', () => ({ value: { command: 'monju-advisor' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', (_, e) => ((status = e.text), { value: undefined }))
  mtimes = {}
  on('fs.stat', (_, e) => {
    if (mtimes[e.path] === undefined) throw new Error('no such file')
    return { value: { kind: 'file', size: 0, mtimeMs: mtimes[e.path], isLink: false } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.attachment', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ isError: false, result: 'ok', text: 'ok' }))
  return clock
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
}

function submit($: Engine, text: string, extra: Record<string, unknown> = {}) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...extra } as never)
}

function begin($: Engine, text: string, agentId?: string) {
  return $.turn.start({ text, turnId: 't', agentId } as never)
}

function tool($: Engine, name: string, extra: Record<string, unknown> = {}) {
  return $.tool.call({ tool: name, ...extra } as never)
}

function attach($: Engine, type: string, agentId?: string) {
  return $.prompt.attachment({ type, text: '', origin: { kind: 'engine' }, agentId } as never)
}

function complete($: Engine, answer: string, opts: { aborted?: boolean; agentId?: string } = {}) {
  return $.turn.complete({ turnId: 't', answer, durationMs: 0, isAborted: opts.aborted ?? false, reason: opts.aborted ? 'aborted' : 'answer', agentId: opts.agentId } as never)
}

// 1ターン:発言 → 始まり → 終わり。裏の判定が済むまで待つ
async function turn($: Engine, clock: { settle: () => Promise<void> }, text: string, answer: string, opts: { aborted?: boolean; extra?: Record<string, unknown> } = {}) {
  await submit($, text, opts.extra)
  await begin($, text)
  await complete($, answer, opts)
  await clock.settle()
}

async function run($: Engine, args: string): Promise<string> {
  const r = await $.command.run({ command: 'monju-advisor', args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } } as never)
  return (r as { text: string }).text
}

test('入れた直後は on', async ($, on) => {
  engine(on)
  await start($)
  expect(status).toBe('monju-advisor: on')
})

test('off にすると、次のセッションでも off。on で戻す', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'off')).toBe('monju-advisor: off')
  expect(status).toBe('monju-advisor: off')
  // 同じ store のまま、もう一度セッションを始める
  await start($)
  expect(status).toBe('monju-advisor: off')
  expect(await run($, 'on')).toBe('monju-advisor: on')
  await start($)
  expect(status).toBe('monju-advisor: on')
})

test('引数なし・知らない引数では、今の状態を返す', async ($, on) => {
  engine(on, { enabled: false })
  await start($)
  expect((await run($, '')).includes('今は off')).toBe(true)
  expect((await run($, 'report')).includes('今は off')).toBe(true)
  expect(status).toBe('monju-advisor: off')
})

// 覚えた材料が正しいかは、Haiku に渡す本文で確かめる(ステップ5)。ここでは止めずに通すことだけ見る
test('発言はそのまま通す。コマンド・メタ・通知も同じ', async ($, on) => {
  engine(on)
  await start($)
  expect(await submit($, '直して')).toEqual({ text: '直して' })
  expect(await submit($, '/x', { command: { name: 'monju-advisor' } })).toEqual({ text: '/x' })
  expect(await submit($, 'meta', { isMeta: true })).toEqual({ text: 'meta' })
  expect(await submit($, '<task-notification>done</task-notification>')).toEqual({ text: '<task-notification>done</task-notification>' })
})

test('ツール・ターンの始まり・添付は、メインもサブエージェントもそのまま通す', async ($, on) => {
  engine(on)
  await start($)
  mtimes['/x/a.ts'] = 100
  for (const agentId of [undefined, 'sub']) {
    expect(await begin($, '直して', agentId)).toEqual({ turnId: 't' })
    expect((await tool($, 'Bash', { agentId })).text).toBe('ok')
    expect((await tool($, 'Edit', { file_path: '/x/a.ts', old_string: 'a', new_string: 'b', agentId })).text).toBe('ok')
    expect(await attach($, 'plan_mode', agentId)).toEqual({ text: '' })
  }
})

test('mtime が読めなくても、編集のツールは止めない', async ($, on) => {
  engine(on)
  await start($)
  expect((await tool($, 'Write', { file_path: '/x/gone.ts', content: 'c' })).text).toBe('ok')
})

test('回答が終わると、覚えた材料を Haiku に渡し、一言をステータスラインに出す', async ($, on) => {
  const clock = engine(on)
  await start($)
  mtimes['/x/a.ts'] = 100
  await submit($, '直して')
  await attach($, 'plan_mode')
  await begin($, '直して')
  await tool($, 'Edit', { file_path: '/x/a.ts', old_string: 'a', new_string: 'b' })
  await tool($, 'Bash')
  // サブエージェントの分は入らない
  await tool($, 'Grep', { agentId: 'sub' })
  await tool($, 'Edit', { file_path: '/x/sub.ts', old_string: 'a', new_string: 'b', agentId: 'sub' })
  await complete($, '直しました')
  await clock.settle()
  expect(asked.length).toBe(1)
  const prompt = asked[0]
  expect(prompt.includes('<今回の発言>\n直して\n</今回の発言>')).toBe(true)
  expect(prompt.includes('<今回の回答の末尾>\n直しました\n</今回の回答の末尾>')).toBe(true)
  expect(prompt.includes('<往復の数>1</往復の数>')).toBe(true)
  expect(prompt.includes('<今のモード>プランモード</今のモード>')).toBe(true)
  expect(prompt.includes('Edit: 1回\nBash: 1回')).toBe(true)
  expect(prompt.includes('/x/a.ts: 1回')).toBe(true)
  expect(prompt.includes('Grep')).toBe(false)
  expect(prompt.includes('/x/sub.ts')).toBe(false)
  expect(prompt.includes('前の回答')).toBe(false)
  expect(prompt.includes('手で変わった')).toBe(false)
  expect(status).toBe('monju: どのファイルか書くと伝わりそうです')
  expect(maxTokens).toEqual([800])
})

test('次のターンには、前の回答・往復の数・手で変わったファイルが入り、ツールの回数は空に戻る', async ($, on) => {
  const clock = engine(on)
  await start($)
  mtimes['/x/a.ts'] = 100
  await submit($, '直して')
  await begin($, '直して')
  await tool($, 'Edit', { file_path: '/x/a.ts', old_string: 'a', new_string: 'b' })
  await complete($, '直しました')
  await clock.settle()
  // 人が手で直した
  mtimes['/x/a.ts'] = 200
  await turn($, clock, 'もう一度', 'はい')
  const prompt = asked[1]
  expect(prompt.includes('<前の回答の末尾>\n直しました\n</前の回答の末尾>')).toBe(true)
  expect(prompt.includes('<往復の数>2</往復の数>')).toBe(true)
  expect(prompt.includes('<今のモード>通常モード</今のモード>')).toBe(true)
  expect(prompt.includes('このターンのツール')).toBe(false)
  expect(prompt.includes('/x/a.ts: 1回')).toBe(true)
  expect(prompt.includes('<Claude の編集の後に手で変わったファイル>\n/x/a.ts\n')).toBe(true)
  // 同じ変化は、次のターンでは挙げない
  await turn($, clock, '次', 'はい')
  expect(asked[2].includes('手で変わった')).toBe(false)
})

test('ずれの一言と意見を1行で出す。ずれが無くても意見は出す', async ($, on) => {
  const clock = engine(on)
  await start($)
  reply = '{"comment": "答えきれていないかも", "opinion": "案Bの方が単純です", "questions": []}'
  await turn($, clock, '直して', 'はい')
  expect(status).toBe('monju: 答えきれていないかも / 案Bの方が単純です')
  reply = '{"comment": "", "opinion": "先に原因を絞ると早そうです", "questions": []}'
  await turn($, clock, '次', 'はい')
  expect(status).toBe('monju: 先に原因を絞ると早そうです')
})

test('一言も意見も空なら、前の一言を残す', async ($, on) => {
  const clock = engine(on)
  await start($)
  await turn($, clock, '直して', 'はい')
  reply = '{"comment": "", "opinion": "", "questions": []}'
  await turn($, clock, '次', 'はい')
  expect(asked.length).toBe(2)
  expect(status).toBe('monju: どのファイルか書くと伝わりそうです')
})

test('問いがあれば、入力欄に答える枠を足す。打ちかけの文は残す', async ($, on) => {
  const clock = engine(on)
  await start($)
  reply = '{"comment": "", "questions": ["何が食べたい?", "がっつり派?軽め派?"]}'
  await turn($, clock, '相談', 'どうしますか?')
  expect(filled).toEqual([{ text: '1. 何が食べたい?:\n2. がっつり派?軽め派?:', mode: 'append' }])
  draft = 'あいう'
  await turn($, clock, '相談', 'どうしますか?')
  expect(filled[1]).toEqual({ text: '\n1. 何が食べたい?:\n2. がっつり派?軽め派?:', mode: 'append' })
})

test('返事より先に次の発言が送られていたら、一言は出すが、枠は入れない', async ($, on) => {
  const clock = engine(on)
  await start($)
  reply = '{"comment": "答えきれていないかも", "questions": ["どれにする?"]}'
  delayMs = 3000
  await submit($, '相談')
  await begin($, '相談')
  await complete($, 'どれにしますか?')
  await clock.settle()
  await submit($, 'A で')
  await clock.advance(3000)
  expect(status).toBe('monju: 答えきれていないかも')
  expect(filled).toEqual([])
})

test('Haiku が間に合わない・返事が読めないときは、何も出さない', async ($, on) => {
  const clock = engine(on)
  await start($)
  for (const r of [undefined, 'comment', '{"questions": ["どれ?"]}']) {
    reply = r
    await turn($, clock, '直して', 'はい')
  }
  expect(asked.length).toBe(3)
  expect(status).toBe('monju-advisor: on')
  expect(filled).toEqual([])
})

test('見ないターン:中断・完了通知・コマンド・メタ・サブエージェント・off では Haiku を呼ばない', async ($, on) => {
  const clock = engine(on)
  await start($)
  await turn($, clock, '直して', '', { aborted: true })
  await turn($, clock, '<task-notification>done</task-notification>', 'はい')
  await submit($, '直して')
  await begin($, '<task-notification>done</task-notification>')
  await complete($, 'はい')
  await turn($, clock, '/x', 'はい', { extra: { command: { name: 'x' } } })
  await turn($, clock, 'meta', 'はい', { extra: { isMeta: true } })
  await submit($, '直して')
  await begin($, '直して')
  await complete($, '調べました', { agentId: 'sub' })
  await clock.settle()
  expect(asked.length).toBe(0)
  await run($, 'off')
  await turn($, clock, '直して', 'はい')
  expect(asked.length).toBe(0)
  // on に戻すと、また見る
  await run($, 'on')
  await turn($, clock, '直して', 'はい')
  expect(asked.length).toBe(1)
})
