import {CustomResource, Duration} from "aws-cdk-lib";
import {EbsDeviceVolumeType, IConnectable, Port, SubnetType} from "aws-cdk-lib/aws-ec2";
import {Effect, IGrantable, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Code, Function as LambdaFunction, Runtime} from "aws-cdk-lib/aws-lambda";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import {Domain, EngineVersion} from "aws-cdk-lib/aws-opensearchservice";
import {Provider} from "aws-cdk-lib/custom-resources";
import {Construct} from "constructs";
import crypto from "crypto";
import {join as joinPath} from "path";
import {AwsVpc} from "~/admin/aws/internal/aws_vpc.js";
import {crawlOpensearchIndexes} from "~/admin/crawl/crawl.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";

const opensearchDeployScriptLambdaRelativePath =
    process.env.CDK_LITE === "true"
        ? "cyberworlds/admin/aws/empty_lambda"
        : "cyberworlds/admin/opensearch/deploy_script/deploy_script";

const opensearchDeployScriptLambdaPath = joinPath(
    runfilesPath,
    `${opensearchDeployScriptLambdaRelativePath}.zip`,
);

const opensearchDeployScriptLambdaHandler = `${opensearchDeployScriptLambdaRelativePath}.handler`;

function getSha256Hash(string: string): string {
    const hash = crypto.createHash("sha256");
    hash.update(string);
    return hash.digest("hex");
}

export class AwsOpensearch {
    private readonly _domain: Domain;
    private readonly _indexNames: ReadonlyArray<string>;

    private constructor(domain: Domain, indexNames: ReadonlyArray<string>) {
        this._domain = domain;
        this._indexNames = indexNames;
    }

    public static async new(parentConstruct: Construct, vpc: AwsVpc) {
        const construct = new Construct(parentConstruct, "Opensearch");

        const indexes = await crawlOpensearchIndexes();
        const indexNames = indexes.map(index => index.name);
        const indexesHash = getSha256Hash(JSON.stringify(indexes.map(index => index.config)));

        const domain = new Domain(construct, "Domain", {
            vpc,
            // Only allow traffic to/from OpenSearch within our subnet.
            vpcSubnets: [{subnetType: SubnetType.PRIVATE_ISOLATED}],
            domainName: "cyberworlds-search",
            version: EngineVersion.openSearch("2.19"),
            enforceHttps: true,
            enableVersionUpgrade: true,
            encryptionAtRest: {enabled: true},
            nodeToNodeEncryption: true,
            capacity: {
                masterNodes: 3,
                masterNodeInstanceType: "m7g.medium.search",
                dataNodes: 2,
                dataNodeInstanceType: "m7g.large.search",
            },
            ebs: {
                volumeType: EbsDeviceVolumeType.GP3,
                volumeSize: 60,
            },
            zoneAwareness: {
                enabled: true,
                availabilityZoneCount: 2,
            },
            logging: {
                slowSearchLogEnabled: true,
                slowIndexLogEnabled: true,
                appLogEnabled: true,
            },
        });

        // OpenSearch deploy script:
        //
        // NOTE(calebmer): We doesn't use the [CloudFormation
        // `AWS::OpenSearchServerless::Index` resource][1] because that resource
        // provides very little mappings/settings configuration options. Instead we
        // have a custom CloudFormation resource that runs an AWS lambda deploy script.
        //
        // [1]: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-opensearchserverless-index.html
        {
            // NOTE(calebmer): We instantiate a `LambdaFunction` directly instead of using
            // `NodejsLambda` since we bundle the code ourselves.
            const deployScript = new LambdaFunction(construct, "DeployScript", {
                code: Code.fromAsset(opensearchDeployScriptLambdaPath),
                handler: opensearchDeployScriptLambdaHandler,
                vpc,
                vpcSubnets: {subnetType: SubnetType.PRIVATE_ISOLATED},
                timeout: Duration.seconds(120),
                // TODO(calebmer): Node.js v20 is not currently supported as an AWS lambda
                // runtime.
                // https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
                runtime: Runtime.NODEJS_18_X,
                environment: {
                    OPENSEARCH_DOMAIN_ENDPOINT: domain.domainEndpoint,
                },
                // Don't retain deploy script logs forever.
                logRetention: RetentionDays.ONE_MONTH,
            });

            domain.connections.allowFrom(deployScript, Port.tcp(443));

            deployScript.addToRolePolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["es:*"],
                    resources: [`${domain.domainArn}/*`],
                }),
            );

            const deployScriptProvider = new Provider(construct, "DeployScriptProvider", {
                onEventHandler: deployScript,
            });

            const deployScriptResource = new CustomResource(construct, "DeployScriptResource", {
                serviceToken: deployScriptProvider.serviceToken,
                properties: {
                    // Re-run our deploy script whenever the config for an OpenSearch index changes.
                    // The script should be idempotent so will not change any previously deployed
                    // OpenSearch indexes.
                    indexesHash,
                },
            });

            // The `domain` must be created before the resource runs.
            deployScriptResource.node.addDependency(domain);
        }

        return new AwsOpensearch(domain, indexNames);
    }

    public get domainEndpoint() {
        return this._domain.domainEndpoint;
    }

    public allowConnectionsFrom(other: IConnectable) {
        this._domain.connections.allowFrom(other, Port.tcp(443));
    }

    public grantReadWriteData(grantee: IGrantable) {
        for (const indexName of this._indexNames) {
            this._domain.grantIndexReadWrite(indexName, grantee);
        }

        // Allow bulk writing documents or bulk reading documents. This could allow you
        // to bulk read/write documents outside of the indexes specified above! Be
        // careful when adding indexes to this domain.
        this._domain.grantPathReadWrite("_bulk", grantee);
        this._domain.grantPathReadWrite("_mget", grantee);
    }
}
