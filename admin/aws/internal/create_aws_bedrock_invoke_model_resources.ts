import {ArnFormat, Stack} from "aws-cdk-lib";
import {Construct} from "constructs";
import {supportedBedrockModels} from "~/server/language_models/supported_bedrock_model.js";

export function createAwsBedrockInvokeModelResources(scope: Construct): Array<string> {
    const stack = Stack.of(scope);

    return supportedBedrockModels.map(model =>
        stack.formatArn({
            arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
            service: "bedrock",
            region: stack.region,
            account: "",
            resource: "foundation-model",
            resourceName: model,
        }),
    );
}
