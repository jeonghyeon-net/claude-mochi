import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import Store from 'electron-store'
import { claudeService } from './services/ClaudeService'

const store = new Store({
  defaults: {
    mochiApiKey: '',
    paddleOcrToken: ''
  }
})

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Check Claude availability
ipcMain.handle('check-claude', () => {
  return claudeService.checkAvailability()
})

// Settings handlers
ipcMain.handle('get-mochi-key', () => {
  return store.get('mochiApiKey') as string
})

ipcMain.handle('set-mochi-key', (_event, apiKey: string) => {
  store.set('mochiApiKey', apiKey)
  return true
})

// PaddleOCR Token handlers
ipcMain.handle('get-paddle-ocr-token', () => {
  return store.get('paddleOcrToken') as string
})

ipcMain.handle('set-paddle-ocr-token', (_event, token: string) => {
  store.set('paddleOcrToken', token)
  return true
})

// File selection handler - single image only
ipcMain.handle('select-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const filePath = result.filePaths[0]
  const buffer = fs.readFileSync(filePath)
  const base64 = buffer.toString('base64')
  const ext = path.extname(filePath).slice(1).toLowerCase()
  const mediaType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`

  return {
    name: path.basename(filePath),
    path: filePath,
    base64,
    mediaType
  }
})

// Parse Japanese words from image using Claude Code
ipcMain.handle('parse-image', async (_event, imagePath: string) => {
  const paddleOcrToken = store.get('paddleOcrToken') as string
  if (!paddleOcrToken) {
    throw new Error('PaddleOCR Token이 설정되지 않았습니다.')
  }

  const sendProgress = (msg: string) => {
    mainWindow?.webContents.send('progress', msg)
  }
  return claudeService.parseJapaneseWords(imagePath, paddleOcrToken, sendProgress)
})

// Create Mochi deck and cards
ipcMain.handle('create-mochi-deck', async (_event, data: {
  deckName: string
  words: Array<{ word: string; reading: string; meaning: string; furigana: string }>
}) => {
  const mochiApiKey = store.get('mochiApiKey') as string

  if (!mochiApiKey) {
    throw new Error('Mochi API Key가 설정되지 않았습니다.')
  }

  const sendProgress = (current: number, total: number) => {
    mainWindow?.webContents.send('deck-progress', { current, total })
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + Buffer.from(mochiApiKey + ':').toString('base64')
  }

  // Create deck
  sendProgress(0, data.words.length)
  const deckResponse = await fetch('https://app.mochi.cards/api/decks', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: data.deckName })
  })

  if (!deckResponse.ok) {
    const error = await deckResponse.text()
    throw new Error('덱 생성 실패: ' + error)
  }

  const deck = await deckResponse.json() as { id: string }
  const deckId = deck.id

  // Create cards with furigana
  const createdCards: string[] = []
  for (let i = 0; i < data.words.length; i++) {
    const word = data.words[i]
    // Mochi furigana syntax: {漢}(かん){字}(じ) - 한자별 개별 요미가나
    const cardContent = `# ${word.furigana}\n\n---\n\n${word.meaning}`

    const cardResponse = await fetch('https://app.mochi.cards/api/cards', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content: cardContent,
        'deck-id': deckId
      })
    })

    if (cardResponse.ok) {
      createdCards.push(word.word)
    }
    sendProgress(i + 1, data.words.length)
  }

  return {
    deckId,
    deckName: data.deckName,
    cardsCreated: createdCards.length,
    totalWords: data.words.length
  }
})

// Fetch cards from a Mochi deck
ipcMain.handle('fetch-deck-cards', async (_event, deckId: string) => {
  const mochiApiKey = store.get('mochiApiKey') as string

  if (!mochiApiKey) {
    throw new Error('Mochi API Key가 설정되지 않았습니다.')
  }

  // Clean deck ID (remove brackets if present, e.g., [[abc123]] -> abc123)
  const cleanDeckId = deckId.replace(/[\[\]]/g, '').trim()

  const headers = {
    'Authorization': 'Basic ' + Buffer.from(mochiApiKey + ':').toString('base64')
  }

  // Fetch all cards from deck
  const url = new URL('https://app.mochi.cards/api/cards')
  url.searchParams.set('deck-id', cleanDeckId)
  url.searchParams.set('limit', '1000')

  const response = await fetch(url.toString(), { method: 'GET', headers })

  if (!response.ok) {
    const error = await response.text()
    throw new Error('카드 가져오기 실패: ' + error)
  }

  const data = await response.json() as { docs: Array<{ content: string }> }
  const allCards = data.docs

  // Parse card content to extract word info
  // Format: # {漢}(かん){字}(じ)\n\n---\n\n뜻
  const cards = allCards.map(card => {
    const content = card.content || ''
    const parts = content.split('---')
    const front = parts[0]?.replace(/^#\s*/, '').trim() || ''
    const meaning = parts[1]?.trim() || ''

    // Extract reading from furigana: {漢}(かん){字}(じ) → かんじ
    const reading = front.replace(/\{[^}]+\}\(([^)]+)\)/g, '$1').replace(/[^\u3040-\u309F]/g, '')

    // Extract kanji only: {漢}(かん){字}(じ) → 漢字
    const kanji = front.replace(/\{([^}]+)\}\([^)]+\)/g, '$1').replace(/[{()}]/g, '')

    return { front, reading, kanji, meaning }
  })

  return cards
})
