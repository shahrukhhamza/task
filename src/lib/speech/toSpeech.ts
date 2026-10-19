/**
 * Rewrites what is shown on screen into how a person would say it:
 * no quote marks around titles, "7 PM" instead of "7:00 PM", "30 minutes" instead of "30m".
 */
export function toSpeech(text: string): string {
  return (
    text
      // “Meeting” and "Meeting" are read as plain words
      .replace(/[“”"]/g, '')
      .replace(/\s*\(task (\d+)\)/gi, ', task $1,')
      .replace(/\(#(\d+)\)/g, 'number $1')
      .replace(/#(\d+)/g, 'number $1')
      // 7:00 PM -> 7 PM (but 7:30 PM stays)
      .replace(/\b(\d{1,2}):00\s?([AP])M\b/g, '$1 $2M')
      // 1h 30m, 2h, 45m
      .replace(/\b(\d+)h\s*(\d+)m\b/g, (_m, h: string, m: string) => `${h} ${h === '1' ? 'hour' : 'hours'} ${m} minutes`)
      .replace(/\b(\d+)h\b/g, (_m, h: string) => `${h} ${h === '1' ? 'hour' : 'hours'}`)
      .replace(/\b(\d+)m\b/g, (_m, m: string) => `${m} ${m === '1' ? 'minute' : 'minutes'}`)
      // "8:00 PM to 9:00 PM" reads better as "8 to 9 PM" when both share am/pm
      .replace(/\b(\d{1,2}(?::\d{2})?) ([AP]M) to (\d{1,2}(?::\d{2})?) \2\b/g, '$1 to $3 $2')
      .replace(/,\s*,/g, ',')
      .replace(/\s+,/g, ',')
      .replace(/,\s*\./g, '.')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}
