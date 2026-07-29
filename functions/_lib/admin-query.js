const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function listParams(request) {
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get('limit') || DEFAULT_LIMIT);
  const cursor = Number(url.searchParams.get('cursor') || 0);
  return {
    limit: Math.min(MAX_LIMIT, Math.max(1, Number.isInteger(requested) ? requested : DEFAULT_LIMIT)),
    cursor: Number.isSafeInteger(cursor) && cursor > 0 ? cursor : null,
    query: String(url.searchParams.get('q') || '').trim().slice(0, 100)
  };
}

export function page(rows, limit) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    page: {
      hasMore,
      nextCursor: hasMore && items.length ? items[items.length - 1].id : null
    }
  };
}

export function likePattern(value) {
  return `%${value.replace(/[\\%_]/g, character => `\\${character}`)}%`;
}

export function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
