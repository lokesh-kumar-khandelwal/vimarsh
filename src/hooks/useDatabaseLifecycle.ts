import { useCallback, useEffect, useRef, useState } from 'react';
import { dbClient } from '../engine/dbClient';
import { runAllInAppSelfTests } from '../engine/selfTestRunner';
import type { SchemaContext, SeedReport, TestCaseResult } from '../types';

export interface DatabaseLifecycleState {
  isLoading: boolean;
  errorMessage: string | null;
  seedReport: SeedReport | null;
  schemaContext: SchemaContext | null;
  testResults: TestCaseResult[];
  initializeOrResetWorker: (isReset?: boolean) => Promise<void>;
  handleRerunSelfTests: () => Promise<void>;
}

/**
 * Manages the SQLite Web Worker (`dbClient`) initialization, deterministic seed
 * reset, schema context loading, and in-app self-test verification lifecycle.
 */
export function useDatabaseLifecycle(): DatabaseLifecycleState {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [seedReport, setSeedReport] = useState<SeedReport | null>(null);
  const [schemaContext, setSchemaContext] = useState<SchemaContext | null>(
    null
  );
  const [testResults, setTestResults] = useState<TestCaseResult[]>([]);

  const initSequenceRef = useRef<number>(0);

  const initializeOrResetWorker = useCallback(async (isReset = false) => {
    const currentSeq = ++initSequenceRef.current;
    setIsLoading(true);
    setErrorMessage(null);
    if (isReset) {
      setSchemaContext(null);
      setSeedReport(null);
    }
    try {
      const initPayload = isReset
        ? await dbClient.reset()
        : await dbClient.init();

      if (initSequenceRef.current !== currentSeq) {
        return;
      }

      const freshSchema = await dbClient.getSchemaContext();
      if (initSequenceRef.current !== currentSeq) {
        return;
      }

      setSeedReport(initPayload.seedReport);
      setSchemaContext(freshSchema);
      const results = await runAllInAppSelfTests(
        dbClient,
        initPayload.seedReport,
        freshSchema
      );
      if (initSequenceRef.current === currentSeq) {
        setTestResults(results);
      }
    } catch (err) {
      if (initSequenceRef.current !== currentSeq) {
        return;
      }
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to initialize SQLite Web Worker.';
      setErrorMessage(msg);
      setSchemaContext(null);
      setSeedReport(null);
    } finally {
      if (initSequenceRef.current === currentSeq) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void initializeOrResetWorker(false);
  }, [initializeOrResetWorker]);

  const handleRerunSelfTests = useCallback(async () => {
    if (!seedReport || !schemaContext) {
      await initializeOrResetWorker(false);
      return;
    }
    const currentSeq = ++initSequenceRef.current;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const refreshedSchema = await dbClient.getSchemaContext();
      if (initSequenceRef.current !== currentSeq) return;
      setSchemaContext(refreshedSchema);
      const results = await runAllInAppSelfTests(
        dbClient,
        seedReport,
        refreshedSchema
      );
      if (initSequenceRef.current === currentSeq) {
        setTestResults(results);
      }
    } catch (err) {
      if (initSequenceRef.current !== currentSeq) return;
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      if (initSequenceRef.current === currentSeq) {
        setIsLoading(false);
      }
    }
  }, [seedReport, schemaContext, initializeOrResetWorker]);

  return {
    isLoading,
    errorMessage,
    seedReport,
    schemaContext,
    testResults,
    initializeOrResetWorker,
    handleRerunSelfTests,
  };
}
