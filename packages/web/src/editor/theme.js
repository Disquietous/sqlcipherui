/**
 * Maps CodeMirror highlight tags onto the existing `.tok-*` classes so the
 * three app themes (classic/console/workbench) keep styling the editor via
 * CSS custom properties in themes/index.css.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const sqlHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.typeName, t.bool, t.null, t.operatorKeyword], class: 'tok-kw' },
  { tag: [t.string, t.special(t.string)], class: 'tok-str' },
  { tag: [t.number, t.integer, t.float], class: 'tok-num' },
  { tag: [t.standard(t.name), t.function(t.variableName), t.function(t.name)], class: 'tok-fn' },
  { tag: [t.lineComment, t.blockComment, t.comment], class: 'tok-comment' },
  { tag: [t.operator, t.punctuation, t.paren, t.squareBracket, t.brace, t.derefOperator], class: 'tok-op' },
]);

export const sqlHighlighting = syntaxHighlighting(sqlHighlightStyle);
