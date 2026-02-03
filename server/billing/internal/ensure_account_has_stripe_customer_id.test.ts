import Stripe from "stripe";
import {updateOurStripeCustomerId} from "~/server/accounts/update_our_stripe_customer_id.js";
import {ensureAccountHasStripeCustomerId} from "~/server/billing/internal/ensure_account_has_stripe_customer_id.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnknownError} from "~/shared/error/error.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const tracer = new TracerContextModule(testTracer);
const tracerRoot = tracer.getRoot();

type MockStripe = {
    customers: {
        create: jest.Mock<any, any>;
    };
    instance: Stripe;
};

const createMockStripeClient = (): MockStripe => {
    const mockStripeClient: Omit<MockStripe, "instance"> = {
        customers: {
            create: import.meta.jest.fn(),
        },
    };

    return {
        ...mockStripeClient,
        instance: mockStripeClient as unknown as Stripe,
    };
};

describe("ensureAccountHasStripeCustomerId", () => {
    const context = createTestContext({});

    test("should not create a new Stripe customer if the account already has a Stripe customer ID", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const sessionContext = session.action();

        const existingCustomerId = "cus_existing123";
        await updateOurStripeCustomerId(sessionContext, existingCustomerId);

        const stripe = createMockStripeClient();
        const result = await ensureAccountHasStripeCustomerId({
            context: sessionContext,
            stripe: stripe.instance,
            span: tracerRoot.startSpan("Test Span").span,
        });

        expect(result).toBe(existingCustomerId);
        expect(stripe.customers.create).not.toHaveBeenCalled();
    });

    test("should create a new Stripe customer and update the account", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const sessionContext = session.action();
        const email = await session.account.createEmailAddress();

        const stripe = createMockStripeClient();
        const newCustomerId = "cus_new123";

        const mockStripeCustomer = {
            id: newCustomerId,
        };

        stripe.customers.create.mockResolvedValue(mockStripeCustomer);

        const result = await ensureAccountHasStripeCustomerId({
            context: sessionContext,
            stripe: stripe.instance,
            span: tracerRoot.startSpan("Test Span").span,
        });

        const weekSinceEpoch = Math.floor(Date.now() / 1000 / 60 / 60 / 24 / 7);
        expect(result).toBe(newCustomerId);
        expect(stripe.customers.create).toHaveBeenCalledWith(
            {
                name: session.account.initialName,
                email,
                metadata: {
                    accountId: session.account.id,
                },
            },
            {
                idempotencyKey: `create-customer-for-account-${session.account.id}-${weekSinceEpoch}`,
            },
        );
    });

    test("should throw UnknownError when Stripe customer creation fails", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const sessionContext = session.action();
        await session.account.createEmailAddress();

        const stripe = createMockStripeClient();
        // eslint-disable-next-line cyberworlds/no-global-error
        const stripeError = new Error("Stripe API error");

        stripe.customers.create.mockRejectedValue(stripeError);

        await expect(
            ensureAccountHasStripeCustomerId({
                context: sessionContext,
                stripe: stripe.instance,
                span: tracerRoot.startSpan("Test Span").span,
            }),
        ).rejects.toThrow(
            new UnknownError(`Failed to create Stripe customer`, {cause: stripeError}),
        );
    });
});
