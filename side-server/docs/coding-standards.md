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

## 13. Chat Methods & Error Handling

Always leverage built-in `Chat.*` methods for error handling, text formatting, and data presentation instead of implementing custom logic:

### Error Handling & Flow Control

- Use `throw new Chat.ErrorMessage("Error message")` for validation failures. This immediately halts execution and displays the error message in red to the user.
- Use `throw new Chat.Interruption()` to silently halt execution (useful when you have already sent a custom popup or view).

**Bad:**

```typescript
if (!target) {
    this.errorReply("Please specify a user.");
    return;
}
```

**Good:**

```typescript
if (!target) throw new Chat.ErrorMessage("Please specify a user.");
```

### Text & List Formatting

- **Pluralization & Counting:** Use `Chat.count(amount, "coins")` (e.g. "1 coin", "5 coins") or `Chat.plural(amount)` for suffixes.
- **Sentence Lists:** Use `Chat.toListString(array)` for "A, B, and C" or `Chat.toOrList(array)` for "A, B, or C".
- **PS Markdown Parsing:** Use `Chat.formatText(text)` to parse bold, italics, spoilers, and greentext into HTML, or `Chat.stripFormatting(text)` to remove them.
- **HTML Cleanup:** Use `Chat.stripHTML(html)` to remove HTML tags, or `Chat.collapseLineBreaksHTML(html)` to collapse multiline HTML for chat protocols.
- **Folding Blocks:** Use `Chat.getReadmoreBlock(text)` or `Chat.getReadmoreCodeBlock(code)` for expandable `<details>` folds.

### Time & Duration

- **Timestamps:** Use `Chat.toTimestamp(new Date())` for "YYYY-MM-DD HH:mm:ss" formatted strings (pass `{ human: true }` for 12-hour clock).
- **Durations:** Use `Chat.toDurationString(ms)` to convert milliseconds into human-readable duration strings (e.g. "2 days 4 hours").

### Validation & Page Updates

- Use `Chat.validateRegex(pattern)` to validate user-supplied regular expressions and prevent crashes.
- Use `Chat.refreshPageFor(pageid, roomid)` to automatically refresh active `/join view-*` pages for users in a room.

> Refer to `server/chat.ts` for complete details.

---

## 14. Users Methods & State

Always use the global `Users` namespace to safely search for users, check account trust, and inspect connected server state:

### User Lookup & Discovery

- Use `Users.get(nameOrId)` to retrieve an online user by name or ID (case-insensitive, fuzzy match). Returns `User | null`.
- Use `Users.getExact(nameOrId)` to retrieve an online user strictly by their exact ID.
- Use `Users.isUsernameKnown(name)` to check if a username has connected recently or is recognized in cache.

**Bad:**

```typescript
const targetUser = Users.users.get(target); // May miss case or identity variations
```

**Good:**

```typescript
const targetUser = Users.get(target);
if (!targetUser) throw new Chat.ErrorMessage("User is offline.");
```

### Account Trust & Eligibility

- Use `Users.isTrusted(user)` to check if a user is trusted (staff, voiced, or autoconfirmed, useful for lottery, claim, or minigame eligibility).

### Server State & Metrics

- Use `Users.onlineCount` to get the total number of connected users.
- Use `Users.users` to iterate over active connected users (`Users.users.get(userid)`).
- Use `Users.prevUsers` to check recently disconnected users (useful for reconnection grace periods).

> Refer to `server/users.ts` for complete details.

---

## 15. Utils Methods & General Helpers

Unlike `Chat` and `Users`, `Utils` is NOT global and must be imported (`import { Utils } from '../../lib';`). Always leverage `Utils.*` methods for HTML safety, data structures, array operations, and math:

### HTML & Security

- Use `Utils.escapeHTML(str)` to sanitize raw user input and prevent XSS vulnerabilities in chat boxes.
- Use `` Utils.html`<b>${user.name}</b>` `` as a template literal tag to automatically escape all interpolated variables.
- Use `Utils.escapeRegex(str)` when building dynamic RegExp queries from user input.

**Bad:**

```typescript
this.sendReplyBox(`<b>${user.name}</b> won the game!`); // Vulnerable to XSS
```

**Good:**

```typescript
this.sendReplyBox(Utils.html`<b>${user.name}</b> won the game!`);
```

### String & Target Parsing

- Use `Utils.splitFirst(str, delimiter, limit?)` to split a string only on the first N delimiters (e.g. `Utils.splitFirst("user, arg1, arg2", ",")` -> `["user", "arg1, arg2"]`).
- Use `Utils.getString(val)` for safe string coercion that is guaranteed never to crash on null or untrusted objects.
- Use `Utils.forceWrap(text)` or `Utils.escapeHTMLForceWrap(text)` to insert break hints (`<wbr />`) for long unbroken strings inside tables.

### Array & Data Manipulation

- Use `Utils.sortBy(array, callback)` to sort numbers, strings, or objects reliably (regular `Array.prototype.sort` converts numbers to strings).
- Use `Utils.randomElement(array)` to pick a random item from an array.
- Use `Utils.shuffle(array)` to perform an in-place Fisher-Yates shuffle.
- Use `Utils.deepClone(obj)` to create safe, decoupled copies of nested objects/arrays.
- Use `Utils.Multiset` for managing counted item inventories, tallies, or token pools.

### Math & Parsing

- Use `Utils.parseExactInt(str)` for strict integer validation that rejects non-numeric characters (returns `NaN` for `"123abc"`).
- Use `Utils.clampIntRange(num, min?, max?)` to clamp and floor numbers within boundaries.
- Use `Utils.formatOrder(place)` to convert numbers to ordinals (e.g. 1 -> "1st", 2 -> "2nd", 3 -> "3rd").
- Use `Utils.levenshtein(str1, str2)` for fast edit distance calculations to provide typo suggestions and fuzzy searching in shops/commands.

> Refer to `lib/utils.ts` for complete details.

---

## 16. Command Permissions

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

## 17. Side Server Utilities (`ss-utils.ts`)

For custom Side Server formatting and UI components, import helpers from [`side-server/lib/ss-utils.ts`](file:///home/ubuntu/side-server/side-server/lib/ss-utils.ts) (via `../lib/ss-utils`):

### Colored Usernames (`nameColor`)

Always use `nameColor(username, bold?, userGroup?)` when displaying usernames in chat boxes, logs, tables, or announcements. It automatically escapes the username against XSS vulnerabilities, retrieves usergroup/auth symbols, and applies their custom or Showdown-hashed color:

```typescript
import { nameColor } from '../lib/ss-utils';

// Standard bold colored username
this.sendReplyBox(`Winner: ${nameColor(user.name)}`);

// Unbolded colored username
this.sendReplyBox(`Player: ${nameColor(user.name, false)}`);

// With rank/group symbol (~Admin, +Voice) and bolding
this.sendReplyBox(`Action performed by: ${nameColor(user.name, true, true)}`);
```

### Structured HTML Tables (`Table`)

Use `Table(title, headerRow, dataRows)` to construct clean, dark-mode compatible HTML tables without manually handwriting table markup:

```typescript
import { Table } from '../lib/ss-utils';

const htmlOutput = Table(
	"Top Trainers",
	["Rank", "Trainer", "Points"],
	[
		["#1", nameColor("Ash"), "1,500"],
		["#2", nameColor("Red"), "1,420"],
	]
);

this.sendReplyBox(htmlOutput);
```

Exceptions can be made when you need to build a specialized layout or a different kind of table that cannot be represented using the standard `Table` function.


