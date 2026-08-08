import {getContentReferences} from "~/server/content/get_content_references.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import * as definitions from "~/shared/rpc/content_rpc_definitions.js";

export default implementRpcs(definitions, {
    getContentReferencesWithoutFiles: {
        visibility: ["AppClient"],
        execute: async (context, {spaceId, referencedIds}) => {
            if (referencedIds.fileIds.size > 0) {
                throw new InvalidArgumentError("Can\u2019t get content references for `fileIds`");
            }

            const references = await getContentReferences(
                context,
                spaceId,
                "AssertHasNoFiles",
                referencedIds,
            );

            return {references};
        },
    },
});
