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

export function taskRange(period, anchor) {
  if (!['day', 'month', 'year'].includes(period)) return null;
  const pattern = period === 'day' ? /^\d{4}-\d{2}-\d{2}$/ : period === 'month' ? /^\d{4}-\d{2}$/ : /^\d{4}$/;
  if (!pattern.test(anchor)) return null;
  const start = period === 'day' ? anchor : period === 'month' ? `${anchor}-01` : `${anchor}-01-01`;
  const date = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== start) return null;
  if (period === 'day') date.setUTCDate(date.getUTCDate() + 1);
  if (period === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
  if (period === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1);
  return { start, end: date.toISOString().slice(0, 10) };
}
