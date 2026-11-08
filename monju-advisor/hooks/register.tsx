import type { EngineInterface, Register } from 'claude-code'
import { buildFill, buildPrompt, RULES } from './judge'

// 呼ぶモデル(D-039・D-052)。別名 'opus' は使わず、C-22 で試したモデルのまま固定する
const MODEL = 'claude-opus-5-5'
const EFFORT = 'low'
// 返事の上限(D-053)。考える分も上限に入ると推測(未確認)し、途中で切れて空になるのを避ける
const MAX_TOKENS = 4000
// 待つ長さ(D-051)。C-22 では1回17〜21秒
const TIMEOUT_MS = 60000

// 作っている間か。その間にもう一度押されても無視する(D-049)
let isBusy = false

// 会話と打ちかけを材料に下書きを作り、入力欄の後ろに足す(D-039・D-044・D-045・C-21・C-23)
async function draft($: EngineInterface): Promise<void> {
  if (isBusy) return
  isBusy = true
  try {
    $.ui.toast('monju: 考えています')
    const messages = await $.session.messages()
    const box = await $.prompt.read()
    const r = await $.model.complete({
      model: MODEL,
      effort: EFFORT,
      system: RULES,
      prompt: buildPrompt(messages, box.text),
      maxTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
    })
    // 時間切れ・API エラー・空の返事なら、入力欄は触らない(D-050)
    if (!r.isAnswered || r.text.trim() === '') {
      $.ui.toast(`monju: 下書きを作れませんでした(${r.isAnswered ? '空の返事' : r.reason})`)
      return
    }
    // 待つ間に人が打った文も消さないよう、読み直してから後ろに足す(D-045・C-21)
    const now = await $.prompt.read()
    await $.prompt.fill({ text: buildFill(r.text, now.text), mode: 'append' })
  } catch (err) {
    $.ui.toast(`monju: 下書きを作れませんでした(${err instanceof Error ? err.message : String(err)})`)
  } finally {
    isBusy = false
  }
}

export const register: Register = on => {
  // 入力欄のすぐ上の帯に monju ボタンを置く。押したときだけ下書きを作る(D-038・C-20)
  // 毎ターンの判定・ステータスライン・答える枠・on/off は持たない(D-040・D-046)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box>
        <Button key="monju" label="monju" onPress={() => draft($)} />
      </Box>
    )
  })
}
