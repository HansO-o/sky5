/**
 * Helpers for plain JSON-like data (saves, flags, snapshots): cloning, comparison and filling in
 * defaults. Values are plain objects, arrays and primitives; functions and class instances are not
 * expected (a class instance is copied as a plain object).
 */

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep copy of plain data. `undefined` properties are dropped (as JSON would). */
export function deepClone<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => deepClone(x)) as T;
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) if (v[k] !== undefined) out[k] = deepClone(v[k]);
    return out as T;
  }
  return v;
}

/** Structural equality of plain data (`undefined` properties count as missing). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * `raw` (e.g. read from an older or newer save) laid over `defaults`, returning fresh data of the
 * defaults' shape:
 * - an object takes each default key from `raw` when present and of a fitting kind, else the default;
 *   keys `raw` has beyond the defaults are kept as they are (forward-compatible data);
 * - an array default takes any array from `raw` (element types are the caller's to check);
 * - a primitive default takes a `raw` value of the same type (numbers must be finite);
 * - a `null` default takes anything `raw` holds.
 * Never shares structure with either argument.
 */
export function withDefaults<T>(defaults: T, raw: unknown): T {
  if (raw === undefined) return deepClone(defaults);
  if (defaults === null) return deepClone(raw) as T;
  if (Array.isArray(defaults)) return (Array.isArray(raw) ? deepClone(raw) : deepClone(defaults)) as T;
  if (isPlainObject(defaults)) {
    if (!isPlainObject(raw)) return deepClone(defaults);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(defaults)) {
      const v = withDefaults(defaults[k], raw[k]);
      if (v !== undefined) out[k] = v;
    }
    for (const k of Object.keys(raw)) if (!(k in defaults) && raw[k] !== undefined) out[k] = deepClone(raw[k]);
    return out as T;
  }
  if (typeof raw !== typeof defaults) return defaults;
  if (typeof raw === "number" && !Number.isFinite(raw)) return defaults;
  return raw as T;
}
