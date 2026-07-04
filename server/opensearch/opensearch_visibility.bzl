"""
Packages that `//server/opensearch` is visible in. We use this list to discover
all OpenSearch index schemas when setting up our backend infrastructure
`admin/aws`.
"""

OPENSEARCH_VISIBILITY = [
    "//server/importer",
    "//server/search/data/index",
    "//server/tasks/data",
]
