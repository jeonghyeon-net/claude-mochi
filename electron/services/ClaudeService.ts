import { execSync } from 'child_process'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, dirname, extname } from 'path'
import { homedir, platform } from 'os'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

type MediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
type ImageBlockParam = {
  type: 'image'
  source: { type: 'base64'; media_type: MediaType; data: string }
}
type TextBlockParam = { type: 'text'; text: string }

const PADDLE_OCR_API_URL = 'https://x9qcz4g1vc73q0s1.aistudio-app.com/layout-parsing'

function addClaudePathToEnv(claudePath: string): void {
  const dir = dirname(claudePath)
  const currentPath = process.env.PATH || ''
  if (!currentPath.split(':').includes(dir)) {
    process.env.PATH = dir + ':' + currentPath
  }
}

function findClaudePath(): { found: boolean; path: string } {
  const isWindows = platform() === 'win32'
  const isMac = platform() === 'darwin'
  const home = homedir()

  const scanDir = (baseDir: string, pattern: (name: string) => boolean, subPath: string): string[] => {
    if (!existsSync(baseDir)) return []
    try {
      return readdirSync(baseDir)
        .filter(pattern)
        .map((dir) => join(baseDir, dir, subPath))
    } catch {
      return []
    }
  }

  const getDynamicPaths = (): string[] => {
    const paths: string[] = []
    paths.push(...scanDir(join(home, '.nvm/versions/node'), (d) => d.startsWith('v'), 'bin/claude'))
    paths.push(...scanDir(join(home, 'Library/Application Support/fnm/node-versions'), (d) => d.startsWith('v'), 'installation/bin/claude'))
    paths.push(...scanDir(join(home, '.volta/tools/image/node'), () => true, 'bin/claude'))
    paths.push(...scanDir(join(home, '.asdf/installs/nodejs'), () => true, 'bin/claude'))
    return paths
  }

  const staticPaths = isWindows
    ? [
        'C:\\Program Files\\Claude\\claude.exe',
        join(home, 'AppData\\Roaming\\npm\\claude.cmd'),
      ]
    : [
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        '/usr/bin/claude',
        join(home, '.npm-global/bin/claude'),
        join(home, '.local/bin/claude'),
      ]

  const commonPaths = [...staticPaths, ...getDynamicPaths()]

  for (const candidatePath of commonPaths) {
    if (existsSync(candidatePath)) {
      return { found: true, path: candidatePath }
    }
  }

  const tryFindClaude = (command: string): string | null => {
    try {
      const foundPath = execSync(command, { encoding: 'utf8', timeout: 5000 }).trim()
      const firstPath = foundPath.split('\n')[0]?.trim()
      if (firstPath) return firstPath
    } catch {
      return null
    }
    return null
  }

  let foundPath: string | null = null
  if (isMac) {
    foundPath = tryFindClaude('/bin/zsh -lc "which claude"')
    if (!foundPath) foundPath = tryFindClaude('/bin/bash -lc "which claude"')
  } else if (isWindows) {
    foundPath = tryFindClaude('where claude')
  } else {
    foundPath = tryFindClaude('which claude')
  }

  if (foundPath) {
    return { found: true, path: foundPath }
  }

  return { found: false, path: isWindows ? 'claude.exe' : 'claude' }
}

async function callPaddleOCR(imagePath: string, token: string): Promise<string> {
  const fileBytes = readFileSync(imagePath)
  const fileData = fileBytes.toString('base64')

  const ext = extname(imagePath).toLowerCase()
  const fileType = ext === '.pdf' ? 0 : 1

  const payload = {
    file: fileData,
    fileType,
    useDocOrientationClassify: false,
    useDocUnwarping: false,
    useChartRecognition: false,
  }

  const response = await fetch(PADDLE_OCR_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`PaddleOCR API 오류: ${response.status}`)
  }

  const data = await response.json()
  const results = data.result?.layoutParsingResults || []

  // 모든 페이지/이미지의 마크다운 텍스트를 합침
  const markdownTexts = results.map((res: { markdown?: { text?: string } }) => res.markdown?.text || '').filter(Boolean)
  return markdownTexts.join('\n\n')
}

class ClaudeService {
  private claudePath: string
  private claudeAvailable: boolean

  constructor() {
    const pathResult = findClaudePath()
    this.claudePath = pathResult.path
    this.claudeAvailable = pathResult.found
    console.log('[ClaudeService] Claude path:', this.claudePath, 'available:', this.claudeAvailable)

    if (pathResult.found) {
      addClaudePathToEnv(this.claudePath)
    }
  }

  checkAvailability(): { available: boolean; path?: string; error?: string } {
    if (this.claudeAvailable) {
      return { available: true, path: this.claudePath }
    }
    return { available: false, error: 'Claude CLI를 찾을 수 없습니다.' }
  }

  async parseJapaneseWords(
    imagePath: string,
    paddleOcrToken: string,
    onProgress?: (msg: string) => void
  ): Promise<Array<{ word: string; reading: string; meaning: string; furigana: string }>> {
    if (!this.claudeAvailable) {
      throw new Error('Claude CLI를 찾을 수 없습니다.')
    }

    // Step 1: PaddleOCR로 이미지에서 텍스트 추출
    onProgress?.('🔍 PaddleOCR로 텍스트 추출 중...')
    let ocrText: string
    try {
      ocrText = await callPaddleOCR(imagePath, paddleOcrToken)
      console.log('[ClaudeService] PaddleOCR 결과:', ocrText.slice(0, 500))
    } catch (error) {
      console.error('[ClaudeService] PaddleOCR 오류:', error)
      throw new Error(`OCR 처리 실패: ${error}`)
    }

    if (!ocrText.trim()) {
      onProgress?.('⚠️ 이미지에서 텍스트를 찾을 수 없습니다.')
      return []
    }

    onProgress?.('📤 Claude에게 정리 요청 중...')

    // Step 2: 이미지를 base64로 읽기
    const imageBase64 = readFileSync(imagePath).toString('base64')
    const ext = extname(imagePath).toLowerCase()
    const mediaType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'

    // Step 3: Claude에게 이미지 + OCR 결과를 함께 보내서 정리 요청
    const promptText = `이 이미지와 PaddleOCR 결과를 참고해서 일본어 단어를 추출해줘.

[PaddleOCR 결과]
${ocrText}

중요: 이미지에 실제로 보이는 단어만 추출해. 없는 단어를 만들어내지 마.

각 단어에 대해 다음 형식의 JSON 배열로 반환해줘:
[
  {
    "word": "漢字またはひらがな",
    "reading": "ひらがな読み",
    "meaning": "한국어 뜻",
    "furigana": "{漢}(かん){字}(じ)"
  }
]

furigana 필드는 각 한자마다 개별적으로 {한자}(읽기) 형식으로 작성해줘.
예시:
- 日本語 → {日}(に){本}(ほん){語}(ご)
- 食べる → {食}(た)べる
- ひらがな만 있으면 그냥 ひらがな 그대로

일본어가 없으면 빈 배열 []을 반환해줘.
JSON만 반환하고 다른 설명은 하지 마.`

    const sdkOptions: Options = {
      cwd: homedir(),
      pathToClaudeCodeExecutable: this.claudePath,
      systemPrompt: '당신은 일본어 단어 정리 전문가입니다. 이미지와 OCR 결과를 참고해서 이미지에 실제로 보이는 일본어 단어만 추출합니다. 없는 단어를 만들어내지 마세요. JSON 형식으로만 응답하세요.',
      maxTurns: 3,
      permissionMode: 'bypassPermissions',
      includePartialMessages: true,
    }

    try {
      console.log('[ClaudeService] Claude 요청 프롬프트:', promptText.slice(0, 500))

      // 이미지 + 텍스트를 함께 보내는 SDKUserMessage 생성
      const imageBlock: ImageBlockParam = {
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: imageBase64 }
      }
      const textBlock: TextBlockParam = { type: 'text', text: promptText }

      async function* createPromptWithImage(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: 'user',
          message: {
            role: 'user',
            content: [imageBlock, textBlock]
          },
          parent_tool_use_id: null,
          session_id: ''
        }
      }

      const queryResult = query({ prompt: createPromptWithImage(), options: sdkOptions })
      let resultText = ''

      for await (const msg of queryResult) {
        console.log('[SDK]', msg.type, JSON.stringify(msg).slice(0, 300))

        if (msg.type === 'stream_event') {
          const streamMsg = msg as { event?: { type?: string; delta?: { text?: string } } }
          if (streamMsg.event?.delta?.text) {
            resultText += streamMsg.event.delta.text
          }
        } else if (msg.type === 'assistant') {
          const assistantMsg = msg as {
            message?: {
              content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>
            }
          }
          if (assistantMsg.message?.content) {
            for (const block of assistantMsg.message.content) {
              if (block.type === 'text' && block.text) {
                if (!resultText) resultText = block.text
              }
            }
          }
        } else if (msg.type === 'result') {
          onProgress?.('✅ 분석 완료')
        }
      }

      onProgress?.('JSON 파싱 중...')

      // Extract JSON from response
      const jsonMatch = resultText.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }

      return []
    } catch (error) {
      console.error('[ClaudeService] Parse error:', error)
      throw error
    }
  }
}

export const claudeService = new ClaudeService()
