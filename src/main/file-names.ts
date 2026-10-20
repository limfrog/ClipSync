/** Portable Windows/macOS filename. Never reinterpret Unicode bytes as a code page. */
export function portableFilename(value: string): string {
  let name = value.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_').replace(/[. ]+$/g, '');
  if (!name || name === '.' || name === '..') name = '받은 파일';
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name = '_' + name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && Buffer.byteLength(name.slice(dot)) <= 32 ? name.slice(dot) : '';
  let stem = extension ? name.slice(0, -extension.length) : name;
  while (Buffer.byteLength(stem + extension) > 220) stem = Array.from(stem).slice(0, -1).join('');
  return stem + extension;
}

export function numberedFilename(name: string, number: number): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${number})${name.slice(dot)}` : `${name} (${number})`;
}
