"""
Packages that `//server/dynamo/core` is visible in. We also import all files in
these packages to discover DynamoDB tables.
"""

DYNAMO_CORE_VISIBILITY = [
    "//server/accounts",
    "//server/alpha",
    "//server/chat/data",
    "//server/context",
    "//server/documents/data",
    "//server/forum/data",
    "//server/node",
    "//server/notifications/data",
    "//server/search/data/table",
    "//server/spaces",
    "//server/tasks/data",
]
