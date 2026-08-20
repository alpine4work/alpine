load("//admin/typescript:typescript.bzl", "ts_project")

# Code shared between the `AgentV2Service` worker and the sandbox's Claude agent
# service. Both sides read the same bucket, so the conventions for what lives where
# in it — and how to read it back — belong to neither one of them.
#
# This runs in a Cloudflare Worker as well as in the sandbox's Node.js process, so
# keep it free of Node.js dependencies.
ts_project(
    name = "shared",
    visibility = ["//server/agents/bots_v2:__subpackages__"],
)
