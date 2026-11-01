import './style.css';
import { PERSONAS, MODEL } from './personas.js';
import { streamChat } from './gemini.js';
import { renderMarkdown } from './markdown.js';
import { renderQuiz, newQuiz, quizKey } from './quiz.js';

const KEY_STORE = 'ipb_gemini_key';
const $ = (sel, el = document) => el.querySelector(sel);

const state = {
  apiKey: sessionStorage.getItem(KEY_STORE) || localStorage.getItem(KEY_STORE) || '',
  persona: 'pm',
  // separate conversation per persona
  chats: Object.fromEntries(Object.keys(PERSONAS).map((id) => [id, []])),
  mode: 'chat', // 'chat' | 'quiz'
  quizzes: Object.fromEntries(Object.keys(PERSONAS).map((id) => [id, newQuiz()])),
  busy: false,
  abort: null,
};

const app = $('#app');
document.body.insertAdjacentHTML('afterbegin', '<div class="bg-grid"></div><div class="bg-glow"></div>');

function setPersona(id) {
  state.persona = id;
  document.documentElement.dataset.persona = id;
}

/* ---------- API key gate ---------- */
function renderGate(error = '') {
  app.innerHTML = `
    <main class="gate">
      <form class="card gate-card" id="gate-form">
        <div class="logo">◈</div>
        <h1>AI Interview Agent</h1>
        <p class="muted">Prep for AI roles with a coach tuned to each one. Enter your Gemini API key to begin.</p>
        <label for="key">Gemini API key</label>
        <input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="AIza…" required />
        <label class="check"><input type="checkbox" id="remember" /> Remember on this device</label>
        ${error ? `<p class="error">${error}</p>` : ''}
        <button class="btn primary" type="submit">Start preparing →</button>
        <p class="fine">Your key stays in your browser and is sent only to Google's Gemini API (model: <code>${MODEL}</code>).
        Get one at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>.</p>
      </form>
    </main>`;
  $('#gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const key = $('#key').value.trim();
    if (!key) return;
    state.apiKey = key;
    (($('#remember').checked ? localStorage : sessionStorage)).setItem(KEY_STORE, key);
    renderChat();
  });
  $('#key').focus();
}

function logout() {
  sessionStorage.removeItem(KEY_STORE);
  localStorage.removeItem(KEY_STORE);
  state.apiKey = '';
  state.abort?.abort();
  renderGate();
}

/* ---------- Chat ---------- */
function renderChat() {
  app.innerHTML = `
    <div class="shell">
      <header class="top">
        <div class="brand">AI Interview Agent</div>
        <nav class="tabs" id="tabs" role="tablist" aria-label="Choose the role you are interviewing for">
          ${Object.values(PERSONAS)
            .map(
              (p) => `<button role="tab" class="tab" data-id="${p.id}" title="${p.tagline}">
                <span class="tab-icon">${p.icon}</span><span class="tab-label">${p.label}</span></button>`,
            )
            .join('')}
        </nav>
        <button class="btn ghost" id="logout" title="Remove saved key">Change API key</button>
      </header>
      <div class="toolbar">
        <div class="seg" id="modes" role="tablist" aria-label="Mode">
          <button data-mode="chat" role="tab">💬 Chat</button>
          <button data-mode="quiz" role="tab">🎯 Quiz</button>
        </div>
        <div class="meta"><span id="role-tag"></span><button class="link" id="clear">Clear chat</button></div>
      </div>
      <section class="card panel">
        <div class="scroll" id="scroll">
          <div class="messages" id="messages" aria-live="polite"></div>
          <div id="quiz-root" hidden></div>
        </div>
        <button class="to-bottom" id="to-bottom" title="Jump to latest" hidden>↓</button>
        <div class="dock" id="dock">
          <div class="chips" id="chips"></div>
          <form class="composer" id="composer" title="Enter to send, Shift+Enter for a new line">
            <textarea id="input" rows="1" placeholder="Ask anything…" maxlength="8000"></textarea>
            <button class="btn primary" id="send" type="submit">Send</button>
          </form>
        </div>
      </section>
    </div>`;

  $('#logout').onclick = logout;
  $('#clear').onclick = () => {
    if (state.busy) return;
    state.chats[state.persona] = [];
    drawMessages();
  };
  $('#tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t || t.dataset.id === state.persona || state.busy) return;
    setPersona(t.dataset.id);
    refresh();
    if (state.mode === 'chat') $('#input').focus();
  });
  $('#modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === state.mode || state.busy) return;
    state.mode = b.dataset.mode;
    refresh();
    if (state.mode === 'chat') $('#input').focus();
  });
  const scroller = $('#scroll');
  scroller.addEventListener('scroll', updateJump, { passive: true });
  $('#to-bottom').onclick = () => scroller.scrollTo({ top: scroller.scrollHeight });

  const input = $('#input');
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) send(text);
  });
  $('#chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c) send(c.textContent);
  });
  setPersona(state.persona);
  refresh();
  input.focus();
}

function onQuizKey(e) {
  if (state.mode !== 'quiz' || !$('#quiz-root') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
  if (quizKey(quizCtx(), e)) e.preventDefault();
}

function quizCtx() {
  const personaId = state.persona;
  return {
    personaId,
    quiz: state.quizzes[personaId],
    apiKey: state.apiKey,
    rerender: () => {
      // ignore async results that land after the user moved to another role/mode
      if (state.mode === 'quiz' && state.persona === personaId && $('#quiz-root')) drawQuiz();
    },
  };
}

function drawQuiz() {
  renderQuiz($('#quiz-root'), quizCtx());
}

/** Re-sync every part of the UI with state.persona / state.mode. */
function refresh() {
  const quiz = state.mode === 'quiz';
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.id === state.persona;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.mode));
  $('#role-tag').textContent = PERSONAS[state.persona].tagline;
  $('#clear').hidden = quiz;
  $('#messages').hidden = quiz;
  $('#dock').hidden = quiz;
  $('#quiz-root').hidden = !quiz;
  if (quiz) drawQuiz();
  else drawMessages();
  updateJump();
}

function updateJump() {
  const s = $('#scroll');
  const away = state.mode === 'chat' && s.scrollHeight - s.scrollTop - s.clientHeight > 160;
  $('#to-bottom').hidden = !away;
}

function autosize() {
  const el = $('#input');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function bubble(m) {
  const body = m.role === 'model' ? renderMarkdown(m.text) : `<p>${escapeHtml(m.text)}</p>`;
  return `<div class="msg ${m.role}${m.error ? ' err' : ''}"><div class="bubble">${body}</div></div>`;
}
const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function drawMessages() {
  const p = PERSONAS[state.persona];
  const msgs = state.chats[state.persona];
  $('#messages').innerHTML = bubble({ role: 'model', text: p.greeting }) + msgs.map(bubble).join('');
  $('#chips').innerHTML = msgs.length
    ? ''
    : p.suggestions.map((s) => `<button class="chip" type="button">${escapeHtml(s)}</button>`).join('');
  const sc = $('#scroll');
  sc.style.scrollBehavior = 'auto';
  sc.scrollTop = sc.scrollHeight;
  sc.style.scrollBehavior = '';
  updateJump();
}

async function send(text) {
  if (state.busy) return;
  const personaId = state.persona;
  const persona = PERSONAS[personaId];
  const chat = state.chats[personaId];
  chat.push({ role: 'user', text });
  const reply = { role: 'model', text: '' };
  chat.push(reply);
  $('#input').value = '';
  autosize();
  drawMessages();
  setBusy(true);

  state.abort = new AbortController();
  const live = () => state.persona === personaId && state.mode === 'chat' && $('#messages');
  const paint = () => {
    const box = live();
    if (!box) return;
    const sc = $('#scroll');
    const stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120; // only follow if user is near the bottom
    const last = box.lastElementChild;
    if (last) last.outerHTML = bubble(reply.text ? reply : { ...reply, text: '…' }).replace('class="msg', 'class="msg typing');
    if (stick) {
      sc.style.scrollBehavior = 'auto';
      sc.scrollTop = sc.scrollHeight;
      sc.style.scrollBehavior = '';
    }
    updateJump();
  };
  paint();

  try {
    await streamChat({
      apiKey: state.apiKey,
      system: persona.system,
      history: chat.slice(0, -1).filter((m) => !m.error && !m.failed),
      signal: state.abort.signal,
      onToken: (t) => {
        reply.text += t;
        paint();
      },
    });
    if (!reply.text) reply.text = '_(No response received.)_';
  } catch (err) {
    if (err.name === 'AbortError') return;
    const authFail = err.status === 400 || err.status === 401 || err.status === 403;
    reply.error = true;
    reply.text = `⚠️ ${err.message}${authFail ? '\n\nCheck that your API key is valid — use "Change API key" at the top.' : ''}`;
  } finally {
    if (reply.error) chat[chat.indexOf(reply) - 1].failed = true;
    setBusy(false);
    if (live()) {
      const sc = $('#scroll');
      const top = sc.scrollTop;
      drawMessages();
      sc.scrollTop = top;
      updateJump();
    }
  }
}

function setBusy(b) {
  state.busy = b;
  const send = $('#send');
  if (send) {
    send.disabled = b;
    send.textContent = b ? '…' : 'Send';
  }
  document.querySelectorAll('.tab, [data-mode]').forEach((t) => (t.disabled = b));
}

document.addEventListener('keydown', onQuizKey);
setPersona(state.persona);
state.apiKey ? renderChat() : renderGate();
