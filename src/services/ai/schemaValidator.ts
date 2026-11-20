export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  error?: string;
}

export type SchemaValidator<T> = (raw: unknown) => ValidationResult<T>;

export function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function asNonEmptyString(val: unknown, fieldName: string): string {
  if (typeof val !== 'string' || !val.trim()) {
    throw new Error(`AI output validation failed: "${fieldName}" must be a non-empty string.`);
  }
  return val.trim();
}

export function asString(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val.trim() : fallback;
}

export function asNumberInRange(
  val: unknown,
  min: number,
  max: number,
  fieldName: string
): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < min || val > max) {
    throw new Error(
      `AI output validation failed: "${fieldName}" must be a number between ${min} and ${max}.`
    );
  }
  return val;
}

export function asStringArray(val: unknown, maxItems = 50): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, maxItems);
}

export function asBoolean(val: unknown, fallback = false): boolean {
  return typeof val === 'boolean' ? val : fallback;
}

/**
 * Safely wraps a throwing parser function into a typed ValidationResult.
 */
export function createValidator<T>(parser: (raw: unknown) => T): SchemaValidator<T> {
  return (raw: unknown): ValidationResult<T> => {
    try {
      return { valid: true, data: parser(raw) };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Invalid structured AI response.',
      };
    }
  };
}
