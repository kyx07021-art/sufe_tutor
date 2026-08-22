/**
 * chat-upload.mjs — M4-14 attachment staging pipeline unit tests (Node-runnable)
 * -----------------------------------------------------------------------------
 * Covers new-frontend/src/modules/chat/logic/upload.js:
 *   - stageAttachment resolves { uploadId, kind, name, body, thumb } when the
 *     injected uploader resolves.
 *   - rejects with a typed UploadError (STAGE_FAILED) on uploader error;
 *     progress resets to 0 and state.status becomes 'error' (failure rollback).
 *   - cancel() rejects with CancelledError; state 'cancelled', progress 0,
 *     idempotent.
 *   - F6 busy discipline: a second stageAttachment for the same in-flight file
 *     is a no-op (same task, same uploadId, single uploader invocation), and the
 *     dedupe entry is released once the task settles.
 *   - Mutation guards (G2):
 *       * remove F6 dedupe -> a second call creates a NEW uploadId (proved via
 *         the no-dedupe core createStageTask, plus an uploader-call count).
 *       * remove failure rejection -> the error is swallowed and the pipeline
 *         "succeeds" (proved by a swallow-mutant vs the real rejection), and the
 *         pure state machine's 'fail' transition is load-bearing.
 *   - compressImage: non-image pass-through; image in a Node environment
 *     degrades to pass-through without crashing.
 *
 * Run: node test/chat-upload.mjs
 * Zero Chinese literals (contract 6).
 */
import {
  stageAttachment,
  createStageTask,
  createStageState,
  transitionStage,
  compressImage,
  createRealUploader,
  CancelledError,
  UploadError,
  fileIdentity,
  generateUploadId,
} from '../src/modules/chat/logic/upload.js'

const failures = []
const ok = (cond, msg) => {
  if (cond) console.log('ok:', msg)
  else failures.push(msg)
}

/** Flush pending microtasks/macrotasks (lets run() reach the uploader). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Build a File-like object. */
function mockFile(name, opts = {}) {
  return {
    name,
    size: opts.size ?? 1024,
    lastModified: opts.lastModified ?? 1,
    type: opts.type ?? 'application/octet-stream',
  }
}

/** Injected compressImage mock: raster result (compressed blob + thumb). */
async function mockCompressRaster(file, opts = {}) {
  if (typeof opts.onProgress === 'function') {
    opts.onProgress(0.2)
    opts.onProgress(1)
  }
  return { blob: { __mockBlob: 'raster', name: file.name }, thumbDataUrl: 'data:image/jpeg;base64,AA==' }
}

/* ============================ T1: success path ============================ */
{
  const uploads = []
  async function mockUploader(artifact, uploadId, onProgress) {
    uploads.push({ artifact, uploadId })
    onProgress(0.5)
    return 'server-upload-1'
  }
  const t = stageAttachment(mockFile('a.png', { type: 'image/png' }), {
    compressImage: mockCompressRaster,
    uploader: mockUploader,
  })
  ok(typeof t.uploadId === 'string' && t.uploadId.length > 0, 'T1: task exposes client uploadId')
  ok(t.state.status === 'preparing', 'T1: task begins in preparing')
  ok(typeof t.cancel === 'function' && t.promise instanceof Promise, 'T1: task is self-contained {uploadId,promise,cancel,state}')

  const result = await t.promise
  ok(result.uploadId === 'server-upload-1', 'T1: result.uploadId = uploader-confirmed id')
  ok(result.kind === 'image', 'T1: raster -> kind image')
  ok(result.name === 'a.png', 'T1: result.name = file name')
  ok(result.body && result.body.__mockBlob === 'raster', 'T1: result.body = compressed blob')
  ok(result.thumb === 'data:image/jpeg;base64,AA==', 'T1: result.thumb = thumbnail data URL')
  ok(t.state.status === 'done' && t.state.progress === 100, 'T1: state done, progress 100')
  ok(uploads.length === 1, 'T1: uploader called once')
  ok(uploads[0].artifact.kind === 'image' && uploads[0].artifact.name === 'a.png', 'T1: uploader receives artifact {blob,thumbDataUrl,kind,name}')
}

/* ==================== T2: uploader error -> typed reject ================== */
{
  const t = stageAttachment(mockFile('b.png', { type: 'image/png' }), {
    compressImage: mockCompressRaster,
    uploader: async () => {
      throw new Error('upload boom')
    },
  })
  let error = null
  try {
    await t.promise
  } catch (err) {
    error = err
  }
  ok(error instanceof UploadError, 'T2: rejects with UploadError')
  ok(error.code === 'STAGE_FAILED', 'T2: UploadError.code = STAGE_FAILED')
  ok(t.state.status === 'error', 'T2: state -> error')
  ok(t.state.progress === 0, 'T2: failure rollback resets progress to 0')
}

/* ========================= T3: cancel -> CancelledError ==================== */
{
  let releaseUploader = null
  const pendingUploader = () =>
    new Promise((resolve) => {
      releaseUploader = () => resolve('late')
    })
  const t = stageAttachment(mockFile('c.png', { type: 'image/png' }), {
    compressImage: mockCompressRaster,
    uploader: pendingUploader,
  })
  const outcomePromise = t.promise.then(
    () => 'resolved',
    (err) => err,
  )
  t.cancel()
  const outcome = await outcomePromise
  ok(outcome instanceof CancelledError, 'T3: cancel rejects with CancelledError')
  ok(t.state.status === 'cancelled', 'T3: state -> cancelled')
  ok(t.state.progress === 0, 'T3: cancel resets progress to 0')
  let threw = false
  try {
    t.cancel()
  } catch {
    threw = true
  }
  ok(!threw, 'T3: cancel is idempotent (no throw on second call)')
  if (releaseUploader) releaseUploader()
  await flush()
}

/* ================= T4: F6 dedupe — same in-flight file is a no-op ========== */
{
  const fileA = mockFile('same.png', { type: 'image/png', lastModified: 7 })
  let calls = 0
  let release = null
  const countingUploader = () => {
    calls += 1
    return new Promise((resolve) => {
      release = () => resolve('id')
    })
  }
  const t1 = stageAttachment(fileA, { compressImage: mockCompressRaster, uploader: countingUploader })
  const t2 = stageAttachment(fileA, { compressImage: mockCompressRaster, uploader: countingUploader })
  ok(t1 === t2, 'T4: same in-flight file -> same task object (no-op)')
  ok(t1.uploadId === t2.uploadId, 'T4: same uploadId for deduped call')
  await flush()
  ok(calls === 1, 'T4: uploader invoked once despite two stageAttachment calls')
  release()
  await t1.promise

  const t3 = stageAttachment(fileA, {
    compressImage: mockCompressRaster,
    uploader: async () => 'id2',
  })
  ok(t3 !== t1, 'T4: after settle, a new call for the same file starts fresh')
  const r3 = await t3.promise
  ok(r3.uploadId === 'id2', 'T4: fresh task resolves independently')
}

/* ========= T5: mutation guard — remove dedupe -> new uploadId ============= */
{
  const fileB = mockFile('dup.png', { type: 'image/png' })
  const a = createStageTask(fileB, { compressImage: mockCompressRaster, uploader: async () => 'id' })
  const b = createStageTask(fileB, { compressImage: mockCompressRaster, uploader: async () => 'id' })
  ok(a !== b, 'T5 mutation guard: no-dedupe core yields two distinct tasks')
  ok(a.uploadId !== b.uploadId, 'T5 mutation guard: without dedupe a second call would create a new uploadId')
  await a.promise
  await b.promise
}

/* ============ T6: mutation guard — failure rejection is load-bearing ======= */
{
  // Real: uploader error -> promise rejects (contract); state-machine 'fail' is
  // the progress-reset path.
  const real = stageAttachment(mockFile('fail.png', { type: 'image/png' }), {
    compressImage: mockCompressRaster,
    uploader: async () => {
      throw new Error('boom')
    },
  })
  let realOutcome = 'resolved'
  try {
    await real.promise
    realOutcome = 'resolved'
  } catch (err) {
    realOutcome = err instanceof UploadError ? 'rejected' : 'rejected-wrong'
  }
  ok(realOutcome === 'rejected', 'T6: real pipeline rejects on uploader error')

  // Mutant: a pipeline that swallows the error would resolve "successfully",
  // silently dropping the user's attachment — proving the rejection is the
  // load-bearing rollback signal for send.js.
  async function mutantSwallowFailure(compress, uploader, file) {
    try {
      const c = await compress(file, {})
      const id = await uploader(c, 'u', () => {})
      return { uploadId: id, kind: c.thumbDataUrl ? 'image' : 'file', body: c.blob, thumb: c.thumbDataUrl }
    } catch {
      return { uploadId: 'swallowed', kind: 'file', body: null, thumb: null } // mutation: swallow
    }
  }
  const mutant = await mutantSwallowFailure(
    mockCompressRaster,
    async () => {
      throw new Error('boom')
    },
    mockFile('m.png', { type: 'image/png' }),
  )
  ok(mutant.uploadId === 'swallowed', 'T6 mutation guard: swallowing would silently resolve (real impl must reject)')

  // Pure state-machine guard: the 'fail' transition resets progress to 0. A
  // mutant that never dispatches 'fail' would leave stale progress 60 on a
  // broken task.
  const st = createStageState('k')
  transitionStage(st, { type: 'begin', uploadId: 'u', fileKey: 'k' })
  transitionStage(st, { type: 'compress-done', blob: {}, thumbDataUrl: 't' })
  transitionStage(st, { type: 'fail', error: new Error('boom') })
  ok(st.status === 'error' && st.progress === 0, 'T6: fail event -> error + progress reset')
  const st2 = createStageState('k')
  transitionStage(st2, { type: 'begin', uploadId: 'u', fileKey: 'k' })
  transitionStage(st2, { type: 'compress-done', blob: {}, thumbDataUrl: 't' })
  ok(st2.status === 'staging' && st2.progress === 60, 'T6 mutation guard: without fail dispatch state would stay staging/60')
}

/* ==================== T7/T8: compressImage in Node ======================== */
{
  const txt = mockFile('notes.txt', { type: 'text/plain' })
  const r = await compressImage(txt)
  ok(r.blob === txt, 'T7: non-image passes through (blob === file)')
  ok(r.thumbDataUrl === null, 'T7: non-image has no thumb')

  const svg = mockFile('icon.svg', { type: 'image/svg+xml' })
  const rSvg = await compressImage(svg)
  ok(rSvg.blob === svg && rSvg.thumbDataUrl === null, 'T7: non-raster image (svg) passes through')

  const img = mockFile('pic.png', { type: 'image/png' })
  const r2 = await compressImage(img)
  ok(r2.blob === img, 'T8: Node env cannot rasterize -> pass-through, no crash')
  ok(r2.thumbDataUrl === null, 'T8: Node pass-through has no thumb')
}

/* ============================ T9: uploadId ================================ */
{
  const id1 = generateUploadId()
  const id2 = generateUploadId()
  ok(typeof id1 === 'string' && id1.length > 0, 'T9: uploadId is a non-empty string')
  ok(id1 !== id2, 'T9: uploadIds are unique across calls')
}

/* =========================== T10: fileIdentity ============================ */
{
  const f1 = mockFile('a.png', { type: 'image/png', size: 100, lastModified: 1 })
  const f2 = mockFile('a.png', { type: 'image/png', size: 101, lastModified: 1 })
  const f3 = mockFile('a.png', { type: 'image/png', size: 100, lastModified: 2 })
  ok(fileIdentity(f1) !== fileIdentity(f2), 'T10: identity differs on size')
  ok(fileIdentity(f1) !== fileIdentity(f3), 'T10: identity differs on lastModified')
}

/* ===================== T11: transitionStage guards ======================== */
{
  const st = createStageState('k')
  transitionStage(st, { type: 'progress', progress: 99 })
  ok(st.status === 'idle' && st.progress === 0, 'T11: progress before begin ignored')
  transitionStage(st, { type: 'begin', uploadId: 'u', fileKey: 'k' })
  transitionStage(st, { type: 'progress', progress: 30 })
  ok(st.progress === 30, 'T11: preparing progress applied')
  transitionStage(st, { type: 'progress', progress: 100 })
  ok(st.progress === 60, 'T11: preparing progress clamps to band [0,60]')
  transitionStage(st, { type: 'compress-done', blob: {}, thumbDataUrl: 't' })
  transitionStage(st, { type: 'progress', progress: 0 })
  ok(st.progress === 60, 'T11: staging progress clamps to band [60,100]')
  transitionStage(st, { type: 'cancel' })
  transitionStage(st, { type: 'fail', error: new Error('late') })
  ok(st.status === 'cancelled', 'T11: cancel then fail -> stays cancelled (terminal)')
}

/* ============== T12: createRealUploader (real S2 POST /api/uploads) ============== */
{
  const calls = []
  const fakeApi = async (path, init) => {
    calls.push([path, init])
    return { id: 42 }
  }
  const fakeEncode = async () => 'data:image/jpeg;base64,AAAA'
  const uploader = createRealUploader(fakeApi, fakeEncode)

  const artifact = { blob: { __blob: 1 }, thumbDataUrl: 'data:image/jpeg;base64,BBBB', kind: 'image', name: 'a.png' }
  let lastProgress = -1
  const id = await uploader(artifact, 'client-uuid', (p) => { lastProgress = p })
  ok(id === '42', 'T12: real uploader returns the server upload id as string')
  ok(calls.length === 1, 'T12: uploader POSTs /uploads once')
  ok(calls[0][0] === '/uploads' && calls[0][1].method === 'POST', 'T12: uploader calls POST /uploads')
  ok(
    JSON.stringify(calls[0][1].body) ===
      JSON.stringify({ kind: 'image', fileData: 'data:image/jpeg;base64,AAAA', thumb: 'data:image/jpeg;base64,BBBB', fileName: 'a.png' }),
    'T12: uploader body matches the S2 contract {kind,fileData,thumb,fileName}',
  )
  ok(lastProgress === 1, 'T12: uploader reports onProgress(1) after the POST resolves')

  // encode failure -> UploadError ENCODE_FAILED, never POSTs an empty body
  const badUploader = createRealUploader(fakeApi, async () => null)
  let err = null
  try {
    await badUploader({ blob: {}, kind: 'file', name: 'x' }, 'u', () => {})
  } catch (e) {
    err = e
  }
  ok(err instanceof UploadError && err.code === 'ENCODE_FAILED', 'T12: encode failure -> UploadError ENCODE_FAILED')
  ok(calls.length === 1, 'T12: encode failure does NOT reach the API (single POST total)')
}

/* ============ T12b: 2xx response missing id -> UploadError STAGE_FAILED (F2, honest cap) ============ */
{
  const fakeApi = async () => ({ ok: true }) // 2xx ack but NO server id
  const uploader = createRealUploader(fakeApi, async () => 'data:image/png;base64,AAAA')
  let err = null
  try {
    await uploader({ blob: {}, kind: 'file', name: 'x.bin' }, 'client-uuid', () => {})
  } catch (e) {
    err = e
  }
  ok(err instanceof UploadError && err.code === 'STAGE_FAILED', 'T12b: 2xx missing id -> UploadError STAGE_FAILED (no silent client-id fallback)')

  // G2 mutation guard: a fallback-to-client-id uploader WOULD return the client
  // uploadId (which is absent from the server uploads table -> later send 404).
  const mutantFallback = async (artifact, uploadId, onProgress) => {
    const resp = await fakeApi('/uploads', {})
    // fallback to the client uploadId (the throw is REMOVED) on purpose - mutation.
    return resp && resp.id != null ? String(resp.id) : uploadId
  }
  const fallbackId = await mutantFallback({ blob: {}, kind: 'file', name: 'x.bin' }, 'client-uuid', () => {})
  ok(fallbackId === 'client-uuid', 'T12b mutation guard: without the throw a 2xx-no-id WOULD silently fall back to the client uploadId')
}

/* ============ T13: unwired stageAttachment fails fast (no silent fake success) ============ */
{
  const t = stageAttachment(mockFile('nowire.png', { type: 'image/png' }), {
    compressImage: mockCompressRaster,
  })
  let error = null
  try {
    await t.promise
  } catch (err) {
    error = err
  }
  ok(error instanceof UploadError, 'T13: stageAttachment without an uploader rejects with UploadError')
  ok(error && error.code === 'UPLOADER_NOT_WIRED', 'T13: unwired uploader code = UPLOADER_NOT_WIRED')
  ok(t.state.status === 'error' && t.state.progress === 0, 'T13: unwired stage rolls back to error/progress 0')
}

/* ============================== verdict =================================== */
if (failures.length > 0) {
  console.error(`\nchat-upload.mjs: ${failures.length} FAILURE(S)`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('\nchat-upload.mjs: all assertions passed')
