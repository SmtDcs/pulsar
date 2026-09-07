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




export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"SessionNotFound"},
  4: {message:"BadStatus"},
  5: {message:"BadNonce"},
  6: {message:"NotSequencer"},
  7: {message:"TimeoutNotReached"},
  8: {message:"ResultTooLong"},
  9: {message:"SamePlayers"},
  10: {message:"TimeoutOutOfRange"},
  11: {message:"NotPlayer"},
  12: {message:"NotAdmin"}
}

export enum Status {
  Open = 1,
  Settled = 2,
  Closed = 3,
}


export interface Session {
  id: u64;
  nonce: u32;
  opened_ledger: u32;
  player_a: string;
  player_b: string;
  result: Buffer;
  sequencer: string;
  state_hash: Buffer;
  status: Status;
  timeout_ledgers: u32;
}





export interface Client {
  /**
   * Construct and simulate a close transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Close a settled session. Auth: `caller`, who must be player_a or
   * player_b (explicit-caller pattern for OR-authorization).
   */
  close: ({caller, id}: {caller: string, id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a commit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The sequencer commits a state hash, strictly nonce-increasing.
   */
  commit: ({id, nonce, state_hash}: {id: u64, nonce: u32, state_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a settle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The sequencer settles the final result. `result` is at most 64
   * bytes; for Pulsar tic-tac-toe it is the packed 12-byte payload.
   */
  settle: ({id, state_hash, result}: {id: u64, state_hash: Buffer, result: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set the admin (who can rotate the operator) and the operator
   * (the trusted sequencer). Call once after deploy.
   */
  initialize: ({admin, operator}: {admin: string, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a force_close transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Force-close a stuck Open session after the timeout. Auth: `caller`
   * (player_a or player_b). This is the v0 escape hatch against a
   * non-responsive/lying sequencer.
   */
  force_close: ({caller, id}: {caller: string, id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_session: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Session>>>

  /**
   * Construct and simulate a get_operator transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_operator: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a open_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Open a session. Auth: `player_a` (A always opens in the v0 demo).
   * The session's sequencer is bound to the current contract Operator.
   */
  open_session: ({player_a, player_b, timeout_ledgers}: {player_a: string, player_b: string, timeout_ledgers: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a update_operator transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Rotate the sequencer operator. Auth: admin.
   */
  update_operator: ({new_operator}: {new_operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAADAAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAPU2Vzc2lvbk5vdEZvdW5kAAAAAAMAAAAAAAAACUJhZFN0YXR1cwAAAAAAAAQAAAAAAAAACEJhZE5vbmNlAAAABQAAAAAAAAAMTm90U2VxdWVuY2VyAAAABgAAAAAAAAARVGltZW91dE5vdFJlYWNoZWQAAAAAAAAHAAAAAAAAAA1SZXN1bHRUb29Mb25nAAAAAAAACAAAAAAAAAALU2FtZVBsYXllcnMAAAAACQAAAAAAAAARVGltZW91dE91dE9mUmFuZ2UAAAAAAAAKAAAAAAAAAAlOb3RQbGF5ZXIAAAAAAAALAAAAAAAAAAhOb3RBZG1pbgAAAAw=",
        "AAAAAwAAAAAAAAAAAAAABlN0YXR1cwAAAAAAAwAAAAAAAAAET3BlbgAAAAEAAAAAAAAAB1NldHRsZWQAAAAAAgAAAAAAAAAGQ2xvc2VkAAAAAAAD",
        "AAAAAQAAAAAAAAAAAAAAB1Nlc3Npb24AAAAACgAAAAAAAAACaWQAAAAAAAYAAAAAAAAABW5vbmNlAAAAAAAABAAAAAAAAAANb3BlbmVkX2xlZGdlcgAAAAAAAAQAAAAAAAAACHBsYXllcl9hAAAAEwAAAAAAAAAIcGxheWVyX2IAAAATAAAAAAAAAAZyZXN1bHQAAAAAAA4AAAAAAAAACXNlcXVlbmNlcgAAAAAAABMAAAAAAAAACnN0YXRlX2hhc2gAAAAAA+4AAAAgAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAGU3RhdHVzAAAAAAAAAAAAD3RpbWVvdXRfbGVkZ2VycwAAAAAE",
        "AAAABQAAAAAAAAAAAAAADVNlc3Npb25DbG9zZWQAAAAAAAABAAAADnNlc3Npb25fY2xvc2VkAAAAAAACAAAAAAAAAAJpZAAAAAAABgAAAAEAAAA3MSA9IG5vcm1hbCBjbG9zZSBhZnRlciBzZXR0bGUsIDIgPSB0aW1lb3V0IGZvcmNlLWNsb3NlLgAAAAAGcmVhc29uAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADVNlc3Npb25PcGVuZWQAAAAAAAABAAAADnNlc3Npb25fb3BlbmVkAAAAAAAFAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAACHBsYXllcl9hAAAAEwAAAAAAAAAAAAAACHBsYXllcl9iAAAAEwAAAAAAAAAAAAAACXNlcXVlbmNlcgAAAAAAABMAAAAAAAAAAAAAAA90aW1lb3V0X2xlZGdlcnMAAAAABAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADlNlc3Npb25TZXR0bGVkAAAAAAABAAAAD3Nlc3Npb25fc2V0dGxlZAAAAAADAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAACnN0YXRlX2hhc2gAAAAAA+4AAAAgAAAAAAAAAAAAAAAGcmVzdWx0AAAAAAAOAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEFNlc3Npb25Db21taXR0ZWQAAAABAAAAEXNlc3Npb25fY29tbWl0dGVkAAAAAAAAAwAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAVub25jZQAAAAAAAAQAAAAAAAAAAAAAAApzdGF0ZV9oYXNoAAAAAAPuAAAAIAAAAAAAAAAC",
        "AAAAAAAAAHlDbG9zZSBhIHNldHRsZWQgc2Vzc2lvbi4gQXV0aDogYGNhbGxlcmAsIHdobyBtdXN0IGJlIHBsYXllcl9hIG9yCnBsYXllcl9iIChleHBsaWNpdC1jYWxsZXIgcGF0dGVybiBmb3IgT1ItYXV0aG9yaXphdGlvbikuAAAAAAAABWNsb3NlAAAAAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAJpZAAAAAAABgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAD5UaGUgc2VxdWVuY2VyIGNvbW1pdHMgYSBzdGF0ZSBoYXNoLCBzdHJpY3RseSBub25jZS1pbmNyZWFzaW5nLgAAAAAABmNvbW1pdAAAAAAAAwAAAAAAAAACaWQAAAAAAAYAAAAAAAAABW5vbmNlAAAAAAAABAAAAAAAAAAKc3RhdGVfaGFzaAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAH5UaGUgc2VxdWVuY2VyIHNldHRsZXMgdGhlIGZpbmFsIHJlc3VsdC4gYHJlc3VsdGAgaXMgYXQgbW9zdCA2NApieXRlczsgZm9yIFB1bHNhciB0aWMtdGFjLXRvZSBpdCBpcyB0aGUgcGFja2VkIDEyLWJ5dGUgcGF5bG9hZC4AAAAAAAZzZXR0bGUAAAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAApzdGF0ZV9oYXNoAAAAAAPuAAAAIAAAAAAAAAAGcmVzdWx0AAAAAAAOAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAG1TZXQgdGhlIGFkbWluICh3aG8gY2FuIHJvdGF0ZSB0aGUgb3BlcmF0b3IpIGFuZCB0aGUgb3BlcmF0b3IKKHRoZSB0cnVzdGVkIHNlcXVlbmNlcikuIENhbGwgb25jZSBhZnRlciBkZXBsb3kuAAAAAAAACmluaXRpYWxpemUAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAKBGb3JjZS1jbG9zZSBhIHN0dWNrIE9wZW4gc2Vzc2lvbiBhZnRlciB0aGUgdGltZW91dC4gQXV0aDogYGNhbGxlcmAKKHBsYXllcl9hIG9yIHBsYXllcl9iKS4gVGhpcyBpcyB0aGUgdjAgZXNjYXBlIGhhdGNoIGFnYWluc3QgYQpub24tcmVzcG9uc2l2ZS9seWluZyBzZXF1ZW5jZXIuAAAAC2ZvcmNlX2Nsb3NlAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAACaWQAAAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAALZ2V0X3Nlc3Npb24AAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAD6QAAB9AAAAAHU2Vzc2lvbgAAAAAD",
        "AAAAAAAAAAAAAAAMZ2V0X29wZXJhdG9yAAAAAAAAAAEAAAPpAAAAEwAAAAM=",
        "AAAAAAAAAIRPcGVuIGEgc2Vzc2lvbi4gQXV0aDogYHBsYXllcl9hYCAoQSBhbHdheXMgb3BlbnMgaW4gdGhlIHYwIGRlbW8pLgpUaGUgc2Vzc2lvbidzIHNlcXVlbmNlciBpcyBib3VuZCB0byB0aGUgY3VycmVudCBjb250cmFjdCBPcGVyYXRvci4AAAAMb3Blbl9zZXNzaW9uAAAAAwAAAAAAAAAIcGxheWVyX2EAAAATAAAAAAAAAAhwbGF5ZXJfYgAAABMAAAAAAAAAD3RpbWVvdXRfbGVkZ2VycwAAAAAEAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAACtSb3RhdGUgdGhlIHNlcXVlbmNlciBvcGVyYXRvci4gQXV0aDogYWRtaW4uAAAAAA91cGRhdGVfb3BlcmF0b3IAAAAAAQAAAAAAAAAMbmV3X29wZXJhdG9yAAAAEwAAAAEAAAPpAAAAAgAAAAM=" ]),
      options
    )
  }
  public readonly fromJSON = {
    close: this.txFromJSON<Result<void>>,
        commit: this.txFromJSON<Result<void>>,
        settle: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        force_close: this.txFromJSON<Result<void>>,
        get_session: this.txFromJSON<Result<Session>>,
        get_operator: this.txFromJSON<Result<string>>,
        open_session: this.txFromJSON<Result<u64>>,
        update_operator: this.txFromJSON<Result<void>>
  }
}