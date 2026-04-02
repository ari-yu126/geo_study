/**
 * Minimal RFC-style CSV parser (supports quoted fields, \r\n).
 */

export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  const len = content.length;
  const pushRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== '' || field !== '') {
      rows.push(row);
    }
    row = [];
    field = '';
  };
  while (i < len) {
    const c = content[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < len && content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i++;
      continue;
    }
    if (c === '\r') {
      if (i + 1 < len && content[i + 1] === '\n') {
        pushRow();
        i += 2;
        continue;
      }
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '' || field !== '') {
    rows.push(row);
  }
  return rows;
}
