# Cyberworlds

## Getting started

To develop for Cyberworlds all it takes is running one command after you've cloned the repo:

```
$ ./admin/bin/dev
```

We use [Bazel](https://bazel.build) which installs all the tools you need. Including
[Node.js](https://nodejs.org/en) and package managers like [pnpm](https://pnpm.io).

## Recommend setup

We recommend the following setup steps as well:

-   Add `./admin/bin` to your `PATH` environment variable. This will let you run `dev` from anywhere
    without specifying the path. We also include wrappers for tools like `node` and `pnpm`. While in
    the `cyberworlds` directory these wrappers will run the version of the tool installed by Bazel.
    Outside of `cyberworlds` these wrappers will run the system installed version of the tool.

    Example: Add the line `export PATH=$HOME/cyberworlds/admin/bin:$PATH` to your `~/.bashrc` or
    `.zshrc` file (depending on which you use) and replace `$HOME` with the directory you cloned the
    git repo to.

-   Run `pnpm install` in the Cyberworlds directory. Bazel will install `node_modules` when building
    your project but in the Bazel build directory. If you want access to `node_modules` at the repo
    root you need to run `pnpm install`.

<!-- TODO(calebmer): Can we figure out a way to link `node_modules` to the one built by Bazel? -->
