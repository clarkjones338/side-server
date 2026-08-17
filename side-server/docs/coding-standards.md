# Side Server Coding Standards

These are the coding standards for custom plugins and modifications within the `side-server` directory. By adhering to these standards, we ensure consistency with the upstream Pokémon Showdown codebase and prevent runtime errors.

---

## 1. No TypeScript Enums

Avoid using TypeScript `enum`. Instead, use frozen objects with `as const`.

**Bad:**

```typescript
enum Colors {
    Red = "red",
    Blue = "blue"
}
```

**Good:**

```typescript
const Colors = {
    Red: "red",
    Blue: "blue",
} as const;
```

---

## 2. No `.forEach` Loops

Avoid using `.forEach()` for iterating over arrays or maps. Use `for...of` loops instead, which are faster and support `await`, `break`, and `continue`.

**Bad:**

```typescript
users.forEach(user => {
    user.send("Hello!");
});
```

**Good:**

```typescript
for (const user of users) {
    user.send("Hello!");
}
```

---

## 3. Strict Equality (`===`) and Optionals (`null` vs `undefined`)

Always use strict equality (`===` and `!==`) instead of loose equality (`==` and `!=`).

However, there is one major exception: when checking if a value is neither `null` nor `undefined`. Pokémon Showdown generally prefers using `!foo` for this check (treating `0` and `''` similarly to `null` and `undefined`). If you specifically need to allow `0` or `''`, you may use `foo == null`.

**Optionals Convention:** Pokémon Showdown uses `null` for optionals (a function that retrieves a possible `T` should return `T | null`). Do NOT use `undefined` or `false` for optionals in new code.

**Simulator Event Handlers (`sim/` and `data/`):** When writing event handlers in the simulator, returning `false`, `null`, or `undefined` has highly specific functional meanings. They are not interchangeable!

- **`null`**: Action failed silently (e.g. Volt Absorb triggering). Suppresses standard failure messages.
- **`undefined`**: Action should be completely ignored (e.g. Water Absorb not triggering on Thunder Wave).
- **`false`**: Action failed normally.

---

## 4. `||` vs `??` Fallbacks

Prefer `||` over `??` for fallbacks since Pokémon Showdown rarely treats `0`, `''`, or `false` differently from `null`. Only use `??` when you explicitly need `0`, `''`, or `false` to be preserved instead of triggering the fallback.

---

## 5. Anti-Magic (Getters, Setters, Proxies)

Avoid "magic" behavior like `Proxy` or custom get/set properties that trigger side effects under the hood. If setting a variable runs a function with side effects, explicitly define a `.getFoo()` or `.setFoo(value)` method instead.

---

## 6. TypeScript Safety

Avoid using the `any` type. If a type is truly unknown, use `unknown` and perform type narrowing. Whenever you create complex objects or API responses, define an interface or type for them to ensure type safety and leverage autocomplete.

---

## 7. Global Namespaces

`Chat`, `Users`, `Rooms`, `Dex`, `toID`, `Config`, `Monitor`, and `Teams` are declared as global in `server/index.ts` and don't need to be imported.

### Server Configuration (`Config`)

Side-server specific configuration options are defined in `config/config-example.js` (and loaded into global `Config`):

- **`Config.serverid`**: The registered side-server identifier (normalized ID, defaults to `'sideserver'`). Used when communicating with central login services and invalidating custom CSS (`SSUtils.reloadCSS()`).
- **`Config.servertoken`**: Authentication token for central Pokémon Showdown login server requests.
- **`Config.serverName`**: The display name of the server (defaults to `'Side Server'`).
- **`Config.postgres`**: PostgreSQL connection options for side-server database plugins.

---

## 8. Non-Blocking I/O (Crucial for Plugins)

Because Pokémon Showdown is a single-threaded Node.js server managing hundreds of active battles, never use synchronous file system operations (e.g., `fs.readFileSync`) inside a chat command or event handler. Always use the asynchronous versions (`FS('file.txt').read()`, `fs.promises.readFile`) so you don't block the event loop.

---

## 9. Code Comments

- **Don't teach JavaScript:** Avoid commenting obvious language mechanics (e.g. `// increases by 1`).
- **Self-Documenting:** Whenever possible, prefer documenting your code by using descriptive variable names instead of comments (e.g. `const isStaff = ...` instead of `// if user is staff`).
- **Doc Comments:** Use `/** */` blocks for documenting functions/variables, which allows VS Code to display the documentation on hover.

---

## 10. String Quotes Convention

Use the correct quote marks based on the purpose of the string:

- Use `` ` `` (backticks) for interpolation or HTML/protocol code.
- Use `'` (single quotes) for internal IDs or strings NOT meant to be displayed to users.
- Use `"` (double quotes) for English text, names, and anything directly displayed to the user.

---

## 11. Custom Plugin Architecture

When building custom chat plugins for this server, always follow these architectural rules:

- **Placement:** All custom chat plugins MUST be placed within the `side-server/chat-plugins/` directory (never directly in the upstream `server/chat-plugins/` folder).
- **Subdirectories:** If a plugin becomes complex and requires multiple files, create a dedicated subdirectory for it inside `side-server/chat-plugins/` (e.g., `side-server/chat-plugins/my-complex-plugin/`).
- **Database Storage:** Always use Postgres via `side-server/lib/postgres.ts` for storing persistent data. Avoid writing state to arbitrary JSON files on the disk, as Postgres provides better concurrency, scalability, and safety across hotpatches.
  - **Schema Initialization:** Define database tables by exporting a `pgSchema` array of queries from a `database.ts` file in your plugin's subdirectory. The server automatically aggregates and initializes these tables on startup.

**Bad:**

```typescript
// Manually running CREATE TABLE inside your plugin code or using JSON
import * as fs from 'fs';

export const commands: Chat.ChatCommands = {
    async init() {
        // Anti-pattern: The server should handle table initialization at startup
        await PG.query(`CREATE TABLE IF NOT EXISTS my_plugin_data (...)`);
    }
};
```

**Good:**

```typescript
// side-server/chat-plugins/my-plugin/database.ts
export const PLUGIN_TABLE = 'my_plugin_data';

export const pgSchema = [
    `CREATE TABLE IF NOT EXISTS ${PLUGIN_TABLE} (
        userid VARCHAR(50) PRIMARY KEY,
        points INT NOT NULL DEFAULT 0
    )`
];

// side-server/chat-plugins/my-plugin/index.ts
import { PG } from '../../lib/postgres';
import { PLUGIN_TABLE } from './database';

// The table is guaranteed to exist when your commands run
export const commands: Chat.ChatCommands = {
    async addpoints(target, room, user) {
        await PG.query(`INSERT INTO ${PLUGIN_TABLE} (userid, points) VALUES ($1, $2)`, [user.id, 10]);
    }
};
```

---

## 12. `toID` and ID Normalization

Always use the global `toID(text)` function to normalize usernames, Pokémon names, item names, room IDs, and database lookup keys. `toID` strips all non-alphanumeric characters and converts the string to lowercase, returning the standard ID type.

Never do manual regex or lowercase transformations:

**Bad:**

```typescript
const userId = target.toLowerCase().replace(/[^a-z0-9]/g, '');
const itemKey = item.toLowerCase().trim();
```

**Good:**

```typescript
const userId = toID(target);
const itemKey = toID(item);
```

**Key Rules:**

- **Global:** `toID` is globally declared and does not require an import.
- **Keys & Lookups:** Always normalize keys before querying PostgreSQL or indexing Maps/objects.
- **Never for Display:** Never use `toID` on text intended to be displayed back to users, as it strips all spaces, casing, and punctuation.

---

## 13. Use the Utils Module

Do not reinvent the wheel for common utility functions (like random array elements or HTML escaping). Always use the built-in Utils module provided by Pokémon Showdown.

**Important:** You must explicitly import `Utils` in every file where it is used.

```typescript
import { Utils } from '../../../lib'; // Adjust relative path as necessary
```

Here are the available functions and classes in the Utils module that you should use instead of writing custom logic:

**String & HTML Manipulation:**

- `Utils.getString(str)`: Safely converts any variable to a string without crashing.
- `Utils.escapeRegex(str)`: Escapes regex special characters in a string.
- `Utils.escapeHTML(str)`: Escapes HTML characters.
- `Utils.stripHTML(htmlContent)`: Strips HTML tags from a string.
- `Utils.normalize(message)`: Normalizes a string for searching.
- `Utils.html(strings, ...args)`: Template string tag function for automatically escaping HTML.
- `Utils.escapeHTMLForceWrap(text)`: Escapes HTML and allows long words to wrap.
- `Utils.forceWrap(text)`: Inserts zero-width spaces to force long words to wrap.
- `Utils.formatOrder(place)`: Returns the ordinal string for a number (e.g., 1st, 2nd).

**Arrays, Objects & Sorting:**

- `Utils.shuffle(arr)`: In-place array shuffle (Fisher-Yates).
- `Utils.randomElement(arr)`: Returns a random element from an array.
- `Utils.sortBy(array, callback?)`: Sorts an array using a smart comparator.
- `Utils.compare(a, b)`: Smart comparator for sorting (numbers low-to-high, strings A-Z, booleans true-first).
- `Utils.splitFirst(str, delimiter, limit)`: Splits a string a limited number of times.
- `Utils.deepClone(obj)`: Deeply clones an object or array.
- `Utils.deepFreeze(obj)`: Deeply freezes an object or array.

**Numbers & Math:**

- `Utils.clampIntRange(num, min, max)`: Forces a number to be an integer within a range.
- `Utils.parseExactInt(str)`: Like parseInt, but strict.
- `Utils.levenshtein(s, t, l)`: Calculates Levenshtein distance between two strings.

**Async & Environment:**

- `Utils.waitUntil(time)`: Returns a Promise that resolves at a specific timestamp.
- `Utils.clearRequireCache(options)`: Clears Node.js require cache.

**Data Formats & Structures:**

- `Utils.Multiset`: A specialized Map subclass for counting items (e.g., set.add(key) increments count).
- `Utils.formatSQLArray(arr, args)`: Helper for formatting SQL query variables.
- `Utils.bufFromHex(hex)`, `Utils.bufWriteHex(buf, hex)`, `Utils.bufReadHex(buf)`: Helpers for dealing with hex strings and Uint8Arrays.

---

## 14. Command Permissions

Never assume a command is safe just because it is hidden. Always explicitly check a user's permissions at the very top of sensitive commands using `this.checkCan('permission')` (e.g., `this.checkCan('lock')`) before executing any logic.

Here are the required permissions you should check for each target rank group (as defined in `config/config-example.js`):

| Rank | Symbol | Permission Check |
|---|---|---|
| Administrator | `~` | `this.checkCan('bypassall')` |
| Leader | `&` | `this.checkCan('bypassall')` |
| Room Owner | `#` | `this.checkCan('roommod')` |
| Moderator | `@` | `this.checkCan('globalban')` |
| Driver | `%` | `this.checkCan('lock')` |
| Voice | `+` | `this.checkCan('show')` |

---

## 15. Preferences

**1.** Prefer using `throw new Chat.ErrorMessage` instead of legacy `this.errorReply()` for chat error handling.

**Bad:**

```typescript
if (!targetUser) {
    return this.errorReply("User not found.");
}
```

**Good:**

```typescript
if (!targetUser) {
    throw new Chat.ErrorMessage("User not found.");
}
```

---

**2.** Prefer using `this.sendReply` with `|html|` instead of `this.sendReplyBox` unless you specifically want the box border that `this.sendReplyBox` provides.

**Bad:**

```typescript
this.sendReplyBox(`<b>Welcome to the server!</b>`);
```

**Good:**

```typescript
this.sendReply(`|html|<b>Welcome to the server!</b>`);
```

---

**3.** Prefer using the `Table` helper function from `side-server/lib/ss-utils.ts` (e.g., `import { SSUtils } from '../../lib/ss-utils'`) instead of manually constructing HTML tables. Exceptions can be made when you need to build a specialized layout or a different kind of table that cannot be represented using the standard `Table` function.

**Bad:**

```typescript
let html = `<table><tr><th>Rank</th><th>Trainer</th></tr>`;
html += `<tr><td>#1</td><td>Ash</td></tr></table>`;
this.sendReply(`|html|${html}`);
```

**Good:**

```typescript
import { SSUtils } from '../../lib/ss-utils';

const htmlOutput = SSUtils.Table(
    "Top Trainers",
    ["Rank", "Trainer"],
    [
        ["#1", "Ash"],
    ]
);
this.sendReply(`|html|${htmlOutput}`);
```

---

**4.** Prefer using `SSUtils.nameColor(username, bold?, userGroup?)` when displaying usernames in chat boxes, logs, tables, or announcements. It automatically escapes the username against XSS vulnerabilities, retrieves usergroup/auth symbols, and applies their custom or Showdown-hashed color.

**Bad:**

```typescript
// Potential XSS vulnerability and manual HTML styling
this.sendReplyBox(`Winner: <b><font color="red">${user.name}</font></b>`);
```

**Good:**

```typescript
import { SSUtils } from '../../lib/ss-utils';

// Standard bold colored username
this.sendReplyBox(`Winner: ${SSUtils.nameColor(user.name)}`);

// Unbolded colored username
this.sendReplyBox(`Player: ${SSUtils.nameColor(user.name, false)}`);

// With rank/group symbol (~Admin, +Voice) and bolding
this.sendReplyBox(`Action performed by: ${SSUtils.nameColor(user.name, true, true)}`);
```

---

**5.** Structure command `help` handlers using `this.runBroadcast()` and a styled `this.sendReplyBox` that displays centered bold titles, horizontal divider rules (`<hr>`), subcommands, parameter formats, and required rank permissions.

**Bad:**

```typescript
help() {
    this.sendReply("/at enable - Enable autotours");
    this.sendReply("/at disable - Disable autotours");
}
```

**Good:**

```typescript
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
}
```

---

**6.** Use `SSUtils.reloadCSS()` to invalidate and refresh custom server CSS on the central Pokémon Showdown server. It defaults to using `Config.serverid` (with a `'sideserver'` fallback), or accepts an explicit server ID override.

```typescript
import { SSUtils } from '../../lib/ss-utils';

// Pings central server using Config.serverid
await SSUtils.reloadCSS();
```

