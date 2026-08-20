export const CUSTOM_AVATARS_TABLE = 'custom_avatars';
export const CUSTOM_COLORS_TABLE = 'custom_colors';
export const CUSTOM_ICONS_TABLE = 'custom_icons';

export const pgSchema = `
CREATE TABLE IF NOT EXISTS custom_avatars (
	user_id TEXT NOT NULL,
	slot INTEGER NOT NULL DEFAULT 1,
	image_url TEXT NOT NULL,
	set_by TEXT NOT NULL,
	PRIMARY KEY (user_id, slot)
);

CREATE TABLE IF NOT EXISTS custom_colors (
	user_id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	color TEXT NOT NULL,
	set_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_icons (
	user_id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	url TEXT NOT NULL,
	set_by TEXT NOT NULL
);
`.trim();
