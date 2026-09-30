import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultCsvPath = fileURLToPath(new URL('../../assets/portfolio_Data.csv.txt', import.meta.url));
const csvPath = resolve(process.argv[2] ?? defaultCsvPath);
const apiUrl = process.env.LOCAL_API_URL ?? 'http://127.0.0.1:8787';

if (!((apiUrl.startsWith('http://127.0.0.1:') || apiUrl.startsWith('http://localhost:')) || process.env.ALLOW_REMOTE_IMPORT === 'true')) {
  throw new Error('Portfolio import is restricted to a localhost API URL.');
}

const csvText = await readFile(csvPath, 'utf8');
const response = await fetch(`${apiUrl}/api/v1/dev/portfolio/import`, {
  method: 'POST',
  headers: { 'Content-Type': 'text/csv' },
  body: csvText,
});

const responseText = await response.text();
if (!response.ok) {
  throw new Error(`Local portfolio import failed (${response.status}): ${responseText}`);
}

const result = JSON.parse(responseText) as {
  rowCount: number;
  currency: string;
  totals: { investedValue: number; currentValue: number; unrealizedPnl: number };
};

console.log(`Imported ${result.rowCount} positions into local D1 (${result.currency}).`);
console.log(`Invested: ${result.totals.investedValue.toFixed(2)} ${result.currency}`);
console.log(`Current: ${result.totals.currentValue.toFixed(2)} ${result.currency}`);
console.log(`Unrealized P&L: ${result.totals.unrealizedPnl.toFixed(2)} ${result.currency}`);