import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    category: z.enum(['Blog', 'Technotes', 'TechNotes', 'Private']).default('Blog'),
    tags: z.array(z.string()).default([]),
    author: z.string().default('Nagarajan'),
    description: z.string().default(''),
    disqusIdentifier: z.string().optional(),
    legacySlug: z.string().optional(),
    draft: z.boolean().optional(),
  }),
});

const pages = defineCollection({
  loader: glob({ base: './src/content/pages', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date().optional(),
    author: z.string().default('Nagarajan'),
    slug: z.string(),
    layout: z.string().optional(),
    status: z.string().optional(),
    description: z.string().default(''),
  }),
});

export const collections = { blog, pages };
