import {drizzle} from "drizzle-orm/d1";
import * as Conditions from "drizzle-orm/sql/expressions/conditions";
import {eq} from "drizzle-orm/sql/expressions/conditions";
import {sum} from "drizzle-orm/sql/functions/aggregate";
import {
    AccountEntitlements,
    AgentRequest,
} from "~/server/agents/bots/internal/d1/agent_usage_database_types.js";
import {
    AgentUsageWindow,
    AgentUsageWindowType,
    accountEntitlements,
    agentRequestsTable,
    agentUsageWindowsTable,
} from "~/server/agents/bots/internal/d1/agent_usage_schema.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * In case of transient D1 errors, retry the action a few times. See
 * https://developers.cloudflare.com/d1/best-practices/retry-queries/.
 */
function retryD1ErrorAndWrapInSpan<T>(
    span: TracerSpan,
    name: string,
    action: () => Promise<T>,
): Promise<T> {
    return retryWithExponentialBackoff(async retry => {
        try {
            // TODO: Re-enable `@typescript-eslint/return-await` after deciding whether
            // this `try`/`catch` should handle async D1 failures.
            // eslint-disable-next-line @typescript-eslint/return-await
            return span.withSpan(`D1 ${name}`, async () => {
                return await action();
            });
        } catch (error) {
            // These error message matchings seem weird. I agree. But they are taken from
            // Cloudflare's own documentation. So we will trust that these are the correct
            // strings to match on.
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
    createAgentRequest(span: TracerSpan, request: AgentRequest): Promise<void>;
    getUsedMillicentsByAccountIdSinceTimestamp(
        span: TracerSpan,
        accountId: string,
        sinceTimestamp: number,
    ): Promise<number>;
    getWindowByAccountIdAndType(
        span: TracerSpan,
        accountId: string,
        type: AgentUsageWindowType,
    ): Promise<AgentUsageWindow | null>;
    setWindowByAccountIdAndType(
        span: TracerSpan,
        accountId: string,
        type: AgentUsageWindowType,
        startedTime: number,
        wasModelDowngraded?: boolean,
    ): Promise<AgentUsageWindow>;
    downgradeModelForWindow(
        span: TracerSpan,
        accountId: string,
        type: AgentUsageWindowType,
    ): Promise<void>;
    getAccountEntitlements(
        span: TracerSpan,
        accountId: string,
    ): Promise<AccountEntitlements | null>;
    setAccountEntitlements(
        span: TracerSpan,
        accountId: string,
        entitlements: Partial<Omit<AccountEntitlements, "accountId">>,
    ): Promise<void>;
}

export class AgentUsageDatabase implements AgentUsageDatabaseInterface {
    private readonly database;
    constructor(database: D1Database) {
        this.database = drizzle(database, {
            casing: "snake_case",
        });
    }

    async createAgentRequest(span: TracerSpan, request: AgentRequest): Promise<void> {
        await retryD1ErrorAndWrapInSpan(span, "createAgentRequest", () =>
            this.database.insert(agentRequestsTable).values(request),
        );
    }

    async getUsedMillicentsByAccountIdSinceTimestamp(
        span: TracerSpan,
        accountId: string,
        sinceTimestamp: number,
    ): Promise<number> {
        return await retryD1ErrorAndWrapInSpan(
            span,
            "getUsedMillicentsByAccountIdSinceTimestamp",
            async () => {
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

                if (!row || row.totalUsedMillicents === null) return 0;

                return parseInt(row.totalUsedMillicents, 10);
            },
        );
    }

    /**
     * Get window information for an account and type.
     */
    async getWindowByAccountIdAndType(
        span: TracerSpan,
        accountId: string,
        type: AgentUsageWindowType,
    ): Promise<AgentUsageWindow | null> {
        return await retryD1ErrorAndWrapInSpan(span, "getWindowByAccountIdAndType", async () => {
            const [row] = await this.database
                .select()
                .from(agentUsageWindowsTable)
                .where(
                    Conditions.and(
                        eq(agentUsageWindowsTable.accountId, accountId),
                        eq(agentUsageWindowsTable.type, type),
                    ),
                );

            return row
                ? {
                      startedTime: row.startedTime,
                      wasModelDowngraded: Boolean(row.wasModelDowngraded),
                      accountId,
                      type,
                  }
                : null;
        });
    }

    /**
     * Set window information for an account and type.
     */
    async setWindowByAccountIdAndType(
        span: TracerSpan,
        accountId: string,
        type: AgentUsageWindowType,
        startedTime: number,
        wasModelDowngraded: boolean = false,
    ): Promise<AgentUsageWindow> {
        await retryD1ErrorAndWrapInSpan(span, "setWindowByAccountIdAndType", () =>
            this.database
                .insert(agentUsageWindowsTable)
                .values({
                    accountId,
                    type,
                    startedTime,
                    wasModelDowngraded,
                })
                .onConflictDoUpdate({
                    target: [agentUsageWindowsTable.accountId, agentUsageWindowsTable.type],
                    set: {startedTime, wasModelDowngraded},
                }),
        );

        return {accountId, type, startedTime, wasModelDowngraded};
    }

    /**
     * Update the downgraded model flag for a window.
     */
    async downgradeModelForWindow(
        span: TracerSpan,
        accountId: string,
        type: AgentUsageWindowType,
    ): Promise<void> {
        await retryD1ErrorAndWrapInSpan(span, "downgradeModelForWindow", () =>
            this.database
                .update(agentUsageWindowsTable)
                .set({wasModelDowngraded: true})
                .where(
                    Conditions.and(
                        eq(agentUsageWindowsTable.accountId, accountId),
                        eq(agentUsageWindowsTable.type, type),
                    ),
                ),
        );
    }

    /**
     * Get account entitlements for an account.
     */
    async getAccountEntitlements(
        span: TracerSpan,
        accountId: string,
    ): Promise<AccountEntitlements | null> {
        return await retryD1ErrorAndWrapInSpan(span, "getAccountEntitlements", async () => {
            const results = await this.database
                .select()
                .from(accountEntitlements)
                .where(eq(accountEntitlements.accountId, accountId));

            return results.length > 0 && results[0] ? results[0] : null;
        });
    }

    /**
     * Set entitlements for an account.
     */
    async setAccountEntitlements(
        span: TracerSpan,
        accountId: string,
        entitlements: Partial<Omit<AccountEntitlements, "accountId">>,
    ): Promise<void> {
        await retryD1ErrorAndWrapInSpan(span, "setAccountEntitlements", () =>
            this.database
                .insert(accountEntitlements)
                .values({
                    accountId,
                    ...entitlements,
                })
                .onConflictDoUpdate({
                    target: [accountEntitlements.accountId],
                    set: entitlements,
                }),
        );
    }
}
