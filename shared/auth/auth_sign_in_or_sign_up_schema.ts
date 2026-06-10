import {ErrorSchema} from "~/shared/error/error_schema.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {EmailAddressSchema} from "~/shared/schema/helpers/email_address_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

// NOTE(calebmer): We don't have RPCs for `attemptOneTimePasswordSignIn()` or
// `attemptOneTimePasswordSignUpThenCreateSpace()` because:
//
// 1. We need to update the `session` cookie (which is an HTTP-only cookie) when
//    they succeed
//
// 2. We need access to the user agent and client IP address which aren't currently
//    available to the RPC framework.
//
// So we have custom `/api/auth/sign-in` and `/api/auth/sign-up` endpoints.
export const AuthSignInInputSchema = Schema.object({
    emailAddress: EmailAddressSchema,
    oneTimePassword: Schema.string,
});

export const AuthSignUpInputSchema = Schema.object({
    emailAddress: EmailAddressSchema,
    oneTimePassword: Schema.string,
    inviteEmailAddresses: Schema.array(EmailAddressSchema).default(emptyArray),
});

export type AuthSignInOrSignUpOpen = SchemaType<typeof AuthSignInOrSignUpOpenSchema>;

export const AuthSignInOrSignUpOpenSchema = Schema.union({
    ActiveSpace: Schema.object({
        type: Schema.value("ActiveSpace"),
        spaceId: Schema.id<SpaceId>(),
    }),
    InvitePendingSpace: Schema.object({
        type: Schema.value("InvitePendingSpace"),
        spaceId: Schema.id<SpaceId>(),
    }),
});

export const AuthSignInOrSignUpOutputSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        open: AuthSignInOrSignUpOpenSchema.wrapOriginalPropertyInUnionVariant(
            "ActiveSpace",
            "spaceId",
            {},
        )
            .originalPropertyKey("openSpaceId")
            .nullable(),
    }),
    Schema.object({ok: Schema.value(false), error: ErrorSchema}),
);
