import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {getApiMentionTitleWithStrongConsistency} from "~/server/api/internal/shared/into_api_content_with_references.js";

export const apiSitesPaths: Pick<ApiPaths, keyof ApiPaths & `/sites/${string}`> = {
    "/sites/{id}/mention": {
        get: async (context, {pathParameters}) => {
            const spaceId = context.actor.getSpaceId();

            const {title} = await getApiMentionTitleWithStrongConsistency(
                context,
                spaceId,
                `Site:${pathParameters.id}`,
            );

            return {
                content: {
                    spaceId,
                    mention: {
                        target: {
                            type: "Site",
                            id: pathParameters.id,
                        },
                        title,
                    },
                },
            };
        },
    },
};
