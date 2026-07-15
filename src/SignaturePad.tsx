import { useEffect, useRef } from 'react';

export function SignaturePad({ value, disabled = false, onChange }: { value?: string; disabled?: boolean; onChange: (dataUrl: string, signedAt: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!value) return;
    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = value;
  }, [value]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext('2d')!;
    const p = point(event);
    context.beginPath(); context.moveTo(p.x, p.y);
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const context = event.currentTarget.getContext('2d')!;
    const p = point(event);
    context.lineWidth = 3; context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = '#111827';
    context.lineTo(p.x, p.y); context.stroke();
  };
  const finish = () => {
    if (!drawing.current || disabled || !canvasRef.current) return;
    drawing.current = false;
    onChange(canvasRef.current.toDataURL('image/png'), new Date().toISOString());
  };

  return <div className="signature-pad"><canvas ref={canvasRef} width={900} height={220} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} /><div><span>请客户在上方手写签字（支持手机、平板、鼠标）</span><button type="button" disabled={disabled || !value} onClick={() => onChange('', '')}>清除签字</button></div></div>;
}
