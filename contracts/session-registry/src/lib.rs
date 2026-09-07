//! SessionRegistry — Pulsar v0 session lifecycle on Stellar.
//!
//! A session locks two players to a sequencer for the duration of an
//! off-chain game. The sequencer commits state hashes and settles the
//! final result (12 packed bytes for tic-tac-toe). Players can
//! `force_close` after `timeout_ledgers`, which is the only user-side
//! protection in v0 — this is a **trusted sequencer** prototype.
//!
//! Note on OR-authorization: `close`/`force_close` may be triggered by
//! player_a OR player_b. Soroban's `require_auth` has no try/fallback,
//! so these functions take an explicit `caller: Address` argument and
//! verify membership after `caller.require_auth()`.

#![no_std]

use soroban_sdk::{contract, contracterror, contractevent, contractimpl, contracttype, Address, Bytes, BytesN, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    SessionNotFound = 3,
    BadStatus = 4,
    BadNonce = 5,
    NotSequencer = 6,
    TimeoutNotReached = 7,
    ResultTooLong = 8,
    SamePlayers = 9,
    TimeoutOutOfRange = 10,
    NotPlayer = 11,
    NotAdmin = 12,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Status {
    Open = 1,
    Settled = 2,
    Closed = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Session {
    pub id: u64,
    pub player_a: Address,
    pub player_b: Address,
    pub sequencer: Address,
    pub status: Status,
    pub opened_ledger: u32,
    pub timeout_ledgers: u32,
    pub nonce: u32,
    pub state_hash: BytesN<32>,
    pub result: Bytes,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DataKey {
    Admin,
    Operator,
    NextId,
    Session(u64),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionOpened {
    #[topic]
    pub id: u64,
    pub player_a: Address,
    pub player_b: Address,
    pub sequencer: Address,
    pub timeout_ledgers: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionCommitted {
    #[topic]
    pub id: u64,
    pub nonce: u32,
    pub state_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionSettled {
    #[topic]
    pub id: u64,
    pub state_hash: BytesN<32>,
    pub result: Bytes,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionClosed {
    #[topic]
    pub id: u64,
    /// 1 = normal close after settle, 2 = timeout force-close.
    pub reason: u32,
}

#[contract]
pub struct SessionRegistry;

fn require_initialized(env: &Env) -> Result<(), Error> {
    if env.storage().instance().has(&DataKey::Admin) {
        Ok(())
    } else {
        Err(Error::NotInitialized)
    }
}

fn load_session(env: &Env, id: u64) -> Result<Session, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Session(id))
        .ok_or(Error::SessionNotFound)
}

#[contractimpl]
impl SessionRegistry {
    /// Set the admin (who can rotate the operator) and the operator
    /// (the trusted sequencer). Call once after deploy.
    pub fn initialize(env: Env, admin: Address, operator: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Operator, &operator);
        env.storage().instance().set(&DataKey::NextId, &1u64);
        Ok(())
    }

    /// Open a session. Auth: `player_a` (A always opens in the v0 demo).
    /// The session's sequencer is bound to the current contract Operator.
    pub fn open_session(
        env: Env,
        player_a: Address,
        player_b: Address,
        timeout_ledgers: u32,
    ) -> Result<u64, Error> {
        require_initialized(&env)?;
        player_a.require_auth();
        if player_a == player_b {
            return Err(Error::SamePlayers);
        }
        if !(10..=1200).contains(&timeout_ledgers) {
            return Err(Error::TimeoutOutOfRange);
        }

        let operator: Address = env
            .storage()
            .instance()
            .get(&DataKey::Operator)
            .ok_or(Error::NotInitialized)?;

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(1);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        let session = Session {
            id,
            player_a: player_a.clone(),
            player_b: player_b.clone(),
            sequencer: operator.clone(),
            status: Status::Open,
            opened_ledger: env.ledger().sequence(),
            timeout_ledgers,
            nonce: 0,
            state_hash: BytesN::from_array(&env, &[0u8; 32]),
            result: Bytes::new(&env),
        };
        env.storage().persistent().set(&DataKey::Session(id), &session);

        SessionOpened {
            id,
            player_a,
            player_b,
            sequencer: operator,
            timeout_ledgers,
        }
        .publish(&env);

        Ok(id)
    }

    /// The sequencer commits a state hash, strictly nonce-increasing.
    pub fn commit(env: Env, id: u64, nonce: u32, state_hash: BytesN<32>) -> Result<(), Error> {
        require_initialized(&env)?;
        let mut session = load_session(&env, id)?;
        session.sequencer.require_auth();
        if session.status != Status::Open {
            return Err(Error::BadStatus);
        }
        if nonce != session.nonce + 1 {
            return Err(Error::BadNonce);
        }
        session.nonce = nonce;
        session.state_hash = state_hash.clone();
        env.storage().persistent().set(&DataKey::Session(id), &session);

        SessionCommitted {
            id,
            nonce,
            state_hash,
        }
        .publish(&env);
        Ok(())
    }

    /// The sequencer settles the final result. `result` is at most 64
    /// bytes; for Pulsar tic-tac-toe it is the packed 12-byte payload.
    pub fn settle(env: Env, id: u64, state_hash: BytesN<32>, result: Bytes) -> Result<(), Error> {
        require_initialized(&env)?;
        let mut session = load_session(&env, id)?;
        session.sequencer.require_auth();
        if session.status != Status::Open {
            return Err(Error::BadStatus);
        }
        if result.len() > 64 {
            return Err(Error::ResultTooLong);
        }

        session.status = Status::Settled;
        session.nonce += 1;
        session.state_hash = state_hash.clone();
        session.result = result.clone();
        env.storage().persistent().set(&DataKey::Session(id), &session);

        SessionSettled {
            id,
            state_hash,
            result,
        }
        .publish(&env);
        Ok(())
    }

    /// Close a settled session. Auth: `caller`, who must be player_a or
    /// player_b (explicit-caller pattern for OR-authorization).
    pub fn close(env: Env, caller: Address, id: u64) -> Result<(), Error> {
        require_initialized(&env)?;
        caller.require_auth();
        let mut session = load_session(&env, id)?;
        if caller != session.player_a && caller != session.player_b {
            return Err(Error::NotPlayer);
        }
        if session.status != Status::Settled {
            return Err(Error::BadStatus);
        }
        session.status = Status::Closed;
        env.storage().persistent().set(&DataKey::Session(id), &session);

        SessionClosed { id, reason: 1 }.publish(&env);
        Ok(())
    }

    /// Force-close a stuck Open session after the timeout. Auth: `caller`
    /// (player_a or player_b). This is the v0 escape hatch against a
    /// non-responsive/lying sequencer.
    pub fn force_close(env: Env, caller: Address, id: u64) -> Result<(), Error> {
        require_initialized(&env)?;
        caller.require_auth();
        let mut session = load_session(&env, id)?;
        if caller != session.player_a && caller != session.player_b {
            return Err(Error::NotPlayer);
        }
        if session.status != Status::Open {
            return Err(Error::BadStatus);
        }
        if env.ledger().sequence() <= session.opened_ledger + session.timeout_ledgers {
            return Err(Error::TimeoutNotReached);
        }
        session.status = Status::Closed;
        env.storage().persistent().set(&DataKey::Session(id), &session);

        SessionClosed { id, reason: 2 }.publish(&env);
        Ok(())
    }

    /// Rotate the sequencer operator. Auth: admin.
    pub fn update_operator(env: Env, new_operator: Address) -> Result<(), Error> {
        require_initialized(&env)?;
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Operator, &new_operator);
        Ok(())
    }

    pub fn get_session(env: Env, id: u64) -> Result<Session, Error> {
        load_session(&env, id)
    }

    pub fn get_operator(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Operator)
            .ok_or(Error::NotInitialized)
    }
}

#[cfg(test)]
mod test;
