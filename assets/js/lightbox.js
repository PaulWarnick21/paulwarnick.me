// paulwarnick.me: full-screen photo viewer for the trip galleries.
//
// - Opens by growing the photo out of its thumbnail, and shrinks back on close.
// - Swipe or drag sideways for the next photo, down to close; arrow keys and
//   Escape on a keyboard. Pinch-zoom is left to the browser.
// - Shows the already-loaded thumbnail instantly, then swaps in the full-size
//   file, and preloads the photos either side.
// - Without JavaScript, every thumbnail is still a plain link to the full photo.
(function () {
  'use strict';

  var galleries = document.querySelectorAll('[data-gallery]');
  if (!galleries.length || typeof HTMLDialogElement !== 'function') return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var coarse = window.matchMedia('(pointer: coarse)');
  var EASE = 'cubic-bezier(0.2, 0.75, 0.2, 1)';

  var ICON = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5-6.5 6.5 6.5 6.5"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5"/></svg>'
  };

  var dlg = document.createElement('dialog');
  dlg.className = 'lb';
  dlg.setAttribute('aria-label', 'Photo viewer');
  dlg.innerHTML =
    '<div class="lb-bg" data-bg></div>' +
    '<div class="lb-stage" data-stage><img class="lb-img" data-img alt="" draggable="false"></div>' +
    '<div class="lb-top lb-chrome">' +
      '<p class="lb-count" data-count aria-live="polite"></p>' +
      '<button class="lb-btn" type="button" data-close aria-label="Close">' + ICON.close + '</button>' +
    '</div>' +
    '<button class="lb-btn lb-prev lb-chrome" type="button" data-prev aria-label="Previous photo">' + ICON.prev + '</button>' +
    '<button class="lb-btn lb-next lb-chrome" type="button" data-next aria-label="Next photo">' + ICON.next + '</button>' +
    '<p class="lb-caption lb-chrome" data-caption></p>';
  document.body.appendChild(dlg);

  var bg = dlg.querySelector('[data-bg]');
  var stage = dlg.querySelector('[data-stage]');
  var img = dlg.querySelector('[data-img]');
  var count = dlg.querySelector('[data-count]');
  var caption = dlg.querySelector('[data-caption]');
  var chrome = dlg.querySelectorAll('.lb-chrome');

  var items = [];
  var index = 0;
  var title = '';
  var rect = null;
  var busy = false;
  var closing = false;
  var drag = null;
  var queued = 0;
  var loadToken = 0;

  function collect(gallery) {
    return Array.prototype.map.call(gallery.querySelectorAll('a.photo'), function (link) {
      var thumb = link.querySelector('img');
      return {
        link: link,
        thumb: thumb,
        full: link.getAttribute('href'),
        w: Number(link.dataset.w) || thumb.naturalWidth || 3,
        h: Number(link.dataset.h) || thumb.naturalHeight || 2,
        alt: thumb.alt,
        caption: link.dataset.caption || ''
      };
    });
  }

  // Largest rect with the photo's shape that fits the screen, leaving room
  // for the arrows and the top/bottom bars on larger screens.
  function fit(item) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var padX = coarse.matches ? 0 : 84;
    var padY = coarse.matches ? 52 : 68;
    var maxW = Math.max(vw - padX * 2, 120);
    var maxH = Math.max(vh - padY * 2, 120);
    var scale = Math.min(maxW / item.w, maxH / item.h);
    var w = item.w * scale;
    var h = item.h * scale;
    return { x: (vw - w) / 2, y: (vh - h) / 2, w: w, h: h };
  }

  function place(r) {
    img.style.left = r.x + 'px';
    img.style.top = r.y + 'px';
    img.style.width = r.w + 'px';
    img.style.height = r.h + 'px';
  }

  // Transform that makes the viewer image sit exactly on top of `box`.
  function flip(box, r) {
    return 'translate(' + (box.left - r.x) + 'px, ' + (box.top - r.y) + 'px) ' +
      'scale(' + (box.width / r.w) + ', ' + (box.height / r.h) + ')';
  }

  function currentTransform() {
    var t = window.getComputedStyle(img).transform;
    return t && t !== 'none' ? t : 'translate(0px, 0px)';
  }

  function setSource(item) {
    var token = ++loadToken;
    var thumbReady = item.thumb.complete && item.thumb.naturalWidth > 0;
    img.src = thumbReady ? (item.thumb.currentSrc || item.thumb.src) : item.full;
    img.alt = item.alt;
    if (!thumbReady) return;
    var full = new Image();
    full.src = item.full;
    var swap = function () { if (token === loadToken) img.src = item.full; };
    if (full.decode) full.decode().then(swap, function () {});
    else full.onload = swap;
  }

  function preload(i) {
    var item = items[(i + items.length) % items.length];
    if (item) { var p = new Image(); p.src = item.full; }
  }

  function show(i) {
    index = (i + items.length) % items.length;
    var item = items[index];
    setSource(item);
    rect = fit(item);
    place(rect);
    count.textContent = (index + 1) + ' / ' + items.length + (title ? '  ·  ' + title : '');
    caption.textContent = item.caption;
    preload(index + 1);
    preload(index - 1);
  }

  // Runs `fn` once when the animation ends. The timer is a backstop: browsers
  // can pause animations (background tabs, power saving), and the viewer must
  // never get stuck waiting for one.
  function settle(anim, ms, fn) {
    var done = false;
    var run = function () { if (!done) { done = true; fn(); } };
    anim.onfinish = run;
    anim.oncancel = run;
    setTimeout(run, ms + 120);
  }

  function fade(el, from, to, duration, delay) {
    return el.animate([{ opacity: from }, { opacity: to }], {
      duration: duration, delay: delay || 0, easing: 'ease-out', fill: 'both'
    });
  }

  function open(gallery, i) {
    items = collect(gallery);
    title = gallery.dataset.title || '';
    show(i);
    document.documentElement.classList.add('lb-open');
    dlg.showModal();
    dlg.querySelector('[data-close]').focus({ preventScroll: true });

    var box = items[index].thumb.getBoundingClientRect();
    if (reduceMotion.matches || !box.width) return;
    busy = true;
    var grow = img.animate(
      [{ transform: flip(box, rect) }, { transform: 'translate(0px, 0px)' }],
      { duration: 440, easing: EASE }
    );
    var bgIn = fade(bg, 0, 1, 340);
    settle(bgIn, 340, function () { bgIn.cancel(); });
    Array.prototype.forEach.call(chrome, function (el) {
      var chromeIn = fade(el, 0, 1, 280, 160);
      settle(chromeIn, 440, function () { chromeIn.cancel(); });
    });
    settle(grow, 440, function () { busy = false; flushQueue(); });
  }

  function finishClose(item) {
    dlg.close();
    document.documentElement.classList.remove('lb-open');
    img.getAnimations().forEach(function (a) { a.cancel(); });
    bg.getAnimations().forEach(function (a) { a.cancel(); });
    Array.prototype.forEach.call(chrome, function (el) {
      el.getAnimations().forEach(function (a) { a.cancel(); });
    });
    img.style.transform = '';
    bg.style.opacity = '';
    closing = false;
    busy = false;
    queued = 0;
    if (item) item.link.focus({ preventScroll: true });
  }

  function close() {
    if (!dlg.open || closing) return;
    closing = true;
    var item = items[index];
    if (reduceMotion.matches) { finishClose(item); return; }

    var box = item.thumb.getBoundingClientRect();
    var onScreen = box.width > 0 && box.bottom > 0 && box.top < window.innerHeight;
    var start = currentTransform();
    var end = onScreen ? flip(box, rect) : 'translate(0px, 40px) scale(0.94)';
    var bgFrom = window.getComputedStyle(bg).opacity;

    img.style.transform = '';
    bg.style.opacity = '';
    var duration = onScreen ? 380 : 220;
    var shrink = img.animate(
      [{ transform: start, opacity: 1 }, { transform: end, opacity: onScreen ? 1 : 0 }],
      { duration: duration, easing: EASE, fill: 'forwards' }
    );
    fade(bg, bgFrom, 0, 320);
    Array.prototype.forEach.call(chrome, function (el) { fade(el, 1, 0, 160); });
    settle(shrink, duration, function () { finishClose(item); });
  }

  // A press that arrives mid-animation is remembered and played right after,
  // so fast clicking never feels ignored.
  function flushQueue() {
    if (!queued) return;
    var d = queued;
    queued = 0;
    go(d);
  }

  function go(delta, startX) {
    if (closing || items.length < 2) return;
    if (busy) { queued = delta; return; }
    if (reduceMotion.matches) { show(index + delta); return; }
    busy = true;
    var distance = Math.max(64, Math.abs(startX || 0) + 90);
    var start = currentTransform();
    img.style.transform = '';
    var out = img.animate(
      [{ transform: start, opacity: 1 }, { transform: 'translate(' + (-delta * distance) + 'px, 0px)', opacity: 0 }],
      { duration: 170, easing: 'ease-in', fill: 'forwards' }
    );
    settle(out, 170, function () {
      show(index + delta);
      out.cancel();
      var enter = img.animate(
        [{ transform: 'translate(' + (delta * 64) + 'px, 0px)', opacity: 0 }, { transform: 'translate(0px, 0px)', opacity: 1 }],
        { duration: 280, easing: EASE }
      );
      settle(enter, 280, function () { busy = false; flushQueue(); });
    });
  }

  function snapBack() {
    var t = img.style.transform;
    var o = bg.style.opacity;
    img.style.transform = '';
    bg.style.opacity = '';
    if (reduceMotion.matches) return;
    if (t) img.animate([{ transform: t }, { transform: 'translate(0px, 0px)' }], { duration: 300, easing: EASE });
    if (o) bg.animate([{ opacity: o }, { opacity: 1 }], { duration: 300, easing: EASE });
  }

  // ---- Pointer: swipe sideways to move, down to close, tap backdrop to close.

  stage.addEventListener('pointerdown', function (e) {
    if (busy || closing || !e.isPrimary || e.button > 0) return;
    if (window.visualViewport && window.visualViewport.scale > 1.01) return; // pinch-zoomed in
    if (e.pointerType === 'mouse') e.preventDefault();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, dy: 0, axis: null };
  });

  stage.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dx = e.clientX - drag.x;
    drag.dy = e.clientY - drag.y;
    if (!drag.axis) {
      if (Math.abs(drag.dx) < 8 && Math.abs(drag.dy) < 8) return;
      drag.axis = Math.abs(drag.dx) > Math.abs(drag.dy) ? 'x' : 'y';
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      dlg.classList.add('is-dragging');
      img.classList.add('is-dragging');
    }
    if (drag.axis === 'x') {
      var dx = items.length < 2 ? drag.dx * 0.25 : drag.dx;
      img.style.transform = 'translate(' + dx + 'px, 0px)';
    } else {
      var dy = drag.dy < 0 ? drag.dy * 0.25 : drag.dy;
      var p = Math.min(Math.abs(dy) / 320, 1);
      img.style.transform = 'translate(0px, ' + dy + 'px) scale(' + (1 - p * 0.12) + ')';
      bg.style.opacity = String(1 - p * 0.75);
    }
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    dlg.classList.remove('is-dragging');
    img.classList.remove('is-dragging');

    if (!d.axis) {
      if (e.type === 'pointerup' && e.target === stage) close();
      return;
    }
    var dt = Math.max(performance.now() - d.t, 1);
    if (d.axis === 'x') {
      var far = Math.abs(d.dx) > Math.min(window.innerWidth * 0.18, 140);
      var fast = Math.abs(d.dx / dt) > 0.5 && Math.abs(d.dx) > 30;
      if ((far || fast) && items.length > 1) go(d.dx < 0 ? 1 : -1, d.dx);
      else snapBack();
    } else if (d.dy > 110 || (d.dy / dt > 0.6 && d.dy > 40)) {
      close();
    } else {
      snapBack();
    }
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---- Buttons and keys.

  dlg.querySelector('[data-close]').addEventListener('click', close);
  dlg.querySelector('[data-prev]').addEventListener('click', function () { go(-1); });
  dlg.querySelector('[data-next]').addEventListener('click', function () { go(1); });

  dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
  dlg.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  });

  window.addEventListener('resize', function () {
    if (!dlg.open || !items.length) return;
    rect = fit(items[index]);
    place(rect);
  });

  // ---- Open from any thumbnail (modifier-clicks still open the file in a new tab).

  Array.prototype.forEach.call(galleries, function (gallery) {
    gallery.addEventListener('click', function (e) {
      var link = e.target.closest('a.photo');
      if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      var all = gallery.querySelectorAll('a.photo');
      open(gallery, Array.prototype.indexOf.call(all, link));
    });
  });
})();
