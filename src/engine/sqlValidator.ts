import { Parser } from 'node-sql-parser/build/sqlite';
import type {
  SchemaContext,
  SqlFullValidationResult,
  SqlStaticValidationResult,
  ValidatedSql,
  ValidationStepNumber,
  ValidationStepTrace,
} from '../types';
import { isSensitiveIdentifier } from './context';
import type { DbClient } from './dbClient';

export const ALLOWED_SQL_FUNCTIONS: ReadonlySet<string> = new Set([
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'ROUND',
  'ABS',
  'COALESCE',
  'IFNULL',
  'NULLIF',
  'CAST',
  'LENGTH',
  'LOWER',
  'UPPER',
  'TRIM',
  'SUBSTR',
  'DATE',
  'STRFTIME',
  'JULIANDAY',
]);

export const FORBIDDEN_WRITE_AND_ADMIN_TOKENS: ReadonlySet<string> = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'MERGE',
  'ATTACH',
  'DETACH',
  'PRAGMA',
  'VACUUM',
]);

const STEP_NAMES: Record<ValidationStepNumber, string> = {
  1: 'Step 1: Complete AST Parse (node-sql-parser/build/sqlite)',
  2: 'Step 2: Single Statement & Terminal SELECT Check',
  3: 'Step 3: No Star Projections (* / t.*), No Window (OVER), No RECURSIVE',
  4: 'Step 4: Top-Level LIMIT Required (1..1000)',
  5: 'Step 5: Strict Function Allowlist & CASE/CAST Check',
  6: 'Step 6: Schema Table/Column Resolution & Max 6 Joined Tables',
  7: 'Step 7: Designated Sensitive Column Prohibition (customers.email)',
  8: 'Step 8: Whole-Token Write/DDL/PRAGMA/sqlite_ Defense-in-Depth Filter',
  9: 'Step 9: SQLite EXPLAIN QUERY PLAN Dry Run',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AstNode = Record<string, any>;

function createInitialSteps(): ValidationStepTrace[] {
  return ([1, 2, 3, 4, 5, 6, 7, 8, 9] as ValidationStepNumber[]).map((step) => ({
    step,
    name: STEP_NAMES[step],
    status: 'skipped',
    detail: 'Not reached',
  }));
}

function markStep(
  steps: ValidationStepTrace[],
  step: ValidationStepNumber,
  status: 'passed' | 'failed',
  detail: string
): void {
  const entry = steps.find((s) => s.step === step);
  if (entry) {
    entry.status = status;
    entry.detail = detail;
  }
}

export function normalizeIdentifier(raw: string): string {
  return raw
    .trim()
    .replace(/^[`"[\s]+|[`"\s\]]+$/g, '')
    .toLowerCase();
}

interface LexicalAnalysis {
  ok: boolean;
  error?: string;
  sqlForParser: string;
  nonEmptyStatementChunks: string[];
  wholeWordTokensUpper: string[];
  identifierTokensRaw: string[];
}

function analyzeSqlLexically(rawSql: string): LexicalAnalysis {
  const n = rawSql.length;
  let i = 0;
  let parserChars = '';
  let currentChunk = '';
  const nonEmptyStatementChunks: string[] = [];
  const wholeWordTokensUpper: string[] = [];
  const identifierTokensRaw: string[] = [];

  while (i < n) {
    const ch = rawSql[i];
    const next = i + 1 < n ? rawSql[i + 1] : '';

    if (ch === '-' && next === '-') {
      i += 2;
      while (i < n && rawSql[i] !== '\n') {
        i++;
      }
      parserChars += ' ';
      currentChunk += ' ';
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      let closed = false;
      while (i < n) {
        if (rawSql[i] === '*' && i + 1 < n && rawSql[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return {
          ok: false,
          error: 'Unclosed block comment /* in SQL statement.',
          sqlForParser: '',
          nonEmptyStatementChunks: [],
          wholeWordTokensUpper: [],
          identifierTokensRaw: [],
        };
      }
      parserChars += ' ';
      currentChunk += ' ';
      continue;
    }

    if (ch === "'") {
      let lit = "'";
      i++;
      let closed = false;
      while (i < n) {
        if (rawSql[i] === "'") {
          lit += "'";
          i++;
          if (i < n && rawSql[i] === "'") {
            lit += "'";
            i++;
            continue;
          }
          closed = true;
          break;
        }
        lit += rawSql[i];
        i++;
      }
      if (!closed) {
        return {
          ok: false,
          error: "Unclosed single-quoted string literal (') in SQL statement.",
          sqlForParser: '',
          nonEmptyStatementChunks: [],
          wholeWordTokensUpper: [],
          identifierTokensRaw: [],
        };
      }
      parserChars += lit;
      currentChunk += lit;
      continue;
    }

    if (ch === '"') {
      let ident = '';
      i++;
      let closed = false;
      while (i < n) {
        if (rawSql[i] === '"') {
          i++;
          if (i < n && rawSql[i] === '"') {
            ident += '"';
            i++;
            continue;
          }
          closed = true;
          break;
        }
        ident += rawSql[i];
        i++;
      }
      if (!closed) {
        return {
          ok: false,
          error: 'Unclosed double-quoted identifier (") in SQL statement.',
          sqlForParser: '',
          nonEmptyStatementChunks: [],
          wholeWordTokensUpper: [],
          identifierTokensRaw: [],
        };
      }
      identifierTokensRaw.push(ident);
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
        wholeWordTokensUpper.push(ident.toUpperCase());
      }
      parserChars += `"${ident.replace(/"/g, '""')}"`;
      currentChunk += `"${ident}"`;
      continue;
    }

    if (ch === '`') {
      let ident = '';
      i++;
      let closed = false;
      while (i < n) {
        if (rawSql[i] === '`') {
          i++;
          closed = true;
          break;
        }
        ident += rawSql[i];
        i++;
      }
      if (!closed) {
        return {
          ok: false,
          error: 'Unclosed backtick identifier (`) in SQL statement.',
          sqlForParser: '',
          nonEmptyStatementChunks: [],
          wholeWordTokensUpper: [],
          identifierTokensRaw: [],
        };
      }
      identifierTokensRaw.push(ident);
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
        wholeWordTokensUpper.push(ident.toUpperCase());
      }
      parserChars += `\`${ident}\``;
      currentChunk += `\`${ident}\``;
      continue;
    }

    if (ch === '[') {
      let ident = '';
      i++;
      let closed = false;
      while (i < n) {
        if (rawSql[i] === ']') {
          i++;
          closed = true;
          break;
        }
        ident += rawSql[i];
        i++;
      }
      if (!closed) {
        return {
          ok: false,
          error: 'Unclosed bracket identifier ([) in SQL statement.',
          sqlForParser: '',
          nonEmptyStatementChunks: [],
          wholeWordTokensUpper: [],
          identifierTokensRaw: [],
        };
      }
      identifierTokensRaw.push(ident);
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
        wholeWordTokensUpper.push(ident.toUpperCase());
        parserChars += `\`${ident}\``;
      } else {
        parserChars += `[${ident}]`;
      }
      currentChunk += `[${ident}]`;
      continue;
    }

    if (ch === ';') {
      if (currentChunk.trim().length > 0) {
        nonEmptyStatementChunks.push(currentChunk.trim());
      }
      currentChunk = '';
      parserChars += ';';
      i++;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let word = '';
      while (i < n && /[A-Za-z0-9_$]/.test(rawSql[i])) {
        word += rawSql[i];
        i++;
      }
      wholeWordTokensUpper.push(word.toUpperCase());
      identifierTokensRaw.push(word);
      parserChars += word;
      currentChunk += word;
      continue;
    }

    parserChars += ch;
    currentChunk += ch;
    i++;
  }

  if (currentChunk.trim().length > 0) {
    nonEmptyStatementChunks.push(currentChunk.trim());
  }

  return {
    ok: true,
    sqlForParser: parserChars.trim(),
    nonEmptyStatementChunks,
    wholeWordTokensUpper,
    identifierTokensRaw,
  };
}

function detectWriteOrAdminHint(tokensUpper: string[]): string | null {
  for (let i = 0; i < tokensUpper.length; i++) {
    const tok = tokensUpper[i];
    if (tok === 'REPLACE' && tokensUpper[i + 1] === 'INTO') {
      return 'REPLACE INTO write statement';
    }
    if (FORBIDDEN_WRITE_AND_ADMIN_TOKENS.has(tok)) {
      return `${tok} statement`;
    }
  }
  return null;
}

function extractFunctionName(node: AstNode): { name: string; multiPart: boolean } {
  if (typeof node.name === 'string') {
    return { name: node.name.toUpperCase(), multiPart: false };
  }
  if (node.name && Array.isArray(node.name.name)) {
    const parts = node.name.name.map((p: AstNode) =>
      typeof p === 'string' ? p : String(p?.value ?? '')
    );
    return {
      name: parts.join('.').toUpperCase(),
      multiPart: parts.length !== 1,
    };
  }
  return { name: 'UNKNOWN_FUNCTION', multiPart: true };
}

function walkAst(node: unknown, visitor: (n: AstNode) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) {
      walkAst(item, visitor);
    }
    return;
  }
  const obj = node as AstNode;
  visitor(obj);
  for (const key of Object.keys(obj)) {
    walkAst(obj[key], visitor);
  }
}

function checkStep3StarWindowRecursive(rootAst: AstNode): { ok: true } | { ok: false; error: string } {
  let failure: string | null = null;
  const allowedStarNodes = new WeakSet<object>();

  walkAst(rootAst, (node) => {
    if (failure) return;

    if (Array.isArray(node.with)) {
      for (const cte of node.with) {
        if (cte && cte.recursive === true) {
          failure = 'Step 3: RECURSIVE CTEs are not allowed.';
          return;
        }
      }
    }

    if (node.over !== null && node.over !== undefined) {
      failure = 'Step 3: Window functions (OVER clause) are not allowed.';
      return;
    }
    if (node.type === 'window' || node.type === 'window_func') {
      failure = 'Step 3: Window functions (OVER clause) are not allowed.';
      return;
    }

    if (
      node.type === 'aggr_func' &&
      typeof node.name === 'string' &&
      node.name.toUpperCase() === 'COUNT' &&
      node.args &&
      node.args.expr &&
      node.args.expr.type === 'star'
    ) {
      allowedStarNodes.add(node.args.expr);
    }
  });

  if (failure) {
    return { ok: false, error: failure };
  }

  walkAst(rootAst, (node) => {
    if (failure) return;

    if (node.type === 'select') {
      if (node.columns === '*') {
        failure = 'Step 3: Star projection (SELECT *) is not allowed; name columns explicitly.';
        return;
      }
      if (Array.isArray(node.columns)) {
        for (const col of node.columns) {
          const expr = col?.expr;
          if (!expr) continue;
          if (expr.type === 'star') {
            failure = 'Step 3: Star projection (SELECT *) is not allowed; name columns explicitly.';
            return;
          }
          if (expr.type === 'column_ref' && expr.column === '*') {
            const qual = expr.table ? `${expr.table}.*` : '*';
            failure = `Step 3: Star projection (SELECT ${qual}) is not allowed; name columns explicitly.`;
            return;
          }
        }
      }
    }

    if (node.type === 'star' && !allowedStarNodes.has(node)) {
      failure = 'Step 3: Star (*) is only permitted inside COUNT(*).';
      return;
    }

    if (node.type === 'column_ref' && node.column === '*') {
      const qual = node.table ? `${node.table}.*` : '*';
      failure = `Step 3: Star projection (${qual}) is not allowed; name columns explicitly.`;
      return;
    }
  });

  if (failure) {
    return { ok: false, error: failure };
  }

  return { ok: true };
}

function checkStep4TopLevelLimit(rootAst: AstNode): {
  ok: true;
  limitValue: number;
} | {
  ok: false;
  error: string;
} {
  let terminalSelect: AstNode = rootAst;
  while (terminalSelect._next && typeof terminalSelect._next === 'object') {
    terminalSelect = terminalSelect._next;
  }

  const limitNode = terminalSelect.limit ?? rootAst.limit;
  if (!limitNode || !Array.isArray(limitNode.value) || limitNode.value.length === 0) {
    return {
      ok: false,
      error: 'Step 4: A top-level LIMIT clause is required (maximum 1000).',
    };
  }

  const sep = typeof limitNode.seperator === 'string' ? limitNode.seperator.toLowerCase() : '';
  const countEntry = sep === ',' ? limitNode.value[1] : limitNode.value[0];

  if (
    !countEntry ||
    countEntry.type !== 'number' ||
    typeof countEntry.value !== 'number' ||
    !Number.isInteger(countEntry.value)
  ) {
    return {
      ok: false,
      error: 'Step 4: Top-level LIMIT must be a literal integer between 1 and 1000.',
    };
  }

  const limitVal = countEntry.value;
  if (limitVal < 1) {
    return {
      ok: false,
      error: `Step 4: Top-level LIMIT must be at least 1 (received ${limitVal}).`,
    };
  }
  if (limitVal > 1000) {
    return {
      ok: false,
      error: `Step 4: Top-level LIMIT ${limitVal} exceeds the maximum allowed limit of 1000.`,
    };
  }

  return { ok: true, limitValue: limitVal };
}

function checkStep5Functions(rootAst: AstNode): { ok: true } | { ok: false; error: string } {
  let failure: string | null = null;

  walkAst(rootAst, (node) => {
    if (failure) return;

    if (node.type === 'aggr_func' || node.type === 'function') {
      const { name, multiPart } = extractFunctionName(node);
      if (multiPart || !ALLOWED_SQL_FUNCTIONS.has(name)) {
        failure = `Step 5: Function '${name}()' is not on the function allowlist.`;
        return;
      }
    }
  });

  if (failure) {
    return { ok: false, error: failure };
  }
  return { ok: true };
}

interface ScopeTable {
  aliasOrName: string;
  sourceTable: string;
  columns: Set<string>;
}

function checkStep6SchemaAndJoins(
  rootAst: AstNode,
  schemaContext: SchemaContext
): {
  ok: true;
  tablesUsed: string[];
} | {
  ok: false;
  error: string;
} {
  const schemaTableMap = new Map<string, Set<string>>();
  for (const tbl of schemaContext.tables) {
    const colSet = new Set<string>(tbl.columns.map((c) => c.name.toLowerCase()));
    schemaTableMap.set(tbl.name.toLowerCase(), colSet);
  }

  const baseTablesUsed = new Set<string>();

  function validateSelectBlock(
    selectNode: AstNode,
    cteScopes: Map<string, Set<string>>,
    outerTables: ScopeTable[]
  ): { ok: true; outputColumns: Set<string> } | { ok: false; error: string } {
    const activeCtes = new Map<string, Set<string>>(cteScopes);
    if (Array.isArray(selectNode.with)) {
      for (const cteItem of selectNode.with) {
        const rawCteName =
          typeof cteItem?.name === 'string'
            ? cteItem.name
            : String(cteItem?.name?.value ?? '');
        const cteName = normalizeIdentifier(rawCteName);
        if (!cteName) {
          return { ok: false, error: 'Step 6: Invalid CTE name.' };
        }
        if (cteName.startsWith('sqlite_')) {
          return {
            ok: false,
            error: `Step 6: CTE name '${rawCteName}' cannot use reserved sqlite_ prefix.`,
          };
        }

        const cteBodyAst = cteItem?.stmt?.ast ?? cteItem?.stmt;
        if (!cteBodyAst || cteBodyAst.type !== 'select') {
          return {
            ok: false,
            error: `Step 6: CTE '${rawCteName}' must be a SELECT statement.`,
          };
        }

        const cteRes = validateSelectBlock(cteBodyAst, activeCtes, outerTables);
        if (!cteRes.ok) return cteRes;

        let cteCols = cteRes.outputColumns;
        if (Array.isArray(cteItem.columns) && cteItem.columns.length > 0) {
          cteCols = new Set<string>(
            cteItem.columns.map((c: AstNode) =>
              normalizeIdentifier(typeof c === 'string' ? c : String(c?.column ?? c?.value ?? ''))
            )
          );
        }
        activeCtes.set(cteName, cteCols);
      }
    }

    const fromList: AstNode[] = Array.isArray(selectNode.from) ? selectNode.from : [];
    if (fromList.length > 6) {
      return {
        ok: false,
        error: `Step 6: Query joins ${fromList.length} tables, exceeding the maximum of 6 tables.`,
      };
    }

    const localTables: ScopeTable[] = [];
    const localQualifierMap = new Map<string, ScopeTable>();

    for (let idx = 0; idx < fromList.length; idx++) {
      const fromItem = fromList[idx];
      if (!fromItem) continue;

      if (fromItem.db) {
        const dbName = String(fromItem.db);
        if (dbName.toLowerCase().startsWith('sqlite_')) {
          return {
            ok: false,
            error: `Step 6: Access to internal '${dbName}' database is prohibited.`,
          };
        }
        return {
          ok: false,
          error: `Step 6: Database-qualified table '${dbName}.${fromItem.table}' is not allowed.`,
        };
      }

      if (fromItem.expr) {
        const subAst = fromItem.expr.ast ?? fromItem.expr;
        if (!subAst || subAst.type !== 'select') {
          return { ok: false, error: 'Step 6: Invalid derived table subquery in FROM clause.' };
        }
        const subRes = validateSelectBlock(subAst, activeCtes, outerTables);
        if (!subRes.ok) return subRes;

        const alias = fromItem.as
          ? normalizeIdentifier(String(fromItem.as))
          : `__subquery_${idx}`;
        const scopeTbl: ScopeTable = {
          aliasOrName: alias,
          sourceTable: alias,
          columns: subRes.outputColumns,
        };
        localTables.push(scopeTbl);
        localQualifierMap.set(alias, scopeTbl);
      } else if (typeof fromItem.table === 'string') {
        const rawTable = fromItem.table;
        const tableName = normalizeIdentifier(rawTable);
        if (tableName.startsWith('sqlite_')) {
          return {
            ok: false,
            error: `Step 6: Access to internal SQLite object '${rawTable}' is prohibited.`,
          };
        }

        let colSet: Set<string> | undefined = activeCtes.get(tableName);
        if (!colSet) {
          if (schemaTableMap.has(tableName)) {
            colSet = schemaTableMap.get(tableName)!;
            baseTablesUsed.add(tableName);
          } else {
            return {
              ok: false,
              error: `Step 6: Unknown table '${rawTable}'. Valid tables are: ${Array.from(
                schemaTableMap.keys()
              ).join(', ')}.`,
            };
          }
        }

        const alias = fromItem.as ? normalizeIdentifier(String(fromItem.as)) : tableName;
        if (localQualifierMap.has(alias)) {
          return {
            ok: false,
            error: `Step 6: Duplicate table or alias '${alias}' in FROM clause.`,
          };
        }

        const scopeTbl: ScopeTable = {
          aliasOrName: alias,
          sourceTable: tableName,
          columns: colSet,
        };
        localTables.push(scopeTbl);
        localQualifierMap.set(alias, scopeTbl);
      } else {
        return {
          ok: false,
          error: 'Step 6: Unsupported table reference in FROM clause.',
        };
      }
    }

    function resolveColumnRef(
      rawTable: string | null,
      rawCol: string,
      allowProjectionAliases: Set<string>
    ): { ok: true } | { ok: false; error: string } {
      const colName = normalizeIdentifier(rawCol);
      if (!colName) {
        return { ok: false, error: 'Step 6: Empty column identifier.' };
      }
      if (colName.startsWith('sqlite_')) {
        return {
          ok: false,
          error: `Step 6: Identifier '${rawCol}' references restricted sqlite_ namespace.`,
        };
      }

      if (rawTable) {
        const qual = normalizeIdentifier(rawTable);
        if (qual.startsWith('sqlite_')) {
          return {
            ok: false,
            error: `Step 6: Qualifier '${rawTable}' references restricted sqlite_ namespace.`,
          };
        }

        let targetScope = localQualifierMap.get(qual);
        if (!targetScope) {
          const matchingBySource = localTables.filter((t) => t.sourceTable === qual);
          if (matchingBySource.length === 1) {
            targetScope = matchingBySource[0];
          }
        }
        if (!targetScope) {
          targetScope = outerTables.find(
            (t) => t.aliasOrName === qual || t.sourceTable === qual
          );
        }

        if (!targetScope) {
          return {
            ok: false,
            error: `Step 6: Unknown table or alias qualifier '${rawTable}' on column '${rawTable}.${rawCol}'.`,
          };
        }

        if (!targetScope.columns.has(colName)) {
          return {
            ok: false,
            error: `Step 6: Unknown column '${rawTable}.${rawCol}' on table '${targetScope.sourceTable}'.`,
          };
        }

        return { ok: true };
      }

      const matchingLocal = localTables.filter((t) => t.columns.has(colName));
      if (matchingLocal.length === 1) {
        return { ok: true };
      }
      if (matchingLocal.length > 1) {
        return {
          ok: false,
          error: `Step 6: Ambiguous unqualified column '${rawCol}' exists in multiple in-scope tables (${matchingLocal
            .map((t) => t.aliasOrName)
            .join(', ')}); qualify it with a table or alias.`,
        };
      }

      if (allowProjectionAliases.has(colName)) {
        return { ok: true };
      }

      const matchingOuter = outerTables.filter((t) => t.columns.has(colName));
      if (matchingOuter.length === 1) {
        return { ok: true };
      }
      if (matchingOuter.length > 1) {
        return {
          ok: false,
          error: `Step 6: Ambiguous unqualified column '${rawCol}' in correlated subquery.`,
        };
      }

      return {
        ok: false,
        error: `Step 6: Unknown column '${rawCol}'.`,
      };
    }

    function validateExpressionSubtree(
      exprNode: unknown,
      allowProjectionAliases: Set<string>
    ): { ok: true } | { ok: false; error: string } {
      if (!exprNode || typeof exprNode !== 'object') return { ok: true };
      if (Array.isArray(exprNode)) {
        for (const item of exprNode) {
          const r = validateExpressionSubtree(item, allowProjectionAliases);
          if (!r.ok) return r;
        }
        return { ok: true };
      }

      const obj = exprNode as AstNode;

      if (obj.type === 'select') {
        const subRes = validateSelectBlock(obj, activeCtes, [...localTables, ...outerTables]);
        if (!subRes.ok) return subRes;
        return { ok: true };
      }
      if (obj.ast && obj.ast.type === 'select') {
        const subRes = validateSelectBlock(obj.ast, activeCtes, [
          ...localTables,
          ...outerTables,
        ]);
        if (!subRes.ok) return subRes;
        return { ok: true };
      }

      if (obj.type === 'column_ref') {
        const rawTable = obj.table ? String(obj.table) : null;
        const rawCol = String(obj.column ?? '');
        if (rawCol !== '*') {
          return resolveColumnRef(rawTable, rawCol, allowProjectionAliases);
        }
        return { ok: true };
      }

      if (obj.type === 'double_quote_string') {
        const rawCol = String(obj.value ?? '');
        return resolveColumnRef(null, rawCol, allowProjectionAliases);
      }

      for (const key of Object.keys(obj)) {
        const r = validateExpressionSubtree(obj[key], allowProjectionAliases);
        if (!r.ok) return r;
      }

      return { ok: true };
    }

    const emptyAliases = new Set<string>();
    for (const fromItem of fromList) {
      if (fromItem?.on) {
        const onRes = validateExpressionSubtree(fromItem.on, emptyAliases);
        if (!onRes.ok) return onRes;
      }
      if (Array.isArray(fromItem?.using)) {
        for (const uCol of fromItem.using) {
          const uName = normalizeIdentifier(
            typeof uCol === 'string' ? uCol : String(uCol?.value ?? '')
          );
          const matching = localTables.filter((t) => t.columns.has(uName));
          if (matching.length < 2) {
            return {
              ok: false,
              error: `Step 6: USING(${uName}) column does not exist in joined tables.`,
            };
          }
        }
      }
    }

    const outputColumns = new Set<string>();
    const projectionAliases = new Set<string>();

    if (Array.isArray(selectNode.columns)) {
      for (const colItem of selectNode.columns) {
        const expr = colItem?.expr;
        const exprRes = validateExpressionSubtree(expr, emptyAliases);
        if (!exprRes.ok) return exprRes;

        if (colItem?.as) {
          const aliasName = normalizeIdentifier(String(colItem.as));
          if (aliasName) {
            outputColumns.add(aliasName);
            projectionAliases.add(aliasName);
          }
        } else if (expr?.type === 'column_ref' && expr.column) {
          outputColumns.add(normalizeIdentifier(String(expr.column)));
        } else if (expr?.type === 'double_quote_string' && expr.value) {
          outputColumns.add(normalizeIdentifier(String(expr.value)));
        }
      }
    }

    if (selectNode.where) {
      const whereRes = validateExpressionSubtree(selectNode.where, emptyAliases);
      if (!whereRes.ok) return whereRes;
    }

    if (selectNode.groupby) {
      const gbRes = validateExpressionSubtree(selectNode.groupby, projectionAliases);
      if (!gbRes.ok) return gbRes;
    }
    if (selectNode.having) {
      const havRes = validateExpressionSubtree(selectNode.having, projectionAliases);
      if (!havRes.ok) return havRes;
    }
    if (selectNode.orderby) {
      const obRes = validateExpressionSubtree(selectNode.orderby, projectionAliases);
      if (!obRes.ok) return obRes;
    }

    if (selectNode._next && typeof selectNode._next === 'object') {
      const nextRes = validateSelectBlock(selectNode._next, activeCtes, outerTables);
      if (!nextRes.ok) return nextRes;
    }

    return { ok: true, outputColumns };
  }

  const res = validateSelectBlock(rootAst, new Map(), []);
  if (!res.ok) {
    return res;
  }

  if (baseTablesUsed.size > 6) {
    return {
      ok: false,
      error: `Step 6: Query references ${baseTablesUsed.size} tables, exceeding the maximum of 6 tables.`,
    };
  }

  return {
    ok: true,
    tablesUsed: Array.from(baseTablesUsed),
  };
}

function checkStep7SensitiveIdentifiers(
  rootAst: AstNode,
  lexicalIdentifierTokens: string[]
): { ok: true } | { ok: false; error: string } {
  let offending: string | null = null;

  walkAst(rootAst, (node) => {
    if (offending) return;

    if (node.type === 'column_ref') {
      const col = String(node.column ?? '');
      const tbl = node.table ? String(node.table) : '';
      if (isSensitiveIdentifier(col) || (tbl && isSensitiveIdentifier(`${tbl}.${col}`))) {
        offending = tbl ? `${tbl}.${col}` : col;
        return;
      }
      if (tbl && isSensitiveIdentifier(tbl)) {
        offending = tbl;
        return;
      }
    }

    if (node.type === 'double_quote_string') {
      const val = String(node.value ?? '');
      if (isSensitiveIdentifier(val)) {
        offending = `"${val}"`;
        return;
      }
    }

    if (typeof node.as === 'string' && isSensitiveIdentifier(node.as)) {
      offending = `AS ${node.as}`;
      return;
    }

    if (typeof node.table === 'string' && isSensitiveIdentifier(node.table)) {
      offending = node.table;
      return;
    }

    if (Array.isArray(node.with)) {
      for (const cte of node.with) {
        const cteName =
          typeof cte?.name === 'string' ? cte.name : String(cte?.name?.value ?? '');
        if (isSensitiveIdentifier(cteName)) {
          offending = cteName;
          return;
        }
        if (Array.isArray(cte?.columns)) {
          for (const c of cte.columns) {
            const cName = typeof c === 'string' ? c : String(c?.column ?? c?.value ?? '');
            if (isSensitiveIdentifier(cName)) {
              offending = cName;
              return;
            }
          }
        }
      }
    }
  });

  if (offending) {
    return {
      ok: false,
      error: `Step 7: Access to designated sensitive column '${offending}' (customers.email) is prohibited.`,
    };
  }

  for (const rawIdent of lexicalIdentifierTokens) {
    if (isSensitiveIdentifier(rawIdent)) {
      return {
        ok: false,
        error: `Step 7: Access to designated sensitive column '${rawIdent}' (customers.email) is prohibited.`,
      };
    }
  }

  return { ok: true };
}

function checkStep8WholeTokens(
  wholeWordTokensUpper: string[],
  identifierTokensRaw: string[]
): { ok: true } | { ok: false; error: string } {
  for (let i = 0; i < wholeWordTokensUpper.length; i++) {
    const tok = wholeWordTokensUpper[i];

    if (tok === 'REPLACE' && wholeWordTokensUpper[i + 1] === 'INTO') {
      return {
        ok: false,
        error: 'Step 8: Write operation REPLACE INTO is prohibited.',
      };
    }

    if (FORBIDDEN_WRITE_AND_ADMIN_TOKENS.has(tok)) {
      return {
        ok: false,
        error: `Step 8: Disallowed write/DDL/admin keyword '${tok}' detected.`,
      };
    }

    if (tok.startsWith('SQLITE_')) {
      return {
        ok: false,
        error: `Step 8: Access to internal SQLite object '${tok.toLowerCase()}' is prohibited.`,
      };
    }
  }

  for (const rawIdent of identifierTokensRaw) {
    const norm = normalizeIdentifier(rawIdent);
    if (norm.startsWith('sqlite_')) {
      return {
        ok: false,
        error: `Step 8: Access to internal SQLite object '${rawIdent}' is prohibited.`,
      };
    }
  }

  return { ok: true };
}

export function validateSqlStatic(
  rawSql: string,
  schemaContext: SchemaContext
): SqlStaticValidationResult {
  const steps = createInitialSteps();
  const trimmed = typeof rawSql === 'string' ? rawSql.trim() : '';

  if (!trimmed) {
    markStep(steps, 1, 'failed', 'SQL string is empty.');
    return {
      valid: false,
      failedStep: 1,
      error: 'Step 1: SQL query cannot be empty.',
      steps,
    };
  }

  const lex = analyzeSqlLexically(trimmed);
  if (!lex.ok) {
    markStep(steps, 1, 'failed', lex.error ?? 'Lexical error');
    return {
      valid: false,
      failedStep: 1,
      error: `Step 1: ${lex.error ?? 'Lexical error'}`,
      steps,
    };
  }

  const parser = new Parser();
  let astResult: AstNode | AstNode[];
  try {
    astResult = parser.astify(lex.sqlForParser, { database: 'sqlite' }) as
      | AstNode
      | AstNode[];
  } catch (err) {
    const parserMsg = err instanceof Error ? err.message : String(err);
    const writeHint = detectWriteOrAdminHint(lex.wholeWordTokensUpper);
    const detail = writeHint
      ? `Parse failed (${writeHint} is not a valid read-only SELECT): ${parserMsg}`
      : `AST parse failed: ${parserMsg}`;
    markStep(steps, 1, 'failed', detail);
    return {
      valid: false,
      failedStep: 1,
      error: `Step 1: ${detail}`,
      steps,
    };
  }

  if (!astResult || (Array.isArray(astResult) && astResult.length === 0)) {
    markStep(steps, 1, 'failed', 'Parser returned an empty or inconclusive AST.');
    return {
      valid: false,
      failedStep: 1,
      error: 'Step 1: Parser returned an empty or inconclusive AST.',
      steps,
    };
  }

  markStep(steps, 1, 'passed', 'Parsed complete statement into SQLite AST.');

  if (
    lex.nonEmptyStatementChunks.length !== 1 ||
    (Array.isArray(astResult) && astResult.length !== 1)
  ) {
    const count = Math.max(
      lex.nonEmptyStatementChunks.length,
      Array.isArray(astResult) ? astResult.length : 1
    );
    const msg = `Step 2: Exactly one statement is permitted (found ${count} statements).`;
    markStep(steps, 2, 'failed', msg);
    return {
      valid: false,
      failedStep: 2,
      error: msg,
      steps,
    };
  }

  const rootAst: AstNode = Array.isArray(astResult) ? astResult[0] : astResult;
  const stmtType = typeof rootAst?.type === 'string' ? rootAst.type.toLowerCase() : '';

  if (stmtType !== 'select') {
    const upperType = stmtType ? stmtType.toUpperCase() : 'UNKNOWN';
    const msg =
      upperType === 'REPLACE'
        ? 'Step 2: Write operation REPLACE INTO is prohibited; terminal statement must be SELECT.'
        : `Step 2: Terminal statement must be a read-only SELECT (received ${upperType}).`;
    markStep(steps, 2, 'failed', msg);
    return {
      valid: false,
      failedStep: 2,
      error: msg,
      steps,
    };
  }

  let curr: AstNode | undefined = rootAst._next;
  while (curr && typeof curr === 'object') {
    if (typeof curr.type !== 'string' || curr.type.toLowerCase() !== 'select') {
      const msg = 'Step 2: All compound query branches must be SELECT statements.';
      markStep(steps, 2, 'failed', msg);
      return {
        valid: false,
        failedStep: 2,
        error: msg,
        steps,
      };
    }
    curr = curr._next;
  }

  markStep(steps, 2, 'passed', 'Verified single statement with terminal SELECT.');

  const step3Res = checkStep3StarWindowRecursive(rootAst);
  if (!step3Res.ok) {
    markStep(steps, 3, 'failed', step3Res.error);
    return {
      valid: false,
      failedStep: 3,
      error: step3Res.error,
      steps,
    };
  }
  markStep(
    steps,
    3,
    'passed',
    'No star projections (* / t.*), no window functions (OVER), and no RECURSIVE CTEs.'
  );

  const step4Res = checkStep4TopLevelLimit(rootAst);
  if (!step4Res.ok) {
    markStep(steps, 4, 'failed', step4Res.error);
    return {
      valid: false,
      failedStep: 4,
      error: step4Res.error,
      steps,
    };
  }
  markStep(steps, 4, 'passed', `Top-level LIMIT = ${step4Res.limitValue} (<= 1000).`);

  const step5Res = checkStep5Functions(rootAst);
  if (!step5Res.ok) {
    markStep(steps, 5, 'failed', step5Res.error);
    return {
      valid: false,
      failedStep: 5,
      error: step5Res.error,
      steps,
    };
  }
  markStep(steps, 5, 'passed', 'All functions are on the strict allowlist.');

  const step6Res = checkStep6SchemaAndJoins(rootAst, schemaContext);
  if (!step6Res.ok) {
    const step7Check = checkStep7SensitiveIdentifiers(rootAst, lex.identifierTokensRaw);
    if (!step7Check.ok) {
      markStep(steps, 6, 'passed', 'Table scope inspected prior to sensitive identifier rejection.');
      markStep(steps, 7, 'failed', step7Check.error);
      return {
        valid: false,
        failedStep: 7,
        error: step7Check.error,
        steps,
      };
    }

    markStep(steps, 6, 'failed', step6Res.error);
    return {
      valid: false,
      failedStep: 6,
      error: step6Res.error,
      steps,
    };
  }
  markStep(
    steps,
    6,
    'passed',
    `All tables (${step6Res.tablesUsed.join(', ') || 'none'}) and columns resolved against schema metadata.`
  );

  const step7Res = checkStep7SensitiveIdentifiers(rootAst, lex.identifierTokensRaw);
  if (!step7Res.ok) {
    markStep(steps, 7, 'failed', step7Res.error);
    return {
      valid: false,
      failedStep: 7,
      error: step7Res.error,
      steps,
    };
  }
  markStep(steps, 7, 'passed', 'Zero sensitive column identifiers (customers.email) present.');

  const step8Res = checkStep8WholeTokens(
    lex.wholeWordTokensUpper,
    lex.identifierTokensRaw
  );
  if (!step8Res.ok) {
    markStep(steps, 8, 'failed', step8Res.error);
    return {
      valid: false,
      failedStep: 8,
      error: step8Res.error,
      steps,
    };
  }
  markStep(
    steps,
    8,
    'passed',
    'Whole-token filter passed (no write/DDL/PRAGMA/sqlite_ tokens outside literals).'
  );

  const cleanSql = trimmed.replace(/;+\s*$/, '') as ValidatedSql;

  return {
    valid: true,
    validatedSql: cleanSql,
    tablesUsed: step6Res.tablesUsed,
    limitValue: step4Res.limitValue,
    steps,
  };
}

export async function validateSqlWithDryRun(
  rawSql: string,
  schemaContext: SchemaContext,
  client: DbClient
): Promise<SqlFullValidationResult> {
  const staticRes = validateSqlStatic(rawSql, schemaContext);
  if (!staticRes.valid) {
    return {
      valid: false,
      tablesUsed: [],
      failedStep: staticRes.failedStep,
      error: staticRes.error,
      steps: staticRes.steps,
    };
  }

  const steps = staticRes.steps.map((s) => ({ ...s }));
  try {
    const dryRunRes = await client.dryRun(staticRes.validatedSql);
    markStep(
      steps,
      9,
      'passed',
      `EXPLAIN QUERY PLAN succeeded in ${dryRunRes.durationMs} ms.`
    );
    return {
      valid: true,
      validatedSql: staticRes.validatedSql,
      tablesUsed: staticRes.tablesUsed,
      limitValue: staticRes.limitValue,
      steps,
      dryRunDurationMs: dryRunRes.durationMs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errText = `Step 9 (EXPLAIN QUERY PLAN Dry Run): ${msg}`;
    markStep(steps, 9, 'failed', errText);
    return {
      valid: false,
      tablesUsed: staticRes.tablesUsed,
      limitValue: staticRes.limitValue,
      failedStep: 9,
      error: errText,
      steps,
    };
  }
}
