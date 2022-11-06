# Adapted from the `bin/localstack` file since `rules_python` doesn't create
# binary rules for us.
#
# https://github.com/localstack/localstack/blob/master/bin/localstack

from localstack.cli import main

if __name__ == "__main__":
    main.main()
