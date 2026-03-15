# Auth Handoff

**Hand off authenticated browser sessions and API keys to your AI agents — from your phone.**

Log into any website on your phone. Your bot picks up the session. Your password never leaves your device or enters a chat.

Built for the [OpenClaw](https://openclaw.ai) community and anyone running self-hosted AI agents.

---

## The Problem

You're away from your desk. Your AI agent needs to access something behind a login. You're not going to paste your Google password into Telegram.

## The Solution

Auth Handoff runs on your server (Mac Mini, VPS, etc.) alongside your agent. When the bot needs access:

1. You open the PWA on your phone (via Tailscale)
2. Tap a site — a real Chrome browser opens on your server, streamed to your phone
3. Log in normally
4. Tap **Capture** — cookies and session data are saved
5. Your agent loads those cookies and picks up right where you left off

**Your password never travels over chat. The AI never sees it.**

Also includes an **API Key Vault** — securely store API keys (OpenAI, Stripe, GitHub, etc.) encrypted on your server, retrievable by your agent via REST.

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/reececantelon/auth-handoff
cd auth-handoff
npm install
```

### 2. Launch Chrome with remote debugging

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=$HOME/.auth-handoff-chrome-profile \
  --window-size=412,915 \
  --no-first-run \
  --no-default-browser-check &
```

> **Why?** Using a real Chrome process (not headless Puppeteer) means Google and other sites treat it as a legitimate browser. No bot detection issues.

### 3. Start the server

```bash
npm start
```

The server runs on port `3847` by default.

### 4. Open on your phone

Connect via Tailscale (recommended) or local network:

```
http://[your-tailscale-ip]:3847
```

Add to your phone's home screen as a PWA for the best experience.

---

## Auto-start on macOS

Run both Chrome and the server automatically on boot:

```bash
# Install server as launchd service
# Create ~/Library/LaunchAgents/com.yourname.auth-handoff.plist
# (see docs for full plist)
launchctl load ~/Library/LaunchAgents/com.yourname.auth-handoff.plist
```

---

## Bot API

### Sessions (browser login capture)

```bash
# List all captured sessions
GET /api/sessions

# Get cookies for a session (full data)
GET /api/sessions/:id/cookies

# Get cookies in Netscape/curl format
GET /api/sessions/:id/cookies.txt

# Delete a session
DELETE /api/sessions/:id
```

### API Key Vault

```bash
# List stored keys (masked values only)
GET /api/keys

# Get a specific key (full decrypted value)
GET /api/keys/:service

# Store a key
POST /api/keys
Body: { "service": "openai", "label": "production", "value": "sk-..." }

# Delete a key
DELETE /api/keys/:service
```

### Example: Use captured session with curl

```bash
curl http://localhost:3847/api/sessions/SESSION_ID/cookies.txt -o cookies.txt
curl -b cookies.txt https://github.com/settings/profile
```

### Example: Load API key in agent

```bash
OPENAI_KEY=$(curl -s http://localhost:3847/api/keys/openai | python3 -c "import sys,json; print(json.load(sys.stdin)['value'])")
```

---

## Security

- **Tailscale only** — never expose port 3847 to the public internet
- API keys are AES-256-GCM encrypted at rest, tied to the host machine
- Session cookies are stored as JSON files — treat them like passwords
- Delete sessions and keys when no longer needed
- The `.key-salt` file is gitignored — back it up if you want to migrate keys

---

## Supported Sites (quick launch buttons)

Google, GitHub, X/Twitter, Discord, Microsoft, WordPress, Reddit, LinkedIn, Facebook, Instagram, TikTok, Slack, Notion, Airtable, HubSpot, Stripe, Vercel, Netlify, Supabase, Postiz, Mailchimp, Product Hunt, Google Analytics, Search Console, Intercom

## Supported API Key Services (40+)

OpenAI, Anthropic, Gemini, Mistral, Groq, Together AI, Perplexity, xAI, Cohere, Hugging Face, ElevenLabs, Replicate, Stability AI, Postiz, Buffer, Mailchimp, SendGrid, Resend, Loops, Beehiiv, Ahrefs, SEMrush, Plausible, PostHog, Mixpanel, Fathom, Stripe, Lemon Squeezy, Paddle, RevenueCat, GitHub, Vercel, Netlify, Supabase, Neon, Railway, Cloudflare, AWS, Fly.io, Render, Pinecone, Weaviate, Twilio, Slack, Discord Bot, Telegram Bot, Intercom, Cloudinary, Uploadthing, Backblaze, Custom

---

## License

MIT
