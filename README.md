# MotleyTech Astro Migration

This project is the Astro migration of the original Pelican blog.

## Local development

- Install dependencies: `npm install`
- Start dev server: `npm run dev`
- Build static site: `npm run build`
- Preview local build: `npm run preview`

## Content layout

- Blog posts: `src/content/blog`
- Pages: `src/content/pages`
- Legacy JS apps wrapped as React components: `src/components/apps`
- Shared layouts: `src/layouts`
- Public assets (images/js/css/fonts): `public`

## Deployment options

### Netlify

- Config file: `netlify.toml`
- Build command: `npm run build`
- Publish directory: `dist`

### Vercel

- Config file: `vercel.json`
- Framework preset: Astro
- Output directory: `dist`

### GitHub Pages

- Workflow file: `.github/workflows/deploy-gh-pages.yml`
- Trigger: push to `main`
- Deployment target: GitHub Pages static hosting
