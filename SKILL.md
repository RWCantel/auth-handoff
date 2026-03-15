---
name: auth-handoff
description: Securely load authenticated browser sessions and API keys captured via the Auth Handoff PWA. Use when: (1) you need to access a site that requires login and the user has captured a session, (2) you need to retrieve a stored API key (OpenAI, Stripe, GitHub, etc.), (3) the user says they've logged in via Auth Handoff and you need to pick up the session. Auth Handoff runs as a local server on the user's machine (default port 3847). Do NOT use for sites where the user hasn't captured a session yet — ask them to open the PWA first.
---

# Auth Handoff

Local server that captures authenticated browser sessions and API keys from the user's phone, making them available to agents via REST API.

## Check available sessions/keys

```bash
curl http://localhost:3847/api/sessions
curl http://localhost:3847/api/keys
```

## Load a captured session into browser

```bash
# Get cookies and save to file
curl http://localhost:3847/api/sessions/{SESSION_ID}/cookies.txt -o /tmp/cookies.txt

# Use with curl
curl -b /tmp/cookies.txt https://target-site.com

# Or inject into OpenClaw browser via evaluate
SESSION=$(curl -s http://localhost:3847/api/sessions/{SESSION_ID}/cookies)
```

## Get an API key

```bash
# Returns { service, label, value, savedAt }
curl http://localhost:3847/api/keys/{service}

# Example: get OpenAI key
KEY=$(curl -s http://localhost:3847/api/keys/openai | python3 -c "import sys,json; print(json.load(sys.stdin)['value'])")
```

## Service IDs for API keys

openai, anthropic, gemini, mistral, groq, together, perplexity, xai, cohere, huggingface, elevenlabs, replicate, stability, postiz, buffer, mailchimp, sendgrid, resend, loops, beehiiv, ahrefs, semrush, plausible, posthog, mixpanel, fathom, stripe, lemonsqueezy, paddle, revenuecat, github, vercel, netlify, supabase, neon, railway, cloudflare, aws, flyio, render, pinecone, weaviate, twilio, slack, discord, telegram, intercom, cloudinary, uploadthing, backblaze, custom

## If user hasn't captured a session yet

Tell them:
> "Open Auth Handoff on your phone at `http://[your-tailscale-ip]:3847`, log into [site], and tap Capture. Then let me know and I'll pick up the session."

## Security notes

- Server only accessible via Tailscale or local network — never public internet
- API keys are AES-256 encrypted at rest on the host machine
- Sessions contain real auth tokens — use and delete promptly
