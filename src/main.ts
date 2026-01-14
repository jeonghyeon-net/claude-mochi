import './style.css'

let image: ImageData | null = null
let words: JapaneseWord[] = []

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
  const k = await window.electronAPI.getMochiKey()
  if (k) ($('mochi-key') as HTMLInputElement).value = k

  // Listen for progress events
  window.electronAPI.onProgress((msg: string) => {
    log(msg, 'data')
  })

  log('ready', 'ok')
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

$('clear-btn').addEventListener('click', () => {
  image = null
  words = []
  render()
  $('preview').classList.add('hidden')
  $('drop-zone').classList.remove('hidden')
})

$('parse-btn').addEventListener('click', async () => {
  if (!image) return
  const btn = $('parse-btn') as HTMLButtonElement
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
  btn.disabled = false
  btn.textContent = 'Parse'
})

// {漢}(かん){字}(じ) → <ruby>漢<rt>かん</rt></ruby><ruby>字<rt>じ</rt></ruby>
function furiganaToRuby(text: string): string {
  return text.replace(/\{([^}]+)\}\(([^)]+)\)/g, '<ruby>$1<rt>$2</rt></ruby>')
}

function render() {
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
  if (!words.length) return log('no words', 'err')

  const keyInput = $('mochi-key') as HTMLInputElement
  const key = keyInput.value.trim()
  if (!key) return log('enter api key', 'err')

  await window.electronAPI.setMochiKey(key)

  const btn = $('create-btn') as HTMLButtonElement
  const name = ($('deck-name') as HTMLInputElement).value.trim() || `JP ${new Date().toLocaleDateString()}`

  btn.disabled = true
  btn.textContent = '...'

  try {
    const r = await window.electronAPI.createMochiDeck({ deckName: name, words })
    log(`created ${r.cardsCreated}/${r.totalWords}`, 'ok')
    image = null
    words = []
    render()
    $('preview').classList.add('hidden')
    $('drop-zone').classList.remove('hidden')
    ;($('deck-name') as HTMLInputElement).value = ''
  } catch (e) {
    log((e as Error).message, 'err')
  }
  btn.disabled = false
  btn.textContent = 'Create Deck'
})

init()
