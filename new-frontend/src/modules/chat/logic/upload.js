/**
 * upload.js — M4-14 attachment staging pipeline
 * -----------------------------------------------------------------------------
 * Browser-side staging pipeline for C2 chat attachments (I-20/21). It compresses
 * a raster image to a JPEG blob + a small thumbnail data URL, generates a client
 * uploadId, and hands the artifact to an injectable `uploader` (createRealUploader
 * wires the S2 POST /api/uploads endpoint; a caller that omits an uploader gets a
 * fast-fail UploadError so a silent non-upload can never masquerade as staged).
 * The caller (send.js via the module lead) is responsible for the actual send POST
 * through the I-19/20/21 batch shape `{ uploadId, clientKey }`; this module only
 * produces the staged artifact.
 *
 * Structure:
 *   - Pure state machine: `createStageState()` + `transitionStage()` are
 *     Node-testable, zero-DOM, zero-timer reducers.
 *   - `createStageTask()` is the no-dedupe core runner (compress -> uploader).
 *   - `stageAttachment()` wraps the core with F6 busy discipline: a second call
 *     for the same in-flight file (name+size+lastModified identity) is a no-op
 *     that returns the same task (same uploadId, single uploader invocation).
 *   - Browser-only helpers (`compressImage` and friends) are isolated behind
 *     `typeof` guards so importing this module from plain Node never crashes and
 *     Node unit tests can inject a mock compressImage.
 *
 * Progress contract (percent, 0-100):
 *   preparing (compress)  -> 0..60
 *   staging (uploader)    -> 60..100
 *   done                  -> 100
 * The user-facing `onProgress(percent)` option receives these integers. The
 * internal `compressImage` onProgress and the `uploader` onProgress receive
 * fractions in [0, 1].
 *
 * This file holds zero Chinese literals (contract 6).
 */

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Rejected by `cancel()`; lets send.js distinguish user-cancel from failure. */
export class CancelledError extends Error {
  constructor(message = 'Upload cancelled') {
    super(message)
    this.name = 'CancelledError'
  }
}

/** Rejected on compress / staging failure, carrying a stable `code`. */
export class UploadError extends Error {
  constructor(message, opts = {}) {
    super(message)
    this.name = 'UploadError'
    this.code = opts.code ?? null
    if (opts.cause !== undefined) this.cause = opts.cause
  }
}

// ---------------------------------------------------------------------------
// Pure state machine
// ---------------------------------------------------------------------------

/**
 * Create the initial reactive-ish stage state. Plain object so callers can wrap
 * it in Vue `reactive()`; `transitionStage` mutates it in place (matching the
 * module's other logic reducers, e.g. unread.js) so reactivity is preserved.
 * @param {string|null} [fileKey] - dedupe identity of the source file.
 * @returns {{status:string, progress:number, uploadId:string|null,
 *            fileKey:string|null, result:object|null, error:Error|null}}
 */
export function createStageState(fileKey = null) {
  return {
    status: 'idle', // 'idle'|'preparing'|'staging'|'done'|'error'|'cancelled'
    progress: 0, // 0-100
    uploadId: null, // client-generated id (state.result.uploadId once staged)
    fileKey: fileKey ?? null,
    result: null, // { uploadId, kind, name, body, thumb } on 'done'
    error: null, // Error on 'error'
  }
}

/** Progress band per in-flight status: [lo, hi] percent. */
const PROGRESS_BAND = {
  preparing: [0, 60],
  staging: [60, 100],
}

/**
 * Transition the state object on a named event. Mutates in place (Vue-reactive
 * friendly) and returns it. Invalid transitions are no-ops.
 *
 * Events:
 *   { type:'begin', uploadId, fileKey }          idle -> preparing (progress 0)
 *   { type:'progress', progress }                preparing/staging only, banded
 *   { type:'compress-done', blob, thumbDataUrl } preparing -> staging (60)
 *   { type:'staged', result }                    staging -> done (100)
 *   { type:'fail', error }                       any in-flight -> error (progress 0)
 *   { type:'cancel' }                            any in-flight -> cancelled (progress 0)
 *
 * @param {object} state - object from createStageState().
 * @param {object} event - named event (see above).
 * @returns {object} the same state object (mutated).
 */
export function transitionStage(state, event = {}) {
  switch (event.type) {
    case 'begin':
      if (state.status !== 'idle') return state
      state.status = 'preparing'
      state.progress = 0
      state.uploadId = event.uploadId ?? state.uploadId
      state.fileKey = event.fileKey ?? state.fileKey
      state.result = null
      state.error = null
      break
    case 'progress': {
      if (state.status !== 'preparing' && state.status !== 'staging') return state
      const p = Number(event.progress)
      if (!Number.isFinite(p)) return state
      const [lo, hi] = PROGRESS_BAND[state.status]
      state.progress = Math.min(hi, Math.max(lo, Math.round(p)))
      break
    }
    case 'compress-done':
      if (state.status !== 'preparing') return state
      state.status = 'staging'
      state.progress = 60
      break
    case 'staged':
      if (state.status !== 'staging') return state
      state.status = 'done'
      state.progress = 100
      state.result = event.result ?? null
      break
    case 'fail':
      if (state.status === 'done' || state.status === 'error' || state.status === 'cancelled') return state
      state.status = 'error'
      state.progress = 0
      state.error = event.error ?? null
      break
    case 'cancel':
      if (state.status === 'done' || state.status === 'error' || state.status === 'cancelled') return state
      state.status = 'cancelled'
      state.progress = 0
      break
    default:
      return state
  }
  return state
}

// ---------------------------------------------------------------------------
// Identity + uploadId
// ---------------------------------------------------------------------------

/**
 * Best-effort file identity for F6 dedupe. A `File` has no stable unique id, so
 * the stable-ish scalar fields are combined. Two distinct files with identical
 * name/size/lastModified collapse to one identity (documented limitation).
 * @param {object} file - File-like object ({ name, size, lastModified }).
 * @returns {string}
 */
export function fileIdentity(file) {
  const name = file && typeof file.name === 'string' ? file.name : ''
  const size = file && file.size != null ? String(file.size) : '?'
  const mtime = file && file.lastModified != null ? String(file.lastModified) : '?'
  return `${name}|${size}|${mtime}`
}

let fallbackSeq = 0

/**
 * Client-generated upload id: crypto.randomUUID when available, else a
 * counter+random fallback. Uniqueness is guaranteed by the fallback counter, not
 * by wall-clock.
 * @returns {string}
 */
export function generateUploadId() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      /* fall through to the counter fallback */
    }
  }
  fallbackSeq += 1
  const stamp = typeof Date === 'function' ? Date.now().toString(36) : '0'
  const rnd = Math.random().toString(36).slice(2, 10)
  return `up-${stamp}-${fallbackSeq.toString(36)}-${rnd}`
}

// ---------------------------------------------------------------------------
// Browser-only image compression (guarded for Node import / test injection)
// ---------------------------------------------------------------------------

/** Raster formats we can re-encode to JPEG. SVG/AVIF-edge cases pass through. */
const RASTER_IMAGE_RE = /^image\/(jpeg|png|gif|webp|bmp|avif)$/i
const isRasterImage = (type) => typeof type === 'string' && RASTER_IMAGE_RE.test(type)
const isImageType = (type) => typeof type === 'string' && type.startsWith('image/')

function clamp01(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * Compress a raster image to a JPEG blob (quality ~0.85) scaled so its max
 * dimension is <= maxDim, plus a small JPEG thumbnail data URL (~256px).
 * Non-images and non-raster image types (e.g. image/svg+xml) pass through
 * untouched: `{ blob: file, thumbDataUrl: null }`.
 *
 * Browser-only APIs are used strictly inside this function and guarded, so the
 * module imports cleanly in Node; in a Node environment (no canvas / Image)
 * every file passes through unchanged. Decode/canvas failures reject (the task
 * wraps them in UploadError code COMPRESS_FAILED) so corrupt images surface as
 * upload failures rather than silently uploading raw bytes.
 *
 * @param {File} file - source file.
 * @param {{maxDim?:number, onProgress?:(fraction:number)=>void}} [opts]
 * @returns {Promise<{blob:File|Blob, thumbDataUrl:string|null}>}
 */
export async function compressImage(file, opts = {}) {
  const maxDim = Number.isFinite(opts.maxDim) && opts.maxDim > 0 ? opts.maxDim : 1280
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null

  const type = file && typeof file.type === 'string' ? file.type : ''
  if (!isImageType(type) || !isRasterImage(type)) {
    return { blob: file, thumbDataUrl: null }
  }

  const canRaster =
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.getContext === 'function'
  if (!canRaster) {
    // Node / no-canvas environment: degrade to pass-through (import-safe).
    return { blob: file, thumbDataUrl: null }
  }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  let srcW
  let srcH
  let drawSource
  let releaseSource = null

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    srcW = bitmap.width
    srcH = bitmap.height
    drawSource = (w, h) => ctx.drawImage(bitmap, 0, 0, w, h)
    releaseSource = () => {
      try {
        bitmap.close()
      } catch {
        /* bitmap already closed */
      }
    }
  } else {
    const img = await loadImageViaObjectUrl(file)
    srcW = img.naturalWidth || img.width
    srcH = img.naturalHeight || img.height
    drawSource = (w, h) => ctx.drawImage(img, 0, 0, w, h)
  }

  try {
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH))
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))

    canvas.width = w
    canvas.height = h
    if (onProgress) onProgress(0.3)
    ctx.fillStyle = '#fff' // JPEG has no alpha: white base for transparent PNGs
    ctx.fillRect(0, 0, w, h)
    drawSource(w, h)
    if (onProgress) onProgress(0.7)

    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85)
    const thumbDataUrl = makeThumbnailDataUrl(canvas, 256)
    if (onProgress) onProgress(1)
    return { blob, thumbDataUrl }
  } finally {
    if (releaseSource) releaseSource()
  }
}

/** Fallback image decoder for browsers without createImageBitmap. */
async function loadImageViaObjectUrl(file) {
  if (
    typeof Image !== 'function' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    throw new Error('Image decode is unavailable in this environment')
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = () => reject(new Error('Image decode failed'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** canvas.toBlob wrapped in a promise; rejects when the browser returns null. */
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Canvas toBlob returned null'))
    }, type, quality)
  })
}

/** Small JPEG data URL (~maxDim px) from the already-scaled main canvas. */
function makeThumbnailDataUrl(canvas, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height))
  const tw = Math.max(1, Math.round(canvas.width * scale))
  const th = Math.max(1, Math.round(canvas.height * scale))
  const thumb = document.createElement('canvas')
  thumb.width = tw
  thumb.height = th
  const tctx = thumb.getContext('2d')
  tctx.fillStyle = '#fff'
  tctx.fillRect(0, 0, tw, th)
  tctx.drawImage(canvas, 0, 0, tw, th)
  return thumb.toDataURL('image/jpeg', 0.7)
}

// ---------------------------------------------------------------------------
// Task runner (no dedupe) + F6 wrapper
// ---------------------------------------------------------------------------

const DEFAULT_MAX_DIM = 1280

/**
 * Read a Blob/File into a data URL (browser-only FileReader). Returns null when
 * FileReader is unavailable (plain-Node tests) or the read fails, so the real
 * uploader can fail fast instead of POSTing an empty body.
 * @param {Blob|File|null} blob
 * @returns {Promise<string|null>}
 */
function blobToDataUrl(blob) {
  if (typeof FileReader === 'undefined' || !blob) return Promise.resolve(null)
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

/**
 * Real S2 uploader factory (I-20/21): POST /api/uploads with the staged artifact
 * { kind, fileData, thumb, fileName }. The server stores the attachment (staged,
 * encrypted) and returns { id } — that id is the confirmed uploadId the send
 * pipeline uses. `apiFn` is injected (core/api.js api single point; auth token
 * injection + 401 handling live there). `encode` is injectable for Node tests.
 *
 * The server contract is JSON, not multipart: fileData/thumb are data URLs, so
 * the staged blob is re-encoded to a data URL before POSTing.
 *
 * A 2xx response without an `id` is treated as a staging failure (UploadError
 * STAGE_FAILED), never a silent fallback to the client uploadId — a client id is
 * not present in the server uploads table, so the later send would 404. api()
 * throws on non-2xx, so reaching this line means the server acknowledged but
 * failed to assign an id (an honest cap).
 *
 * @param {(path:string, opts:object) => Promise<object>} apiFn
 * @param {(blob:Blob|File|null) => Promise<string|null>} [encode] data-URL encoder
 * @returns {(artifact:object, uploadId:string, onProgress?:Function) => Promise<string>}
 *   The uploader returns the server upload id (string) on success.
 * @throws {UploadError} code STAGE_FAILED when the 2xx response has no id.
 */
export function createRealUploader(apiFn, encode = blobToDataUrl) {
  return async function realUploader(artifact, uploadId, onProgress) {
    const fileData = await encode(artifact && artifact.blob)
    if (!fileData) throw new UploadError('Upload encode failed', { code: 'ENCODE_FAILED' })
    const resp = await apiFn('/uploads', {
      method: 'POST',
      body: {
        kind: artifact && artifact.kind,
        fileData,
        thumb: (artifact && artifact.thumbDataUrl) || '',
        fileName: artifact && artifact.name,
      },
    })
    if (typeof onProgress === 'function') onProgress(1)
    if (!resp || resp.id == null) {
      throw new UploadError('Upload response missing server id', { code: 'STAGE_FAILED' })
    }
    return String(resp.id)
  }
}

/**
 * Create a single attachment staging task WITHOUT dedupe. Exposed so tests can
 * prove the F6 wrapper in `stageAttachment` is load-bearing (two bare tasks for
 * the same file yield two uploadIds), and as the core used by the wrapper.
 *
 * The task begins synchronously: by the time it returns, state.status is
 * 'preparing' and the returned uploadId is already assigned.
 *
 * @param {File} file
 * @param {{onProgress?:Function, compressImage?:Function,
 *          uploader?:Function, maxDim?:number}} [opts]
 *   uploader is required for a real stage; omitting it fails fast with
 *   UploadError UPLOADER_NOT_WIRED (never a fake success).
 * @returns {{uploadId:string, promise:Promise, cancel:Function, state:object}}
 *   - promise resolves `{ uploadId, kind, name, body, thumb }` (done).
 *   - promise rejects `CancelledError` on cancel, `UploadError` on failure.
 *   - `state` is the reactive-ish state object for progress/status binding.
 */
export function createStageTask(file, opts = {}) {
  const {
    onProgress,
    compressImage: compress = compressImage,
    uploader,
    maxDim = DEFAULT_MAX_DIM,
  } = opts

  const key = fileIdentity(file)
  const uploadId = generateUploadId()
  const state = createStageState(key)

  let resolvePromise
  let rejectPromise
  let settled = false
  let cancelled = false

  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  /** Drive the state machine progress event and the user-facing callback. */
  function emit(progress) {
    transitionStage(state, { type: 'progress', progress })
    if (typeof onProgress === 'function') {
      try {
        onProgress(progress)
      } catch (err) {
        // A UI-side progress callback must never fail the pipeline (E2);
        // surface it so it is not silently lost.
        // eslint-disable-next-line no-console
        console.error('[upload] onProgress callback threw', err)
      }
    }
  }

  function checkCancelled() {
    if (cancelled) throw new CancelledError()
  }

  /**
   * Abort the in-flight task. Idempotent: after the task settles, cancel() is a
   * no-op. Rejects `promise` with a CancelledError.
   */
  function cancel() {
    if (settled) return
    cancelled = true
    settled = true
    transitionStage(state, { type: 'cancel' })
    rejectPromise(new CancelledError())
  }

  async function run() {
    try {
      if (!file) throw new UploadError('No file provided', { code: 'NO_FILE' })
      if (typeof uploader !== 'function') {
        throw new UploadError('No uploader wired', { code: 'UPLOADER_NOT_WIRED' })
      }

      transitionStage(state, { type: 'begin', uploadId, fileKey: key })
      emit(0)
      checkCancelled()

      let blob
      let thumbDataUrl
      try {
        const compressed = await compress(file, {
          maxDim,
          onProgress: (f) => emit(Math.round(clamp01(f) * 60)),
        })
        blob = compressed && compressed.blob ? compressed.blob : file
        thumbDataUrl = compressed && compressed.thumbDataUrl != null ? compressed.thumbDataUrl : null
      } catch (err) {
        throw new UploadError('Image compression failed', { code: 'COMPRESS_FAILED', cause: err })
      }
      checkCancelled()

      transitionStage(state, { type: 'compress-done', blob, thumbDataUrl })
      emit(60)

      const kind = isImageType(file && file.type) ? 'image' : 'file'
      const name = file && typeof file.name === 'string' && file.name ? file.name : 'attachment'
      let confirmedUploadId
      try {
        confirmedUploadId = await uploader(
          { blob, thumbDataUrl, kind, name },
          uploadId,
          (f) => emit(60 + Math.round(clamp01(f) * 40)),
        )
      } catch (err) {
        if (err instanceof CancelledError) throw err
        throw new UploadError('Upload staging failed', { code: 'STAGE_FAILED', cause: err })
      }
      checkCancelled()

      const result = { uploadId: confirmedUploadId, kind, name, body: blob, thumb: thumbDataUrl }
      transitionStage(state, { type: 'staged', result })
      emit(100)
      settled = true
      resolvePromise(result)
    } catch (err) {
      if (settled) return
      settled = true
      if (cancelled || err instanceof CancelledError) {
        if (state.status !== 'cancelled') transitionStage(state, { type: 'cancel' })
        rejectPromise(err instanceof CancelledError ? err : new CancelledError())
        return
      }
      transitionStage(state, { type: 'fail', error: err })
      rejectPromise(err)
    }
  }

  // Begin synchronously so `begin`/`emit(0)` run before the caller receives the
  // task; the first `await` yields control back to the event loop.
  run()

  return { uploadId, promise, cancel, state }
}

/** Module-scoped in-flight map for F6 dedupe: fileKey -> task. */
const inflight = new Map()

/**
 * Stage an attachment with F6 busy discipline: while a task for the same file
 * (name+size+lastModified identity) is in flight, a second call is a no-op that
 * returns the same task (same uploadId, single uploader invocation). The
 * in-flight entry is released once the task settles, so a later call for the
 * same file starts fresh. Options passed on a deduped call are ignored — the
 * first task owns the file.
 *
 * @param {File} file
 * @param {object} [opts] - see createStageTask.
 * @returns {{uploadId:string, promise:Promise, cancel:Function, state:object}}
 */
export function stageAttachment(file, opts = {}) {
  const key = fileIdentity(file)
  const existing = inflight.get(key)
  if (existing) return existing
  const task = createStageTask(file, opts)
  inflight.set(key, task)
  task.promise.then(
    () => {
      inflight.delete(key)
    },
    () => {
      inflight.delete(key)
    },
  )
  return task
}
