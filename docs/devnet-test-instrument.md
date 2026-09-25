# Devnet test instruments

Superseded by [devnet.md](devnet.md) (2026-09-25). The earlier design — a
fixed 1:1 "test market" and faucet inside the core program — was removed. Test
infrastructure now lives in the separate `tenet-devnet` program, with priced
markets and feeds, and the core program reaches it only through its fail-closed
Devnet `Config`.
