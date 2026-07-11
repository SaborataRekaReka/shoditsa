const fs = require('fs');
const path = require('path');

const dir = path.resolve('docs/screenshots/capture-4-hq-2026-07-07-22-03-09');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort();

function parseJpegSize(buffer) {
  let i = 2;
  while (i < buffer.length) {
    if (buffer[i] !== 0xFF) { i++; continue; }
    const marker = buffer[i + 1];
    if (marker === 0xD8 || marker === 0xD9) { i += 2; continue; }
    const len = buffer.readUInt16BE(i + 2);
    if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

for (const file of files) {
  const p = path.join(dir, file);
  const b = fs.readFileSync(p);
  const s = parseJpegSize(b);
  console.log(`${file}: ${s ? `${s.width}x${s.height}` : 'unknown'}`);
}
