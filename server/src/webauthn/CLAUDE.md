# server/src/webauthn

Hand-written WebAuthn verification (docs/01 §6.0, D11). Read docs/01 §6 before changing anything here.

## Invariants

- Every §6 item is one file in `checks/` (`C1.ts`, `A3.ts`, ...) with its test next to it.
- Routes run the pipeline only through `runInspected({ ceremony: 'register' | 'login' | 'stepup' | 'add_credential', ... })` (`routes/inspected.ts`), which picks the frozen `REGISTRATION_CHECKS` (also for `add_credential`), `AUTHENTICATION_CHECKS` or `STEPUP_CHECKS` from `pipeline.ts`. The transfer, add-passkey verify and delete-passkey routes run the frozen `OPERATION_GATE_CHECKS` only through `runOperationGate`. Routes never pass a list of checks. Never add a flag, option, environment variable or parameter that skips or reorders checks in production code.
- Never remove a check from a pipeline, or weaken one, to make a test pass. `test/pipeline.test.ts` fails if the list stops matching §6; that is intentional.
- Never delete or skip a scenario in `test/attacks.test.ts`, `test/login-attacks.test.ts`, `test/stepup-attacks.test.ts`, `test/add-credential-attacks.test.ts` or `test/operation-gate-attacks.test.ts`. Each one proves that the full pipeline rejects an attack and that removing that one check lets it through. Where another check still stops the attack once this one is removed (defense in depth), the scenario records that check in `withoutCheckRejectedBy`. Use that only when no attack can get through without this check, and say why in the scenario: L1, because L2/S1 and L3 need the stored credential. A check that can be bypassed alone needs a scenario that goes through (S3 has expiry and reuse; its no-approval scenario is the extra, defense-in-depth one).
- Step-up uses S1, not L2: with allowCredentials set, userHandle may be absent. S2 rejects a missing approval itself; never leave that to S3 alone. The approval is loaded into the operation gate context when it is built, so S2 compares against it without depending on S3 (D41). S3 still runs first and consumes it, so a request S2 rejects burns the approval too (D38). An approval is bound to one operation, kind included (`operationHash`, D42).
- Ceremonies inside a logged-in session (`SESSION_BOUND_PURPOSES` in `checks/C5.ts`: step-up, adding a passkey) are bound to that session by C5, not to the ceremony cookie (D40, D45). An added passkey is stored for the challenge row's user, so removing C5 lets the attack through (D45).
- C4 (consume the challenge) runs first. Everything after it may throw, including lazy decoding of the attestation object, and the challenge must already be gone by then. Do not decode anything except clientDataJSON before the pipeline runs.
- Parsing (`parse.ts`, `cose.ts`, `cbor.ts`) only decodes and throws `ParseError`. Deciding whether a well-formed response is acceptable belongs in a check. The exception is a response that is not structurally a registration response (D23: attestation other than `none`, no attested data, `rawId` differing from authData); those are `ParseError`s because removing them would not enable any attack.
- Every recursive or size-dependent parser step needs a bound (CBOR depth, lengths); a crafted input must end as `ParseError`, never as a crash or 500.
- `@simplewebauthn/server` may be used only in tests, as a reference implementation (`test/differential.test.ts`, M5). Never change a check to make that test agree; a disagreement is a row with a reason.

## Adding a check

1. Add the item to docs/01 §6 and a row to docs/decisions.md.
2. Add `checks/<ID>.ts` and `checks/<ID>.test.ts`, then add it to the pipeline constant.
3. Add the ID to `test/pipeline.test.ts` and an attack scenario to the attack test of its pipeline (`attacks`, `login-attacks`, `stepup-attacks`, `add-credential-attacks` or `operation-gate-attacks`).
