import { expect, test } from 'claude-code/testing'
import {
  ANSWER_LIMIT,
  buildFrames,
  buildPrompt,
  type Material,
  PREVIOUS_LIMIT,
  readAdvice,
  TEXT_LIMIT,
} from '../hooks/judge'

const empty: Material = { text: 'テスト', answer: '', turns: 1, isPlan: false, tools: {}, edited: {}, changedByHand: [] }

test('発言は先頭を、回答と前の回答は末尾を残す', async () => {
  const prompt = buildPrompt({
    ...empty,
    text: 'あ'.repeat(TEXT_LIMIT) + 'い',
    answer: 'う' + 'え'.repeat(ANSWER_LIMIT),
    previous: 'お' + 'か'.repeat(PREVIOUS_LIMIT),
  })
  expect(prompt.includes('い')).toBe(false)
  expect(prompt.includes('う')).toBe(false)
  expect(prompt.includes('お')).toBe(false)
  expect(prompt.includes('あ'.repeat(TEXT_LIMIT))).toBe(true)
  expect(prompt.includes('え'.repeat(ANSWER_LIMIT))).toBe(true)
  expect(prompt.includes('か'.repeat(PREVIOUS_LIMIT))).toBe(true)
})

test('空の材料は入れない', async () => {
  const prompt = buildPrompt({ ...empty, previous: '' })
  expect(prompt.includes('<今回の発言>\nテスト\n</今回の発言>')).toBe(true)
  expect(prompt.includes('<往復の数>1</往復の数>')).toBe(true)
  expect(prompt.includes('<今のモード>通常モード</今のモード>')).toBe(true)
  for (const name of ['前の回答', '今回の回答', 'ツール', '編集したファイル', '手で変わった']) {
    expect(prompt.includes(name)).toBe(false)
  }
})

test('ツール・編集したファイル・手で変わったファイルを並べる', async () => {
  const prompt = buildPrompt({
    ...empty,
    isPlan: true,
    tools: { Edit: 2, Bash: 1 },
    edited: { '/a.ts': 3 },
    changedByHand: ['/a.ts', '/b.ts'],
  })
  expect(prompt.includes('<今のモード>プランモード</今のモード>')).toBe(true)
  expect(prompt.includes('Edit: 2回\nBash: 1回')).toBe(true)
  expect(prompt.includes('/a.ts: 3回')).toBe(true)
  expect(prompt.includes('/a.ts\n/b.ts')).toBe(true)
})

test('返事の JSON から助言を読む', async () => {
  expect(readAdvice('{"comment": "どのファイルか書くと伝わりそうです", "questions": ["どの案にする?"]}')).toEqual({
    comment: 'どのファイルか書くと伝わりそうです',
    questions: ['どの案にする?'],
  })
  // ```json で囲まれていても読む
  expect(readAdvice('```json\n{"comment": "いい頼み方ですね", "questions": []}\n```')).toEqual({
    comment: 'いい頼み方ですね',
    questions: [],
  })
  // ずれが無ければ comment は空でよい。questions が無ければ空、文字列でない・空の問いは捨てる
  expect(readAdvice('{"comment": ""}')).toEqual({ comment: '', questions: [] })
  expect(readAdvice('{"comment": " ", "questions": ["A?", 1, " ", " B? "]}')).toEqual({
    comment: '',
    questions: ['A?', 'B?'],
  })
})

test('壊れた返事は読まない(= 何も出さない)', async () => {
  expect(readAdvice('')).toBe(undefined)
  expect(readAdvice('comment')).toBe(undefined)
  expect(readAdvice('{"comment": "あ", "questions": [')).toBe(undefined)
  expect(readAdvice('{"questions": []}')).toBe(undefined)
  expect(readAdvice('{"comment": 1}')).toBe(undefined)
  expect(readAdvice('null')).toBe(undefined)
})

test('答える枠:問いの数だけ並べ、打ちかけの文があれば改行してから足す', async () => {
  expect(buildFrames(['何が食べたい?', 'がっつり派?軽め派?'], '')).toBe('1. 何が食べたい?:\n2. がっつり派?軽め派?:')
  expect(buildFrames(['何が食べたい?'], 'あいう')).toBe('\n1. 何が食べたい?:')
  expect(buildFrames([], 'あいう')).toBe('')
})
