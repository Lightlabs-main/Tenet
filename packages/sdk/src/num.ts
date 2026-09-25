/**
 * Amount guards. The generated builders accept `number | bigint` for u64/i64
 * fields, and a JavaScript `number` above 2^53 silently loses precision — the
 * V-018 hazard, applied to money. These refuse anything but an in-range bigint.
 */
const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

/** Refuse anything but an in-range bigint. Returns it unchanged. */
export function u64(value: unknown, field: string): bigint {
  if (typeof value !== "bigint") {
    throw new TypeError(`${field} must be a bigint (got ${typeof value}); numbers lose precision above 2^53`);
  }
  if (value < 0n || value > U64_MAX) throw new RangeError(`${field} is not a u64: ${value}`);
  return value;
}

export function i64(value: unknown, field: string): bigint {
  if (typeof value !== "bigint") {
    throw new TypeError(`${field} must be a bigint (got ${typeof value})`);
  }
  if (value < I64_MIN || value > I64_MAX) throw new RangeError(`${field} is not an i64: ${value}`);
  return value;
}
