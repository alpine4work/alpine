#!/bin/bash

workspace_path=$(cd $(dirname $0)/../../.. && pwd)

# The `&` at the end of this command will make sure we run the proxy server
# in the background. GitHub Actions should kill our proxy server once the test
# run has finished.
node "$workspace_path/admin/aws/internal/aws_github_runners_bazel_remote_cache.cjs" &

# Wait for server to actually start before exiting the script.
"$workspace_path/server/helpers/node/wait_for_http_server.sh" 3501

# NOCOMMIT: Remove this test CURL
curl -f -XPUT -d 'foobar' 'http://localhost:3501'
