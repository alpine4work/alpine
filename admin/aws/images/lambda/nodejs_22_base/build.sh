set -e

base_path=$(pwd)
script_dir=$(cd $(dirname $0) && pwd)
workspace_path=$(cd $script_dir/../../../../.. && pwd)
cd $workspace_path

docker build --platform linux/arm64 --tag cyberworlds-lambda-nodejs22:latest admin/aws/images/lambda/nodejs_22_base
docker push ifitzsimmons/cyberworlds-lambda-nodejs22:latest
