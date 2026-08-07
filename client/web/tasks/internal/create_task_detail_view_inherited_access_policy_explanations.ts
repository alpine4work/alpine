import {defaultAccessLevelText} from "~/client/web/navigation/access_level_text.js";
import {InheritedAccessPolicyExplanations} from "~/client/web/navigation/inherited_access_policy_explanations.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {hasAccessLevel} from "~/shared/access/access_policy.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function createTaskDetailViewInheritedAccessPolicyExplanations({
    space,
    taskSubscription,
}: {
    space: SpaceModel;
    taskSubscription: TaskClientTaskSubscription | null;
}): InheritedAccessPolicyExplanations {
    return {
        DeleteDefaultGrant: () => {
            const task = taskSubscription?.taskEntryStore.getSnapshot().task;

            const collections = task?.getCollections().getArray() ?? emptyArray;
            const noun = task?.getLayout() === "Project" ? "project" : "task";

            const firstCollectionWithDefaultGrant = findMapIterable(
                collections,
                ({collectionId}) => {
                    const collection = taskSubscription
                        ?.getReferencedCollectionEntryStore(collectionId)
                        .getSnapshot().collection;
                    if (!collection) return;

                    const collectionAccessPolicy = taskSubscription.store
                        .getCollectionResolvedAccessPolicy(collection)
                        .getSnapshot();

                    if (collectionAccessPolicy.defaultGrant) {
                        return collection;
                    }
                },
            );

            if (!firstCollectionWithDefaultGrant) {
                return `This ${noun} is public because the parent task is shared with everyone in ${space.name}. Try making the parent task private.`;
            } else {
                return `This ${noun} is public because it\u2019s in the \u201C${firstCollectionWithDefaultGrant.getName()}\u201D collection which is shared with everyone in ${space.name}. Try removing the ${noun} from public collections.`;
            }
        },
        SetDefaultGrantLevel: accessLevel => {
            const task = taskSubscription?.taskEntryStore.getSnapshot().task;

            const collections = task?.getCollections().getArray() ?? emptyArray;
            const noun = task?.getLayout() === "Project" ? "project" : "task";

            const firstCollectionWithDefaultGrant = findMapIterable(
                collections,
                ({collectionId}) => {
                    const collection = taskSubscription
                        ?.getReferencedCollectionEntryStore(collectionId)
                        .getSnapshot().collection;
                    if (!collection) return;

                    const collectionAccessPolicy = taskSubscription.store
                        .getCollectionResolvedAccessPolicy(collection)
                        .getSnapshot();

                    if (
                        collectionAccessPolicy.defaultGrant &&
                        hasAccessLevel(collectionAccessPolicy.defaultGrant.level, accessLevel)
                    ) {
                        return collection;
                    }
                },
            );

            let permissionDescription: string;
            switch (accessLevel) {
                case "Manage":
                case "Edit":
                    permissionDescription = "edit";
                    break;
                case "View":
                    permissionDescription = "see";
                    break;
                case "Comment":
                    permissionDescription = "comment on";
                    break;
                default:
                    throw exhaustive(accessLevel);
            }

            if (!firstCollectionWithDefaultGrant) {
                return `You can ${permissionDescription} this ${noun} because the parent task is shared with everyone in ${space.name}. Try removing \u201C${defaultAccessLevelText[accessLevel]}\u201D access from the parent task.`;
            } else {
                return `You can ${permissionDescription} this ${noun} because it\u2019s in the \u201C${firstCollectionWithDefaultGrant.getName()}\u201D collection which is shared with everyone in ${space.name}. Try removing the ${noun} from collections with \u201C${defaultAccessLevelText[accessLevel]}\u201D access.`;
            }
        },
        DeleteUrlGrant: () => {
            const task = taskSubscription?.taskEntryStore.getSnapshot().task;

            const collections = task?.getCollections().getArray() ?? emptyArray;
            const noun = task?.getLayout() === "Project" ? "project" : "task";

            const firstCollectionWithUrlGrant = findMapIterable(collections, ({collectionId}) => {
                const collection = taskSubscription
                    ?.getReferencedCollectionEntryStore(collectionId)
                    .getSnapshot().collection;
                if (!collection) return;

                const collectionAccessPolicy = taskSubscription.store
                    .getCollectionResolvedAccessPolicy(collection)
                    .getSnapshot();

                if (collectionAccessPolicy.urlGrant) {
                    return collection;
                }
            });

            if (!firstCollectionWithUrlGrant) {
                return `This ${noun} is public because the parent task is shared to anyone with the link. Try making the parent task private.`;
            } else {
                return `This ${noun} is public because it\u2019s in the \u201C${firstCollectionWithUrlGrant.getName()}\u201D collection which is shared to anyone with the link. Try removing the ${noun} from public collections.`;
            }
        },
        DeleteAccountGrant: (accountId: AccountId) => {
            const task = taskSubscription?.taskEntryStore.getSnapshot().task;

            const collections = task?.getCollections().getArray() ?? emptyArray;
            const noun = task?.getLayout() === "Project" ? "project" : "task";

            const assigneeAccountId = task?.getAssignee()?.assignee.accountId;
            if (assigneeAccountId === accountId) {
                return `This person has access to the ${noun} because they\u2019re assigned to it. Try unassigning them.`;
            }

            const firstCollectionWithAccountGrant = findMapIterable(
                collections,
                ({collectionId}) => {
                    const collection = taskSubscription
                        ?.getReferencedCollectionEntryStore(collectionId)
                        .getSnapshot().collection;
                    if (!collection) return;

                    const collectionAccessPolicy = taskSubscription.store
                        .getCollectionResolvedAccessPolicy(collection)
                        .getSnapshot();

                    if (collectionAccessPolicy.accountGrantById.has(accountId)) {
                        return collection;
                    }
                },
            );

            if (!firstCollectionWithAccountGrant) {
                return `This person has access to the ${noun} because the parent task is shared with them. Try removing their access from the parent task.`;
            } else {
                return `This person has access to the ${noun} because the \u201C${firstCollectionWithAccountGrant.getName()}\u201D collection is shared with them. Try removing the ${noun} from collections shared with this person.`;
            }
        },
        SetAccountGrantLevel: (accountId: AccountId, accessLevel) => {
            const task = taskSubscription?.taskEntryStore.getSnapshot().task;

            const collections = task?.getCollections().getArray() ?? emptyArray;
            const noun = task?.getLayout() === "Project" ? "project" : "task";

            let permissionDescription: string;
            switch (accessLevel) {
                case "Manage":
                case "Edit":
                    permissionDescription = "edit";
                    break;
                case "View":
                    permissionDescription = "see";
                    break;
                case "Comment":
                    permissionDescription = "comment on";
                    break;
                default:
                    throw exhaustive(accessLevel);
            }

            const assigneeAccountId = task?.getAssignee()?.assignee.accountId;
            if (assigneeAccountId === accountId) {
                return `This person can ${permissionDescription} the ${noun} because they\u2019re assigned to it. Try unassigning them.`;
            }

            const firstCollectionWithAccountGrant = findMapIterable(
                collections,
                ({collectionId}) => {
                    const collection = taskSubscription
                        ?.getReferencedCollectionEntryStore(collectionId)
                        .getSnapshot().collection;
                    if (!collection) return;

                    const collectionAccessPolicy = taskSubscription.store
                        .getCollectionResolvedAccessPolicy(collection)
                        .getSnapshot();
                    const accountGrant = collectionAccessPolicy.accountGrantById.get(accountId);

                    if (accountGrant && hasAccessLevel(accountGrant.level, accessLevel)) {
                        return collection;
                    }
                },
            );

            if (!firstCollectionWithAccountGrant) {
                return `This person can ${permissionDescription} the ${noun} because the parent task is shared with them. Try removing their \u201C${defaultAccessLevelText[accessLevel]}\u201D access from the parent task.`;
            } else {
                return `This person can ${permissionDescription} the ${noun} because the \u201C${firstCollectionWithAccountGrant.getName()}\u201D collection is shared with them. Try removing the ${noun} from collections where this person has \u201C${defaultAccessLevelText[accessLevel]}\u201D access.`;
            }
        },
    };
}
