// 判定の部品。フックからは呼ばれるだけで、$ には触らない

// Haiku に渡す長さ(文字数。今回決めたこと3)
export const TEXT_LIMIT = 1000 // 今回の発言の先頭
export const ANSWER_LIMIT = 800 // 今回の回答の末尾
export const PREVIOUS_LIMIT = 400 // 前の回答の末尾

// 判定の基準(D-003・D-006・D-010・D-011・C-6)。Haiku の system に渡す
export const RULES = `あなたは、人とコーディング支援の AI(Claude)のやり取りを横から見る第三者です。人の補助として、ずれに気づいたら一言だけ助言します。

見る観点:
K-1 Claude の問いに人が答えきれていない / K-2 どれを指すか分からない答え / K-3 書かれていない前提 / K-4 方針を変えたのに前の方針での変更が残っている / K-5 人が手で変えたことを Claude が知らない / K-6 Claude が推測のまま進めた / K-7 Claude が解釈を示さずに曖昧な依頼を進めた / K-8 頼まれていない範囲まで変えた / K-9 人の質問を指示と受け取って変更した / K-10 Claude が黙って手段を変えた / K-11 人の否定が続く / K-12 同じ所の直しを繰り返している / K-13 会話が長く最初の決定が埋もれている / K-14 プランモードの方がいい作業を通常モードで頼んだ / K-15 一度に頼む量が多い / K-16 前の作業と関係ない話を始めた / K-17 人の発言にもっと伝わる書き方がある / K-18 人の書き方が良い

ルール:
- 一番大事なずれを1つ選び、comment に書く。無ければ、良い書き方なら K-18 で褒め、ほかは comment を空にする
- 「OK」「2で」のような短い返事は、前の回答の問いへの答えとして通じるなら指摘しない
- 別々の作業がいくつも並んだ発言なら、K-15 を優先する
- K-14 は、今のモードが通常モードのときだけ見る
- comment は友達のような距離感で、言葉づかいは丁寧に。必ず60字以内にする
- questions には、今回の回答の文の中で、人が答えないと Claude が先へ進めない問いだけを、短い要約で並べる。「ほかに作業はありますか?」のような軽い問いは入れない。無ければ空

JSON だけを返す:{"comment": "一言", "questions": ["問いの要約"]}`

// Haiku に渡す材料。フックで集める(D-004・D-008)
export type Material = {
  text: string // 今回の発言
  answer: string // 今回の回答
  previous?: string // 前の回答
  turns: number // 往復の数(K-13)
  isPlan: boolean // 今のモード(K-14)
  tools: Record<string, number> // このターンのツール名と回数
  edited: Record<string, number> // 編集したファイルと、セッションでの編集回数(K-4・K-8・K-12)
  changedByHand: string[] // 手で変わったファイル(K-5)
}

export type Advice = {
  comment: string // ステータスラインに出す一言。空なら出さない(D-006)
  questions: string[] // 答える枠にする問いの要約(D-007)
}

// Haiku に渡す本文。空の材料は入れない
export function buildPrompt(m: Material): string {
  const parts: string[] = []
  const tag = (name: string, body: string) => parts.push(`<${name}>\n${body}\n</${name}>`)
  if (m.previous) tag('前の回答の末尾', m.previous.slice(-PREVIOUS_LIMIT))
  tag('今回の発言', m.text.slice(0, TEXT_LIMIT))
  if (m.answer) tag('今回の回答の末尾', m.answer.slice(-ANSWER_LIMIT))
  parts.push(`<往復の数>${m.turns}</往復の数>`)
  parts.push(`<今のモード>${m.isPlan ? 'プランモード' : '通常モード'}</今のモード>`)
  const tools = Object.entries(m.tools)
  if (tools.length > 0) tag('このターンのツール', tools.map(([name, n]) => `${name}: ${n}回`).join('\n'))
  const edited = Object.entries(m.edited)
  if (edited.length > 0) tag('編集したファイル(セッションでの編集回数)', edited.map(([path, n]) => `${path}: ${n}回`).join('\n'))
  if (m.changedByHand.length > 0) tag('Claude の編集の後に手で変わったファイル', m.changedByHand.join('\n'))
  return parts.join('\n\n')
}

// Haiku の返事から助言を読む。読めなければ undefined(= 何も出さない)
export function readAdvice(text: string): Advice | undefined {
  // ```json で囲まれても読めるよう、最初の { から最後の } までを取る(C-6)
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return undefined
  let v: unknown
  try {
    v = JSON.parse(m[0])
  } catch {
    return undefined
  }
  if (typeof v !== 'object' || v === null) return undefined
  const { comment, questions } = v as Record<string, unknown>
  if (typeof comment !== 'string') return undefined
  // 文字列でない問い・空の問いは捨て、questions が無ければ空にする
  const known = Array.isArray(questions)
    ? questions.filter((q): q is string => typeof q === 'string' && q.trim() !== '').map(q => q.trim())
    : []
  return { comment: comment.trim(), questions: known }
}

// 入力欄に足す答える枠。打ちかけの文があれば、改行してから後ろに足す(D-007・C-2・C-7)
export function buildFrames(questions: readonly string[], draft: string): string {
  if (questions.length === 0) return ''
  const lines = questions.map((q, i) => `${i + 1}. ${q}:`).join('\n')
  return `${draft ? '\n' : ''}${lines}`
}
