#!/bin/bash

workspace_path=$(cd $(dirname $0)/../../.. && pwd)
log_path="${BAZEL_REMOTE_CACHE_LOG_PATH:-$workspace_path/.tmp/bazel-remote-cache.log}"

function log() {
    echo "$1" | tee -a "$log_path"
}

mkdir -p "$(dirname "$log_path")"
: > "$log_path"

log "Bazel remote cache proxy server log path: $log_path"
log "Starting Bazel remote cache proxy server"

# The `&` at the end of this command will make sure we run the proxy server
# in the background. GitHub Actions should kill our proxy server once the test
# run has finished.
node "$workspace_path/admin/aws/internal/aws_github_runners_bazel_remote_cache.cjs" \
    > >(tee -a "$log_path") \
    2> >(tee -a "$log_path" >&2) &
proxy_pid=$!
log "Bazel remote cache proxy server pid: $proxy_pid"

# Test that our remote cache proxy server is working by querying a key that
# doesn't exist. If we're able to successfully authenticate with S3 we should
# get a 404 status code. Otherwise we may get a 403 forbidden status code if
# our authorization header is incorrect or a 500 internal error if something in
# our script isn't working.
attempts=0
while true; do
    curl_headers_path="$log_path.curl.headers"
    curl_stderr_path="$log_path.curl.stderr"
    curl -IsSL http://localhost:3501/test/does-not-exist.txt >"$curl_headers_path" 2>"$curl_stderr_path"
    curl_exit_code=$?
    status=$(head -n 1 "$curl_headers_path" | cut -d ' ' -f2)

    if [ "$curl_exit_code" != "0" ]; then
        log "Bazel remote cache proxy server health check curl failed with exit code $curl_exit_code"
        if [ -s "$curl_stderr_path" ]; then
            while IFS= read -r line; do
                log "curl stderr: $line"
            done < "$curl_stderr_path"
        fi
    fi

    rm -f "$curl_headers_path" "$curl_stderr_path"

    if [ "$status" != "404" ] || [ "$curl_exit_code" != "0" ]; then
        if (( attempts >= 600 )); then
            log "Expected 404 status code from Bazel remote cache proxy server but received \"$status\""
            exit 1
        fi

        log "Bazel remote cache proxy server health check attempt $attempts returned \"$status\""
        (( attempts++ ))
        sleep 0.05
    else
        log "Bazel remote cache proxy server health check succeeded"
        exit 0
    fi
done
