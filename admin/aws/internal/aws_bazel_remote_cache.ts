import {Duration, RemovalPolicy, Stack} from "aws-cdk-lib";
import {IConnectable, IVpc, Port, SecurityGroup, SubnetType} from "aws-cdk-lib/aws-ec2";
import {
    ContainerImage,
    CpuArchitecture,
    FargateService,
    FargateTaskDefinition,
    ICluster,
    LogDrivers,
    OperatingSystemFamily,
} from "aws-cdk-lib/aws-ecs";
import {NetworkLoadBalancer, Protocol} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import {ARecord, HostedZone, RecordTarget} from "aws-cdk-lib/aws-route53";
import {LoadBalancerTarget} from "aws-cdk-lib/aws-route53-targets";
import {BlockPublicAccess, Bucket} from "aws-cdk-lib/aws-s3";
import {Construct} from "constructs";

/**
 * Private DNS name for the centralized Bazel remote cache in the lifecycle VPC.
 * Referenced from `admin/bazel/aspect_bazelrc/ci.bazelrc` — keep them in sync.
 */
export const bazelRemoteCacheHostname = "bazel-remote-cache.cyberworlds.internal";

// The TCP port bazel-remote listens on for the HTTP cache API. Bazel connects to
// this through the internal load balancer with `--remote_cache=http://...:8080`.
const bazelRemoteCachePort = 8080;

// The TCP port bazel-remote listens on for the gRPC cache API. Bazel connects to
// this through the internal load balancer with `--remote_cache=grpc://...:9092`.
const bazelRemoteCacheGrpcPort = 9092;

/**
 * Proof-of-concept centralized Bazel remote cache.
 *
 * Runs [`bazel-remote`][1] as a single Fargate task backed by its own dedicated S3
 * cache bucket, fronted by an internal Network Load Balancer that GitHub runners
 * in the same VPC reach over HTTP and gRPC. This is intended to replace the
 * per-runner `aws_github_runners_bazel_remote_cache.cjs` proxy: `bazel-remote`
 * signs S3 requests with the task's IAM role (just like the custom proxy) _and_
 * adds a local disk cache layer in front of S3, so repeat hits avoid an S3
 * round-trip.
 *
 * Because this is a POC it intentionally keeps things simple:
 *
 * - A single task (no horizontal scaling) sized small.
 * - An ephemeral local cache (Fargate ephemeral storage). On task restart the
 *   cache re-warms from S3, which remains the source of truth.
 * - The upstream image runs as uid 65532 and owns its built-in `/data` directory.
 *   We rely on the task's ephemeral container filesystem instead of mounting an
 *   explicit ECS volume over `/data`, which would mask those permissions.
 *
 * GitHub runner CI reaches this service via `ci.bazelrc`
 * (`--config=github-runner`). Stack outputs publish the stable private DNS
 * endpoints for manual testing.
 *
 * [1]: https://github.com/buchgr/bazel-remote
 */
export class AwsBazelRemoteCache extends Construct {
    constructor(
        parentConstruct: Construct,
        {
            vpc,
            cluster,
            runnerConnectables,
        }: {
            vpc: IVpc;
            cluster: ICluster;
            runnerConnectables: Array<IConnectable>;
        },
    ) {
        super(parentConstruct, "BazelRemoteCache");

        const stack = Stack.of(this);

        // Dedicated S3 bucket backing this cache, separate from the per-runner proxy's
        // bucket so the two can be validated (and rolled back) independently.
        const bucket = new Bucket(this, "Bucket", {
            // Manually assign a bucket name so we can reference it from `--s3.bucket`.
            bucketName: "cyberworlds-bazel-remote-cache",
            // Security best practice to require HTTPS access.
            enforceSSL: true,
            minimumTLSVersion: 1.2,
            // Don't allow public access. We only allow access through IAM policies.
            removalPolicy: RemovalPolicy.DESTROY,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            // If this bucket is deleted from a stack, we can delete the objects within.
            // They're cache artifacts which can easily be rebuilt.
            autoDeleteObjects: true,
            // Delete artifacts after 14 days (two weeks) if they haven't been used.
            // `bazel-remote` is configured to update the modification time when there's a
            // cache hit (see `--s3.update_timestamps`).
            lifecycleRules: [{expiration: Duration.days(14)}],
        });

        const taskDefinition = new FargateTaskDefinition(this, "TaskDefinition", {
            // NOTE: The rest of our fleet is ARM/Graviton, but the published
            // `buchgr/bazel-remote-cache` Docker Hub image is x86_64. Keeping the POC on
            // x86_64 avoids needing to build/mirror an arm64 image. Revisit (mirror an arm64
            // image to ECR) if we promote this past the POC.
            runtimePlatform: {
                operatingSystemFamily: OperatingSystemFamily.LINUX,
                cpuArchitecture: CpuArchitecture.X86_64,
            },
            // Small to start. Fargate network bandwidth scales with vCPU, so bump this (or run
            // multiple tasks) if the cache becomes a throughput bottleneck.
            cpu: 2048,
            memoryLimitMiB: 8192,
            // Local hot cache. Backed by Fargate ephemeral storage and capped below the disk
            // size by `--max_size`. It's just a cache, so losing it on restart only costs a
            // re-warm from S3.
            ephemeralStorageGiB: 100,
        });

        const container = taskDefinition.addContainer("Container", {
            // Pinned by digest (not a mutable tag) for reproducible deploys. This is the
            // multi-arch index digest for the `v2.6.1` release; bump it deliberately when
            // upgrading.
            //
            // NOTE: Anonymous Docker Hub pulls are rate-limited. Fine for a POC's infrequent
            // pulls; mirror to ECR if this graduates to production.
            image: ContainerImage.fromRegistry(
                "buchgr/bazel-remote-cache@sha256:d9b104d02bea731f5a8ce6d3c518f814953ef54c2e0218744ce7643ff9d85ca8",
            ),
            logging: LogDrivers.awsLogs({
                streamPrefix: stack.stackName,
                logRetention: RetentionDays.TWO_WEEKS,
            }),
            portMappings: [
                {containerPort: bazelRemoteCachePort},
                {containerPort: bazelRemoteCacheGrpcPort},
            ],
            command: [
                // The image entrypoint already sets `--dir=/data` and `--http_address=:8080`; pass
                // only the POC-specific settings here. GiB. Kept below `ephemeralStorageGiB` to
                // leave headroom.
                "--max_size=80",
                // Serve the gRPC cache API alongside HTTP. Bind all interfaces so the load
                // balancer can reach it.
                `--grpc_address=0.0.0.0:${bazelRemoteCacheGrpcPort}`,
                // The image entrypoint enables pprof on `:6060`; keep the POC surface area to the
                // cache port only.
                "--profile_address=none",
                // Sign S3 requests with the Fargate task role, mirroring what the custom proxy did
                // with the runner's instance role.
                "--s3.auth_method=iam_role",
                // IMPORTANT: leave `--s3.iam_role_endpoint` unset. On Fargate the task role
                // credentials come from the ECS container credentials endpoint, not IMDS.
                // minio-go's IAM provider (used by bazel-remote) picks those up automatically only
                // when the endpoint isn't pinned to IMDS.
                `--s3.bucket=${bucket.bucketName}`,
                `--s3.region=${stack.region}`,
                `--s3.endpoint=s3.${stack.region}.amazonaws.com`,
                // Update object mtimes on cache hit so hot blobs survive the bucket's 14-day
                // expiration lifecycle (LRU-by-mtime).
                "--s3.update_timestamps=true",
            ],
        });

        // bazel-remote reads and writes cache blobs in the bucket using the task role.
        bucket.grantReadWrite(taskDefinition.taskRole);

        const serviceSecurityGroup = new SecurityGroup(this, "ServiceSecurityGroup", {
            vpc,
            allowAllOutbound: true,
        });

        const service = new FargateService(this, "Service", {
            cluster,
            taskDefinition,
            desiredCount: 1,
            // The lifecycle VPC has no NAT gateways, so the task needs a public IP to pull the
            // image from Docker Hub and reach S3. Consistent with how the GitHub runners run
            // in this VPC.
            assignPublicIp: true,
            vpcSubnets: {subnetType: SubnetType.PUBLIC},
            securityGroups: [serviceSecurityGroup],
        });

        const loadBalancerSecurityGroup = new SecurityGroup(this, "LoadBalancerSecurityGroup", {
            vpc,
            allowAllOutbound: true,
        });

        // Allow only the GitHub runner providers to reach the cache (HTTP and gRPC),
        // rather than the whole VPC.
        for (const runnerConnectable of runnerConnectables) {
            for (const port of [bazelRemoteCachePort, bazelRemoteCacheGrpcPort]) {
                loadBalancerSecurityGroup.connections.allowFrom(
                    runnerConnectable,
                    Port.tcp(port),
                    "Allow a GitHub runner to reach the Bazel remote cache",
                );
            }
        }

        // Allow the load balancer to reach the task (forwarded traffic and health checks)
        // on both the HTTP and gRPC ports. CDK does not auto-wire this for a
        // security-grouped NLB, so add it explicitly or the targets never become healthy.
        for (const port of [bazelRemoteCachePort, bazelRemoteCacheGrpcPort]) {
            serviceSecurityGroup.addIngressRule(
                loadBalancerSecurityGroup,
                Port.tcp(port),
                "Allow the internal load balancer to reach bazel-remote",
            );
        }

        const loadBalancer = new NetworkLoadBalancer(this, "LoadBalancer", {
            vpc,
            internetFacing: false,
            vpcSubnets: {subnetType: SubnetType.PUBLIC},
            securityGroups: [loadBalancerSecurityGroup],
            // The single task lives in one AZ but runners span all AZs, so route cross-zone to
            // the healthy target regardless of which AZ a runner hits.
            crossZoneEnabled: true,
        });

        const httpListener = loadBalancer.addListener("Listener", {
            port: bazelRemoteCachePort,
        });

        httpListener.addTargets("Target", {
            port: bazelRemoteCachePort,
            targets: [
                service.loadBalancerTarget({
                    containerName: container.containerName,
                    containerPort: bazelRemoteCachePort,
                }),
            ],
            healthCheck: {
                protocol: Protocol.HTTP,
                path: "/status",
            },
        });

        const grpcListener = loadBalancer.addListener("GrpcListener", {
            port: bazelRemoteCacheGrpcPort,
        });

        grpcListener.addTargets("GrpcTarget", {
            port: bazelRemoteCacheGrpcPort,
            targets: [
                service.loadBalancerTarget({
                    containerName: container.containerName,
                    containerPort: bazelRemoteCacheGrpcPort,
                }),
            ],
            // The gRPC port doesn't serve the HTTP `/status` endpoint, so health-check the
            // container's HTTP port instead. A healthy HTTP listener means the process is up
            // and serving gRPC too.
            healthCheck: {
                protocol: Protocol.HTTP,
                path: "/status",
                port: bazelRemoteCachePort.toString(),
            },
        });

        // Stable private DNS so `ci.bazelrc` can reference a fixed hostname instead of the
        // load balancer's generated DNS name.
        const hostedZone = new HostedZone(this, "HostedZone", {
            zoneName: "cyberworlds.internal",
            // Associating a VPC makes this a private hosted zone, only resolvable from within
            // the lifecycle VPC.
            vpcs: [vpc],
            comment: "Private DNS for services in the Cyberworlds lifecycle VPC",
        });

        new ARecord(this, "DnsRecord", {
            zone: hostedZone,
            recordName: "bazel-remote-cache",
            target: RecordTarget.fromAlias(new LoadBalancerTarget(loadBalancer)),
        });
    }
}
