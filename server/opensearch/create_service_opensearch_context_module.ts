import {join as joinPath} from "path";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export const serviceOpensearchOptions = {
    opensearchLocalPort: {type: "string"},
    opensearchHost: {type: "string"},
} as const;

export function createServiceOpensearchContextModule(
    signer: AwsRequestSigner,
    options: {
        opensearchHost?: string;
        opensearchLocalPort?: string;
        ensureLocalCachePath?: string;
    },
) {
    const url =
        process.env.NODE_ENV === "production"
            ? `https://${assertExists(
                  options.opensearchHost,
                  "`opensearchHost` option is required in production",
              )}`
            : `http://localhost:${parseInt(
                  assertExists(
                      options.opensearchLocalPort,
                      "`opensearchLocalPort` option is required in development",
                  ),
                  10,
              )}`;

    return OpensearchContextModule.new(
        new OpensearchClient({
            urlByServerlessCollectionType: {
                Search: url,
                VectorSearch: url,
            },
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
