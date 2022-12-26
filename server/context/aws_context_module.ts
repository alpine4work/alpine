import {AwsClient} from "aws4fetch";
import {createAwsClientFromEnv} from "~/server/context/helpers/create_aws_client_from_env";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Context module wrapping our AWS client using the `aws4fetch`
 * lightweight client.
 */
export class AwsContextModule extends ContextModuleBase {
    constructor(public readonly client: AwsClient) {
        super();
    }

    /**
     * Create an AWS context module just for use in tests.
     */
    public static test() {
        assert(typeof jest !== "undefined");
        return new AwsContextModule(createAwsClientFromEnv({}));
    }
}
