# ComfyUI Illustration Agent for SillyTavern (v3)

An autonomous illustration agent: it **senses** each reply for free, **decides** with one cheap LLM call only when
something visual happened, then **acts** through a serialized ComfyUI queue and attaches the result to the right message.

## Install
Extensions → Install extension → `https://github.com/Doublesubwalfas/comfyui-illustration-agent`

## How the agent runs
1. **Sense (local, free).** A keyword scorer reads only the narration (quoted speech is ignored) plus your last message.
   Pure dialogue never reaches the LLM. A cooldown stops back-to-back images.
2. **Decide (one LLM call).** Mode 1 asks "is this a visual beat?" and returns the prompt in the same call.
   Mode 2 runs only when the roleplay model writes `<image>`/`<scene>` (the instruction is injected automatically).
   Mode 3 runs every N assistant messages. Use a *Connection Profile* to give the agent a small, fast model.
3. **Act (queued).** Jobs run one at a time. The target message is captured when the decision is made, so the image
   lands on the correct message even if you keep chatting or switch chats while it renders.

Reroll reuses the stored prompt with a new seed (no LLM call) and swaps the image in place.
The wand button on every assistant message illustrates that specific message.

## Why images now work on mobile
v2 let the *browser* call ComfyUI and then saved a `http://127.0.0.1:8188/...` link, which only exists on the PC.
v3 sends generation through the SillyTavern server (`/api/sd/comfy/generate`), saves the PNG on the server
(`/api/images/upload`) and stores a normal `/user/images/...` path, so every device can load it.
Set **ComfyUI URL** to the address as seen from the *SillyTavern host* (usually `http://127.0.0.1:8188`).

Images made by v2 can be copied across once with **Settings → Gallery and storage → Repair old images**
(press it on the PC that runs ComfyUI, while ComfyUI is running).

## Gallery and viewer
Thumbnails, infinite scroll, search (name, caption, prompt), favorites, long-press to multi-select.
The viewer is full-screen: pinch / double-tap zoom, swipe left-right to browse, swipe down to close,
tap to hide controls, big touch targets, and a tap-through guard. The floating bubble is draggable, remembers
its position and comes back automatically when the gallery closes.

## Layout
```
manifest.json  index.js  style.css  README.md
src/ agent.js  chat.js  comfy.js  config.js  prefilter.js
     gallery.js  dialogs.js  ui.js  bus.js  util.js
```
(`settings.html` was never loaded by SillyTavern and has been removed; the panel is built in `ui.js`.)
