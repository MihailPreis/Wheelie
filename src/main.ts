import { fitCanvas } from './render/canvas';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const context = canvas?.getContext('2d');
if (!canvas || !context) throw new Error('Canvas 2D is not available');

fitCanvas(canvas, () => {
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
});
