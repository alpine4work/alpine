/* eslint-disable cyberworlds/no-global-error */
import Stripe from "stripe";
import {getAccountBillingItemIfExistsForTest} from "~/server/accounts/get_account_billing_item_if_exists_for_test.js";
import {updateOurStripeCustomerId} from "~/server/accounts/update_our_stripe_customer_id.js";
import {processStripeWebhook} from "~/server/billing/process_stripe_webhook.js";
import {stripeLifetimeAccessPriceId} from "~/server/billing/stripe_price_ids.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DataLossError, FailedPreconditionError, UnknownError} from "~/shared/error/error.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const tracer = new TracerContextModule(testTracer);
const tracerRoot = tracer.getRoot();

const agentServiceUrl = "http://localhost";

type MockStripe = {
    checkout: {
        sessions: {
            retrieve: jest.Mock<any, any>;
        };
    };
    webhooks: {
        constructEvent: jest.Mock<any, any>;
    };
    instance: Stripe;
};

const createMockStripeClient = (): MockStripe => {
    const mockStripeClient: Omit<MockStripe, "instance"> = {
        checkout: {
            sessions: {
                retrieve: import.meta.jest.fn(),
            },
        },
        webhooks: {
            constructEvent: import.meta.jest.fn(),
        },
    };

    return {
        ...mockStripeClient,
        instance: mockStripeClient as unknown as Stripe,
    };
};

const createMockRequest = (body: string, signature?: string): Request => {
    const headers = new Headers();
    if (signature) {
        headers.set("stripe-signature", signature);
    }

    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
            controller.close();
        },
    });

    return new Request("https://example.com", {
        method: "POST",
        headers,
        body: stream,
        // Duplex is required at runtime, but TS doesn't think it exists
        // There's some discrepency here...
        // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
        // @ts-ignore
        duplex: "half",
    });
};

describe("processStripeWebhook", () => {
    const context = createTestContext({});
    const stripeSigningSecret = "whsec_test_secret";

    test("should throw FailedPreconditionError when stripe-signature header is missing", async () => {
        const stripe = createMockStripeClient();
        const request = createMockRequest("test body");
        const span = tracerRoot.startSpan("Test Span").span;

        await expect(
            processStripeWebhook({
                context,
                request,
                stripe: stripe.instance,
                span,
                agentServiceUrl,
                stripeSigningSecret,
            }),
        ).rejects.toThrow(new FailedPreconditionError("Missing stripe-signature header"));
    });

    test("should throw FailedPreconditionError when request body is missing", async () => {
        const stripe = createMockStripeClient();
        const headers = new Headers();
        headers.set("stripe-signature", "test_signature");

        const request = new Request("https://example.com", {
            method: "POST",
            headers,
        });
        const span = tracerRoot.startSpan("Test Span").span;

        await expect(
            processStripeWebhook({
                context,
                request,
                stripe: stripe.instance,
                span,
                agentServiceUrl,
                stripeSigningSecret,
            }),
        ).rejects.toThrow(new FailedPreconditionError("Missing request body"));
    });

    test("should throw FailedPreconditionError when webhook signature is invalid", async () => {
        const stripe = createMockStripeClient();
        const request = createMockRequest("test body", "invalid_signature");
        const span = tracerRoot.startSpan("Test Span").span;

        const stripeError = new Error("Invalid signature");
        stripe.webhooks.constructEvent.mockImplementation(() => {
            throw stripeError;
        });

        await expect(
            processStripeWebhook({
                context,
                request,
                stripe: stripe.instance,
                span,
                agentServiceUrl,
                stripeSigningSecret,
            }),
        ).rejects.toThrow(
            new FailedPreconditionError("Invalid Stripe webhook signature", {cause: stripeError}),
        );

        expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
            "test body",
            "invalid_signature",
            stripeSigningSecret,
        );
    });

    describe("checkout.session.completed", () => {
        test("should throw FailedPreconditionError when customer is missing", async () => {
            const stripe = createMockStripeClient();
            const request = createMockRequest("test body", "valid_signature");
            const span = tracerRoot.startSpan("Test Span").span;

            const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
                id: "evt_test",
                type: "checkout.session.completed",
                data: {
                    object: {
                        id: "cs_test",
                        customer: null,
                        payment_intent: "pi_test",
                        created: 1640995200,
                    } as Stripe.Checkout.Session,
                },
            } as Stripe.CheckoutSessionCompletedEvent;

            stripe.webhooks.constructEvent.mockReturnValue(mockEvent);

            await expect(
                processStripeWebhook({
                    context,
                    request,
                    stripe: stripe.instance,
                    span,
                    agentServiceUrl,
                    stripeSigningSecret,
                }),
            ).rejects.toThrow(new FailedPreconditionError("Stripe event is missing customer"));
        });

        test("should throw FailedPreconditionError when payment_intent is missing", async () => {
            const stripe = createMockStripeClient();
            const request = createMockRequest("test body", "valid_signature");
            const span = tracerRoot.startSpan("Test Span").span;

            const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
                id: "evt_test",
                type: "checkout.session.completed",
                data: {
                    object: {
                        id: "cs_test",
                        customer: "cus_test",
                        payment_intent: null,
                        created: 1640995200,
                    } as Stripe.Checkout.Session,
                },
            } as Stripe.CheckoutSessionCompletedEvent;

            stripe.webhooks.constructEvent.mockReturnValue(mockEvent);

            await expect(
                processStripeWebhook({
                    context,
                    request,
                    stripe: stripe.instance,
                    span,
                    agentServiceUrl,
                    stripeSigningSecret,
                }),
            ).rejects.toThrow(
                new FailedPreconditionError("Stripe event is missing payment_intent"),
            );
        });

        test("should throw UnknownError when checkout session retrieval fails", async () => {
            const stripe = createMockStripeClient();
            const request = createMockRequest("test body", "valid_signature");
            const span = tracerRoot.startSpan("Test Span").span;

            const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
                id: "evt_test",
                type: "checkout.session.completed",
                data: {
                    object: {
                        id: "cs_test",
                        customer: "cus_test",
                        payment_intent: "pi_test",
                        created: 1640995200,
                    } as Stripe.Checkout.Session,
                },
            } as Stripe.CheckoutSessionCompletedEvent;

            stripe.webhooks.constructEvent.mockReturnValue(mockEvent);

            const stripeError = new Error("API error");
            stripe.checkout.sessions.retrieve.mockRejectedValue(stripeError);

            await expect(
                processStripeWebhook({
                    context,
                    request,
                    stripe: stripe.instance,
                    span,
                    agentServiceUrl,
                    stripeSigningSecret,
                }),
            ).rejects.toThrow(
                new UnknownError("Failed to retrieve Stripe checkout session", {
                    cause: stripeError,
                }),
            );

            expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test", {
                expand: ["line_items"],
            });
        });

        test("should return early when checkout session does not contain lifetime access purchase", async () => {
            const stripe = createMockStripeClient();
            const request = createMockRequest("test body", "valid_signature");
            const span = tracerRoot.startSpan("Test Span").span;

            const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
                id: "evt_test",
                type: "checkout.session.completed",
                data: {
                    object: {
                        id: "cs_test",
                        customer: "cus_test",
                        payment_intent: "pi_test",
                        created: 1640995200,
                    } as Stripe.Checkout.Session,
                },
            } as Stripe.CheckoutSessionCompletedEvent;

            const mockCheckoutSession = {
                id: "cs_test",
                line_items: {
                    data: [
                        {
                            price: {
                                id: "price_other",
                            },
                        },
                    ],
                },
            };

            // Mock successful agent service response
            const mockFetch = import.meta.jest.fn();
            mockFetch.mockResolvedValue(new Response("OK", {status: 200}));

            stripe.webhooks.constructEvent.mockReturnValue(mockEvent);
            stripe.checkout.sessions.retrieve.mockResolvedValue(mockCheckoutSession);

            await processStripeWebhook({
                context,
                request,
                stripe: stripe.instance,
                span,
                agentServiceUrl,
                stripeSigningSecret,
                fetch: mockFetch,
            });

            expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test", {
                expand: ["line_items"],
            });
        });

        test("should throw DataLossError when no account found for Stripe customer ID", async () => {
            const stripe = createMockStripeClient();
            const request = createMockRequest("test body", "valid_signature");
            const span = tracerRoot.startSpan("Test Span").span;

            const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
                id: "evt_test",
                type: "checkout.session.completed",
                data: {
                    object: {
                        id: "cs_test",
                        customer: "cus_nonexistent",
                        payment_intent: "pi_test",
                        created: 1640995200,
                    } as Stripe.Checkout.Session,
                },
            } as Stripe.CheckoutSessionCompletedEvent;

            const mockCheckoutSession = {
                id: "cs_test",
                line_items: {
                    data: [
                        {
                            price: {
                                id: stripeLifetimeAccessPriceId,
                            },
                        },
                    ],
                },
            };

            stripe.webhooks.constructEvent.mockReturnValue(mockEvent);
            stripe.checkout.sessions.retrieve.mockResolvedValue(mockCheckoutSession);

            await expect(
                processStripeWebhook({
                    context,
                    request,
                    stripe: stripe.instance,
                    span,
                    agentServiceUrl,
                    stripeSigningSecret,
                }),
            ).rejects.toThrow(new DataLossError("No account found for Stripe customer ID"));

            expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test", {
                expand: ["line_items"],
            });
        });

        test("should successfully process lifetime access purchase with string customer ID", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const sessionContext = session.action();
            const stripeCustomerId = "cus_test123";

            expect(
                (await getAccount(sessionContext, space.id, session.account.id)).initialData.plan,
            ).toBe(undefined);

            await updateOurStripeCustomerId(sessionContext, stripeCustomerId);

            const stripe = createMockStripeClient();
            const request = createMockRequest("test body", "valid_signature");
            const span = tracerRoot.startSpan("Test Span").span;

            const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
                id: "evt_test",
                type: "checkout.session.completed",
                data: {
                    object: {
                        id: "cs_test",
                        customer: stripeCustomerId,
                        payment_intent: "pi_test",
                        created: 1640995200,
                    } as Stripe.Checkout.Session,
                },
            } as Stripe.CheckoutSessionCompletedEvent;

            const mockCheckoutSession = {
                id: "cs_test",
                line_items: {
                    data: [
                        {
                            price: {
                                id: stripeLifetimeAccessPriceId,
                                unit_amount: 19999, // $199.99 in cents
                            },
                            quantity: 1,
                        },
                    ],
                },
            };

            // Mock successful agent service response
            const mockFetch = import.meta.jest.fn();
            mockFetch.mockResolvedValue(new Response("OK", {status: 200}));

            stripe.webhooks.constructEvent.mockReturnValue(mockEvent);
            stripe.checkout.sessions.retrieve.mockResolvedValue(mockCheckoutSession);

            await processStripeWebhook({
                context,
                request,
                stripe: stripe.instance,
                span,
                agentServiceUrl,
                stripeSigningSecret,
                fetch: mockFetch,
            });

            expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test", {
                expand: ["line_items"],
            });

            // Verify the account was updated to LifetimeAccess
            expect(
                (
                    await getAccount(sessionContext, space.id, session.account.id, {
                        consistency: "Strong",
                    })
                ).initialData.plan,
            ).toBe("LifetimeAccess");

            // Verify the agent service was called to refresh entitlements
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(mockFetch).toHaveBeenCalledWith(expect.any(Request));

            // Verify the purchase was recorded with correct price in dollars
            const billingItem = await getAccountBillingItemIfExistsForTest(
                sessionContext,
                session.account.id,
            );
            expect(billingItem?.stripePurchases).toHaveLength(1);
            expect(billingItem?.stripePurchases[0]).toEqual({
                priceId: stripeLifetimeAccessPriceId,
                price: 199.99, // Converted from 19999 cents to dollars
                createdTime: new Date(1640995200 * 1000),
            });
        });

        test("should successfully process lifetime access purchase with customer object", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const sessionContext = session.action();
            const stripeCustomerId = "cus_test456";

            expect(
                (await getAccount(sessionContext, space.id, session.account.id)).initialData.plan,
            ).toBe(undefined);

            await updateOurStripeCustomerId(sessionContext, stripeCustomerId);

            const stripe = createMockStripeClient();
            const request = createMockRequest("test body", "valid_signature");
            const span = tracerRoot.startSpan("Test Span").span;

            const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
                id: "evt_test",
                type: "checkout.session.completed",
                data: {
                    object: {
                        id: "cs_test",
                        customer: {
                            id: stripeCustomerId,
                        } as Stripe.Customer,
                        payment_intent: "pi_test",
                        created: 1640995200,
                    } as Stripe.Checkout.Session,
                },
            } as Stripe.CheckoutSessionCompletedEvent;

            const mockCheckoutSession = {
                id: "cs_test",
                line_items: {
                    data: [
                        {
                            price: {
                                id: stripeLifetimeAccessPriceId,
                                unit_amount: 24999, // $249.99 in cents
                            },
                            quantity: 1,
                        },
                    ],
                },
            };

            // Mock successful agent service response
            const mockFetch = import.meta.jest.fn();
            mockFetch.mockResolvedValue(new Response("OK", {status: 200}));

            stripe.webhooks.constructEvent.mockReturnValue(mockEvent);
            stripe.checkout.sessions.retrieve.mockResolvedValue(mockCheckoutSession);

            await processStripeWebhook({
                context,
                request,
                stripe: stripe.instance,
                span,
                agentServiceUrl,
                stripeSigningSecret,
                fetch: mockFetch,
            });

            expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test", {
                expand: ["line_items"],
            });

            // Verify the account was updated to LifetimeAccess
            expect(
                (
                    await getAccount(sessionContext, space.id, session.account.id, {
                        consistency: "Strong",
                    })
                ).initialData.plan,
            ).toBe("LifetimeAccess");

            // Verify the purchase was recorded with correct price in dollars
            const billingItem = await getAccountBillingItemIfExistsForTest(
                sessionContext,
                session.account.id,
            );
            expect(billingItem?.stripePurchases).toHaveLength(1);
            expect(billingItem?.stripePurchases[0]).toEqual({
                priceId: stripeLifetimeAccessPriceId,
                price: 249.99, // Converted from 24999 cents to dollars
                createdTime: new Date(1640995200 * 1000),
            });
        });

        test("should be idempotent when processing the same event multiple times", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const sessionContext = session.action();
            const stripeCustomerId = "cus_test_idempotent";

            expect(
                (await getAccount(sessionContext, space.id, session.account.id)).initialData.plan,
            ).toBe(undefined);

            await updateOurStripeCustomerId(sessionContext, stripeCustomerId);

            const stripe = createMockStripeClient();
            const span = tracerRoot.startSpan("Test Span").span;

            const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
                id: "evt_test_idempotent",
                type: "checkout.session.completed",
                data: {
                    object: {
                        id: "cs_test_idempotent",
                        customer: stripeCustomerId,
                        payment_intent: "pi_test_idempotent",
                        created: 1640995200, // Fixed timestamp for consistent idempotency
                    } as Stripe.Checkout.Session,
                },
            } as Stripe.CheckoutSessionCompletedEvent;

            const mockCheckoutSession = {
                id: "cs_test_idempotent",
                line_items: {
                    data: [
                        {
                            price: {
                                id: stripeLifetimeAccessPriceId,
                                unit_amount: 19999, // $199.99 in cents
                            },
                            quantity: 1,
                        },
                    ],
                },
            };

            // Mock successful agent service response
            const mockFetch = import.meta.jest.fn();
            mockFetch.mockResolvedValue(new Response("OK", {status: 200}));

            stripe.webhooks.constructEvent.mockReturnValue(mockEvent);
            stripe.checkout.sessions.retrieve.mockResolvedValue(mockCheckoutSession);

            // Process the same event 3 times
            for (let i = 0; i < 3; i++) {
                const request = createMockRequest("test body", `valid_signature_${i}`);
                await processStripeWebhook({
                    context,
                    request,
                    stripe: stripe.instance,
                    span,
                    agentServiceUrl,
                    stripeSigningSecret,
                    fetch: mockFetch,
                });
            }

            // Verify the account was updated to LifetimeAccess
            const account = await getAccount(sessionContext, space.id, session.account.id, {
                consistency: "Strong",
            });
            expect(account.initialData.plan).toBe("LifetimeAccess");

            // Verify there's only one purchase record
            const billingItem = await getAccountBillingItemIfExistsForTest(
                sessionContext,
                session.account.id,
            );
            expect(billingItem?.stripePurchases).toHaveLength(1);
            expect(billingItem?.stripePurchases[0]).toEqual({
                priceId: stripeLifetimeAccessPriceId,
                price: 199.99, // Converted from 19999 cents to dollars
                createdTime: new Date(1640995200 * 1000),
            });

            // Verify the checkout session was retrieved 3 times (once per webhook call)
            expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(3);
        });

        test("should handle different pricing scenarios and quantities", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const sessionContext = session.action();
            const stripeCustomerId = "cus_test_pricing";

            expect(
                (await getAccount(sessionContext, space.id, session.account.id)).initialData.plan,
            ).toBe(undefined);

            await updateOurStripeCustomerId(sessionContext, stripeCustomerId);

            const stripe = createMockStripeClient();
            const request = createMockRequest("test body", "valid_signature");
            const span = tracerRoot.startSpan("Test Span").span;

            const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
                id: "evt_test_pricing",
                type: "checkout.session.completed",
                data: {
                    object: {
                        id: "cs_test_pricing",
                        customer: stripeCustomerId,
                        payment_intent: "pi_test_pricing",
                        created: 1640995200,
                    } as Stripe.Checkout.Session,
                },
            } as Stripe.CheckoutSessionCompletedEvent;

            // Test with 2 quantity to verify quantity handling
            const mockCheckoutSession = {
                id: "cs_test_pricing",
                line_items: {
                    data: [
                        {
                            price: {
                                id: stripeLifetimeAccessPriceId,
                                unit_amount: 15000, // $150.00 in cents
                            },
                            quantity: 2, // Testing quantity > 1
                        },
                    ],
                },
            };

            // Mock successful agent service response
            const mockFetch = import.meta.jest.fn();
            mockFetch.mockResolvedValue(new Response("OK", {status: 200}));

            stripe.webhooks.constructEvent.mockReturnValue(mockEvent);
            stripe.checkout.sessions.retrieve.mockResolvedValue(mockCheckoutSession);

            await processStripeWebhook({
                context,
                request,
                stripe: stripe.instance,
                span,
                agentServiceUrl,
                stripeSigningSecret,
                fetch: mockFetch,
            });

            expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test_pricing", {
                expand: ["line_items"],
            });

            // Verify the account was updated to LifetimeAccess
            expect(
                (
                    await getAccount(sessionContext, space.id, session.account.id, {
                        consistency: "Strong",
                    })
                ).initialData.plan,
            ).toBe("LifetimeAccess");

            // Verify the purchase was recorded with correct price in dollars (unit price, not
            // total)
            const billingItem = await getAccountBillingItemIfExistsForTest(
                sessionContext,
                session.account.id,
            );
            expect(billingItem?.stripePurchases).toHaveLength(1);
            expect(billingItem?.stripePurchases[0]).toEqual({
                priceId: stripeLifetimeAccessPriceId,
                price: 150.0, // Unit amount converted from 15000 cents to dollars
                createdTime: new Date(1640995200 * 1000),
            });
        });

        test("should retry agent service fetch on failure and eventually succeed", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const sessionContext = session.action();
            const stripeCustomerId = "cus_test_retry";

            await updateOurStripeCustomerId(sessionContext, stripeCustomerId);

            const stripe = createMockStripeClient();
            const request = createMockRequest("test body", "valid_signature");
            const span = tracerRoot.startSpan("Test Span").span;

            const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
                id: "evt_test_retry",
                type: "checkout.session.completed",
                data: {
                    object: {
                        id: "cs_test_retry",
                        customer: stripeCustomerId,
                        payment_intent: "pi_test_retry",
                        created: 1640995200,
                    } as Stripe.Checkout.Session,
                },
            } as Stripe.CheckoutSessionCompletedEvent;

            const mockCheckoutSession = {
                id: "cs_test_retry",
                line_items: {
                    data: [
                        {
                            price: {
                                id: stripeLifetimeAccessPriceId,
                                unit_amount: 19999,
                            },
                            quantity: 1,
                        },
                    ],
                },
            };

            // Mock agent service to fail first, then succeed
            const mockFetch = import.meta.jest.fn();
            mockFetch
                .mockResolvedValueOnce(new Response("Server Error", {status: 500}))
                .mockResolvedValueOnce(new Response("OK", {status: 200}));

            stripe.webhooks.constructEvent.mockReturnValue(mockEvent);
            stripe.checkout.sessions.retrieve.mockResolvedValue(mockCheckoutSession);

            await processStripeWebhook({
                context,
                request,
                stripe: stripe.instance,
                span,
                agentServiceUrl,
                stripeSigningSecret,
                fetch: mockFetch,
            });

            // Verify the agent service was called twice (retry)
            expect(mockFetch).toHaveBeenCalledTimes(2);

            // Verify account was still updated despite the initial failure
            expect(
                (
                    await getAccount(sessionContext, space.id, session.account.id, {
                        consistency: "Strong",
                    })
                ).initialData.plan,
            ).toBe("LifetimeAccess");
        });

        test("should continue to retry agent service fetch until success", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const sessionContext = session.action();
            const stripeCustomerId = "cus_test_multiple_retry";

            await updateOurStripeCustomerId(sessionContext, stripeCustomerId);

            const stripe = createMockStripeClient();
            const request = createMockRequest("test body", "valid_signature");
            const span = tracerRoot.startSpan("Test Span").span;

            const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
                id: "evt_test_multiple_retry",
                type: "checkout.session.completed",
                data: {
                    object: {
                        id: "cs_test_multiple_retry",
                        customer: stripeCustomerId,
                        payment_intent: "pi_test_multiple_retry",
                        created: 1640995200,
                    } as Stripe.Checkout.Session,
                },
            } as Stripe.CheckoutSessionCompletedEvent;

            const mockCheckoutSession = {
                id: "cs_test_multiple_retry",
                line_items: {
                    data: [
                        {
                            price: {
                                id: stripeLifetimeAccessPriceId,
                                unit_amount: 19999,
                            },
                            quantity: 1,
                        },
                    ],
                },
            };

            // Mock agent service to fail 3 times, then succeed on the 4th
            const mockFetch = import.meta.jest.fn();
            mockFetch
                .mockResolvedValueOnce(new Response("Server Error", {status: 500}))
                .mockResolvedValueOnce(new Response("Server Error", {status: 502}))
                .mockResolvedValueOnce(new Response("Server Error", {status: 503}))
                .mockResolvedValueOnce(new Response("OK", {status: 200}));

            stripe.webhooks.constructEvent.mockReturnValue(mockEvent);
            stripe.checkout.sessions.retrieve.mockResolvedValue(mockCheckoutSession);

            await processStripeWebhook({
                context,
                request,
                stripe: stripe.instance,
                span,
                agentServiceUrl,
                stripeSigningSecret,
                fetch: mockFetch,
            });

            // Verify the agent service was called 4 times (3 failures + 1 success)
            expect(mockFetch).toHaveBeenCalledTimes(4);

            // Verify the correct URL and payload were called
            expect(mockFetch).toHaveBeenCalledWith(expect.any(Request));

            const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
            const sentFetch = lastCall![0] as Request;
            expect(sentFetch.url).toContain("/refresh-account-entitlements");
            expect(sentFetch.method).toBe("POST");

            const body = await sentFetch.json();
            expect(body).toEqual({accountId: session.account.id});
        });
    });

    test("should handle unknown event types gracefully", async () => {
        const stripe = createMockStripeClient();
        const request = createMockRequest("test body", "valid_signature");
        const span = tracerRoot.startSpan("Test Span").span;

        const mockEvent = {
            id: "evt_test",
            type: "unknown.event.type",
            data: {
                object: {},
            },
        } as unknown as Stripe.Event;

        stripe.webhooks.constructEvent.mockReturnValue(mockEvent);

        await processStripeWebhook({
            context,
            request,
            stripe: stripe.instance,
            span,
            agentServiceUrl,
            stripeSigningSecret,
        });

        expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
            "test body",
            "valid_signature",
            stripeSigningSecret,
        );
    });
});
