#!/bin/bash

set -e

# Change to workspace root
workspace_path=$(cd $(dirname $0)/../.. && pwd)
cd $workspace_path

# Parse experimental commands from the static registry
parse_commands() {
    # Extract command definitions from experimental_commands.bzl using sed
    # This avoids the cost of bazel queries on every invocation
    grep -o '"[^"]*": {' admin/experimental/experimental_commands.bzl | \
    sed 's/": {$//' | \
    sed 's/^"//'
}

get_command_info() {
    local cmd="$1"
    local field="$2"

    # Extract specific field for a command from the bzl file
    sed -n "/\"$cmd\": {/,/},\?$/p" admin/experimental/experimental_commands.bzl | \
    grep "\"$field\":" | \
    sed 's/.*"'"$field"'": *"\(.*\)".*/\1/' | \
    head -1
}

if [ -z "$1" ] || [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Available experimental scripts:"

    commands=$(parse_commands)
    for cmd in $commands; do
        description=$(get_command_info "$cmd" "description")
        printf "  %-20s %s\n" "$cmd" "$description"
    done

    echo ""
    echo "Usage:"
    echo "    dev experimental <script> [args]     Run experimental script"
    echo "    dev experimental <script> --help     Show detailed help for script"
    exit 1
fi

script_name="$1"

# Check if command exists
if ! parse_commands | grep -q "^$script_name$"; then
    echo "Unknown experimental script: $script_name"
    echo ""
    echo "Run 'dev experimental' to see available scripts."
    exit 1
fi

target=$(get_command_info "$script_name" "target")

if [ -z "$target" ]; then
    echo "Error: No target defined for experimental script: $script_name"
    exit 1
fi

./admin/bin/bazel run --ui_event_filters=-info "$target" -- ${@:2}
