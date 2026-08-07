import {UnimplementedError} from "~/shared/error/error.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

export function createLambdaEventMockWithUnimplementedErrors<T>(
    baseEventObject: Partial<T>,
    eventType:
        | "ApiGatewayProxyEvent"
        | "SQSRecord"
        | "LambdaContext"
        | "ApiGatewayProxyEventRequestContext",
): T {
    // Create a proxy that automatically throws UnimplementedError for any
    // unimplemented properties
    return new Proxy(baseEventObject, {
        get(target, prop) {
            // If the property exists on the target, return it
            if (prop in target) {
                return target[prop as keyof typeof target];
            }

            throw new UnimplementedError(
                quote`Unimplemented ${eventType} property ${String(prop)}`,
            );
        },
    }) as T;
}
