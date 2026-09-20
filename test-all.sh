#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COVERAGE_DIR="${ROOT_DIR}/.coverage"

rm -rf "$COVERAGE_DIR"
mkdir -p "$COVERAGE_DIR"

echo "Checking JavaScript syntax..."
while IFS= read -r file; do
    node --check "$file"
done < <(find "$ROOT_DIR" -path "$ROOT_DIR/.git" -prune -o \
    -path "$ROOT_DIR/.idea" -prune -o -path "$ROOT_DIR/.junk" -prune -o \
    -name '*.js' -type f -print)

echo "Compiling GSettings schemas..."
glib-compile-schemas "$ROOT_DIR/schemas"

echo "Checking installer scripts..."
bash -n "$ROOT_DIR/install.sh"
bash -n "$ROOT_DIR/manage.sh"

echo "Running GJS unit tests..."
for test_file in "$ROOT_DIR"/tests/unit/test-*.js; do
    test_name="$(basename "$test_file" .js)"
    test_coverage_dir="$COVERAGE_DIR/$test_name"
    mkdir -p "$test_coverage_dir"
    gjs -m --coverage-prefix="$ROOT_DIR/lib" \
        --coverage-output="$test_coverage_dir" "$test_file"
done

echo
echo "All checks passed."
echo "Coverage reports: $COVERAGE_DIR/*/coverage.lcov"
