import {
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import {Context, S3Event, S3Handler} from "aws-lambda";
import {Readable} from "stream";
import {createGunzip} from "zlib";
import {
    AccountDimension,
    AccountEmailAddressDimension,
    AccountSettingsKeys,
    SpaceAccountDimension,
    SpaceAttributesKeys,
    SpaceDimension,
    SpaceEmailDomainDimension,
    SpaceWelcomePackageKeys,
    StripeCustomerDimension,
    accountEmailAddressesDimensionS3Prefix,
    accountsDimensionS3Prefix,
    spaceAccountsDimensionS3Prefix,
    spaceEmailDomainsDimensionS3Prefix,
    spacesDimensionS3Prefix,
    stripeCustomersDimensionS3Prefix,
} from "~/admin/analytics/analytics_mirror_export/dimension_table_schemas.js";
import {withLambdaTimeout} from "~/server/lambda/helpers/with_lambda_timeout.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";

const s3Client = new S3Client({});

// The bucket where we store dimension tables (same as observability logs bucket)
const outputBucket = assertExists(
    process.env.OUTPUT_BUCKET,
    "OUTPUT_BUCKET environment variable is required",
);

const outputPrefix = assertExists(
    process.env.OUTPUT_PREFIX,
    "OUTPUT_PREFIX environment variable is required",
);

const accountEmailAddressesDimensionS3Path = `${outputPrefix}/${accountEmailAddressesDimensionS3Prefix}`;
const accountsDimensionS3Path = `${outputPrefix}/${accountsDimensionS3Prefix}`;
const spaceAccountsDimensionS3Path = `${outputPrefix}/${spaceAccountsDimensionS3Prefix}`;
const spaceEmailDomainsDimensionS3Path = `${outputPrefix}/${spaceEmailDomainsDimensionS3Prefix}`;
const spacesDimensionS3Path = `${outputPrefix}/${spacesDimensionS3Prefix}`;
const stripeCustomersDimensionS3Path = `${outputPrefix}/${stripeCustomersDimensionS3Prefix}`;

/**
 * Collected records for each dimension table, keyed by output prefix.
 */
type DimensionRecords = {
    // Maps output S3 prefix to records
    [prefix: string]: Array<
        | AccountDimension
        | SpaceDimension
        | AccountEmailAddressDimension
        | StripeCustomerDimension
        | SpaceAccountDimension
        | SpaceEmailDomainDimension
    >;
};

/**
 * Intermediate data for merging 1:1 items.
 * Maps entity ID to partial record data.
 */
type MergeData = {
    accountAttributes: Map<string, Omit<AccountDimension, AccountSettingsKeys>>;
    accountSettings: Map<string, Pick<AccountDimension, AccountSettingsKeys>>;
    spaceAttributes: Map<string, Pick<SpaceDimension, SpaceAttributesKeys>>;
    spaceWelcomePackage: Map<string, Pick<SpaceDimension, SpaceWelcomePackageKeys>>;
};

/**
 * Lambda handler that transforms DynamoDB export data to JSONL format for Athena.
 *
 * This Lambda is triggered by S3 events when a DynamoDB export manifest file is written.
 * It reads the export data files, filters to allowlisted columns, and writes JSONL to
 * the dimension tables location.
 *
 * The export manifest path format is:
 * s3://{bucket}/{prefix}/AWSDynamoDB/{export-id}/manifest-files.json
 *
 * For more on the output format from DynamoDb exports, see:
 * https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/S3DataExport.Output.html
 *
 * IMPORTANT: This is really brittle -- it's not type safe. We export raw dynamoDB items,
 * so we don't get to take advantage of the schema validation that we do for other data.
 * So if we update a dynamo item's schema, we'll have to update this export manually.
 */
export const handler: S3Handler = async (event: S3Event, context: Context) => {
    await withLambdaTimeout(context, new AbortController(), async () => {
        // eslint-disable-next-line no-console
        console.log("Event for manual retries: ", JSON.stringify(event, null, 2));

        for (const record of event.Records) {
            const bucket = record.s3.bucket.name;
            const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

            // Extract table name from the export path
            // Path format: exports/{table-name}/AWSDynamoDB/{export-id}/manifest-files.json
            const tableName = extractTableNameFromPath(key);
            if (!tableName) {
                // eslint-disable-next-line no-console
                console.log(`Skipping non-table export: ${key}`);
                continue;
            }

            // eslint-disable-next-line no-console
            console.log(`Processing export for table: ${tableName}`);

            // Get the data files from the manifest
            const dataFilesPrefix = key.replace("manifest-files.json", "data/");
            const dataFiles = await listDataFiles(bucket, dataFilesPrefix);

            // eslint-disable-next-line no-console
            console.log(`Found ${dataFiles.length} data files`);

            // Initialize records collectors and merge data
            const dimensionRecords: DimensionRecords = {};
            const mergeData: MergeData = {
                accountAttributes: new Map(),
                accountSettings: new Map(),
                spaceAttributes: new Map(),
                spaceWelcomePackage: new Map(),
            };

            // Process all data files and collect records
            for (const dataFile of dataFiles) {
                await processDataFile(bucket, dataFile, tableName, dimensionRecords, mergeData);
            }

            // Merge 1:1 items and add to dimension records
            mergeAccountRecords(dimensionRecords, mergeData);
            mergeSpaceRecords(dimensionRecords, mergeData);

            // Write JSONL to dimension tables location for each collected table
            for (const [outputPrefix, records] of Object.entries(dimensionRecords)) {
                if (records.length > 0) {
                    await writeJsonl(outputBucket, `${outputPrefix}/data.json`, records);
                    // eslint-disable-next-line no-console
                    console.log(
                        `Wrote ${records.length} records to s3://${outputBucket}/${outputPrefix}/data.json`,
                    );
                }
            }
        }
    });
};

function extractTableNameFromPath(key: string): string | null {
    // Path format: exports/{table-name}/AWSDynamoDB/{export-id}/manifest-files.json
    const match = key.match(/^exports\/([^/]+)\/AWSDynamoDB\//);
    return match?.[1] ?? null;
}

/**
 * Merges Account#Attributes and Account#Settings into merged account records.
 */
function mergeAccountRecords(dimensionRecords: DimensionRecords, mergeData: MergeData): void {
    const mergedAccounts: Array<AccountDimension> = [];

    // Start with all accounts from Attributes (primary source)
    for (const [accountId, attributes] of mergeData.accountAttributes) {
        const settings: Pick<AccountDimension, AccountSettingsKeys> =
            mergeData.accountSettings.get(accountId) ??
            ({} as Pick<AccountDimension, AccountSettingsKeys>);
        mergedAccounts.push({
            ...attributes,
            ...settings,
        });
    }

    if (mergedAccounts.length > 0) {
        dimensionRecords[accountsDimensionS3Path] = mergedAccounts;
    }
}

/**
 * Merges Space#Attributes and Space#WelcomePackage into merged space records.
 */
function mergeSpaceRecords(dimensionRecords: DimensionRecords, mergeData: MergeData): void {
    const mergedSpaces: Array<SpaceDimension> = [];

    // Start with all spaces from Attributes (primary source)
    for (const [spaceId, attributes] of mergeData.spaceAttributes) {
        const welcomePackage: Pick<SpaceDimension, SpaceWelcomePackageKeys> =
            mergeData.spaceWelcomePackage.get(spaceId) ??
            ({} as Pick<SpaceDimension, SpaceWelcomePackageKeys>);
        mergedSpaces.push({
            ...attributes,
            ...welcomePackage,
        });
    }

    if (mergedSpaces.length > 0) {
        dimensionRecords[spacesDimensionS3Path] = mergedSpaces;
    }
}

async function listDataFiles(bucket: string, prefix: string): Promise<Array<string>> {
    const files: Array<string> = [];
    let continuationToken: string | undefined;

    do {
        const response = await s3Client.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
            }),
        );

        for (const object of response.Contents ?? []) {
            if (object.Key?.endsWith(".json.gz")) {
                files.push(object.Key);
            }
        }

        continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return files;
}

async function processDataFile(
    bucket: string,
    key: string,
    tableName: string,
    dimensionRecords: DimensionRecords,
    mergeData: MergeData,
): Promise<void> {
    const response = await s3Client.send(
        new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        }),
    );

    const body = response.Body;
    if (!body) {
        return;
    }

    // DynamoDB export files are gzipped JSONL
    const stream = body as Readable;
    const gunzip = createGunzip();
    const decompressed = stream.pipe(gunzip);

    const chunks: Array<Uint8Array> = [];
    for await (const chunk of decompressed) {
        chunks.push(new Uint8Array(chunk));
    }
    const content = Buffer.concat(chunks).toString("utf-8");

    for (const line of content.split("\n")) {
        if (!line.trim()) continue;

        try {
            const item = JSON.parse(line);
            transformDynamoDbItem(item, tableName, dimensionRecords, mergeData);
        } catch {
            // eslint-disable-next-line no-console
            console.warn(`Failed to parse line: ${line.substring(0, 100)}...`);
        }
    }
}

/**
 * Transforms a DynamoDB JSON item and adds it to the appropriate dimension records
 * or merge data collection.
 */
function transformDynamoDbItem(
    item: {Item: Record<string, DynamoDbAttributeValue>},
    tableName: string,
    dimensionRecords: DimensionRecords,
    mergeData: MergeData,
): void {
    const dynamoItem = item.Item;
    if (!dynamoItem) return;

    // Parse the partition key and sort key to determine the item type
    const partitionKey = parseRequiredAttributeValue(dynamoItem.partitionKey);
    const sortKey = parseRequiredAttributeValue(dynamoItem.sortKey);

    if (typeof partitionKey !== "string" || typeof sortKey !== "string") {
        return;
    }

    if (tableName === "Accounts") {
        transformAccountsTableItem(dynamoItem, partitionKey, sortKey, dimensionRecords, mergeData);
    } else if (tableName === "Spaces") {
        transformSpacesTableItem(dynamoItem, partitionKey, sortKey, dimensionRecords, mergeData);
    }
}

function transformAccountsTableItem(
    item: Record<string, DynamoDbAttributeValue>,
    partitionKey: string,
    sortKey: string,
    dimensionRecords: DimensionRecords,
    mergeData: MergeData,
): void {
    // Account#Attributes -> merge into accounts
    if (partitionKey.startsWith("Account#") && sortKey === "Attributes") {
        const accountId = partitionKey.replace("Account#", "");

        // Parse the bot field if present
        const botValue = parseAttributeValue<{spaceId: string; botId: string} | undefined>(
            item.bot,
        );
        let botSpaceId: string | null = null;
        let botId: string | null = null;
        if (botValue && typeof botValue === "object" && !Array.isArray(botValue)) {
            const bot = botValue;
            botSpaceId = typeof bot.spaceId === "string" ? bot.spaceId : null;
            botId = typeof bot.botId === "string" ? bot.botId : null;

            if ((botSpaceId && !botId) || (botId && !botSpaceId)) {
                throw new InvalidArgumentError(
                    "Invalid bot field: both spaceId and botId must be present",
                );
            }
        }

        mergeData.accountAttributes.set(accountId, {
            id: accountId,
            name: parseRequiredAttributeValue<string>(item.name),
            plan: parseAttributeValue<string>(item.plan),
            created_time: parseRequiredAttributeValue<string>(item.createdTime),
            has_internal_access: parseAttributeValue<boolean>(item.hasInternalAccess),
            has_not_signed_up: parseAttributeValue<boolean>(item.hasNotSignedUp),
            bot_space_id: botSpaceId ?? undefined,
            bot_id: botId ?? undefined,
        });
        return;
    }

    // Account#Settings -> merge into accounts
    if (partitionKey.startsWith("Account#") && sortKey === "Settings") {
        const accountId = partitionKey.replace("Account#", "");

        mergeData.accountSettings.set(accountId, {
            last_opened_space_id: parseAttributeValue<string>(item.lastOpenedSpaceId),
            observed_time_zone: parseAttributeValue<TimeZone>(item.observedTimeZone) ?? null,
        });
        return;
    }

    // AccountEmailAddress#Attributes -> account_email_addresses
    if (partitionKey.startsWith("AccountEmailAddress#") && sortKey === "Attributes") {
        const emailAddress = partitionKey.replace("AccountEmailAddress#", "");

        const record: AccountEmailAddressDimension = {
            email_address: emailAddress,
            account_id: parseRequiredAttributeValue<string>(item.accountId),
            created_time: parseRequiredAttributeValue<string>(item.createdTime),
            is_verified: parseRequiredAttributeValue<boolean>(item.isVerified),
        };

        if (!dimensionRecords[accountEmailAddressesDimensionS3Path]) {
            dimensionRecords[accountEmailAddressesDimensionS3Path] = [];
        }
        dimensionRecords[accountEmailAddressesDimensionS3Path].push(record);
        return;
    }

    // StripeCustomer#Attributes -> stripe_customers
    if (partitionKey.startsWith("StripeCustomer#") && sortKey === "Attributes") {
        const stripeCustomerId = partitionKey.replace("StripeCustomer#", "");

        const record: StripeCustomerDimension = {
            stripe_customer_id: stripeCustomerId,
            account_id: parseRequiredAttributeValue<string>(item.accountId),
        };

        if (!dimensionRecords[stripeCustomersDimensionS3Path]) {
            dimensionRecords[stripeCustomersDimensionS3Path] = [];
        }
        dimensionRecords[stripeCustomersDimensionS3Path].push(record);
        return;
    }
}

function transformSpacesTableItem(
    item: Record<string, DynamoDbAttributeValue>,
    partitionKey: string,
    sortKey: string,
    dimensionRecords: DimensionRecords,
    mergeData: MergeData,
): void {
    // Space#Attributes -> merge into spaces
    if (partitionKey.startsWith("Space#") && sortKey === "Attributes") {
        const spaceId = partitionKey.replace("Space#", "");

        mergeData.spaceAttributes.set(spaceId, {
            id: spaceId,
            name: parseRequiredAttributeValue<string>(item.name),
            created_time: parseRequiredAttributeValue<string>(item.createdTime),
        });
        return;
    }

    // Space#WelcomePackage -> merge into spaces
    if (partitionKey.startsWith("Space#") && sortKey === "WelcomePackage") {
        const spaceId = partitionKey.replace("Space#", "");

        mergeData.spaceWelcomePackage.set(spaceId, {
            welcome_package_general_channel_id: parseRequiredAttributeValue<string>(
                item.generalChannelId,
            ),
            welcome_package_random_channel_id: parseRequiredAttributeValue<string>(
                item.randomChannelId,
            ),
            welcome_package_chat_gpt_bot_account_id:
                parseAttributeValue(item.chatGptBotAccountId) ?? null,
        });
        return;
    }

    // Space#Account -> space_accounts
    if (partitionKey.startsWith("Space#") && sortKey.startsWith("Account#")) {
        const spaceId = partitionKey.replace("Space#", "");
        const accountId = sortKey.replace("Account#", "");

        // Parse state union type
        const stateValue = parseAttributeValue(item.removal);
        let stateType: string | null = null;

        if (stateValue && typeof stateValue === "object" && !Array.isArray(stateValue)) {
            const state = stateValue as Record<string, unknown>;
            stateType = typeof state.type === "string" ? state.type : null;
        }

        const record: SpaceAccountDimension = {
            space_id: spaceId,
            account_id: accountId,
            role: parseRequiredAttributeValue<string>(item.role),
            added_time: parseRequiredAttributeValue<string>(item.addedTime),
            state: stateType ?? "unknown",
        };

        if (!dimensionRecords[spaceAccountsDimensionS3Path]) {
            dimensionRecords[spaceAccountsDimensionS3Path] = [];
        }
        dimensionRecords[spaceAccountsDimensionS3Path].push(record);
        return;
    }

    // AutoAddAccountsFromEmailDomain#Space -> space_email_domains
    if (
        partitionKey.startsWith("AutoAddAccountsFromEmailDomain#") &&
        sortKey.startsWith("Space#")
    ) {
        const emailDomain = partitionKey.replace("AutoAddAccountsFromEmailDomain#", "");
        const spaceId = sortKey.replace("Space#", "");

        const record: SpaceEmailDomainDimension = {
            space_id: spaceId,
            email_domain: emailDomain,
            is_enabled: parseRequiredAttributeValue<boolean>(item.isEnabled),
        };

        if (!dimensionRecords[spaceEmailDomainsDimensionS3Path]) {
            dimensionRecords[spaceEmailDomainsDimensionS3Path] = [];
        }
        dimensionRecords[spaceEmailDomainsDimensionS3Path].push(record);
        return;
    }
}

type DynamoDbAttributeValue =
    | {S: string}
    | {N: string}
    | {B: string}
    | {SS: Array<string>}
    | {NS: Array<string>}
    | {BS: Array<string>}
    | {M: Record<string, DynamoDbAttributeValue>}
    | {L: Array<DynamoDbAttributeValue>}
    | {NULL: true}
    | {BOOL: boolean};

function parseAttributeValue<T>(value: DynamoDbAttributeValue | undefined): T | undefined {
    if (!value) return undefined;

    if ("S" in value) return value.S as T;
    if ("N" in value) return parseFloat(value.N) as T;
    if ("B" in value) return value.B as T;
    if ("SS" in value) return value.SS as T;
    if ("NS" in value) return value.NS.map(n => parseFloat(n)) as T;
    if ("BS" in value) return value.BS as T;
    if ("BOOL" in value) return value.BOOL as T;
    if ("NULL" in value) return null as T;
    if ("L" in value) return value.L.map(item => parseAttributeValue<T>(item)) as T;
    if ("M" in value) {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value.M)) {
            result[key] = parseAttributeValue(val);
        }
        return result as T;
    }

    return undefined;
}

function parseRequiredAttributeValue<T>(value: DynamoDbAttributeValue | undefined): T {
    const parsed = parseAttributeValue(value);
    assert(parsed);

    return parsed as T;
}

async function writeJsonl(
    bucket: string,
    key: string,
    records: Array<Record<string, unknown>>,
): Promise<void> {
    const jsonl = records.map(record => JSON.stringify(record)).join("\n");

    await s3Client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: jsonl,
            ContentType: "application/jsonl",
        }),
    );
}
