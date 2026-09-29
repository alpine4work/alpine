# Third-party notices

Alpine uses third-party code, tools, fonts, and media. These components retain their own copyright
notices and license terms. Alpine's [MIT license](LICENSE.md) does not replace those terms.

This file is an index of license and attribution information. Keep the applicable license texts and
copyright notices with each component when you copy or distribute it.

## Bundled tools and libraries

| Component                     | Location                                               | License and notices                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| libvips and bundled libraries | [admin/vendor/libvips](admin/vendor/libvips)           | See the existing [third-party notices](admin/vendor/libvips/THIRD-PARTY-NOTICES.md) for the licenses of the individual libraries. The [bundle README](admin/vendor/libvips/README.md) identifies the source and build process. |
| Bazelisk                      | [admin/vendor/bazelisk](admin/vendor/bazelisk)         | [Apache License 2.0](https://github.com/bazelbuild/bazelisk/blob/master/LICENSE). Source: [bazelbuild/bazelisk](https://github.com/bazelbuild/bazelisk).                                                                       |
| swift-format 509.0.0          | [admin/vendor/swift-format](admin/vendor/swift-format) | [Apache License 2.0 with the Swift Runtime Library Exception](https://github.com/swiftlang/swift-format/blob/509.0.0/LICENSE.txt). See the [build instructions](admin/vendor/swift-format/README.md).                          |

## Fonts

| Font             | Location                                                                                       | License                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inter            | [Web fonts](app/static/fonts) and [iOS fonts](native/mobile/ios/Resources/Fonts)               | [SIL Open Font License 1.1](https://github.com/rsms/inter/blob/master/LICENSE.txt). Source: [The Inter Project](https://rsms.me/inter/).            |
| Commit Mono      | [commit-mono.woff2](app/static/fonts/commit-mono.woff2)                                        | [SIL Open Font License 1.1](https://github.com/eigilnikolajsen/commit-mono/blob/main/LICENSE-FONT). Source: [Commit Mono](https://commitmono.com/). |
| DM Serif Display | [dm_serif_display_regular.ttf](app/docs/codegen/opengraph/assets/dm_serif_display_regular.ttf) | [SIL Open Font License 1.1 and copyright notice](app/docs/codegen/opengraph/assets/dm_serif_display.OFL.txt).                                       |

## FFmpeg

The build downloads FFmpeg at commit
[`1f2b8d7238eff4ab8a4d8d6177e250b8180d51f4`](https://github.com/FFmpeg/FFmpeg/tree/1f2b8d7238eff4ab8a4d8d6177e250b8180d51f4).

- The source URL and checksum are in [WORKSPACE](WORKSPACE).
- Alpine's changes are in [ffmpeg.patch](admin/patches/bazel/ffmpeg.patch).
- The build commands are in [BUILD.ffmpeg.bazel](admin/bazel/third_party/BUILD.ffmpeg.bazel).

FFmpeg retains its upstream license terms. See the license files in the pinned source and
[FFmpeg's license information](https://ffmpeg.org/legal.html) for the terms that apply to its
components and build options.

## Other dependencies

External Bazel repositories and versions are recorded in [WORKSPACE](WORKSPACE). The repository
includes [build definitions](admin/bazel/third_party) and [patches](admin/patches) for some of these
dependencies.

JavaScript dependencies are recorded in [package.json](package.json), the other package manifests,
and [pnpm-lock.yaml](pnpm-lock.yaml). Dependencies retain their own licenses and copyright notices.
Consult the source or package for the version in use.

## Media and test fixtures

Media files and test fixtures retain their applicable licenses and attribution notices. Source and
attribution records include:

- [Unsplash image attribution](admin/scenarios/fixtures/unsplash_attribution.md).
- [File processor test media sources](server/files/processor/test_fixtures/README.md).
