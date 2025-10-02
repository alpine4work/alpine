import {Duration} from "aws-cdk-lib";
import {Bucket} from "aws-cdk-lib/aws-s3";
import {Construct} from "constructs";

export class AwsLoggingService extends Construct {
    public readonly loggingBucket: Bucket;

    constructor(parentConstruct: Construct) {
        super(parentConstruct, "LoggingService");

        this.loggingBucket = new Bucket(this, "Bucket", {
            bucketName: "cyberworlds-logs",
            versioned: false,
            lifecycleRules: [{expiration: Duration.days(90)}],
        });
    }
}
