import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {AvatarModel} from "~/shared/avatar/avatar_schema.js";
import {createTestAvatarModel} from "~/shared/avatar/test_helpers/avatar_model_test_helpers.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AvatarId} from "~/shared/id/types/id_types.js";
import {AccountId, BotId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {
    createTestAccountModel,
    createTestAccountSpaceData,
} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

const testAccountId1 = generateId<AccountId>();
const testAccountId2 = generateId<AccountId>();
const testBotId = generateId<BotId>();
const avatarId1 = generateChronologicalId<AvatarId>();
const avatarId2 = generateChronologicalId<AvatarId>();
const avatarId3 = generateChronologicalId<AvatarId>();

const space1 = createTestAccountSpaceData({version: 1, role: "Member"});
const space2 = createTestAccountSpaceData({version: 3, role: "Admin"});
const avatar1 = createTestAvatarModel({version: 1, avatarId: avatarId1});
const avatar2 = createTestAvatarModel({version: 2, avatarId: avatarId2});
const avatar3 = createTestAvatarModel({version: 3, avatarId: avatarId3});

function createTestAccountModelWithoutSpaceData(
    options: Partial<{
        id: AccountId;
        version: number;
        name: string;
        nameVersion: number;
        botId: BotId | undefined;
        avatar: AvatarModel | null;
    }> = {},
): AccountModelWithoutSpaceData {
    return {
        id: testAccountId1,
        version: 1,
        name: "Test User",
        nameVersion: 1,
        botId: undefined,
        avatar: null,
        reactionCharacter: null,
        ...options,
    };
}

describe("mergeData", () => {
    describe("returns data1 when data1 is newer or equal", () => {
        test("returns data1 when data1 has higher version and higher space version with same avatar", () => {
            const avatar = createTestAvatarModel({version: 3, avatarId: avatarId1});
            const data1 = createTestAccountModel({
                version: 3,
                space: createTestAccountSpaceData({version: 2}),
                avatar: avatar,
            }).initialData;
            const data2 = createTestAccountModel({
                version: 2,
                space: createTestAccountSpaceData({version: 1}),
                avatar: avatar,
            }).initialData;

            const result = AccountModel.mergeData(data1, data2);

            expect(result).toBe(data1);
        });

        test("returns data1 when data1 has equal version and higher space version with newer avatar", () => {
            const data1 = createTestAccountModel({
                version: 2,
                space: createTestAccountSpaceData({version: 2}),
                avatar: createTestAvatarModel({version: 3, avatarId: avatarId1}),
            }).initialData;
            const data2 = createTestAccountModel({
                version: 2,
                space: createTestAccountSpaceData({version: 1}),
                avatar: createTestAvatarModel({version: 2, avatarId: avatarId2}),
            }).initialData;

            const result = AccountModel.mergeData(data1, data2);

            expect(result).toBe(data1);
        });

        test("returns data1 when data1 has higher version and equal space version with equal avatar", () => {
            const avatar = createTestAvatarModel({version: 2, avatarId: avatarId1});
            const data1 = createTestAccountModel({
                version: 3,
                space: createTestAccountSpaceData({version: 2}),
                avatar: avatar,
            }).initialData;
            const data2 = createTestAccountModel({
                version: 2,
                space: createTestAccountSpaceData({version: 2}),
                avatar: avatar,
            }).initialData;

            const result = AccountModel.mergeData(data1, data2);

            expect(result).toBe(data1);
        });
    });

    describe("returns data2 when data2 is newer", () => {
        test("returns data2 when data2 has higher version and higher space version with newer avatar", () => {
            const data1 = createTestAccountModel({
                version: 2,
                space: createTestAccountSpaceData({version: 1}),
                avatar: createTestAvatarModel({version: 2, avatarId: avatarId1}),
            }).initialData;
            const data2 = createTestAccountModel({
                version: 3,
                space: createTestAccountSpaceData({version: 2}),
                avatar: createTestAvatarModel({version: 3, avatarId: avatarId2}),
            }).initialData;

            const result = AccountModel.mergeData(data1, data2);

            expect(result).toBe(data2);
        });

        test("returns data2 when data2 has equal version and higher space version with same avatar", () => {
            const avatar = createTestAvatarModel({version: 2, avatarId: avatarId1});
            const data1 = createTestAccountModel({
                version: 2,
                space: createTestAccountSpaceData({version: 1}),
                avatar: avatar,
            }).initialData;
            const data2 = createTestAccountModel({
                version: 2,
                space: createTestAccountSpaceData({version: 2}),
                avatar: avatar,
            }).initialData;

            const result = AccountModel.mergeData(data1, data2);

            expect(result).toBe(data2);
        });
    });

    describe("merges space accounts when necessary", () => {
        test("merges account data from higher version with space data from higher space version", () => {
            const space1 = createTestAccountSpaceData({version: 1, role: "Member"});
            const space2 = createTestAccountSpaceData({version: 3, role: "Admin"});
            const avatar1 = createTestAvatarModel({version: 1, avatarId: avatarId1});
            const avatar2 = createTestAvatarModel({version: 2, avatarId: avatarId2});

            const data1 = createTestAccountModel({
                id: testAccountId1,
                name: "User 1",
                version: 3,
                space: space1,
                avatar: avatar2,
            }).initialData;
            const data2 = createTestAccountModel({
                id: testAccountId2,
                name: "User 2",
                version: 2,
                space: space2,
                avatar: avatar1,
            }).initialData;

            const result = AccountModel.mergeData(data1, data2);

            expect(result).not.toBe(data1);
            expect(result).not.toBe(data2);
            expect(result).toEqual(
                createTestAccountModel({
                    id: testAccountId1,
                    name: "User 1",
                    version: 3,
                    space: space2,
                    avatar: avatar2,
                }).initialData,
            );
        });

        test("merges with latest avatar when avatars have different versions", () => {
            const data1 = createTestAccountModel({
                id: testAccountId1,
                version: 2,
                space: space2,
                avatar: avatar1,
            }).initialData;
            const data2 = createTestAccountModel({
                id: testAccountId1,
                version: 1,
                space: space1,
                avatar: avatar3,
            }).initialData;

            const result = AccountModel.mergeData(data1, data2);

            expect(result).not.toBe(data1);
            expect(result).not.toBe(data2);
            expect(result).toEqual(
                createTestAccountModel({
                    id: testAccountId1,
                    version: 2,
                    space: space2,
                    avatar: avatar3,
                }).initialData,
            );
        });
    });

    describe("handles null avatars correctly", () => {
        test("prefers non-null avatar when one is null", () => {
            const data1 = createTestAccountModel({
                id: testAccountId1,
                version: 2,
                space: space2,
                avatar: null,
            }).initialData;
            const data2 = createTestAccountModel({
                id: testAccountId1,
                version: 1,
                space: space1,
                avatar: avatar2,
            }).initialData;

            const result = AccountModel.mergeData(data1, data2);

            expect(result).toEqual(
                createTestAccountModel({
                    id: testAccountId1,
                    version: 2,
                    space: space2,
                    avatar: avatar2,
                }).initialData,
            );
        });

        test("returns data1 when both avatars are null and data1 has higher versions", () => {
            const data1 = createTestAccountModel({
                version: 2,
                space: space2,
                avatar: null,
            }).initialData;
            const data2 = createTestAccountModel({
                version: 1,
                space: space1,
                avatar: null,
            }).initialData;

            const result = AccountModel.mergeData(data1, data2);

            expect(result).toBe(data1);
        });
    });

    describe("handles bot accounts correctly", () => {
        test("preserves bot data in merged result", () => {
            const data1 = createTestAccountModel({
                version: 2,
                id: testAccountId1,
                botId: testBotId,
                space: space1,
                avatar: avatar1,
            }).initialData;
            const data2 = createTestAccountModel({
                version: 1,
                id: testAccountId1,
                botId: undefined,
                space: space2,
                avatar: avatar2,
            }).initialData;

            const result = AccountModel.mergeData(data1, data2);

            expect(result).toEqual(
                createTestAccountModel({
                    id: testAccountId1,
                    version: 2,
                    botId: testBotId,
                    space: space2,
                    avatar: avatar2,
                }).initialData,
            );
        });
    });

    describe("handles name version correctly", () => {
        test("preserves nameVersion from higher version account data", () => {
            const data1 = createTestAccountModel({
                version: 3,
                name: "Updated Name",
                nameVersion: 5,
                space: createTestAccountSpaceData({version: 1}),
            }).initialData;
            const data2 = createTestAccountModel({
                version: 2,
                name: "Old Name",
                nameVersion: 3,
                space: createTestAccountSpaceData({version: 2}),
            }).initialData;

            const result = AccountModel.mergeData(data1, data2);

            expect(result.name).toEqual("Updated Name"); // From data1
            expect(result.nameVersion).toEqual(5); // From data1
            expect(result.space.version).toEqual(2); // From data2
        });
    });
});

describe("mergeDataWithoutSpace", () => {
    describe("returns data1 when data1 is newer or equal", () => {
        test("returns data1 when data1 has higher version with same avatar", () => {
            const avatar = createTestAvatarModel({version: 2, avatarId: avatarId1});
            const data1 = createTestAccountModel({
                version: 3,
                avatar: avatar,
            }).initialData;
            const data2 = createTestAccountModelWithoutSpaceData({
                version: 2,
                avatar: avatar,
            });

            const result = AccountModel.mergeDataWithoutSpace(data1, data2);

            expect(result).toBe(data1);
        });

        test("returns data1 when data1 has equal version with newer avatar", () => {
            const data1 = createTestAccountModel({
                version: 2,
                avatar: createTestAvatarModel({version: 3, avatarId: avatarId1}),
            }).initialData;
            const data2 = createTestAccountModelWithoutSpaceData({
                version: 2,
                avatar: createTestAvatarModel({version: 2, avatarId: avatarId2}),
            });

            const result = AccountModel.mergeDataWithoutSpace(data1, data2);

            expect(result).toBe(data1);
        });

        test("returns data1 when data1 has higher version with older avatar", () => {
            const data1 = createTestAccountModel({
                version: 3,
                avatar: createTestAvatarModel({version: 1, avatarId: avatarId1}),
            }).initialData;
            const data2 = createTestAccountModelWithoutSpaceData({
                version: 2,
                avatar: createTestAvatarModel({version: 2, avatarId: avatarId2}),
            });

            const result = AccountModel.mergeDataWithoutSpace(data1, data2);

            expect(result).not.toBe(data1);
            expect(result.version).toEqual(3); // From data1 (higher version)
            expect(result.space).toEqual(data1.space); // Space data preserved from data1
            expect(result.avatar?.avatarId).toEqual(avatarId2); // From data2 (newer avatar)
            expect(result.avatar?.version).toEqual(2); // From data2 (newer avatar)
        });
    });

    describe("creates merged data when merging is required", () => {
        test("merges account data from higher version with latest avatar", () => {
            const originalSpace = createTestAccountSpaceData({
                version: 5,
                addedTime: new Date("2024-01-01"),
                state: {type: "Active" as const, activatedTime: new Date("2024-01-01")},
                role: "Admin" as const,
            });

            const data1 = createTestAccountModel({
                id: testAccountId1,
                name: "User 1",
                version: 3,
                nameVersion: 4,
                space: originalSpace,
                avatar: createTestAvatarModel({version: 2, avatarId: avatarId1}),
            }).initialData;

            const data2 = createTestAccountModelWithoutSpaceData({
                id: testAccountId2,
                name: "User 2",
                version: 2,
                nameVersion: 3,
                avatar: createTestAvatarModel({version: 4, avatarId: avatarId2}),
            });

            const result = AccountModel.mergeDataWithoutSpace(data1, data2);

            expect(result).not.toBe(data1);
            expect(result.id).toEqual(testAccountId1); // From data1 (higher version)
            expect(result.name).toEqual("User 1"); // From data1 (higher version)
            expect(result.version).toEqual(3); // From data1 (higher version)
            expect(result.nameVersion).toEqual(4); // From data1 (higher version)
            expect(result.space).toEqual(originalSpace); // Space data preserved from data1
            expect(result.avatar?.avatarId).toEqual(avatarId2); // From data2 (newer avatar)
            expect(result.avatar?.version).toEqual(4); // From data2 (newer avatar)
        });

        test("uses data2 account data when data2 has higher version", () => {
            const originalSpace = {
                version: 3,
                addedTime: new Date("2024-01-01"),
                state: {type: "Active" as const, activatedTime: new Date("2024-01-01")},
                role: "Member" as const,
            };

            const data1 = createTestAccountModel({
                version: 2,
                name: "User 1",
                nameVersion: 2,
                space: originalSpace,
                botId: undefined,
                avatar: createTestAvatarModel({version: 3, avatarId: avatarId1}),
            }).initialData;

            const data2 = createTestAccountModelWithoutSpaceData({
                version: 4,
                name: "User 2",
                nameVersion: 5,
                botId: testBotId,
                avatar: createTestAvatarModel({version: 1, avatarId: avatarId2}),
            });

            const result = AccountModel.mergeDataWithoutSpace(data1, data2);

            expect(result).not.toBe(data1);
            expect(result.id).toEqual(data2.id); // From data2 (higher version)
            expect(result.name).toEqual("User 2"); // From data2 (higher version)
            expect(result.version).toEqual(4); // From data2 (higher version)
            expect(result.nameVersion).toEqual(5); // From data2 (higher version)
            expect(result.botId).toEqual(testBotId); // From data2 (higher version)
            expect(result.space).toEqual(originalSpace); // Space data preserved from data1
            expect(result.avatar?.avatarId).toEqual(avatarId1); // From data1 (newer avatar)
            expect(result.avatar?.version).toEqual(3); // From data1 (newer avatar)
        });
    });

    describe("handles null avatars correctly", () => {
        test("prefers non-null avatar when data1 has null and data2 has avatar", () => {
            const data1 = createTestAccountModel({
                version: 3,
                avatar: null,
            }).initialData;
            const data2 = createTestAccountModelWithoutSpaceData({
                version: 2,
                avatar: createTestAvatarModel({version: 2, avatarId: avatarId1}),
            });

            const result = AccountModel.mergeDataWithoutSpace(data1, data2);

            expect(result.avatar?.avatarId).toEqual(avatarId1);
            expect(result.avatar?.version).toEqual(2);
            expect(result.space).toEqual(data1.space); // Space preserved from data1
        });

        test("prefers non-null avatar when data2 has null and data1 has avatar", () => {
            const data1 = createTestAccountModel({
                version: 2,
                avatar: createTestAvatarModel({version: 2, avatarId: avatarId1}),
            }).initialData;
            const data2 = createTestAccountModelWithoutSpaceData({
                version: 3,
                avatar: null,
            });

            const result = AccountModel.mergeDataWithoutSpace(data1, data2);

            expect(result.version).toEqual(3); // From data2 (higher version)
            expect(result.avatar?.avatarId).toEqual(avatarId1); // From data1 (non-null avatar)
            expect(result.space).toEqual(data1.space); // Space preserved from data1
        });

        test("handles both avatars being null", () => {
            const data1 = createTestAccountModel({
                version: 3,
                avatar: null,
            }).initialData;
            const data2 = createTestAccountModelWithoutSpaceData({
                version: 2,
                avatar: null,
            });

            const result = AccountModel.mergeDataWithoutSpace(data1, data2);

            expect(result).toBe(data1);
            expect(result.avatar).toBeNull();
        });
    });

    describe("preserves space data from data1", () => {
        test("always preserves space data regardless of which account data is used", () => {
            const originalSpace = createTestAccountSpaceData({
                version: 10,
                addedTime: new Date("2023-05-15"),
                state: {type: "Active" as const, activatedTime: new Date("2023-05-15")},
                role: "Owner" as const,
            });

            const data1 = createTestAccountModel({
                version: 2,
                name: "User 1",
                space: originalSpace,
                avatar: createTestAvatarModel({version: 1, avatarId: avatarId1}),
            }).initialData;

            const data2 = createTestAccountModelWithoutSpaceData({
                version: 5, // Higher version
                name: "User 2",
                avatar: createTestAvatarModel({version: 3, avatarId: avatarId2}),
            });

            const result = AccountModel.mergeDataWithoutSpace(data1, data2);

            // Should use data2 for account data but preserve data1's space
            expect(result.name).toEqual("User 2"); // From data2
            expect(result.version).toEqual(5); // From data2
            expect(result.space).toEqual(originalSpace); // Always from data1
            expect(result.avatar?.avatarId).toEqual(avatarId2); // From data2 (newer avatar)
        });
    });

    describe("edge cases", () => {
        test("handles identical versions with identical avatars", () => {
            const avatar = createTestAvatarModel({version: 2, avatarId: avatarId1});
            const data1 = createTestAccountModel({
                version: 2,
                avatar: avatar,
            }).initialData;
            const data2 = createTestAccountModelWithoutSpaceData({
                version: 2,
                avatar: avatar,
            });

            const result = AccountModel.mergeDataWithoutSpace(data1, data2);

            expect(result).toBe(data1); // Tie-breaking returns data1
        });

        test("handles version 0 accounts", () => {
            const data1 = createTestAccountModel({
                version: 0,
                avatar: createTestAvatarModel({version: 1, avatarId: avatarId1}),
            }).initialData;
            const data2 = createTestAccountModelWithoutSpaceData({
                version: 1,
                avatar: createTestAvatarModel({version: 0, avatarId: avatarId2}),
            });

            const result = AccountModel.mergeDataWithoutSpace(data1, data2);

            expect(result.version).toEqual(1); // From data2 (higher version)
            expect(result.avatar?.avatarId).toEqual(avatarId1); // From data1 (newer avatar)
            expect(result.space).toEqual(data1.space); // Space preserved from data1
        });
    });
});
