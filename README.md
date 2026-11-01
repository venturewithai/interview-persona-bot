# AI Interview Agent

An AI chatbot that coaches you for **AI Product Manager**, **Forward Deployed Engineer** and **AI Researcher** interviews. Each role has its own persona, prompts, suggestions, separate conversation and a subtly different colour theme.

- Built with [Vite](https://vite.dev) (vanilla JS)
- LLM: `gemini-3.8-flash` via the Gemini REST API (streaming)
- You enter your own Gemini API key on first load (kept in the browser; "Remember on this device" optionally persists it in localStorage)

```bash
npm install
npm run dev     # local dev server
npm run build   # production build in dist/
```

The model id is set in `src/personas.js` (`MODEL`); role prompts live in the same file.

## Quiz mode
Switch **Chat → Quiz** (per role). Pick a topic, difficulty (Easy/Medium/Hard) and length (5/10); Gemini writes role-specific multiple-choice questions as JSON. Answer by click or keys A–D, see instant feedback with explanations, then a scored review (retry the same questions or start a new quiz). Quiz progress is kept per role while you switch tabs.
