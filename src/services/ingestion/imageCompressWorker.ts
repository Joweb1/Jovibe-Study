/// <reference lib="webworker" />

interface CompressRequest {
  id: number;
  blob: Blob;
  maxDimension: number;
  quality: number;
}

interface CompressResponse {
  id: number;
  ok: boolean;
  base64?: string;
  mimeType?: string;
  error?: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

self.onmessage = async (event: MessageEvent<CompressRequest>) => {
  const { id, blob, maxDimension, quality } = event.data;

  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
      throw new Error('OffscreenCanvas is unavailable in this worker environment.');
    }

    const bitmap = await createImageBitmap(blob);
    try {
      let targetWidth = bitmap.width;
      let targetHeight = bitmap.height;

      if (targetWidth > maxDimension || targetHeight > maxDimension) {
        const ratio = Math.min(maxDimension / targetWidth, maxDimension / targetHeight);
        targetWidth = Math.max(1, Math.round(targetWidth * ratio));
        targetHeight = Math.max(1, Math.round(targetHeight * ratio));
      }

      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not initialize offscreen image canvas.');
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

      const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      const buffer = await jpegBlob.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);

      const response: CompressResponse = {
        id,
        ok: true,
        base64,
        mimeType: 'image/jpeg',
      };
      self.postMessage(response);
    } finally {
      bitmap.close();
    }
  } catch (err) {
    const response: CompressResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
