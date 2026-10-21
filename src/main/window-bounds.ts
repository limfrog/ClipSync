export const MIN_WINDOW_WIDTH = 360;
export const MIN_WINDOW_HEIGHT = 480;
export interface WorkArea { x: number; y: number; width: number; height: number }
export interface WindowBounds { x?: number; y?: number; width: number; height: number }

export function restoreWindowBounds(value: unknown, areas: WorkArea[], primary: WorkArea): WindowBounds {
  const saved = value && typeof value === 'object' ? value as Partial<WorkArea> : {};
  const positioned = Number.isInteger(saved.x) && Number.isInteger(saved.y);
  const area = positioned ? areas.find(r => saved.x! >= r.x && saved.x! < r.x + r.width && saved.y! >= r.y && saved.y! < r.y + r.height) ?? primary : primary;
  const width = Math.max(MIN_WINDOW_WIDTH, Math.min(Number.isInteger(saved.width) ? saved.width! : 400, area.width));
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.min(Number.isInteger(saved.height) ? saved.height! : 760, area.height - 30));
  if (!positioned || !areas.includes(area) || !areas.some(r => saved.x! >= r.x && saved.x! < r.x + r.width && saved.y! >= r.y && saved.y! < r.y + r.height)) return { width, height };
  return { width, height, x: Math.max(area.x, Math.min(saved.x!, area.x + area.width - width)), y: Math.max(area.y, Math.min(saved.y!, area.y + area.height - height)) };
}
