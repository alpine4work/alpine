#!/bin/bash

set -e

base_path=$(pwd)
workspace_path=$(cd $(dirname $0)/../../../.. && pwd)
cd $workspace_path

docker build --platform linux/arm64 --tag calebmer/cyberworlds-test-local:latest admin/aws/images/test_local

docker run --interactive --tty --volume $workspace_path:/home/test/cyberworlds calebmer/cyberworlds-test-local:latest
