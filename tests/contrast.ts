import assert from 'node:assert/strict';
import type { Page } from 'playwright';

export async function assertReadable(page: Page) {
  // tsx's keepNames helper is otherwise outside the serialized browser callback.
  await page.evaluate('globalThis.__name ??= (fn) => fn');
  const samples = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map(value => value / 255);
    };
    const blend = (front: number[], back: number[]) => front.slice(0, 3).map((value, index) => value * front[3] + back[index] * (1 - front[3])).concat(1);
    const luminance = (color: number[]) => color.slice(0, 3).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const selectors = '.status-badge,.device-chip,.device-hint,.seg-tab,.clip-type,.clip-top,.clip-preview,.clip-bottom,.clip-actions button,.footer-btn,.kbd-tag,.text-btn,#open-connection,#pin-window';
    return [...document.querySelectorAll<HTMLElement>(selectors)].filter(el => el.getClientRects().length && !el.matches(':disabled')).map(el => {
      const chain: HTMLElement[] = []; for (let parent: HTMLElement | null = el; parent; parent = parent.parentElement) chain.unshift(parent);
      const background = chain.reduce((color, parent) => blend(rgba(getComputedStyle(parent).backgroundColor), color), [1,1,1,1]);
      const style = getComputedStyle(el); const text = blend(rgba(style.color), background);
      const [a,b] = [luminance(background), luminance(text)].sort((a,b) => b-a);
      return { selector: el.className || el.id, ratio: (a + .05) / (b + .05), font: Number.parseFloat(style.fontSize) };
    });
  });
  assert.ok(samples.length >= 12);
  assert.deepEqual(samples.filter(sample => sample.ratio < 4.5 || sample.font < 12), [], 'Visible text must have at least 4.5:1 contrast and 12px size in both themes');
  console.log(`Readable UI: ${samples.length} samples, minimum ${Math.min(...samples.map(sample => sample.ratio)).toFixed(2)}:1 contrast`);
}
