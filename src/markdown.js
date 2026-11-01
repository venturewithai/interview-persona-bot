// Tiny, safe markdown renderer (escape first, then apply formatting).
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

export function renderMarkdown(src) {
  const lines = esc(src).split('\n');
  let out = '';
  let list = null; // 'ul' | 'ol'
  let code = false;
  const close = () => {
    if (list) out += `</${list}>`;
    list = null;
  };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      close();
      out += code ? '</pre>' : '<pre>';
      code = !code;
      continue;
    }
    if (code) {
      out += line + '\n';
      continue;
    }
    let m;
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      if (list !== 'ul') (close(), (out += '<ul>'), (list = 'ul'));
      out += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== 'ol') (close(), (out += '<ol>'), (list = 'ol'));
      out += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^#{1,4}\s+(.*)/))) {
      close();
      out += `<h4>${inline(m[1])}</h4>`;
    } else if (line.trim() === '') {
      close();
    } else {
      close();
      out += `<p>${inline(line)}</p>`;
    }
  }
  close();
  if (code) out += '</pre>';
  return out;
}
