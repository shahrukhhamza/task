// Speed: most spoken commands ("delete task 2", "gym at 6 pm", "move it to tomorrow") are
// understood instantly by the built-in parser. Asking Gemini as well costs one to three
// seconds for no gain, so it is kept for what the parser can't be trusted with.

import type { AiParseResult } from '../ai/convert';
import { parseInput, type ParseContext } from '../parser';
import type { Task } from '../types';

/** English-looking text: Latin letters, digits and everyday punctuation. Other scripts go to Gemini. */
export const looksEnglish = (text: string): boolean => !/[^\u0000-ɏ‘-‟–—…\s]/.test(text);

const MAX_TITLE_WORDS = 6;

/** True when the parser's reading can be acted on without a second opinion. */
export function isConfident(result: AiParseResult, text: string): boolean {
  if (!looksEnglish(text)) return false;
  if (result.kind === 'command') return true;
  if (result.kind !== 'tasks') return false;
  // a long "title" is usually a rambling sentence the parser couldn't really read
  return result.tasks.every((t) => t.title.trim().length >= 2 && t.title.trim().split(/\s+/).length <= MAX_TITLE_WORDS);
}

export interface Smarts {
  available(): boolean;
  understand(text: string, ctx: ParseContext, existing: Task[]): Promise<AiParseResult>;
}

/**
 * The parser first; Gemini only when the parser isn't sure (other languages, rambling sentences)
 * and only for as long as `timeoutMs`, after which the parser's answer is used.
 */
export async function fastUnderstand(text: string, ctx: ParseContext, existing: Task[], ai: Smarts, timeoutMs = 4000): Promise<AiParseResult> {
  const rules = parseInput(text, ctx);
  if (isConfident(rules, text) || !ai.available()) return rules;

  try {
    const smart = await Promise.race([
      ai.understand(text, ctx, existing),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (smart && smart.kind !== 'empty') return smart;
  } catch {
    /* quota, network or a bad answer: the parser's reading still stands */
  }
  return rules;
}
