import {InstanceClass} from "aws-cdk-lib/aws-ec2";

/**
 * The AWS instance class we use for our production services.
 *
 * We use arm64 AWS Gravitron processors which provide up to 40% better
 * price performance compared to T3 instances. Our recommended development
 * machine is a MacOS device with an M-series chip which is also arm64.
 * Running on the same architecture in development and the cloud also
 * simplifies development.
 */
export const awsServiceInstanceClass = InstanceClass.C8G;
