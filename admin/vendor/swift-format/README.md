# Vendored `swift-format` binaries

Pre-built [`apple/swift-format`](https://github.com/apple/swift-format) binaries. To build, first
checkout the repository:

```sh
SWIFT_FORMAT_VERSION="509.0.0"

git clone https://github.com/apple/swift-format.git
cd swift-format
git checkout "tags/$SWIFT_FORMAT_VERSION"
```

To build on an Apple Silicon (M1) Mac run the following:

```sh
# For `swift-format-darwin-arm64`:
swift build -c release
# Output at: `.build/arm64-apple-macosx/release/swift-format`

# For `swift-format-linux-x86_64`:
docker run -v "$PWD:/code" -w /code --platform linux/amd64 -e QEMU_CPU=max swift:latest swift build -c release
# Output at: `.build/x86_64-unknown-linux-gnu/release/swift-format` (took ~30min to build on my machine)

# For `swift-format-darwin-x86_64`:
arch -x86_64 swift build -c release
# Output at: `.build/x86_64-apple-macosx/release/swift-format`
```

For more information read the
“[Swift cross-platform build instructions](https://www.swift.org/server/guides/building.html).”
