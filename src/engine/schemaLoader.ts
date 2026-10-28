import type { Database } from 'sql.js';
import type { ColumnSchema, ForeignKeyInfo, SchemaContext, TableSchema } from '../types';
import {
  COLUMN_DESCRIPTIONS,
  DB_DIALECT,
  ENUM_VALUES,
  FREE_FORM_TEXT_COLUMNS,
  GLOSSARY,
  JOIN_HINTS,
  SENSITIVE_COLUMNS,
  TABLE_DESCRIPTIONS,
} from './context';

function queryScalarNumber(db: Database, sql: string): number {
  const res = db.exec(sql);
  if (!res.length || !res[0].values.length) return 0;
  return Number(res[0].values[0][0] ?? 0);
}

export function loadSchemaContextFromDb(db: Database): SchemaContext {
  const masterRes = db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid ASC;"
  );

  const tableNames: string[] =
    masterRes.length > 0
      ? masterRes[0].values.map((row) => String(row[0]))
      : [];

  const tables: TableSchema[] = tableNames.map((tableName) => {
    const fkRes = db.exec(`PRAGMA foreign_key_list("${tableName}");`);
    const foreignKeys: ForeignKeyInfo[] =
      fkRes.length > 0
        ? fkRes[0].values.map((row) => ({
            id: Number(row[0]),
            seq: Number(row[1]),
            toTable: String(row[2]),
            fromColumn: String(row[3]),
            toColumn: String(row[4]),
            onUpdate: String(row[5]),
            onDelete: String(row[6]),
          }))
        : [];

    const fkByColumn = new Map<string, { toTable: string; toColumn: string }>();
    for (const fk of foreignKeys) {
      fkByColumn.set(fk.fromColumn, { toTable: fk.toTable, toColumn: fk.toColumn });
    }

    const colRes = db.exec(`PRAGMA table_info("${tableName}");`);
    const columns: ColumnSchema[] =
      colRes.length > 0
        ? colRes[0].values.map((row) => {
            const cid = Number(row[0]);
            const name = String(row[1]);
            const type = String(row[2]);
            const notNull = Number(row[3]) === 1;
            const defaultValue = row[4] === null || row[4] === undefined ? null : String(row[4]);
            const isPrimaryKey = Number(row[5]) > 0;
            const qualified = `${tableName}.${name}`;
            const enumValues = ENUM_VALUES[qualified];
            const isFreeFormText = FREE_FORM_TEXT_COLUMNS.includes(qualified);
            const isSensitive = SENSITIVE_COLUMNS.includes(qualified);
            const fk = fkByColumn.get(name);

            return {
              cid,
              name,
              type,
              notNull,
              defaultValue,
              isPrimaryKey,
              description: COLUMN_DESCRIPTIONS[qualified] ?? '',
              isSensitive,
              ...(enumValues ? { enumValues } : {}),
              ...(isFreeFormText ? { isFreeFormText: true } : {}),
              ...(fk ? { foreignKey: fk } : {}),
            };
          })
        : [];

    const rowCount = queryScalarNumber(db, `SELECT COUNT(*) FROM "${tableName}";`);

    return {
      name: tableName,
      description: TABLE_DESCRIPTIONS[tableName] ?? '',
      rowCount,
      columns,
      foreignKeys,
    };
  });

  const pragmaForeignKeys = queryScalarNumber(db, 'PRAGMA foreign_keys;') === 1;
  const pragmaQueryOnly = queryScalarNumber(db, 'PRAGMA query_only;') === 1;

  return {
    dialect: DB_DIALECT,
    tables,
    joinHints: JOIN_HINTS,
    enumValues: ENUM_VALUES,
    freeFormColumns: FREE_FORM_TEXT_COLUMNS,
    glossary: GLOSSARY,
    sensitiveColumns: SENSITIVE_COLUMNS,
    pragmaQueryOnly,
    pragmaForeignKeys,
  };
}
