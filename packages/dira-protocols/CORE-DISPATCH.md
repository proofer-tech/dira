# Dispatching now (`--reason judge`)

Cron picks up any open ticket within 30 seconds, so dispatching is only an
optimization. Call the module when waiting costs a person or a chain.

## Call it when

1. A human is waiting in the current conversation on the ticket you just created.
2. The ticket you are closing resolves another ticket's `deps` - pass the
   unblocked hash.
3. Your own continuation cannot start without a handoff you just issued - pass
   that handoff's hash.

## Do not call it

For every other ticket you create. Cron covers it; extra calls only add
`KICK-SKIP` lines to `runner.log`.

## Command

    python3 <engine>/dispatch.py run <root> --reason judge --hash <hash>

`--hash` is required. Add `--dryrun` to see the verdict without launching.

## Reading the result

One JSON line: `{"go", "worker", "hash", "reason", "why"}`. Exit 0 = launched,
1 = not launched, 2 = usage error.

`go: false` (exit 1) is not a failure: load above `load_max`, no idle worker,
another open candidate, or the hash is not a candidate. `why` says which. Never
retry in a loop and never fail your ticket over it - cron picks the ticket up
anyway.
