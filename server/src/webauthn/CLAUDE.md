# server/src/webauthn

Hand-written WebAuthn verification (docs/01 §6.0, D11). Read docs/01 §6 before changing anything here.

## Invariants

- Every §6 item is one file in `checks/` (`C1.ts`, `A3.ts`, ...) with its test next to it.
- Routes run the pipeline only through `runInspected({ ceremony: 'register' | 'login', ... })` (`routes/inspected.ts`), which picks the frozen `REGISTRATION_CHECKS` or `AUTHENTICATION_CHECKS` from `pipeline.ts`. Routes never pass a list of checks. Never add a flag, option, environment variable or parameter that skips or reorders checks in production code.
- Never remove a check from a pipeline, or weaken one, to make a test pass. `test/pipeline.test.ts` fails if the list stops matching §6; that is intentional.
- Never delete or skip a scenario in `test/attacks.test.ts`. Each one proves that the full pipeline rejects an attack and that removing that one check lets it through.
- C4 (consume the challenge) runs first. Everything after it may throw, including lazy decoding of the attestation object, and the challenge must already be gone by then. Do not decode anything except clientDataJSON before the pipeline runs.
- Parsing (`parse.ts`, `cose.ts`, `cbor.ts`) only decodes and throws `ParseError`. Deciding whether a well-formed response is acceptable belongs in a check. The exception is a response that is not structurally a registration response (D23: attestation other than `none`, no attested data, `rawId` differing from authData); those are `ParseError`s because removing them would not enable any attack.
- Every recursive or size-dependent parser step needs a bound (CBOR depth, lengths); a crafted input must end as `ParseError`, never as a crash or 500.
- `@simplewebauthn/server` may be used only in tests, as a reference implementation (`test/differential.test.ts`, M5). Never change a check to make that test agree; a disagreement is a row with a reason.

## Adding a check

1. Add the item to docs/01 §6 and a row to docs/decisions.md.
2. Add `checks/<ID>.ts` and `checks/<ID>.test.ts`, then add it to the pipeline constant.
3. Add the ID to `test/pipeline.test.ts` and an attack scenario to `test/attacks.test.ts`.
