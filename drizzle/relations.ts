import { relations } from "drizzle-orm/relations";
import { inviteCodes, inviteCodeUsages, users, localUsers } from "./schema";

export const inviteCodeUsagesRelations = relations(inviteCodeUsages, ({one}) => ({
	inviteCode: one(inviteCodes, {
		fields: [inviteCodeUsages.inviteCodeId],
		references: [inviteCodes.id]
	}),
	user: one(users, {
		fields: [inviteCodeUsages.userId],
		references: [users.id]
	}),
}));

export const inviteCodesRelations = relations(inviteCodes, ({one, many}) => ({
	inviteCodeUsages: many(inviteCodeUsages),
	user_createdBy: one(users, {
		fields: [inviteCodes.createdBy],
		references: [users.id],
		relationName: "inviteCodes_createdBy_users_id"
	}),
	user_usedBy: one(users, {
		fields: [inviteCodes.usedBy],
		references: [users.id],
		relationName: "inviteCodes_usedBy_users_id"
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	inviteCodeUsages: many(inviteCodeUsages),
	inviteCodes_createdBy: many(inviteCodes, {
		relationName: "inviteCodes_createdBy_users_id"
	}),
	inviteCodes_usedBy: many(inviteCodes, {
		relationName: "inviteCodes_usedBy_users_id"
	}),
	localUsers: many(localUsers),
}));

export const localUsersRelations = relations(localUsers, ({one}) => ({
	user: one(users, {
		fields: [localUsers.userId],
		references: [users.id]
	}),
}));