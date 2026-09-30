import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { portfolioResponseSchema } from '@stocknarrative/shared';

const assetsDirectory = fileURLToPath(new URL('../../assets/indian-stock-market-dataset/', import.meta.url));
const apiUrl = process.env.LOCAL_API_URL ?? 'http://127.0.0.1:8787';

if (!((apiUrl.startsWith('http://127.0.0.1:') || apiUrl.startsWith('http://localhost:')) || process.env.ALLOW_REMOTE_IMPORT === 'true')) {
  throw new Error('Market-data import is restricted to a localhost API URL.');
}

function parseCsv<T>(text: string): T[] {
  return parse(text, {
    bom: true,
    columns: (headers: string[]) => headers.map((header, index) => header.trim() || `column_${index}`),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: false,
  }) as T[];
}

function parseTradingDate(value: string) {
  const match = value.match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{4})/);
  if (!match) throw new Error('BSE price row has an unsupported date format.');
  const months: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  const month = months[match[1]];
  if (!month) throw new Error('BSE price row has an invalid month.');
  return `${match[3]}-${month}-${match[2].padStart(2, '0')}`;
}

function parsePublishedAt(value: string) {
  const match = value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2})$/);
  if (!match) throw new Error('BSE news row has an unsupported publication date.');
  const months: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const month = months[match[2]];
  if (month === undefined) throw new Error('BSE news row has an invalid month.');
  const utcMilliseconds = Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5])) - (5 * 60 + 30) * 60 * 1000;
  return new Date(utcMilliseconds).toISOString();
}

const portfolioResponse = await fetch(`${apiUrl}/api/v1/me/portfolio`, { headers: { Accept: 'application/json' } });
if (!portfolioResponse.ok) throw new Error(`Local portfolio request failed (${portfolioResponse.status}).`);
const portfolio = portfolioResponseSchema.parse(await portfolioResponse.json());
const portfolioSymbols = new Set(portfolio.positions.map((position) => position.instrument.symbol.toUpperCase()));

const activeCompanies = parseCsv<{ ScripCode: string; SecurityID: string; CompanyName: string; Industry: string }>(
  await readFile(resolve(assetsDirectory, 'active_companies_list.csv'), 'utf8'),
);
const companies = activeCompanies.flatMap((company) => {
  const symbol = company.SecurityID.trim().toUpperCase();
  const scripCode = company.ScripCode.trim();
  if (!/^[A-Z0-9.-]{1,20}$/.test(symbol) || !/^\d+$/.test(scripCode) || !company.CompanyName.trim()) return [];
  return [{ symbol, scripCode, name: company.CompanyName.trim(), industry: company.Industry.trim() || null }];
});
if (!companies.some((company) => portfolioSymbols.has(company.symbol))) {
  throw new Error('None of the imported portfolio symbols are present in the BSE catalog.');
}
const symbolByScripCode = new Map(companies.map((company) => [company.scripCode, company.symbol]));

const priceRows = parseCsv<{ date: string; value: string; vol: string; ScripCode: string }>(
  await readFile(resolve(assetsDirectory, 'period_trend_data_12M.csv'), 'utf8'),
);
const bars = priceRows.flatMap((row) => {
  const symbol = symbolByScripCode.get(row.ScripCode);
  if (!symbol) return [];
  const close = Number(row.value);
  const volume = Number(row.vol);
  if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(volume) || volume < 0) return [];
  return [{ symbol, time: parseTradingDate(row.date), close, volume }];
});

const newsRows = parseCsv<{
  newsid: string;
  link: string;
  publisheddate: string;
  source: string;
  CompanyName: string;
  ScripCode: string;
}>(await readFile(resolve(assetsDirectory, 'corporate_news_data.csv'), 'utf8'));
const articles = newsRows.flatMap((row) => {
  const symbol = symbolByScripCode.get(row.ScripCode);
  const title = row.CompanyName.trim().replace(/\\'/g, "'");
  if (!symbol || !row.newsid?.trim() || !title || !row.link?.trim()) return [];
  let sourceDomain: string;
  try {
    sourceDomain = new URL(row.source).hostname;
    new URL(row.link);
  } catch {
    return [];
  }
  return [{
    articleId: `${symbol}_${row.newsid.trim()}`,
    symbol,
    title,
    url: row.link.trim(),
    sourceName: sourceDomain,
    sourceDomain,
    publishedAt: parsePublishedAt(row.publisheddate),
  }];
});

if (!bars.length) throw new Error('No local BSE price rows matched the imported portfolio symbols.');

const response = await fetch(`${apiUrl}/api/v1/dev/market-data/import`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ source: 'kaggle-bse-cc0', companies, bars, articles }),
});
const responseText = await response.text();
if (!response.ok) throw new Error(`Local market-data import failed (${response.status}): ${responseText}`);

const result = JSON.parse(responseText) as { mappedInstrumentCount: number; importedBarCount: number; importedArticleCount: number };
console.log(`Imported ${result.importedBarCount} daily close/volume rows and ${result.importedArticleCount} linked news records for ${result.mappedInstrumentCount} mapped instruments.`);