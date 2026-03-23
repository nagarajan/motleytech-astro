import fs from 'node:fs';
import path from 'node:path';

const sourceRoot = '/Users/rnagarajan/dev/motleytechpy3/content';
const targetRoot = '/Users/rnagarajan/dev/motleytech-astro/src/content';

const args = new Set(process.argv.slice(2));
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
const migrateAll = args.has('--all');
const skipExisting = args.has('--skip-existing');

const appSlugToComponent = {
  sudokuSolver: 'SudokuApp',
  'balanced-tree': 'BalancedTreeApp',
  minesweeper: 'MinesweeperApp',
  reactToDoList: 'TodoBoardApp',
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toIsoDate(input) {
  if (!input) {
    return '1970-01-01';
  }
  const normalized = input.replace(' +0100', '').trim();
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    const firstPart = normalized.split(' ')[0];
    return firstPart;
  }
  return parsed.toISOString().slice(0, 10);
}

function escapeYamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function parsePelicanArticle(raw) {
  const lines = raw.split('\n');
  const meta = {};
  let idx = 0;

  for (; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (line.trim() === '') {
      idx += 1;
      break;
    }
    const sep = line.indexOf(':');
    if (sep < 0) {
      break;
    }
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    meta[key] = value;
  }

  const body = lines.slice(idx).join('\n').trim() + '\n';
  return { meta, body };
}

function parsePage(raw) {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') {
    return null;
  }
  let idx = 1;
  const meta = {};
  for (; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (line.trim() === '---') {
      idx += 1;
      break;
    }
    const sep = line.indexOf(':');
    if (sep < 0) {
      continue;
    }
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    meta[key] = value;
  }
  const body = lines.slice(idx).join('\n').trim() + '\n';
  return { meta, body };
}

function createArticleFrontmatter({ slug, meta, isMdx }) {
  const tags = (meta.Tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const lines = [
    '---',
    `title: ${escapeYamlString(meta.Title || slug)}`,
    `pubDate: ${toIsoDate(meta.Date)}`,
    `category: ${escapeYamlString(meta.Category || 'Blog')}`,
    `tags: [${tags.map((tag) => escapeYamlString(tag)).join(', ')}]`,
    `author: ${escapeYamlString(meta.Authors || 'Nagarajan')}`,
    `description: ${escapeYamlString(meta.Summary || '')}`,
    `legacySlug: ${escapeYamlString(slug)}`,
  ];
  if (meta.Disqus_Identifier) {
    lines.push(`disqusIdentifier: ${escapeYamlString(meta.Disqus_Identifier)}`);
  }
  lines.push('---', '');
  if (isMdx && appSlugToComponent[slug]) {
    lines.push(
      `import ${appSlugToComponent[slug]} from '../../components/apps/${appSlugToComponent[slug]}.tsx';`,
      '',
      '',
    );
  }
  return lines.join('\n');
}

function rewriteInteractiveBody(slug, body) {
  if (slug === 'sudokuSolver') {
    return `${body}\n\n<SudokuApp client:visible />\n`;
  }
  if (slug === 'balanced-tree') {
    return `${body}\n\n<BalancedTreeApp client:visible />\n`;
  }
  if (slug === 'minesweeper') {
    return `${body}\n\n<MinesweeperApp client:visible />\n`;
  }
  if (slug === 'reactToDoList') {
    return `${body}\n\n<TodoBoardApp client:visible />\n`;
  }
  return body;
}

function removeLegacyAppMarkup(body) {
  const patterns = [
    /<div id='sudokudiv'>[\s\S]*?<\/div>\s*/g,
    /<button id="btnreset"[\s\S]*?<\/button>\s*/g,
    /<button id="btnsolve"[\s\S]*?<\/button>\s*/g,
    /<span id="statustext"><\/span>\s*/g,
    /<span id="errortext"[\s\S]*?<\/span>\s*/g,
    /<script src="\/js\/sudokuSolver\.js"><\/script>\s*/g,
    /<script>[\s\S]*?window\.onload[\s\S]*?<\/script>\s*/g,
    /<div id='root'>[\s\S]*?<\/div>\s*/g,
    /<div id="minesweeper"><\/div>\s*/g,
    /<div id='appContainer'>[\s\S]*?<\/div>\s*/g,
    /<script src="\/js\/react\.production\.min\.js"><\/script>\s*/g,
    /<script src="\/js\/react-dom\.production\.min\.js"><\/script>\s*/g,
    /<script src="\/js\/balancedTree\/app_transpiled\.js"> <\/script>\s*/g,
    /<script src="\/js\/minesweeper\/app-transpiled\.js"><\/script>\s*/g,
    /<script src="\/js\/reactToDoList\/index\.js"> <\/script>\s*/g,
    /<link rel='stylesheet' type='text\/css' href="\/css\/balancedTree\/app\.css" \/>\s*/g,
    /<link rel='stylesheet' type='text\/css' href="\/css\/reactToDoList\/app\.css" \/>\s*/g,
    /<link rel="stylesheet" href="\/css\/minesweeper\/app\.css">\s*/g,
  ];
  let next = body;
  for (const pattern of patterns) {
    next = next.replace(pattern, '');
  }
  return next.trim() + '\n';
}

function migrateArticles() {
  const articleDirEntries = fs
    .readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .filter((slug) => fs.existsSync(path.join(sourceRoot, slug, 'content.md')));

  const selected = migrateAll ? articleDirEntries : articleDirEntries.slice(0, 5);
  const finalSelection = Number.isFinite(limit) ? selected.slice(0, limit) : selected;

  ensureDir(path.join(targetRoot, 'blog'));

  let migratedCount = 0;
  for (const slug of finalSelection) {
    const sourcePath = path.join(sourceRoot, slug, 'content.md');
    if (!fs.existsSync(sourcePath)) {
      continue;
    }
    const raw = fs.readFileSync(sourcePath, 'utf8');
    const { meta, body } = parsePelicanArticle(raw);
    const isInteractive = Boolean(appSlugToComponent[slug]);
    const ext = isInteractive ? 'mdx' : 'md';
    const targetPath = path.join(targetRoot, 'blog', `${slug}.${ext}`);
    if (skipExisting && fs.existsSync(targetPath)) {
      continue;
    }
    const cleanBody = isInteractive ? rewriteInteractiveBody(slug, removeLegacyAppMarkup(body)) : body;
    const frontmatter = createArticleFrontmatter({ slug, meta, isMdx: isInteractive });
    fs.writeFileSync(targetPath, `${frontmatter}${cleanBody}`);
    migratedCount += 1;
  }
  return migratedCount;
}

function migratePages() {
  const pagesSourceDir = path.join(sourceRoot, 'pages');
  if (!fs.existsSync(pagesSourceDir)) {
    return 0;
  }
  const pageFiles = fs
    .readdirSync(pagesSourceDir)
    .filter((fileName) => fileName.endsWith('.md'))
    .sort();

  ensureDir(path.join(targetRoot, 'pages'));
  let migratedCount = 0;
  for (const fileName of pageFiles) {
    const sourcePath = path.join(pagesSourceDir, fileName);
    const raw = fs.readFileSync(sourcePath, 'utf8');
    const parsed = parsePage(raw);
    if (!parsed) {
      continue;
    }
    const { meta, body } = parsed;
    const slug = meta.slug || fileName.replace(/\.md$/, '');
    const outPath = path.join(targetRoot, 'pages', `${slug}.md`);
    if (skipExisting && fs.existsSync(outPath)) {
      continue;
    }
    const lines = [
      '---',
      `title: ${escapeYamlString(meta.title || slug)}`,
      `slug: ${escapeYamlString(slug)}`,
      `pubDate: ${escapeYamlString(toIsoDate(meta.date || ''))}`,
      `author: ${escapeYamlString(meta.author || 'Nagarajan')}`,
      `layout: ${escapeYamlString(meta.layout || 'page')}`,
      `status: ${escapeYamlString(meta.status || 'published')}`,
      `description: ${escapeYamlString('')}`,
      '---',
      '',
    ];
    fs.writeFileSync(outPath, `${lines.join('\n')}${body}`);
    migratedCount += 1;
  }
  return migratedCount;
}

const articleCount = migrateArticles();
const pageCount = migratePages();
console.log(`Migrated articles: ${articleCount}`);
console.log(`Migrated pages: ${pageCount}`);
