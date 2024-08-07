#!/bin/bash

workspace_path=$(cd $(dirname $0)/../../.. && pwd)

# The `&` at the end of this command will make sure we run the proxy server
# in the background. GitHub Actions should kill our proxy server once the test
# run has finished.
node "$workspace_path/admin/aws/internal/aws_github_runners_bazel_remote_cache.cjs" &

# Test that our remote cache proxy server is working by querying a key that
# doesn't exist. If we're able to successfully authenticate with S3 we should
# get a 404 status code. Otherwise we may get a 403 forbidden status code if
# our authorization header is incorrect or a 500 internal error if something in
# our script isn't working.
attempts=0
while true; do
    status=$(curl -IsL http://localhost:3501/test/does-not-exist.txt | head -n 1 | cut -d ' ' -f2)

    if [ "$status" != "404" ]; then
        if (( attempts >= 600 )); then
            echo "Expected 404 status code from Bazel remote cache proxy server but recieved \"$status\""
            exit 1
        fi

        (( attempts++ ))
        sleep 0.05
    else
        exit 0
    fi
done
