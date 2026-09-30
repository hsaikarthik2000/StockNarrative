import { describe, expect, it } from 'vitest';
import { parsePortfolioCsv } from '../src/portfolio/csv';

const csv = `Symbol,ISIN,Sector,Quantity,Average Price (₹),LTP (₹),Invested Amount (₹),Current Value (₹),P&L (₹),P&L (%)
RELIANCE,INE002A01018,Energy & Retail,37,2745.20,2985.40,101572.40,110459.80,+8887.40,+8.75%`;

describe('parsePortfolioCsv', () => {
  it('parses the supplied Indian portfolio column format and signed percentages', () => {
    const [position] = parsePortfolioCsv(csv);
    expect(position.Symbol).toBe('RELIANCE');
    expect(position.Quantity).toBe(37);
    expect(position['P&L (%)']).toBe(8.75);
    expect(position['Current Value (₹)']).toBe(110459.8);
  });

  it('rejects duplicate symbols and invalid rows', () => {
    expect(() => parsePortfolioCsv(`${csv}\n${csv.split('\n')[1]}`)).toThrow(/Duplicate symbol/);
    expect(() => parsePortfolioCsv(csv.replace('RELIANCE,', 'reliance,'))).toThrow(/Invalid portfolio CSV row/);
  });
});