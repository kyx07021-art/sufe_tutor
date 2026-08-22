/**
 * relations/data.js - M3-01 relations data access layer
 * -----------------------------------------------------
 * - Parses the I-15 `GET /api/my-relations` payload into the shared M3 node/edge
 *   model. Shape validation is fail-closed: any payload that does not match the
 *   I-15 contract throws a `RelationsShapeError` with an English message.
 * - `fetchMyRelations` routes HTTP through the single shared `api()` point
 *   (core/api.js), keeping this module a pure data layer.
 * - Pure ESM, zero side effects at import. English comments only.
 */

import { api as defaultApi } from '../../core/api.js'

/** Set of raw conversation statuses accepted by the I-15 contract. */
export const ALLOWED_CONV_STATUSES = new Set(['active', 'closed', 'init', 'sent', 'formal'])

/**
 * Error thrown when the /api/my-relations payload does not match the I-15 shape.
 * @extends Error
 */
export class RelationsShapeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RelationsShapeError'
  }
}

/** True for plain objects (not arrays, not null). */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True for strictly positive integers. */
function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

/**
 * Private assertion gate: throws `RelationsShapeError` when the condition fails.
 * @param {boolean} condition
 * @param {string} message
 * @throws {RelationsShapeError}
 */
function assertShape(condition, message) {
  if (!condition) {
    throw new RelationsShapeError(message)
  }
}

/**
 * Map a raw conversation status to the node display state.
 * `init` / `sent` / `formal` / `active` all display as 'active'; only `closed`
 * displays as 'closed'.
 * @param {string} status
 * @returns {'active' | 'closed'}
 */
function toDisplayStatus(status) {
  return status === 'closed' ? 'closed' : 'active'
}

/**
 * Validate a single relation row against the I-15 contract and extract its
 * session edge plus the signing payload carried through for M4.
 * @param {unknown} relation
 * @param {number} index - position in the relations array, used in error messages
 * @returns {{ edge: object, signing: object | null }}
 * @throws {RelationsShapeError}
 */
function parseRelation(relation, index) {
  const at = `relation[${index}]`
  assertShape(isPlainObject(relation), `M3-01 shape error: ${at} is not a plain object`)

  const { conversationId, status, tempStatus, last, signing, other } = relation

  assertShape(
    isPositiveInteger(conversationId),
    `M3-01 shape error: ${at}.conversationId must be a positive integer`,
  )
  assertShape(
    typeof status === 'string' && ALLOWED_CONV_STATUSES.has(status),
    `M3-01 shape error: ${at}.status must be one of: ${[...ALLOWED_CONV_STATUSES].join(', ')}`,
  )

  // Optional fields: undefined/null are allowed; when present they must match
  // their declared type. `tempInitiatorId` is intentionally not type-checked
  // (I-15 marks it optional and this round does not consume it).
  assertShape(
    tempStatus === undefined || tempStatus === null || typeof tempStatus === 'string',
    `M3-01 shape error: ${at}.tempStatus must be string|null`,
  )
  assertShape(
    last === undefined || last === null || isPlainObject(last),
    `M3-01 shape error: ${at}.last must be object|null`,
  )
  assertShape(
    signing === undefined || signing === null || isPlainObject(signing),
    `M3-01 shape error: ${at}.signing must be object|null`,
  )

  assertShape(isPlainObject(other), `M3-01 shape error: ${at}.other must be a plain object`)
  const { id, role, name, avatar } = other
  assertShape(isPositiveInteger(id), `M3-01 shape error: ${at}.other.id must be a positive integer`)
  assertShape(
    role === 'student' || role === 'teacher',
    `M3-01 shape error: ${at}.other.role must be 'student' or 'teacher'`,
  )
  assertShape(
    typeof name === 'string' && name.trim().length > 0,
    `M3-01 shape error: ${at}.other.name must be a non-empty string`,
  )
  assertShape(
    avatar === undefined || avatar === null || typeof avatar === 'string',
    `M3-01 shape error: ${at}.other.avatar must be a string`,
  )

  const edge = {
    conversationId,
    status: toDisplayStatus(status),
    tempStatus: tempStatus ?? null,
    last: last ?? null,
    other: { id, role, name, avatar: avatar ?? '' },
  }
  return { edge, signing: signing ?? null }
}

/**
 * Parse a `GET /api/my-relations` response payload into the M3 shared model.
 *
 * Each relation row becomes one session edge. Edges are aggregated by
 * `other.id` into nodes: edges concatenated, `hasContract` OR-ed, `contract`
 * set to the first non-null signing, `last` set to the most recent non-null
 * last, and the node status is 'active' while any merged edge is active.
 * Nodes preserve first-seen order of `other.id`.
 *
 * An empty relations array is valid and yields `{ nodes: [], edges: [], total: 0 }`.
 *
 * @param {unknown} payload - the raw API response body
 * @returns {{ nodes: object[], edges: object[], total: number }}
 * @throws {RelationsShapeError} when the payload violates the I-15 shape
 */
export function parseMyRelations(payload) {
  assertShape(isPlainObject(payload), 'M3-01 shape error: payload is not a plain object')
  const { relations } = payload
  assertShape(Array.isArray(relations), 'M3-01 shape error: payload.relations is not an array')

  const nodes = []
  const edges = []
  const nodeByKey = new Map()

  relations.forEach((relation, index) => {
    const { edge, signing } = parseRelation(relation, index)
    edges.push(edge)

    const key = `o:${edge.other.id}`
    let node = nodeByKey.get(key)
    if (!node) {
      node = {
        userId: edge.other.id,
        role: edge.other.role,
        name: edge.other.name,
        avatar: edge.other.avatar,
        status: edge.status,
        edges: [],
        edgeCount: 0,
        hasContract: false,
        contract: null,
        last: null,
      }
      nodeByKey.set(key, node)
      nodes.push(node)
    }

    node.edges.push(edge)
    node.edgeCount = node.edges.length
    if (edge.status === 'active') node.status = 'active'
    if (signing) {
      node.hasContract = true
      if (node.contract === null) node.contract = signing
    }
    if (edge.last !== null) node.last = edge.last
  })

  return { nodes, edges, total: relations.length }
}

/**
 * Fetch the current user's relations and parse them into the M3 shared model.
 *
 * @param {(path: string, options?: object) => Promise<object>} [apiFn] - fetch
 *   function; defaults to the shared `api()` from core/api.js
 * @returns {Promise<{ nodes: object[], edges: object[], total: number }>}
 * @throws {RelationsShapeError} when the response violates the I-15 shape
 */
export async function fetchMyRelations(apiFn = defaultApi) {
  const result = await apiFn('/my-relations', { method: 'GET', auth: true })
  return parseMyRelations(result)
}
