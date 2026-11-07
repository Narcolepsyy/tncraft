/**
 * Lightweight, zero-dependency .xlsx and .docx table reader using standard
 * Web/Node DecompressionStream('deflate-raw').
 * - .xlsx: extracts ALL worksheets (sheet1..sheetN) as 2D string tables
 * - .docx: extracts ALL <w:tbl> Word tables (e.g. HDC_TNKQ_TULUAN.docx) as 2D string tables
 */

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const buf = compressed.buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength
  ) as ArrayBuffer;
  const stream = new Blob([buf]).stream().pipeThrough(ds);
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

async function readZipEntries(
  buffer: ArrayBuffer,
  predicate: (entryName: string) => boolean
): Promise<Map<string, string>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  let eocdPos = -1;
  const minPos = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) {
    throw new Error('Invalid Office OpenXML archive (missing EOCD)');
  }

  const totalEntries = view.getUint16(eocdPos + 10, true);
  const cdOffset = view.getUint32(eocdPos + 16, true);
  const decoder = new TextDecoder('utf-8');
  const out = new Map<string, string>();
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

    if (!predicate(name)) continue;
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;

    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const rawSlice = bytes.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      out.set(name, decoder.decode(rawSlice));
    } else if (method === 8) {
      const inflated = await inflateRawBytes(rawSlice);
      out.set(name, decoder.decode(inflated));
    }
  }

  return out;
}

export async function parseXlsxAllSheets(buffer: ArrayBuffer): Promise<string[][][]> {
  const entries = await readZipEntries(
    buffer,
    (name) => name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  );

  const sharedStrings: string[] = [];
  const ssXml = entries.get('xl/sharedStrings.xml');
  if (ssXml) {
    for (const m of ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      const parts: string[] = [];
      for (const tm of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
        parts.push(decodeXmlEntities(tm[1]));
      }
      sharedStrings.push(parts.join(''));
    }
  }

  const sheetNames = [...entries.keys()]
    .filter((k) => k.startsWith('xl/worksheets/sheet'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const tables: string[][][] = [];

  for (const key of sheetNames) {
    const sheetXml = entries.get(key)!;
    const table: string[][] = [];

    for (const rm of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
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
          const parts: string[] = [];
          for (const tm of cellBody.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
            parts.push(decodeXmlEntities(tm[1]));
          }
          value = parts.join('');
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

    if (table.length > 0) {
      tables.push(table);
    }
  }

  return tables;
}

export async function parseXlsxFirstSheet(buffer: ArrayBuffer): Promise<string[][]> {
  const sheets = await parseXlsxAllSheets(buffer);
  return sheets[0] || [];
}

export async function parseDocxAllTables(buffer: ArrayBuffer): Promise<string[][][]> {
  const entries = await readZipEntries(buffer, (name) => name === 'word/document.xml');
  const docXml = entries.get('word/document.xml');
  if (!docXml) return [];

  const tables: string[][][] = [];
  for (const tblMatch of docXml.matchAll(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g)) {
    const tblXml = tblMatch[1];
    const rows: string[][] = [];

    for (const trMatch of tblXml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
      const trXml = trMatch[1];
      const cells: string[] = [];

      for (const tcMatch of trXml.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
        const tcXml = tcMatch[1];
        const pTexts: string[] = [];
        for (const pMatch of tcXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
          const runs: string[] = [];
          for (const tMatch of pMatch[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)) {
            runs.push(decodeXmlEntities(tMatch[1]));
          }
          const line = runs.join('').trim();
          if (line) pTexts.push(line);
        }
        cells.push(pTexts.join(' ').trim());
      }

      if (cells.some((c) => c !== '')) {
        rows.push(cells);
      }
    }

    if (rows.length > 0) {
      tables.push(rows);
    }
  }

  return tables;
}
