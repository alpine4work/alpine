import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {getSpace} from "~/server/spaces/spaces_actions.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";

export const apiSpacesPaths: Pick<
    ApiPaths,
    keyof ApiPaths & (`/spaces/${string}` | `/accounts/${string}`)
> = {
    "/accounts/{id}": {
        get: async (context, {pathParameters}) => {
            // We load the account data using the `SpaceId` the bot is instantiated in. So
            // if an account was removed from the space then our bot will see old data.
            const account = await getApiAccount(
                context,
                context.actor.getSpaceId(),
                pathParameters.id,
                {consistency: "StrongWithinCache"},
            );

            return {
                content: {
                    account: omitObject(account, ["space"]),
                },
            };
        },
    },

    "/spaces/{id}": {
        get: async (context, {pathParameters}) => {
            const space = await getSpace(context, pathParameters.id, {
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    space: {
                        id: pathParameters.id,
                        name: space.name,
                    },
                },
            };
        },
    },

    "/spaces/{id}/accounts/{accountId}": {
        get: async (context, {pathParameters}) => {
            const account = await getApiAccount(
                context,
                pathParameters.id,
                pathParameters.accountId,
                {consistency: "StrongWithinCache"},
            );

            return {
                content: {
                    account,
                },
            };
        },
    },
};
