/**
 * Minimal, dependency-free class name joiner.
 * Filters out falsy values and joins valid classes.
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Truncates text cleanly to a maximum length without splitting words when possible.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const sub = text.slice(0, maxLength);
  const lastSpace = sub.lastIndexOf(" ");
  if (lastSpace > 0) {
    return sub.slice(0, lastSpace) + "...";
  }
  return sub + "...";
}

/**
 * Sanitizes and generates a standard URL slug from a topic or tag name.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
