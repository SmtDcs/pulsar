//! Unit tests for SessionRegistry.
use crate::{SessionRegistry, SessionRegistryClient, Status};
use soroban_sdk::testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{Address, Bytes, BytesN, Env, IntoVal};

struct Ctx {
    env: Env,
    client: SessionRegistryClient<'static>,
    a: Address,
    b: Address,
    sequencer: Address,
    admin: Address,
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SessionRegistry, ());
    let client = SessionRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sequencer = Address::generate(&env);
    client.initialize(&admin, &sequencer);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    Ctx { env, client, a, b, sequencer, admin }
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn open(ctx: &Ctx) -> u64 {
    ctx.client.open_session(&ctx.a, &ctx.b, &60u32)
}

#[test]
fn full_lifecycle_open_commit_settle_close() {
    let ctx = setup();
    let id = open(&ctx);
    let s = ctx.client.get_session(&id);
    assert_eq!(s.id, id);
    assert_eq!(s.status, Status::Open);
    assert_eq!(s.player_a, ctx.a);
    assert_eq!(s.player_b, ctx.b);
    assert_eq!(s.sequencer, ctx.sequencer);
    assert_eq!(s.nonce, 0);
    assert_eq!(s.state_hash, hash(&ctx.env, 0));

    ctx.client.commit(&id, &1u32, &hash(&ctx.env, 1));
    let s = ctx.client.get_session(&id);
    assert_eq!(s.nonce, 1);
    assert_eq!(s.state_hash, hash(&ctx.env, 1));

    ctx.client.commit(&id, &2u32, &hash(&ctx.env, 2));
    let s = ctx.client.get_session(&id);
    assert_eq!(s.nonce, 2);

    let result = Bytes::from_array(&ctx.env, &[1u8, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 5]);
    ctx.client.settle(&id, &hash(&ctx.env, 3), &result);
    let s = ctx.client.get_session(&id);
    assert_eq!(s.status, Status::Settled);
    assert_eq!(s.nonce, 3); // settle bumps the nonce too
    assert_eq!(s.state_hash, hash(&ctx.env, 3));
    assert_eq!(s.result, result);

    ctx.client.close(&ctx.a, &id);
    let s = ctx.client.get_session(&id);
    assert_eq!(s.status, Status::Closed);
}

#[test]
fn commit_with_wrong_nonce_fails() {
    let ctx = setup();
    let id = open(&ctx);
    assert_eq!(
        ctx.client.try_commit(&id, &2u32, &hash(&ctx.env, 1)),
        Err(Ok(crate::Error::BadNonce))
    );
    ctx.client.commit(&id, &1u32, &hash(&ctx.env, 1));
    // replaying nonce 1 must fail
    assert_eq!(
        ctx.client.try_commit(&id, &1u32, &hash(&ctx.env, 1)),
        Err(Ok(crate::Error::BadNonce))
    );
    assert_eq!(
        ctx.client.try_commit(&id, &5u32, &hash(&ctx.env, 1)),
        Err(Ok(crate::Error::BadNonce))
    );
}

#[test]
fn non_sequencer_settle_fails() {
    let ctx = setup();
    let id = open(&ctx);
    // Only player_a is authorized; settle requires the sequencer.
    ctx.env.mock_auths(&[MockAuth {
        address: &ctx.a,
        invoke: &MockAuthInvoke {
            contract: &ctx.client.address,
            fn_name: "settle",
            args: (&id, &hash(&ctx.env, 1), &Bytes::new(&ctx.env)).into_val(&ctx.env),
            sub_invokes: &[],
        },
    }]);
    let res = ctx.client.try_settle(&id, &hash(&ctx.env, 1), &Bytes::new(&ctx.env));
    assert!(res.is_err(), "settle by non-sequencer must be rejected");
    let s = ctx.client.get_session(&id);
    assert_eq!(s.status, Status::Open);
}

#[test]
fn non_sequencer_commit_fails() {
    let ctx = setup();
    let id = open(&ctx);
    ctx.env.mock_auths(&[MockAuth {
        address: &ctx.b,
        invoke: &MockAuthInvoke {
            contract: &ctx.client.address,
            fn_name: "commit",
            args: (&id, &1u32, &hash(&ctx.env, 1)).into_val(&ctx.env),
            sub_invokes: &[],
        },
    }]);
    let res = ctx.client.try_commit(&id, &1u32, &hash(&ctx.env, 1));
    assert!(res.is_err(), "commit by non-sequencer must be rejected");
}

#[test]
fn force_close_before_timeout_fails_after_succeeds() {
    let ctx = setup();
    let id = ctx.client.open_session(&ctx.a, &ctx.b, &10u32);

    // Still inside the timeout window.
    assert_eq!(
        ctx.client.try_force_close(&ctx.a, &id),
        Err(Ok(crate::Error::TimeoutNotReached))
    );

    // Move the ledger past opened_ledger + timeout_ledgers.
    let opened = ctx.client.get_session(&id).opened_ledger;
    ctx.env.ledger().set_sequence_number(opened + 10 + 1);
    ctx.client.force_close(&ctx.b, &id);
    let s = ctx.client.get_session(&id);
    assert_eq!(s.status, Status::Closed);
}

#[test]
fn player_b_cannot_open() {
    let ctx = setup();
    // Only B is authorized; open_session requires player_a.
    ctx.env.mock_auths(&[MockAuth {
        address: &ctx.b,
        invoke: &MockAuthInvoke {
            contract: &ctx.client.address,
            fn_name: "open_session",
            args: (&ctx.a, &ctx.b, &60u32).into_val(&ctx.env),
            sub_invokes: &[],
        },
    }]);
    let res = ctx.client.try_open_session(&ctx.a, &ctx.b, &60u32);
    assert!(res.is_err(), "player_b must not be able to authorize open_session");
    // But A opening (with B as the counterparty) works and A is the auth.
    ctx.env.mock_all_auths();
    let id = ctx.client.open_session(&ctx.a, &ctx.b, &60u32);
    assert_eq!(
        ctx.env.auths(),
        [(
            ctx.a.clone(),
            soroban_sdk::testutils::AuthorizedInvocation {
                function: soroban_sdk::testutils::AuthorizedFunction::Contract((
                    ctx.client.address.clone(),
                    "open_session".into_val(&ctx.env),
                    (&ctx.a, &ctx.b, &60u32).into_val(&ctx.env),
                )),
                sub_invocations: [].into(),
            }
        )]
    );
    let _ = id;
}

#[test]
fn both_players_can_close_after_settle() {
    let ctx = setup();
    let id1 = open(&ctx);
    let id2 = ctx.client.open_session(&ctx.a, &ctx.b, &60u32);
    let result = Bytes::from_array(&ctx.env, &[1u8, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4]);
    ctx.client.settle(&id1, &hash(&ctx.env, 1), &result);
    ctx.client.settle(&id2, &hash(&ctx.env, 1), &result);

    ctx.client.close(&ctx.a, &id1); // A closes session 1
    ctx.client.close(&ctx.b, &id2); // B closes session 2
    assert_eq!(ctx.client.get_session(&id1).status, Status::Closed);
    assert_eq!(ctx.client.get_session(&id2).status, Status::Closed);
}

#[test]
fn close_before_settle_fails() {
    let ctx = setup();
    let id = open(&ctx);
    assert_eq!(
        ctx.client.try_close(&ctx.a, &id),
        Err(Ok(crate::Error::BadStatus))
    );
}

#[test]
fn stranger_cannot_close() {
    let ctx = setup();
    let id = open(&ctx);
    let stranger = Address::generate(&ctx.env);
    let result = Bytes::from_array(&ctx.env, &[1u8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9]);
    ctx.client.settle(&id, &hash(&ctx.env, 1), &result);
    assert_eq!(
        ctx.client.try_close(&stranger, &id),
        Err(Ok(crate::Error::NotPlayer))
    );
}

#[test]
fn settle_twice_fails() {
    let ctx = setup();
    let id = open(&ctx);
    let result = Bytes::from_array(&ctx.env, &[1u8, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    ctx.client.settle(&id, &hash(&ctx.env, 1), &result);
    assert_eq!(
        ctx.client.try_settle(&id, &hash(&ctx.env, 2), &result),
        Err(Ok(crate::Error::BadStatus))
    );
}

#[test]
fn result_too_long_fails() {
    let ctx = setup();
    let id = open(&ctx);
    let long = Bytes::from_array(&ctx.env, &[7u8; 65]);
    assert_eq!(
        ctx.client.try_settle(&id, &hash(&ctx.env, 1), &long),
        Err(Ok(crate::Error::ResultTooLong))
    );
    // 64 bytes is the max allowed.
    let max = Bytes::from_array(&ctx.env, &[7u8; 64]);
    ctx.client.settle(&id, &hash(&ctx.env, 1), &max);
    assert_eq!(ctx.client.get_session(&id).status, Status::Settled);
}

#[test]
fn open_session_validation() {
    let ctx = setup();
    // Same players rejected.
    assert_eq!(
        ctx.client.try_open_session(&ctx.a, &ctx.a, &60u32),
        Err(Ok(crate::Error::SamePlayers))
    );
    // Timeout out of range: 10..=1200.
    assert_eq!(
        ctx.client.try_open_session(&ctx.a, &ctx.b, &9u32),
        Err(Ok(crate::Error::TimeoutOutOfRange))
    );
    assert_eq!(
        ctx.client.try_open_session(&ctx.a, &ctx.b, &1201u32),
        Err(Ok(crate::Error::TimeoutOutOfRange))
    );
    // Boundaries accepted.
    let _ = ctx.client.open_session(&ctx.a, &ctx.b, &10u32);
    let _ = ctx.client.open_session(&ctx.a, &ctx.b, &1200u32);
}

#[test]
fn uninitialized_contract_rejects_calls() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SessionRegistry, ());
    let client = SessionRegistryClient::new(&env, &contract_id);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    assert_eq!(
        client.try_open_session(&a, &b, &60u32),
        Err(Ok(crate::Error::NotInitialized))
    );
}

#[test]
fn double_initialize_fails() {
    let ctx = setup();
    assert_eq!(
        ctx.client.try_initialize(&ctx.admin, &ctx.sequencer),
        Err(Ok(crate::Error::AlreadyInitialized))
    );
}

#[test]
fn get_operator_and_update() {
    let ctx = setup();
    assert_eq!(ctx.client.get_operator(), ctx.sequencer);
    // Only the admin can rotate the operator.
    let new_op = Address::generate(&ctx.env);
    ctx.env.mock_auths(&[MockAuth {
        address: &ctx.b,
        invoke: &MockAuthInvoke {
            contract: &ctx.client.address,
            fn_name: "update_operator",
            args: (&new_op,).into_val(&ctx.env),
            sub_invokes: &[],
        },
    }]);
    assert!(ctx.client.try_update_operator(&new_op).is_err());
    assert_eq!(ctx.client.get_operator(), ctx.sequencer);

    ctx.env.mock_all_auths();
    ctx.client.update_operator(&new_op);
    assert_eq!(ctx.client.get_operator(), new_op);
    // New sessions bind to the new operator.
    let id = ctx.client.open_session(&ctx.a, &ctx.b, &60u32);
    assert_eq!(ctx.client.get_session(&id).sequencer, new_op);
}
