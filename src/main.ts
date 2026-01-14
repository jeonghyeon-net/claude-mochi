import './style.css'

let image: ImageData | null = null
let words: JapaneseWord[] = []
let busy = false

const $ = (s: string) => document.getElementById(s)!
const log$ = $('log')
const log = (msg: string, t = '') => {
  const d = document.createElement('div')
  d.className = 'log' + (t ? ' ' + t : '')
  d.textContent = msg
  log$.appendChild(d)
  log$.scrollTop = log$.scrollHeight
}

async function init() {
  // Load saved keys
  const mochiKey = await window.electronAPI.getMochiKey()
  if (mochiKey) {
    ($('mochi-key') as HTMLInputElement).value = mochiKey
    ;($('quiz-mochi-key') as HTMLInputElement).value = mochiKey
  }

  const paddleToken = await window.electronAPI.getPaddleOcrToken()
  if (paddleToken) ($('paddle-ocr-token') as HTMLInputElement).value = paddleToken

  // Listen for progress events
  window.electronAPI.onProgress((msg: string) => {
    log(msg, 'data')
  })

  // Listen for deck creation progress
  window.electronAPI.onDeckProgress(({ current, total }) => {
    const btn = $('create-btn') as HTMLButtonElement
    const pct = Math.round((current / total) * 100)
    btn.style.setProperty('--progress', `${pct}%`)
    btn.textContent = `${current}/${total}`
  })

  // Helper to setup key input behavior with sync
  const setupKeyInput = (id: string, saveFn: (v: string) => void, onChange?: () => void, syncId?: string) => {
    const input = $(id) as HTMLInputElement
    const save = () => {
      const v = input.value.trim()
      saveFn(v)
      onChange?.()
      if (syncId) ($(syncId) as HTMLInputElement).value = v
    }
    input.addEventListener('focus', () => input.type = 'text')
    input.addEventListener('blur', () => { input.type = 'password'; save() })
    input.addEventListener('input', save)
    input.addEventListener('paste', () => setTimeout(save, 0))
  }

  // Sync mochi-key between Cards and Quiz tabs
  setupKeyInput('mochi-key', (v) => window.electronAPI.setMochiKey(v), undefined, 'quiz-mochi-key')
  setupKeyInput('quiz-mochi-key', (v) => window.electronAPI.setMochiKey(v), undefined, 'mochi-key')
  setupKeyInput('paddle-ocr-token', (v) => window.electronAPI.setPaddleOcrToken(v), updateParseBtn)

  updateParseBtn()
  updateCreateBtn()
  log('ready', 'ok')
}

function updateCreateBtn() {
  ($('create-btn') as HTMLButtonElement).disabled = words.length === 0 || busy
}

function updateParseBtn() {
  const hasToken = !!($('paddle-ocr-token') as HTMLInputElement).value.trim()
  ;($('parse-btn') as HTMLButtonElement).disabled = !hasToken || busy
}

function updateResetBtn() {
  ($('reset-btn') as HTMLButtonElement).disabled = busy
}

$('drop-zone').addEventListener('click', async () => {
  const img = await window.electronAPI.selectImage()
  if (img) {
    image = img
    ;($('preview-img') as HTMLImageElement).src = `data:${img.mediaType};base64,${img.base64}`
    $('drop-zone').classList.add('hidden')
    $('preview').classList.remove('hidden')
    words = []
    render()
    log(img.name, 'data')
  }
})

$('parse-btn').addEventListener('click', async () => {
  if (!image || busy) return

  const btn = $('parse-btn') as HTMLButtonElement
  busy = true
  updateResetBtn()
  updateCreateBtn()
  btn.disabled = true
  btn.textContent = '...'
  log('parsing...')

  try {
    const t = Date.now()
    words = await window.electronAPI.parseImage(image.path)
    const s = ((Date.now() - t) / 1000).toFixed(1)

    if (words.length === 0) {
      log(`no words (${s}s)`, 'err')
    } else {
      log(`${words.length} words (${s}s)`, 'ok')
    }
    render()
  } catch (e) {
    log((e as Error).message, 'err')
  }
  busy = false
  updateParseBtn()
  updateResetBtn()
  updateCreateBtn()
  btn.textContent = 'Parse'
})

// {漢}(かん){字}(じ) → <ruby>漢<rt>かん</rt></ruby><ruby>字<rt>じ</rt></ruby>
function furiganaToRuby(text: string): string {
  return text.replace(/\{([^}]+)\}\(([^)]+)\)/g, '<ruby>$1<rt>$2</rt></ruby>')
}

function render() {
  updateCreateBtn()
  if (words.length === 0) {
    $('words').innerHTML = '<div class="empty">No cards yet</div>'
    return
  }

  $('words').innerHTML = words.map((w, i) => `
    <div class="word">
      <b>${furiganaToRuby(w.furigana || w.word)}</b>
      <span class="mn">${w.meaning}</span>
      <button class="x" data-i="${i}">×</button>
    </div>
  `).join('')

  document.querySelectorAll('.word .x').forEach(b =>
    b.addEventListener('click', (e) => {
      const i = +(e.target as HTMLElement).dataset.i!
      words.splice(i, 1)
      render()
    })
  )
}

$('create-btn').addEventListener('click', async () => {
  if (!words.length || busy) return log('no words', 'err')

  const keyInput = $('mochi-key') as HTMLInputElement
  const key = keyInput.value.trim()
  if (!key) return log('enter api key', 'err')

  await window.electronAPI.setMochiKey(key)

  const btn = $('create-btn') as HTMLButtonElement
  const name = ($('deck-name') as HTMLInputElement).value.trim() || `JP ${new Date().toLocaleDateString()}`

  busy = true
  updateParseBtn()
  updateResetBtn()
  btn.disabled = true
  btn.classList.add('progress')
  btn.style.setProperty('--progress', '0%')
  btn.textContent = '0/' + words.length

  try {
    const r = await window.electronAPI.createMochiDeck({ deckName: name, words })
    log(`created ${r.cardsCreated}/${r.totalWords}`, 'ok')
  } catch (e) {
    log((e as Error).message, 'err')
  }
  busy = false
  btn.classList.remove('progress')
  btn.style.removeProperty('--progress')
  updateParseBtn()
  updateResetBtn()
  updateCreateBtn()
  btn.textContent = 'Create Deck'
})

$('reset-btn').addEventListener('click', () => {
  if (busy) return
  image = null
  words = []
  render()
  $('preview').classList.add('hidden')
  $('drop-zone').classList.remove('hidden')
  ;($('deck-name') as HTMLInputElement).value = ''
  log('reset', 'data')
})

// ===== Tabs =====
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))
    tab.classList.add('active')
    $('tab-' + (tab as HTMLElement).dataset.tab).classList.add('active')
  })
})

// ===== Quiz Tab =====
let quizCards: MochiCard[] = []
let quizBusy = false

function updateQuizButtons() {
  ;($('generate-quiz-btn') as HTMLButtonElement).disabled = quizCards.length === 0
  ;($('copy-quiz-btn') as HTMLButtonElement).disabled = !($('quiz-output') as HTMLTextAreaElement).value
  ;($('fetch-cards-btn') as HTMLButtonElement).disabled = quizBusy
}

$('fetch-cards-btn').addEventListener('click', async () => {
  if (quizBusy) return
  const deckId = ($('quiz-deck-id') as HTMLInputElement).value.trim()
  if (!deckId) return

  const btn = $('fetch-cards-btn') as HTMLButtonElement
  quizBusy = true
  btn.disabled = true
  btn.textContent = '...'

  try {
    quizCards = await window.electronAPI.fetchDeckCards(deckId)
    $('quiz-card-count').textContent = `${quizCards.length} cards loaded`
  } catch (e) {
    $('quiz-card-count').textContent = (e as Error).message
    quizCards = []
  }
  quizBusy = false
  updateQuizButtons()
  btn.textContent = 'Fetch Cards'
})

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

$('generate-quiz-btn').addEventListener('click', () => {
  if (quizCards.length === 0) return

  // Get selected quiz types
  const selectedTypes = Array.from(document.querySelectorAll('input[name="quiz-type"]:checked'))
    .map(el => (el as HTMLInputElement).value)
  if (selectedTypes.length === 0) return

  const shuffled = shuffle(quizCards)

  const lines = shuffled.map(card => {
    // Random type per question
    const quizType = selectedTypes[Math.floor(Math.random() * selectedTypes.length)]
    let q = ''
    if (quizType === 'reading') q = card.reading || card.front
    else if (quizType === 'meaning') q = card.meaning
    else if (quizType === 'kanji') q = card.kanji || card.front
    return `Q. ${q}\nA.  `
  })

  ;($('quiz-output') as HTMLTextAreaElement).value = lines.join('\n\n')
  updateQuizButtons()
})

$('copy-quiz-btn').addEventListener('click', async () => {
  const text = ($('quiz-output') as HTMLTextAreaElement).value
  if (!text) return
  await navigator.clipboard.writeText(text)
  const btn = $('copy-quiz-btn') as HTMLButtonElement
  btn.textContent = 'Copied!'
  setTimeout(() => { btn.textContent = 'Copy' }, 1000)
})

init()
