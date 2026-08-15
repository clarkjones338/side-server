# Side Server Developer Guide: HTML & CSS Sanitization

As a developer writing custom chat-plugins, UI components, or styles for the **Side Server**, you need to understand how Pokémon Showdown processes and sanitizes HTML and CSS. 

If you have ever experienced broken layouts, disappearing CSS styles, stripped inline tags, or failing command buttons, it is usually due to the multi-stage sanitization pipeline.

Here is an in-depth breakdown of what happens to your HTML and CSS between your plugin code and the client's screen.

---

## 1. Handling User Input (Preventing XSS)

When writing a chat command that takes arbitrary user input and displays it back to the room (e.g. custom profiles, shop listings, announcements, logs, or leaderboard ranks), **you are responsible for escaping it**.

If user-provided text is concatenated directly into `this.sendReplyBox()` or HTML strings without escaping, malicious users can inject `<script>`, `<img onerror=...>`, or malicious HTML to attack users in the room.

### Developer Rules:
1. Always sanitize raw user input using `Utils.escapeHTML()` or the `Utils.html` template tag.
2. Never trust input originating from `target`, `user.name`, database strings, or external network requests.

```typescript
import { Utils } from '../../lib';

// ❌ BAD: High XSS Vulnerability
this.sendReplyBox(`<div>Welcome back, ${user.name}! Status: ${target}</div>`);

// ✅ GOOD: Safe with Utils.escapeHTML()
this.sendReplyBox(`<div>Welcome back, ${Utils.escapeHTML(user.name)}! Status: ${Utils.escapeHTML(target)}</div>`);

// ✅ GOOD: Safe with Utils.html template tag
this.sendReplyBox(Utils.html`<div>Welcome back, ${user.name}! Status: ${target}</div>`);
```

---

## 2. Server-Side Validation (`this.checkHTML`)

If you are developing a command that explicitly allows privileged users to broadcast custom HTML (like announcements, broadcasts, or tournament brackets), the server evaluates the markup via `this.checkHTML(html)`.

### Strict Server-Side Validation Rules:
* **Strict Tag Balancing:** Every opened tag must be properly closed and balanced (e.g. `<div><span></span></div>`). Unclosed or mismatched tags cause `checkHTML` to reject the message with a runtime error.
* **Image Dimensions Requirement:** All `<img>` tags **must** specify valid numeric `width` and `height` attributes (or inline CSS dimensions). This prevents chat viewports from jumping/jittering when images load asynchronously.
* **HTTPS & Allowed Protocols:** All external media sources (`src`, `href`) must use `https://` or standard protocol-relative `//` URLs. Insecure `http://` or `javascript:` URLs are automatically blocked.
* **Banned Phishing Phrases:** Phrases like `"click here"` or `">here<"` within links are strictly flagged and rejected to prevent social engineering/phishing.

---

## 3. Client-Side Sanitization (Google Caja)

Even after passing server checks, the Pokémon Showdown web client passes all incoming HTML through a client-side DOM sanitizer based on **Google Caja HTML Sanitizer**.

The client sanitizer evaluates every single HTML tag, attribute, and CSS rule against strict security policies:

### Tag Whitelist & Blacklist:
* **Allowed Tags:** `<div>`, `<span>`, `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`, `<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<s>`, `<small>`, `<p>`, `<br>`, `<hr>`, `<ul>`, `<ol>`, `<li>`, `<h1>`-`<h6>`, `<details>`, `<summary>`, `<code>`, `<pre>`, `<button>`, `<a>`, `<img>`, `<progress>`, `<meter>`, `<psicon>`.
* **Stripped / Forbidden Tags:** `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<applet>`, `<link>`, `<meta>`, `<base>`, `<form>`, `<input>`, `<textarea>`, `<select>`. Any of these tags will be stripped out entirely on the client.

### CSS & Inline Style Sanitization:
Inline `style="..."` attributes are thoroughly parsed and stripped if they violate layout containment:
* **Stripped Positioning:** `position: fixed` is **always stripped** to prevent elements from breaking outside the chat box and covering the battle screen or UI menus.
* **Absolute Positioning Caution:** `position: absolute` is only respected if contained within a wrapper element that has `position: relative` or `overflow: hidden`.
* **Event Handlers:** All inline JavaScript event handlers (such as `onclick=...`, `onload=...`, `onerror=...`, `onmouseover=...`) are stripped by the client parser.
* **CSS Escapes & Expressions:** CSS `expression(...)`, `behavior: ...`, and `javascript:` URIs inside `style` attributes are sanitized and discarded.

---

## 4. Pokémon Showdown Protocol-Specific Elements

Because raw `<script>` tags and `onclick` handlers are stripped, Pokémon Showdown provides built-in protocol attributes to enable safe, interactive UI elements:

### Command Buttons
Showdown handles buttons natively through the `name` and `value` attributes:
* **`name="send"`**: Sends and executes a command on behalf of the user when clicked.
* **`name="parse"`**: Inserts a command into the user's chat input bar without immediately submitting it.

```html
<!-- Automatically sends the command /buy potion -->
<button name="send" value="/buy potion" class="button">Buy Potion</button>

<!-- Fills the chat input with /trade and waits for user to finish typing -->
<button name="parse" value="/trade " class="button">Trade User</button>
```

### Dex Mini-Icons (`<psicon>`)
Showdown provides native custom elements for lightweight Pokémon and Item sprite rendering:
```html
<!-- Renders a mini sprite icon for Pikachu -->
<psicon pokemon="pikachu" />

<!-- Renders an item sprite icon for Leftovers -->
<psicon item="leftovers" />
```

### Collapsible Folders (`<details>` / `<summary>`)
Use standard HTML5 collapsible disclosure elements for long lists or secondary details:
```html
<details class="readmore">
    <summary>Click to view full inventory (15 items)</summary>
    <div class="pad">Item 1, Item 2, Item 3...</div>
</details>
```

---

## 5. Side Server Styling & Custom CSS

To avoid hitting inline CSS limits and ensure seamless dark-mode support, use the side-server's built-in CSS stylesheets located in [`side-server/css/`](file:///home/ubuntu/side-server/side-server/css).

### Using the Side-Server Table Component:
The [`side-server/css/table.css`](file:///home/ubuntu/side-server/side-server/css/table.css) stylesheet provides responsive, dark-mode compatible styling for all tables and leaderboards:

```html
<div class="ss-table-container">
    <h3 class="ss-table-title">Top Trainers</h3>
    <table class="ss-table">
        <tr class="ss-table-header">
            <th>Rank</th>
            <th>Trainer</th>
            <th>Points</th>
        </tr>
        <tr class="ss-table-row">
            <td>#1</td>
            <td>Ash</td>
            <td>1,500</td>
        </tr>
    </table>
</div>
```

### Prefer Helper Functions:
Instead of handwriting HTML table tags and risking unbalanced markup, always use the automated builders in [`side-server/lib/ss-utils.ts`](file:///home/ubuntu/side-server/side-server/lib/ss-utils.ts):

```typescript
import { Table } from '../lib/ss-utils';

const htmlOutput = Table(
    "Top Trainers",
    ["Rank", "Trainer", "Points"],
    [
        ["#1", "Ash", "1,500"],
        ["#2", "Red", "1,420"],
    ]
);

this.sendReplyBox(htmlOutput);
```

---

## 6. Developer Checklist for Clean UI Output

Before deploying any chat plugin with HTML/CSS output:
1. [ ] **Escape User Data:** Did you wrap all dynamic user text with `Utils.escapeHTML()` or `Utils.html`?
2. [ ] **Balanced Tags:** Are all opened HTML tags explicitly closed in the correct order?
3. [ ] **Image Dimensions:** Do all `<img>` tags have explicit `width` and `height` attributes?
4. [ ] **HTTPS Protocol:** Are all external image and link URLs strictly using `https://`?
5. [ ] **No Inline Scripting:** Did you use `<button name="send" value="...">` instead of trying to use `onclick`?
6. [ ] **Containment Safe:** Did you avoid using `position: fixed` and uncontained absolute coordinates?
7. [ ] **Dark Mode Support:** Did you test how your UI looks in both standard Light mode and Showdown Dark mode?
