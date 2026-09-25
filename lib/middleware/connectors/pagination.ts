/**
 * Cursor pagination with a hard page cap, shared by any connector that
 * walks a cursor-paged list endpoint. Throws rather than returning a
 * partial list on either a fetch failure or an exhausted page cap, so
 * a truncated read never silently reads as "nothing here".
 *
 * `label` names what's being paginated (e.g. "inventories") so an
 * exhausted-page-cap error says what ran out, not just that something did.
 */
export async function paginate<T>(
  fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>,
  maxPages: number,
  label = "pagination"
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (!result.nextCursor) return items;
    cursor = result.nextCursor;
  }
  throw new Error(`${label} exceeded ${maxPages} pages - refusing to loop further`);
}
