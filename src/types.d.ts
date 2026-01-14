interface ImageData {
  name: string
  path: string
  base64: string
  mediaType: string
}

interface JapaneseWord {
  word: string
  reading: string
  meaning: string
  furigana: string
}

interface ClaudeAvailability {
  available: boolean
  path?: string
  error?: string
}

interface DeckResult {
  deckId: string
  deckName: string
  cardsCreated: number
  totalWords: number
}

interface MochiCard {
  front: string
  reading: string
  kanji: string
  meaning: string
}

interface ElectronAPI {
  checkClaude: () => Promise<ClaudeAvailability>
  getMochiKey: () => Promise<string>
  setMochiKey: (apiKey: string) => Promise<boolean>
  getPaddleOcrToken: () => Promise<string>
  setPaddleOcrToken: (token: string) => Promise<boolean>
  selectImage: () => Promise<ImageData | null>
  parseImage: (imagePath: string) => Promise<JapaneseWord[]>
  createMochiDeck: (data: { deckName: string; words: JapaneseWord[] }) => Promise<DeckResult>
  fetchDeckCards: (deckId: string) => Promise<MochiCard[]>
  onProgress: (callback: (msg: string) => void) => void
  onDeckProgress: (callback: (data: { current: number; total: number }) => void) => void
}

interface Window {
  electronAPI: ElectronAPI
}
