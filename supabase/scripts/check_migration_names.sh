#!/usr/bin/env bash
# =====================================================================
# Validate the file names in supabase/migrations/
#
#   supabase/scripts/check_migration_names.sh
#       every file must match  <digits>_<name>.sql   (what `supabase db push`
#       accepts — anything else is silently SKIPPED by the CLI, which is
#       exactly the bug we want to catch before it reaches production)
#
#   supabase/scripts/check_migration_names.sh --new-since origin/main
#       additionally: every file ADDED compared to that git ref must
#         * use a 14-digit UTC timestamp   YYYYMMDDHHMMSS_<name>.sql
#           (create it with `supabase migration new <name>`)
#         * sort AFTER every migration that already exists on the base ref
#           (the CLI applies files in version order; a version older than
#            an already-applied one is refused by `db push`)
#         * use only [a-z0-9_] in <name>
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

MIG_DIR="supabase/migrations"
PATTERN='^[0-9]+_.*\.sql$'
NEW_PATTERN='^[0-9]{14}_[a-z0-9_]+\.sql$'

fail=0
err() { echo "::error::$*" >&2; fail=1; }

# ---------------------------------------------------------------- all files
shopt -s nullglob
all=("$MIG_DIR"/*)
if [ ${#all[@]} -eq 0 ]; then echo "no migrations found in $MIG_DIR"; exit 0; fi

for f in "${all[@]}"; do
  b=$(basename "$f")
  if [ -d "$f" ]; then
    err "$MIG_DIR/$b is a directory — only .sql files belong here"
    continue
  fi
  if [[ ! "$b" =~ $PATTERN ]]; then
    err "$MIG_DIR/$b does not match <version>_<name>.sql — the Supabase CLI would SKIP it"
  fi
done

# duplicate versions (0042_a.sql + 0042_b.sql) → CLI history collision
dups=$(for f in "${all[@]}"; do b=$(basename "$f"); echo "${b%%_*}"; done | sort | uniq -d)
if [ -n "$dups" ]; then
  err "duplicate migration version(s): $(echo "$dups" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------- new files
if [ "${1:-}" = "--new-since" ]; then
  base="${2:?usage: --new-since <git-ref>}"
  if ! git rev-parse --verify --quiet "$base" >/dev/null; then
    echo "ref $base not found — skipping new-file checks"
  else
    # highest version that already exists on the base ref
    latest_base=$(git ls-tree --name-only "$base" -- "$MIG_DIR/" \
      | xargs -r -n1 basename | grep -E "$PATTERN" | sed -E 's/_.*//' | sort | tail -1)
    echo "latest migration on $base: ${latest_base:-<none>}"

    new_files=$(git diff --name-only --diff-filter=A "$base"...HEAD -- "$MIG_DIR/" || true)
    if [ -z "$new_files" ]; then
      echo "no new migration files"
    fi
    for path in $new_files; do
      b=$(basename "$path")
      [[ "$b" == *.sql ]] || continue
      if [[ ! "$b" =~ $NEW_PATTERN ]]; then
        err "$b: new migrations must be named YYYYMMDDHHMMSS_<snake_case_name>.sql — run: supabase migration new <name>"
        continue
      fi
      v="${b%%_*}"
      # plausible timestamp: 2025-01-01 .. 2099-12-31
      if [ "$v" -lt 20250101000000 ] || [ "$v" -gt 20991231235959 ]; then
        err "$b: version $v is not a plausible UTC timestamp"
        continue
      fi
      if [ -n "$latest_base" ] && [[ "$v" < "$latest_base" || "$v" == "$latest_base" ]]; then
        err "$b: version $v must be greater than the latest existing migration ($latest_base) — regenerate the timestamp"
        continue
      fi
      echo "ok  $b"
    done

    # renamed / deleted applied migrations break the remote history
    changed=$(git diff --name-only --diff-filter=DMR "$base"...HEAD -- "$MIG_DIR/" || true)
    for path in $changed; do
      echo "::warning::$path was modified/renamed/deleted — already-applied migrations must never change (the CLI will not re-run them). Add a NEW migration instead."
    done
  fi
fi

if [ $fail -ne 0 ]; then
  echo "migration name check FAILED" >&2
  exit 1
fi
echo "migration names OK (${#all[@]} files)"
