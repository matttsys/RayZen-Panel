#!/usr/bin/env bash
#
# Local backup of the RayZen repository, as a git bundle.
#
# A bundle is a single file holding the complete history, which makes it a better
# off-site copy than an archive of the working tree: it can be cloned from
# directly, and it carries every branch and tag rather than one snapshot.
#
#   git clone rayzen-latest.bundle rayzen-restored
#
# and it can be added as a remote to fetch from:
#
#   git remote add backup ../rayzen-backups/rayzen-latest.bundle
#   git fetch backup
#
# Usage:
#   npm run backup
#
# Writes ../rayzen-backups/rayzen-latest.bundle plus a timestamped copy, and
# verifies the result before reporting success.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="$repo_root/../rayzen-backups"
stamp="$(date +%Y%m%d-%H%M%S)"
latest="$backup_dir/rayzen-latest.bundle"
archive="$backup_dir/rayzen-$stamp.bundle"

mkdir -p "$backup_dir"
cd "$repo_root"

if [ -n "$(git status --porcelain)" ]; then
  echo "! Working tree has uncommitted changes. They will NOT be in the bundle."
  git status --short | sed 's/^/    /'
  echo
fi

echo "Creating bundle from all refs..."
git bundle create "$archive" --all

echo "Verifying..."
verify_log="$(mktemp)"
git bundle verify "$archive" >"$verify_log" 2>&1 || {
  echo "✗ Bundle failed verification. Not replacing rayzen-latest.bundle."
  cat "$verify_log"
  exit 1
}

cp -f "$archive" "$latest"

size="$(du -h "$archive" | cut -f1)"
commits="$(git rev-list --count --all)"
echo
echo "✔ Backup complete"
echo "    commits: $commits"
echo "    size:    $size"
echo "    latest:  $latest"
echo "    archive: $archive"
echo
echo "Restore with: git clone $latest rayzen-restored"

# Keep the five most recent timestamped archives; the latest pointer is separate.
cd "$backup_dir"
ls -1t rayzen-2*.bundle 2>/dev/null | tail -n +6 | while read -r old; do
  echo "    pruning old archive: $old"
  rm -f -- "$old"
done
