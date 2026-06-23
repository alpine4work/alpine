/**
 * AWS regions where we have explicit Bedrock support and pricing metadata for our
 * supported models.
 */
export const supportedBedrockAwsRegions = [
    "ap-northeast-1",
    "ap-south-1",
    "ap-southeast-2",
    "eu-south-1",
    "eu-west-1",
    "eu-west-2",
    "sa-east-1",
    "us-east-1",
    "us-east-2",
    "us-west-2",
] as const;

export type SupportedBedrockAwsRegion = (typeof supportedBedrockAwsRegions)[number];
