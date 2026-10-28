import { Parser } from 'node-sql-parser/build/sqlite';

export interface ParserSmokeTestResult {
  compatible: boolean;
  sampleSql: string;
  tables: string[];
  columns: string[];
  statementType: string;
  error?: string;
}

export function runParserSmokeTest(): ParserSmokeTestResult {
  const sampleSql =
    "SELECT c.customer_id, c.name, o.created_at FROM customers AS c JOIN orders AS o ON c.customer_id = o.customer_id WHERE o.status = 'delivered' LIMIT 10";

  try {
    const parser = new Parser();
    const astResult = parser.astify(sampleSql, { database: 'sqlite' });
    const ast = Array.isArray(astResult) ? astResult[0] : astResult;
    const tableList = parser.tableList(sampleSql, { database: 'sqlite' });
    const columnList = parser.columnList(sampleSql, { database: 'sqlite' });

    const tables = tableList.map((entry: string) => {
      const parts = entry.split('::');
      return parts[parts.length - 1];
    });

    const columns = columnList.map((entry: string) => {
      const parts = entry.split('::');
      return parts[parts.length - 1];
    });

    const statementType = ast && typeof ast === 'object' && 'type' in ast ? String(ast.type) : 'unknown';

    const compatible =
      statementType.toLowerCase() === 'select' &&
      tables.includes('customers') &&
      tables.includes('orders') &&
      columns.includes('customer_id') &&
      columns.includes('name') &&
      columns.includes('created_at') &&
      columns.includes('status');

    return {
      compatible,
      sampleSql,
      tables,
      columns,
      statementType,
      ...(compatible ? {} : { error: 'AST / tableList / columnList did not match expected sample query output.' }),
    };
  } catch (err) {
    return {
      compatible: false,
      sampleSql,
      tables: [],
      columns: [],
      statementType: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
