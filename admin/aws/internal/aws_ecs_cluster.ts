import {Stack} from "aws-cdk-lib";
import {Vpc} from "aws-cdk-lib/aws-ec2";
import {Cluster, LogDriver, LogDrivers} from "aws-cdk-lib/aws-ecs";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import {Construct} from "constructs";

export class AwsEcsCluster extends Construct {
    public readonly cluster: Cluster;
    public readonly shortLivedLogDriver: LogDriver;

    constructor(parentConstruct: Stack, vpc: Vpc) {
        super(parentConstruct, "EcsCluster");

        this.cluster = new Cluster(this, "Cluster", {vpc});

        this.shortLivedLogDriver = LogDrivers.awsLogs({
            streamPrefix: parentConstruct.stackName,
            logRetention: RetentionDays.TWO_WEEKS,
        });
    }
}
