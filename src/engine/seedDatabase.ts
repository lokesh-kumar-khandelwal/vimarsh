import type { Database, SqlJsStatic } from 'sql.js';
import type { InitSuccessPayload, SeedCheckResult, SeedReport } from '../types';
import {
  addDaysYMD,
  daysInMonthLocal,
  formatLocalYMD,
  getDateHelpers,
} from './dateHelpers';
import { loadSchemaContextFromDb } from './schemaLoader';

function createDeterministicRng(seed = 0x56494d41): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function minYMD(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxYMD(a: string, b: string): string {
  return a >= b ? a : b;
}

const CUSTOMER_DATA: ReadonlyArray<{
  name: string;
  city: string;
  state: string;
  segment: 'Consumer' | 'Corporate' | 'Small Business';
}> = [
  { name: 'Apex Global Corp', city: 'New York', state: 'NY', segment: 'Corporate' },
  { name: 'Meridian Systems Inc', city: 'San Francisco', state: 'CA', segment: 'Corporate' },
  { name: 'Vanguard Enterprise Group', city: 'Chicago', state: 'IL', segment: 'Corporate' },
  { name: 'Priya Sharma', city: 'Austin', state: 'TX', segment: 'Consumer' },
  { name: 'Rohan Mehta', city: 'Seattle', state: 'WA', segment: 'Small Business' },
  { name: 'Ananya Iyer', city: 'Boston', state: 'MA', segment: 'Consumer' },
  { name: 'Lucas Vance', city: 'Denver', state: 'CO', segment: 'Consumer' },
  { name: 'Elena Rostova', city: 'Miami', state: 'FL', segment: 'Small Business' },
  { name: 'Marcus Sterling', city: 'Atlanta', state: 'GA', segment: 'Corporate' },
  { name: 'Kavita Nair', city: 'San Jose', state: 'CA', segment: 'Consumer' },
  { name: 'David Kim', city: 'Portland', state: 'OR', segment: 'Small Business' },
  { name: 'Sarah Jenkins', city: 'Dallas', state: 'TX', segment: 'Consumer' },
  { name: 'Vikram Patel', city: 'Edison', state: 'NJ', segment: 'Corporate' },
  { name: 'Hannah Abbott', city: 'Phoenix', state: 'AZ', segment: 'Consumer' },
  { name: 'Noah Takahashi', city: 'Los Angeles', state: 'CA', segment: 'Small Business' },
  { name: 'Rachel Greenwald', city: 'Philadelphia', state: 'PA', segment: 'Corporate' },
  { name: 'Arjun Deshmukh', city: 'Raleigh', state: 'NC', segment: 'Consumer' },
  { name: 'Chloe Dubois', city: 'New Orleans', state: 'LA', segment: 'Small Business' },
  { name: 'Samuel Okafor', city: 'Houston', state: 'TX', segment: 'Corporate' },
  { name: 'Meera Krishnan', city: 'Minneapolis', state: 'MN', segment: 'Consumer' },
  { name: 'Gabriel Morales', city: 'San Diego', state: 'CA', segment: 'Small Business' },
  { name: 'Olivia Thorne', city: 'Charlotte', state: 'NC', segment: 'Consumer' },
  { name: 'Nikhil Verma', city: 'Columbus', state: 'OH', segment: 'Corporate' },
  { name: 'Sophia Lindqvist', city: 'Salt Lake City', state: 'UT', segment: 'Small Business' },
  { name: 'Daniel Cho', city: 'Bellevue', state: 'WA', segment: 'Corporate' },
  { name: 'Aisha Khan', city: 'Detroit', state: 'MI', segment: 'Consumer' },
  { name: 'Benjamin Brooks', city: 'Nashville', state: 'TN', segment: 'Small Business' },
  { name: 'Divya Joshi', city: 'Tampa', state: 'FL', segment: 'Consumer' },
  { name: 'Christopher Wallace', city: 'Baltimore', state: 'MD', segment: 'Corporate' },
  { name: 'Nadia Al-Mansoor', city: 'Arlington', state: 'VA', segment: 'Small Business' },
  { name: 'Siddharth Rao', city: 'Irvine', state: 'CA', segment: 'Corporate' },
  { name: 'Grace Gallagher', city: 'Pittsburgh', state: 'PA', segment: 'Consumer' },
  { name: 'Ethan Zimmerman', city: 'Madison', state: 'WI', segment: 'Small Business' },
  { name: 'Pooja Malhotra', city: 'Plano', state: 'TX', segment: 'Consumer' },
  { name: 'Julian Vance', city: 'Boulder', state: 'CO', segment: 'Small Business' },
  { name: 'Zoe Papadopoulos', city: 'Cambridge', state: 'MA', segment: 'Corporate' },
  { name: 'Karthik Subramanian', city: 'Fremont', state: 'CA', segment: 'Consumer' },
  { name: 'Victoria Sterling', city: 'Hartford', state: 'CT', segment: 'Corporate' },
  { name: 'Leo Fernandez', city: 'Orlando', state: 'FL', segment: 'Small Business' },
  { name: 'Tara Chatterjee', city: 'Jersey City', state: 'NJ', segment: 'Consumer' },
];

const PRODUCT_DATA: ReadonlyArray<{
  name: string;
  category: 'Electronics' | 'Clothing' | 'Home' | 'Books' | 'Sports';
  price: number;
  cost: number;
}> = [
  { name: 'ProStudio 4K Monitor 32"', category: 'Electronics', price: 1200.0, cost: 720.0 },
  { name: 'ThunderDock NVMe Workstation Hub', category: 'Electronics', price: 850.0, cost: 490.0 },
  { name: 'AeroCancel Wireless Headphones', category: 'Electronics', price: 340.0, cost: 165.0 },
  { name: 'Tactile Mech Keyboard Pro', category: 'Electronics', price: 190.0, cost: 88.0 },
  { name: 'UltraLight Portable SSD 2TB', category: 'Electronics', price: 240.0, cost: 115.0 },
  { name: 'Designing Reliable Data Systems', category: 'Books', price: 20.0, cost: 7.5 },
  { name: 'SQL Performance Explained Simply', category: 'Books', price: 24.0, cost: 8.5 },
  { name: 'Analytical Thinking in Practice', category: 'Books', price: 18.0, cost: 6.0 },
  { name: 'Statistical Models for Engineers', category: 'Books', price: 32.0, cost: 12.0 },
  { name: 'Modern Distributed Ledger Architecture', category: 'Books', price: 28.0, cost: 10.0 },
  { name: 'Merino Wool Quarter-Zip Pullover', category: 'Clothing', price: 110.0, cost: 45.0 },
  { name: 'All-Weather Commuter Jacket', category: 'Clothing', price: 185.0, cost: 78.0 },
  { name: 'Organic Cotton Oxford Shirt', category: 'Clothing', price: 68.0, cost: 26.0 },
  { name: 'Stretch Technical Chino Pants', category: 'Clothing', price: 84.0, cost: 34.0 },
  { name: 'Thermal Running Socks 3-Pack', category: 'Clothing', price: 26.0, cost: 9.0 },
  { name: 'Ergonomic Mesh Task Chair', category: 'Home', price: 460.0, cost: 210.0 },
  { name: 'Precision Burr Coffee Grinder', category: 'Home', price: 175.0, cost: 82.0 },
  { name: 'Smart HEPA Air Purifier', category: 'Home', price: 230.0, cost: 105.0 },
  { name: 'Dual-Tone LED Desk Lamp', category: 'Home', price: 72.0, cost: 29.0 },
  { name: 'Insulated Ceramic Carafe', category: 'Home', price: 48.0, cost: 18.0 },
  { name: 'Carbon Fiber Tennis Racket', category: 'Sports', price: 215.0, cost: 95.0 },
  { name: 'Adjustable Cast-Iron Kettlebell', category: 'Sports', price: 135.0, cost: 62.0 },
  { name: 'High-Density Cork Yoga Mat', category: 'Sports', price: 78.0, cost: 31.0 },
  { name: 'Hydration Trail Pack 12L', category: 'Sports', price: 96.0, cost: 41.0 },
  { name: 'Digital Cadence Speed Sensor', category: 'Sports', price: 54.0, cost: 21.0 },
];

const RETURN_REASONS = ['defective', 'wrong_item', 'not_needed', 'late_delivery'] as const;

const DDL_STATEMENTS = `
CREATE TABLE customers (
  customer_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  signup_date TEXT NOT NULL,
  segment TEXT NOT NULL
);

CREATE TABLE products (
  product_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  cost REAL NOT NULL
);

CREATE TABLE orders (
  order_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  shipped_at TEXT,
  delivered_at TEXT,
  discount_pct REAL NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

CREATE TABLE order_items (
  item_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(order_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE TABLE returns (
  return_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  returned_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(order_id)
);
`;

function queryScalar(db: Database, sql: string): number {
  const res = db.exec(sql);
  if (!res.length || !res[0].values.length) return 0;
  return Number(res[0].values[0][0] ?? 0);
}

function runTrustedSeedValidation(
  db: Database,
  now: Date,
  wasmSource: 'cdn' | 'public-fallback' | 'node-local',
  setupSequence: string[],
  startTimeMs: number
): SeedReport {
  const dh = getDateHelpers(now);
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const earliestOrderDate = formatLocalYMD(year, monthIndex - 11, 1);
  const tomorrow = addDaysYMD(dh.today, 1);
  const daysAgo29 = addDaysYMD(dh.today, -29);

  const checks: SeedCheckResult[] = [];

  const fkCheckRes = db.exec('PRAGMA foreign_key_check;');
  const fkViolations = fkCheckRes.length > 0 ? fkCheckRes[0].values.length : 0;
  checks.push({
    id: 'fk_integrity_check',
    name: 'PRAGMA foreign_key_check returns 0 violations',
    category: 'foreign_keys',
    passed: fkViolations === 0,
    details: `Violations found: ${fkViolations}`,
  });

  const customerCount = queryScalar(db, 'SELECT COUNT(*) FROM customers;');
  const productCount = queryScalar(db, 'SELECT COUNT(*) FROM products;');
  const orderCount = queryScalar(db, 'SELECT COUNT(*) FROM orders;');
  const orderItemCount = queryScalar(db, 'SELECT COUNT(*) FROM order_items;');
  const returnCount = queryScalar(db, 'SELECT COUNT(*) FROM returns;');

  checks.push({
    id: 'target_row_counts',
    name: 'Dataset scale matches spec (40 customers, 25 products, 300 orders, 700 order_items)',
    category: 'coverage',
    passed:
      customerCount === 40 &&
      productCount === 25 &&
      orderCount === 300 &&
      orderItemCount === 700 &&
      returnCount >= 10,
    details: `customers=${customerCount}, products=${productCount}, orders=${orderCount}, order_items=${orderItemCount}, returns=${returnCount}`,
  });

  const futureCustomers = queryScalar(
    db,
    `SELECT COUNT(*) FROM customers WHERE signup_date > '${dh.today}';`
  );
  const futureOrders = queryScalar(
    db,
    `SELECT COUNT(*) FROM orders WHERE created_at > '${dh.today}' OR (shipped_at IS NOT NULL AND shipped_at > '${dh.today}') OR (delivered_at IS NOT NULL AND delivered_at > '${dh.today}');`
  );
  const tooEarlyOrders = queryScalar(
    db,
    `SELECT COUNT(*) FROM orders WHERE created_at < '${earliestOrderDate}';`
  );
  const futureReturns = queryScalar(
    db,
    `SELECT COUNT(*) FROM returns WHERE returned_at > '${dh.today}';`
  );

  checks.push({
    id: 'date_not_after_today',
    name: 'No generated date is later than today; orders span from 11 months ago to today',
    category: 'date_integrity',
    passed:
      futureCustomers === 0 &&
      futureOrders === 0 &&
      tooEarlyOrders === 0 &&
      futureReturns === 0,
    details: `today=${dh.today}, earliest_allowed=${earliestOrderDate}; future(cust=${futureCustomers}, ord=${futureOrders}, ret=${futureReturns}), early_ord=${tooEarlyOrders}`,
  });

  const invalidLifecycleOrders = queryScalar(
    db,
    `SELECT COUNT(*) FROM orders WHERE
      created_at IS NULL
      OR (status IN ('pending', 'cancelled') AND (shipped_at IS NOT NULL OR delivered_at IS NOT NULL))
      OR (status = 'shipped' AND (shipped_at IS NULL OR delivered_at IS NOT NULL OR created_at > shipped_at))
      OR (status = 'delivered' AND (shipped_at IS NULL OR delivered_at IS NULL OR created_at > shipped_at OR shipped_at > delivered_at));`
  );

  checks.push({
    id: 'date_order_chronology',
    name: 'Order timestamps obey status NULL rules and created_at <= shipped_at <= delivered_at',
    category: 'date_integrity',
    passed: invalidLifecycleOrders === 0,
    details: `Invalid lifecycle rows: ${invalidLifecycleOrders}`,
  });

  const invalidReturnRows = queryScalar(
    db,
    `SELECT COUNT(*) FROM returns r
     JOIN orders o ON r.order_id = o.order_id
     WHERE o.status <> 'delivered'
        OR o.delivered_at IS NULL
        OR r.returned_at < o.delivered_at
        OR r.returned_at > '${dh.today}';`
  );

  checks.push({
    id: 'date_returns_chronology',
    name: 'Returns exist only for delivered orders and delivered_at <= returned_at <= today',
    category: 'date_integrity',
    passed: invalidReturnRows === 0,
    details: `Invalid return rows: ${invalidReturnRows}`,
  });

  const monthCounts: string[] = [];
  let all11MonthsPass = true;
  for (let k = 11; k >= 1; k--) {
    const mStart = formatLocalYMD(year, monthIndex - k, 1);
    const mEnd = formatLocalYMD(year, monthIndex - k + 1, 1);
    const cnt = queryScalar(
      db,
      `SELECT COUNT(*) FROM orders WHERE status <> 'cancelled' AND created_at >= '${mStart}' AND created_at < '${mEnd}';`
    );
    monthCounts.push(`${mStart.slice(0, 7)}:${cnt}`);
    if (cnt < 5) {
      all11MonthsPass = false;
    }
  }

  checks.push({
    id: 'coverage_11_complete_months',
    name: 'Each of the 11 complete prior calendar months has >= 5 non-cancelled orders by created_at',
    category: 'coverage',
    passed: all11MonthsPass,
    details: monthCounts.join(', '),
  });

  const currentMonthNonCancelled = queryScalar(
    db,
    `SELECT COUNT(*) FROM orders WHERE status <> 'cancelled' AND created_at >= '${dh.month_start}' AND created_at < '${tomorrow}';`
  );

  checks.push({
    id: 'coverage_current_month',
    name: 'Current calendar month has >= 3 non-cancelled orders with created_at <= today',
    category: 'coverage',
    passed: currentMonthNonCancelled >= 3,
    details: `[${dh.month_start}, ${tomorrow}) non-cancelled orders = ${currentMonthNonCancelled}`,
  });

  const lastMonthCreatedNonCancelled = queryScalar(
    db,
    `SELECT COUNT(*) FROM orders WHERE status <> 'cancelled' AND created_at >= '${dh.last_month_start}' AND created_at < '${dh.last_month_end_exclusive}';`
  );
  const lastMonthDelivered = queryScalar(
    db,
    `SELECT COUNT(*) FROM orders WHERE delivered_at >= '${dh.last_month_start}' AND delivered_at < '${dh.last_month_end_exclusive}';`
  );

  checks.push({
    id: 'coverage_last_complete_month',
    name: 'Last complete month has >= 10 non-cancelled orders (created_at) and >= 3 delivered orders (delivered_at)',
    category: 'coverage',
    passed: lastMonthCreatedNonCancelled >= 10 && lastMonthDelivered >= 3,
    details: `[${dh.last_month_start}, ${dh.last_month_end_exclusive}): created_non_cancelled=${lastMonthCreatedNonCancelled}, delivered_in_interval=${lastMonthDelivered}`,
  });

  const lastQuarterCreatedNonCancelled = queryScalar(
    db,
    `SELECT COUNT(*) FROM orders WHERE status <> 'cancelled' AND created_at >= '${dh.last_quarter_start}' AND created_at < '${dh.last_quarter_end_exclusive}';`
  );
  const lastQuarterDelivered = queryScalar(
    db,
    `SELECT COUNT(*) FROM orders WHERE delivered_at >= '${dh.last_quarter_start}' AND delivered_at < '${dh.last_quarter_end_exclusive}';`
  );

  checks.push({
    id: 'coverage_last_complete_quarter',
    name: 'Last complete quarter has >= 10 non-cancelled orders (created_at) and >= 3 delivered orders (delivered_at)',
    category: 'coverage',
    passed: lastQuarterCreatedNonCancelled >= 10 && lastQuarterDelivered >= 3,
    details: `[${dh.last_quarter_start}, ${dh.last_quarter_end_exclusive}): created_non_cancelled=${lastQuarterCreatedNonCancelled}, delivered_in_interval=${lastQuarterDelivered}`,
  });

  const rolling30DaysOrders = queryScalar(
    db,
    `SELECT COUNT(*) FROM orders WHERE created_at >= '${daysAgo29}' AND created_at < '${tomorrow}';`
  );

  checks.push({
    id: 'coverage_rolling_30_days',
    name: 'At least 15 orders have created_at in [today-29, today+1)',
    category: 'coverage',
    passed: rolling30DaysOrders >= 15,
    details: `[${daysAgo29}, ${tomorrow}) orders = ${rolling30DaysOrders}`,
  });

  const distinctStatusesRes = db.exec('SELECT DISTINCT status FROM orders ORDER BY status;');
  const statuses =
    distinctStatusesRes.length > 0
      ? distinctStatusesRes[0].values.map((r) => String(r[0]))
      : [];
  const expectedStatuses = ['cancelled', 'delivered', 'pending', 'shipped'];
  const statusesMatch =
    statuses.length === 4 && expectedStatuses.every((s, idx) => statuses[idx] === s);
  const ordersWithReturns = queryScalar(
    db,
    'SELECT COUNT(DISTINCT order_id) FROM returns;'
  );

  checks.push({
    id: 'coverage_statuses_and_returns',
    name: "All 4 valid statuses occur (no 'returned' status) and >= 10 orders have returns",
    category: 'coverage',
    passed: statusesMatch && ordersWithReturns >= 10,
    details: `statuses=[${statuses.join(', ')}], distinct_returned_orders=${ordersWithReturns}`,
  });

  const revLastMonthByCreated = queryScalar(
    db,
    `SELECT ROUND(COALESCE(SUM(oi.quantity * oi.unit_price * (1.0 - o.discount_pct / 100.0)), 0), 2)
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.order_id
     WHERE o.status <> 'cancelled'
       AND o.created_at >= '${dh.last_month_start}'
       AND o.created_at < '${dh.last_month_end_exclusive}';`
  );
  const revLastMonthByDelivered = queryScalar(
    db,
    `SELECT ROUND(COALESCE(SUM(oi.quantity * oi.unit_price * (1.0 - o.discount_pct / 100.0)), 0), 2)
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.order_id
     WHERE o.status <> 'cancelled'
       AND o.delivered_at >= '${dh.last_month_start}'
       AND o.delivered_at < '${dh.last_month_end_exclusive}';`
  );

  checks.push({
    id: 'distinguish_last_month_date_basis',
    name: 'Last complete month revenue differs between created_at vs delivered_at filtering',
    category: 'distinguishability',
    passed: Math.abs(revLastMonthByCreated - revLastMonthByDelivered) > 1,
    details: `by_created_at=$${revLastMonthByCreated.toFixed(2)} vs by_delivered_at=$${revLastMonthByDelivered.toFixed(2)}`,
  });

  const top3ByRevRes = db.exec(
    `SELECT o.customer_id
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.order_id
     WHERE o.status <> 'cancelled'
     GROUP BY o.customer_id
     ORDER BY SUM(oi.quantity * oi.unit_price * (1.0 - o.discount_pct / 100.0)) DESC, o.customer_id ASC
     LIMIT 3;`
  );
  const top3ByCountRes = db.exec(
    `SELECT o.customer_id
     FROM orders o
     GROUP BY o.customer_id
     ORDER BY COUNT(o.order_id) DESC, o.customer_id ASC
     LIMIT 3;`
  );
  const top3RevIds =
    top3ByRevRes.length > 0 ? top3ByRevRes[0].values.map((r) => Number(r[0])) : [];
  const top3CountIds =
    top3ByCountRes.length > 0 ? top3ByCountRes[0].values.map((r) => Number(r[0])) : [];
  const top3Differ =
    top3RevIds.length === 3 &&
    top3CountIds.length === 3 &&
    top3RevIds.join(',') !== top3CountIds.join(',');

  checks.push({
    id: 'distinguish_top3_customers',
    name: 'Top 3 customers by revenue differ from Top 3 customers by order count',
    category: 'distinguishability',
    passed: top3Differ,
    details: `top3_by_revenue=[${top3RevIds.join(', ')}] vs top3_by_order_count=[${top3CountIds.join(', ')}]`,
  });

  const lqRevBeforeDiscount = queryScalar(
    db,
    `SELECT ROUND(COALESCE(SUM(oi.quantity * oi.unit_price), 0), 2)
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.order_id
     WHERE o.status <> 'cancelled'
       AND o.created_at >= '${dh.last_quarter_start}'
       AND o.created_at < '${dh.last_quarter_end_exclusive}';`
  );
  const lqRevenue = queryScalar(
    db,
    `SELECT ROUND(COALESCE(SUM(oi.quantity * oi.unit_price * (1.0 - o.discount_pct / 100.0)), 0), 2)
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.order_id
     WHERE o.status <> 'cancelled'
       AND o.created_at >= '${dh.last_quarter_start}'
       AND o.created_at < '${dh.last_quarter_end_exclusive}';`
  );
  const lqNetRevenue = queryScalar(
    db,
    `SELECT ROUND(COALESCE(SUM(oi.quantity * oi.unit_price * (1.0 - o.discount_pct / 100.0)), 0), 2)
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.order_id
     WHERE o.status <> 'cancelled'
       AND o.created_at >= '${dh.last_quarter_start}'
       AND o.created_at < '${dh.last_quarter_end_exclusive}'
       AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.order_id = o.order_id);`
  );

  const quarterVariantsDiffer =
    Math.abs(lqRevBeforeDiscount - lqRevenue) > 1 &&
    Math.abs(lqRevenue - lqNetRevenue) > 1 &&
    Math.abs(lqRevBeforeDiscount - lqNetRevenue) > 1;

  checks.push({
    id: 'distinguish_last_quarter_revenue_metrics',
    name: 'Last complete quarter revenue, net revenue, and revenue before discounts all differ',
    category: 'distinguishability',
    passed: quarterVariantsDiffer,
    details: `before_discounts=$${lqRevBeforeDiscount.toFixed(2)}, revenue=$${lqRevenue.toFixed(2)}, net_revenue=$${lqNetRevenue.toFixed(2)}`,
  });

  const allPassed = checks.every((c) => c.passed);

  return {
    allPassed,
    generatedForDate: dh.today,
    earliestOrderDate,
    wasmSource,
    setupSequence: [...setupSequence],
    tableCounts: {
      customers: customerCount,
      products: productCount,
      orders: orderCount,
      order_items: orderItemCount,
      returns: returnCount,
    },
    checks,
    completedAtMs: Math.max(1, Math.round(performance.now() - startTimeMs)),
  };
}

export function createAndSeedDatabase(
  SQL: SqlJsStatic,
  now: Date = new Date(),
  wasmSource: 'cdn' | 'public-fallback' | 'node-local' = 'cdn'
): { db: Database; initPayload: InitSuccessPayload } {
  const startTimeMs = performance.now();
  const setupSequence: string[] = [];

  const db = new SQL.Database();
  setupSequence.push('1. create database');

  db.run('PRAGMA foreign_keys = ON;');
  setupSequence.push('2. PRAGMA foreign_keys = ON');

  db.run(DDL_STATEMENTS);
  setupSequence.push('3. create tables');

  seedDeterministicData(db, now);
  setupSequence.push('4. seed deterministic dataset');

  const fkRes = db.exec('PRAGMA foreign_key_check;');
  const fkRowCount = fkRes.length > 0 ? fkRes[0].values.length : 0;
  if (fkRowCount > 0) {
    throw new Error(`PRAGMA foreign_key_check failed with ${fkRowCount} violation rows.`);
  }
  setupSequence.push('5. PRAGMA foreign_key_check (0 rows)');

  setupSequence.push('6. TRUSTED SEED VALIDATION');
  const seedReport = runTrustedSeedValidation(db, now, wasmSource, setupSequence, startTimeMs);

  setupSequence.push('7. load schema context');

  db.run('PRAGMA query_only = ON;');
  setupSequence.push('8. PRAGMA query_only = ON');

  const schemaContext = loadSchemaContextFromDb(db);
  seedReport.setupSequence = [...setupSequence];

  seedReport.checks.push({
    id: 'connection_setup_pragmas',
    name: 'Connection setup sequence completed with PRAGMA foreign_keys = ON and PRAGMA query_only = ON',
    category: 'connection_setup',
    passed: schemaContext.pragmaForeignKeys && schemaContext.pragmaQueryOnly,
    details: `foreign_keys=${schemaContext.pragmaForeignKeys}, query_only=${schemaContext.pragmaQueryOnly}`,
  });
  seedReport.allPassed = seedReport.checks.every((c) => c.passed);

  return {
    db,
    initPayload: {
      seedReport,
      schemaContext,
    },
  };
}

function seedDeterministicData(db: Database, now: Date): void {
  const rng = createDeterministicRng(0x56494d41);
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const currentDay = now.getDate();
  const dh = getDateHelpers(now);
  const earliestOrderDate = formatLocalYMD(year, monthIndex - 11, 1);

  db.run('BEGIN TRANSACTION;');

  try {
    const insertCustomerStmt = db.prepare(
      'INSERT INTO customers (customer_id, name, email, city, state, signup_date, segment) VALUES (?, ?, ?, ?, ?, ?, ?);'
    );
    for (let i = 0; i < CUSTOMER_DATA.length; i++) {
      const c = CUSTOMER_DATA[i];
      const customerId = i + 1;
      const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '.');
      const email = `${slug}.${customerId}@example-analytics.org`;
      const signupOffsetDays = Math.floor(rng() * 60);
      const signupDate = minYMD(dh.today, addDaysYMD(earliestOrderDate, signupOffsetDays));
      insertCustomerStmt.run([
        customerId,
        c.name,
        email,
        c.city,
        c.state,
        signupDate,
        c.segment,
      ]);
    }
    insertCustomerStmt.free();

    const insertProductStmt = db.prepare(
      'INSERT INTO products (product_id, name, category, price, cost) VALUES (?, ?, ?, ?, ?);'
    );
    for (let i = 0; i < PRODUCT_DATA.length; i++) {
      const p = PRODUCT_DATA[i];
      insertProductStmt.run([i + 1, p.name, p.category, p.price, p.cost]);
    }
    insertProductStmt.free();

    const customerPool: number[] = [];
    for (let cid = 1; cid <= 3; cid++) {
      for (let k = 0; k < 4; k++) customerPool.push(cid);
    }
    const highFreqCounts = [16, 15, 14];
    for (let idx = 0; idx < 3; idx++) {
      const cid = 4 + idx;
      for (let k = 0; k < highFreqCounts[idx]; k++) customerPool.push(cid);
    }
    while (customerPool.length < 300) {
      for (let cid = 7; cid <= 40 && customerPool.length < 300; cid++) {
        customerPool.push(cid);
      }
    }
    for (let i = customerPool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = customerPool[i];
      customerPool[i] = customerPool[j];
      customerPool[j] = tmp;
    }

    interface OrderSpec {
      orderId: number;
      customerId: number;
      status: 'pending' | 'shipped' | 'delivered' | 'cancelled';
      createdAt: string;
      shippedAt: string | null;
      deliveredAt: string | null;
      discountPct: number;
      monthOffset: number;
    }

    const orders: OrderSpec[] = [];
    let nextOrderId = 1;

    for (let k = 11; k >= 0; k--) {
      const bucketSize = k === 1 ? 36 : 24;
      const bucketYear = new Date(year, monthIndex - k, 1, 12, 0, 0).getFullYear();
      const bucketMonth = new Date(year, monthIndex - k, 1, 12, 0, 0).getMonth();
      const maxDayInMonth = k === 0 ? currentDay : daysInMonthLocal(bucketYear, bucketMonth);

      for (let idx = 0; idx < bucketSize; idx++) {
        const orderId = nextOrderId++;
        const customerId = customerPool[orderId - 1];

        let dayOfMonth: number;
        if (k === 0) {
          const minDay = Math.max(1, currentDay - 28);
          dayOfMonth = minDay + (idx % (currentDay - minDay + 1));
        } else if (k === 2 && idx >= bucketSize - 3) {
          dayOfMonth = maxDayInMonth;
        } else {
          dayOfMonth = 1 + ((idx * 3 + Math.floor(rng() * 3)) % maxDayInMonth);
        }

        const createdAt = formatLocalYMD(bucketYear, bucketMonth, dayOfMonth);

        let status: 'pending' | 'shipped' | 'delivered' | 'cancelled';
        if (customerId <= 3) {
          status = 'delivered';
        } else if (k === 2 && idx >= bucketSize - 3) {
          status = 'delivered';
        } else if (k === 0) {
          if (idx < 10) status = 'delivered';
          else if (idx < 15) status = 'shipped';
          else if (idx < 20) status = 'pending';
          else status = 'cancelled';
        } else {
          const mod = idx % 12;
          if (mod < 9) status = 'delivered';
          else if (mod === 9) status = 'shipped';
          else if (mod === 10) status = 'pending';
          else status = 'cancelled';
        }

        let shippedAt: string | null = null;
        let deliveredAt: string | null = null;

        if (status === 'shipped') {
          const shipLag = k === 0 ? 0 : 1 + (idx % 2);
          shippedAt = minYMD(dh.today, addDaysYMD(createdAt, shipLag));
        } else if (status === 'delivered') {
          if (k === 2 && idx >= bucketSize - 3) {
            shippedAt = minYMD(dh.today, addDaysYMD(createdAt, 1));
            deliveredAt = minYMD(dh.today, addDaysYMD(shippedAt, 2));
          } else if (k === 0) {
            shippedAt = minYMD(dh.today, createdAt);
            deliveredAt = minYMD(dh.today, shippedAt);
          } else {
            const shipLag = 1 + (idx % 2);
            const delivLag = 1 + (idx % 3);
            shippedAt = minYMD(dh.today, addDaysYMD(createdAt, shipLag));
            deliveredAt = minYMD(dh.today, addDaysYMD(shippedAt, delivLag));
          }
        }

        const discountOptions = [0, 0, 5, 10, 15, 20];
        const discountPct =
          customerId <= 3 ? 0 : discountOptions[(orderId + idx) % discountOptions.length];

        orders.push({
          orderId,
          customerId,
          status,
          createdAt,
          shippedAt,
          deliveredAt,
          discountPct,
          monthOffset: k,
        });
      }
    }

    const insertOrderStmt = db.prepare(
      'INSERT INTO orders (order_id, customer_id, status, created_at, shipped_at, delivered_at, discount_pct) VALUES (?, ?, ?, ?, ?, ?, ?);'
    );
    for (const o of orders) {
      insertOrderStmt.run([
        o.orderId,
        o.customerId,
        o.status,
        o.createdAt,
        o.shippedAt,
        o.deliveredAt,
        o.discountPct,
      ]);
    }
    insertOrderStmt.free();

    const itemCountsPerOrder = new Array<number>(300).fill(1);
    let totalItemsAssigned = 300;

    for (let i = 0; i < 300; i++) {
      const cid = orders[i].customerId;
      if (cid <= 3) {
        itemCountsPerOrder[i] = 4;
        totalItemsAssigned += 3;
      }
    }

    let cursor = 0;
    while (totalItemsAssigned < 700) {
      const oIdx = cursor % 300;
      const cid = orders[oIdx].customerId;
      if (cid >= 7 && itemCountsPerOrder[oIdx] < 4) {
        itemCountsPerOrder[oIdx] += 1;
        totalItemsAssigned += 1;
      }
      cursor++;
    }

    const insertItemStmt = db.prepare(
      'INSERT INTO order_items (item_id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?);'
    );
    let nextItemId = 1;
    for (let i = 0; i < 300; i++) {
      const o = orders[i];
      const count = itemCountsPerOrder[i];
      for (let j = 0; j < count; j++) {
        let productId: number;
        let quantity: number;

        if (o.customerId <= 3) {
          productId = (j % 2) + 1;
          quantity = 5;
        } else if (o.customerId >= 4 && o.customerId <= 6) {
          productId = 6 + (o.orderId % 5);
          quantity = 1;
        } else {
          productId = 3 + ((o.orderId * 7 + j * 5) % 23);
          quantity = 1 + ((o.orderId + j) % 3);
        }

        const unitPrice = PRODUCT_DATA[productId - 1].price;
        insertItemStmt.run([nextItemId++, o.orderId, productId, quantity, unitPrice]);
      }
    }
    insertItemStmt.free();

    const deliveredOrders = orders.filter(
      (o) => o.status === 'delivered' && o.deliveredAt !== null && o.customerId >= 7
    );
    const inLastQuarterDelivered = deliveredOrders.filter(
      (o) =>
        o.createdAt >= dh.last_quarter_start &&
        o.createdAt < dh.last_quarter_end_exclusive
    );
    const otherDelivered = deliveredOrders.filter(
      (o) =>
        !(
          o.createdAt >= dh.last_quarter_start &&
          o.createdAt < dh.last_quarter_end_exclusive
        )
    );

    const selectedForReturn: OrderSpec[] = [
      ...inLastQuarterDelivered.slice(0, 10),
      ...otherDelivered.slice(0, 18),
    ];

    const insertReturnStmt = db.prepare(
      'INSERT INTO returns (return_id, order_id, reason, returned_at) VALUES (?, ?, ?, ?);'
    );
    let nextReturnId = 1;
    for (let i = 0; i < selectedForReturn.length; i++) {
      const o = selectedForReturn[i];
      const deliveredAt = o.deliveredAt!;
      const returnLag = 1 + (i % 4);
      const returnedAt = maxYMD(
        deliveredAt,
        minYMD(dh.today, addDaysYMD(deliveredAt, returnLag))
      );
      const reason = RETURN_REASONS[i % RETURN_REASONS.length];
      insertReturnStmt.run([nextReturnId++, o.orderId, reason, returnedAt]);
    }
    insertReturnStmt.free();

    db.run('COMMIT;');
  } catch (err) {
    db.run('ROLLBACK;');
    throw err;
  }
}
