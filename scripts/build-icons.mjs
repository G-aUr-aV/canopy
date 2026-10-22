// Deterministic packaging of the existing generated brand asset, with no new artwork.
import {readFile, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const source = await readFile(new URL('../public/brand/canopy.png', import.meta.url));
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage();
  for (const [name, size] of [['icon-192.png',192],['icon-512.png',512],['icon-maskable-512.png',512],['apple-touch-icon.png',180]]) {
    const png = await page.evaluate(async ({data, size}) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const context = canvas.getContext('2d'); context.fillStyle = '#f7f8f6'; context.fillRect(0,0,size,size);
      context.imageSmoothingQuality = 'high'; context.drawImage(image,0,0,size,size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, {data: source.toString('base64'), size});
    await writeFile(new URL('../public/brand/' + name, import.meta.url), Buffer.from(png,'base64'));
  }
} finally {await browser.close();}
