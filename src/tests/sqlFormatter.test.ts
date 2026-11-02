import { describe, expect, it } from 'vitest';
import { formatSql, formatSqlCompact } from '../engine/sqlFormatter';

describe('SQL Formatter Utility (/src/engine/sqlFormatter.ts)', () => {
  it('formats simple SELECT query into readable indented block', () => {
    const raw = 'SELECT customer_id, customer_name, email FROM customers WHERE country = \'US\' LIMIT 10;';
    const formatted = formatSql(raw);

    expect(formatted).toBe(
`SELECT
  customer_id,
  customer_name,
  email
FROM customers
WHERE country = 'US'
LIMIT 10;`
    );
  });

  it('formats complex query with JOIN, GROUP BY, ORDER BY, and multiple WHERE conditions', () => {
    const raw = "SELECT c.customer_name, COUNT(o.order_id) AS order_count, SUM(oi.unit_price * oi.quantity) AS total_revenue FROM customers c JOIN orders o ON c.customer_id = o.customer_id JOIN order_items oi ON o.order_id = oi.order_id WHERE o.order_date >= '2026-09-01' AND o.status = 'COMPLETED' GROUP BY c.customer_name ORDER BY total_revenue DESC LIMIT 1000;";
    const formatted = formatSql(raw);

    expect(formatted).toBe(
`SELECT
  c.customer_name,
  COUNT(o.order_id) AS order_count,
  SUM(oi.unit_price * oi.quantity) AS total_revenue
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
JOIN order_items oi ON o.order_id = oi.order_id
WHERE o.order_date >= '2026-09-01'
  AND o.status = 'COMPLETED'
GROUP BY c.customer_name
ORDER BY total_revenue DESC
LIMIT 1000;`
    );
  });

  it('does NOT split commas inside function calls like strftime, COALESCE, or ROUND', () => {
    const raw = "SELECT strftime('%Y-%m', o.order_date) AS month, ROUND(SUM(oi.unit_price * oi.quantity), 2) AS revenue FROM orders o JOIN order_items oi ON o.order_id = oi.order_id GROUP BY month;";
    const formatted = formatSql(raw);

    expect(formatted).toBe(
`SELECT
  STRFTIME('%Y-%m', o.order_date) AS month,
  ROUND(SUM(oi.unit_price * oi.quantity), 2) AS revenue
FROM orders o
JOIN order_items oi ON o.order_id = oi.order_id
GROUP BY month;`
    );
  });

  it('preserves string literals with spaces, commas, quotes, and uppercase keywords inside them', () => {
    const raw = "SELECT product_name FROM products WHERE description LIKE '%Select, where from%' AND category = 'Women''s Apparel';";
    const formatted = formatSql(raw);

    expect(formatted).toContain("'%Select, where from%'");
    expect(formatted).toContain("'Women''s Apparel'");
    expect(formatted.startsWith('SELECT\n  product_name\nFROM products')).toBe(true);
  });

  it('indents subqueries properly', () => {
    const raw = "SELECT c.customer_name FROM customers c WHERE c.customer_id IN (SELECT o.customer_id FROM orders o WHERE o.total_amount > 500) ORDER BY c.customer_name LIMIT 10;";
    const formatted = formatSql(raw);

    expect(formatted).toContain('IN (');
    expect(formatted).toContain('SELECT');
    expect(formatted).toContain('o.customer_id');
    expect(formatted).toContain('FROM orders o');
    expect(formatted).toContain('WHERE o.total_amount > 500');
  });

  it('handles SELECT DISTINCT correctly', () => {
    const raw = 'SELECT DISTINCT c.country, c.state FROM customers c WHERE c.country IS NOT NULL;';
    const formatted = formatSql(raw);

    expect(formatted).toBe(
`SELECT DISTINCT
  c.country,
  c.state
FROM customers c
WHERE c.country IS NOT NULL;`
    );
  });

  it('handles compact format normalization', () => {
    const raw = `
      SELECT
        o.order_id,
        c.customer_name
      FROM orders o
      JOIN customers c ON o.customer_id = c.customer_id
      WHERE o.status = 'COMPLETED';
    `;
    const compact = formatSqlCompact(raw);
    expect(compact).toBe(
      "SELECT o.order_id, c.customer_name FROM orders o JOIN customers c ON o.customer_id = c.customer_id WHERE o.status = 'COMPLETED';"
    );
  });

  it('returns empty string or fallback safely for blank input', () => {
    expect(formatSql('')).toBe('');
    expect(formatSql('   ')).toBe('');
  });
});
