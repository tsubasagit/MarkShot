/**
 * 範囲選択の判定ロジック（Snipping Tool 方式）
 * テストで毎回同じ入力に対して同じ結果になることを検証するため純粋関数として抽出
 */

export const MIN_SIZE_PX = 20
export const DRAG_START_THRESHOLD_PX = 5

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface SelectionState {
  pointerDown: Point | null
  isDragging: boolean
  startPos: Point
  currentEnd: Point
}

const emptyState: SelectionState = {
  pointerDown: null,
  isDragging: false,
  startPos: { x: 0, y: 0 },
  currentEnd: { x: 0, y: 0 },
}

function dist(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

/** 初期状態 */
export function createInitialState(): SelectionState {
  return { ...emptyState }
}

/** リセット（2回目以降のキャプチャ用・同じ動作を保証） */
export function resetState(_state: SelectionState): SelectionState {
  return createInitialState()
}

/** ポインタダウン */
export function onPointerDown(state: SelectionState, pt: Point): SelectionState {
  if (state.isDragging) return state
  return {
    ...state,
    pointerDown: { ...pt },
    startPos: { ...pt },
    currentEnd: { ...pt },
  }
}

/** ポインタ移動 */
export function onPointerMove(state: SelectionState, pt: Point): SelectionState {
  const next = { ...state, currentEnd: { ...pt } }
  if (state.pointerDown !== null && !state.isDragging) {
    const d = dist(state.pointerDown, pt)
    if (d >= DRAG_START_THRESHOLD_PX) {
      next.isDragging = true
      next.pointerDown = null
      next.startPos = { ...state.pointerDown }
      next.currentEnd = { ...pt }
    }
    return next
  }
  if (state.isDragging) {
    next.currentEnd = { ...pt }
    return next
  }
  return next
}

/** ポインタアップ時の結果: 送信する矩形があれば返す */
export function onPointerUp(state: SelectionState): { send: true; rect: Rect } | { send: false } {
  if (state.pointerDown !== null && !state.isDragging) {
    return { send: false }
  }
  if (!state.isDragging) return { send: false }
  const x = Math.min(state.startPos.x, state.currentEnd.x)
  const y = Math.min(state.startPos.y, state.currentEnd.y)
  const w = Math.abs(state.currentEnd.x - state.startPos.x)
  const h = Math.abs(state.currentEnd.y - state.startPos.y)
  if (w < MIN_SIZE_PX || h < MIN_SIZE_PX) return { send: false }
  return { send: true, rect: { x, y, w, h } }
}

/**
 * 1回の「キャプチャ」を同じイベント列で実行した結果が毎回同じか検証するための実行関数
 */
export function runOneCaptureSequence(): { send: boolean; rect?: Rect } {
  let state = createInitialState()
  state = onPointerDown(state, { x: 100, y: 100 })
  state = onPointerMove(state, { x: 110, y: 110 })
  state = onPointerMove(state, { x: 200, y: 200 })
  const result = onPointerUp(state)
  return result.send ? { send: true, rect: result.rect } : { send: false }
}

/**
 * クリックのみ（ドラッグなし）の場合は送信しない
 */
export function runClickOnlySequence(): { send: boolean } {
  let state = createInitialState()
  state = onPointerDown(state, { x: 100, y: 100 })
  const result = onPointerUp(state)
  return { send: result.send }
}
