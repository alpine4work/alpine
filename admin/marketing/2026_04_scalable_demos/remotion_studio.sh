#!/bin/bash

workspace_path=$(cd $(dirname $0)/../../.. && pwd)
cd $workspace_path

source .env
source .env.development
if [ -f .env.development.local ]; then
    source .env.development.local
fi

"$workspace_path/admin/bin/bazel" build //admin/marketing/2026_04_scalable_demos:public //client/web/reactions/icons:reaction_icon_svgs.js
bazel_bin="$($workspace_path/admin/bin/bazel info bazel-bin)"

platform_name="$(uname -s | tr '[:upper:]' '[:lower:]')"

arch_name="$(uname -m)"
if [ "$arch_name" = "x86_64" ]; then
    arch_name="amd64"
fi
if [ "$arch_name" = "aarch64" ]; then
    arch_name="arm64"
fi

node_workspace="nodejs_${platform_name}_${arch_name}"
output_base="$("$workspace_path/admin/bin/bazel" info output_base)"
"$workspace_path/admin/bin/bazel" build --ui_event_filters=-info @pnpm//:pnpm
pnpm="$output_base/external/$node_workspace/bin/node $output_base/external/pnpm/package/dist/pnpm.cjs"

$pnpm exec concurrently \
    --names remotion,serve \
    "REMOTION_PUBLIC_PORT=\"$REMOTION_PUBLIC_PORT\" REACTION_ICON_SVGS_PATH=\"$bazel_bin/client/web/reactions/icons/reaction_icon_svgs.js\" $pnpm exec remotion studio --port \"$REMOTION_STUDIO_PORT\" --config admin/marketing/2026_04_scalable_demos/remotion.config.mjs admin/marketing/2026_04_scalable_demos/scalable_demos_remotion_main.tsx" \
    "$pnpm exec serve -p \"$REMOTION_PUBLIC_PORT\" --cors --symlinks \"$bazel_bin/admin/marketing/2026_04_scalable_demos/public\""
