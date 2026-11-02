import { describe, expect, it } from 'vitest';
import {
  buildAutoChartModel,
  buildFactualResultSummary,
  classifyErrorTurnHeading,
  sortResultRows,
} from '../components/workspace/resultHelpers';

describe('Workspace resultHelpers unit tests', () => {
  it('buildAutoChartModel detects valid 2-20 row label + numeric metric result sets', () => {
    const model = buildAutoChartModel({
      columns: ['product_name', 'total_revenue'],
      rows: [
        ['Widget Pro', 1200],
        ['Gadget Max', 850],
      ],
      rowCount: 2,
      executionTimeMs: 4,
      truncated: false,
      isEmpty: false,
      emptyMessage: null,
    });

    expect(model).not.toBeNull();
    expect(model?.labelColumn).toBe('product_name');
    expect(model?.valueColumn).toBe('total_revenue');
    expect(model?.maxValue).toBe(1200);
    expect(model?.items).toHaveLength(2);
  });

  it('buildAutoChartModel returns null for single-row scalar results', () => {
    const model = buildAutoChartModel({
      columns: ['total_revenue'],
      rows: [[4500]],
      rowCount: 1,
      executionTimeMs: 2,
      truncated: false,
      isEmpty: false,
      emptyMessage: null,
    });

    expect(model).toBeNull();
  });

  it('buildFactualResultSummary formats scalar and multi-row results accurately', () => {
    const scalarSummary = buildFactualResultSummary({
      columns: ['total_revenue'],
      rows: [[12500]],
      rowCount: 1,
      executionTimeMs: 3,
      truncated: false,
      isEmpty: false,
      emptyMessage: null,
    });
    expect(scalarSummary?.headline).toContain('total_revenue:');
    expect(scalarSummary?.subline).toBe('1 row returned in 3 ms');

    const multiSummary = buildFactualResultSummary({
      columns: ['name', 'revenue'],
      rows: [
        ['A', 10],
        ['B', 20],
      ],
      rowCount: 2,
      executionTimeMs: 5,
      truncated: false,
      isEmpty: false,
      emptyMessage: null,
    });
    expect(multiSummary?.headline).toBe('Returned 2 rows');
    expect(multiSummary?.subline).toContain('2 columns (name, revenue)');
  });

  it('classifyErrorTurnHeading classifies 503, quota, api_key, and cancelled errors', () => {
    expect(
      classifyErrorTurnHeading('HTTP 503 Service temporarily unavailable')
        .category
    ).toBe('service_unavailable');
    expect(classifyErrorTurnHeading('429 rate limit exceeded').category).toBe(
      'quota'
    );
    expect(classifyErrorTurnHeading('401 invalid key').category).toBe(
      'api_key'
    );
    expect(classifyErrorTurnHeading('Request aborted by user').category).toBe(
      'cancelled'
    );
  });

  it('sortResultRows sorts numeric and string columns and places NULLs last', () => {
    const rows = [
      ['Beta', 20],
      ['Alpha', null],
      ['Gamma', 50],
    ];

    const ascNumeric = sortResultRows(rows, { colIndex: 1, direction: 'asc' });
    expect(ascNumeric[0][0]).toBe('Beta');
    expect(ascNumeric[1][0]).toBe('Gamma');
    expect(ascNumeric[2][0]).toBe('Alpha');

    const descNumeric = sortResultRows(rows, {
      colIndex: 1,
      direction: 'desc',
    });
    expect(descNumeric[0][0]).toBe('Gamma');
    expect(descNumeric[1][0]).toBe('Beta');
    expect(descNumeric[2][0]).toBe('Alpha');
  });
});
