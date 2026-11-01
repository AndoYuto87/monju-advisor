import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

let status: string | undefined
let mtimes: Record<string, number> = {} // fs.stat が返す mtime。無いパスは読めない

function engine(on: Parameters<Parameters<typeof test>[1]>[1], store: Record<string, unknown> = {}) {
  status = undefined
  mock.store(on, store)
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
