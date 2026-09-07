import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





export interface Game {
  /**
 * Row-major board (9 cells), 0/1/2. Vec<u32> is the SDK-supported
 * fixed-shape container; the 10-line win checker below mirrors
 * `packages/shared` `winnerOf`.
 */
board: Array<u32>;
  id: u64;
  move_count: u32;
  /**
 * 1 or 2 — whose turn it is.
 */
next: u32;
  player_a: string;
  player_b: string;
  /**
 * 0 = in progress, 1 = A, 2 = B, 3 = draw.
 */
winner: u32;
}

export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"GameNotFound"},
  4: {message:"CellOutOfRange"},
  5: {message:"CellOccupied"},
  6: {message:"GameOver"},
  7: {message:"SamePlayers"}
}

export type DataKey = {tag: "Admin", values: void} | {tag: "NextId", values: void} | {tag: "Game", values: readonly [u64]};

export interface Client {
  /**
   * Construct and simulate a play transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Play a move in `cell` (0..8). Requires auth of the player whose
   * turn it is, so out-of-turn submissions are rejected by the host.
   */
  play: ({id, cell}: {id: u64, cell: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_game: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Game>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Store the admin (deployer). Admin is not used for gameplay in v0.
   */
  initialize: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a game; `player_a` (X) moves first and pays the auth.
   */
  create_game: ({player_a, player_b}: {player_a: string, player_b: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAABEdhbWUAAAAHAAAAmlJvdy1tYWpvciBib2FyZCAoOSBjZWxscyksIDAvMS8yLiBWZWM8dTMyPiBpcyB0aGUgU0RLLXN1cHBvcnRlZApmaXhlZC1zaGFwZSBjb250YWluZXI7IHRoZSAxMC1saW5lIHdpbiBjaGVja2VyIGJlbG93IG1pcnJvcnMKYHBhY2thZ2VzL3NoYXJlZGAgYHdpbm5lck9mYC4AAAAAAAVib2FyZAAAAAAAA+oAAAAEAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAKbW92ZV9jb3VudAAAAAAABAAAABwxIG9yIDIg4oCUIHdob3NlIHR1cm4gaXQgaXMuAAAABG5leHQAAAAEAAAAAAAAAAhwbGF5ZXJfYQAAABMAAAAAAAAACHBsYXllcl9iAAAAEwAAACgwID0gaW4gcHJvZ3Jlc3MsIDEgPSBBLCAyID0gQiwgMyA9IGRyYXcuAAAABndpbm5lcgAAAAAABA==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABwAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAMR2FtZU5vdEZvdW5kAAAAAwAAAAAAAAAOQ2VsbE91dE9mUmFuZ2UAAAAAAAQAAAAAAAAADENlbGxPY2N1cGllZAAAAAUAAAAAAAAACEdhbWVPdmVyAAAABgAAAAAAAAALU2FtZVBsYXllcnMAAAAABw==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAGTmV4dElkAAAAAAABAAAAAAAAAARHYW1lAAAAAQAAAAY=",
        "AAAAAAAAAIBQbGF5IGEgbW92ZSBpbiBgY2VsbGAgKDAuLjgpLiBSZXF1aXJlcyBhdXRoIG9mIHRoZSBwbGF5ZXIgd2hvc2UKdHVybiBpdCBpcywgc28gb3V0LW9mLXR1cm4gc3VibWlzc2lvbnMgYXJlIHJlamVjdGVkIGJ5IHRoZSBob3N0LgAAAARwbGF5AAAAAgAAAAAAAAACaWQAAAAAAAYAAAAAAAAABGNlbGwAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAAJpZAAAAAAABgAAAAEAAAPpAAAH0AAAAARHYW1lAAAAAw==",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAPpAAAAEwAAAAM=",
        "AAAAAAAAAEFTdG9yZSB0aGUgYWRtaW4gKGRlcGxveWVyKS4gQWRtaW4gaXMgbm90IHVzZWQgZm9yIGdhbWVwbGF5IGluIHYwLgAAAAAAAAppbml0aWFsaXplAAAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAADxDcmVhdGUgYSBnYW1lOyBgcGxheWVyX2FgIChYKSBtb3ZlcyBmaXJzdCBhbmQgcGF5cyB0aGUgYXV0aC4AAAALY3JlYXRlX2dhbWUAAAAAAgAAAAAAAAAIcGxheWVyX2EAAAATAAAAAAAAAAhwbGF5ZXJfYgAAABMAAAABAAAD6QAAAAYAAAAD" ]),
      options
    )
  }
  public readonly fromJSON = {
    play: this.txFromJSON<Result<void>>,
        get_game: this.txFromJSON<Result<Game>>,
        get_admin: this.txFromJSON<Result<string>>,
        initialize: this.txFromJSON<Result<void>>,
        create_game: this.txFromJSON<Result<u64>>
  }
}