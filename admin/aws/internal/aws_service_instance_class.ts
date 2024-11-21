import {InstanceClass} from "aws-cdk-lib/aws-ec2";

/**
 * The AWS instance class we use for our production services. We use
 * [T4g instances][1] which are the most cost effective option if we're
 * generally running below 48% CPU. They're cheap because there's less
 * available CPU but we have some burst capacity when we need more CPU.
 *
 * We use arm64 AWS Gravitron processors which provide up to 40% better
 * price performance compared to T3 instances. Our recommended development
 * machine is a MacOS device with an M-series chip which is also arm64.
 * Running on the same architecture in development and the cloud also
 * simplifies development.
 *
 * We may choose to migrate some services to [M7g instances][2] eventually if
 * we need dedicated CPU capacity instead of shared CPU capacity. We should
 * also consider arm64 instances which are generally faster and cheaper.
 *
 * [1]: https://aws.amazon.com/ec2/instance-types/t4
 * [2]: https://aws.amazon.com/ec2/instance-types/m7g
 */
export const awsServiceInstanceClass = InstanceClass.T4G;
