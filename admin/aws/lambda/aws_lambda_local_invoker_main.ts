import {APIGatewayProxyEventV2, Context} from "aws-lambda";
import fs from "fs-extra";
import {join as joinPath, sep as pathSeparator} from "path";
import {UnimplementedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const execrootPath = assertExists(process.env.JS_BINARY__EXECROOT);

async function main() {
    const lambdaPath = assertExists(process.argv[2]);
    assert((await fs.stat(lambdaPath)).isDirectory());

    const lambdaResolvedPath = await fs.realpath(lambdaPath);
    const lambdaResolvedPathPrefix = joinPath(execrootPath, "bazel-out") + pathSeparator;
    assert(lambdaResolvedPath.startsWith(lambdaResolvedPathPrefix), "Output not in Bazel execroot");

    const lambdaRelativePath = lambdaResolvedPath
        .slice(lambdaResolvedPathPrefix.length)
        .split(pathSeparator)
        .slice(2)
        .join(pathSeparator);

    // Setup a mock AWS Lambda environment before importing our lambda code.
    process.env.LAMBDA_TASK_ROOT = lambdaPath;

    const lambdaModule = await import(
        joinPath(lambdaPath, "cyberworlds", `${lambdaRelativePath}.cjs`)
    );

    const functionName = "Local";
    const region = "us-east-1";
    const accountId = "local";

    const startTime = Date.now();

    // The maximum AWS Lambda function timeout:
    // https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html
    const timeoutMs = 1000 * 60 * 15;

    // Create a mock AWS Lambda context object:
    // https://docs.aws.amazon.com/lambda/latest/dg/nodejs-context.html
    const context: Context = {
        callbackWaitsForEmptyEventLoop: true,
        functionName,
        functionVersion: "1",
        invokedFunctionArn: `arn:aws:lambda:${region}:${accountId}:function:${functionName}`,
        get memoryLimitInMB(): never {
            throw new UnimplementedError(
                'AWS Lambda local invoker hasn\'t implemented "Context.memoryLimitInMB"',
            );
        },
        get awsRequestId(): never {
            throw new UnimplementedError(
                'AWS Lambda local invoker hasn\'t implemented "Context.awsRequestId"',
            );
        },
        get logGroupName(): never {
            throw new UnimplementedError(
                'AWS Lambda local invoker hasn\'t implemented "Context.logGroupName"',
            );
        },
        get logStreamName(): never {
            throw new UnimplementedError(
                'AWS Lambda local invoker hasn\'t implemented "Context.logStreamName"',
            );
        },
        getRemainingTimeInMillis: () => {
            return timeoutMs - (Date.now() - startTime);
        },
        // The methods are deprecated but still included in the types for compatibility
        // with older versions of AWS Lambda.
        done(): never {
            throw new UnimplementedError(
                'AWS Lambda local invoker hasn\'t implemented "Context.done"',
            );
        },
        fail(): never {
            throw new UnimplementedError(
                'AWS Lambda local invoker hasn\'t implemented "Context.fail"',
            );
        },
        succeed(): never {
            throw new UnimplementedError(
                'AWS Lambda local invoker hasn\'t implemented "Context.succeed"',
            );
        },
    };

    // Create an event using the API Gateway 2.0 format which is what's used
    // when your lambda function has a public function URL.
    // https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html
    const event: APIGatewayProxyEventV2 = {
        version: "2.0",
        get routeKey(): never {
            throw new UnimplementedError(
                'AWS Lambda local invoker hasn\'t implemented "APIGatewayProxyEventV2.routeKey"',
            );
        },
        // TODO(calebmer, #files): Implement
        // @ts-expect-error
        rawPath,
        // TODO(calebmer, #files): Implement
        // @ts-expect-error
        rawQueryString,
        // TODO(calebmer, #files): Implement
        // @ts-expect-error
        cookies,
        // TODO(calebmer, #files): Implement
        // @ts-expect-error
        headers,
        // TODO(calebmer, #files): Implement
        // @ts-expect-error
        queryStringParameters,
        requestContext: {
            accountId,
            get apiId(): never {
                throw new UnimplementedError(
                    'AWS Lambda local invoker hasn\'t implemented "APIGatewayProxyEventV2.requestContext.apiId"',
                );
            },
            get domainName(): never {
                throw new UnimplementedError(
                    'AWS Lambda local invoker hasn\'t implemented "APIGatewayProxyEventV2.requestContext.domainName"',
                );
            },
            get domainPrefix(): never {
                throw new UnimplementedError(
                    'AWS Lambda local invoker hasn\'t implemented "APIGatewayProxyEventV2.requestContext.domainPrefix"',
                );
            },
            // TODO(calebmer, #files): Implement
            // @ts-expect-error
            http,
            get requestId(): never {
                throw new UnimplementedError(
                    'AWS Lambda local invoker hasn\'t implemented "APIGatewayProxyEventV2.requestContext.requestId"',
                );
            },
            get routeKey(): never {
                throw new UnimplementedError(
                    'AWS Lambda local invoker hasn\'t implemented "APIGatewayProxyEventV2.requestContext.routeKey"',
                );
            },
            get stage(): never {
                throw new UnimplementedError(
                    'AWS Lambda local invoker hasn\'t implemented "APIGatewayProxyEventV2.requestContext.stage"',
                );
            },
            get time(): never {
                throw new UnimplementedError(
                    'AWS Lambda local invoker hasn\'t implemented "APIGatewayProxyEventV2.requestContext.time"',
                );
            },
            get timeEpoch(): never {
                throw new UnimplementedError(
                    'AWS Lambda local invoker hasn\'t implemented "APIGatewayProxyEventV2.requestContext.timeEpoch"',
                );
            },
        },
        isBase64Encoded: false,
        // TODO(calebmer, #files): Implement
        // @ts-expect-error
        body,
        get pathParameters(): never {
            throw new UnimplementedError(
                'AWS Lambda local invoker hasn\'t implemented "APIGatewayProxyEventV2.pathParameters"',
            );
        },
        get stageVariables(): never {
            throw new UnimplementedError(
                'AWS Lambda local invoker hasn\'t implemented "APIGatewayProxyEventV2.stageVariables"',
            );
        },
    };

    await lambdaModule.handler(event, context);
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
