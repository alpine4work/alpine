# Billing System

This directory contains the billing system implementation for Cyberworlds, which integrates with
Stripe for payment processing.

## Overview

The billing system uses Stripe to handle customer billing, subscriptions, and payment processing.
Customer information is stored in the account settings and linked to Stripe customer IDs.

## Local Development Setup

When developing locally, you need to configure Stripe integration properly:

### 1. Environment Configuration

Add the Stripe secret key to your local environment file:

```bash
# In .env.development.local
STRIPE_SECRET_KEY=sk_test_...
STRIPE_SIGNING_SECRET=whsec_...
```

You must use the **sandbox** STRIPE_SECRET_KEY for local development.

### 2. Stripe CLI Setup

Install and configure the Stripe CLI to forward webhook events to your local development
environment:

1. Install the Stripe CLI: https://docs.stripe.com/stripe-cli#install

2. Configure the CLI to forward events to your local server:

```bash
stripe listen --forward-to http://localhost:3000/api/internal/stripe/webhook
```

This command will display a webhook signing secret (starting with `whsec_`) in the output. Copy this
secret and add it to your `.env.development.local` file as `STRIPE_SIGNING_SECRET`.

This will forward Stripe webhook events (like payment confirmations, subscription updates, etc.) to
your local development server so you can test the complete billing flow.
