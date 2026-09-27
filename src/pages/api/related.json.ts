import type { APIRoute } from 'astro';
import { getTrailers, toRelatedLink } from '../../lib/trailers';

/**
 * Every article as a one-line link, so the "Also on MotleyTech" list can draw a
 * fresh set on each visit. It is one file for the whole site rather than a pool
 * embedded in every page, which keeps it out of the HTML and lets the browser
 * cache it across articles.
 */
export const GET: APIRoute = async () => {
  const items = (await getTrailers()).map(toRelatedLink);

  return new Response(JSON.stringify({ items }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
