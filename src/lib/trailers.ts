import { getPostSlug, getPublicPosts, type BlogPost } from './content';

export const TRAILERS_PER_PAGE = 6;

export interface Trailer {
  slug: string;
  title: string;
  trailer: string;
  category: string;
  tags: string[];
  heroImage?: string;
  heroAlt: string;
  isoDate: string;
  stamp: string;
  readMinutes: number;
}

const WORDS_PER_MINUTE = 210;

/** Prose only: fenced code, MDX imports and raw markup are not read at prose speed. */
export function getReadMinutes(post: BlogPost): number {
  const prose = (post.body ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^import .*$/gm, ' ')
    .replace(/<[^>]+>/g, ' ')
    .trim();
  const words = prose ? prose.split(/\s+/).length : 0;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** `2014.01.17` reads as instrument telemetry, which suits the design. */
function stamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '.');
}

export function toTrailer(post: BlogPost): Trailer {
  return {
    slug: getPostSlug(post),
    title: post.data.title,
    trailer: post.data.trailer || post.data.description,
    category: post.data.category,
    tags: (post.data.tags ?? []).slice(0, 3),
    heroImage: post.data.heroImage,
    heroAlt: post.data.heroAlt || post.data.title,
    isoDate: post.data.pubDate.toISOString(),
    stamp: stamp(post.data.pubDate),
    readMinutes: getReadMinutes(post),
  };
}

export async function getTrailers(): Promise<Trailer[]> {
  return (await getPublicPosts()).map(toTrailer);
}

export function pageCount(total: number, perPage = TRAILERS_PER_PAGE): number {
  return Math.max(1, Math.ceil(total / perPage));
}

export function getTrailerPage(
  trailers: Trailer[],
  page: number,
  perPage = TRAILERS_PER_PAGE,
): Trailer[] {
  return trailers.slice((page - 1) * perPage, page * perPage);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Cards are rendered to markup here rather than in a component so the page and
 * the infinite-scroll endpoint stay byte-for-byte identical.
 */
export function renderTrailerCard(trailer: Trailer): string {
  const href = `/blog/${encodeURI(trailer.slug)}`;
  const media = trailer.heroImage
    ? `<img class="trailer-media-blur" src="${encodeURI(trailer.heroImage)}" alt="" aria-hidden="true" loading="lazy" decoding="async" />
        <img class="trailer-media-img" src="${encodeURI(trailer.heroImage)}" alt="${escapeHtml(trailer.heroAlt)}" loading="lazy" decoding="async" />`
    : `<div class="trailer-media-empty" aria-hidden="true">${escapeHtml(trailer.title.slice(0, 2).toUpperCase())}</div>`;

  const tags = trailer.tags
    .map((tag) => `<li>${escapeHtml(tag)}</li>`)
    .join('');

  return `<li>
  <article class="trailer">
    <div class="trailer-media">
      ${media}
      <span class="trailer-cat">${escapeHtml(trailer.category)}</span>
    </div>
    <div class="trailer-body">
      <p class="trailer-meta">
        <time datetime="${trailer.isoDate}">${trailer.stamp}</time>
        <span aria-hidden="true"></span>
        <span>${trailer.readMinutes} min read</span>
      </p>
      <h3 class="trailer-title"><a href="${href}">${escapeHtml(trailer.title)}</a></h3>
      <p class="trailer-text">${escapeHtml(trailer.trailer)}</p>
      ${tags ? `<ul class="trailer-tags">${tags}</ul>` : ''}
      <span class="trailer-cta" aria-hidden="true">Read article</span>
    </div>
  </article>
</li>`;
}

export function renderTrailerCards(trailers: Trailer[]): string {
  return trailers.map(renderTrailerCard).join('\n');
}
