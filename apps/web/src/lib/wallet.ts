/**
 * @pulsar/web — browser-side player wallets (v2).
 *
 * Each player's secret key lives ONLY in this browser's localStorage. It is
 * generated on first use and never leaves the machine. This is what makes
 * the sequencer powerless to impersonate a player: on-chain operations that
 * need `require_auth` for a player are signed here, in the browser, with the
 * player's own keypair and submitted straight to the Testnet RPC.
 */
import { Keypair } from "@stellar/stellar-sdk";

export type Slot = "A" | "B";

const KEY_A = "pulsar-wallet-a-secret";
const KEY_B = "pulsar-wallet-b-secret";

function storageKey(slot: Slot): string {
  return slot === "A" ? KEY_A : KEY_B;
}

/** Load the keypair for a slot, or generate + persist a fresh one. */
export function ensureWallet(slot: Slot): Keypair {
  const stored = window.localStorage.getItem(storageKey(slot));
  if (stored) {
    try {
      return Keypair.fromSecret(stored);
    } catch {
      // Corrupt entry — reset below.
    }
  }
  const kp = Keypair.random();
  window.localStorage.setItem(storageKey(slot), kp.secret());
  return kp;
}

export function walletAddress(slot: Slot): string {
  return ensureWallet(slot).publicKey();
}

export function walletSecret(slot: Slot): string {
  return ensureWallet(slot).secret();
}

export function resetWallet(slot: Slot): void {
  window.localStorage.removeItem(storageKey(slot));
  void ensureWallet(slot); // regenerate immediately so the UI always has one
}