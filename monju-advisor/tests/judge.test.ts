import { expect, test } from 'claude-code/testing'
import {
  ANSWER_LIMIT,
  buildFrames,
  buildPrompt,
  buildStatus,
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
  expect(readAdvice('{"advice": "どのファイルか伝えるとよさそうです", "questions": [{"no": "2", "summary": "使う案"}]}')).toEqual({
    advice: 'どのファイルか伝えるとよさそうです',
    questions: [{ no: '2', summary: '使う案' }],
  })
  // ```json で囲まれていても読む
  expect(readAdvice('```json\n{"advice": "読んだか確かめるよう頼むとよさそうです", "questions": []}\n```')).toEqual({
    advice: '読んだか確かめるよう頼むとよさそうです',
    questions: [],
  })
  // 言うことが無ければ advice は空でよい。questions が無ければ空
  expect(readAdvice('{"advice": ""}')).toEqual({ advice: '', questions: [] })
  expect(readAdvice('{"advice": " ", "questions": [{"no": " 1 ", "summary": " 量 "}]}')).toEqual({
    advice: '',
    questions: [{ no: '1', summary: '量' }],
  })
})

test('問いの no は文字列のときだけ番号にする', async () => {
  expect(readAdvice('{"advice": "", "questions": [{"summary": "A"}, {"no": 2, "summary": "B"}, {"no": null, "summary": "C"}]}')).toEqual({
    advice: '',
    questions: [
      { no: '', summary: 'A' },
      { no: '', summary: 'B' },
      { no: '', summary: 'C' },
    ],
  })
})

test('要約が空・文字列でない問いや、{no, summary} の形でない問いは捨てる', async () => {
  expect(
    readAdvice(
      '{"advice": "", "questions": [{"no": "1", "summary": " "}, {"no": "2", "summary": 3}, {"no": "3"}, "ただの文字列", 1, null, {"no": "4", "summary": "量"}]}',
    ),
  ).toEqual({ advice: '', questions: [{ no: '4', summary: '量' }] })
})

test('ステータスラインの1行:一言があれば monju: <一言>。空なら出さない', async () => {
  expect(buildStatus({ advice: 'どのファイルか伝えるとよさそうです', questions: [] })).toBe('monju: どのファイルか伝えるとよさそうです')
  expect(buildStatus({ advice: '', questions: [] })).toBe(undefined)
})

test('壊れた返事は読まない(= 何も出さない)', async () => {
  expect(readAdvice('')).toBe(undefined)
  expect(readAdvice('advice')).toBe(undefined)
  expect(readAdvice('{"advice": "あ", "questions": [')).toBe(undefined)
  expect(readAdvice('{"questions": []}')).toBe(undefined)
  expect(readAdvice('{"advice": 1}')).toBe(undefined)
  expect(readAdvice('null')).toBe(undefined)
})

test('答える枠:回答の番号のまま並べ、番号が無ければ要約だけ', async () => {
  expect(
    buildFrames(
      [
        { no: '2', summary: '食べたいもの' },
        { no: '4', summary: '量' },
      ],
      '',
    ),
  ).toBe('2. 食べたいもの:\n4. 量:')
  expect(buildFrames([{ no: '', summary: '食べたいもの' }], '')).toBe('食べたいもの:')
  expect(
    buildFrames(
      [
        { no: '1', summary: '食べたいもの' },
        { no: '', summary: '量' },
      ],
      '',
    ),
  ).toBe('1. 食べたいもの:\n量:')
})

test('答える枠:打ちかけの文があれば改行してから足す。問いが無ければ空', async () => {
  expect(buildFrames([{ no: '2', summary: '食べたいもの' }], 'あいう')).toBe('\n2. 食べたいもの:')
  expect(buildFrames([], 'あいう')).toBe('')
})
