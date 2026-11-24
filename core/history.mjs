import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DATA_ROOT = path.join(os.homedir(), '.huixin-web-to-desktop');
export const HISTORY_FILE = path.join(DATA_ROOT, 'history.json');

export function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const list = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    if (!Array.isArray(list)) return [];
    return list.map((item) => ({
      ...item,
      exists: item.outputPath ? fs.existsSync(item.outputPath) : false,
    }));
  } catch {
    return [];
  }
}

export function addHistoryRecord(record) {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  const list = loadHistory().map(({ exists, ...rest }) => rest);
  const filtered = list.filter((item) => item.id !== record.id && item.outputPath !== record.outputPath);
  filtered.unshift({
    ...record,
    updatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(filtered.slice(0, 60), null, 2), 'utf8');
  return filtered;
}

export function removeHistoryRecord(id) {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  const list = loadHistory().map(({ exists, ...rest }) => rest);
  const next = list.filter((item) => item.id !== id);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
