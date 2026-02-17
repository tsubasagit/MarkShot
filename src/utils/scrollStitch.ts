/**
 * Scroll capture stitching utilities.
 * Takes an array of captured frames and produces a single tall image.
 */

/** Compute a simple fingerprint of a frame's pixel row for quick comparison */
function rowFingerprint(
  data: Uint8ClampedArray,
  width: number,
  y: number
): number {
  let hash = 0
  const stride = width * 4
  const offset = y * stride
  // Sample every 8th pixel for speed
  for (let x = 0; x < width; x += 8) {
    const i = offset + x * 4
    hash = (hash * 31 + data[i] + data[i + 1] + data[i + 2]) | 0
  }
  return hash
}

/** Compute a frame fingerprint from sampled rows */
function frameFingerprint(imageData: ImageData): number {
  const { data, width, height } = imageData
  let hash = 0
  // Sample 5 rows across the frame
  for (let i = 0; i < 5; i++) {
    const y = Math.floor((height * i) / 5)
    hash = (hash * 31 + rowFingerprint(data, width, y)) | 0
  }
  return hash
}

/** Remove duplicate (identical) frames */
export function removeDuplicateFrames(frames: ImageData[]): ImageData[] {
  if (frames.length === 0) return []
  const result: ImageData[] = [frames[0]]
  let prevFP = frameFingerprint(frames[0])

  for (let i = 1; i < frames.length; i++) {
    const fp = frameFingerprint(frames[i])
    if (fp !== prevFP) {
      result.push(frames[i])
      prevFP = fp
    }
  }
  return result
}

/** MSE between two rows */
function rowMSE(
  a: Uint8ClampedArray,
  aWidth: number,
  aY: number,
  b: Uint8ClampedArray,
  bWidth: number,
  bY: number
): number {
  const w = Math.min(aWidth, bWidth)
  let sum = 0
  const aOff = aY * aWidth * 4
  const bOff = bY * bWidth * 4
  // Sample every 4th pixel
  let count = 0
  for (let x = 0; x < w; x += 4) {
    const ai = aOff + x * 4
    const bi = bOff + x * 4
    const dr = a[ai] - b[bi]
    const dg = a[ai + 1] - b[bi + 1]
    const db = a[ai + 2] - b[bi + 2]
    sum += dr * dr + dg * dg + db * db
    count++
  }
  return count > 0 ? sum / (count * 3) : Infinity
}

/**
 * Detect how many pixels from the bottom of frameA overlap with
 * the top of frameB. Returns the overlap in pixels.
 */
export function detectOverlap(a: ImageData, b: ImageData): number {
  const maxOverlap = Math.floor(Math.min(a.height, b.height) * 0.8)
  const MSE_THRESHOLD = 50 // allow some compression noise
  const MIN_CHECK_ROWS = 5

  let bestOverlap = 0
  let bestMSE = Infinity

  // Try overlaps from large to small (prefer larger overlaps for better matches)
  for (let overlap = maxOverlap; overlap >= MIN_CHECK_ROWS; overlap -= 2) {
    let totalMSE = 0
    let checks = 0
    let bad = false

    // Check sampled rows in the overlap region
    const step = Math.max(1, Math.floor(overlap / 10))
    for (let row = 0; row < overlap; row += step) {
      const aY = a.height - overlap + row
      const bY = row
      const mse = rowMSE(a.data, a.width, aY, b.data, b.width, bY)
      totalMSE += mse
      checks++
      if (mse > MSE_THRESHOLD * 4) {
        bad = true
        break
      }
    }

    if (bad) continue

    const avgMSE = checks > 0 ? totalMSE / checks : Infinity
    if (avgMSE < MSE_THRESHOLD && avgMSE < bestMSE) {
      bestMSE = avgMSE
      bestOverlap = overlap
      // Good enough match found
      if (avgMSE < 20) break
    }
  }

  return bestOverlap
}

/**
 * Stitch all frames vertically into one tall image.
 * Returns a data URL of the stitched image.
 */
export function stitchFrames(frames: ImageData[]): string {
  if (frames.length === 0) return ''
  if (frames.length === 1) {
    const c = document.createElement('canvas')
    c.width = frames[0].width
    c.height = frames[0].height
    c.getContext('2d')!.putImageData(frames[0], 0, 0)
    return c.toDataURL('image/png')
  }

  // Compute overlaps between consecutive frames
  const overlaps: number[] = []
  for (let i = 0; i < frames.length - 1; i++) {
    overlaps.push(detectOverlap(frames[i], frames[i + 1]))
  }

  // Calculate total height
  const width = frames[0].width
  let totalHeight = frames[0].height
  for (let i = 1; i < frames.length; i++) {
    totalHeight += frames[i].height - overlaps[i - 1]
  }

  // Create output canvas
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = totalHeight
  const ctx = canvas.getContext('2d')!

  // Draw frames
  let y = 0
  for (let i = 0; i < frames.length; i++) {
    // Create a temp canvas for each frame
    const tmp = document.createElement('canvas')
    tmp.width = frames[i].width
    tmp.height = frames[i].height
    tmp.getContext('2d')!.putImageData(frames[i], 0, 0)

    if (i === 0) {
      ctx.drawImage(tmp, 0, 0)
      y += frames[i].height
    } else {
      const overlap = overlaps[i - 1]
      y -= overlap
      ctx.drawImage(tmp, 0, y)
      y += frames[i].height
    }
  }

  return canvas.toDataURL('image/png')
}
