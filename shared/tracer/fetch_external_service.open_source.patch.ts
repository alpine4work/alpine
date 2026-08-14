// Public tracer builds treat every service as internal, so this argument is intentionally unused.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isExternalServiceName(serviceName: string): boolean {
    return false;
}
