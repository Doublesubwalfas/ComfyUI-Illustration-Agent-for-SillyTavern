# ComfyUI Illustration Agent for SillyTavern

A SillyTavern extension replicating the autonomous **Illustrator Agent** from Marinara Engine.

## Features
- **Autonomous Scene Detection**: Background LLM assesses dialogue and actions to trigger art only during pivotal or visual scene changes.
- **Built-in ComfyUI Support**: Leverages SillyTavern's configured ComfyUI pipeline through `/imagine`.
- **Custom Agent Prompts**: Customize scene sensitivity and art styles.

## Installation
1. In SillyTavern, open the **Extensions** menu (Three Cubes icon).
2. Click **Install Extension** and paste:
   `https://github.com/Doublesubwalfas/comfyui-illustration-agent`
3. Configure your image generation provider in SillyTavern (ComfyUI recommended).
4. Enable the agent inside the extension drawer.