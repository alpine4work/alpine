import {InferSelectModel} from "drizzle-orm";
import {int, primaryKey, sqliteTable, text} from "drizzle-orm/sqlite-core";

export const agentUsageWindowTypes = ["Weekly", "Dynamic"] as const;
export const accountPlanTypes = ["LifetimeAccess"] as const;

export type AgentUsageWindowType = (typeof agentUsageWindowTypes)[number];
export type AccountPlanType = (typeof accountPlanTypes)[number];

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

export const agentUsageWindowsTable = sqliteTable(
    "agent_usage_windows",
    {
        accountId: text().notNull(),
        type: text({enum: agentUsageWindowTypes}).notNull(),
        startedTime: int().notNull(),
        wasModelDowngraded: int({mode: "boolean"}).notNull().default(false),
    },
    table => [primaryKey({columns: [table.accountId, table.type]})],
);

export const accountEntitlements = sqliteTable("account_entitlements", {
    accountId: text().notNull().primaryKey(),
    plan: text({enum: accountPlanTypes}),
});

export type AgentUsageWindow = InferSelectModel<typeof agentUsageWindowsTable>;
