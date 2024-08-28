#!/bin/bash

export PKG_CONFIG_PATH="$JS_BINARY__EXECROOT/$1/external/foreign_cc_libvips/libvips/lib/pkgconfig:$PKG_CONFIG_PATH"
export PKG_CONFIG_PATH="$JS_BINARY__EXECROOT/$1/external/foreign_cc_glib/glib/lib/pkgconfig:$PKG_CONFIG_PATH"
export PKG_CONFIG_PATH="$JS_BINARY__EXECROOT/$1/external/foreign_cc_libffi/libffi/lib/pkgconfig:$PKG_CONFIG_PATH"
export PKG_CONFIG_PATH="$JS_BINARY__EXECROOT/$1/external/foreign_cc_zlib/zlib/share/pkgconfig:$PKG_CONFIG_PATH"

"$JS_BINARY__EXECROOT/$1/external/rules_foreign_cc/toolchains/private/pkgconfig/bin/pkg-config" \
    "--define-variable=EXT_BUILD_ROOT=$JS_BINARY__EXECROOT" \
    ${@:2}
