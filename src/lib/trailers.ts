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

/** How many articles the "Also on MotleyTech" list shows. */
export const RELATED_COUNT = 4;

const SNIPPET_LENGTH = 130;

/** One line of an article, for the compact lists that sit beside a post. */
export interface RelatedLink {
  href: string;
  title: string;
  isoDate: string;
  stamp: string;
  readMinutes: number;
  image: string;
  alt: string;
  snippet: string;
}

function snippet(text: string): string {
  if (text.length <= SNIPPET_LENGTH) return text;
  const cut = text.slice(0, SNIPPET_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : cut.length).replace(/[,;:.]$/, '')}\u2026`;
}

export function toRelatedLink(trailer: Trailer): RelatedLink {
  return {
    href: `/blog/${encodeURI(trailer.slug)}`,
    title: trailer.title,
    isoDate: trailer.isoDate,
    stamp: trailer.stamp,
    readMinutes: trailer.readMinutes,
    image: trailer.heroImage ? encodeURI(trailer.heroImage) : '',
    alt: trailer.heroAlt,
    snippet: snippet(trailer.trailer),
  };
}

/**
 * Fisher-Yates, so every article gets its own set rather than the four newest
 * turning up everywhere. Drawing without replacement is what keeps the list
 * free of the duplicates the old Disqus widget used to show.
 */
export function sample<T>(items: T[], count: number, random: () => number = Math.random): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
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
