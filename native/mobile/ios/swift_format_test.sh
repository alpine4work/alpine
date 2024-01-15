#!/bin/sh

platform_name="$(uname -s | tr '[:upper:]' '[:lower:]')"

arch_name="$(uname -m)"
if [ "$arch_name" = "amd64" ]; then
    arch_name="x86_64"
fi

"admin/vendor/swift-format/swift-format-$platform_name-$arch_name" lint \
    --color-diagnostics \
    --configuration native/mobile/ios/swift_format_config.json \
    $@
