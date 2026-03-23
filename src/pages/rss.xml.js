import rss from '@astrojs/rss';
import { getPostSlug, getPublicPosts } from '../lib/content';

export async function GET(context) {
  const posts = await getPublicPosts();
  return rss({
    title: 'MotleyTech',
    description: 'Variegated technical notes and interactive demos',
    site: context.site ?? 'https://motleytech.net',
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/blog/${getPostSlug(post)}`,
    })),
  });
}
