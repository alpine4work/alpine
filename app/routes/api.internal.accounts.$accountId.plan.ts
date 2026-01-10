import {deserializeAccountIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {dangerouslyGetAccountIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {AccountId} from "~/shared/id/types/id_types.js";

// If you're adding any data here, be very certain this is safe
// to return here!
type InternalAccountsPlanResponse = {
    plan: "LifetimeAccess" | undefined;
};

// Pull into a separate function just to be very sure of our return type.
async function getInternalAccountsPlanResponse(
    context: LoaderArgs["context"],
    accountId: AccountId,
): Promise<InternalAccountsPlanResponse> {
    const account = await dangerouslyGetAccountIfExistsWithoutAuthorization(context, accountId, {
        consistency: "Strong",
    });

    if (!account) {
        throw new NotFoundError(`Account not found: ${accountId}`);
    }

    // If you're adding any data here, be very certain this is safe
    // to return here!
    const response: InternalAccountsPlanResponse = {
        plan: account.initialData.plan,
    };

    return response;
}

/**
 * This loader is unauthenticated!
 *
 * This is used by our agent service to make an easy request about the current plan
 * of a given account. This happens when we need to update the agent entitlements for
 * an account after their plan changes.
 *
 * We discussed this in a [Tea Time on January 8, 2025][1].
 *
 * [1]: https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/xktt54v9vyjxmz1193tpmztt34
 */
export async function loader({request, context, span, params}: LoaderArgs) {
    try {
        if (request.method !== "GET") throw new InvalidArgumentError("Must use GET HTTP method");

        const response = await getInternalAccountsPlanResponse(
            context,
            deserializeAccountIdForLoader(params.accountId),
        );

        return new Response(JSON.stringify(response), {
            status: 200,
            headers: {"content-type": "application/json"},
        });
    } catch (error) {
        span.addException(error);

        return new Response(
            JSON.stringify({
                ok: false,
                error: ErrorSchema.serialize(error),
            }),
            {
                status: isSystemError(error) ? 500 : 400,
                headers: {"content-type": "application/json"},
            },
        );
    }
}
