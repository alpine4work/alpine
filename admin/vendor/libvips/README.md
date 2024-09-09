These artifacts are built from
[`cyberworlds/sharp-libvips`](https://github.com/cyberworlds/sharp-libvips) which is a fork of
[`lovell/sharp-libvips`](https://github.com/lovell/sharp-libvips). Our fork adds support for `.heic`
files (decoding only), `.pdf` files, and `.bmp` files.

Someday, maybe we convert `cyberworlds/sharp-libvips` into Bazel build rules like we have for
`BUILD.ffmpeg.bazel`. We already have some shared dependencies like `BUILD.libaom.bazel` and
`BUILD.cmake.bazel`. So we don't have an external repository we depend on. Ideally if we do this
we'd have a remote cache so developers don't need to build all external binaries from source after
any `bazel clean`.
