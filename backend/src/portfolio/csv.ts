import { parse } from 'csv-parse/sync';
import { z } from 'zod';

function csvNumber(value: string) {
  return Number(value.replace(/[₹,%\s]/g, '').replaceAll(',', ''));
}

const numberField = z.string().transform(csvNumber).pipe(z.number().finite());

const portfolioRowSchema = z.object({
  Symbol: z.string().trim().regex(/^[A-Z0-9.-]{1,20}$/),
  ISIN: z.string().trim().regex(/^IN[A-Z0-9]{10}$/),
  Sector: z.string().trim().min(1).max(100),
  Quantity: numberField.pipe(z.number().positive()),
  'Average Price (₹)': numberField.pipe(z.number().nonnegative()),
  'LTP (₹)': numberField.pipe(z.number().nonnegative()),
  'Invested Amount (₹)': numberField,
  'Current Value (₹)': numberField,
  'P&L (₹)': numberField,
  'P&L (%)': numberField,
});

export type PortfolioCsvRow = z.infer<typeof portfolioRowSchema>;

export function parsePortfolioCsv(csvText: string): PortfolioCsvRow[] {
  const rows: unknown[] = parse(csvText, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: false,
  });

  if (rows.length === 0 || rows.length > 500) {
    throw new Error('Portfolio CSV must contain between 1 and 500 positions.');
  }

  const validated = rows.map((row, index) => {
    const result = portfolioRowSchema.safeParse(row);
    if (!result.success) {
      throw new Error(`Invalid portfolio CSV row ${index + 2}: ${result.error.issues[0]?.message ?? 'invalid value'}`);
    }
    return result.data;
  });

  const symbols = new Set<string>();
  const isins = new Set<string>();
  for (const row of validated) {
    if (symbols.has(row.Symbol) || isins.has(row.ISIN)) {
      throw new Error(`Duplicate symbol or ISIN in portfolio CSV: ${row.Symbol}.`);
    }
    symbols.add(row.Symbol);
    isins.add(row.ISIN);
  }
  return validated;
}