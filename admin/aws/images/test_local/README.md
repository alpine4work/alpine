This folder defines a docker container meant to reproduce the conditions of our Ubuntu GitHub test
runner. Which is useful for debugging test failures that only happen on our test runners and don't
happen on our local machines.

You should use it with the `run.sh` script in this directory. The `bazel` command will be available.
