// paulwarnick.me: header state, menu, theme toggle, scroll reveals, email link.
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Header: see-through over the hero photo, solid once you scroll past it.
  // The margin is a little taller than the header, so a sliver of photo left
  // under it (after jumping to a section) never shows through.
  var header = document.querySelector('[data-header]');
  var hero = document.querySelector('.hero');
  if (header && hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      header.classList.toggle('on-hero', entries[0].isIntersecting);
    }, { rootMargin: '-96px 0px 0px 0px' }).observe(hero);
  } else if (header) {
    header.classList.remove('on-hero');
  }

  // Small-screen menu.
  var navToggle = document.querySelector('[data-nav-toggle]');
  var navList = document.querySelector('[data-nav-list]');
  function setMenu(open) {
    navList.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
  }
  if (navToggle && navList) {
    navToggle.addEventListener('click', function () {
      setMenu(navToggle.getAttribute('aria-expanded') !== 'true');
    });
    navList.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navList.classList.contains('is-open')) {
        setMenu(false);
        navToggle.focus();
      }
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.nav')) setMenu(false);
    });
  }

  // Theme: follows the system until the visitor picks one, then remembers it.
  var themeToggle = document.querySelector('[data-theme-toggle]');
  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  function currentTheme() {
    return root.getAttribute('data-theme') || (systemDark.matches ? 'dark' : 'light');
  }
  function labelThemeToggle() {
    if (!themeToggle) return;
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    themeToggle.setAttribute('aria-label', 'Switch to ' + next + ' theme');
  }
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
      labelThemeToggle();
    });
    systemDark.addEventListener('change', labelThemeToggle);
    labelThemeToggle();
  }

  // Gentle fade-up as sections scroll into view. Siblings stagger slightly.
  var revealables = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || reduceMotion.matches) {
    revealables.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    revealables.forEach(function (el) {
      var siblings = Array.prototype.filter.call(el.parentNode.children, function (c) {
        return c.classList.contains('reveal');
      });
      var i = siblings.indexOf(el);
      if (i > 0) el.style.setProperty('--delay', Math.min(i, 6) * 0.07 + 's');
    });
    var revealer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealables.forEach(function (el) { revealer.observe(el); });
  }

  // Photos fade in once loaded instead of popping in.
  document.querySelectorAll('.photo img').forEach(function (img) {
    if (img.complete && img.naturalWidth) {
      img.classList.add('is-loaded');
    } else {
      img.addEventListener('load', function () { img.classList.add('is-loaded'); }, { once: true });
      img.addEventListener('error', function () { img.classList.add('is-loaded'); }, { once: true });
    }
  });

  // Justified rows: a nearly full last row should stretch to the edge like the
  // rows above it; a short leftover row keeps its natural size instead of
  // blowing up. Measured from each item's base width, so it works at any
  // screen width and before or after "Show all photos".
  function balanceLastRow(gallery) {
    var items = Array.prototype.filter.call(gallery.children, function (el) {
      return el.offsetParent !== null;
    });
    if (!items.length) return;
    var lastTop = items[items.length - 1].offsetTop;
    var styles = window.getComputedStyle(gallery);
    var rowH = parseFloat(styles.getPropertyValue('--row-h')) || 300;
    var gap = parseFloat(styles.columnGap) || 0;
    var used = 0;
    var count = 0;
    items.forEach(function (el) {
      if (el.offsetTop !== lastTop) return;
      var basis = window.getComputedStyle(el).flexBasis;
      var ar = parseFloat(window.getComputedStyle(el).getPropertyValue('--ar')) || 1;
      used += /%$/.test(basis) ? gallery.clientWidth : ar * rowH;
      count++;
    });
    used += gap * Math.max(count - 1, 0);
    gallery.classList.toggle('fill-last', used / gallery.clientWidth > 0.6);
  }

  var galleries = document.querySelectorAll('.gallery');
  var balanceQueued = false;
  function balanceAll() {
    if (balanceQueued) return;
    balanceQueued = true;
    window.requestAnimationFrame(function () {
      balanceQueued = false;
      galleries.forEach(balanceLastRow);
    });
  }
  balanceAll();
  window.addEventListener('resize', balanceAll);
  window.addEventListener('load', balanceAll);

  // "Show all photos": the rest of the gallery stays hidden until asked for.
  // Without JavaScript the button never appears and every photo shows.
  document.querySelectorAll('[data-show-all]').forEach(function (button) {
    var gallery = button.closest('.gallery-more').previousElementSibling;
    if (!gallery) return;
    button.hidden = false;
    button.addEventListener('click', function () {
      gallery.classList.add('is-expanded');
      balanceAll();
      var first = gallery.querySelector('.photo.is-extra');
      if (first) first.focus({ preventScroll: true });
    });
  });

  // Email address is assembled here so it isn't sitting in the page for scrapers.
  var address = ['paulwarnick21', 'gmail.com'].join('@');
  document.querySelectorAll('[data-email]').forEach(function (link) {
    link.href = 'mailto:' + address;
    var text = link.querySelector('[data-email-text]');
    if (text) text.textContent = address;
  });

  var year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
})();
