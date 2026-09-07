//! SlowTicTacToe — fully on-chain tic-tac-toe for Pulsar's **L1 mode**.
//!
//! Every move is a real Soroban transaction that waits for a ledger close
//! (~5s on Testnet), so the L1 side of the demo is honest.
//!
//! Board: 9 cells, row-major. `0` empty, `1` = X (player A, first),
//! `2` = O (player B). Rules are identical to `packages/shared`.

#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    GameNotFound = 3,
    CellOutOfRange = 4,
    CellOccupied = 5,
    GameOver = 6,
    SamePlayers = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub id: u64,
    pub player_a: Address,
    pub player_b: Address,
    /// 1 or 2 — whose turn it is.
    pub next: u32,
    /// Row-major board (9 cells), 0/1/2. Vec<u32> is the SDK-supported
    /// fixed-shape container; the 10-line win checker below mirrors
    /// `packages/shared` `winnerOf`.
    pub board: Vec<u32>,
    /// 0 = in progress, 1 = A, 2 = B, 3 = draw.
    pub winner: u32,
    pub move_count: u32,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    NextId,
    Game(u64),
}

const WIN_LINES: &[(u32, u32, u32)] = &[
    (0, 1, 2),
    (3, 4, 5),
    (6, 7, 8),
    (0, 3, 6),
    (1, 4, 7),
    (2, 5, 8),
    (0, 4, 8),
    (2, 4, 6),
];

fn winner_of(board: &Vec<u32>) -> u32 {
    for &(a, b, c) in WIN_LINES {
        let va = board.get(a).unwrap_or(0);
        let vb = board.get(b).unwrap_or(0);
        let vc = board.get(c).unwrap_or(0);
        if va != 0 && va == vb && vb == vc {
            return va;
        }
    }
    if board.iter().all(|v| v != 0) {
        3 // draw
    } else {
        0
    }
}

#[contract]
pub struct SlowTicTacToe;

fn require_initialized(env: &Env) -> Result<(), Error> {
    if env.storage().instance().has(&DataKey::Admin) {
        Ok(())
    } else {
        Err(Error::NotInitialized)
    }
}

#[contractimpl]
impl SlowTicTacToe {
    /// Store the admin (deployer). Admin is not used for gameplay in v0.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextId, &1u64);
        Ok(())
    }

    /// Create a game; `player_a` (X) moves first and pays the auth.
    pub fn create_game(env: Env, player_a: Address, player_b: Address) -> Result<u64, Error> {
        require_initialized(&env)?;
        player_a.require_auth();
        if player_a == player_b {
            return Err(Error::SamePlayers);
        }
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(1);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        let game = Game {
            id,
            player_a: player_a.clone(),
            player_b,
            next: 1,
            board: Vec::from_array(&env, [0u32; 9]),
            winner: 0,
            move_count: 0,
        };
        env.storage().persistent().set(&DataKey::Game(id), &game);
        Ok(id)
    }

    /// Play a move in `cell` (0..8). Requires auth of the player whose
    /// turn it is, so out-of-turn submissions are rejected by the host.
    pub fn play(env: Env, id: u64, cell: u32) -> Result<(), Error> {
        require_initialized(&env)?;
        let mut game: Game = env
            .storage()
            .persistent()
            .get(&DataKey::Game(id))
            .ok_or(Error::GameNotFound)?;

        if game.winner != 0 {
            return Err(Error::GameOver);
        }
        if cell > 8 {
            return Err(Error::CellOutOfRange);
        }

        // The authorized address is fully determined by state: whoever's
        // turn it is. This is how "auth current player" rejects B moving
        // during A's turn.
        let current = if game.next == 1 {
            game.player_a.clone()
        } else {
            game.player_b.clone()
        };
        current.require_auth();

        let idx = cell;
        if game.board.get(idx).unwrap_or(1) != 0 {
            return Err(Error::CellOccupied);
        }

        game.board.set(idx, game.next);
        game.move_count += 1;
        game.winner = winner_of(&game.board);
        game.next = if game.next == 1 { 2 } else { 1 };

        env.storage().persistent().set(&DataKey::Game(id), &game);
        Ok(())
    }

    pub fn get_game(env: Env, id: u64) -> Result<Game, Error> {
        require_initialized(&env)?;
        env.storage()
            .persistent()
            .get(&DataKey::Game(id))
            .ok_or(Error::GameNotFound)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }
}

#[cfg(test)]
mod test;
