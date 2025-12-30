import {drizzle} from "drizzle-orm/d1";
import * as Conditions from "drizzle-orm/sql/expressions/conditions";
import {eq} from "drizzle-orm/sql/expressions/conditions";
import {sum} from "drizzle-orm/sql/functions/aggregate";
import {AgentRequest} from "~/server/agents/internal/d1/agent_usage_database_types.js";
import {
    agentRequestsTable,
    agentUsageWindowsTable,
} from "~/server/agents/internal/d1/agent_usage_schema.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";

/**
 * In case of transient D1 errors, retry the action a few times.
 * See https://developers.cloudflare.com/d1/best-practices/retry-queries/.
 */
function retryD1Error<T>(action: () => Promise<T>): Promise<T> {
    return retryWithExponentialBackoff(async retry => {
        try {
            const response = await action();
            return response;
        } catch (error) {
            // These error message matchings seem weird. I agree.
            // But they are taken from Cloudflare's own documentation.
            // So we will trust that these are the correct strings to match on.
            const errorMessage = String(error);
            const isRetryableError =
                errorMessage.includes("Network connection lost") ||
                errorMessage.includes("storage caused object to be reset") ||
                errorMessage.includes("reset because its code was updated");

            if (isRetryableError) {
                retry(error);
            }

            throw error;
        }
    });
}

export interface AgentUsageDatabaseInterface {
    createAgentRequest(request: AgentRequest): Promise<void>;
    getUsedMillicentsByAccountIdSinceTimestamp(
        accountId: string,
        sinceTimestamp: number,
    ): Promise<bigint>;
    getWindowStartTimeByAccountId(accountId: string): Promise<number | null>;
    setWindowStartTimeByAccountId(accountId: string, startedAt: number): Promise<void>;
}

export class AgentUsageDatabase implements AgentUsageDatabaseInterface {
    private readonly database;
    constructor(database: D1Database) {
        this.database = drizzle(database, {
            casing: "snake_case",
        });
    }

    async createAgentRequest(request: AgentRequest): Promise<void> {
        await retryD1Error(() => this.database.insert(agentRequestsTable).values(request));
    }

    async getUsedMillicentsByAccountIdSinceTimestamp(
        accountId: string,
        sinceTimestamp: number,
    ): Promise<bigint> {
        return retryD1Error(async () => {
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
        });
    }

    /**
     * Get the window start time for an account.
     */
    async getWindowStartTimeByAccountId(accountId: string): Promise<number | null> {
        return retryD1Error(async () => {
            const [row] = await this.database
                .select()
                .from(agentUsageWindowsTable)
                .where(eq(agentUsageWindowsTable.accountId, accountId));

            return row?.startedTime ?? null;
        });
    }

    /**
     * Set the window start time for an account.
     */
    async setWindowStartTimeByAccountId(accountId: string, startedTime: number): Promise<void> {
        await retryD1Error(() =>
            this.database
                .insert(agentUsageWindowsTable)
                .values({accountId, startedTime})
                .onConflictDoUpdate({
                    target: [agentUsageWindowsTable.accountId],
                    set: {startedTime},
                }),
        );
    }
}
