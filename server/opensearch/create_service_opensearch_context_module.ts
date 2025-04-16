import {join as joinPath} from "path";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {OpensearchServerlessCollectionType} from "~/server/opensearch/opensearch_index.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export const serviceOpensearchOptions = {
    opensearchLocalPort: {type: "string"},
    opensearchSearchServerlessCollectionEndpoint: {type: "string"},
    opensearchVectorSearchServerlessCollectionEndpoint: {type: "string"},
} as const;

export function createServiceOpensearchContextModule(
    signer: AwsRequestSigner,
    options: {
        opensearchLocalPort?: string;
        opensearchSearchServerlessCollectionEndpoint?: string;
        opensearchVectorSearchServerlessCollectionEndpoint?: string;
        ensureLocalCachePath?: string;
    },
) {
    let urlByServerlessCollectionType: Record<OpensearchServerlessCollectionType, string>;

    if (process.env.NODE_ENV !== "production") {
        const url = `http://localhost:${parseInt(
            assertExists(
                options.opensearchLocalPort,
                "`opensearchLocalPort` option is required in development",
            ),
            10,
        )}`;

        urlByServerlessCollectionType = {Search: url, VectorSearch: url};
    } else {
        urlByServerlessCollectionType = {
            Search: assertExists(
                options.opensearchSearchServerlessCollectionEndpoint,
                "`opensearchSearchServerlessCollectionEndpoint` option is required in production",
            ),
            VectorSearch: assertExists(
                options.opensearchVectorSearchServerlessCollectionEndpoint,
                "`opensearchVectorSearchServerlessCollectionEndpoint` option is required in production",
            ),
        };
    }

    return OpensearchContextModule.new(
        new OpensearchClient({
            urlByServerlessCollectionType,
            signer,
            ensureLocalCachePath:
                process.env.NODE_ENV !== "production"
                    ? joinPath(
                          assertExists(
                              options.ensureLocalCachePath,
                              "`ensureLocalCachePath` option is required in development",
                          ),
                          "opensearch",
                      )
                    : null,
        }),
    );
}
