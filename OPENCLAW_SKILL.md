# Auth Handoff — OpenClaw Skill

## Description
Loads authenticated browser sessions captured via the Auth Handoff PWA. 
When a user needs to give their bot access to a logged-in website, the bot 
sends them a link to authenticate on their phone, then picks up the session.

## Usage

### Request authentication from user
When you need to access a site that requires login, tell the user:

"I need access to [site]. Tap this link to log in securely — your password 
never touches this chat: https://[tailscale-ip]:3847"

### Load captured cookies
Once the user has captured a session, load it into your browser:

```bash
# List available sessions
curl http://localhost:3847/api/sessions

# Get cookies for a specific session as JSON
curl http://localhost:3847/api/sessions/{SESSION_ID}/cookies

# Get cookies in Netscape/curl format (for curl -b)
curl http://localhost:3847/api/sessions/{SESSION_ID}/cookies.txt -o cookies.txt

# Use the cookies with curl
curl -b cookies.txt https://drive.google.com/...
```

### Load cookies into Puppeteer/Playwright
```javascript
const response = await fetch('http://localhost:3847/api/sessions/{SESSION_ID}/cookies');
const data = await response.json();

// Puppeteer
for (const cookie of data.cookies) {
  await page.setCookie(cookie);
}

// Playwright
await context.addCookies(data.cookies);
```

### Load cookies into OpenClaw browser
If OpenClaw uses a browser session, inject the cookies before navigating:

```python
import requests
import json

# Fetch session cookies
resp = requests.get("http://localhost:3847/api/sessions/{SESSION_ID}/cookies")
session_data = resp.json()

# The cookies array is in Puppeteer format, ready to inject
cookies = session_data["cookies"]

# localStorage and sessionStorage are also available:
local_storage = session_data.get("storage", {}).get("localStorage", {})
session_storage = session_data.get("storage", {}).get("sessionStorage", {})
```

## Session Data Format
```json
{
  "id": "uuid",
  "name": "accounts.google.com",
  "url": "https://myaccount.google.com/",
  "originalUrl": "https://accounts.google.com",
  "domain": "myaccount.google.com",
  "capturedAt": "2026-03-15T10:30:00.000Z",
  "cookies": [
    {
      "name": "cookie_name",
      "value": "cookie_value",
      "domain": ".google.com",
      "path": "/",
      "expires": 1742000000,
      "httpOnly": true,
      "secure": true,
      "sameSite": "None"
    }
  ],
  "storage": {
    "localStorage": {},
    "sessionStorage": {}
  }
}
```

## Security Notes
- Sessions are stored as JSON files in the `sessions/` directory on the host machine
- The Auth Handoff server should only be accessible via Tailscale or local network
- Sessions contain real auth tokens — treat them like passwords
- Delete sessions when no longer needed via the UI or API
- Cookies expire naturally based on the site's TTL
