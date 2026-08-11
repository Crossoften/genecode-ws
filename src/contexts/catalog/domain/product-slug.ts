/**
 * Derives the URL slug from the product name typed in the admin form.
 *
 * Lowercased, accents stripped, anything outside a-z0-9 collapsed into a
 * single hyphen, trimmed to the 80-char column limit.
 *
 * @param name - Product name, e.g. "GeneCode Nutrigenética".
 */
export function slugFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}
