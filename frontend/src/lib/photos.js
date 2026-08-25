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
