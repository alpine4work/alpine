# Cyberworlds

## Getting started

To develop for Cyberworlds, run the following after you've cloned the repo:

```bash
./admin/bin/dev
```

We use [Bazel](https://bazel.build) which installs all the tools you need. Including
[Node.js](https://nodejs.org/en) and package managers like [pnpm](https://pnpm.io).

## Recommended setup

We recommend the following setup steps as well:

-   Add `./admin/bin` to your `PATH` environment variable. This will let you run `dev` from anywhere
    without specifying the path. We also include wrappers for tools like `node` and `pnpm`. While in
    the `cyberworlds` directory these wrappers will run the version of the tool installed by Bazel.
    Outside of `cyberworlds` these wrappers will run the system installed version of the tool.

    Example: Add the line `export PATH=$HOME/cyberworlds/admin/bin:$PATH` to your `~/.bashrc` or
    `~/.zshrc` file (depending on which you use) and replace `$HOME` with the directory you cloned
    the git repo to.

-   Run `pnpm install` in the Cyberworlds directory. Bazel will install `node_modules` when building
    your project but in the Bazel build directory. If you want access to `node_modules` at the repo
    root (which is necessary for IDE integrations with tools like TypeScript, ESLint, and Prettier)
    you need to run `pnpm install`.

-   If you use Chrome as your web browser, go to `chrome://inspect` and under the “Devices” section
    click “Configure” next to “Discover network targets”. Add `localhost:3001`, `localhost:3011`,
    `localhost:3021`, `localhost:3031`, `localhost:3039`, `localhost:3041`, `localhost:3051`, and
    `localhost:3061`. These are the ports our development mode services will expose for launching a
    JavaScript inspector. See `.env.development` for configuring these ports.

## Optional setup

-   If you want to test uploading Microsoft Office documents (Word, Excel, and PowerPoint) you'll
    need to install [LibreOffice](https://www.libreoffice.org/download/download-libreoffice) on your
    system.

## Troubleshooting

<details>

<summary>Error message while running <code>dev</code>: Could not determine Xcode version at all. This likely
means Xcode isn't available</summary>

If while running `dev` you get an error that looks like:

```
ERROR: /private/var/tmp/_bazel_desireedewysocki/7506582f4dbb88fa39d760e6a6d0b447/external/local_config_apple_cc/BUILD:79:24: in cc_toolchain_config rule @local_config_apple_cc//:darwin_x86_64:
Traceback (most recent call last):
	File "/private/var/tmp/_bazel_desireedewysocki/7506582f4dbb88fa39d760e6a6d0b447/external/local_config_apple_cc/cc_toolchain_config.bzl", line 2465, column 58, in _impl
		enabled = xcode_support.is_xcode_at_least_version(xcode_config, "15.0.0"),
	File "/private/var/tmp/_bazel_desireedewysocki/7506582f4dbb88fa39d760e6a6d0b447/external/build_bazel_apple_support/lib/xcode_support.bzl", line 35, column 13, in _is_xcode_at_least_version
		fail("Could not determine Xcode version at all. This likely means Xcode isn't available; " +
Error in fail: Could not determine Xcode version at all. This likely means Xcode isn't available; if you think this is a mistake, please file an issue.
ERROR: /private/var/tmp/_bazel_desireedewysocki/7506582f4dbb88fa39d760e6a6d0b447/external/local_config_apple_cc/BUILD:79:24: Analysis of target '@local_config_apple_cc//:darwin_x86_64' failed
WARNING: errors encountered while analyzing target '//admin/dev:dev': it will not be built
ERROR: command succeeded, but not all targets were analyzed
FAILED: Build did NOT complete successfully
ERROR: Build failed. Not running target
```

Double check that XCode is installed and that you can run it. First check your Applications folder
for XCode and if it’s not there open the MacOS App Store and make sure it’s installed from there.

Then try running the following (from
[this StackOverflow answer](https://stackoverflow.com/a/46460129/1568890)) which will make sure
XCode CLI tools are working:

```sh
bazel clean --expunge
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license
bazel clean --expunge
```

Try running `dev` again after this.

</details>
