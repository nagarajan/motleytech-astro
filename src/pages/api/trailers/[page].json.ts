import type { APIRoute } from 'astro';
import {
  getTrailerPage,
  getTrailers,
  pageCount,
  renderTrailerCards,
  TRAILERS_PER_PAGE,
  type Trailer,
} from '../../../lib/trailers';

/**
 * Pre-built pages of trailer markup for the home feed's infinite scroll. Page 1
 * is rendered into the page itself, so the endpoint only needs pages 2..n.
 */
export async function getStaticPaths() {
  const trailers = await getTrailers();
  const total = pageCount(trailers.length);

  return Array.from({ length: total }, (_, index) => index + 1).map((page) => ({
    params: { page: String(page) },
    props: { page, total, items: getTrailerPage(trailers, page) },
  }));
}

export const GET: APIRoute = ({ props }) => {
  const { page, total, items } = props as { page: number; total: number; items: Trailer[] };

  return new Response(
    JSON.stringify({
      page,
      totalPages: total,
      perPage: TRAILERS_PER_PAGE,
      nextPage: page < total ? page + 1 : null,
      html: renderTrailerCards(items),
    }),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
};
