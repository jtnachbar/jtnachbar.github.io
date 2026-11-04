/* ------------------------------------------------------------------
   jamienachbar.com — split-flap type engine
   - text starts as noise and resolves on load (flipboard)
   - corruption is a function of distance from the pointer
   - long passages corrupt far less than short ones
   - background characters rotate at depth, blur with distance,
     fade over their life, and settle when you get close
   ------------------------------------------------------------------ */

(function () {
  'use strict';

  var docEl = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (reduceMotion) {
    docEl.classList.add('no-motion');
    return;
  }

  /* ---------------- character pools ---------------- */

  // characters that a glyph is allowed to decay into (visually adjacent)
  // Decay targets are never another Latin letter: a word may look damaged but
  // it is never misspelled into a different word. Allowed targets are
  //   - digits and symbols with the same skeleton (4/a, 5/s, 0/o, (/c)
  //   - the same letter carrying a diacritic (a/á/ä) - still reads as "a"
  //   - the same shape in another script (м/m, К/K, г/r, ω/w), which reads as
  //     a damaged glyph rather than as a substitute letter
  var SIMILAR = {
    a: ['4', '@', 'á', 'ä', 'å', 'а'],
    b: ['8', '6', 'ь'],
    c: ['(', '<', '¢', 'ç', 'с'],
    d: ['0', '∂'],
    e: ['3', '€', 'ë', 'é', 'е'],
    f: ['7', 'ƒ'],
    g: ['9', '6'],
    h: ['#', 'һ'],
    i: ['1', '!', '|', 'í', 'ï', 'і'],
    j: [';', 'ј'],
    k: ['к', 'κ'],
    l: ['1', '|', '!', 'ł'],
    m: ['м'],
    n: ['ñ', 'п'],
    o: ['0', '°', 'ó', 'ö', 'σ'],
    p: ['9', 'ρ'],
    q: ['9'],
    r: ['®', 'г'],
    s: ['5', '$', '§', 'ѕ'],
    t: ['7', '+', '†', 'τ'],
    u: ['ü', 'ú', 'υ'],
    v: ['√', 'ν'],
    w: ['ω', 'ш'],
    x: ['×', 'х'],
    y: ['¥', 'ý', 'ÿ', 'γ'],
    z: ['2', 'ž'],
    A: ['4', '@', 'Á', 'Ä', 'Å', 'А'],
    B: ['8', '6', 'Β'],
    C: ['(', '<', 'Ç', '€', 'С'],
    D: ['0', 'Ð'],
    E: ['3', '€', 'Ë', 'É', 'Е'],
    F: ['7', 'ƒ'],
    G: ['6', '9'],
    H: ['#', 'Н'],
    I: ['1', '!', '|', 'Í', 'І'],
    J: ['Ј'],
    K: ['К', 'Κ'],
    L: ['1', '|', '£', 'Ł'],
    M: ['М'],
    N: ['Ν', 'п'],
    O: ['0', 'О', 'Ó', 'Ö'],
    P: ['9', 'Ρ'],
    Q: ['9'],
    R: ['®', 'Я'],
    S: ['5', '$', '§', 'Ѕ'],
    T: ['7', '+', '†', 'Т'],
    U: ['Ü', 'Ú'],
    V: ['√', '∨'],
    W: ['Ш'],
    X: ['×', 'Х'],
    Y: ['¥', 'Ý', 'Υ'],
    Z: ['2', 'Ž'],
    '0': ['°', '○'],
    '1': ['|', '!', '¹'],
    '2': ['²'],
    '3': ['³'],
    '4': ['+'],
    '5': ['$', '§'],
    '6': ['9'],
    '7': ['+'],
    '8': ['&'],
    '9': ['6']
  };

  // last resort: punctuation and symbols, never a letter
  var TEXT_NOISE = Array.from(new Set(
    ("!@#$%&*+-=?^<>~" + "\u00a2\u00a3\u00a5\u00a7\u00b6\u00b0\u00b1\u00d7\u00f7").split('')
  ));

  // the background is decorative, so it can use the whole drawer
  var BACKGROUND = TEXT_NOISE.concat(
    'αβγδεζηθλμξπρστφχψω'.split(''),
    'abcdefghijklmnopqrstuvwxyz'.split(''),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    '0123456789'.split('')
  );

  var SIMILAR_SINGLE = {};
  Object.keys(SIMILAR).forEach(function (key) {
    SIMILAR_SINGLE[key] = SIMILAR[key].filter(function (c) {
      return Array.from(c).length === 1;
    });
  });

  function rand(min, max) { return min + Math.random() * (max - min); }
  function pick(list) { return list[(Math.random() * list.length) | 0]; }

  // decay a glyph into something that still reads like it
  function morph(real, wild) {
    var pool = SIMILAR_SINGLE[real] ||
      SIMILAR_SINGLE[real.toLowerCase()] ||
      SIMILAR_SINGLE[real.toUpperCase()];
    if (!pool || !pool.length) pool = null;

    var next = null;

    if (wild) {
      // mid-flip: mostly noise, but a third of the tiles land on a lookalike
      next = (pool && Math.random() < 0.32) ? pick(pool) : pick(TEXT_NOISE);
    } else if (pool && Math.random() < 0.93) {
      next = pick(pool);
    } else {
      next = pick(TEXT_NOISE);
    }

    if (next === real) {
      for (var i = 0; i < 6 && next === real; i++) next = pick(TEXT_NOISE);
    }
    return next;
  }

  /* ---------------- text glyphs ---------------- */

  var glyphs = [];
  var blocks = 0;
  var baseTime = performance.now();
  var MAX_CHANCE = finePointer ? 0.4 : 0.34;

  // the load sequence (scramble -> resolve) is stretched by this factor
  var LOAD_STRETCH = 2;

  function splitBlock(el) {
    if (el.dataset.glitchDone) return;
    el.dataset.glitchDone = '1';

    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var label = '';
    var node;

    while ((node = walker.nextNode())) {
      var host = node.parentElement;
      if (!host || host.closest('[data-no-glitch]')) continue;
      nodes.push(node);
      label += node.nodeValue;
    }
    if (!nodes.length) return;

    var count = label.replace(/\s/g, '').length;
    if (count < 2) return;

    // long passages stay far more legible than short labels
    var lenScale = Math.pow(Math.min(1, 90 / Math.max(1, count)), 0.42);
    var blockIndex = blocks++;
    var isHero = el.classList.contains('hero-name') || el.classList.contains('lede');

    el.setAttribute('aria-label', label.replace(/\s+/g, ' ').trim());

    var floatChance = 0.5 * lenScale * (isHero ? 1.7 : 1);
    var churnChance = 0.38 + 0.5 * lenScale;

    nodes.forEach(function (textNode) {
      var text = textNode.nodeValue;
      var frag = document.createDocumentFragment();

      // each word is one atomic box: glyphs can never break a word in half,
      // and words corrupt as clusters so sentences keep a readable rhythm
      var word = null;
      var bias = 0.28 + Math.pow(Math.random(), 1.5) * 1.25;

      for (var i = 0; i < text.length; i++) {
        var ch = text[i];

        if (ch.trim() === '') {
          word = null;
          frag.appendChild(document.createTextNode(ch));
          bias = 0.28 + Math.pow(Math.random(), 1.5) * 1.25;
          continue;
        }

        if (!word) {
          word = document.createElement('span');
          word.className = 'w';
          frag.appendChild(word);
        }

        var span = document.createElement('span');
        span.className = 'g';
        span.textContent = Math.random() < 0.8 ? morph(ch, true) : ch;
        span.dataset.real = ch;
        span.setAttribute('aria-hidden', 'true');

        if (Math.random() < floatChance) {
          span.style.setProperty('--fx', rand(-1.1, 1.1).toFixed(2) + 'px');
          span.style.setProperty('--fy', rand(-1.7, -0.2).toFixed(2) + 'px');
          span.style.setProperty('--fdur', rand(2.6, 6.8).toFixed(2) + 's');
          span.style.setProperty('--fdel', (-rand(0, 5)).toFixed(2) + 's');
          span.classList.add('g-float');
        }

        glyphs.push({
          el: span,
          real: ch,
          chance: 0,
          next: Math.random() * 140,
          ax: 0,
          ay: 0,
          cx: 0,
          cy: 0,
          vis: false,
          scale: lenScale,
          bias: bias,
          churn: Math.random() < churnChance,
          settle: baseTime + LOAD_STRETCH *
            (380 + blockIndex * 60 + rand(0, 460) * lenScale + rand(0, 240))
        });

        word.appendChild(span);
      }

      textNode.parentNode.replaceChild(frag, textNode);
    });
  }

  // positions are cached in document space: glyphs are fixed-width (1ch), so
  // morphing never reflows. Scrolling only shifts the viewport offset.
  var scrollY = window.scrollY || 0;

  function cacheRects() {
    scrollY = window.scrollY || 0;
    for (var i = 0; i < glyphs.length; i++) {
      var g = glyphs[i];
      var r = g.el.getBoundingClientRect();
      g.ax = r.left + r.width / 2;
      g.ay = r.top + scrollY + r.height / 2;
      g.vis = true;
    }
  }

  /* ---------------- pointer ---------------- */

  var ptr = { x: 0, y: 0, on: false };
  var pointerDirty = false;

  function applyChances(now) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var fx, fy;

    if (ptr.on) {
      fx = ptr.x;
      fy = ptr.y;
    } else {
      var t = now * 0.00016;
      fx = vw * (0.5 + 0.34 * Math.sin(t));
      fy = vh * (0.44 + 0.28 * Math.cos(t * 0.83));
    }

    var rIn = finePointer ? 95 : 70;
    var rOut = finePointer ? 430 : 300;
    var span = rOut - rIn;
    var margin = 140;

    for (var i = 0; i < glyphs.length; i++) {
      var g = glyphs[i];
      g.cy = g.ay - scrollY;
      var wasVis = g.vis;
      g.vis = g.cy > -margin && g.cy < vh + margin &&
        g.ax > -80 && g.ax < vw + 80;
      if (!g.vis) { g.chance = 0; continue; }
      // freshly scrolled into view: settle it instead of showing stale noise
      if (!wasVis) g.next = 0;

      var dx = g.ax - fx;
      var dy = g.cy - fy;
      var d = Math.sqrt(dx * dx + dy * dy);
      var t2 = (d - rIn) / span;
      t2 = t2 < 0 ? 0 : t2 > 1 ? 1 : t2;
      t2 = t2 * t2 * (3 - 2 * t2);

      // past the halo, keep climbing: the further away, the more it decays
      var far = Math.max(0, (d - rOut) / rOut);
      var boost = 1 + Math.min(1, far) * 0.75;

      g.chance = Math.min(0.82, MAX_CHANCE * t2 * g.scale * g.bias * boost);

      // right under the cursor: always legible
      if (t2 < 0.07 && g.el.textContent !== g.real) {
        g.el.textContent = g.real;
        g.next = now + rand(700, 1400);
      }
    }
  }

  /* ---------------- text tick ---------------- */

  var flipBudget = 0;

  function flip(el) {
    el.animate(
      [
        { transform: 'scaleY(1)' },
        { transform: 'scaleY(0.66) translateY(0.05em)', offset: 0.45 },
        { transform: 'scaleY(1)' }
      ],
      { duration: 115, easing: 'cubic-bezier(.2,.9,.2,1)' }
    );
  }

  function textTick(now) {
    flipBudget = 26;

    for (var i = 0; i < glyphs.length; i++) {
      var g = glyphs[i];
      if (!g.vis || now < g.next) continue;

      var forced = now < g.settle;
      if (forced && (!g.churn || now < g.settle - 800 * LOAD_STRETCH)) {
        // still waiting its turn: hold the noise, but don't churn
        if (g.el.textContent === g.real) g.el.textContent = morph(g.real, true);
        g.next = now + rand(140, 320) * LOAD_STRETCH;
        continue;
      }

      if (forced || Math.random() < g.chance) {
        var glyph = morph(g.real, forced);
        if (glyph !== g.el.textContent) {
          g.el.textContent = glyph;
          if (flipBudget > 0 && (forced || g.scale > 0.5 || Math.random() < 0.22)) {
            flipBudget--;
            flip(g.el);
          }
        }
        g.next = now + (forced
          ? rand(45, 130) * LOAD_STRETCH
          : rand(280, 1100) * (1.5 - g.chance));
      } else if (g.el.textContent !== g.real) {
        g.el.textContent = g.real;
        if (flipBudget > 0 && g.scale > 0.5) {
          flipBudget--;
          flip(g.el);
        }
        g.next = now + rand(700, 2600);
      } else {
        g.next = now + rand(600, 2600);
      }
    }
  }

  /* ---------------- background field ---------------- */

  var field = document.getElementById('field');
  var dust = [];

  function spawnDust(d) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var depth = Math.pow(Math.random(), 1.25); // 0 = far, 1 = near

    d.depth = depth;
    d.size = 12 + 92 * Math.pow(depth, 1.35);
    d.blur = 0.3 + 6.4 * Math.pow(1 - depth, 1.3);
    d.blurApplied = 99;
    d.base = 0.07 + 0.34 * depth;
    d.spin = rand(0.05, 0.42) * (Math.random() < 0.5 ? -1 : 1) * (0.65 + 0.7 * (1 - depth));
    d.rot = rand(0, 360);
    d.life = rand(6000, 20000) * (0.65 + 0.7 * depth);
    d.age = 0;
    d.stab = 0;
    d.x = rand(-40, vw + 40);
    d.y = rand(-60, vh + 60);
    d.vx = rand(-1, 1) * (3 + 9 * depth);
    d.vy = rand(-1, 1) * (2 + 6 * depth);
    d.morphIn = rand(400, 2200);

    var el = d.el;
    el.textContent = pick(BACKGROUND);
    el.style.fontSize = d.size.toFixed(1) + 'px';
    el.style.transform =
      'translate3d(' + d.x.toFixed(1) + 'px,' + d.y.toFixed(1) + 'px,0)' +
      ' translate(-50%,-50%) rotate(' + d.rot.toFixed(2) + 'deg)';
    el.style.zIndex = String(Math.round(depth * 90));
    el.style.filter = d.blur < 0.2 ? 'none' : 'blur(' + d.blur.toFixed(2) + 'px)';
    el.style.opacity = '0';
  }

  function sizeField() {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var wanted = Math.round((vw * vh) / 21000);
    var cap = finePointer ? 92 : 44;
    var target = Math.max(16, Math.min(cap, wanted));

    while (dust.length < target) {
      var el = document.createElement('span');
      el.className = 'dust' + (Math.random() < 0.18 ? ' dust--stroke' : '');
      field.appendChild(el);
      var d = { el: el };
      dust.push(d);
      spawnDust(d);
    }
    while (dust.length > target) {
      var last = dust.pop();
      if (last.el.parentNode) last.el.parentNode.removeChild(last.el);
    }
  }

  function dustTick(dt, now) {
    if (!dust.length) return;

    var fx, fy;
    if (ptr.on) {
      fx = ptr.x;
      fy = ptr.y;
    } else {
      fx = window.innerWidth * (0.5 + 0.32 * Math.sin(now * 0.00017));
      fy = window.innerHeight * (0.45 + 0.3 * Math.cos(now * 0.00012));
    }

    for (var i = 0; i < dust.length; i++) {
      var d = dust[i];
      d.age += dt;

      var dx = d.x - fx;
      var dy = d.y - fy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var target = dist < (44 + d.size * 0.8) ? 1 : 0;

      d.stab += (target - d.stab) * Math.min(1, dt / 150);
      d.rot += d.spin * (1 - d.stab) * dt * 0.001;

      // drift: settles to a stop when you get close
      var calm = 1 - d.stab;
      if (calm > 0.02) {
        d.x += d.vx * calm * dt * 0.001;
        d.y += d.vy * calm * dt * 0.001;
        if (d.x < -80) { d.x = -80; d.vx = Math.abs(d.vx); }
        else if (d.x > window.innerWidth + 80) { d.x = window.innerWidth + 80; d.vx = -Math.abs(d.vx); }
        if (d.y < -80) { d.y = -80; d.vy = Math.abs(d.vy); }
        else if (d.y > window.innerHeight + 80) { d.y = window.innerHeight + 80; d.vy = -Math.abs(d.vy); }
      }

      // characters churn constantly, and churn fastest far from the cursor
      d.morphIn -= dt;
      if (d.morphIn <= 0) {
        if (d.stab < 0.35) {
          var next = pick(BACKGROUND);
          for (var t = 0; t < 5 && next === d.el.textContent; t++) next = pick(BACKGROUND);
          d.el.textContent = next;
        }
        var farness = Math.min(1, dist / 900);
        d.morphIn = rand(500 + 2400 * (1 - farness), 1500 + 4200 * (1 - farness));
      }

      var lifeT = d.age / d.life;
      if (lifeT >= 1 && d.stab < 0.3) {
        spawnDust(d);
        continue;
      }

      var remain = 1 - Math.pow(Math.min(1, lifeT), 1.8);
      var hold = 0.58 * d.stab; // a settled character stays lit
      var opacity = d.base * Math.max(remain, hold) * (1 + 0.45 * d.stab);

      d.el.style.opacity = Math.min(1, opacity).toFixed(3);
      d.el.style.transform =
        'translate3d(' + d.x.toFixed(1) + 'px,' + d.y.toFixed(1) + 'px,0)' +
        ' translate(-50%,-50%) rotate(' + d.rot.toFixed(2) + 'deg)';

      var blur = d.blur * (1 - d.stab) + 0.15 * d.stab;
      if (Math.abs(blur - d.blurApplied) > 0.1) {
        d.blurApplied = blur;
        d.el.style.filter = blur < 0.2 ? 'none' : 'blur(' + blur.toFixed(2) + 'px)';
      }
    }
  }

  /* ---------------- cursor ring ---------------- */

  var ring = document.getElementById('ring');
  var ringX = window.innerWidth / 2;
  var ringY = window.innerHeight / 2;

  function ringTick(dt) {
    if (!ring || !ptr.on || !finePointer) return;
    var k = Math.min(1, dt / 90);
    ringX += (ptr.x - ringX) * k;
    ringY += (ptr.y - ringY) * k;
    ring.style.transform =
      'translate3d(' + ringX.toFixed(1) + 'px,' + ringY.toFixed(1) + 'px,0) translate(-50%,-50%)';
  }

  /* ---------------- loop ---------------- */

  var last = performance.now();
  var nextText = 0;
  var nextChance = 0;
  var raf = 0;
  var running = true;

  function frame(now) {
    if (!running) return;

    var dt = Math.min(48, now - last);
    if (dt < 0) dt = 16;
    last = now;

    if (pointerDirty) {
      applyChances(now);
      pointerDirty = false;
      nextChance = now + 180;
    } else if (!ptr.on && now >= nextChance) {
      applyChances(now);
      nextChance = now + 240;
    }

    if (now >= nextText) {
      textTick(now);
      nextText = now + (finePointer ? 72 : 110);
    }

    dustTick(dt, now);
    ringTick(dt);

    raf = window.requestAnimationFrame(frame);
  }

  /* ---------------- events ---------------- */

  function onPointer(e) {
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    if (!ptr.on) {
      ptr.on = true;
      if (finePointer) document.body.classList.add('has-pointer');
      ringX = ptr.x;
      ringY = ptr.y;
    }
    pointerDirty = true;
  }

  function releasePointer() {
    ptr.on = false;
    document.body.classList.remove('has-pointer');
    nextChance = 0;
  }

  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });

  if (finePointer) {
    document.addEventListener('pointerleave', releasePointer);
    window.addEventListener('blur', releasePointer);
  } else {
    document.addEventListener('pointerup', releasePointer);
    document.addEventListener('pointercancel', releasePointer);
  }

  window.addEventListener('scroll', function () {
    scrollY = window.scrollY || 0;
    pointerDirty = true;
    nextChance = 0;
  }, { passive: true });

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      sizeField();
      cacheRects();
      applyChances(performance.now());
    }, 160);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      running = false;
      window.cancelAnimationFrame(raf);
    } else if (!running) {
      running = true;
      last = performance.now();
      nextText = 0;
      raf = window.requestAnimationFrame(frame);
    }
  });

  /* ---------------- copy gives you the real text ---------------- */

  var BLOCK = /^(P|DIV|LI|DT|DD|H[1-6]|UL|OL|DL|SECTION|HEADER|FOOTER|MAIN|BLOCKQUOTE)$/;

  function selectionToText(range) {
    var holder = document.createElement('div');
    holder.appendChild(range.cloneContents());

    var spans = holder.querySelectorAll('.g');
    for (var i = 0; i < spans.length; i++) {
      var real = spans[i].getAttribute('data-real');
      if (real !== null) spans[i].textContent = real;
    }

    var out = '';
    (function walk(node) {
      if (node.nodeType === 3) { out += node.nodeValue; return; }
      if (node.nodeType !== 1) return;
      if (node.nodeName === 'BR') { out += '\n'; return; }
      var isBlock = BLOCK.test(node.nodeName);
      if (isBlock && out && out.charAt(out.length - 1) !== '\n') out += '\n';
      for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
      if (isBlock && out && out.charAt(out.length - 1) !== '\n') out += '\n';
    })(holder);

    return out
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  document.addEventListener('copy', function (e) {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;

    var range = sel.getRangeAt(0);
    var text = selectionToText(range);
    if (!text) return;

    if (e.clipboardData) {
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
    }

    // small echo: what you copied settles for a moment
    var now = performance.now();
    for (var i = 0; i < glyphs.length; i++) {
      var g = glyphs[i];
      if (!g.vis || g.el.textContent === g.real) continue;
      if (range.intersectsNode(g.el)) {
        g.el.textContent = g.real;
        g.next = now + rand(1600, 3000);
      }
    }
  });

  /* ---------------- favicon: one tile that flips ---------------- */

  var icon = null;
  (function () {
    var links = document.querySelectorAll('link[rel~="icon"]');
    if (!links.length) return;
    // keep a single icon link so the browser has no reason to prefer another
    for (var i = 1; i < links.length; i++) {
      if (links[i].parentNode) links[i].parentNode.removeChild(links[i]);
    }
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    links[0].removeAttribute('sizes');
    links[0].setAttribute('type', 'image/png');
    icon = { link: links[0], ctx: ctx, size: 64 };
  })();

  if (icon) {
    var paintIcon = function (ch) {
      var ctx = icon.ctx;
      var s = icon.size;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#fff';
      ctx.font = '700 46px ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch, s / 2, s / 2 + 1);
      try { icon.link.href = ctx.canvas.toDataURL('image/png'); } catch (err) { /* ignore */ }
    };

    paintIcon('J');

    var FLIP_GLYPHS = [']', '1', '4', '(', ')'];
    window.setInterval(function () {
      if (document.hidden) return;
      if (Math.random() < 0.6) return; // mostly settled
      paintIcon(pick(FLIP_GLYPHS));
      window.setTimeout(function () {
        if (!document.hidden) paintIcon('J');
      }, rand(150, 300));
    }, 3886);
  }

  /* ---------------- boot ---------------- */

  baseTime = performance.now();

  if (!finePointer) {
    var hint = document.querySelector('.hint');
    if (hint) hint.textContent = 'Press and drag: the type settles under your finger.';
  }

  var glitchTargets = document.querySelectorAll('[data-glitch]');
  for (var i = 0; i < glitchTargets.length; i++) splitBlock(glitchTargets[i]);

  sizeField();
  cacheRects();
  applyChances(baseTime);

  window.addEventListener('load', function () {
    cacheRects();
    applyChances(performance.now());
  });

  window.setTimeout(function () {
    cacheRects();
    applyChances(performance.now());
  }, 700);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      cacheRects();
      applyChances(performance.now());
    });
  }

  window.requestAnimationFrame(function (now) {
    last = now;
    raf = window.requestAnimationFrame(frame);
  });
})();
