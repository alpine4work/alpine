import {int, primaryKey, sqliteTable, text} from "drizzle-orm/sqlite-core";

export const agentRequestsTable = sqliteTable(
    "agent_requests",
    {
        accountId: text().notNull(),
        spaceId: text().notNull(),
        traceId: text().notNull(),
        spanId: text().notNull(),
        createdTime: int().notNull(),
        provider: text().notNull(),
        model: text().notNull(),
        usedMillicents: int().notNull().default(0),
    },
    table => [primaryKey({columns: [table.accountId, table.spaceId, table.createdTime]})],
);

export const agentUsageWindowsTable = sqliteTable("agent_usage_windows", {
    accountId: text().notNull().primaryKey(),
    startedTime: int().notNull(),
});
