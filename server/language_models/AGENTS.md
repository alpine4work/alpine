# Language Models Package Guide

This package contains Alpine's shared server-side language model integration layers.

The goal of this package is to give the rest of the server codebase small, consistent APIs for local
model inference, text generation, and structured object generation, while keeping Bedrock transport
details, pricing metadata, and development-only auth paths in one place.

## What This Package Owns

- The shared language model context modules used by server code
- Local language model and tokenizer implementations
- The public `embed` / `generateText` / `generateObject`-style behavior exposed through the context
  module
- Bedrock transport logic
- Bedrock token usage and estimated cost metadata for tracing
- Development-only Bedrock API key support

## What This Package Does Not Own

- Feature-specific prompts for unrelated product areas
- Higher-level product logic for deciding when a language model should run
- Persistence of generated results

Feature-specific instructions should usually live closer to the feature using the language model,
not in this package.

## Structure

- `language_models_context_module.ts`
    - The production/shared language models context module
    - Uses the normal AWS SDK + IAM credential path
- `language_models_development_context_module.ts`
    - Development-only module for direct Bedrock API key calls
    - Used so local development can hit real Bedrock without depending on local IAM credentials
- `language_models_noop_development_context_module.ts`
    - No-op module used when language model calls should be disabled locally or in tests
- `create_language_models_context_module_for_process.ts`
    - Chooses which context module implementation to install for the current process
- `language_models_types.ts`
    - Shared Bedrock model and request/response typing
- `internal/bedrock_converse.ts`
    - Shared Bedrock SDK transport used outside the development API key path
- `internal/bedrock_converse_development.ts`
    - Development-only direct HTTP bearer-token transport
- `internal/bedrock_tracer_data.ts`
    - Usage normalization and token-cost estimation for tracing
- `internal/generate_text.ts`
    - Shared plain-text generation helper used by the context modules
- `internal/generate_object.ts`
    - Shared structured generation helper used by the context modules

## Production vs Development

In production, this package should use the normal AWS SDK credential path with IAM permissions.

In development, this package may use a direct Bedrock API key bearer-token request path instead.
This is intentionally a development-only escape hatch so we can test against real Bedrock locally
without changing the rest of the local stack to use real AWS credentials.

## Local Bedrock Testing

To make local development call real AWS Bedrock, provide `AWS_BEDROCK_TOKEN` to the process that
creates the language models context module.

Today, the development context module is selected when:

- `NODE_ENV === "development"`
- `awsBedrockTokenForDevelopment` is passed into
  `createLanguageModelsContextModuleForProcess({...})`

That token should be a Bedrock API key value created in the AWS Bedrock console:

- [AWS Bedrock API keys](https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/api-keys?tab=long-term)

The direct API key path is for local development only. Do not expand it into production code paths.

## Testing Guidance

- Unit tests in this package should mock the Bedrock transport instead of making live AWS calls.
- Tests should prefer the no-op development module unless the specific behavior under test is
  transport selection or Bedrock request formatting.
- If you need to verify a live local Bedrock call, do it manually in development with
  `AWS_BEDROCK_TOKEN` configured rather than baking live AWS dependencies into automated tests.

## Maintenance Notes

- Keep model IDs and pricing in sync with Bedrock support and pricing docs.
- If you add a new public capability, document it here.
- If you change how local development auth works, update this file in the same change.
- If you add another development-only transport, document exactly when it is selected and why.
