/**
 * Keeps the canvas backing store matched to its CSS size and the device pixel ratio.
 * Returns a function that stops observing.
 */
export function fitCanvas(canvas: HTMLCanvasElement, onResize: () => void): () => void {
  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    onResize();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  return () => observer.disconnect();
}
