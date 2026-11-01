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
