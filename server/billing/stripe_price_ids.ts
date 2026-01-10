/**
 * Hardcoded Stripe price IDs for different environments
 * These should correspond to the prices set up in our Stripe dashboard.
 * These are not sensitive.
 */
export const stripeLifetimeAccessPriceId =
    process.env.NODE_ENV === "production"
        ? "price_1SmPziAepubsgg8BVdcxud8i"
        : "price_1SmJOYAi6iKzCsOMCcyQnoba";
