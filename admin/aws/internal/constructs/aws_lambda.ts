import {Function as LambdaFunctionBase} from "aws-cdk-lib/aws-lambda";
import {Construct} from "constructs";
import {
    AwsLambdaBase,
    AwsLambdaBaseOptions,
} from "~/admin/aws/internal/constructs/internal/aws_lambda_base.js";

/**
 * A construct that wraps the AWS CDK LambdaFunction and deploys Container-based Lambdas
 * by default.
 */
export class AwsLambda extends AwsLambdaBase {
    constructor(scope: Construct, id: string, options: AwsLambdaBaseOptions) {
        super(scope, id, options);
    }
    public get lambdaFunction(): LambdaFunctionBase {
        return this._lambdaFunction;
    }
}
