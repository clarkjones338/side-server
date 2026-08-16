export const AUTO_TOURS_TABLE = 'auto_tours';
export const SEEN_USERS_TABLE = 'seen_users';
export const ONTIME_TABLE = 'ontime';
export const EMOTICONS_TABLE = 'emoticons';

export const pgSchema = `
CREATE TABLE IF NOT EXISTS auto_tours (
	room_id TEXT PRIMARY KEY,
	enabled INTEGER DEFAULT 0,
	formats TEXT NOT NULL,
	types TEXT NOT NULL,
	interval INTEGER NOT NULL,
	autostart INTEGER NOT NULL,
	autodq INTEGER NOT NULL,
	player_cap TEXT NOT NULL,
	last_tour_time BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS seen_users (
	user_id TEXT PRIMARY KEY,
	username TEXT NOT NULL,
	last_seen BIGINT NOT NULL,
	action TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ontime (
	user_id TEXT PRIMARY KEY,
	total_time BIGINT NOT NULL,
	is_blocked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS emoticons (
	name TEXT PRIMARY KEY,
	url TEXT NOT NULL,
	added_by TEXT NOT NULL,
	added_at BIGINT NOT NULL
);
`.trim();
