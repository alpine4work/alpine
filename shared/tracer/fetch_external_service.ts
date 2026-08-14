/**
 * External service names are not PascalCase like our internal service names. They
 * are human-readable phrases, potentially including spaces.
 *
 * For example "OpenSearch" is an external service name instead of "Opensearch".
 * "Opensearch" (without a capital "S") is how we refer to OpenSearch in PascalCase
 * since we want to treat it as a single word. But OpenSearch is how you'd write
 * the service name in a sentence.
 *
 * A simpler example is "Secrets Manager" instead of "SecretsManager" to refer to
 * the AWS Secrets Manager service.
 */
export type ExternalServiceName = "OpenSearch" | "Cohere" | "LogoDev" | "Cursor" | "Loops";

/** Returns whether a service name belongs to an external service. */
export function isExternalServiceName(serviceName: string): serviceName is ExternalServiceName {
    switch (serviceName) {
        case "OpenSearch":
        case "Cohere":
        case "LogoDev":
        case "Cursor":
        case "Loops":
            return true;
        default:
            return false;
    }
}
