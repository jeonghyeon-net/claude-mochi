import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import Store from 'electron-store'
import { claudeService } from './services/ClaudeService'

const store = new Store({
  defaults: {
    mochiApiKey: ''
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
    mainWindow.webContents.openDevTools()
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
  const sendProgress = (msg: string) => {
    mainWindow?.webContents.send('progress', msg)
  }
  return claudeService.parseJapaneseWords(imagePath, sendProgress)
})

// Create Mochi deck and cards
ipcMain.handle('create-mochi-deck', async (_event, data: {
  deckName: string
  words: Array<{ word: string; reading: string; meaning: string }>
}) => {
  const mochiApiKey = store.get('mochiApiKey') as string

  if (!mochiApiKey) {
    throw new Error('Mochi API Key가 설정되지 않았습니다.')
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + Buffer.from(mochiApiKey + ':').toString('base64')
  }

  // Create deck
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
  for (const word of data.words) {
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
  }

  return {
    deckId,
    deckName: data.deckName,
    cardsCreated: createdCards.length,
    totalWords: data.words.length
  }
})
