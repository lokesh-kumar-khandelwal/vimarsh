/**
 * Vimarsh SQL Formatter (/src/engine/sqlFormatter.ts)
 *
 * Formats SQLite queries into clean, indented, readable multi-line blocks:
 * - Proper clause line breaking (SELECT, FROM, JOIN, WHERE, GROUP BY, ORDER BY, LIMIT).
 * - Multi-line indented column lists in SELECT (preserves function call commas intact).
 * - Subquery indentation support.
 * - String literal and quoted identifier preservation.
 * - Standard keyword capitalization.
 * - Fail-safe: always returns original SQL if parsing fails.
 */

export interface SqlFormatOptions {
  /** Indentation string, defaults to two spaces ('  ') */
  indent?: string;
  /** Whether to uppercase reserved SQL keywords, defaults to true */
  uppercaseKeywords?: boolean;
}

const RESERVED_KEYWORDS = new Set([
  'SELECT',
  'DISTINCT',
  'ALL',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'IS',
  'NULL',
  'LIKE',
  'GLOB',
  'BETWEEN',
  'EXISTS',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'OUTER',
  'CROSS',
  'NATURAL',
  'ON',
  'USING',
  'GROUP',
  'BY',
  'HAVING',
  'ORDER',
  'ASC',
  'DESC',
  'COLLATE',
  'LIMIT',
  'OFFSET',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'AS',
  'WITH',
  'RECURSIVE',
  'CAST',
  'OVER',
  'PARTITION',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'TOTAL',
  'COALESCE',
  'IFNULL',
  'NULLIF',
  'DATE',
  'TIME',
  'DATETIME',
  'STRFTIME',
  'ROUND',
  'LENGTH',
  'LOWER',
  'UPPER',
  'SUBSTR',
  'TRIM',
]);

interface Token {
  type: 'KEYWORD' | 'WORD' | 'STRING' | 'IDENT_QUOTED' | 'NUMBER' | 'SYMBOL' | 'COMMENT';
  text: string;
  upper: string;
}

/**
 * Tokenizes SQL query while protecting string literals, comments, and quoted identifiers.
 */
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  const len = sql.length;
  let i = 0;

  while (i < len) {
    const char = sql[i];

    // 1. Whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // 2. Single line comment
    if (char === '-' && i + 1 < len && sql[i + 1] === '-') {
      let end = i + 2;
      while (end < len && sql[end] !== '\n') end++;
      const text = sql.slice(i, end);
      tokens.push({ type: 'COMMENT', text, upper: text });
      i = end;
      continue;
    }

    // 3. Multi line comment
    if (char === '/' && i + 1 < len && sql[i + 1] === '*') {
      let end = i + 2;
      while (end + 1 < len && !(sql[end] === '*' && sql[end + 1] === '/')) end++;
      if (end + 1 < len) end += 2;
      const text = sql.slice(i, end);
      tokens.push({ type: 'COMMENT', text, upper: text });
      i = end;
      continue;
    }

    // 4. String literal: '...' with '' escaping
    if (char === "'") {
      let end = i + 1;
      while (end < len) {
        if (sql[end] === "'") {
          if (end + 1 < len && sql[end + 1] === "'") {
            end += 2; // escaped single quote
          } else {
            end++;
            break;
          }
        } else {
          end++;
        }
      }
      const text = sql.slice(i, end);
      tokens.push({ type: 'STRING', text, upper: text });
      i = end;
      continue;
    }

    // 5. Quoted identifier: "...", `...`, or [...]
    if (char === '"' || char === '`' || char === '[') {
      const close = char === '[' ? ']' : char;
      let end = i + 1;
      while (end < len && sql[end] !== close) end++;
      if (end < len) end++;
      const text = sql.slice(i, end);
      tokens.push({ type: 'IDENT_QUOTED', text, upper: text });
      i = end;
      continue;
    }

    // 6. Multi-character operators
    const twoChars = sql.slice(i, i + 2);
    if (['!=', '<>', '<=', '>=', '||'].includes(twoChars)) {
      tokens.push({ type: 'SYMBOL', text: twoChars, upper: twoChars });
      i += 2;
      continue;
    }

    // 7. Single-character symbols
    if (['(', ')', ',', ';', '.', '=', '<', '>', '+', '-', '*', '/', '%'].includes(char)) {
      tokens.push({ type: 'SYMBOL', text: char, upper: char });
      i++;
      continue;
    }

    // 8. Numbers (integer or floating point)
    if (/[0-9]/.test(char) || (char === '.' && i + 1 < len && /[0-9]/.test(sql[i + 1]))) {
      let end = i;
      while (end < len && /[0-9.]/.test(sql[end])) end++;
      const text = sql.slice(i, end);
      tokens.push({ type: 'NUMBER', text, upper: text });
      i = end;
      continue;
    }

    // 9. Words (identifiers, keywords)
    if (/[a-zA-Z_#$]/.test(char)) {
      let end = i;
      while (end < len && /[a-zA-Z0-9_#$]/.test(sql[end])) end++;
      const text = sql.slice(i, end);
      const upper = text.toUpperCase();
      const type = RESERVED_KEYWORDS.has(upper) ? 'KEYWORD' : 'WORD';
      tokens.push({ type, text, upper });
      i = end;
      continue;
    }

    // Fallback: any other character
    tokens.push({ type: 'SYMBOL', text: char, upper: char });
    i++;
  }

  return tokens;
}

/**
 * Normalizes SQL query into a single-line compact representation.
 */
export function formatSqlCompact(sql: string): string {
  if (!sql || typeof sql !== 'string') return '';
  try {
    const tokens = tokenize(sql.trim());
    if (tokens.length === 0) return sql.trim();

    let out = '';
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const prev = tokens[i - 1];

      if (tok.type === 'SYMBOL') {
        if (tok.text === ';') {
          out += ';';
          continue;
        }
        if (tok.text === ',') {
          out += ', ';
          continue;
        }
        if (tok.text === '.') {
          out += '.';
          continue;
        }
        if (tok.text === '(') {
          // No space if following function keyword or identifier
          if (prev && (prev.type === 'KEYWORD' || prev.type === 'WORD')) {
            out += '(';
          } else {
            if (out && !out.endsWith(' ')) out += ' ';
            out += '(';
          }
          continue;
        }
        if (tok.text === ')') {
          out += ')';
          continue;
        }
        // Operators (=, <, >, <=, etc.)
        if (out && !out.endsWith(' ')) out += ' ';
        out += tok.text;
        out += ' ';
        continue;
      }

      // If previous was a dot, attach directly (e.g. table.column)
      if (prev && prev.type === 'SYMBOL' && prev.text === '.') {
        out += tok.type === 'KEYWORD' ? tok.upper : tok.text;
        continue;
      }

      // If previous was '(', attach without space
      if (prev && prev.type === 'SYMBOL' && prev.text === '(') {
        out += tok.type === 'KEYWORD' ? tok.upper : tok.text;
        continue;
      }

      if (out && !out.endsWith(' ')) {
        out += ' ';
      }
      out += tok.type === 'KEYWORD' ? tok.upper : tok.text;
    }

    return out.trim();
  } catch {
    return sql.trim();
  }
}

/**
 * Formats SQL query into an indented, multi-line readable structure.
 */
export function formatSql(sql: string, options: SqlFormatOptions = {}): string {
  if (!sql || typeof sql !== 'string') return '';

  const indentUnit = options.indent ?? '  ';
  const uppercaseKeywords = options.uppercaseKeywords ?? true;

  try {
    const tokens = tokenize(sql.trim());
    if (tokens.length === 0) return sql.trim();

    const lines: string[] = [];
    let currentLine = '';
    let indentLevel = 0;
    let parenDepth = 0;
    const parenSubqueryStack: number[] = []; // tracks paren depths that started a subquery

    const addLine = () => {
      const trimmed = currentLine.trimEnd();
      if (trimmed.length > 0) {
        lines.push(trimmed);
      }
      currentLine = '';
    };

    const startNewLine = (level: number) => {
      addLine();
      currentLine = indentUnit.repeat(Math.max(0, level));
    };

    const append = (str: string, needSpaceBefore = true) => {
      if (needSpaceBefore && currentLine.length > 0 && !currentLine.endsWith(' ') && !currentLine.endsWith('(') && !currentLine.endsWith('.')) {
        currentLine += ' ';
      }
      currentLine += str;
    };

    let inSelectClause = false;

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      const nextNext = tokens[i + 2];

      const val = tok.type === 'KEYWORD' && uppercaseKeywords ? tok.upper : tok.text;

      // Handle comments
      if (tok.type === 'COMMENT') {
        addLine();
        currentLine = indentUnit.repeat(indentLevel) + tok.text;
        addLine();
        continue;
      }

      // Check for compound keywords at top-level or subquery level
      // 1. SELECT / SELECT DISTINCT
      if (tok.type === 'KEYWORD' && tok.upper === 'SELECT') {
        const isDistinct = next && next.type === 'KEYWORD' && next.upper === 'DISTINCT';
        const isAll = next && next.type === 'KEYWORD' && next.upper === 'ALL';

        startNewLine(indentLevel);
        append('SELECT');
        if (isDistinct) {
          append('DISTINCT');
          i++;
        } else if (isAll) {
          append('ALL');
          i++;
        }

        inSelectClause = true;
        // Start indented columns on next line
        startNewLine(indentLevel + 1);
        continue;
      }

      // 2. FROM
      if (tok.type === 'KEYWORD' && tok.upper === 'FROM') {
        inSelectClause = false;
        startNewLine(indentLevel);
        append('FROM');
        continue;
      }

      // 3. JOINs: [INNER | LEFT | RIGHT | FULL | CROSS | NATURAL] JOIN
      const isJoinVariant =
        tok.type === 'KEYWORD' &&
        ['JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL'].includes(tok.upper);

      if (isJoinVariant) {
        let joinPhrase = tok.upper;
        let skip = 0;

        if (tok.upper !== 'JOIN') {
          if (next && next.type === 'KEYWORD' && next.upper === 'OUTER' && nextNext && nextNext.type === 'KEYWORD' && nextNext.upper === 'JOIN') {
            joinPhrase = `${tok.upper} OUTER JOIN`;
            skip = 2;
          } else if (next && next.type === 'KEYWORD' && next.upper === 'JOIN') {
            joinPhrase = `${tok.upper} JOIN`;
            skip = 1;
          }
        }

        if (joinPhrase.endsWith('JOIN')) {
          inSelectClause = false;
          startNewLine(indentLevel);
          append(joinPhrase);
          i += skip;
          continue;
        }
      }

      // 4. WHERE
      if (tok.type === 'KEYWORD' && tok.upper === 'WHERE') {
        inSelectClause = false;
        startNewLine(indentLevel);
        append('WHERE');
        continue;
      }

      // 5. AND / OR in WHERE/HAVING clause (when at paren level 0 of the current query)
      const isTopLevelAndOr =
        tok.type === 'KEYWORD' &&
        (tok.upper === 'AND' || tok.upper === 'OR') &&
        parenDepth === (parenSubqueryStack.length > 0 ? parenSubqueryStack[parenSubqueryStack.length - 1] : 0);

      if (isTopLevelAndOr && !inSelectClause) {
        startNewLine(indentLevel + 1);
        append(tok.upper);
        continue;
      }

      // 6. GROUP BY
      if (tok.type === 'KEYWORD' && tok.upper === 'GROUP' && next && next.type === 'KEYWORD' && next.upper === 'BY') {
        inSelectClause = false;
        startNewLine(indentLevel);
        append('GROUP BY');
        i++;
        continue;
      }

      // 7. HAVING
      if (tok.type === 'KEYWORD' && tok.upper === 'HAVING') {
        inSelectClause = false;
        startNewLine(indentLevel);
        append('HAVING');
        continue;
      }

      // 8. ORDER BY
      if (tok.type === 'KEYWORD' && tok.upper === 'ORDER' && next && next.type === 'KEYWORD' && next.upper === 'BY') {
        inSelectClause = false;
        startNewLine(indentLevel);
        append('ORDER BY');
        i++;
        continue;
      }

      // 9. LIMIT
      if (tok.type === 'KEYWORD' && tok.upper === 'LIMIT') {
        inSelectClause = false;
        startNewLine(indentLevel);
        append('LIMIT');
        continue;
      }

      // 10. OFFSET
      if (tok.type === 'KEYWORD' && tok.upper === 'OFFSET') {
        inSelectClause = false;
        startNewLine(indentLevel);
        append('OFFSET');
        continue;
      }

      // 11. UNION / INTERSECT / EXCEPT
      if (tok.type === 'KEYWORD' && ['UNION', 'INTERSECT', 'EXCEPT'].includes(tok.upper)) {
        inSelectClause = false;
        startNewLine(indentLevel);
        if (tok.upper === 'UNION' && next && next.type === 'KEYWORD' && next.upper === 'ALL') {
          append('UNION ALL');
          i++;
        } else {
          append(tok.upper);
        }
        continue;
      }

      // 12. Commas
      if (tok.type === 'SYMBOL' && tok.text === ',') {
        append(',', false);
        // If we are directly in SELECT clause (not inside function arguments parenDepth), break to newline
        const currentSubqueryDepth =
          parenSubqueryStack.length > 0
            ? parenSubqueryStack[parenSubqueryStack.length - 1]
            : 0;
        if (inSelectClause && parenDepth === currentSubqueryDepth) {
          startNewLine(indentLevel + 1);
        }
        continue;
      }

      // 13. Semicolon
      if (tok.type === 'SYMBOL' && tok.text === ';') {
        append(';', false);
        continue;
      }

      // 14. Parentheses
      if (tok.type === 'SYMBOL' && tok.text === '(') {
        parenDepth++;
        // Check if next non-comment token is SELECT (subquery)
        let isSubquery = false;
        for (let j = i + 1; j < tokens.length; j++) {
          if (tokens[j].type === 'COMMENT') continue;
          if (tokens[j].type === 'KEYWORD' && tokens[j].upper === 'SELECT') {
            isSubquery = true;
          }
          break;
        }

        if (isSubquery) {
          parenSubqueryStack.push(parenDepth);
          indentLevel++;
          append('(');
          continue;
        }

        // Ordinary function call like SUM(...) or expr
        if (prev && (prev.type === 'KEYWORD' || prev.type === 'WORD')) {
          append('(', false); // no space before ( in function call
        } else {
          append('(');
        }
        continue;
      }

      if (tok.type === 'SYMBOL' && tok.text === ')') {
        if (parenSubqueryStack.length > 0 && parenSubqueryStack[parenSubqueryStack.length - 1] === parenDepth) {
          parenSubqueryStack.pop();
          indentLevel = Math.max(0, indentLevel - 1);
          startNewLine(indentLevel);
          append(')');
          parenDepth--;
          continue;
        }

        parenDepth = Math.max(0, parenDepth - 1);
        append(')', false);
        continue;
      }

      // 15. Dots in identifiers (e.g. table.col)
      if (tok.type === 'SYMBOL' && tok.text === '.') {
        append('.', false);
        continue;
      }
      if (prev && prev.type === 'SYMBOL' && prev.text === '.') {
        append(val, false);
        continue;
      }

      // Default append
      append(val);
    }

    addLine();
    const result = lines.join('\n').trim();
    return result || sql.trim();
  } catch {
    // Fail safe: return original trimmed SQL
    return sql.trim();
  }
}
