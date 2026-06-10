export type LocalRedirectServiceEnv = {
    ALLOWABLE_DESTINATION_ORIGINS: Array<string>;
    HONEYCOMB_API_KEY?: string;
    KINESIS_TRACER_STREAM_NAME?: string;
    KINESIS_AWS_ACCESS_KEY_ID?: string;
    KINESIS_AWS_SECRET_ACCESS_KEY?: string;
};
