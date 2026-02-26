import { describe, it, expect } from 'vitest'
import {
  createInitialState,
  resetState,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  runOneCaptureSequence,
  runClickOnlySequence,
  MIN_SIZE_PX,
} from './regionSelectionLogic'

const ITERATIONS = 1000

describe('regionSelectionLogic', () => {
  it(`ドラッグで範囲選択 → 送信が ${ITERATIONS} 回とも同じ結果になる`, () => {
    const results: Array<{ send: boolean; rect?: { x: number; y: number; w: number; h: number } }> = []
    for (let i = 0; i < ITERATIONS; i++) {
      results.push(runOneCaptureSequence())
    }
    const first = results[0]
    expect(first.send).toBe(true)
    expect(first.rect).toEqual({ x: 100, y: 100, w: 100, h: 100 })
    for (let i = 1; i < ITERATIONS; i++) {
      expect(results[i].send).toBe(first.send)
      expect(results[i].rect).toEqual(first.rect)
    }
  })

  it(`クリックのみ → 送信しないが ${ITERATIONS} 回とも同じ結果になる`, () => {
    const results: Array<{ send: boolean }> = []
    for (let i = 0; i < ITERATIONS; i++) {
      results.push(runClickOnlySequence())
    }
    for (let i = 0; i < ITERATIONS; i++) {
      expect(results[i].send).toBe(false)
    }
  })

  it(`1回目と2回目で同じイベント列を実行すると毎回同じ結果（${ITERATIONS} セッション）`, () => {
    const runTwoCaptures = () => {
      let state = createInitialState()
      state = onPointerDown(state, { x: 100, y: 100 })
      state = onPointerMove(state, { x: 150, y: 150 })
      state = onPointerMove(state, { x: 220, y: 220 })
      const result1 = onPointerUp(state)

      state = resetState(state)
      state = onPointerDown(state, { x: 100, y: 100 })
      state = onPointerMove(state, { x: 150, y: 150 })
      state = onPointerMove(state, { x: 220, y: 220 })
      const result2 = onPointerUp(state)

      return { result1, result2 }
    }

    for (let i = 0; i < ITERATIONS; i++) {
      const { result1, result2 } = runTwoCaptures()
      expect(result1.send).toBe(true)
      expect(result2.send).toBe(true)
      if (result1.send && result2.send) {
        expect(result1.rect).toEqual(result2.rect)
        expect(result1.rect).toEqual({ x: 100, y: 100, w: 120, h: 120 })
      }
    }
  })

  it('最小サイズ未満の矩形は送信しない', () => {
    let state = createInitialState()
    state = onPointerDown(state, { x: 100, y: 100 })
    state = onPointerMove(state, { x: 100 + MIN_SIZE_PX - 1, y: 100 })
    const r = onPointerUp(state)
    expect(r.send).toBe(false)
  })

  const CONSECUTIVE_RUNS = 200
  it(`連続キャプチャ ${CONSECUTIVE_RUNS} 回で毎回同じ結果（reset → ドラッグ → 確定）`, () => {
    const results: Array<{ send: boolean; rect?: { x: number; y: number; w: number; h: number } }> = []
    for (let run = 0; run < CONSECUTIVE_RUNS; run++) {
      let state = createInitialState()
      state = resetState(state)
      state = onPointerDown(state, { x: 50, y: 50 })
      state = onPointerMove(state, { x: 60, y: 60 })
      state = onPointerMove(state, { x: 150, y: 150 })
      const r = onPointerUp(state)
      results.push(r.send && r.rect ? { send: true, rect: r.rect } : { send: false })
    }
    expect(results.every((r) => r.send)).toBe(true)
    const first = results[0]
    expect(first.rect).toEqual({ x: 50, y: 50, w: 100, h: 100 })
    for (let i = 1; i < CONSECUTIVE_RUNS; i++) {
      expect(results[i].rect).toEqual(first.rect)
    }
  })

  const BUG_CHECK_RUNS = 100
  it(`バグチェック ${BUG_CHECK_RUNS} 回: 毎回 reset 後に異なるドラッグで同じ論理結果`, () => {
    for (let run = 0; run < BUG_CHECK_RUNS; run++) {
      const sx = 100 + (run % 10) * 20
      const sy = 100 + Math.floor(run / 10) * 15
      const ex = sx + 80
      const ey = sy + 80
      let state = createInitialState()
      state = resetState(state)
      state = onPointerDown(state, { x: sx, y: sy })
      state = onPointerMove(state, { x: sx + 5, y: sy + 5 })
      state = onPointerMove(state, { x: ex, y: ey })
      const r = onPointerUp(state)
      expect(r.send).toBe(true)
      if (r.send && r.rect) {
        expect(r.rect.x).toBe(Math.min(sx, ex))
        expect(r.rect.y).toBe(Math.min(sy, ey))
        expect(r.rect.w).toBe(80)
        expect(r.rect.h).toBe(80)
      }
    }
  })
})
