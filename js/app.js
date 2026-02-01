(function () {
  'use strict';

  // ========== Security Helpers ==========
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

  // ========== Dark Mode ==========
  var themeToggle = document.getElementById('themeToggle');

  function getPreferredTheme() {
    var stored = localStorage.getItem('theme');
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }

  applyTheme(getPreferredTheme());

  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  // ========== Global Search (Index Page) ==========
  var globalSearch = document.getElementById('globalSearch');
  var searchResults = document.getElementById('searchResults');
  var topSection = document.getElementById('topSection');
  var daysSection = document.getElementById('daysSection');

  if (globalSearch && searchResults) {
    var allNews = null;

    var dataPath = 'data/news.json';

    function loadNewsData() {
      if (allNews !== null) return Promise.resolve(allNews);
      return fetch(dataPath)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          allNews = data;
          return data;
        });
    }

    function categoryLabel(cat) {
      if (cat === 'trend') return 'Trend';
      if (cat === 'tool') return 'Tool';
      return 'News';
    }

    function renderSearchResult(item) {
      var desc = item.descriptionDE || item.description || '';
      if (desc.length > 150) desc = desc.substring(0, 150) + '...';
      var title = escapeHtml(item.titleDE || item.title);
      var safeLink = escapeHtml(sanitizeUrl(item.link));
      var safeSource = escapeHtml(item.source || '');
      var safeDesc = escapeHtml(desc);
      var safeCat = escapeHtml(item.category || 'news');

      return '<article class="news-card" data-category="' + safeCat + '">' +
        '<div class="news-card-header">' +
          '<span class="news-tag" data-category="' + safeCat + '">' + categoryLabel(item.category) + '</span>' +
          '<span class="news-source">' + safeSource + '</span>' +
        '</div>' +
        '<h2 class="news-title">' +
          '<a href="' + safeLink + '" target="_blank" rel="noopener">' + title + '</a>' +
        '</h2>' +
        (desc ? '<p class="news-description">' + safeDesc + '</p>' : '') +
      '</article>';
    }

    function doGlobalSearch() {
      var query = globalSearch.value.toLowerCase().trim();

      if (!query) {
        searchResults.style.display = 'none';
        searchResults.innerHTML = '';
        if (topSection) topSection.style.display = '';
        if (daysSection) daysSection.style.display = '';
        return;
      }

      loadNewsData().then(function (data) {
        var filtered = data.filter(function (item) {
          var text = (item.titleDE || item.title || '') + ' ' +
                     (item.descriptionDE || item.description || '') + ' ' +
                     (item.source || '');
          return text.toLowerCase().indexOf(query) !== -1;
        });

        if (topSection) topSection.style.display = 'none';
        if (daysSection) daysSection.style.display = 'none';

        if (filtered.length === 0) {
          searchResults.innerHTML = '<div class="empty-state"><p>Keine Artikel gefunden.</p></div>';
        } else {
          searchResults.innerHTML =
            '<h2 class="section-heading">' + filtered.length + ' Ergebnis' + (filtered.length !== 1 ? 'se' : '') + '</h2>' +
            '<div class="news-grid">' +
            filtered.map(renderSearchResult).join('\n') +
            '</div>';
        }
        searchResults.style.display = 'block';
      });
    }

    var searchTimeout;
    globalSearch.addEventListener('input', function () {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(doGlobalSearch, 250);
    });
  }

  // ========== Day Page: Filtering & Search ==========
  var filterTabs = document.getElementById('filterTabs');
  var searchInput = document.getElementById('searchInput');
  var emptyState = document.getElementById('emptyState');
  var newsGrid = document.querySelector('.news-grid');

  if (!filterTabs || !searchInput || !newsGrid) return;

  var allCards = Array.prototype.slice.call(newsGrid.querySelectorAll('.news-card'));
  var activeFilter = 'all';

  function filterCards() {
    var query = searchInput.value.toLowerCase().trim();
    var visibleCount = 0;

    allCards.forEach(function (card) {
      var category = card.getAttribute('data-category') || 'news';
      var matchesFilter = activeFilter === 'all' || category === activeFilter;

      var title = card.querySelector('.news-title');
      var desc = card.querySelector('.news-description');
      var source = card.querySelector('.news-source');
      var text = (title ? title.textContent : '') + ' ' +
                 (desc ? desc.textContent : '') + ' ' +
                 (source ? source.textContent : '');
      var matchesSearch = !query || text.toLowerCase().indexOf(query) !== -1;

      if (matchesFilter && matchesSearch) {
        card.style.display = '';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    if (emptyState) {
      emptyState.style.display = visibleCount === 0 ? 'block' : 'none';
    }
  }

  filterTabs.addEventListener('click', function (e) {
    if (!e.target.classList.contains('tab')) return;
    filterTabs.querySelectorAll('.tab').forEach(function (t) {
      t.classList.remove('active');
    });
    e.target.classList.add('active');
    activeFilter = e.target.getAttribute('data-filter');
    filterCards();
  });

  var daySearchTimeout;
  searchInput.addEventListener('input', function () {
    clearTimeout(daySearchTimeout);
    daySearchTimeout = setTimeout(filterCards, 200);
  });
})();
