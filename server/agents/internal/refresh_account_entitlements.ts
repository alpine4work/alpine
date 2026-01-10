import {AgentServiceEnv} from "~/server/agents/internal/agent_service_env.js";
import {AgentUsageDatabase} from "~/server/agents/internal/d1/agent_usage_database.js";
import {AccountEntitlements} from "~/server/agents/internal/d1/agent_usage_database_types.js";
import {InternalError} from "~/shared/error/error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * Given an account ID, this makes a call to our internal plan API to
 * retrieve the account's plan, then updates the agent usage database
 * with the new entitlements.
 */
export async function refreshAccountEntitlements(
    tracer: TracerBase,
    env: AgentServiceEnv,
    database: AgentUsageDatabase,
    accountId: AccountId,
    options?: {fetch?: typeof fetch},
) {
    const fetchPlanUrl = new URL(`/api/internal/accounts/${accountId}/plan`, env.EDGE_SERVICE_URL);

    const plan = await retryWithExponentialBackoff(
        retry =>
            fetchWithTracer(
                tracer,
                fetchPlanUrl,
                {
                    serviceName: "EdgeService",
                    method: "GET",
                    route: "/api/internal/accounts/:accountId/plan",
                    headers: {"content-type": "application/json"},
                    ...(options?.fetch && {fetch: options.fetch}),
                },
                async response => {
                    // If the request failed, then throw an error. We want to mark this span as
                    // failed and we don't want to handle errors inline.
                    if (!response.ok) {
                        if (response.status >= 500) {
                            const error = new InternalError("API request failed", {
                                cause: {
                                    status: response.status,
                                    responseText: await response.text(),
                                },
                            });

                            throw retry(error);
                        }
                    }

                    const body = await response.json();

                    return (body.plan || undefined) as AccountEntitlements["plan"];
                },
            ),
        {maxAttemptCount: 5},
    );

    await database.setAccountEntitlements(accountId, {plan});
}
