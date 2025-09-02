"""
Packages that `//server/dynamo/core` is visible in. We use this list to
discover all DynamoDB table schemas when setting up our backend infrastructure
`admin/aws`.
"""

DYNAMO_CORE_VISIBILITY = [
    "//server/accounts",
    "//server/alpha",
    "//server/bots",
    "//server/chat/data",
    "//server/context",
    "//server/deploy/data",
    "//server/documents/data",
    "//server/feed",
    "//server/files/data",
    "//server/forum/data",
    "//server/node",
    "//server/notifications/data",
    "//server/search/data/table",
    "//server/spaces",
    "//server/tasks/data",
]
