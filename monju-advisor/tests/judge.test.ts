import { expect, test } from 'claude-code/testing'
import {
  buildFill,
  buildPrompt,
  type Message,
  RECENT_TURNS,
  TOOL_INPUT_LIMIT,
  TOOL_RESULT_LIMIT,
  USER_TEXT_LIMIT,
} from '../hooks/judge'

const user = (text: string): Message => ({ role: 'user', text, toolUses: [] })
const claude = (text: string, toolUses: Message['toolUses'] = []): Message => ({ role: 'assistant', text, toolUses })

// 人と Claude の往復を n 個作る
const turns = (n: number): Message[] => Array.from({ length: n }, (_, i) => [user(`発言${i + 1}`), claude(`回答${i + 1}`)]).flat()

const split = (prompt: string) => {
  const [before, recent] = prompt.split(`# 直近 ${RECENT_TURNS} 往復`)
  return { before, recent }
}

test('直近3往復より前は人の発言だけ、直近は Claude の回答まで', async () => {
  const { before, recent } = split(buildPrompt(turns(5), ''))
  expect(before.includes('[人] 発言1\n[人] 発言2')).toBe(true)
  expect(before.includes('回答')).toBe(false)
  expect(before.includes('発言3')).toBe(false)
  expect(recent.includes('[人] 発言3\n[Claude] 回答3\n[人] 発言4\n[Claude] 回答4\n[人] 発言5\n[Claude] 回答5')).toBe(true)
  expect(recent.includes('発言2')).toBe(false)
})

test('直近より前の人の発言は2000字で切り、直近は Claude も人も全文', async () => {
  const long = 'あ'.repeat(USER_TEXT_LIMIT) + 'い'
  const messages = [user(long), claude('前の回答'), ...turns(2), user('う'.repeat(3000)), claude('え'.repeat(3000))]
  const { before, recent } = split(buildPrompt(messages, ''))
  expect(before.includes(`[人] ${'あ'.repeat(USER_TEXT_LIMIT)}\n`)).toBe(true)
  expect(before.includes('い')).toBe(false)
  expect(recent.includes('う'.repeat(3000))).toBe(true)
  expect(recent.includes('え'.repeat(3000))).toBe(true)
})

test('道具の入力は150字、結果は200字で切る', async () => {
  const input = { command: 'か'.repeat(300) }
  const messages = [user('見て'), claude('読みます', [{ tool: 'Bash', input, text: 'き'.repeat(TOOL_RESULT_LIMIT) + 'ぬ' }])]
  const prompt = buildPrompt(messages, '')
  const json = JSON.stringify(input).slice(0, TOOL_INPUT_LIMIT)
  expect(prompt.includes(`[Claude] 読みます\n[道具] Bash ${json}\n[結果] ${'き'.repeat(TOOL_RESULT_LIMIT)}`)).toBe(true)
  expect(prompt.includes(JSON.stringify(input).slice(0, TOOL_INPUT_LIMIT + 1))).toBe(false)
  expect(prompt.includes('ぬ')).toBe(false)
  // 結果がまだ無い道具は、入力だけ
  const pending = buildPrompt([user('見て'), claude('', [{ tool: 'Read', input: { file_path: '/a.ts' } }])], '')
  expect(pending.includes('[道具] Read {"file_path":"/a.ts"}')).toBe(true)
  expect(pending.includes('[結果]')).toBe(false)
  expect(pending.includes('[Claude]')).toBe(false)
})

test('仕組みが足す発言は捨て、往復にも数えない', async () => {
  const messages = [
    user('発言1'),
    claude('回答1'),
    user('<system-reminder>思い出し</system-reminder>'),
    user('<ide_selection>選んだ所</ide_selection>'),
    user('Base directory for this skill: /x'),
    user('前置き SYSTEM NOTIFICATION 通知'),
    user(''), // 道具の結果だけの発言
    ...turns(3).map(m => ({ ...m, text: m.text.replace(/\d/, n => `${Number(n) + 1}`) })),
  ]
  const { before, recent } = split(buildPrompt(messages, ''))
  expect(before.includes('[人] 発言1')).toBe(true)
  expect(recent.includes('[人] 発言2\n[Claude] 回答2')).toBe(true)
  for (const word of ['思い出し', '選んだ所', 'Base directory', 'SYSTEM NOTIFICATION']) {
    expect(before.includes(word) || recent.includes(word)).toBe(false)
  }
})

test('往復が3つ未満なら全部が直近', async () => {
  const { before, recent } = split(buildPrompt(turns(2), ''))
  expect(before).toBe('# 人の発言(初めから全部)\n\n')
  expect(recent.includes('[人] 発言1\n[Claude] 回答1\n[人] 発言2\n[Claude] 回答2')).toBe(true)
})

test('打ちかけの文があれば最後に足し、無ければ足さない', async () => {
  expect(buildPrompt(turns(1), 'b にしようかな').endsWith('\n\n# 入力欄の打ちかけ\nb にしようかな')).toBe(true)
  expect(buildPrompt(turns(1), '').includes('入力欄の打ちかけ')).toBe(false)
})

test('下書きは trim し、打ちかけがあれば改行してから足す', async () => {
  expect(buildFill('  a にします\n(別視点:…)\n', '')).toBe('a にします\n(別視点:…)')
  expect(buildFill('a にします', 'えっと')).toBe('\na にします')
})
