import { PostgrestError } from '@supabase/supabase-js';
import { logEvent } from '@/lib/log';

export interface QueryResultError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  correlationId: string;
}

export interface QueryResult<T> {
  data: T | null;
  error: QueryResultError | null;
}

/**
 * Standard helper to process Supabase query results.
 * Prevents silent query errors and formats them with generated correlation IDs for safe rendering.
 *
 * @param response Supabase query response containing data and error
 * @param context Log context prefix (e.g., 'homepage.products_fetch')
 */
export function handleSupabaseQueryResult<T>(
  response: { data: T | null; error: PostgrestError | null },
  context: string
): QueryResult<T> {
  if (response.error) {
    const correlationId = `err-${Math.random().toString(36).substring(2, 9).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

    // Log the full details server-side
    logEvent(`${context}.database_error`, {
      error_message: response.error.message,
      error_code: response.error.code,
      error_details: response.error.details,
      error_hint: response.error.hint,
      correlation_id: correlationId,
    }, {
      severity: 'error',
      source: 'api',
    });

    return {
      data: null,
      error: {
        message: response.error.message,
        code: response.error.code,
        details: response.error.details,
        hint: response.error.hint,
        correlationId,
      },
    };
  }

  return {
    data: response.data,
    error: null,
  };
}
