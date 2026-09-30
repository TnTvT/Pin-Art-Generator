export interface HeightMap {
  heights: Float32Array;
  minimum: number;
  maximum: number;
}

export function fitImage(sourceWidth: number, sourceHeight: number, footprintWidth: number, footprintDepth: number, columns: number, rows: number) {
  const scale = Math.min(footprintWidth / sourceWidth, footprintDepth / sourceHeight);
  const width = sourceWidth * scale / footprintWidth * columns;
  const height = sourceHeight * scale / footprintDepth * rows;
  return { x: (columns - width) / 2, y: (rows - height) / 2, width, height };
}

export function pixelsToHeights(pixels: Uint8ClampedArray, columns: number, rows: number, minimum: number, maximum: number, invert: boolean): HeightMap {
  const heights = new Float32Array(columns * rows);
  let shortest = Infinity;
  let longest = -Infinity;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const pixelOffset = ((rows - 1 - row) * columns + column) * 4;
      const brightness = (0.2126 * pixels[pixelOffset] + 0.7152 * pixels[pixelOffset + 1] + 0.0722 * pixels[pixelOffset + 2]) / 255;
      const amount = invert ? brightness : 1 - brightness;
      const height = minimum + amount * (maximum - minimum);
      heights[row * columns + column] = height;
      shortest = Math.min(shortest, height);
      longest = Math.max(longest, height);
    }
  }
  return { heights, minimum: shortest, maximum: longest };
}
