/**
 * Ontime Chat Plugin for Side Server
 * Tracks active user connection time and renders leaderboards.
 */

import { PG } from '../../lib/postgres';
import { Table, nameColor } from '../../lib/ss-utils';
import { ONTIME_TABLE } from './database';

const MAX_USERID_LENGTH = 18;

export interface OntimeEntry {
	totalTime: number;
	isBlocked: boolean;
}

export interface OntimeRow {
	user_id: string;
	total_time: number | bigint | string;
	is_blocked: number;
}

const getOntimeTable = () => PG.getTable<OntimeRow>(ONTIME_TABLE, 'user_id');

// userid → { totalTime, isBlocked }
let ontimeData: Record<string, OntimeEntry> = {};

async function initOntime() {
	try {
		const rows = await getOntimeTable().select();
		ontimeData = {};
		for (const row of rows) {
			ontimeData[row.user_id] = {
				totalTime: Number(row.total_time),
				isBlocked: row.is_blocked === 1,
			};
		}
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		Monitor.warn(`[Ontime] Failed to load ontime data: ${message}`);
	}
}

void initOntime().catch(err => {
	const message = err instanceof Error ? err.message : String(err);
	Monitor.warn(`Ontime PG init failed: ${message}`);
});

const pendingOntimeUpdates = new Map<string, number>();
let ontimeBatchTimer: NodeJS.Timeout | null = null;

export const OntimeManager = {
	displayTime(ms: number): string {
		return Chat.toDurationString(ms, { precision: 1 }) || '0 seconds';
	},

	getSessionTime(user: User | undefined | null): number {
		if (!user?.connected || !user.lastConnected) return 0;
		return Math.max(0, Date.now() - user.lastConnected);
	},

	update(userid: string, sessionTime: number): void {
		if (sessionTime <= 0) return;
		const entry = ontimeData[userid];
		// Silently skip blocked users
		if (entry?.isBlocked) return;

		if (entry) {
			entry.totalTime += sessionTime;
		} else {
			ontimeData[userid] = { totalTime: sessionTime, isBlocked: false };
		}

		pendingOntimeUpdates.set(userid, (pendingOntimeUpdates.get(userid) || 0) + sessionTime);
		if (!ontimeBatchTimer) {
			ontimeBatchTimer = setTimeout(() => {
				void OntimeManager.flushUpdates();
			}, 60 * 1000);
		}
	},

	async flushUpdates(): Promise<void> {
		if (pendingOntimeUpdates.size === 0) return;
		const entries = Array.from(pendingOntimeUpdates.entries());
		pendingOntimeUpdates.clear();
		ontimeBatchTimer = null;

		try {
			const placeholders = entries.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}, 0)`).join(', ');
			const values = entries.flatMap(([userid, sessionTime]) => [userid, sessionTime]);

			await PG.query(`
				INSERT INTO ${ONTIME_TABLE} (user_id, total_time, is_blocked)
				VALUES ${placeholders}
				ON CONFLICT (user_id) DO UPDATE SET total_time = ontime.total_time + EXCLUDED.total_time
			`, values);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			Monitor.warn(`[Ontime] Failed to flush ontime updates: ${message}`);
		}
	},

	async setBlocked(userid: string, blocked: boolean): Promise<void> {
		const totalTime = ontimeData[userid]?.totalTime || 0;
		ontimeData[userid] = { totalTime, isBlocked: blocked };

		await getOntimeTable().upsert({
			user_id: userid,
			total_time: totalTime,
			is_blocked: blocked ? 1 : 0,
		}, ['user_id'], 'is_blocked');
	},
};

export const handlers: Chat.Handlers = {
	onDisconnect(user) {
		if (!user.named || user.connections.length > 0 || user.isPublicBot) return;
		const sessionTime = OntimeManager.getSessionTime(user);
		OntimeManager.update(user.id, sessionTime);
	},
};

export const commands: Chat.ChatCommands = {
	ontime: {
		'': 'check',
		check(target, room, user) {
			this.runBroadcast();
			const targetId = toID(target) || user.id;
			if (targetId.length > MAX_USERID_LENGTH) {
				throw new Chat.ErrorMessage("The specified username is invalid.");
			}

			const targetUser = Users.get(targetId);
			if (targetUser?.isPublicBot) {
				return this.sendReplyBox(`${nameColor(targetId, true)} is a bot and is not tracked.`);
			}

			const entry = ontimeData[targetId];
			if (entry?.isBlocked) {
				return this.sendReplyBox(`${nameColor(targetId, true)} is blocked from tracking ontime.`);
			}

			const savedTime = entry?.totalTime || 0;
			const sessionTime = OntimeManager.getSessionTime(targetUser);
			const total = savedTime + sessionTime;

			if (!total) return this.sendReplyBox(`${nameColor(targetId, true)} has no recorded ontime.`);

			let output = `${nameColor(targetId, true)}'s total ontime is <b>${OntimeManager.displayTime(total)}</b>.`;
			if (sessionTime > 0) {
				output += `<br /><small>Current session: ${OntimeManager.displayTime(sessionTime)}</small>`;
			}

			this.sendReplyBox(output);
		},

		ladder(target, room, user) {
			this.runBroadcast();

			const leaderboard = Object.entries(ontimeData)
				.filter(([, e]) => !e.isBlocked)
				.map(([userid, e]) => {
					const session = OntimeManager.getSessionTime(Users.get(userid));
					return { id: userid, total: e.totalTime + session };
				})
				.sort((a, b) => b.total - a.total)
				.slice(0, 50);

			if (!leaderboard.length) return this.sendReplyBox("The ontime leaderboard is currently empty.");

			const dataRows = leaderboard.map((entry, i) => [
				`${i + 1}`,
				nameColor(entry.id, true),
				OntimeManager.displayTime(entry.total),
			]);

			const html = Table("Ontime Leaderboard", ["Rank", "User", "Time"], dataRows);
			this.sendReply(`|html|${html}`);
		},

		async block(target, room, user) {
			this.checkCan('bypassall');
			const targetId = toID(target);
			if (!targetId || targetId.length > MAX_USERID_LENGTH) {
				throw new Chat.ErrorMessage("The specified username is invalid.");
			}

			const entry = ontimeData[targetId];
			if (entry?.isBlocked) throw new Chat.ErrorMessage("This user is already blocked.");

			await OntimeManager.setBlocked(targetId, true);
			this.sendReply(`${targetId} has been blocked from ontime tracking.`);
		},

		async unblock(target, room, user) {
			this.checkCan('bypassall');
			const targetId = toID(target);
			const entry = ontimeData[targetId];
			if (!entry?.isBlocked) throw new Chat.ErrorMessage("This user is not currently blocked.");

			await OntimeManager.setBlocked(targetId, false);
			this.sendReply(`${targetId} has been unblocked.`);
		},

		blocklist(target, room, user) {
			this.checkCan('bypassall');
			const blocked = Object.entries(ontimeData)
				.filter(([, e]) => e.isBlocked)
				.map(([userid]) => userid);

			if (!blocked.length) return this.sendReply("No users are currently blocked.");
			this.sendReply(`Blocked users: ${blocked.join(', ')}`);
		},

		help() {
			this.runBroadcast();
			this.sendReplyBox(
				`<center><b>Ontime Commands</b></center><hr>` +
				`<b>/ontime [user]</b>: Check a user's total time.<hr>` +
				`<b>/ontime ladder</b>: View the top active users.<hr>` +
				`<b>/ontime block/unblock [user]</b>: Toggle tracking for a user. (&, ~)<hr>` +
				`<b>/ontime blocklist</b>: View blocked users. (&, ~)`
			);
		},
	},
};

export const destroy = () => {
	if (ontimeBatchTimer) {
		clearTimeout(ontimeBatchTimer);
		ontimeBatchTimer = null;
	}
	void OntimeManager.flushUpdates();
};
