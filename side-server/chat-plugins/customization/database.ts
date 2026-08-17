export const CUSTOM_AVATARS_TABLE = 'custom_avatars';

export const pgSchema = `
CREATE TABLE IF NOT EXISTS custom_avatars (
	user_id TEXT NOT NULL,
	slot INTEGER NOT NULL DEFAULT 1,
	image_url TEXT NOT NULL,
	set_by TEXT NOT NULL,
	PRIMARY KEY (user_id, slot)
);
`.trim();
