#!/bin/bash

export PKG_CONFIG_PATH="$JS_BINARY__EXECROOT/$1/external/libvips/libvips/lib/pkgconfig:$PKG_CONFIG_PATH"
export PKG_CONFIG_PATH="$JS_BINARY__EXECROOT/$1/external/glib/glib/lib/pkgconfig:$PKG_CONFIG_PATH"
export PKG_CONFIG_PATH="$JS_BINARY__EXECROOT/$1/external/libffi/libffi/lib/pkgconfig:$PKG_CONFIG_PATH"
export PKG_CONFIG_PATH="$JS_BINARY__EXECROOT/$1/external/zlib_for_glib/zlib/share/pkgconfig:$PKG_CONFIG_PATH"

"$JS_BINARY__EXECROOT/$1/external/rules_foreign_cc/toolchains/private/pkgconfig/bin/pkg-config" \
    "--define-variable=EXT_BUILD_ROOT=$JS_BINARY__EXECROOT" \
    ${@:2}
