/**
 * Recursive snake_case → camelCase key transformation.
 *
 * Used by flipper proxy routes to transform FastAPI backend responses
 * (which use snake_case) into camelCase expected by frontend TypeScript types.
 *
 * Handles:
 *   - Plain objects (recursively transforms all keys)
 *   - Arrays (recursively transforms each element)
 *   - Primitives (returned as-is)
 *   - null (returned as-is)
 *
 * Does NOT transform:
 *   - Keys that are already camelCase (idempotent)
 *   - Values that are not objects or arrays
 */
export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function transformKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(transformKeys);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[toCamelCase(key)] = transformKeys(value);
    }
    return result;
  }
  return obj;
}
