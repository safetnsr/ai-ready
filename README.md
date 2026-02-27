# ai-ready

pre-session agent briefing for JS/TS codebases. know the risks before you start.

**not a readiness score.** a context tool — analyzes circular deps, global state, missing types, and test coverage per file so you (or your agent) know what to watch out for before editing.

## install

```bash
npx @safetnsr/ai-ready
```

zero install. runs on node >=18.

## usage

```bash
npx @safetnsr/ai-ready                    # scan current directory (top 10 riskiest)
npx @safetnsr/ai-ready src/auth/          # brief me on auth module
npx @safetnsr/ai-ready src/auth/index.ts  # brief me on one file
npx @safetnsr/ai-ready --json             # machine-readable for agent consumption
npx @safetnsr/ai-ready --top 5            # show 5 riskiest files
```

## example output

```
ai-ready — pre-session briefing
────────────────────────────────────────

src/auth/index.ts  [HIGH RISK]
  ⚠ circular dep   → src/api/middleware.ts
  ⚠ global state   → config (line 12), sessionStore (line 45)
  ⚠ missing types  → 8 exported functions without return type
  ✓ tests          → 12 assertions
  → read src/api/middleware.ts before touching this file.
  → avoid config, sessionStore — shared state.

src/api/routes.ts  [MEDIUM RISK]
  ✓ no circular deps
  ⚠ global state   → rateLimiter (line 8)
  ✓ types ok
  ✓ tests          → 8 assertions

────────────────────────────────────────
1 high risk. 1 medium. 2 files need attention before starting your session.
```

## flags

| flag | description |
|------|-------------|
| `--json` | machine-readable JSON output |
| `--top <n>` | show only top N riskiest files |
| `--context` | alias for default behavior (explicit) |
| `--version`, `-v` | show version |
| `--help`, `-h` | show help |

## what it checks

- **circular dependencies** — detected via [madge](https://github.com/pahen/madge). files in a cycle are high risk.
- **global mutable state** — module-level `let`/`var` declarations that can be mutated from anywhere.
- **missing return types** — exported functions without explicit return type annotations.
- **test coverage** — whether a matching test file exists and how many assertions it contains.

## risk levels

- **high** — circular deps, >2 global mutations, or >5 missing return types
- **medium** — any global mutation, >2 missing return types, or no test file
- **low** — clean, safe to edit

## exit codes

- `0` — no high-risk files found
- `1` — one or more high-risk files found

## agent integration

run before starting a coding session to brief your agent:

```bash
npx @safetnsr/ai-ready src/ --json
```

json schema:

```json
{
  "files": [
    {
      "file": "src/auth/index.ts",
      "risk_level": "high",
      "circular_deps": ["src/api/middleware.ts"],
      "global_mutations": [
        { "name": "config", "line": 12 }
      ],
      "missing_return_types": 8,
      "test_coverage": { "has_test_file": true, "assertion_count": 12 },
      "briefing": "read src/api/middleware.ts first. avoid config — shared state."
    }
  ],
  "summary": "2 high risk files. 1 medium. review before starting session."
}
```

feed this into your agent's system prompt or pre-session context for safer edits.

## suite

pair with [vibe-check](https://github.com/safetnsr/vibe-check):

- **ai-ready** before your session — know the risks
- **vibe-check** after your session — validate the vibes

```bash
npx @safetnsr/ai-ready src/     # before: what to watch out for
# ... do your work ...
npx @safetnsr/vibe-check src/   # after: did anything break?
```

## license

MIT
