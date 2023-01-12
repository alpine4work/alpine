set -eux

echo "" >> "/home/vscode/.zshrc"
echo "source /workspaces/cyberworlds/.devcontainer/zshrc" >> "/home/vscode/.zshrc"

# TODO(2022-01-12): We used to use LocalStack. Now that it is replaced with
# DynamoDB local managed by Bazel we can remove LocalStack installation from
# dev container.
sudo -H -u vscode python3 -m pip install localstack

# localstack gets really upset if it can't write here
mkdir /var/lib/localstack
chmod a+w /var/lib/localstack
