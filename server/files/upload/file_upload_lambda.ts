import {
    APIGatewayProxyEventV2,
    APIGatewayProxyResultV2,
    Context as LambdaContext,
} from "aws-lambda";

export async function handler(
    // TODO(calebmer, #files): Use this
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    event: APIGatewayProxyEventV2,
    // TODO(calebmer, #files): Use this
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    context: LambdaContext,
): Promise<APIGatewayProxyResultV2<void>> {
    // TODO(calebmer, #files): Implement
    // eslint-disable-next-line no-console
    console.log("Hello, world!", require.resolve("sharp"));
}
