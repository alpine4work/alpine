export type AlertSourceRequest = {
    body?: string;
    headers: Record<string, string>;
    httpMethod?: string;
    isBase64Encoded?: boolean;
    queryStringParameters?: Record<string, string>;
    requestContext?: {
        http: {
            method: string;
            path: string;
            sourceIp: string;
        };
    };
};
