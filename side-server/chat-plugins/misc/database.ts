export const AUTO_TOURS_TABLE = 'auto_tours';

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
`.trim();
