"""Static registry of experimental commands for the dev tool.

This file defines all available experimental commands without requiring
bazel queries at runtime, improving performance of `dev experimental`.
"""

EXPERIMENTAL_COMMANDS = {
    "generate-build-file": {
        "target": "//admin/experimental/ifitzsimmons:generate_build_file",
        "description": "Automates BUILD file dependency management based on imports",
    },
    "sort-reference-graph": {
        "target": "//admin/experimental/calebmer:sort_reference_graph",
        "description": "Sort top-level TypeScript declarations into reference graph order",
    },
}
