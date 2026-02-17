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
      const newHistory = history.slice(0, historyIndex + 1)
      newHistory.push(newAnnotations)
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
    undo,
    redo,
    canUndo,
    canRedo,
    stepCounter,
    resetStepCounter: () => setStepCounter(1),
  }
}
