import { execSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir, platform } from 'os'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'

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
    onProgress?: (msg: string) => void
  ): Promise<Array<{ word: string; reading: string; meaning: string; furigana: string }>> {
    if (!this.claudeAvailable) {
      throw new Error('Claude CLI를 찾을 수 없습니다.')
    }

    const prompt = `이 이미지 파일을 읽고 일본어 단어들을 추출해줘: ${imagePath}

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

이미지에 일본어가 없으면 빈 배열 []을 반환해줘.
JSON만 반환하고 다른 설명은 하지 마.`

    const sdkOptions: Options = {
      cwd: homedir(),
      pathToClaudeCodeExecutable: this.claudePath,
      systemPrompt: '당신은 일본어 단어 추출 전문가입니다. 이미지에서 일본어를 찾아 JSON 형식으로만 응답하세요.',
      maxTurns: 10,
      permissionMode: 'bypassPermissions',
    }

    try {
      const queryResult = query({ prompt, options: sdkOptions })
      let resultText = ''

      for await (const msg of queryResult) {
        // 모든 메시지 타입 로그
        onProgress?.(`[${msg.type}]`)
        console.log('[SDK]', msg.type, JSON.stringify(msg).slice(0, 200))

        if (msg.type === 'stream_event') {
          const streamMsg = msg as { event?: { type?: string; delta?: { text?: string } } }
          if (streamMsg.event?.delta?.text) {
            resultText += streamMsg.event.delta.text
            onProgress?.(streamMsg.event.delta.text.replace(/\n/g, ' '))
          }
        } else if (msg.type === 'assistant') {
          const assistantMsg = msg as { message?: { content?: Array<{ type: string; text?: string }> } }
          if (assistantMsg.message?.content) {
            for (const block of assistantMsg.message.content) {
              if (block.type === 'text' && block.text) {
                if (!resultText) resultText = block.text
                onProgress?.(block.text.slice(0, 100).replace(/\n/g, ' '))
              }
            }
          }
        } else if (msg.type === 'result') {
          onProgress?.('완료')
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
