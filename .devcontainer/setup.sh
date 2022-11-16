set -eux

echo "" >> "/home/vscode/.zshrc"
echo "source /workspaces/cyberworlds/.devcontainer/zshrc" >> "/home/vscode/.zshrc"

sudo -H -u vscode python3 -m pip install localstack

# localstack gets really upset if it can't write here
mkdir /var/lib/localstack
chmod a+w /var/lib/localstack
