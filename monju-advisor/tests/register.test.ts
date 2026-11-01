import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

let status: string | undefined

function engine(on: Parameters<Parameters<typeof test>[1]>[1], store: Record<string, unknown> = {}) {
  status = undefined
  mock.store(on, store)
  on('command.register', () => ({ value: { command: 'monju-advisor' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', (_, e) => ((status = e.text), { value: undefined }))
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
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
