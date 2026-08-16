/**
 * Autotours Chat Plugin for Side Server
 * Automatically starts scheduled tournaments in configured rooms.
 */

import { Utils } from '../../../lib';
import { PG } from '../../lib/postgres';
import { Table } from '../../lib/ss-utils';
import { AUTO_TOURS_TABLE } from './database';

export interface AutoTour {
	room_id: string;
	enabled: number;
	formats: string;
	types: string;
	interval: number;
	autostart: number;
	autodq: number;
	player_cap: string;
	last_tour_time: number | bigint | string;
}

export interface PerRoomAutotourConfig {
	roomid: RoomID;
	formats: string[];
	types: string[];
	interval: number;
	autostart: number;
	autodq: number;
	playerCap: string;
	enabled: boolean;
	lastTourTime: number;
}

interface MockCommandContext {
	sendReply: (m: string) => void;
	errorReply: (m: string) => void;
	checkChat: (m: string) => string;
	user: User;
	room: Room;
	modlog: () => void;
	parse: (m: string) => Promise<unknown> | void;
}

const getTourTable = () => PG.getTable<AutoTour>(AUTO_TOURS_TABLE, 'room_id');

const ALL_TOUR_TYPES = ['elimination', 'roundrobin'] as const;

const DEFAULTS: Omit<PerRoomAutotourConfig, 'roomid'> = {
	formats: ['gen9randombattle'],
	types: [...ALL_TOUR_TYPES],
	interval: 60,
	autostart: 5,
	autodq: 2,
	playerCap: '',
	enabled: false,
	lastTourTime: 0,
};

const tourConfigs: Record<string, PerRoomAutotourConfig> = {};
let globalScheduler: NodeJS.Timeout | null = null;

export const AutotourManager = {
	async init() {
		try {
			const rows = await getTourTable().select();
			for (const row of rows) {
				tourConfigs[row.room_id] = {
					roomid: row.room_id as RoomID,
					enabled: row.enabled === 1,
					formats: row.formats ? row.formats.split(',') : ['gen9randombattle'],
					types: row.types ? row.types.split(',') : [...ALL_TOUR_TYPES],
					interval: Number(row.interval) || 60,
					autostart: Number(row.autostart) || 5,
					autodq: Number(row.autodq) || 2,
					playerCap: row.player_cap || '',
					lastTourTime: Number(row.last_tour_time) || 0,
				};
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			Monitor.warn(`[Autotour] Failed to load configurations: ${message}`);
		}

		if (!globalScheduler) {
			globalScheduler = setInterval(() => {
				AutotourManager.tick();
			}, 30 * 1000);
		}
	},

	async saveConfig(roomid: RoomID) {
		const config = this.getConfig(roomid);
		await getTourTable().upsert({
			room_id: config.roomid,
			enabled: config.enabled ? 1 : 0,
			formats: config.formats.join(','),
			types: config.types.join(','),
			interval: config.interval,
			autostart: config.autostart,
			autodq: config.autodq,
			player_cap: config.playerCap,
			last_tour_time: config.lastTourTime,
		}, ['room_id']);
	},

	getConfig(roomid: RoomID): PerRoomAutotourConfig {
		if (!tourConfigs[roomid]) tourConfigs[roomid] = { roomid, ...DEFAULTS };
		return tourConfigs[roomid];
	},

	tick() {
		for (const roomid of Object.keys(tourConfigs) as RoomID[]) {
			const config = tourConfigs[roomid];
			if (!config.enabled) continue;

			const room = Rooms.get(roomid);
			if (!room || room.game?.gameid === 'tournament') continue;

			const intervalMs = Math.max(1, config.interval) * 60 * 1000;
			if (Date.now() >= config.lastTourTime + intervalMs) {
				this.execute(roomid);
			}
		}
	},

	execute(roomid: RoomID) {
		const config = this.getConfig(roomid);
		const room = Rooms.get(roomid);
		if (!config.enabled || !room || room.game?.gameid === 'tournament') return;

		const format = Utils.randomElement(config.formats);
		const type = Utils.randomElement(config.types);
		const modifier = (type === 'elimination' && Math.random() < 0.2) ? '2' : undefined;

		const mockContext: MockCommandContext = {
			sendReply: (m: string) => room.add(m).update(),
			errorReply: (m: string) => room.add(`|error|${m}`).update(),
			checkChat: (m: string) => m,
			user: (Users.get('autotour') || { id: 'autotour', name: 'Autotour' }) as User,
			room,
			modlog: () => {},
			parse: () => {},
		};

		try {
			const output = mockContext as unknown as Chat.CommandContext;
			const tour = Tournaments.createTournament(
				room,
				format,
				type,
				config.playerCap || undefined,
				false,
				modifier,
				undefined,
				output
			);
			if (tour) {
				if (config.autostart > 0) {
					tour.setAutoStartTimeout(config.autostart * 60 * 1000, output);
				}
				if (config.autodq > 0) {
					tour.setAutoDisqualifyTimeout(config.autodq * 60 * 1000, output);
				}
				config.lastTourTime = Date.now();
				void this.saveConfig(roomid);
			}
		} catch (e: unknown) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			room.add(`|error|[Autotour] Failed: ${errorMessage}`).update();
		}
	},
};

void AutotourManager.init().catch(err => {
	const message = err instanceof Error ? err.message : String(err);
	Monitor.warn(`Autotours PG init failed: ${message}`);
});

export const commands: Chat.ChatCommands = {
	at: 'autotour',
	autotour: {
		async enable(target, room, user) {
			const curRoom = this.requireRoom();
			this.checkCan('declare', null, curRoom);
			const config = AutotourManager.getConfig(curRoom.roomid);
			config.enabled = true;
			await AutotourManager.saveConfig(curRoom.roomid);
			this.sendReply(`Autotours enabled for ${curRoom.title || curRoom.roomid}.`);
		},

		async disable(target, room, user) {
			const curRoom = this.requireRoom();
			this.checkCan('declare', null, curRoom);
			const config = AutotourManager.getConfig(curRoom.roomid);
			config.enabled = false;
			await AutotourManager.saveConfig(curRoom.roomid);
			this.sendReply(`Autotours disabled for ${curRoom.title || curRoom.roomid}.`);
		},

		async interval(target, room, user) {
			const curRoom = this.requireRoom();
			this.checkCan('declare', null, curRoom);
			const val = Utils.parseExactInt(target);
			if (isNaN(val) || val < 1) throw new Chat.ErrorMessage("The interval must be at least 1 minute.");
			const config = AutotourManager.getConfig(curRoom.roomid);
			config.interval = val;
			await AutotourManager.saveConfig(curRoom.roomid);
			this.sendReply(`The tournament interval has been set to ${val} minute(s).`);
		},

		async formats(target, room, user) {
			const curRoom = this.requireRoom();
			this.checkCan('declare', null, curRoom);
			const formats = target.split(',').map(f => toID(f)).filter(Boolean);
			if (!formats.length) throw new Chat.ErrorMessage("Usage: /at formats [format1], [format2]");
			for (const f of formats) {
				const dexFormat = Dex.formats.get(f);
				if (!dexFormat.exists) {
					throw new Chat.ErrorMessage(`Format "${f}" was not found.`);
				}
			}
			const config = AutotourManager.getConfig(curRoom.roomid);
			config.formats = formats;
			await AutotourManager.saveConfig(curRoom.roomid);
			this.sendReply("The rotation formats have been updated.");
		},

		show(target, room, user) {
			const curRoom = this.requireRoom();
			this.checkCan('declare', null, curRoom);
			const config = AutotourManager.getConfig(curRoom.roomid);
			const dataRows = [
				["<b>Enabled:</b>", config.enabled ? "Yes" : "No"],
				["<b>Formats:</b>", Utils.escapeHTML(config.formats.join(', '))],
				["<b>Interval:</b>", `${config.interval} min`],
				["<b>Auto-Start/DQ:</b>", `${config.autostart}m / ${config.autodq}m`],
			];
			const html = Table(`Autotour: ${Utils.escapeHTML(curRoom.title || curRoom.roomid)}`, ["Setting", "Value"], dataRows);
			this.sendReply(`|html|${html}`);
		},

		next(target, room, user) {
			const curRoom = this.requireRoom();
			const config = AutotourManager.getConfig(curRoom.roomid);
			if (!config.enabled) throw new Chat.ErrorMessage("Autotours are not enabled for this room.");
			const next = (config.lastTourTime + (config.interval * 60000)) - Date.now();
			const remaining = next > 0 ? Math.ceil(next / 60000) : 0;
			this.sendReply(`The next tournament in ${curRoom.title || curRoom.roomid} is scheduled for ~${remaining} minute(s) from now.`);
		},

		help() {
			this.runBroadcast();
			this.sendReplyBox(
				`<center><b>Autotour Commands</b></center><hr>` +
				`<b>/at enable/disable</b>: Toggle autotours. (#, &, ~)<hr>` +
				`<b>/at formats [f1], [f2]</b>: Set format rotation. (#, &, ~)<hr>` +
				`<b>/at interval [min]</b>: Set time between tours. (#, &, ~)<hr>` +
				`<b>/at show</b>: View current config. (#, &, ~)<hr>` +
				`<b>/at next</b>: Time until next tour.`
			);
		},
	},
};

export const destroy = () => {
	if (globalScheduler) {
		clearInterval(globalScheduler);
		globalScheduler = null;
	}
};
