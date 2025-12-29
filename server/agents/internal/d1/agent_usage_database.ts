import {drizzle} from "drizzle-orm/d1";
import * as Conditions from "drizzle-orm/sql/expressions/conditions";
import {eq} from "drizzle-orm/sql/expressions/conditions";
import {sum} from "drizzle-orm/sql/functions/aggregate";
import {AgentRequest} from "~/server/agents/internal/d1/agent_usage_database_types.js";
import {
    agentRequestsTable,
    agentUsageWindowsTable,
} from "~/server/agents/internal/d1/agent_usage_schema.js";

export class AgentUsageDatabase {
    private readonly database;
    constructor(database: D1Database) {
        this.database = drizzle(database, {
            casing: "snake_case",
        });
    }

    async createAgentRequest(request: AgentRequest): Promise<void> {
        await this.database.insert(agentRequestsTable).values(request);
    }

    async getUsedMillicentsByAccountIdSinceTimestamp(
        accountId: string,
        sinceTimestamp: number,
    ): Promise<bigint> {
        const [row] = await this.database
            .select({
                totalUsedMillicents: sum(agentRequestsTable.usedMillicents),
            })
            .from(agentRequestsTable)
            .where(
                Conditions.and(
                    Conditions.eq(agentRequestsTable.accountId, accountId),
                    Conditions.gte(agentRequestsTable.createdTime, sinceTimestamp),
                ),
            );

        if (!row || row.totalUsedMillicents === null) return BigInt(0);

        return BigInt(row.totalUsedMillicents);
    }

    /**
     * Get the window start time for an account.
     */
    async getWindowStartTimeByAccountId(accountId: string): Promise<number | null> {
        const [row] = await this.database
            .select()
            .from(agentUsageWindowsTable)
            .where(eq(agentUsageWindowsTable.accountId, accountId));

        return row?.startedTime ?? null;
    }

    /**
     * Set the window start time for an account.
     */
    async setWindowStartTimeByAccountId(accountId: string, startedTime: number): Promise<void> {
        await this.database
            .insert(agentUsageWindowsTable)
            .values({accountId, startedTime})
            .onConflictDoUpdate({
                target: [agentUsageWindowsTable.accountId],
                set: {startedTime},
            });
    }
}
