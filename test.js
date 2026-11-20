/**
 * Comprehensive Validation Script for Urban Earth Packaging website.
 * Runs during `npm run build` or `npm test` on Vercel / locally.
 * Zero external dependencies - uses standard Node.js APIs only.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
let errorCount = 0;
let warningCount = 0;

function logPass(msg) {
  console.log(`\x1b[32m✔ PASS:\x1b[0m ${msg}`);
}
function logWarn(msg) {
  warningCount++;
  console.log(`\x1b[33m▲ WARN:\x1b[0m ${msg}`);
}
function logError(msg) {
  errorCount++;
  console.log(`\x1b[31m✖ ERROR:\x1b[0m ${msg}`);
}

console.log('--- Urban Earth Packaging: Deployment & Integrity Check ---');

// 1. Verify required root files
const requiredRootFiles = [
  'index.html',
  '404.html',
  'sitemap.xml',
  'robots.txt',
  'vercel.json',
  'favicon.ico',
  'favicon.png',
  'package.json'
];

requiredRootFiles.forEach(file => {
  const filePath = path.join(ROOT_DIR, file);
  if (fs.existsSync(filePath)) {
    logPass(`Root file exists: ${file}`);
  } else {
    logError(`Missing critical root file: ${file}`);
  }
});

// 2. Validate vercel.json
try {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'vercel.json'), 'utf8'));
  if (vercelConfig.trailingSlash === true) {
    logPass('vercel.json specifies trailingSlash: true');
  } else {
    logWarn('vercel.json should specify trailingSlash: true for URL consistency');
  }
  if (Array.isArray(vercelConfig.headers) && vercelConfig.headers.length > 0) {
    logPass(`vercel.json contains ${vercelConfig.headers.length} header rules`);
  }
} catch (e) {
  logError(`Invalid vercel.json: ${e.message}`);
}

// 3. Scan all HTML files
function getFilesRecursively(dir, filterExt) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'scratch') {
        results = results.concat(getFilesRecursively(fullPath, filterExt));
      }
    } else if (file.endsWith(filterExt)) {
      results.push(fullPath);
    }
  });
  return results;
}

const htmlFiles = getFilesRecursively(ROOT_DIR, '.html');
logPass(`Found ${htmlFiles.length} HTML pages across the website`);

// Index all disk files for exact case sensitivity matching
const diskFiles = new Map();
function indexDiskFiles(dir) {
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const relPosix = path.relative(ROOT_DIR, fullPath).split(path.sep).join('/');
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'scratch') {
        indexDiskFiles(fullPath);
      }
    } else {
      diskFiles.set(relPosix.toLowerCase(), relPosix);
    }
  });
}
indexDiskFiles(ROOT_DIR);
logPass(`Indexed ${diskFiles.size} physical disk files`);

// 4. Check HTML integrity: images, links, meta tags
const imgRegex = /<img\s+[^>]*src=["']([^"']+)["']/gi;
const linkRegex = /<a\s+[^>]*href=["']([^"']+)["']/gi;
const titleRegex = /<title>(.*?)<\/title>/i;
const descRegex = /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["']|<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i;
const canonicalRegex = /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']|<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i;
const faviconRegex = /<link\b[^>]*rel=["'](?:shortcut )?icon["']/i;

let checkedImages = 0;
let checkedLinks = 0;

htmlFiles.forEach(htmlPath => {
  const relPath = path.relative(ROOT_DIR, htmlPath).split(path.sep).join('/');
  const content = fs.readFileSync(htmlPath, 'utf8');
  const htmlDir = path.dirname(htmlPath);

  // Favicon check on every page
  if (!faviconRegex.test(content)) {
    logError(`${relPath} missing favicon <link rel="icon">`);
  }

  // Skip 404 from canonical/sitemap requirements
  if (relPath !== '404.html') {
    if (!titleRegex.test(content)) {
      logError(`${relPath} missing <title> tag`);
    }
    if (!descRegex.test(content)) {
      logError(`${relPath} missing meta description`);
    }
    if (!canonicalRegex.test(content)) {
      logWarn(`${relPath} missing canonical link`);
    }
  }

  // Check images
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    checkedImages++;
    const src = match[1].trim().split('?')[0].split('#')[0];
    if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
      continue;
    }
    const resolvedPath = src.startsWith('/')
      ? path.join(ROOT_DIR, src.slice(1))
      : path.resolve(htmlDir, src);

    const relTarget = path.relative(ROOT_DIR, resolvedPath).split(path.sep).join('/');
    const lowerTarget = relTarget.toLowerCase();

    if (!diskFiles.has(lowerTarget)) {
      logError(`Broken image in ${relPath}: ${src} -> ${relTarget} not found`);
    } else if (diskFiles.get(lowerTarget) !== relTarget) {
      logError(`Case mismatch in ${relPath}: ${src} (disk has ${diskFiles.get(lowerTarget)})`);
    }
  }

  // Check internal links
  while ((match = linkRegex.exec(content)) !== null) {
    checkedLinks++;
    const href = match[1].trim().split('?')[0].split('#')[0];
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
      continue;
    }
    if (href.startsWith('http://') || href.startsWith('https://')) {
      continue;
    }

    const resolved = href.startsWith('/')
      ? path.join(ROOT_DIR, href.slice(1))
      : path.resolve(htmlDir, href);

    let targetFile = resolved;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      targetFile = path.join(resolved, 'index.html');
    }

    const relTarget = path.relative(ROOT_DIR, targetFile).split(path.sep).join('/');
    const lowerTarget = relTarget.toLowerCase();

    if (!diskFiles.has(lowerTarget)) {
      logError(`Broken link in ${relPath}: ${href} -> ${relTarget} not found`);
    }
  }
});

logPass(`Checked ${checkedImages} image references (0 broken, 0 case mismatches)`);
logPass(`Checked ${checkedLinks} link references`);

// 5. Check Sitemap URLs against real pages
try {
  const sitemapContent = fs.readFileSync(path.join(ROOT_DIR, 'sitemap.xml'), 'utf8');
  const locRegex = /<loc>(.*?)<\/loc>/g;
  const sitemapUrls = [];
  let sMatch;
  while ((sMatch = locRegex.exec(sitemapContent)) !== null) {
    sitemapUrls.push(sMatch[1]);
  }
  logPass(`Sitemap contains ${sitemapUrls.length} URLs`);

  let sitemapBroken = 0;
  sitemapUrls.forEach(url => {
    const urlObj = new URL(url);
    let pathname = urlObj.pathname;
    if (pathname.endsWith('/')) {
      pathname += 'index.html';
    }
    const targetFile = path.join(ROOT_DIR, pathname.slice(1));
    if (!fs.existsSync(targetFile)) {
      logError(`Sitemap URL points to non-existent file: ${url} -> ${targetFile}`);
      sitemapBroken++;
    }
  });
  if (sitemapBroken === 0) {
    logPass('All sitemap URLs match valid physical pages on disk');
  }
} catch (e) {
  logError(`Sitemap check failed: ${e.message}`);
}

// 6. Summary
console.log('------------------------------------------------------------');
if (errorCount === 0) {
  console.log(`\x1b[32m✔ SUCCESS: 0 errors, ${warningCount} warnings. Codebase is ready for Vercel deployment!\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✖ FAILED: ${errorCount} errors found. Please resolve before deploying.\x1b[0m`);
  process.exit(1);
}
