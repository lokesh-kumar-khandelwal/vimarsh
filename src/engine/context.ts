import type { GlossaryEntry, JoinHint } from '../types';

export const DB_DIALECT = 'SQLite' as const;

export const ENUM_VALUES: Record<string, readonly string[]> = {
  'orders.status': ['pending', 'shipped', 'delivered', 'cancelled'],
  'customers.segment': ['Consumer', 'Corporate', 'Small Business'],
  'products.category': ['Electronics', 'Clothing', 'Home', 'Books', 'Sports'],
  'returns.reason': ['defective', 'wrong_item', 'not_needed', 'late_delivery'],
} as const;

export const FREE_FORM_TEXT_COLUMNS: readonly string[] = [
  'customers.name',
  'customers.city',
  'customers.state',
  'products.name',
] as const;

export const SENSITIVE_COLUMNS: readonly string[] = ['customers.email'] as const;

export const SENSITIVE_COLUMN_NAMES: readonly string[] = ['email'] as const;

export function isSensitiveIdentifier(identifier: string): boolean {
  const cleaned = identifier
    .trim()
    .replace(/^[`"[\s]+|[`"\s\]]+$/g, '')
    .toLowerCase();
  if (!cleaned) return false;
  if (SENSITIVE_COLUMNS.includes(cleaned)) return true;
  const parts = cleaned.split('.').map((p) => p.replace(/^[`"[\s]+|[`"\s\]]+$/g, ''));
  const colName = parts[parts.length - 1];
  return SENSITIVE_COLUMN_NAMES.includes(colName);
}

export const JOIN_HINTS: JoinHint[] = [
  {
    leftTable: 'orders',
    leftColumn: 'customer_id',
    rightTable: 'customers',
    rightColumn: 'customer_id',
    expression: 'orders.customer_id = customers.customer_id',
    description: 'Link each order to the customer who placed it.',
  },
  {
    leftTable: 'order_items',
    leftColumn: 'order_id',
    rightTable: 'orders',
    rightColumn: 'order_id',
    expression: 'order_items.order_id = orders.order_id',
    description: 'Link line items to their parent order header.',
  },
  {
    leftTable: 'order_items',
    leftColumn: 'product_id',
    rightTable: 'products',
    rightColumn: 'product_id',
    expression: 'order_items.product_id = products.product_id',
    description: 'Link line items to the catalog product.',
  },
  {
    leftTable: 'returns',
    leftColumn: 'order_id',
    rightTable: 'orders',
    rightColumn: 'order_id',
    expression: 'returns.order_id = orders.order_id',
    description: 'Link return records to the delivered order that was returned.',
  },
];

export const TABLE_DESCRIPTIONS: Record<string, string> = {
  customers: 'Registered customers across Consumer, Corporate, and Small Business segments.',
  products: 'Product catalog with current list price and unit cost across five categories.',
  orders: 'Order headers tracking lifecycle status, timestamps, and order-level discount percentage.',
  order_items: 'Individual line items within an order, storing quantity and pre-discount list unit_price.',
  returns: 'Post-delivery return records linked to delivered orders (an order is returned if it has >= 1 row here).',
};

export const COLUMN_DESCRIPTIONS: Record<string, string> = {
  'customers.customer_id': 'Primary key identifying the customer.',
  'customers.name': 'Full customer or account contact name (FREE-FORM text).',
  'customers.email': 'RESTRICTED SENSITIVE PII: Customer email address. Never query or expose.',
  'customers.city': 'Customer city (FREE-FORM text).',
  'customers.state': 'Two-letter US state code (FREE-FORM text).',
  'customers.signup_date': 'Local calendar date (YYYY-MM-DD) when the customer signed up.',
  'customers.segment': 'Customer segment enum: Consumer, Corporate, or Small Business.',

  'products.product_id': 'Primary key identifying the product.',
  'products.name': 'Catalog product title (FREE-FORM text).',
  'products.category': 'Product category enum: Electronics, Clothing, Home, Books, or Sports.',
  'products.price': 'Current catalog list price in USD.',
  'products.cost': 'Unit wholesale cost in USD (always less than price).',

  'orders.order_id': 'Primary key identifying the order.',
  'orders.customer_id': 'Foreign key referencing customers.customer_id.',
  'orders.status': "Order lifecycle status enum: 'pending', 'shipped', 'delivered', or 'cancelled'. Never 'returned'.",
  'orders.created_at': 'Local calendar date (YYYY-MM-DD) when the order was created (always set).',
  'orders.shipped_at': 'Local calendar date (YYYY-MM-DD) when shipped; NULL for pending and cancelled orders.',
  'orders.delivered_at': 'Local calendar date (YYYY-MM-DD) when delivered; NULL unless status is delivered.',
  'orders.discount_pct': 'Order-level percentage discount (0 to 100) applied to all items in the order.',

  'order_items.item_id': 'Primary key identifying the order line item.',
  'order_items.order_id': 'Foreign key referencing orders.order_id.',
  'order_items.product_id': 'Foreign key referencing products.product_id.',
  'order_items.quantity': 'Integer units ordered for this line item.',
  'order_items.unit_price': 'List price per unit BEFORE discount at the time of order.',

  'returns.return_id': 'Primary key identifying the return record.',
  'returns.order_id': 'Foreign key referencing orders.order_id (only delivered orders can have returns).',
  'returns.reason': 'Return reason enum: defective, wrong_item, not_needed, or late_delivery.',
  'returns.returned_at': 'Local calendar date (YYYY-MM-DD) when the return was filed (>= delivered_at).',
};

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: 'revenue',
    category: 'metric',
    definition:
      "Total discounted order value over non-cancelled orders (status <> 'cancelled'). Returned orders still count.",
    formulaOrRule:
      "SUM(order_items.quantity * order_items.unit_price * (1 - orders.discount_pct / 100.0)) WHERE orders.status <> 'cancelled'",
  },
  {
    term: 'revenue before discounts',
    category: 'metric',
    definition:
      "Gross order value before order-level discount_pct over non-cancelled orders (status <> 'cancelled').",
    formulaOrRule:
      "SUM(order_items.quantity * order_items.unit_price) WHERE orders.status <> 'cancelled'",
  },
  {
    term: 'net revenue',
    category: 'metric',
    definition:
      'Discounted revenue over non-cancelled orders, excluding any order that has at least one row in the returns table.',
    formulaOrRule:
      "SUM(order_items.quantity * order_items.unit_price * (1 - orders.discount_pct / 100.0)) WHERE orders.status <> 'cancelled' AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.order_id = orders.order_id)",
  },
  {
    term: 'returned order',
    category: 'entity',
    definition:
      "An order that has at least one row in the returns table. There is NO 'returned' value in orders.status; returns exist only for delivered orders.",
    formulaOrRule: 'EXISTS (SELECT 1 FROM returns r WHERE r.order_id = orders.order_id)',
  },
  {
    term: 'active customer',
    category: 'entity',
    definition:
      'A customer with at least one non-cancelled order created in the last 90 days.',
    formulaOrRule:
      "orders.status <> 'cancelled' AND orders.created_at >= {{days_ago_90}} AND orders.created_at <= {{today}}",
  },
  {
    term: 'DATE BASIS (1): Status + Period',
    category: 'date_rule',
    definition:
      'A status word combined with a period ("delivered orders last month", "shipped orders in March") applies the period to that status\'s own timestamp.',
    formulaOrRule:
      'delivered -> orders.delivered_at; shipped -> orders.shipped_at; cancelled and pending -> orders.created_at',
  },
  {
    term: 'DATE BASIS (2): Revenue Default',
    category: 'date_rule',
    definition:
      'Revenue questions with no status or timing word default to filtering/grouping by orders.created_at.',
    formulaOrRule: 'Default date column for revenue: orders.created_at',
  },
  {
    term: 'DATE BASIS (3): Return Timing',
    category: 'date_rule',
    definition:
      'Questions specifically about when returns occurred ("returns last month") use returns.returned_at.',
    formulaOrRule: 'Return timing column: returns.returned_at',
  },
  {
    term: 'DATE BASIS (4): Ambiguous Order Dates',
    category: 'date_rule',
    definition:
      'Order counts, listings, and other order metrics that have a period or time grouping ("orders last month", "orders by date") but no stated date column and no status word have NO default date: they are ambiguous and require clarification.',
    formulaOrRule: 'Clarify between orders.created_at, orders.shipped_at, and orders.delivered_at',
  },
  {
    term: 'Top N Default',
    category: 'default_rule',
    definition:
      '"Top N" (e.g., "top customers by revenue") defaults to LIMIT 10 only when the ranking metric itself is unambiguous.',
    formulaOrRule: 'Default N = 10 when metric is specified; if ranking metric is missing, CLARIFY.',
  },
  {
    term: 'All-Time Default',
    category: 'default_rule',
    definition:
      'Totals and rankings for revenue, order counts, or customer counts with no time wording are answered over all time and stated in assumptions.',
    formulaOrRule: 'No date filter applied; include "All-time period assumed" in assumptions.',
  },
];
