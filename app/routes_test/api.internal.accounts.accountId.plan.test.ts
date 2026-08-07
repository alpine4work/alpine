import {loader} from "~/app/routes/api.internal.accounts.$accountId.plan.js";
import {createAccountForTest} from "~/server/accounts/create_account_for_test.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {LoaderContext} from "~/server/remix/loader_context.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const appServiceAccountPlanSecretToken = "cyberworlds-super-secret-internal-agent-service-token";

const context = createTestContext();

async function requestAccountPlanLoader(
    accountId: AccountId,
    method: string,
    options?: {authHeader?: string},
) {
    const tracerContext = new TracerContextModule(testTracer);
    const span = tracerContext.getRoot().startSpan("test").span;

    const headers: Record<string, string> = {};
    if (options && "authHeader" in options) {
        headers.authorization = options.authHeader!;
    } else {
        headers.authorization = `Bearer ${appServiceAccountPlanSecretToken}`;
    }

    const request = new Request(`http://localhost/api/internal/accounts/${accountId}/plan`, {
        method,
        headers,
    });

    const response = await loader({
        request,
        // Hack the context a bit just to get the loader happy with our test context TODO:
        // if we ever generalize loader testing we can make this cleaner
        context: {
            ...context,
            cache: CacheContextModule.new(),
        } as unknown as LoaderContext,
        span,
        params: {accountId: accountId},
        matches: [],
        serverRoutes: [],
    });

    return response;
}

describe("api.internal.accounts.$accountId.plan", () => {
    test("returns account with no plan when account exists without plan", async () => {
        const accountId = generateId<AccountId>();

        await createAccountForTest(context, {
            id: accountId,
            name: "Test Account",
            plan: undefined,
        });

        const response = await requestAccountPlanLoader(accountId, "GET");

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json");

        const data = await response.json();
        expect(data).toEqual({
            plan: undefined,
        });
    });

    test("returns account with lifetime access plan when account exists with plan", async () => {
        const accountId = generateId<AccountId>();

        await createAccountForTest(context, {
            id: accountId,
            name: "Test Account with Plan",
            plan: "LifetimeAccess",
        });

        const response = await requestAccountPlanLoader(accountId, "GET");

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json");

        const data = await response.json();
        expect(data).toEqual({
            plan: "LifetimeAccess",
        });
    });

    test("returns 400 error when account not found", async () => {
        const nonExistentAccountId = generateId<AccountId>();

        const response = await requestAccountPlanLoader(nonExistentAccountId, "GET");

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toBe("application/json");

        const data = await response.json();
        expect(data).toEqual({
            ok: false,
            error: expect.objectContaining({
                name: "NotFoundError",
                message: `Account not found: ${nonExistentAccountId}`,
            }),
        });
    });

    test("returns 400 error when using non-GET HTTP method", async () => {
        const accountId = generateId<AccountId>();

        const response = await requestAccountPlanLoader(accountId, "POST");

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toBe("application/json");

        const data = await response.json();
        expect(data).toEqual({
            ok: false,
            error: expect.objectContaining({
                name: "InvalidArgumentError",
                message: "Must use GET HTTP method",
            }),
        });
    });

    test("returns 400 error when authorization header is missing", async () => {
        const accountId = generateId<AccountId>();

        const response = await requestAccountPlanLoader(accountId, "GET", {authHeader: undefined});

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toBe("application/json");

        const data = await response.json();
        expect(data).toEqual({
            ok: false,
            error: expect.objectContaining({
                name: "InvalidArgumentError",
                message: "Invalid authorization token",
            }),
        });
    });

    test("returns 400 error when authorization header is invalid", async () => {
        const accountId = generateId<AccountId>();

        const response = await requestAccountPlanLoader(accountId, "GET", {
            authHeader: "Bearer invalid-token",
        });

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toBe("application/json");

        const data = await response.json();
        expect(data).toEqual({
            ok: false,
            error: expect.objectContaining({
                name: "InvalidArgumentError",
                message: "Invalid authorization token",
            }),
        });
    });
});
