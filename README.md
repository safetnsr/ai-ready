# ai-ready

Pre-session codebase AI-readiness scorer — **know before you claude**.

Analyzes your codebase and tells you which files will hit the AI complexity wall before you start a Claude Code session.

## Install

```bash
npx @safetnsr/ai-ready
```

## Usage

```bash
ai-ready [dir] [options]
```

### Sample Output

```
ai-ready — codebase scan complete

FILE                    SCORE  TOP ISSUE              FIX
src/auth/index.ts        12    function too long      split into smaller functions
src/api/middleware.ts    34    high coupling           extract shared utils
src/utils/helpers.ts     87    ✓ AI-ready

overall: 54/100 ⚠️  some modules need work before AI sessions
→ split src/auth/index.ts into smaller files first (biggest win)
→ high coupling in src/api/middleware.ts
```

## Flags

| Flag | Description |
|------|-------------|
| `[dir]` | Directory to scan (default: `.`) |
| `--json` | Machine-readable JSON output |
| `--top N` | Show only worst N files |
| `--min-score N` | Only show files below score N |
| `--ci` | Exit 1 if overall < 60, exit 0 if ≥ 60 |
| `--explain` | Show per-signal breakdown per file |
| `--ext LIST` | Comma-separated extensions (default: `.ts,.js,.tsx,.jsx`) |
| `-h, --help` | Show help |

## Scoring

Each file is scored 0-100 based on five signals:

| Signal | Weight | What it measures |
|--------|--------|-----------------|
| Function length | 30% | Average function length (< 20 lines = 100) |
| Coupling | 25% | Import count (≤ 3 = 100) |
| Test coverage | 25% | Matching test file exists |
| Comment density | 10% | Comment-to-code ratio |
| File size | 10% | Total line count (≤ 150 = 100) |

## Agent Interface (`--json`)

```bash
ai-ready --json | jq '.files[] | select(.score < 40)'
```

JSON schema:

```json
{
  "files": [
    {
      "path": "src/auth/index.ts",
      "score": 12,
      "issues": ["function too long", "split into smaller functions"],
      "signals": {
        "functionLength": 0,
        "coupling": 0,
        "testCoverage": 0,
        "commentDensity": 10,
        "fileSize": 40
      }
    }
  ],
  "overall": 54,
  "recommendations": ["split src/auth/index.ts into smaller files first (biggest win)"]
}
```

## CI Integration

```yaml
# .github/workflows/ai-ready.yml
- name: Check AI readiness
  run: npx @safetnsr/ai-ready --ci
```

Exit codes:
- `0` — overall score ≥ 60 (ready for AI sessions)
- `1` — overall score < 60 (refactor first)

## Pair With

- [vibe-check](https://github.com/safetnsr/vibe-check) — post-session risk scanner
- [session-distill](https://github.com/safetnsr/session-distill) — generate CLAUDE.md from session history
- [human-edge](https://github.com/safetnsr/human-edge) — your AI-replaceability score

## License

MIT
