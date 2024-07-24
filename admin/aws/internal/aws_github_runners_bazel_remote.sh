#!/bin/bash

workspace_path=$(cd $(dirname $0)/../../.. && pwd)

AWS_REGION=$(curl -fsSL http://169.254.169.254/latest/dynamic/instance-identity/document | grep region | awk -F\" '{print $4}')

# Ports 3501 and 3502 are reserved by `BAZEL_REMOTE_PORT` and
# `BAZEL_REMOTE_GRPC_PORT` respectively in `.env.development` for
# `bazel-remote`. We don't use the env file here and instead manually write
# the ports to simplify things. The `--remote_cache` option in our
# `.github/workflows` files also inline the `bazel-remote` ports.
#
# We set `--s3.update_timestamps true` since we need to update object
# timestamps on cache hit so the objects don't expire.
#
# The `&` at the end of this command will make sure we run `bazel-remote`
# in the background. GitHub Actions should kill the `bazel-remote` server
# once the test run has finished.
"$workspace_path/admin/vendor/bazel-remote/bazel-remote" \
    --dir ~/.cache/bazel-remote \
    --max_size 30 \
    --port 3501 \
    --grpc_port 3502 \
    --s3.endpoint "s3.$AWS_REGION.amazonaws.com" \
    --s3.bucket cyberworlds-bazel-remote \
    --s3.auth_method iam_role \
    --s3.update_timestamps \
    &

# Wait for `bazel-remote` to start its HTTP server before exiting the script.
"$workspace_path/server/helpers/node/wait_for_http_server.sh" 3501
