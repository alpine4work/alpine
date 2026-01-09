import {ErrorSchema} from "~/shared/error/error_schema.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {EmailAddressSchema} from "~/shared/schema/helpers/email_address_schema.js";
import {Schema} from "~/shared/schema/schema.js";

// NOTE(calebmer): We don't have RPCs for `attemptOneTimePasswordSignIn()` or
// `attemptOneTimePasswordSignUpThenCreateSpace()` because:
//
// 1. We need to update the `session` cookie (which is an HTTP-only cookie)
//    when they succeed
//
// 2. We need access to the user agent and client IP address which aren't
//    currently available to the RPC framework.
//
// So we have custom `/api/auth/sign-in` and `/api/auth/sign-up` endpoints.
export const AuthSignInOrSignUpInputSchema = Schema.object({
    emailAddress: EmailAddressSchema,
    oneTimePassword: Schema.string,
});

export const AuthSignInOrSignUpOutputSchema = Schema.result(
    Schema.object({ok: Schema.value(true), openSpaceId: Schema.id<SpaceId>().nullable()}),
    Schema.object({ok: Schema.value(false), error: ErrorSchema}),
);
