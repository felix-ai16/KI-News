const RSSParser = require('rss-parser');
const translate = require('google-translate-api-x');
const fs = require('fs');
const path = require('path');

const parser = new RSSParser({
  timeout: 15000,
  headers: {
    'User-Agent': 'KI-News-Aggregator/1.0',
  },
});

const FEEDS = [
  {
    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    source: 'The Verge',
    category: 'news',
  },
  {
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    source: 'TechCrunch',
    category: 'news',
  },
  {
    url: 'https://feeds.arstechnica.com/arstechnica/technology-lab',
    source: 'Ars Technica',
    category: 'news',
  },
  {
    url: 'https://www.technologyreview.com/feed/',
    source: 'MIT Tech Review',
    category: 'trend',
  },
  {
    url: 'https://openai.com/blog/rss.xml',
    source: 'OpenAI',
    category: 'news',
  },
  {
    url: 'https://blog.google/technology/ai/rss/',
    source: 'Google AI',
    category: 'news',
  },
];

const DAYS_TO_KEEP = 7;
const BATCH_SIZE = 10;

const WEEKDAYS_DE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS_DE = ['Januar', 'Februar', 'Maerz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function formatDateDE(date) {
  return WEEKDAYS_DE[date.getDay()] + ', ' + date.getDate() + '. ' + MONTHS_DE[date.getMonth()] + ' ' + date.getFullYear();
}

function formatDateShortDE(date) {
  return date.getDate() + '. ' + MONTHS_DE[date.getMonth()];
}

function dateToKey(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function stripHtml(html) {
  return html ? html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
}

function truncate(str, len) {
  var clean = stripHtml(str);
  if (clean.length <= len) return clean;
  return clean.substring(0, len) + '...';
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeUrl(url) {
  if (!url) return '#';
  var trimmed = url.trim();
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }
  return '#';
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// ========== Translation ==========
async function translateBatch(texts) {
  // Filter out empty strings, keep track of indices
  var jobs = [];
  texts.forEach(function (text, i) {
    if (text && text.trim()) {
      jobs.push({ index: i, text: text.trim() });
    }
  });

  var results = new Array(texts.length).fill('');

  // Process in batches
  for (var b = 0; b < jobs.length; b += BATCH_SIZE) {
    var batch = jobs.slice(b, b + BATCH_SIZE);
    var batchTexts = batch.map(function (j) { return j.text; });

    try {
      var translated = await translate(batchTexts, { from: 'en', to: 'de' });
      // translate returns array when given array
      if (Array.isArray(translated)) {
        translated.forEach(function (t, idx) {
          results[batch[idx].index] = t.text;
        });
      }
    } catch (err) {
      console.error('  Uebersetzungsfehler (Batch ' + Math.floor(b / BATCH_SIZE) + '): ' + err.message);
      // Fallback: use original texts
      batch.forEach(function (j) {
        results[j.index] = j.text;
      });
    }

    // Small delay between batches to avoid rate limiting
    if (b + BATCH_SIZE < jobs.length) {
      await sleep(300);
    }
  }

  return results;
}

async function translateArticles(articles) {
  // Load existing translations cache
  var cachePath = path.join(__dirname, '..', 'data', 'translations.json');
  var cache = {};
  if (fs.existsSync(cachePath)) {
    try {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    } catch (e) { /* ignore */ }
  }

  var toTranslateDescs = [];
  var toTranslateTitles = [];
  var indices = [];

  articles.forEach(function (article, i) {
    var descClean = truncate(article.description, 300);
    var cacheKeyDesc = article.link + '::desc';
    var cacheKeyTitle = article.link + '::title';

    if (cache[cacheKeyDesc] && cache[cacheKeyTitle]) {
      article.descriptionDE = cache[cacheKeyDesc];
      article.titleDE = cache[cacheKeyTitle];
    } else {
      toTranslateDescs.push(descClean);
      toTranslateTitles.push(article.title);
      indices.push(i);
    }
  });

  if (indices.length === 0) {
    console.log('Alle Artikel bereits uebersetzt (Cache).');
    return;
  }

  console.log('Uebersetze ' + indices.length + ' Artikel ins Deutsche...');

  // Translate descriptions
  var translatedDescs = await translateBatch(toTranslateDescs);
  // Translate titles
  var translatedTitles = await translateBatch(toTranslateTitles);

  indices.forEach(function (articleIdx, j) {
    var article = articles[articleIdx];
    article.descriptionDE = translatedDescs[j] || truncate(article.description, 300);
    article.titleDE = translatedTitles[j] || article.title;

    // Save to cache
    cache[article.link + '::desc'] = article.descriptionDE;
    cache[article.link + '::title'] = article.titleDE;
  });

  // Clean cache: only keep entries for current articles
  var activeKeys = new Set();
  articles.forEach(function (a) {
    activeKeys.add(a.link + '::desc');
    activeKeys.add(a.link + '::title');
  });
  var cleanedCache = {};
  Object.keys(cache).forEach(function (key) {
    if (activeKeys.has(key)) cleanedCache[key] = cache[key];
  });

  fs.writeFileSync(cachePath, JSON.stringify(cleanedCache, null, 2), 'utf-8');
  console.log('Uebersetzungen abgeschlossen und gecached (' + Object.keys(cleanedCache).length + ' Eintraege).');
}

// ========== RSS Fetching ==========
async function fetchFeed(feedConfig) {
  try {
    const feed = await parser.parseURL(feedConfig.url);
    console.log('  [OK] ' + feedConfig.source + ': ' + feed.items.length + ' Artikel');
    return feed.items.map(function (item) {
      return {
        title: item.title || '',
        link: sanitizeUrl(item.link),
        description: item.contentSnippet || item.content || '',
        pubDate: item.isoDate || item.pubDate || new Date().toISOString(),
        source: feedConfig.source,
        category: feedConfig.category,
      };
    });
  } catch (err) {
    console.error('  [FEHLER] ' + feedConfig.source + ': ' + err.message);
    return [];
  }
}

function deduplicateByUrl(articles) {
  var seen = new Set();
  return articles.filter(function (article) {
    if (!article.link || seen.has(article.link)) return false;
    seen.add(article.link);
    return true;
  });
}

function filterByDate(articles, days) {
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return articles.filter(function (article) {
    return new Date(article.pubDate) >= cutoff;
  });
}

function sortByDate(articles) {
  return articles.sort(function (a, b) {
    return new Date(b.pubDate) - new Date(a.pubDate);
  });
}

function groupByDay(articles) {
  var groups = {};
  articles.forEach(function (article) {
    var key = dateToKey(new Date(article.pubDate));
    if (!groups[key]) groups[key] = [];
    groups[key].push(article);
  });
  return groups;
}

function categoryLabel(cat) {
  if (cat === 'trend') return 'Trend';
  if (cat === 'tool') return 'Tool';
  return 'News';
}

// ========== HTML Rendering ==========
function renderCard(article) {
  var desc = article.descriptionDE || truncate(article.description, 200);
  var title = escapeHtml(article.titleDE || article.title);
  return '<article class="news-card" data-category="' + (article.category || 'news') + '">' +
    '<div class="news-card-header">' +
      '<span class="news-tag" data-category="' + (article.category || 'news') + '">' + categoryLabel(article.category) + '</span>' +
      '<span class="news-source">' + escapeHtml(article.source || '') + '</span>' +
    '</div>' +
    '<h2 class="news-title">' +
      '<a href="' + escapeHtml(article.link) + '" target="_blank" rel="noopener">' + title + '</a>' +
    '</h2>' +
    (desc ? '<p class="news-description">' + escapeHtml(desc) + '</p>' : '') +
  '</article>';
}

function renderCardGrid(articles) {
  return '<div class="news-grid" id="newsGrid">' + articles.map(renderCard).join('\n') + '</div>';
}

function htmlTemplate(opts) {
  var backLink = opts.backLink ? '<a href="' + opts.backLink + '" class="back-link">&larr; Zurueck zur Uebersicht</a>' : '';
  return '<!DOCTYPE html>\n' +
'<html lang="de">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'  <meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https:; connect-src \'self\'">\n' +
'  <title>' + opts.title + '</title>\n' +
'  <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
'  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
'  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
'  <link rel="stylesheet" href="' + opts.cssPath + '">\n' +
'</head>\n' +
'<body>\n' +
'  <header class="header">\n' +
'    <div class="header-inner">\n' +
'      <div class="logo">\n' +
'        <a href="' + opts.homePath + '" class="logo-link">\n' +
'          <span class="logo-icon">&#9670;</span>\n' +
'          <span class="logo-text">KI News</span>\n' +
'        </a>\n' +
'      </div>\n' +
'      <div class="header-actions">\n' +
'        <button class="theme-toggle" id="themeToggle" aria-label="Dark Mode umschalten">\n' +
'          <span class="icon-sun">&#9788;</span>\n' +
'          <span class="icon-moon">&#9790;</span>\n' +
'        </button>\n' +
'      </div>\n' +
'    </div>\n' +
'  </header>\n' +
'  <main class="main">\n' +
'    ' + backLink + '\n' +
'    ' + opts.body + '\n' +
'  </main>\n' +
'  <footer class="footer">\n' +
'    <p>KI News &middot; Automatisch aggregiert aus RSS-Feeds</p>\n' +
'  </footer>\n' +
'  <script src="' + opts.jsPath + '"></script>\n' +
'</body>\n' +
'</html>';
}

function buildIndexPage(topArticles, dayGroups) {
  var heroHtml = '<section class="hero">\n' +
    '  <h1 class="date-display">' + formatDateDE(new Date()) + '</h1>\n' +
    '  <p class="subtitle">Dein taegliches KI-Briefing</p>\n' +
    '</section>';

  // Global search
  var searchHtml = '<section class="global-search">\n' +
    '  <input type="search" class="search-input" id="globalSearch" placeholder="Alle Artikel durchsuchen...">\n' +
    '  <div class="search-results" id="searchResults" style="display:none;"></div>\n' +
    '</section>';

  // Top 5 section
  var topHtml = '<section class="top-section" id="topSection">\n' +
    '  <h2 class="section-heading">Die wichtigsten Artikel heute</h2>\n' +
    '  <div class="top-articles">\n' +
    topArticles.map(function (article) {
      var desc = article.descriptionDE || truncate(article.description, 180);
      var title = escapeHtml(article.titleDE || article.title);
      return '    <article class="top-card">' +
        '<div class="news-card-header">' +
          '<span class="news-tag" data-category="' + (article.category || 'news') + '">' + categoryLabel(article.category) + '</span>' +
          '<span class="news-source">' + escapeHtml(article.source || '') + '</span>' +
        '</div>' +
        '<h2 class="news-title"><a href="' + escapeHtml(article.link) + '" target="_blank" rel="noopener">' + title + '</a></h2>' +
        (desc ? '<p class="news-description">' + escapeHtml(desc) + '</p>' : '') +
      '</article>';
    }).join('\n') + '\n' +
    '  </div>\n' +
    '</section>';

  // Day navigation
  var sortedDays = Object.keys(dayGroups).sort(function (a, b) { return b.localeCompare(a); });
  var daysHtml = '<section class="days-section" id="daysSection">\n' +
    '  <h2 class="section-heading">Archiv nach Tagen</h2>\n' +
    '  <div class="days-grid">\n' +
    sortedDays.map(function (dayKey) {
      var date = new Date(dayKey + 'T12:00:00');
      var count = dayGroups[dayKey].length;
      return '    <a href="tage/' + dayKey + '.html" class="day-card">' +
        '<span class="day-card-weekday">' + WEEKDAYS_DE[date.getDay()] + '</span>' +
        '<span class="day-card-date">' + formatDateShortDE(date) + '</span>' +
        '<span class="day-card-count">' + count + ' Artikel</span>' +
      '</a>';
    }).join('\n') + '\n' +
    '  </div>\n' +
    '</section>';

  return htmlTemplate({
    title: 'KI News - Dein taegliches KI-Briefing',
    cssPath: 'css/style.css',
    jsPath: 'js/app.js',
    homePath: 'index.html',
    backLink: null,
    body: heroHtml + '\n' + searchHtml + '\n' + topHtml + '\n' + daysHtml,
  });
}

function buildDayPage(dayKey, articles) {
  var date = new Date(dayKey + 'T12:00:00');
  var titleText = formatDateDE(date);

  var heroHtml = '<section class="hero">\n' +
    '  <h1 class="date-display">' + titleText + '</h1>\n' +
    '  <p class="subtitle">' + articles.length + ' Artikel</p>\n' +
    '</section>';

  var filterHtml = '<section class="controls">\n' +
    '  <div class="filter-tabs" id="filterTabs">\n' +
    '    <button class="tab active" data-filter="all">Alle</button>\n' +
    '    <button class="tab" data-filter="news">News</button>\n' +
    '    <button class="tab" data-filter="trend">Trends</button>\n' +
    '    <button class="tab" data-filter="tool">Tools</button>\n' +
    '  </div>\n' +
    '  <div class="search-wrapper">\n' +
    '    <input type="search" class="search-input" id="searchInput" placeholder="Artikel durchsuchen...">\n' +
    '  </div>\n' +
    '</section>';

  var gridHtml = renderCardGrid(articles);

  var emptyHtml = '<div class="empty-state" id="emptyState" style="display:none;">\n' +
    '  <p>Keine Artikel gefunden.</p>\n' +
    '</div>';

  return htmlTemplate({
    title: 'KI News - ' + titleText,
    cssPath: '../css/style.css',
    jsPath: '../js/app.js',
    homePath: '../index.html',
    backLink: '../index.html',
    body: heroHtml + '\n' + filterHtml + '\n' + gridHtml + '\n' + emptyHtml,
  });
}

// ========== Main ==========
async function main() {
  console.log('KI-News Build: Hole RSS-Feeds...\n');

  var results = await Promise.all(FEEDS.map(fetchFeed));
  var articles = results.flat();
  console.log('\nGesamt geholt: ' + articles.length);

  // Load existing curated articles
  var dataPath = path.join(__dirname, '..', 'data', 'news.json');
  var existingCurated = [];
  if (fs.existsSync(dataPath)) {
    try {
      var existing = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      existingCurated = existing.filter(function (a) { return a.curated === true; });
      console.log('Vorhandene kuratierte Artikel: ' + existingCurated.length);
    } catch (e) {
      // ignore
    }
  }

  articles = filterByDate(articles, DAYS_TO_KEEP);
  console.log('Nach Datumsfilter (' + DAYS_TO_KEEP + ' Tage): ' + articles.length);

  articles = deduplicateByUrl(articles);
  console.log('Nach Deduplizierung: ' + articles.length);

  articles = [].concat(existingCurated, articles);
  articles = deduplicateByUrl(articles);
  articles = sortByDate(articles);
  console.log('Finale Artikelanzahl: ' + articles.length);

  // Translate articles
  await translateArticles(articles);

  // Save news.json (with translations)
  var dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(articles, null, 2), 'utf-8');

  // Group by day
  var dayGroups = groupByDay(articles);

  // Top 5: newest articles from diverse sources
  var top5 = [];
  var usedSources = new Set();
  for (var i = 0; i < articles.length && top5.length < 5; i++) {
    if (!usedSources.has(articles[i].source)) {
      top5.push(articles[i]);
      usedSources.add(articles[i].source);
    }
  }
  for (var j = 0; j < articles.length && top5.length < 5; j++) {
    if (top5.indexOf(articles[j]) === -1) {
      top5.push(articles[j]);
    }
  }

  // Generate index.html
  var indexHtml = buildIndexPage(top5, dayGroups);
  var indexPath = path.join(__dirname, '..', 'index.html');
  fs.writeFileSync(indexPath, indexHtml, 'utf-8');
  console.log('Index-Seite generiert');

  // Generate day pages
  var tageDir = path.join(__dirname, '..', 'tage');
  if (!fs.existsSync(tageDir)) fs.mkdirSync(tageDir, { recursive: true });

  var existingFiles = fs.readdirSync(tageDir);
  existingFiles.forEach(function (f) {
    if (f.endsWith('.html')) {
      fs.unlinkSync(path.join(tageDir, f));
    }
  });

  var sortedDays = Object.keys(dayGroups).sort(function (a, b) { return b.localeCompare(a); });
  sortedDays.forEach(function (dayKey) {
    var dayHtml = buildDayPage(dayKey, dayGroups[dayKey]);
    fs.writeFileSync(path.join(tageDir, dayKey + '.html'), dayHtml, 'utf-8');
  });
  console.log(sortedDays.length + ' Tages-Seiten generiert');

  console.log('\nBuild abgeschlossen.');
}

main().catch(function (err) {
  console.error('Build fehlgeschlagen:', err);
  process.exit(1);
});
