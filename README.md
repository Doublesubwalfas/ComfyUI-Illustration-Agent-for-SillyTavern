# ComfyUI Illustration Agent for SillyTavern

A SillyTavern extension replicating the autonomous **Doublesub Illustration Agent**.

## Features
- **Autonomous Scene Detection**: Background LLM assesses dialogue and actions to trigger art only during pivotal or visual scene changes.
- **Fast Pre-Filter (Mode 1)**: A zero-cost local heuristic scans recent turns for visual cues *before* any LLM call. Pure-dialogue turns are skipped instantly — the agent never "thinks" unless something visual actually happened. Toggleable in settings.
- **Mode 2 XML Triggering (fixed)**: `<image>` / `<scene>` tags emitted by the character are now extracted from the raw message *before* cleanup, so tag-triggered generation actually fires. If the LLM ever mangles its JSON in Mode 2, the tag text itself is used directly — no dropped illustrations. Modes 2 and 3 never run a decision step; the trigger condition is the decision.
- **Built-in ComfyUI Support**: Leverages SillyTavern's configured ComfyUI pipeline through `/imagine` or direct API integration. Numeric workflow macros (`%seed%`, `%steps%`, `%width%`, …) are injected as real JSON numbers so ComfyUI type validation passes.
- **Searchable Gallery**: Filter by character or favorites, plus a live search box that matches character names and image descriptions.
- **Mobile-Friendly Viewer**: Tapping an image on mobile opens it in a slightly smaller floating window (with a dimmed tap-to-dismiss backdrop) instead of a fullscreen takeover, and a double-tap guard prevents accidental double opens.
- **Custom Agent Prompts**: Customize scene sensitivity, art styles, and trigger word mechanics natively.

## Installation
1. In SillyTavern, open the **Extensions** menu (Three Cubes icon).
2. Click **Install Extension** and paste:
   `https://github.com/Doublesubwalfas/comfyui-illustration-agent`
3. Configure your image generation provider in SillyTavern (ComfyUI recommended).
4. Enable the agent inside the extension drawer.

## How illustrations reach the roleplay
Generated images are delivered through `deliverRoleplayImage()`:
- **Append to Assistant Turn** (default): the image markdown is appended to the latest assistant message (and its active swipe), then persisted to the chat file.
- **Separate Comment Card**: the image is injected as a `/comment` card hidden from LLM context.

Every generated image is also recorded in the Gallery with its character, description, prompts, and resolution.

## Architecture
```
comfyui-illustration-agent/
│
├── manifest.json
├── index.js
├── settings.html
├── style.css
├── README.md
│
└── src/
    ├── agent.js
    ├── chat.js
    ├── comfy.js
    ├── config.js
    └── ui.js
```

## Changelog — 2.2.0
- Fixed Mode 2: trigger tags were extracted *after* `cleanTriggerTags()` stripped them, so Mode 2 never fired. Extraction now runs on the raw message (with swipe fallback).
- Added Mode 2 JSON-parse fallback: generates directly from tag text if the LLM response is malformed.
- Added Fast Pre-Filter (Mode 1): skips the LLM decision entirely when no visual cues are present.
- Added duplicate-message guard: identical final messages are never re-evaluated.
- Reduced evaluator cost: compact context (per-message caps), `responseLength` 350, custom-API `temperature: 0` / `max_tokens: 450`.
- Gallery: live search across character names and descriptions, result counter, clear button, HTML escaping.
- Mobile: lightbox opens as an inset floating window with tap-outside backdrop; double-tap guard on gallery cards.
- ComfyUI: type-safe macro substitution (numbers stay numbers).
