/**
 * Lightweight, zero-dependency .xlsx reader using standard Web/Node DecompressionStream('deflate-raw').
 * Parses worksheet 1 into a 2D string matrix for Answer Key & Roster imports.
 */

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([compressed]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function colLettersToIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

export async function parseXlsxFirstSheet(buffer: ArrayBuffer): Promise<string[][]> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Locate End of Central Directory (EOCD) signature 0x06054b50 scanning backwards
  let eocdPos = -1;
  const minPos = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) {
    throw new Error('Invalid XLSX archive (missing EOCD)');
  }

  const totalEntries = view.getUint16(eocdPos + 10, true);
  const cdOffset = view.getUint32(eocdPos + 16, true);
  const decoder = new TextDecoder('utf-8');

  const files = new Map<string, Uint8Array>();
  let ptr = cdOffset;

  for (let e = 0; e < totalEntries; e++) {
    if (ptr + 46 > bytes.length || view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (
      name === 'xl/sharedStrings.xml' ||
      /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
    ) {
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const rawSlice = bytes.subarray(dataStart, dataStart + compSize);

      if (method === 0) {
        files.set(name, rawSlice);
      } else if (method === 8) {
        files.set(name, await inflateRawBytes(rawSlice));
      }
    }
  }

  const sharedStrings: string[] = [];
  const ssBytes = files.get('xl/sharedStrings.xml');
  if (ssBytes) {
    const ssXml = decoder.decode(ssBytes);
    const siMatches = ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g);
    for (const m of siMatches) {
      const inner = m[1];
      const parts: string[] = [];
      for (const tm of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
        parts.push(decodeXmlEntities(tm[1]));
      }
      sharedStrings.push(parts.join(''));
    }
  }

  const sheetKey =
    files.has('xl/worksheets/sheet1.xml')
      ? 'xl/worksheets/sheet1.xml'
      : [...files.keys()].find((k) => k.startsWith('xl/worksheets/sheet'));

  if (!sheetKey) return [];
  const sheetXml = decoder.decode(files.get(sheetKey)!);

  const table: string[][] = [];
  const rowMatches = sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g);
  for (const rm of rowMatches) {
    const rowXml = rm[1];
    const rowArr: string[] = [];
    const cellMatches = rowXml.matchAll(/<c\b([^/>]*)(?:\/>|>([\s\S]*?)<\/c>)/g);
    for (const cm of cellMatches) {
      const attrs = cm[1] || '';
      const cellBody = cm[2] || '';
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/);
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const colIdx = refMatch ? colLettersToIndex(refMatch[1]) : rowArr.length;
      const cellType = typeMatch ? typeMatch[1] : '';

      let value = '';
      if (cellType === 'inlineStr') {
        const tm = cellBody.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
        value = tm ? decodeXmlEntities(tm[1]) : '';
      } else {
        const vm = cellBody.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const rawVal = vm ? decodeXmlEntities(vm[1]).trim() : '';
        if (cellType === 's' && /^\d+$/.test(rawVal)) {
          value = sharedStrings[Number(rawVal)] ?? '';
        } else {
          value = rawVal;
        }
      }

      while (rowArr.length <= colIdx) rowArr.push('');
      rowArr[colIdx] = value.trim();
    }
    if (rowArr.some((c) => c !== '')) {
      table.push(rowArr);
    }
  }

  return table;
}
