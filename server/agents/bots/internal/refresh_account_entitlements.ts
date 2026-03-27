import {AgentServiceEnv} from "~/server/agents/bots/internal/agent_service_env.js";
import {AgentUsageDatabase} from "~/server/agents/bots/internal/d1/agent_usage_database.js";
import {AccountEntitlements} from "~/server/agents/bots/internal/d1/agent_usage_database_types.js";
import {InternalError} from "~/shared/error/error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * README
 *
 * There are a lot of warnings in here. Be very careful here as this endpoint is
 * unauthenticated (but authorized via a secret token, hardcoded token). If you are
 * updating this file, please know what you are doing and why.
 */

// If you update this, be sure to also update the token used in
// app/routes/api.internal.accounts.$accountId.plan.ts
const appServiceAccountPlanSecretToken = "cyberworlds-super-secret-internal-agent-service-token";

/**
 * Given an account ID, this makes a call to our internal plan API to retrieve the
 * account's plan, then updates the agent usage database with the new entitlements.
 */
export async function refreshAccountEntitlements(
    tracer: TracerBase,
    env: AgentServiceEnv,
    database: AgentUsageDatabase,
    accountId: AccountId,
    options?: {fetch?: typeof fetch},
) {
    return tracer.withSpan("Refresh account entitlements", async span => {
        const fetchPlanUrl = new URL(
            `/api/internal/accounts/${accountId}/plan`,
            env.EDGE_SERVICE_URL,
        );

        // This is unauthenticated route, besides a hardcoded secret token. Be very careful
        // with this.
        const plan = await retryWithExponentialBackoff(
            retry =>
                fetchWithTracer(
                    tracer,
                    fetchPlanUrl,
                    {
                        serviceName: "EdgeService",
                        method: "GET",
                        route: "/api/internal/accounts/:accountId/plan",
                        headers: {
                            "content-type": "application/json",
                            authorization: `Bearer ${appServiceAccountPlanSecretToken}`,
                        },
                        ...(options?.fetch && {fetch: options.fetch}),
                    },
                    async response => {
                        // If the request failed, then throw an error. We want to mark this span as failed
                        // and we don't want to handle errors inline.
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
            // Generally, we don't want to set a limit and allow retries to happen within
            // retryWithExponentialBackoff. However, this function is called by
            // processStripeWebhook, which could fail due to transient errors. Since that call
            // also retries, there could be a very small chance of this call retrying max times
            // and the agent call retrying max times. We don't want to DOS ourselves, so
            // instead of 144 total potential retries (12\*12), we limit this to 5 and 5, for
            // 25 total.
            {maxAttemptCount: 5},
        );

        await database.setAccountEntitlements(span, accountId, {plan});
    });
}
