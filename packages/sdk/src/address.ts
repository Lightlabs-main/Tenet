/**
 * Stable, positional PDA helpers for every Tenet account.
 *
 * Codama names its generated `find*Pda` helpers and their seed fields after
 * whichever instruction account happened to declare the PDA (`buyer`,
 * `testMint`, `memberOwner`, ...), so they change when an instruction's
 * account names change. These do not: each takes the seeds in `seeds.*`
 * order, and `seeds.*` is checked against the program's own derivations by
 * tests/vectors/pda.json.
 */
import { getAddressEncoder, getProgramDerivedAddress, type Address, type ProgramDerivedAddress } from "@solana/kit";
import { PROGRAM_ID, seeds, type Key } from "./pda";

const enc = getAddressEncoder();
const k = (a: Address): Key => enc.encode(a) as Key;
const derive = (s: Uint8Array[]): Promise<ProgramDerivedAddress> =>
  getProgramDerivedAddress({ programAddress: PROGRAM_ID as Address, seeds: s });

export const pda = {
  config: () => derive(seeds.config()),
  mandate: (mandateSeed: Address) => derive(seeds.mandate(k(mandateSeed))),
  mandateAsset: (mandate: Address, mint: Address) => derive(seeds.mandateAsset(k(mandate), k(mint))),
  registry: (mint: Address) => derive(seeds.registry(k(mint))),
  circle: (mandate: Address) => derive(seeds.circle(k(mandate))),
  circleAsset: (circle: Address, mint: Address) => derive(seeds.circleAsset(k(circle), k(mint))),
  vaultAuthority: (circle: Address) => derive(seeds.vaultAuthority(k(circle))),
  assetVault: (circle: Address, mint: Address) => derive(seeds.assetVault(k(circle), k(mint))),
  usdcVault: (circle: Address) => derive(seeds.usdcVault(k(circle))),
  epoch: (circle: Address, index: bigint) => derive(seeds.epoch(k(circle), index)),
  epochEscrow: (circle: Address, index: bigint) => derive(seeds.epochEscrow(k(circle), index)),
  receipt: (epoch: Address, owner: Address) => derive(seeds.receipt(k(epoch), k(owner))),
  member: (circle: Address, owner: Address) => derive(seeds.member(k(circle), k(owner))),
  navSnapshot: (epoch: Address) => derive(seeds.navSnapshot(k(epoch))),
  redemption: (circle: Address, owner: Address, seq: bigint) => derive(seeds.redemption(k(circle), k(owner), seq)),
  redemptionAsset: (redemption: Address, mint: Address) => derive(seeds.redemptionAsset(k(redemption), k(mint))),
  execAuth: (circle: Address, epoch: Address, nonce: bigint) => derive(seeds.execAuth(k(circle), k(epoch), nonce)),
  amendment: (mandate: Address, proposalId: bigint) => derive(seeds.amendment(k(mandate), proposalId)),
  amendmentVote: (proposal: Address, voter: Address) => derive(seeds.amendmentVote(k(proposal), k(voter))),
};
