/**
 * Pyth observation admission policy.
 *
 * This is deliberately separate from valuation: valuation can explain a price,
 * while this module decides whether an observation is allowed to enter the
 * valuation boundary at all. No caller-supplied feed id, stale update, future
 * timestamp, or excessively wide confidence interval is accepted.
 */
import {
  confidenceBps,
  isFresh,
  pythPrice,
  type FreshnessPolicy,
  type PriceObservation,
  type PythObservation,
} from "./valuation.ts";

export interface PythFeedObservation extends PythObservation {
  /** Lowercase hex, with or without the leading 0x. */
  feedId: string;
}

export interface PythAdmissionPolicy extends FreshnessPolicy {
  expectedFeedId: string;
  maxConfidenceBps: bigint;
}

export type PythRejection =
  | "invalid_feed_id"
  | "feed_mismatch"
  | "stale"
  | "future"
  | "invalid"
  | "confidence_too_wide";

export interface PythAdmission {
  accepted: boolean;
  reason?: PythRejection;
  observation?: PriceObservation;
}

function normalizeFeedId(feedId: string): string | null {
  const normalized = feedId.toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

/** Admit one verified Pyth observation for one registry-bound feed. */
export function admitPythObservation(
  observation: PythFeedObservation,
  policy: PythAdmissionPolicy,
): PythAdmission {
  const actual = normalizeFeedId(observation.feedId);
  const expected = normalizeFeedId(policy.expectedFeedId);
  if (!actual || !expected) return { accepted: false, reason: "invalid_feed_id" };
  if (actual !== expected) return { accepted: false, reason: "feed_mismatch" };
  if (policy.maxConfidenceBps < 0n) return { accepted: false, reason: "invalid" };

  let price: PriceObservation;
  try {
    price = pythPrice(observation);
  } catch {
    return { accepted: false, reason: "invalid" };
  }

  const freshness = isFresh(price, policy);
  if (!freshness.available) return { accepted: false, reason: freshness.reason };
  if (confidenceBps(price) > policy.maxConfidenceBps) {
    return { accepted: false, reason: "confidence_too_wide" };
  }
  return { accepted: true, observation: price };
}
