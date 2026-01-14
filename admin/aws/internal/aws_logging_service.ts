import {Duration} from "aws-cdk-lib";
import {Bucket} from "aws-cdk-lib/aws-s3";
import {CfnAssociation, ParameterTier, StringParameter} from "aws-cdk-lib/aws-ssm";
import {Construct} from "constructs";
import {cloudwatchAgentConfig} from "~/admin/aws/internal/cloudwatch_agent_config.js";

/**
 * Construct to create a logging bucket and configure the CloudWatch Agent for any instances with
 * the "CloudWatchAgent" tag set to "true".
 */
export class AwsLoggingService extends Construct {
    public readonly loggingBucket: Bucket;

    constructor(parentConstruct: Construct) {
        super(parentConstruct, "LoggingService");

        this.loggingBucket = new Bucket(this, "Bucket", {
            bucketName: "cyberworlds-logs",
            versioned: false,
            lifecycleRules: [{expiration: Duration.days(90)}],
        });

        const cloudwatchAgentConfigParameter = new StringParameter(
            this,
            "CloudWatchAgentConfigParam",
            {
                parameterName: "AmazonCloudWatch-linux",
                stringValue: cloudwatchAgentConfig,
                tier: ParameterTier.STANDARD,
            },
        );

        const installCloudWatchAgent = new CfnAssociation(this, "InstallCloudWatchAgent", {
            name: "AWS-ConfigureAWSPackage",
            targets: [
                {
                    key: "tag:CloudWatchAgent",
                    values: ["true"],
                },
            ],
            parameters: {
                action: ["Install"],
                name: ["AmazonCloudWatchAgent"],
            },
        });

        const configureAndStartCloudWatchAgent = new CfnAssociation(
            this,
            "ConfigureAndStartCloudWatchAgent",
            {
                name: "AmazonCloudWatch-ManageAgent",
                targets: [
                    {
                        key: "tag:CloudWatchAgent",
                        values: ["true"],
                    },
                ],
                parameters: {
                    action: ["configure"],
                    mode: ["ec2"],
                    optionalConfigurationLocation: [cloudwatchAgentConfigParameter.parameterName],
                    optionalRestart: ["yes"],
                },
            },
        );

        configureAndStartCloudWatchAgent.addDependency(installCloudWatchAgent);
    }
}
