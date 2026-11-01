import { PERSONAS } from './personas.js';
import { generateJson } from './gemini.js';
import { renderMarkdown } from './markdown.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const LETTERS = ['A', 'B', 'C', 'D'];
const DIFFS = ['Easy', 'Medium', 'Hard'];
const COUNTS = [5, 10];

export const newQuiz = () => ({ phase: 'setup', topic: 'Mixed', difficulty: 'Medium', count: 5, questions: [], i: 0, picks: [], error: '' });

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Validate model output and shuffle options so the answer isn't always in the same slot. */
function normalize(data) {
  const list = Array.isArray(data) ? data : data?.questions;
  if (!Array.isArray(list)) return [];
  return list
    .map((q) => {
      const opts = Array.isArray(q?.options) ? q.options.map(String).slice(0, 4) : [];
      const ans = Number.isInteger(q?.answer) ? q.answer : LETTERS.indexOf(String(q?.answer).trim().toUpperCase());
      if (!q?.question || opts.length < 2 || ans < 0 || ans >= opts.length) return null;
      const order = shuffle(opts.map((_, i) => i));
      return {
        question: String(q.question),
        options: order.map((i) => opts[i]),
        answer: order.indexOf(ans),
        explanation: String(q.explanation ?? ''),
      };
    })
    .filter(Boolean);
}

/**
 * Renders the quiz UI for the current persona into `root`.
 * ctx: { personaId, quiz, apiKey, rerender() }
 */
export function renderQuiz(root, ctx) {
  const { quiz: z, personaId } = ctx;
  const persona = PERSONAS[personaId];
  const q = z.questions[z.i];

  if (z.phase === 'setup') {
    root.innerHTML = `<div class="quiz">
      <div><h2>${esc(persona.label)} quiz</h2>
      <p class="muted" style="margin:6px 0 0">Test yourself with multiple-choice questions written for this role. Pick a focus area and go.</p></div>
      <div><h3>Topic</h3><div class="opts" data-g="topic">${['Mixed', ...persona.topics]
        .map((t) => `<button class="opt-chip${t === z.topic ? ' on' : ''}" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
      <div><h3>Difficulty</h3><div class="opts" data-g="difficulty">${DIFFS
        .map((d) => `<button class="opt-chip${d === z.difficulty ? ' on' : ''}" data-v="${d}">${d}</button>`).join('')}</div></div>
      <div><h3>Questions</h3><div class="opts" data-g="count">${COUNTS
        .map((n) => `<button class="opt-chip${n === z.count ? ' on' : ''}" data-v="${n}">${n}</button>`).join('')}</div></div>
      ${z.error ? `<p class="error">⚠️ ${esc(z.error)}</p>` : ''}
      <div><button class="btn primary" id="qstart">Start quiz →</button></div>
    </div>`;
    root.querySelectorAll('.opts').forEach((g) =>
      g.addEventListener('click', (e) => {
        const b = e.target.closest('.opt-chip');
        if (!b) return;
        const k = g.dataset.g;
        z[k] = k === 'count' ? Number(b.dataset.v) : b.dataset.v;
        g.querySelectorAll('.opt-chip').forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    root.querySelector('#qstart').onclick = () => generate(ctx);
    return;
  }

  if (z.phase === 'loading') {
    root.innerHTML = `<div class="quiz"><div class="loading"><div class="spin"></div>
      <div>Writing ${z.count} ${esc(z.difficulty.toLowerCase())} questions on ${esc(z.topic)}…</div></div></div>`;
    return;
  }

  if (z.phase === 'play') {
    const picked = z.picks[z.i];
    const done = picked !== undefined;
    root.innerHTML = `<div class="quiz">
      <div class="qhead"><span>Question ${z.i + 1} of ${z.questions.length} · ${esc(z.topic)}</span>
        <span>Score ${score(z)}</span></div>
      <div class="bar"><i style="width:${(z.i / z.questions.length) * 100}%"></i></div>
      <p class="qtext">${esc(q.question)}</p>
      <div class="answers">${q.options.map((o, i) => {
        let cls = '';
        if (done) cls = i === q.answer ? ' correct' : i === picked ? ' wrong' : ' dim';
        return `<button class="ans${cls}" data-i="${i}" ${done ? 'disabled' : ''}><span class="k">${LETTERS[i]}</span><span>${esc(o)}</span></button>`;
      }).join('')}</div>
      ${done ? `<div class="explain"><b>${picked === q.answer ? '✓ Correct.' : '✗ Not quite.'}</b> ${renderMarkdown(q.explanation || `The correct answer is ${LETTERS[q.answer]}.`)}</div>` : ''}
      <div class="qfoot"><button class="btn ghost" id="qquit">Quit quiz</button>
        ${done ? `<button class="btn primary" id="qnext">${z.i + 1 === z.questions.length ? 'See results' : 'Next question →'}</button>` : '<span class="fine">Pick an answer (or press A–D)</span>'}</div>
    </div>`;
    root.querySelector('.answers').addEventListener('click', (e) => {
      const b = e.target.closest('.ans');
      if (b && !done) pick(ctx, Number(b.dataset.i));
    });
    root.querySelector('#qquit').onclick = () => reset(ctx);
    root.querySelector('#qnext')?.addEventListener('click', () => next(ctx));
    root.closest('.scroll')?.scrollTo({ top: 0 });
    return;
  }

  // result
  const total = z.questions.length;
  const s = score(z);
  const pct = Math.round((s / total) * 100);
  const verdict = pct >= 80 ? 'Interview-ready on this one. 🔥' : pct >= 50 ? 'Solid base — review the misses below.' : 'Good start — study the explanations and retry.';
  root.innerHTML = `<div class="quiz">
    <div class="score"><div class="big">${s}/${total}</div><p class="muted" style="margin:8px 0 0">${pct}% · ${verdict}</p></div>
    <div class="review">${z.questions.map((x, i) => {
      const ok = z.picks[i] === x.answer;
      return `<div class="rv ${ok ? 'ok' : 'no'}"><b>${i + 1}. ${esc(x.question)}</b>
        <small>${ok ? '✓' : `✗ You chose ${LETTERS[z.picks[i]]}. `}Answer: ${LETTERS[x.answer]} — ${esc(x.options[x.answer])}</small>
        ${x.explanation ? `<small>${esc(x.explanation)}</small>` : ''}</div>`;
    }).join('')}</div>
    <div class="qfoot"><button class="btn ghost" id="qnew">New quiz</button><button class="btn primary" id="qretry">Retry same questions</button></div>
  </div>`;
  root.querySelector('#qnew').onclick = () => reset(ctx);
  root.querySelector('#qretry').onclick = () => {
    z.phase = 'play'; z.i = 0; z.picks = [];
    z.questions = z.questions.map((x) => ({ ...x }));
    ctx.rerender();
  };
  root.closest('.scroll')?.scrollTo({ top: 0 });
}

const score = (z) => z.picks.reduce((n, p, i) => n + (p === z.questions[i].answer ? 1 : 0), 0);
const reset = (ctx) => { Object.assign(ctx.quiz, newQuiz(), { topic: ctx.quiz.topic, difficulty: ctx.quiz.difficulty, count: ctx.quiz.count }); ctx.rerender(); };
const pick = (ctx, i) => { ctx.quiz.picks[ctx.quiz.i] = i; ctx.rerender(); };
const next = (ctx) => {
  const z = ctx.quiz;
  if (z.i + 1 >= z.questions.length) z.phase = 'result'; else z.i++;
  ctx.rerender();
};

/** Keyboard: A–D answers, Enter/→ advances. Returns true if handled. */
export function quizKey(ctx, e) {
  const z = ctx.quiz;
  if (z.phase !== 'play') return false;
  const done = z.picks[z.i] !== undefined;
  const idx = LETTERS.indexOf(e.key.toUpperCase());
  if (!done && idx >= 0 && idx < z.questions[z.i].options.length) return (pick(ctx, idx), true);
  if (done && (e.key === 'Enter' || e.key === 'ArrowRight')) return (next(ctx), true);
  return false;
}

async function generate(ctx) {
  const z = ctx.quiz;
  const persona = PERSONAS[ctx.personaId];
  z.phase = 'loading';
  z.error = '';
  ctx.rerender();
  const focus = z.topic === 'Mixed' ? `a mix of these areas: ${persona.topics.join(', ')}` : `the topic "${z.topic}"`;
  const prompt = `Write ${z.count} multiple-choice quiz questions for someone interviewing as ${persona.label}.
Focus: ${focus}. Difficulty: ${z.difficulty}.
Each question must have exactly 4 plausible options with exactly one correct answer, and test real interview-relevant knowledge or judgment (scenarios welcome). Vary the correct option's position.
Return ONLY JSON: {"questions":[{"question":"...","options":["...","...","...","..."],"answer":0,"explanation":"1-3 sentences on why the answer is right and why the others are not"}]} where "answer" is the 0-based index of the correct option.`;
  try {
    const data = await generateJson({ apiKey: ctx.apiKey, system: persona.system, prompt });
    const qs = normalize(data);
    if (!qs.length) throw new Error('No valid questions came back. Please try again.');
    Object.assign(z, { phase: 'play', questions: qs, i: 0, picks: [] });
  } catch (err) {
    z.phase = 'setup';
    z.error = err.message;
  }
  ctx.rerender();
}
