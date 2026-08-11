/**
 * Derives the two-letter initials shown in the partner avatar.
 *
 * Takes the first letter of the first and last words of the display name;
 * single-word names fall back to their first two letters.
 *
 * @param displayName - Partner name as it appears in the admin table.
 */
export function initialsOf(displayName: string): string {
  const words = displayName
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}
