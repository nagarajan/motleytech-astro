import { getCollection, type CollectionEntry } from 'astro:content';

export type BlogPost = CollectionEntry<'blog'>;

export function getPostSlug(post: BlogPost): string {
  return post.id.replace(/\.(md|mdx)$/i, '');
}

export async function getAllPosts(): Promise<BlogPost[]> {
  const posts = await getCollection('blog');
  return posts.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

export async function getPublicPosts(): Promise<BlogPost[]> {
  const posts = await getAllPosts();
  return posts.filter((post) => post.data.category !== 'Private' && post.data.draft !== true);
}

export function getUniqueTags(posts: BlogPost[]): string[] {
  const tags = new Set<string>();
  for (const post of posts) {
    for (const tag of post.data.tags || []) {
      tags.add(tag);
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

export function getUniqueCategories(posts: BlogPost[]): string[] {
  const categories = new Set<string>();
  for (const post of posts) {
    categories.add(post.data.category);
  }
  return [...categories].sort((a, b) => a.localeCompare(b));
}
