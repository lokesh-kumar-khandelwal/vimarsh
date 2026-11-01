import { describe, expect, it, vi } from 'vitest';
import {
  escapeCsvCell,
  exportRowsToCsv,
  generateCsv,
  generateCsvFilename,
} from '../engine/csvExport';

describe('CSV Export Utility (/src/engine/csvExport.ts)', () => {
  describe('escapeCsvCell', () => {
    it('returns empty string for null and undefined', () => {
      expect(escapeCsvCell(null)).toBe('');
      expect(escapeCsvCell(undefined)).toBe('');
    });

    it('formats raw numbers without locale commas', () => {
      expect(escapeCsvCell(0)).toBe('0');
      expect(escapeCsvCell(123456.78)).toBe('123456.78');
      expect(escapeCsvCell(-42)).toBe('-42');
      expect(escapeCsvCell(NaN)).toBe('');
      expect(escapeCsvCell(Infinity)).toBe('');
    });

    it('returns unquoted plain string when no special characters are present', () => {
      expect(escapeCsvCell('Electronics')).toBe('Electronics');
      expect(escapeCsvCell('SKU_12345')).toBe('SKU_12345');
    });

    it('wraps and escapes strings containing commas, quotes, and newlines according to RFC 4180', () => {
      // Comma
      expect(escapeCsvCell('San Francisco, CA')).toBe('"San Francisco, CA"');
      // Double quote escaped as double-double quote
      expect(escapeCsvCell('He said "Hello"')).toBe('"He said ""Hello"""');
      // Newline \n
      expect(escapeCsvCell('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
      // Carriage return \r
      expect(escapeCsvCell('Line 1\r\nLine 2')).toBe('"Line 1\r\nLine 2"');
      // Combination of comma and quote
      expect(escapeCsvCell('12" ruler, standard')).toBe('"12"" ruler, standard"');
    });
  });

  describe('generateCsv', () => {
    it('generates RFC 4180 formatted CSV with CRLF line terminators', () => {
      const columns = ['id', 'name', 'revenue', 'notes'];
      const rows = [
        [1, 'Alice, Inc.', 1500.5, 'VIP customer\nRenewal pending'],
        [2, 'Bob "The Builder"', 300, null],
      ];

      const csv = generateCsv(columns, rows);

      // Records must be separated by \r\n (CRLF)
      const records = csv.split('\r\n');
      expect(records.length).toBe(3); // 1 header record + 2 data records
      expect(records[0]).toBe('id,name,revenue,notes');
      expect(records[1]).toBe('1,"Alice, Inc.",1500.5,"VIP customer\nRenewal pending"');
      expect(records[2]).toBe('2,"Bob ""The Builder""",300,');
    });

    it('handles empty rows gracefully (just header)', () => {
      const columns = ['category', 'total_count'];
      const rows: (string | number | null)[][] = [];

      const csv = generateCsv(columns, rows);
      expect(csv).toBe('category,total_count');
    });
  });

  describe('generateCsvFilename', () => {
    it('creates a clean, descriptive slug from a natural language question', () => {
      const name = generateCsvFilename('What was our total revenue last month?');
      expect(name).toBe('vimarsh_what_was_our_total_revenue_last_month.csv');
    });

    it('cleans special punctuation, symbols, and consecutive spaces', () => {
      const name = generateCsvFilename('Top 5 customers by sales (2026)!');
      expect(name).toBe('vimarsh_top_5_customers_by_sales_2026.csv');
    });

    it('falls back to timestamped filename if question is empty or symbols-only', () => {
      const ts = 1700000000000;
      expect(generateCsvFilename('', ts)).toBe('vimarsh_query_results_1700000000000.csv');
      expect(generateCsvFilename(null, ts)).toBe('vimarsh_query_results_1700000000000.csv');
      expect(generateCsvFilename('??? /// !!!', ts)).toBe('vimarsh_query_results_1700000000000.csv');
    });

    it('truncates excessively long questions safely', () => {
      const longQuestion = 'a'.repeat(100);
      const name = generateCsvFilename(longQuestion);
      expect(name.endsWith('.csv')).toBe(true);
      expect(name.length).toBeLessThan(70);
    });
  });

  describe('exportRowsToCsv', () => {
    it('returns the CSV content and filename, safe for headless execution', () => {
      const columns = ['order_id', 'status', 'total'];
      const rows = [
        [101, 'COMPLETED', 89.99],
        [102, 'PENDING', 45.0],
      ];

      const result = exportRowsToCsv(columns, rows, 'my_export.csv');
      expect(result.filename).toBe('my_export.csv');
      expect(result.csvContent).toContain('order_id,status,total');
      expect(result.csvContent).toContain('101,COMPLETED,89.99');
      expect(result.csvContent).toContain('102,PENDING,45');
    });

    it('invokes DOM Blob download when running in a browser environment', () => {
      const columns = ['city', 'population'];
      const rows = [['New York', 8336817]];

      const clickMock = vi.fn();
      const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-url');
      const revokeObjectURLMock = vi.fn();

      const mockAnchor = {
        href: '',
        download: '',
        click: clickMock,
      };

      const appendChildMock = vi.fn();
      const removeChildMock = vi.fn();

      const mockDocument = {
        createElement: vi.fn().mockReturnValue(mockAnchor),
        body: {
          appendChild: appendChildMock,
          removeChild: removeChildMock,
        },
      };

      const mockBlob = class MockBlob {
        constructor(public parts: any[], public options: any) {}
      };

      const prevWindow = (globalThis as any).window;
      const prevDocument = (globalThis as any).document;
      const prevBlob = (globalThis as any).Blob;
      const prevURL = (globalThis as any).URL;

      (globalThis as any).window = {};
      (globalThis as any).document = mockDocument;
      (globalThis as any).Blob = mockBlob;
      (globalThis as any).URL = {
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock,
      };

      try {
        const result = exportRowsToCsv(columns, rows, 'cities.csv');
        expect(result.filename).toBe('cities.csv');
        expect(mockDocument.createElement).toHaveBeenCalledWith('a');
        expect(mockAnchor.download).toBe('cities.csv');
        expect(mockAnchor.href).toBe('blob:mock-url');
        expect(appendChildMock).toHaveBeenCalledWith(mockAnchor);
        expect(clickMock).toHaveBeenCalled();
        expect(removeChildMock).toHaveBeenCalledWith(mockAnchor);
        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url');
      } finally {
        (globalThis as any).window = prevWindow;
        (globalThis as any).document = prevDocument;
        (globalThis as any).Blob = prevBlob;
        (globalThis as any).URL = prevURL;
      }
    });
  });
});
