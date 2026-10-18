import type { ParseContext, ParseResult } from './types';

/**
 * Anything that can turn free text into tasks or commands.
 * The default implementation is rule-based; a free in-browser model could
 * implement this same interface later without touching the UI.
 */
export interface TextUnderstander {
  readonly id: string;
  parse(input: string, ctx: ParseContext): Promise<ParseResult>;
}
