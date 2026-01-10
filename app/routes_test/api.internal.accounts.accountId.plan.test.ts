import {loader} from "~/app/routes/api.internal.accounts.$accountId.plan.js";
import {createAccountForTest} from "~/server/accounts/create_account_for_test.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {LoaderContext} from "~/server/remix/loader_context.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const context = createTestContext();

async function requestAccountPlanLoader(accountId: AccountId, method: string) {
    const tracerContext = new TracerContextModule(testTracer);
    const span = tracerContext.getRoot().startSpan("test").span;

    const request = new Request(`http://localhost/api/internal/accounts/${accountId}/plan`, {
        method,
    });

    const response = await loader({
        request,
        // Hack the context a bit just to get the loader happy with our test context
        // TODO: if we ever generalize loader testing we can make this cleaner
        context: {
            ...context,
            cache: CacheContextModule.new(),
        } as unknown as LoaderContext,
        span,
        params: {accountId: accountId},
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
});
