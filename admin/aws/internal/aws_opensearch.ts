import {CustomResource, Duration} from "aws-cdk-lib";
import {IConnectable, Port, SubnetType} from "aws-cdk-lib/aws-ec2";
import {Effect, IGrantable, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Code, Function as LambdaFunction, Runtime} from "aws-cdk-lib/aws-lambda";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import {Domain, EngineVersion} from "aws-cdk-lib/aws-opensearchservice";
import {Provider} from "aws-cdk-lib/custom-resources";
import {Construct} from "constructs";
import crypto from "crypto";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {AwsVpc} from "~/admin/aws/internal/aws_vpc.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";

const opensearchDeployScriptLambdaDirectoryPath = joinPath(
    runfilesPath,
    "cyberworlds/admin/opensearch/deploy/deploy",
);

const opensearchDeployScriptLambdaIndexPath = joinPath(
    opensearchDeployScriptLambdaDirectoryPath,
    "index.mjs",
);

const opensearchDeployScriptLambdaIndexContents = await fs.readFile(
    opensearchDeployScriptLambdaIndexPath,
    "utf-8",
);

const opensearchDeployScriptLambdaIndexHash = crypto
    .createHash("sha256")
    .update(opensearchDeployScriptLambdaIndexContents)
    .digest("hex");

export class AwsOpensearch extends Construct {
    private readonly _domain: Domain;

    constructor(parentConstruct: Construct, vpc: AwsVpc) {
        super(parentConstruct, "Opensearch");

        this._domain = new Domain(this, "Domain", {
            vpc,
            // Only allow traffic to/from OpenSearch within our subnet.
            vpcSubnets: [{subnetType: SubnetType.PRIVATE_ISOLATED}],

            version: EngineVersion.OPENSEARCH_2_9,

            // Free tier OpenSearch instances. Should upgrade as we get real traffic.
            capacity: {
                dataNodes: 2,
                dataNodeInstanceType: "t3.small.search",
            },
            zoneAwareness: {
                enabled: true,
                availabilityZoneCount: 2,
            },

            logging: {
                appLogEnabled: true,
                slowSearchLogEnabled: true,
                slowIndexLogEnabled: true,
            },
        });

        // NOTE(calebmer): We instantiate a `LambdaFunction` directly instead of using
        // `NodejsLambda` since we bundle the code ourselves.
        const deployScript = new LambdaFunction(this, "DeployScript", {
            code: Code.fromAsset(opensearchDeployScriptLambdaDirectoryPath),
            handler: "index.handler",
            vpc,
            vpcSubnets: {subnetType: SubnetType.PRIVATE_ISOLATED},
            timeout: Duration.seconds(60),
            // TODO(calebmer): Node.js v20 is not currently supported as an AWS lambda
            // runtime.
            // https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
            runtime: Runtime.NODEJS_18_X,
            environment: {
                OPENSEARCH_HOST: this._domain.domainEndpoint,
            },
            // Don't retain deploy script logs forever.
            logRetention: RetentionDays.ONE_MONTH,
        });

        this._domain.connections.allowFrom(deployScript, Port.tcp(443));

        deployScript.addToRolePolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["es:*"],
                resources: [`${this._domain.domainArn}/*`],
            }),
        );

        const deployScriptProvider = new Provider(this, "DeployScriptProvider", {
            onEventHandler: deployScript,
        });

        const deployScriptResource = new CustomResource(this, "DeployScriptResource", {
            serviceToken: deployScriptProvider.serviceToken,
            properties: {
                // Re-run our deploy script whenever the script file itself changes. This means
                // the script will run more often than it needs to, but that's fine the script
                // should be idempotent.
                //
                // We could instead build some other hash of index settings and mappings and
                // only re-run when that changes as an optimization.
                deployScriptLambdaIndexHash: opensearchDeployScriptLambdaIndexHash,
            },
        });

        // Run our deploy script whenever the OpenSearch domain is created/updated.
        deployScriptResource.node.addDependency(this._domain);
    }

    public get opensearchHost() {
        return this._domain.domainEndpoint;
    }

    public grantTaskIndexesReadWrite(grantee: IGrantable) {
        this._domain.grantIndexReadWrite("tasks", grantee);
        this._domain.grantIndexReadWrite("task_collections", grantee);
    }

    public allowConnectionsFrom(other: IConnectable) {
        this._domain.connections.allowFrom(other, Port.tcp(443));
    }
}
