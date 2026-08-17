/**
 * Custom Avatar Chat Plugin for Side Server
 * Manages up to 3 local file-based custom avatars per user in config/avatars/ with PostgreSQL persistence.
 */

import { Utils, FS } from '../../../lib';
import { PG } from '../../lib/postgres';
import { SSUtils } from '../../lib/ss-utils';
import { CUSTOM_AVATARS_TABLE } from './database';

const AVATARS_DIR = 'config/avatars' as const;
const MAX_AVATARS_PER_USER = 3;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const VALID_URL = /^https:\/\/[^\s"'<>]+\.(?:png|gif|jpg|jpeg|webp)(?:\?[^\s"'<>]*)?$/i;

export interface CustomAvatarItem {
	slot: number;
	filename: string;
	imageUrl: string;
	setBy: string;
}

export interface CustomAvatarRow {
	user_id: string;
	slot: number;
	image_url: string;
	set_by: string;
}

const getAvatarTable = () => PG.getTable<CustomAvatarRow>(CUSTOM_AVATARS_TABLE, 'user_id');

// userid -> Map<slot (1..3), CustomAvatarItem>
const avatarCache = new Map<string, Map<number, CustomAvatarItem>>();

async function initAvatars(): Promise<void> {
	try {
		const rows = await getAvatarTable().select();
		avatarCache.clear();

		for (const row of rows) {
			const id = toID(row.user_id);
			const slot = Number(row.slot) || 1;
			const match = /\.(png|gif|jpg|jpeg|webp)(?:\?|$)/i.exec(row.image_url);
			const ext = match ? match[1].toLowerCase() : 'png';
			const filename = slot === 1 ? `${id}.${ext}` : `${id}-${slot}.${ext}`;

			if (!avatarCache.has(id)) {
				avatarCache.set(id, new Map());
			}

			avatarCache.get(id)!.set(slot, {
				slot,
				filename,
				imageUrl: row.image_url,
				setBy: row.set_by,
			});

			if (slot === 1) {
				Users.Avatars?.addPersonal(id, filename);
			} else {
				Users.Avatars?.addAllowed(id, filename);
			}
		}
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		Monitor.warn(`[CustomAvatar] Failed to load avatars from PostgreSQL: ${message}`);
	}
}

void initAvatars().catch(err => {
	const message = err instanceof Error ? err.message : String(err);
	Monitor.warn(`CustomAvatar PG init failed: ${message}`);
});

export const CustomAvatarManager = {
	async setAvatar(
		userid: string,
		url: string,
		setBy: string,
		targetSlot?: number
	): Promise<{ filename: string, slot: number }> {
		const id = toID(userid);
		let userSlots = avatarCache.get(id);
		if (!userSlots) {
			userSlots = new Map();
			avatarCache.set(id, userSlots);
		}

		let slot = targetSlot;
		if (slot === undefined) {
			for (let i = 1; i <= MAX_AVATARS_PER_USER; i++) {
				if (!userSlots.has(i)) {
					slot = i;
					break;
				}
			}
			if (slot === undefined) {
				throw new Chat.ErrorMessage(
					`User '${userid}' already has the maximum of ${MAX_AVATARS_PER_USER} custom avatars. ` +
					`Specify a slot (1-${MAX_AVATARS_PER_USER}) to overwrite an existing avatar, or delete one first.`
				);
			}
		}

		const match = /\.(png|gif|jpg|jpeg|webp)(?:\?|$)/i.exec(url);
		const ext = match ? match[1].toLowerCase() : 'png';
		const filename = slot === 1 ? `${id}.${ext}` : `${id}-${slot}.${ext}`;

		let response: Response;
		try {
			response = await fetch(url);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Chat.ErrorMessage(`Error connecting to image URL: ${message}`);
		}

		if (!response.ok) {
			throw new Chat.ErrorMessage(`Error fetching image: HTTP ${response.status}.`);
		}

		const buffer = Buffer.from(await response.arrayBuffer());
		if (buffer.length === 0) {
			throw new Chat.ErrorMessage("The downloaded image file is empty.");
		}
		if (buffer.length > MAX_FILE_SIZE) {
			throw new Chat.ErrorMessage("Image file size exceeds the 2MB limit.");
		}

		await FS(AVATARS_DIR).mkdirIfNonexistent();

		const oldItem = userSlots.get(slot);
		if (oldItem && oldItem.filename !== filename) {
			await FS(`${AVATARS_DIR}/${oldItem.filename}`).unlinkIfExists();
			Users.Avatars?.removeAllowed(id, oldItem.filename);
		}

		const filePath = `${AVATARS_DIR}/${filename}`;
		await FS(filePath).write(buffer);

		const item: CustomAvatarItem = {
			slot,
			filename,
			imageUrl: url,
			setBy,
		};

		userSlots.set(slot, item);

		await getAvatarTable().upsert({
			user_id: id,
			slot,
			image_url: url,
			set_by: setBy,
		}, ['user_id', 'slot']);

		if (slot === 1) {
			Users.Avatars?.addPersonal(id, filename);
		} else {
			Users.Avatars?.addAllowed(id, filename);
		}

		const targetUser = Users.get(id);
		if (targetUser?.connected && (slot === 1 || !targetUser.avatar || targetUser.avatar === oldItem?.filename)) {
			targetUser.avatar = filename;
		}

		return { filename, slot };
	},

	async deleteAvatar(userid: string, targetSlot?: number): Promise<boolean> {
		const id = toID(userid);
		const userSlots = avatarCache.get(id);
		if (!userSlots || userSlots.size === 0) return false;

		if (targetSlot !== undefined) {
			const item = userSlots.get(targetSlot);
			if (!item) return false;

			await FS(`${AVATARS_DIR}/${item.filename}`).unlinkIfExists();
			userSlots.delete(targetSlot);

			await getAvatarTable().delete({ user_id: id, slot: targetSlot });
			Users.Avatars?.removeAllowed(id, item.filename);

			if (userSlots.size === 0) {
				avatarCache.delete(id);
			}

			const targetUser = Users.get(id);
			if (targetUser?.connected && targetUser.avatar === item.filename) {
				const fallback = userSlots.get(1)?.filename || 1;
				targetUser.avatar = fallback;
			}

			return true;
		}

		for (const item of userSlots.values()) {
			await FS(`${AVATARS_DIR}/${item.filename}`).unlinkIfExists();
			Users.Avatars?.removeAllowed(id, item.filename);
		}

		userSlots.clear();
		avatarCache.delete(id);

		await getAvatarTable().delete({ user_id: id });

		const targetUser = Users.get(id);
		if (targetUser?.connected) {
			targetUser.avatar = 1;
		}

		return true;
	},

	getUserAvatars(userid: string): CustomAvatarItem[] {
		const userSlots = avatarCache.get(toID(userid));
		if (!userSlots) return [];
		return Array.from(userSlots.values()).sort((a, b) => a.slot - b.slot);
	},

	getAll(): { userId: string, avatars: CustomAvatarItem[] }[] {
		const results: { userId: string, avatars: CustomAvatarItem[] }[] = [];
		for (const [userId, userSlots] of avatarCache.entries()) {
			if (userSlots.size > 0) {
				results.push({
					userId,
					avatars: Array.from(userSlots.values()).sort((a, b) => a.slot - b.slot),
				});
			}
		}
		return results;
	},
};

export const commands: Chat.ChatCommands = {
	ca: 'customavatar',
	customavatars: 'customavatar',
	customavatar: {
		set: 'add',
		async add(target, room, user) {
			this.checkCan('bypassall');
			const [rawUser, url, rawSlot] = target.split(',').map(s => s.trim());
			if (!rawUser || !url) return this.parse('/customavatar help');

			const targetId = toID(rawUser);
			if (!targetId || targetId.length > 18) {
				throw new Chat.ErrorMessage(`User '${rawUser}' is an invalid username.`);
			}

			let slot: number | undefined;
			if (rawSlot) {
				slot = Utils.parseExactInt(rawSlot);
				if (isNaN(slot) || slot < 1 || slot > MAX_AVATARS_PER_USER) {
					throw new Chat.ErrorMessage(`Slot must be a number between 1 and ${MAX_AVATARS_PER_USER}.`);
				}
			}

			if (!VALID_URL.test(url)) {
				throw new Chat.ErrorMessage(
					"The provided image URL is invalid. It must be an HTTPS link to a PNG, GIF, JPG, or WEBP file."
				);
			}

			const result = await CustomAvatarManager.setAvatar(targetId, url, user.name, slot);

			this.sendReply(
				`|html|Custom avatar (Slot ${result.slot}) for ${SSUtils.nameColor(targetId, true)} set to: ` +
				`<code>${Utils.escapeHTML(result.filename)}</code><br />` +
				(Config.avatarUrl ?
					`<img src="${Config.avatarUrl}/${Utils.escapeHTML(result.filename)}" width="80" height="80" class="pixelated">` :
					`Avatar URL not set for slot ${result.slot}.`)
			);
		},

		delete: 'remove',
		async remove(target, room, user) {
			this.checkCan('bypassall');
			const [rawUser, rawSlot] = target.split(',').map(s => s.trim());
			if (!rawUser) return this.parse('/customavatar help');

			const targetId = toID(rawUser);
			if (!targetId) return this.parse('/customavatar help');

			let slot: number | undefined;
			if (rawSlot) {
				slot = Utils.parseExactInt(rawSlot);
				if (isNaN(slot) || slot < 1 || slot > MAX_AVATARS_PER_USER) {
					throw new Chat.ErrorMessage(`Slot must be a number between 1 and ${MAX_AVATARS_PER_USER}.`);
				}
			}

			const deleted = await CustomAvatarManager.deleteAvatar(targetId, slot);
			if (!deleted) {
				throw new Chat.ErrorMessage(
					slot ?
						`User '${rawUser}' does not have a custom avatar in slot ${slot}.` :
						`User '${rawUser}' does not have any custom avatars.`
				);
			}

			this.sendReply(
				slot ?
					`Custom avatar in slot ${slot} for '${rawUser}' has been deleted.` :
					`All custom avatars for '${rawUser}' have been deleted.`
			);
		},

		show: 'view',
		view(target, room, user) {
			if (!this.runBroadcast()) return;
			const targetId = toID(target) || user.id;
			if (!targetId) return this.parse('/customavatar help');

			const avatars = CustomAvatarManager.getUserAvatars(targetId);
			if (!avatars.length) {
				throw new Chat.ErrorMessage(`User '${target || user.name}' does not have any custom avatars.`);
			}

			const isSelf = targetId === user.id && !this.broadcasting;

			const dataRows: string[][] = [];
			for (const avatar of avatars) {
				const avatarImg = Config.avatarUrl ?
					`<center><img src="${Config.avatarUrl}/${Utils.escapeHTML(avatar.filename)}" width="80" height="80" class="pixelated" title="${Utils.escapeHTML(avatar.filename)}"><br /><code>${Utils.escapeHTML(avatar.filename)}</code></center>` :
					`<center>Avatar URL not set for slot ${avatar.slot}.<br /><code>${Utils.escapeHTML(avatar.filename)}</code></center>`;

				const row = [
					avatarImg,
					`<center>${avatar.slot}</center>`,
					`<center>${SSUtils.nameColor(avatar.setBy, true)}</center>`,
				];

				if (isSelf) {
					row.push(`<center><button class="button" name="send" value="/avatar ${Utils.escapeHTML(avatar.filename)}">Set</button></center>`);
				}
				dataRows.push(row);
			}

			const headers = ["Avatar", "Slot", "Set By"];
			if (isSelf) headers.push("");

			const html = SSUtils.Table(
				`Custom Avatars for ${SSUtils.nameColor(targetId, true)} (${avatars.length}/${MAX_AVATARS_PER_USER})`,
				headers,
				dataRows
			);
			this.sendReply(`|html|${html}`);
		},

		list(target, room, user) {
			if (!this.runBroadcast()) return;

			const allUserAvatars = CustomAvatarManager.getAll();
			if (allUserAvatars.length === 0) {
				return this.sendReplyBox("No custom avatars have been registered yet.");
			}

			const dataRows: string[][] = [];
			for (const userGroup of allUserAvatars) {
				for (const item of userGroup.avatars) {
					dataRows.push([
						SSUtils.nameColor(userGroup.userId, true),
						`<center>` +
						(Config.avatarUrl ?
							`<img src="${Config.avatarUrl}/${Utils.escapeHTML(item.filename)}" width="40" height="40" ` +
							`class="pixelated" title="${Utils.escapeHTML(item.filename)}">` :
							`Avatar URL not set for slot ${item.slot}.`) +
							`<br /><small>Slot ${item.slot}</small></center>`,
						SSUtils.nameColor(item.setBy, true),
					]);
				}
			}

			const html = SSUtils.Table(
				"Custom Avatars",
				["User", "Avatar", "Set By"],
				dataRows
			);
			this.sendReply(`|html|${html}`);
		},

		''(target, room, user) {
			return this.parse('/customavatar help');
		},

		help() {
			this.runBroadcast();
			this.sendReplyBox(
				`<center><b>Custom Avatar Commands</b></center><hr>` +
				`<b>/customavatar set [user], [image url], (slot 1-${MAX_AVATARS_PER_USER})</b>: Set or update an avatar. (&, ~)<hr>` +
				`<b>/customavatar delete [user], (slot 1-${MAX_AVATARS_PER_USER})</b>: Delete a specific slot or all avatars. (&, ~)<hr>` +
				`<b>/customavatar view [user]</b>: Preview all custom avatars for a user.<hr>` +
				`<b>/customavatar list</b>: List all registered custom avatars.`
			);
		},
	},
};
