import * as crypto from 'node:crypto';
import { Utils } from '../../lib';

export const customColors: Record<string, string> = {};
const colorCache: Record<string, string> = {};

/**
 * Generates an HTML string for a username styled with their color and optional rank symbol / bolding.
 *
 * Usage:
 * - Call `nameColor(name)` to generate a bold, custom/hashed colored username.
 * - Call `nameColor(name, false)` to generate an unbolded colored username.
 * - Call `nameColor(name, true, true)` to include the user's global auth symbol with bolding.
 */
export const nameColor = (name: string, bold = true, userGroup = false): string => {
	const userId = toID(name);
	let color = customColors[userId] || colorCache[userId];

	if (!color) {
		const hash = crypto.createHash('md5').update(userId).digest('hex');
		const h = parseInt(hash.slice(4, 8), 16) % 360;
		const s = (parseInt(hash.slice(0, 4), 16) % 50) + 40;
		const l = Math.floor(parseInt(hash.slice(8, 12), 16) % 20 + 30);

		// HSL to RGB conversion
		const c = (100 - Math.abs(2 * l - 100)) * s / 10000;
		const x = c * (1 - Math.abs((h / 60) % 2 - 1));
		const m = l / 100 - c / 2;
		let r = 0;
		let g = 0;
		let b = 0;

		const hCase = Math.floor(h / 60);
		if (hCase === 0) {
			r = c; g = x;
		} else if (hCase === 1) {
			r = x; g = c;
		} else if (hCase === 2) {
			g = c; b = x;
		} else if (hCase === 3) {
			g = x; b = c;
		} else if (hCase === 4) {
			r = x; b = c;
		} else if (hCase === 5) {
			r = c; b = x;
		}

		const toHex = (val: number) => Math.round((val + m) * 255).toString(16).padStart(2, '0');
		color = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
		colorCache[userId] = color;
	}

	const symbol = userGroup && typeof Users !== 'undefined' && Users.globalAuth.get(userId) ?
		`<font color="#948A88">${Users.globalAuth.get(userId)}</font>` :
		'';
	const userName = Utils.escapeHTML(typeof Users !== 'undefined' ? (Users.getExact(name)?.name || name) : name);
	return `${symbol}${bold ? '<b>' : ''}<font color="${color}">${userName}</font>${bold ? '</b>' : ''}`;
};

/**
 * Generates responsive, dark-mode compatible HTML table markup.
 *
 * Usage:
 * - Call `Table(title, headerRow, dataRows)` where `title` is the table title,
 *   `headerRow` is an array of column names, and `dataRows` is a 2D array of cell values.
 */
export const Table = (title: string, headerRow: string[], dataRows: string[][]): string => {
	let output = `<div class="ss-table-container">`;
	output += `<h3 class="ss-table-title">${title}</h3>`;
	output += `<table class="ss-table">`;
	output += `<tr class="ss-table-header">`;
	for (const header of headerRow) { output += `<th>${header}</th>`; }
	output += `</tr>`;
	for (const row of dataRows) {
		output += `<tr class="ss-table-row">`;
		for (const cell of row) { output += `<td>${cell}</td>`; }
		output += `</tr>`;
	}
	output += `</table></div>`;
	return output;
};

/**
 * Pings the central Pokémon Showdown server to invalidate and refresh the custom CSS cache.
 * Note: Only registered Pokémon Showdown side servers can have custom CSS.
 *
 * Usage:
 * - Call `reloadCSS()` to automatically use `Config.serverid` (falls back to 'sideserver').
 * - Call `reloadCSS('yourserverid')` to manually override and reload CSS for a specific server name.
 */
export const reloadCSS = async (serverId: string = Config.serverid || 'sideserver'): Promise<void> => {
	const url = `https://play.pokemonshowdown.com/customcss.php?server=${serverId}&invalidate`;

	try {
		const response = await fetch(url);

		if (!response.ok) {
			Monitor.warn(`Failed to reload custom CSS. Central server responded with status: ${response.status}`);
			return;
		}

		const responseText = await response.text();

		if (!responseText.includes('Done:')) {
			Monitor.warn(`Failed to reload custom CSS. Unexpected response: ${responseText}`);
		}
	} catch (err: any) {
		Monitor.warn(`Failed to fetch custom CSS invalidation from central server: ${err.message}`);
	}
};

/**
 * Sends a server PM to a user if they are online.
 * 
 * Usage:
 * - Call `sendPM('ash', 'Your color has been updated!')`
 */
export const sendPM = (targetUser: string, htmlMessage: string): void => {
	const userObj = typeof Users !== 'undefined' ? Users.getExact(targetUser) : null;
	if (userObj && userObj.connected) {
		const serverName = typeof Config !== 'undefined' && Config.serverName ? Config.serverName : 'Server';
		userObj.send(`|pm|~${serverName}|${userObj.getIdentity()}|/raw ${htmlMessage}`);
	}
};

export const SSUtils = {
	nameColor,
	Table,
	reloadCSS,
	customColors,
	sendPM,
};

export default SSUtils;
