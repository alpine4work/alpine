#!/bin/bash

set -e

base_path=$(pwd)
workspace_path=$(cd $(dirname $0)/../../../.. && pwd)
cd $workspace_path

docker build --platform linux/arm64 --tag calebmer/cyberworlds-libreoffice:latest admin/aws/images/libreoffice

docker push calebmer/cyberworlds-libreoffice:latest
