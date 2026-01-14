import { contextBridge, ipcRenderer } from 'electron'

export interface ImageData {
  name: string
  path: string
  base64: string
  mediaType: string
}

export interface JapaneseWord {
  word: string
  reading: string
  meaning: string
}

export interface ClaudeAvailability {
  available: boolean
  path?: string
  error?: string
}

export interface DeckResult {
  deckId: string
  deckName: string
  cardsCreated: number
  totalWords: number
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Claude Code availability
  checkClaude: (): Promise<ClaudeAvailability> => ipcRenderer.invoke('check-claude'),

  // Mochi API Key
  getMochiKey: (): Promise<string> => ipcRenderer.invoke('get-mochi-key'),
  setMochiKey: (apiKey: string): Promise<boolean> => ipcRenderer.invoke('set-mochi-key', apiKey),

  // PaddleOCR Token
  getPaddleOcrToken: (): Promise<string> => ipcRenderer.invoke('get-paddle-ocr-token'),
  setPaddleOcrToken: (token: string): Promise<boolean> => ipcRenderer.invoke('set-paddle-ocr-token', token),

  // Image operations
  selectImage: (): Promise<ImageData | null> => ipcRenderer.invoke('select-image'),

  // Claude Code - parse Japanese words from image path
  parseImage: (imagePath: string): Promise<JapaneseWord[]> => ipcRenderer.invoke('parse-image', imagePath),

  // Mochi Cards
  createMochiDeck: (data: { deckName: string; words: JapaneseWord[] }): Promise<DeckResult> =>
    ipcRenderer.invoke('create-mochi-deck', data),

  // Fetch cards from deck
  fetchDeckCards: (deckId: string): Promise<Array<{ front: string; reading: string; kanji: string; meaning: string }>> =>
    ipcRenderer.invoke('fetch-deck-cards', deckId),

  // Progress events
  onProgress: (callback: (msg: string) => void) => {
    ipcRenderer.on('progress', (_event, msg) => callback(msg))
  },

  // Deck creation progress
  onDeckProgress: (callback: (data: { current: number; total: number }) => void) => {
    ipcRenderer.on('deck-progress', (_event, data) => callback(data))
  }
})
