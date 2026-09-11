// Progress photos — stored in IndexedDB, on this device only. Deliberately NOT part of
// the app's `S` state: that blob is rewritten to localStorage and re-pushed to the server
// on every interaction (logging a set, flipping a setting), so photos living inside it
// would drag megabytes along with every unrelated change. A photo library belongs to the
// device it was taken on, the same way a backup already treats guest data.
import { uid } from './format.js'

const DB_NAME = 'opengym_photos'
const STORE = 'photos'
let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' })
      store.createIndex('d', 'd')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

const reqToPromise = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

// Downscale + re-encode before storing, so months of photos stay a reasonable size —
// full camera resolution is wasted on a body-progress reference shot.
async function compress(file, maxDim = 1280, quality = 0.85) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  bitmap.close && bitmap.close()
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
}

// Metadata only (id, date) — thumbnails/full images are fetched separately per id so a
// gallery of many photos doesn't have to hold every blob in memory at once.
export async function listPhotos() {
  const db = await openDB()
  const all = await reqToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())
  return all.map(({ id, d, t }) => ({ id, d, t })).sort((a, b) => (a.d < b.d ? -1 : 1))
}

export async function getPhotoBlob(id) {
  const db = await openDB()
  const rec = await reqToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(id))
  return rec ? rec.blob : null
}

// One photo per date — picking a date that already has one replaces it, same as the
// weight and measurement logs.
export async function savePhoto(file, d) {
  const blob = await compress(file)
  const db = await openDB()
  const existing = await reqToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).index('d').get(d))
  const id = existing ? existing.id : uid()
  await reqToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ id, d, t: new Date(d).getTime(), blob }))
  return id
}

export async function deletePhoto(id) {
  const db = await openDB()
  await reqToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id))
}

// Best-effort "when was this taken?" for a gallery pick, so the timeline lands the photo on
// the right day without the user having to remember it. Prefers the EXIF capture date,
// falls back to the file's last-modified stamp, and gives up (returns null → caller keeps
// today) rather than guessing a future date.
export async function readPhotoDate(file) {
  const today = new Date().toISOString().slice(0, 10)
  try {
    const exif = await exifDate(file)
    if (exif && exif <= today) return exif
  } catch { /* not a JPEG, truncated, or no EXIF — fall through */ }
  if (file.lastModified) {
    const iso = new Date(file.lastModified).toISOString().slice(0, 10)
    if (iso <= today) return iso
  }
  return null
}

// Minimal EXIF reader: walk the JPEG segments to the APP1/TIFF block and pull
// DateTimeOriginal (falling back to DateTime). Only the first 128 KB is inspected — EXIF
// always sits right after the SOI marker.
async function exifDate(file) {
  const view = new DataView(await file.slice(0, 131072).arrayBuffer())
  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null
  let off = 2
  while (off + 4 <= view.byteLength) {
    const marker = view.getUint16(off)
    if ((marker & 0xFF00) !== 0xFF00) return null
    const size = view.getUint16(off + 2)
    if (marker === 0xFFE1 && view.getUint32(off + 4) === 0x45786966) {
      return parseExif(view, off + 10)
    }
    off += 2 + size
  }
  return null
}

function parseExif(view, tiff) {
  const le = view.getUint16(tiff) === 0x4949
  const u16 = o => view.getUint16(o, le)
  const u32 = o => view.getUint32(o, le)
  const str = (o, len) => {
    let s = ''
    for (let j = 0; j < len && o + j < view.byteLength; j++) s += String.fromCharCode(view.getUint8(o + j))
    return s
  }
  const toISO = s => {
    const m = s.match(/^(\d{4}):(\d{2}):(\d{2})/)
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null
  }
  const readDir = start => {
    const out = {}
    if (start + 2 > view.byteLength) return out
    const n = u16(start)
    for (let i = 0; i < n; i++) {
      const e = start + 2 + i * 12
      if (e + 12 > view.byteLength) break
      out[u16(e)] = u32(e + 8)
    }
    return out
  }
  const ifd0 = readDir(tiff + u32(tiff + 4))
  let raw = null
  if (ifd0[0x8769]) {
    const exif = readDir(tiff + ifd0[0x8769])
    if (exif[0x9003]) raw = str(tiff + exif[0x9003], 19)
  }
  if (!raw && ifd0[0x0132]) raw = str(tiff + ifd0[0x0132], 19)
  return raw ? toISO(raw) : null
}
