import {InstanceClass} from "aws-cdk-lib/aws-ec2";

/**
 * The AWS instance class we use for our production services. For now we use
 * [T3 instances][1] which are the most cost effective option if we're
 * generally running below 48% CPU. They're cheap because there's less
 * available CPU but we have some burst capacity when we need more CPU.
 *
 * We may choose to migrate some services to [M7i instances][2] eventually if
 * we need dedicated CPU capacity instead of shared CPU capacity. We should
 * also consider arm64 instances which are generally faster and cheaper.
 *
 * [1]: https://aws.amazon.com/ec2/instance-types/t3
 * [2]: https://aws.amazon.com/ec2/instance-types/m7i
 */
export const awsServiceInstanceClass = InstanceClass.T3;
