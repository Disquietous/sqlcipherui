/**
 * Minimal SQL tokenizer for context analysis. Runs only over the statement
 * that contains the cursor, so cost is bounded by statement length.
 */
import { KEYWORD_SET } from './sqlite-grammar';

const RE = new RegExp(
  [
    /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))/.source,                       // 1 comment
    /('(?:[^']|'')*'?)/.source,                                        // 2 string
    /("(?:[^"]|"")*"?|`[^`]*`?|\[[^\]]*\]?)/.source,                   // 3 quoted identifier
    /(0x[0-9a-fA-F]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/.source, // 4 number
    '([A-Za-z_\\u00a0-\\uffff$][\\w\\u00a0-\\uffff$]*)',                 // 5 word
    /([?:@$][\w]*)/.source,                                            // 6 bind variable
    /(\|\||<>|<=|>=|==|!=|->>|->|[-+*/%<>=&|~!])/.source,              // 7 operator
    /([(),;.])/.source,                                                // 8 punctuation
    /(\s+)/.source,                                                    // 9 whitespace
  ].join('|'),
  'y',
);

/**
 * @returns {Array<{t: string, v: string, lv: string, from: number, to: number}>}
 *   t ∈ 'comment' | 'str' | 'id' | 'qid' | 'num' | 'kw' | 'var' | 'op' | 'punct'
 *   (whitespace is dropped; `from`/`to` are offsets into `text`).
 */
export function tokenize(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    RE.lastIndex = i;
    const m = RE.exec(text);
    if (!m) { i++; continue; }
    const [whole, comment, str, qid, num, word, variable, op, punct, ws] = m;
    const from = i, to = i + whole.length;
    i = to;
    if (ws) continue;
    if (comment) out.push({ t: 'comment', v: whole, lv: '', from, to });
    else if (str) out.push({ t: 'str', v: whole, lv: '', from, to });
    else if (qid) {
      const closed = whole.length > 1 && /["`\]]$/.test(whole);
      const inner = whole.slice(1, closed ? -1 : undefined);
      out.push({ t: 'qid', v: whole, lv: inner.replace(/""/g, '"').toLowerCase(), from, to });
    } else if (num) out.push({ t: 'num', v: whole, lv: whole, from, to });
    else if (word) {
      const lv = whole.toLowerCase();
      out.push({ t: KEYWORD_SET.has(lv) ? 'kw' : 'id', v: whole, lv, from, to });
    } else if (variable) out.push({ t: 'var', v: whole, lv: whole, from, to });
    else if (op) out.push({ t: 'op', v: whole, lv: whole, from, to });
    else if (punct) out.push({ t: 'punct', v: whole, lv: whole, from, to });
  }
  return out;
}

/** Index of the last token that ends at or before `pos` (or -1). */
export function tokenBefore(tokens, pos) {
  let lo = 0, hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tokens[mid].to <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
