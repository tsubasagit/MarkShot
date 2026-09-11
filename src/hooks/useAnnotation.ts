import { useState, useCallback } from 'react'

export type ToolType =
  | 'select'
  | 'pen'
  | 'text'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'mosaic'
  | 'step'    // numbered step markers (1, 2, 3...)
  | 'badge'   // OK / NG / WARNING badges

export type BadgeKind = 'OK' | 'NG' | 'WARN' | 'INFO' | 'BUG'

export interface PenAnnotation {
  type: 'pen'
  id: string
  points: number[]
  color: string
  strokeWidth: number
}

export interface TextAnnotation {
  type: 'text'
  id: string
  x: number
  y: number
  text: string
  fontSize: number
  color: string
}

export interface ArrowAnnotation {
  type: 'arrow'
  id: string
  points: [number, number, number, number]
  color: string
  strokeWidth: number
}

export interface RectAnnotation {
  type: 'rect'
  id: string
  x: number
  y: number
  width: number
  height: number
  color: string
  strokeWidth: number
}

export interface EllipseAnnotation {
  type: 'ellipse'
  id: string
  x: number
  y: number
  radiusX: number
  radiusY: number
  color: string
  strokeWidth: number
}

export interface MosaicAnnotation {
  type: 'mosaic'
  id: string
  x: number
  y: number
  width: number
  height: number
  pixelSize: number
}

export interface StepAnnotation {
  type: 'step'
  id: string
  x: number
  y: number
  number: number
  color: string
}

export interface BadgeAnnotation {
  type: 'badge'
  id: string
  x: number
  y: number
  kind: BadgeKind
}

export type Annotation =
  | PenAnnotation
  | TextAnnotation
  | ArrowAnnotation
  | RectAnnotation
  | EllipseAnnotation
  | MosaicAnnotation
  | StepAnnotation
  | BadgeAnnotation

let nextId = 1
export function generateId(): string {
  return `ann-${nextId++}-${Date.now()}`
}

export function useAnnotation() {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [history, setHistory] = useState<Annotation[][]>([[]])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [stepCounter, setStepCounter] = useState(1)

  const pushState = useCallback(
    (newAnnotations: Annotation[]) => {
      const MAX_HISTORY = 50
      let newHistory = history.slice(0, historyIndex + 1)
      newHistory.push(newAnnotations)
      if (newHistory.length > MAX_HISTORY) {
        newHistory = newHistory.slice(newHistory.length - MAX_HISTORY)
      }
      setHistory(newHistory)
      setHistoryIndex(newHistory.length - 1)
      setAnnotations(newAnnotations)
    },
    [history, historyIndex]
  )

  const addAnnotation = useCallback(
    (annotation: Annotation) => {
      const newAnnotations = [...annotations, annotation]
      pushState(newAnnotations)
      if (annotation.type === 'step') {
        setStepCounter((c) => c + 1)
      }
    },
    [annotations, pushState]
  )

  const updateAnnotation = useCallback(
    (id: string, updates: Partial<Annotation>) => {
      const newAnnotations = annotations.map((ann) =>
        ann.id === id ? ({ ...ann, ...updates } as Annotation) : ann
      )
      pushState(newAnnotations)
    },
    [annotations, pushState]
  )

  const removeAnnotation = useCallback(
    (id: string) => {
      const newAnnotations = annotations.filter((ann) => ann.id !== id)
      pushState(newAnnotations)
    },
    [annotations, pushState]
  )

  // Stage のサイズが変わると、stage 座標で保持している注釈だけが
  // 背景画像からズレる。履歴ごと一括で拡大縮小して整合を保つ。
  // モザイクの pixelSize だけは原寸ピクセル基準なので倍率をかけない。
  const scaleAll = useCallback((factor: number) => {
    if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-6) return
    const f = (v: number) => v * factor
    const scaleOne = (ann: Annotation): Annotation => {
      switch (ann.type) {
        case 'pen':
          return { ...ann, points: ann.points.map(f), strokeWidth: f(ann.strokeWidth) }
        case 'arrow':
          return {
            ...ann,
            points: ann.points.map(f) as [number, number, number, number],
            strokeWidth: f(ann.strokeWidth),
          }
        case 'text':
          return { ...ann, x: f(ann.x), y: f(ann.y), fontSize: f(ann.fontSize) }
        case 'rect':
          return {
            ...ann,
            x: f(ann.x),
            y: f(ann.y),
            width: f(ann.width),
            height: f(ann.height),
            strokeWidth: f(ann.strokeWidth),
          }
        case 'ellipse':
          return {
            ...ann,
            x: f(ann.x),
            y: f(ann.y),
            radiusX: f(ann.radiusX),
            radiusY: f(ann.radiusY),
            strokeWidth: f(ann.strokeWidth),
          }
        case 'mosaic':
          return { ...ann, x: f(ann.x), y: f(ann.y), width: f(ann.width), height: f(ann.height) }
        case 'step':
        case 'badge':
          return { ...ann, x: f(ann.x), y: f(ann.y) }
        default:
          return ann
      }
    }
    setAnnotations((prev) => (prev.length ? prev.map(scaleOne) : prev))
    setHistory((prev) => prev.map((list) => list.map(scaleOne)))
  }, [])

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      setAnnotations(history[newIndex])
    }
  }, [history, historyIndex])

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      setAnnotations(history[newIndex])
    }
  }, [history, historyIndex])

  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1

  return {
    annotations,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    scaleAll,
    undo,
    redo,
    canUndo,
    canRedo,
    stepCounter,
    resetStepCounter: () => setStepCounter(1),
  }
}
