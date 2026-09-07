//! Unit tests for SlowTicTacToe.
use crate::{SlowTicTacToe, SlowTicTacToeClient};
use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{Address, Env, IntoVal, Vec};

fn empty_board(env: &Env) -> Vec<u32> {
    Vec::from_array(env, [0u32; 9])
}

struct Ctx {
    env: Env,
    client: SlowTicTacToeClient<'static>,
    a: Address,
    b: Address,
    id: u64,
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SlowTicTacToe, ());
    let client = SlowTicTacToeClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let id = client.create_game(&a, &b);
    Ctx { env, client, a, b, id }
}

fn play_all(ctx: &Ctx, cells: &[u32]) {
    for &c in cells {
        ctx.client.play(&ctx.id, &c);
    }
}

#[test]
fn create_game_sets_initial_state() {
    let ctx = setup();
    // auths() reports only the latest invocation — assert before reading.
    assert_eq!(
        ctx.env.auths(),
        [(
            ctx.a.clone(),
            soroban_sdk::testutils::AuthorizedInvocation {
                function: soroban_sdk::testutils::AuthorizedFunction::Contract((
                    ctx.client.address.clone(),
                    "create_game".into_val(&ctx.env),
                    (&ctx.a, &ctx.b).into_val(&ctx.env),
                )),
                sub_invocations: [].into(),
            }
        )]
    );
    let g = ctx.client.get_game(&ctx.id);
    assert_eq!(g.id, ctx.id);
    assert_eq!(g.player_a, ctx.a);
    assert_eq!(g.player_b, ctx.b);
    assert_eq!(g.next, 1);
    assert_eq!(g.board, empty_board(&ctx.env));
    assert_eq!(g.winner, 0);
    assert_eq!(g.move_count, 0);
}

#[test]
fn win_on_row() {
    let ctx = setup();
    play_all(&ctx, &[0, 3, 1, 4, 2]); // X: 0,1,2 — O: 3,4
    let g = ctx.client.get_game(&ctx.id);
    assert_eq!(g.winner, 1);
    assert_eq!(g.move_count, 5);
    assert_eq!(g.next, 2); // turn already flipped past the winning move
}

#[test]
fn win_on_diagonal_for_o() {
    let ctx = setup();
    play_all(&ctx, &[0, 2, 1, 4, 7, 6]); // O: 2,4,6
    let g = ctx.client.get_game(&ctx.id);
    assert_eq!(g.winner, 2);
}

#[test]
fn reject_occupied_cell() {
    let ctx = setup();
    ctx.client.play(&ctx.id, &4);
    assert_eq!(
        ctx.client.try_play(&ctx.id, &4),
        Err(Ok(crate::Error::CellOccupied))
    );
    let g = ctx.client.get_game(&ctx.id);
    assert_eq!(g.board.get(4).unwrap_or(0), 1); // still X, not overwritten by O
}

#[test]
fn reject_out_of_range_cell() {
    let ctx = setup();
    assert_eq!(
        ctx.client.try_play(&ctx.id, &9u32),
        Err(Ok(crate::Error::CellOutOfRange))
    );
    assert_eq!(
        ctx.client.try_play(&ctx.id, &100u32),
        Err(Ok(crate::Error::CellOutOfRange))
    );
}

#[test]
fn reject_move_after_game_over() {
    let ctx = setup();
    play_all(&ctx, &[0, 3, 1, 4, 2]); // X wins
    assert_eq!(
        ctx.client.try_play(&ctx.id, &8u32),
        Err(Ok(crate::Error::GameOver))
    );
}

#[test]
fn reject_out_of_turn_move() {
    let ctx = setup();
    // It is X's (A's) turn. Authorize only B, then A's require_auth fails.
    ctx.env.mock_auths(&[MockAuth {
        address: &ctx.b,
        invoke: &MockAuthInvoke {
            contract: &ctx.client.address,
            fn_name: "play",
            args: (&ctx.id, &0u32).into_val(&ctx.env),
            sub_invokes: &[],
        },
    }]);
    let res = ctx.client.try_play(&ctx.id, &0u32);
    assert!(res.is_err(), "out-of-turn move must be rejected");
    // Board unchanged.
    let g = ctx.client.get_game(&ctx.id);
    assert_eq!(g.board, empty_board(&ctx.env));
    assert_eq!(g.move_count, 0);
}

#[test]
fn draw_game() {
    let ctx = setup();
    // X: 0,2,3,7,8 — O: 1,4,5,6 — no line, board full.
    play_all(&ctx, &[0, 1, 2, 4, 3, 5, 7, 6, 8]);
    let g = ctx.client.get_game(&ctx.id);
    assert_eq!(g.winner, 3);
    assert_eq!(g.move_count, 9);
    assert_eq!(
        ctx.client.try_play(&ctx.id, &8u32),
        Err(Ok(crate::Error::GameOver))
    );
}

#[test]
fn reject_same_players() {
    let ctx = setup();
    assert_eq!(
        ctx.client.try_create_game(&ctx.a, &ctx.a),
        Err(Ok(crate::Error::SamePlayers))
    );
}

#[test]
fn reject_uninitialized_use() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SlowTicTacToe, ());
    let client = SlowTicTacToeClient::new(&env, &contract_id);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    assert_eq!(
        client.try_create_game(&a, &b),
        Err(Ok(crate::Error::NotInitialized))
    );
}

#[test]
fn game_not_found() {
    let ctx = setup();
    assert_eq!(
        ctx.client.try_get_game(&42u64),
        Err(Ok(crate::Error::GameNotFound))
    );
}
