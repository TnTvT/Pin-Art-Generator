export async function createSampleImage(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image processing is unavailable in this browser.');
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let row = 0; row < canvas.height; row += 1) {
    for (let column = 0; column < canvas.width; column += 1) {
      const horizontal = column / canvas.width;
      const vertical = row / canvas.height;
      const peak = (centerX: number, centerY: number, spread: number) => Math.exp(-((horizontal - centerX) ** 2 + (vertical - centerY) ** 2) / spread);
      const elevation = Math.min(1, peak(0.35, 0.42, 0.025) * 0.9 + peak(0.66, 0.58, 0.04) * 0.85);
      const brightness = Math.round(255 * (1 - elevation));
      const pixelOffset = (row * canvas.width + column) * 4;
      pixels.data[pixelOffset] = brightness;
      pixels.data[pixelOffset + 1] = brightness;
      pixels.data[pixelOffset + 2] = brightness;
      pixels.data[pixelOffset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => {
    if (result) resolve(result);
    else reject(new Error('Could not create the sample image.'));
  }, 'image/png'));
  return new File([blob], 'Sample hills.png', { type: 'image/png' });
}
