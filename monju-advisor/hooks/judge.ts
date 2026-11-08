// 下書きの部品。フックからは呼ばれるだけで、$ には触らない

// 渡す材料の量(D-044・C-22)
export const RECENT_TURNS = 3 // Claude の回答まで全文で渡す、直近の往復の数
export const TOOL_INPUT_LIMIT = 150 // 道具の入力(JSON)の先頭
export const TOOL_RESULT_LIMIT = 200 // 道具の結果の先頭
export const USER_TEXT_LIMIT = 2000 // 直近より前の人の発言、1つの先頭

// 下書きの指示文(D-041・D-042・D-043・D-047)。C-22_結果.md の「直した指示文」のまま。モデルの system に渡す
export const RULES = `あなたは、人(ユーザー)と AI(Claude)のやり取りを外から見ている第三者です。人が「monju」ボタンを押したので、人が次に送る返事の下書きを書きます。

# 見る所:人が決めること・人が確かめること
- 見るのは、いま人の前にある「人が決めること」(Claude が聞いている選択・推奨・方針)と「人が確かめること」(人の画面・好み・目的など、人にしか分からない事実)だけ
- Claude の作業の進め方(ファイルを読んだか・検証の手順・未確認の推測を確かめたか など)には口を出さない。それは Claude 側の決まりで扱う
  - 悪い例:「決定ログが会話に無いと判定できないおそれ」「CLAUDE.md の行を確かめてください」「git log を見せて」。Claude が読むべき物を読んだか・材料が渡るか・Claude が調べれば分かること、は反対の根拠にも使わない
- 軸は反対意見。一番強い反対を1つ探す。相手は2つ:
  1. Claude の推奨や案:人の目的・好みから見て、別の案の方が合うのでは?(何を失う・何が得られるかで)
  2. 人自身の方針や前提:人の目的と食い違っていないか、決める前に人が確かめるべき事実は無いか
- 反対には具体的な根拠を付ける(会話のどこから・人にとって何が起きるか)。何がどうなのか言わない反対は書かない
- すでに決めたことに反対するのは、決めたときの前提が崩れた根拠が会話にあるときだけ
- 根拠のある反対が無ければ、無理に作らない。そのときは、推奨どおりでよい理由を1行で書いた下書きにする

# 形
- 1行目から:人がそのまま Claude に送れる返事(人の口調で。「b にします」「〜と比べてから決めたい」など)
- そのあとに「(別視点:<反対の中身と根拠を1〜2文>)」
- 全体で 200 字以内。前置き・見出し・引用符は付けない
- 入力欄に人の打ちかけの文があれば、それも反対の相手にする`

// 会話の1件。$.session.messages() の SessionMessage から使う所だけ($ の型に頼らない)
export type Message = {
  role: 'user' | 'assistant'
  text: string
  toolUses: { tool: string; input: unknown; text?: string }[]
}

// 人の発言として数えるか。仕組みが足す発言は捨てる(C-22_材料の作り方.py と同じ)
function isUserText(m: Message): boolean {
  if (m.role !== 'user' || m.text === '') return false
  const t = m.text
  if (t.startsWith('<system-reminder>') || t.startsWith('<ide_') || t.startsWith('Base directory for this skill')) return false
  return !t.includes('SYSTEM NOTIFICATION')
}

// モデルに渡す本文(D-044・D-045・C-22)
// 直近 RECENT_TURNS 往復より前は人の発言だけ、直近は Claude の回答と道具まで
export function buildPrompt(messages: readonly Message[], draft: string): string {
  const users = messages.flatMap((m, i) => (isUserText(m) ? [i] : []))
  // 後ろから RECENT_TURNS 個めの人の発言から直近。足りなければ全部が直近
  const start = users.length >= RECENT_TURNS ? users[users.length - RECENT_TURNS] : 0
  const out = ['# 人の発言(初めから全部)']
  for (const i of users) if (i < start) out.push(`[人] ${messages[i].text.slice(0, USER_TEXT_LIMIT)}`)
  out.push('', `# 直近 ${RECENT_TURNS} 往復(道具の結果は短く切っている)`)
  for (const m of messages.slice(start)) {
    if (m.role === 'user') {
      if (isUserText(m)) out.push(`[人] ${m.text}`)
      continue
    }
    if (m.text !== '') out.push(`[Claude] ${m.text}`)
    for (const u of m.toolUses) {
      out.push(`[道具] ${u.tool} ${(JSON.stringify(u.input) ?? '').slice(0, TOOL_INPUT_LIMIT)}`)
      if (u.text !== undefined) out.push(`[結果] ${u.text.slice(0, TOOL_RESULT_LIMIT)}`)
    }
  }
  if (draft !== '') out.push('', '# 入力欄の打ちかけ', draft)
  return out.join('\n')
}

// 入力欄に足す下書き。打ちかけの文があれば、改行してから後ろに足す(D-045・C-21)
export function buildFill(reply: string, draft: string): string {
  return `${draft ? '\n' : ''}${reply.trim()}`
}
