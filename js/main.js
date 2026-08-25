/* ============================================================
   JB PORTFOLIO / main.js
   scroll = scrub: timecode HUD, playhead, GSAP scenes
   ============================================================ */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- timecode HUD + active scene tracking ---------- */
const tcEl = document.getElementById("timecode");
const sceneEl = document.getElementById("scene-marker");
const scenes = document.querySelectorAll("[data-scene]");
const navTabs = document.querySelectorAll(".scene-nav-tab");

function pad(n) { return String(n).padStart(2, "0"); }

function updateHud() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const p = max > 0 ? window.scrollY / max : 0;

  // map full scroll to a fictional 2-minute timeline @ 24fps
  const totalFrames = 2 * 60 * 24;
  const f = Math.round(p * totalFrames);
  const fr = f % 24;
  const s = Math.floor(f / 24) % 60;
  const m = Math.floor(f / (24 * 60));
  if (tcEl) tcEl.textContent = `00:${pad(m)}:${pad(s)}:${pad(fr)}`;

  // current scene: last one whose top passed mid-viewport
  let current = scenes[0];
  scenes.forEach((sc) => {
    if (sc.getBoundingClientRect().top < window.innerHeight * 0.5) current = sc;
  });
  if (sceneEl && current) sceneEl.textContent = current.dataset.scene;
  if (current) {
    navTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.target === current.id));
  }
}
window.addEventListener("scroll", updateHud, { passive: true });
window.addEventListener("resize", updateHud);
updateHud();

/* ---------- scene nav: mobile hamburger toggle ---------- */
(() => {
  const toggle = document.getElementById("scene-nav-toggle");
  const tabs = document.getElementById("scene-nav-tabs");
  if (!toggle || !tabs) return;

  function closeMenu() {
    toggle.classList.remove("is-open");
    tabs.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  }
  toggle.addEventListener("click", () => {
    const open = toggle.classList.toggle("is-open");
    tabs.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });
  tabs.querySelectorAll(".scene-nav-tab").forEach((tab) => tab.addEventListener("click", closeMenu));
})();

/* NOTE: the custom ring cursor and its mousemove tracking were removed. The
   native pointer is used throughout now. */

/* ---------- hero backdrop video: pick wide vs tall ----------
   Assigning .src in JS (rather than shipping two <video> elements or relying
   on <source media>, which browsers don't re-evaluate on resize) guarantees
   only ONE file is ever downloaded, and lets us swap it if the viewport
   flips orientation. */
(() => {
  const v = document.querySelector(".hero-media-video");
  if (!v) return;

  const portrait = window.matchMedia("(max-width: 720px)");
  let current = null;

  function pick() {
    const next = portrait.matches
      ? v.dataset.srcTall
      : v.dataset.srcWide;
    if (!next || next === current) return;
    current = next;
    v.src = next;
    /* Hold on frame 1 rather than autoplaying: the pinned hero sequence
       starts playback. Nudging currentTime forces browsers that won't paint
       an unplayed <video> to actually render that first frame. */
    v.addEventListener("loadeddata", () => {
      if (v.dataset.played) return;
      try { v.currentTime = 0.001; } catch (_) {}
    }, { once: true });
  }

  const RATE = 1.5;
  /* set on every play(): some browsers reset playbackRate when the source
     changes or after a seek back to 0 for the manual loop */
  const play = () => {
    v.playbackRate = RATE;
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  };
  let started = false;   // has the pinned sequence kicked things off yet?

  /* Measured on demand rather than cached from an IntersectionObserver
     callback: `ended` can fire before an IO callback lands (fast scroll, or a
     throttled/background tab), and a stale flag would let the clip keep looping
     off-screen. Reading a rect is cheap and always current.
     We measure the VIDEO, not .hero: while the hero is pinned, GSAP moves it
     into a pin-spacer and its rect no longer tracks what's actually on screen.
     The video element's own rect is correct in both pinned and normal flow. */
  const heroVisible = () => {
    const r = v.getBoundingClientRect();
    if (!r.height) return false;
    const overlap = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
    return overlap > r.height * 0.25;
  };

  /* ---- three states, driven by WHERE the reader is in the pinned hero rather
     than by raw visibility ----
       rest  the landing state (the name). Frame 1, paused. Also the load state.
       loop  the skillset hold. Plays, and starts over each time it ends.
       idle  hero off screen, or the tab is hidden. Paused where it stands, and
             returns to whatever the pin says when the reader comes back.
     The mode is set from the pin's own progress (see the GSAP block below), so
     scrolling up to the name closes the clip on frame 1 while sitting on the
     skillset keeps it running. Visibility is deliberately NOT the trigger: the
     clip is on screen in both of those states. */
  let mode = "rest";
  let awake = !document.hidden;

  const applyMode = () => {
    if (!awake || mode === "idle") { v.pause(); return; }
    if (mode === "rest") {
      v.pause();
      try { v.currentTime = 0; } catch (_) {}   // close on frame 1
      return;
    }
    if (v.paused) play();                        // mode === "loop"
  };

  /* Looped by hand rather than with the `loop` attribute so the 1.5x rate is
     re-applied on every pass (some browsers drop playbackRate on a seek). */
  v.addEventListener("ended", () => {
    if (mode !== "loop" || !awake) { v.pause(); return; }
    try { v.currentTime = 0; } catch (_) {}
    play();
  });

  const setMode = (next) => {
    if (next === mode) return;
    mode = next;
    started = started || next === "loop";
    applyMode();
  };

  /* ---- who decides the mode ----
     Two questions, each answered in exactly one place:
       "is the clip on screen?"  answered here, on scroll, from the live rect.
       "rest or loop?"           answered by the pinned hero, which knows whether
                                 the reader is on the name or on the skillset.
     The pin publishes its answer through __heroVideoWanted and this listener
     gates it on visibility, so neither can leave the clip decoding off screen or
     frozen while the skillset is up. With no pin at all (the mobile stack, and
     prefers-reduced-motion where the whole GSAP block is skipped) there is no
     name/skillset split, so on screen simply means loop.
     A passive scroll listener over the existing rect read rather than an
     IntersectionObserver: one mechanism, correct in either direction, and it
     reads the live rect instead of a delivered snapshot. */
  let pinWanted = null;
  const syncFromView = () => {
    if (!heroVisible()) { setMode("idle"); return; }
    setMode(pinWanted || "loop");
  };
  window.__heroVideoWanted = (w) => { pinWanted = w; syncFromView(); };
  window.addEventListener("scroll", syncFromView, { passive: true });
  /* apply the state we load in, without waiting for a first scroll */
  v.addEventListener("loadedmetadata", syncFromView, { once: true });
  window.__heroVideoMode = setMode;              // kept for direct control
  window.__playHeroVideo = () => setMode("loop");

  /* never keep decoding in a background tab, and pick the mode back up on return */
  document.addEventListener("visibilitychange", () => {
    awake = !document.hidden;
    if (!awake) { v.pause(); return; }
    if (mode === "loop" && heroVisible()) applyMode();
  });

  pick();
  portrait.addEventListener("change", pick);
})();

/* ---------- hero outline word: real SVG stroke ----------
   -webkit-text-stroke has a genuine, persistent WebKit/Blink bug on complex
   or concave glyphs (E, Q here), the stroke's offset-path fails to union
   or close correctly, rendering fragments/gaps no CSS tuning fixes. SVG
   <text> stroke uses the browser's real vector path-stroking pipeline
   instead (the same one used for <path>), which handles any glyph shape
   correctly. We measure the glyph's own bbox so the SVG is pixel-tight and
   rebuild it whenever the responsive (clamp()-based) font-size changes. */
(() => {
  const host = document.querySelector(".hero-name .word.outline");
  if (!host) return;
  const label = host.textContent.trim();
  if (!label) return;

  const srText = document.createElement("span");
  srText.className = "sr-only";
  srText.textContent = label;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.display = "block";

  const textEl = document.createElementNS(svgNS, "text");
  svg.appendChild(textEl);

  host.textContent = "";
  host.appendChild(srText);
  host.appendChild(svg);

  const STROKE = 2; // px, matches the previous -webkit-text-stroke width
  let pending = null;

  function build() {
    const cs = getComputedStyle(host);
    textEl.setAttribute("x", "0");
    textEl.setAttribute("y", "0");
    textEl.style.fontFamily = cs.fontFamily;
    textEl.style.fontWeight = cs.fontWeight;
    textEl.style.fontSize = cs.fontSize;
    textEl.style.letterSpacing = cs.letterSpacing;
    // SVG <text> doesn't reliably inherit CSS text-transform across engines,
    // so force the literal uppercase content .hero-name applies via CSS.
    textEl.textContent = label.toUpperCase();

    const bbox = textEl.getBBox();
    const pad = STROKE * 2; // headroom so round joins never clip at the edge
    const w = bbox.width + pad * 2;
    const h = bbox.height + pad * 2;
    textEl.setAttribute("x", (pad - bbox.x).toFixed(2));
    textEl.setAttribute("y", (pad - bbox.y).toFixed(2));
    svg.setAttribute("width", w.toFixed(2));
    svg.setAttribute("height", h.toFixed(2));
    svg.setAttribute("viewBox", `0 0 ${w.toFixed(2)} ${h.toFixed(2)}`);
  }
  function scheduleBuild() {
    // debounced setTimeout, not requestAnimationFrame: rAF is throttled/
    // suspended in backgrounded tabs, and a resize can legitimately happen
    // while this tab isn't focused (e.g. an OS-level window snap).
    clearTimeout(pending);
    pending = setTimeout(build, 120);
  }

  build();
  window.addEventListener("resize", scheduleBuild);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleBuild);
})();

/* ---------- HUD frame-lock: viewfinder corners zoom onto hovered media ---------- */
(() => {
  const hud = document.querySelector(".hud");
  const corners = {
    tl: document.querySelector(".hud-corner.tl"),
    tr: document.querySelector(".hud-corner.tr"),
    bl: document.querySelector(".hud-corner.bl"),
    br: document.querySelector(".hud-corner.br"),
  };
  const targets = document.querySelectorAll("[data-hud-frame]");
  if (!hud || !corners.tl || !targets.length || reduceMotion) return;
  if (!window.matchMedia("(hover: hover)").matches) return;

  const SIZE = 26;  // .hud-corner width/height
  const GAP = 10;   // breathing room outside the framed element
  let base = null;
  let framed = null;

  function measureBase() {
    Object.values(corners).forEach((c) => { c.style.transition = "none"; c.style.transform = "none"; });
    base = {};
    for (const k in corners) {
      const r = corners[k].getBoundingClientRect();
      base[k] = { x: r.left, y: r.top };
    }
    Object.values(corners).forEach((c) => { c.style.transition = ""; });
  }
  measureBase();
  window.addEventListener("resize", () => { framed = null; release(); measureBase(); });

  /* is this node a nav tab / still inside the nav row? */
  const isNavTab = (n) => !!(n && n.classList && n.classList.contains("scene-nav-tab"));
  const inNavRow = (n) => !!(n && n.closest && n.closest("#scene-nav-tabs"));

  function frame(el, instant) {
    const r = el.getBoundingClientRect();
    /* Shrink the brackets (and tighten the gap) for small targets such as the
       nav tabs. At full 26px the four corners would meet and read as a closed
       box rather than corner marks. Each bracket scales about its own corner
       (transform-origin in CSS), so the anchor point stays put. */
    const scale = Math.min(1, (r.height * 0.42) / SIZE, (r.width * 0.3) / SIZE);
    const gap = GAP * Math.max(0.55, scale);
    const s = `scale(${scale.toFixed(3)})`;
    /* counter-scale the border so the line weight stays ~2px when shrunk */
    const bw = (2 / scale).toFixed(2) + "px";

    /* instant = cut straight to the next target instead of gliding there.
       Used when travelling sideways along the nav row, so the brackets step
       tab-to-tab like an array selection rather than stretching in between. */
    if (instant) Object.values(corners).forEach((c) => { c.style.transition = "none"; });

    corners.tl.style.transform = `translate(${r.left - gap - base.tl.x}px, ${r.top - gap - base.tl.y}px) ${s}`;
    corners.tr.style.transform = `translate(${r.right + gap - SIZE - base.tr.x}px, ${r.top - gap - base.tr.y}px) ${s}`;
    corners.bl.style.transform = `translate(${r.left - gap - base.bl.x}px, ${r.bottom + gap - SIZE - base.bl.y}px) ${s}`;
    corners.br.style.transform = `translate(${r.right + gap - SIZE - base.br.x}px, ${r.bottom + gap - SIZE - base.br.y}px) ${s}`;
    Object.values(corners).forEach((c) => { c.style.borderWidth = bw; });
    hud.classList.add("is-framing");

    if (instant) {
      void hud.offsetWidth;  // commit the jump before transitions come back
      Object.values(corners).forEach((c) => { c.style.transition = ""; });
    }
  }
  function release() {
    Object.values(corners).forEach((c) => {
      c.style.transition = "";   // always animate the zoom-out
      c.style.transform = "";
      c.style.borderWidth = "";
    });
    hud.classList.remove("is-framing");
  }

  targets.forEach((el) => {
    el.addEventListener("mouseenter", () => {
      /* stepping sideways from one nav tab to the next → snap, don't glide */
      const instant = isNavTab(el) && isNavTab(framed);
      framed = el;
      frame(el, instant);
    });
    el.addEventListener("mouseleave", (e) => {
      /* Heading straight for another tab (or crossing the gap between two)?
         Keep the current frame so the incoming mouseenter can snap to it,
         otherwise the brackets would bounce out to default and back on every
         sideways step. Leaving the row entirely (up/down) falls through and
         animates the zoom-out. */
      if (isNavTab(el) && (isNavTab(e.relatedTarget) || inNavRow(e.relatedTarget))) return;
      framed = null;
      release();
    });
  });
  /* keep the lock glued to the element while the page (or a carousel) scrolls */
  window.addEventListener("scroll", () => { if (framed) frame(framed); }, { passive: true });
  const wt = document.getElementById("work-track");
  if (wt) wt.addEventListener("scroll", () => { if (framed) frame(framed); }, { passive: true });
})();

/* ---------- carousels: click-drag to scroll (shared by THE FOOTAGE and
   SOME RECENT CREATIVE WORK: same interaction on both for consistency) ---------- */
function enableDragScroll(track) {
  if (!track) return;
  let down = false, startX = 0, startScroll = 0, moved = 0;

  track.addEventListener("pointerdown", (e) => {
    down = true; moved = 0;
    startX = e.clientX;
    startScroll = track.scrollLeft;
    track.classList.add("is-dragging");
  });
  track.addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    moved = Math.abs(dx);
    track.scrollLeft = startScroll - dx;
  });
  const end = () => { down = false; track.classList.remove("is-dragging"); };
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);
  track.addEventListener("pointerleave", end);
  /* suppress the CTA/card click that would fire at the end of a drag */
  track.addEventListener("click", (e) => {
    if (moved > 6) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}
/* Case Studies stays a drag carousel; MY RECENT WORKS is now a marquee (below) */
enableDragScroll(document.getElementById("work-track"));

/* ---------- MY RECENT WORKS: 3D coverflow carousel ----------
   focused centre clip with neighbours fanned back in perspective; auto-advances
   every ADVANCE_MS and plays only the centre clip (muted by default). */

/* minimal stroke-based speaker glyphs (currentColor), swapped in place of
   emoji, which read as gimmicky against the site's thin-line HUD language */
const ICON_MUTED = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
  <path d="M10.5 7.5 6 11H3v6h3l4.5 3.5v-13Z"/>
  <line x1="16" y1="10" x2="21.5" y2="15.5"/>
  <line x1="21.5" y1="10" x2="16" y2="15.5"/>
</svg>`;
const ICON_SOUND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
  <path d="M10.5 7.5 6 11H3v6h3l4.5 3.5v-13Z"/>
  <path d="M16.5 9.5a5 5 0 0 1 0 7"/>
  <path d="M19.3 7a9 9 0 0 1 0 12.2"/>
</svg>`;

/* ---------- the reel ----------
   ▶ STATS: each clip carries its own numbers, shown under the carousel and
   swapped as the clip changes. Paste the real figures from YouTube Studio and
   Meta here; anything left as "" renders as a dash so it is obvious what is
   still outstanding rather than quietly reading as zero.
     views  – total views / impressions
     watch  – average watch time or total watch time
     ctr    – click-through rate
     conv   – conversion rate
   ▶ ORDER: rearranging this list rearranges the carousel; tags, links and stats
   travel with their clip. */
const REEL_CLIPS = [
  { src: "assets/ad-from7.mp4",       aspect: "wide", tag: "BROADCAST AD",     href: "projects/bigbattery.html",
    stats: { views: "", watch: "", ctr: "", conv: "" } },
  { src: "assets/nexus.mp4",          aspect: "tall", tag: "ORGANIC REEL",     href: "projects/launch-velocity.html",
    stats: { views: "", watch: "", ctr: "", conv: "" } },
  { src: "assets/ethos-hypershot.mp4",aspect: "tall", tag: "HYPERSHOT",        href: "projects/launch-velocity.html",
    stats: { views: "", watch: "", ctr: "", conv: "" } },
  { src: "assets/ahc.mp4",            aspect: "tall", tag: "LAUNCH TEASER",    href: "projects/launch-velocity.html",
    stats: { views: "", watch: "", ctr: "", conv: "" } },
  { src: "assets/portfolio-reel.mp4", aspect: "tall", tag: "PORTFOLIO REEL",   href: "projects/launch-velocity.html",
    stats: { views: "", watch: "", ctr: "", conv: "" } },
  { src: "assets/ethos-ad.mp4",       aspect: "wide", tag: "COMMERCIAL SPOT",  href: "projects/launch-velocity.html",
    stats: { views: "", watch: "", ctr: "", conv: "" } },
  { src: "assets/solar.mp4",          aspect: "wide", tag: "AD CAMPAIGN",      href: "projects/launch-velocity.html",
    stats: { views: "", watch: "", ctr: "", conv: "" } },
];

(() => {
  const stage = document.getElementById("reel-stage");
  const caption = document.getElementById("reel-caption");
  const dotsWrap = document.getElementById("reel-dots");
  const statsWrap = document.getElementById("reel-stats");
  const reel = document.getElementById("reel");
  if (!stage) return;

  /* 7s per clip: long enough to register the cut and the audio, short enough
     that seven clips are not a commitment. Hovering suspends it entirely so a
     clip plays out (see `hovered`). */
  const ADVANCE_MS = 7000;
  const N = REEL_CLIPS.length;
  let active = 0;
  /* audible by default: the reel is the point of the page, so it arrives with
     sound and the reader turns it off if they'd rather not. Browsers block
     audible autoplay without a user gesture, so this can be forced back to
     muted at runtime, see playActive(). */
  let muted = false;
  let userMuted = false;   // set only by the toggle, so we never fight a choice
  let unlockArmed = false;
  let timer = null;
  let hovered = false;
  let onScreen = false;

  // build cards + dots
  const cards = REEL_CLIPS.map((clip, i) => {
    const card = document.createElement("article");
    card.className = "reel-card " + (clip.aspect === "wide" ? "wide" : "tall");
    card.innerHTML =
      `<video src="${clip.src}" muted loop playsinline preload="${i < 2 ? "auto" : "none"}"></video>` +
      `<button class="reel-mute" aria-label="Toggle sound">${ICON_MUTED}</button>`;
    card.querySelector("video").addEventListener("error", () => {}, { once: true });
    card.addEventListener("click", (e) => {
      if (e.target.closest(".reel-mute")) return;
      if (i === active) window.location.href = clip.href;   // active card → case study
      else go(i);                                            // side card → focus it
    });
    card.querySelector(".reel-mute").addEventListener("click", (e) => {
      e.stopPropagation();
      muted = !muted;
      userMuted = muted;
      applyMute();
    });
    stage.appendChild(card);

    const dot = document.createElement("button");
    dot.className = "reel-dot";
    dot.setAttribute("aria-label", `Go to clip ${i + 1}`);
    dot.addEventListener("click", () => go(i));
    dotsWrap.appendChild(dot);
    return card;
  });
  const dots = [...dotsWrap.children];

  /* One row of figures per clip, so the numbers live with the work instead of
     being stranded in a separate section. An empty value renders as a dash
     rather than being dropped, which keeps the four columns from reflowing as
     the carousel advances. */
  const STAT_FIELDS = [
    { key: "views", label: "VIEWS" },
    { key: "watch", label: "WATCH TIME" },
    { key: "ctr",   label: "CTR" },
    { key: "conv",  label: "CONV. RATE" },
  ];
  function renderStats(stats) {
    if (!statsWrap) return;
    statsWrap.innerHTML = STAT_FIELDS.map(({ key, label }) => {
      const raw = (stats && stats[key]) || "";
      const value = raw === "" ? "&mdash;" : raw;
      const pending = raw === "" ? " is-pending" : "";
      return `<div class="reel-stat${pending}">` +
        `<span class="reel-stat-val">${value}</span>` +
        `<span class="mono reel-stat-label">${label}</span>` +
        `</div>`;
    }).join("");
  }

  function applyMute() {
    const v = cards[active].querySelector("video");
    v.muted = muted;
    const btn = cards[active].querySelector(".reel-mute");
    btn.innerHTML = muted ? ICON_MUTED : ICON_SOUND;
    btn.setAttribute("aria-label", muted ? "Turn sound on" : "Turn sound off");
    btn.classList.toggle("is-live", !muted);
    if (!muted) playActive();
  }

  /* Play the centre clip, honouring the sound preference. A scroll is not a
     user gesture as far as autoplay policy is concerned, so an audible play()
     can be rejected on a fresh load. When that happens we fall back to muted so
     the clip still runs, and arm a one-shot listener that goes audible on the
     reader's first real interaction, unless they muted it themselves. */
  function playActive() {
    const v = cards[active].querySelector("video");
    v.muted = muted;
    const p = v.play();
    if (!p || !p.catch) return;
    p.catch(() => {
      if (muted) return;
      muted = true;
      applyMute();
      armAudioUnlock();
    });
  }

  function armAudioUnlock() {
    if (unlockArmed || userMuted) return;
    unlockArmed = true;
    const unlock = () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      unlockArmed = false;
      if (userMuted || !onScreen) return;
      muted = false;
      applyMute();
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
  }

  function layout() {
    const H = stage.offsetHeight || 460;
    // mobile: cards are width-driven (so 16:9 clips can't overflow the screen)
    // and therefore vary in height, so space them off viewport width and show
    // only one neighbour per side to keep the stage readable.
    const isMobile = window.innerWidth <= 820;
    const spacing = isMobile
      ? window.innerWidth * 0.34
      : Math.min(H * 0.52, window.innerWidth * 0.26);
    const maxVisible = isMobile ? 1 : 2;
    cards.forEach((card, i) => {
      let off = i - active;
      if (off > N / 2) off -= N;
      if (off < -N / 2) off += N;
      const a = Math.abs(off);
      if (a > maxVisible) {
        card.style.opacity = "0";
        /* NOTE: deliberately no inline pointer-events here. CSS already does
           `.reel-card:not(.is-active) { pointer-events: none }`, and an inline
           value would outrank it permanently: a card that once rotated out of
           range stayed unclickable even after becoming the centre card, which
           silently killed its mute button. */
        card.style.transform = `translate(-50%, -50%) scale(0.5)`;
        card.classList.remove("is-active");
        return;
      }
      const x = off * spacing;
      const z = -a * 150;
      const ry = -off * 34;
      const s = 1 - a * 0.16;
      // translateY(-50%) pairs with CSS `top: 50%` so cards of differing
      // heights stay vertically centred in the stage (mobile), and it's a
      // no-op visually on desktop where every card shares one height.
      card.style.transform =
        `translate(calc(-50% + ${x}px), -50%) translateZ(${z}px) rotateY(${ry}deg) scale(${s})`;
      card.style.filter = a === 0 ? "none" : `blur(${a * 2.2}px) brightness(0.8)`;
      card.style.opacity = a === 0 ? "1" : a === 1 ? "0.9" : "0.5";
      card.style.zIndex = String(30 - a);
      card.classList.toggle("is-active", a === 0);
    });

    // play only the centre; rewind + pause the rest
    cards.forEach((card, i) => {
      const v = card.querySelector("video");
      if (i === active) {
        if (v.preload !== "auto") v.preload = "auto";
        playActive();
      } else {
        v.pause();
        try { v.currentTime = 0; } catch (_) {}
      }
    });

    // caption + dots reflect the active clip
    const clip = REEL_CLIPS[active];
    caption.innerHTML =
      `<span class="footage-tag">${clip.tag}</span>` +
      `<a class="footage-cta" href="${clip.href}" data-cursor="READ">READ THE CASE STUDY →</a>`;
    renderStats(clip.stats);
    dots.forEach((d, i) => d.classList.toggle("is-active", i === active));
    applyMute();
  }

  function go(i) {
    active = (i % N + N) % N;
    /* unmute persists across advances (don't reset to muted here) */
    layout();
    restart();
  }
  const next = () => go(active + 1);
  const prev = () => go(active - 1);

  function restart() {
    clearInterval(timer);
    if (reduceMotion) return;
    /* always rotates every ADVANCE_MS, muted or not. Only hover and
       being off-screen pause it. unmute still persists across advances
       (see go()), it just no longer blocks the timer. */
    timer = setInterval(() => {
      if (!hovered && onScreen) next();
    }, ADVANCE_MS);
  }

  document.getElementById("reel-next").addEventListener("click", next);
  document.getElementById("reel-prev").addEventListener("click", prev);
  reel.addEventListener("mouseenter", () => { hovered = true; });
  reel.addEventListener("mouseleave", () => { hovered = false; });
  window.addEventListener("resize", layout);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cards.forEach((c) => c.querySelector("video").pause());
    else if (onScreen) layout();
  });

  // only run the reel while the section is on screen
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((ents) => {
      onScreen = ents[0].isIntersecting;
      if (onScreen) { layout(); restart(); }
      else { clearInterval(timer); cards.forEach((c) => c.querySelector("video").pause()); }
    }, { threshold: 0.3 }).observe(reel);
  } else { onScreen = true; }

  layout();
  restart();
})();

/* ---------- autoplay-on-view videos (Higgsfield-style, but resource-aware) ----------
   Each clip plays only while it's in the viewport and pauses when it leaves,
   so we never decode off-screen video or burn mobile battery/bandwidth. */
(() => {
  const vids = document.querySelectorAll("[data-autoplay-inview]");
  if (!vids.length) return;

  const play = (v) => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };

  if (reduceMotion || !("IntersectionObserver" in window)) {
    // honor reduced-motion: load a still first frame, don't auto-play
    vids.forEach((v) => { v.preload = "metadata"; });
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const v = e.target;
      if (e.isIntersecting) {
        if (v.preload === "none") v.preload = "auto"; // begin buffering on approach
        play(v);
      } else {
        v.pause();
      }
    });
  }, { threshold: 0.35 });

  vids.forEach((v) => io.observe(v));

  // pause everything when the tab is hidden; resume the in-view ones on return
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) vids.forEach((v) => v.pause());
  });
})();

/* ---------- mini toolkit: cycles the four discipline groups in the hero's
   left column. Edit the skills here, the markup is generated.
   `icon` is the inner markup of a 24x24 SVG, stroked with currentColor. ---------- */
const KIT_GROUPS = [
  {
    label: "Product & UX",
    /* artboard with a cursor on it */
    icon: '<rect x="3" y="3" width="18" height="14" rx="1"/><path d="M3 8h18"/><path d="M11 11l4 6 1-2.5 2.5-1z"/>',
    items: [
      "UX research", "Design systems", "Wireframe \u2192 prototype",
      "Accessibility (WCAG)", "Information architecture", "Figma",
    ],
  },
  {
    label: "Motion & Video",
    /* film frame with a play head */
    icon: '<rect x="2.5" y="5" width="19" height="14" rx="1"/><path d="M6.5 5v14M17.5 5v14"/><path d="M10.5 9.5l4 2.5-4 2.5z"/>',
    items: [
      "AI-assisted production", "Sound design", "DaVinci Resolve",
      "Brand compositing", "Final Cut Pro X", "Higgsfield",
    ],
  },
  {
    label: "Web & Performance",
    /* code brackets around a slash */
    icon: '<path d="M8 6.5L3.5 12 8 17.5M16 6.5L20.5 12 16 17.5"/><path d="M13.5 5.5l-3 13"/>',
    items: [
      "HTML \u00b7 CSS \u00b7 JS", "Technical SEO", "WordPress & CMS",
      "Schema markup", "Core Web Vitals", "CDN & caching",
    ],
  },
  {
    label: "Growth & Delivery",
    /* rising bars with a trend arrow */
    icon: '<path d="M3 20.5h18"/><path d="M6 20.5v-5M11 20.5v-9M16 20.5v-6"/><path d="M14.5 6.5h5v5"/><path d="M19.5 6.5L13 13"/>',
    items: [
      "Conversion optimization", "KPI tracking", "B2B / B2C strategy",
      "Cross-functional leads", "Sprint planning \u00b7 Agile", "Competitive benchmarks",
    ],
  },
];

(() => {
  const list = document.getElementById("hero-kit-list");
  const tabWrap = document.getElementById("hero-kit-tabs");
  if (!list || !tabWrap) return;

  const CYCLE_MS = 3600;
  const SVG_NS = "http://www.w3.org/2000/svg";
  let i = 0;
  let timer = null;

  const tabs = KIT_GROUPS.map((g, n) => {
    const b = document.createElement("button");
    b.className = "hero-kit-tab";
    b.type = "button";
    b.setAttribute("role", "tab");
    b.title = g.label;

    /* built through the SVG namespace: innerHTML on a <button> parses SVG tags
       as unknown HTML elements, which render nothing */
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = g.icon;
    b.appendChild(svg);

    /* the group name rides beside its icon, so no separate active-label row */
    const name = document.createElement("span");
    name.className = "mono hero-kit-tab-label";
    name.textContent = g.label;
    b.appendChild(name);

    b.addEventListener("click", () => { show(n); start(); });   // manual pick re-arms the timer
    tabWrap.appendChild(b);
    return b;
  });

  function show(n) {
    i = ((n % KIT_GROUPS.length) + KIT_GROUPS.length) % KIT_GROUPS.length;
    const g = KIT_GROUPS[i];
    list.innerHTML = "";
    g.items.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
    tabs.forEach((t, n2) => {
      const on = n2 === i;
      t.classList.toggle("is-on", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (window.gsap && !reduceMotion) {
      gsap.fromTo(list.children,
        { autoAlpha: 0, y: 6 },
        { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.04, ease: "power2.out", overwrite: true });
    }
  }

  function start() {
    clearInterval(timer);
    timer = setInterval(() => show(i + 1), CYCLE_MS);
  }

  show(0);
  start();

  /* don't burn cycles (or fight the reader) while the hero is off screen */
  const hero = document.getElementById("scene-hero");
  if (hero && "IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting) start(); else clearInterval(timer);
    }, { threshold: 0.15 }).observe(hero);
  }
  /* holding the pointer over the block stops the rotation so a skill can be read */
  const kit = document.querySelector(".hero-kit");
  if (kit) {
    kit.addEventListener("pointerenter", () => clearInterval(timer));
    kit.addEventListener("pointerleave", start);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearInterval(timer); else start();
  });
})();

/* ---------- GSAP scenes ---------- */
if (window.gsap && !reduceMotion) {
  gsap.registerPlugin(ScrollTrigger);

  /* hero: staggered name entrance, then scrub apart on scroll.
     deferred until the tab is visible, because if the page loads in a background
     tab, rAF is suspended and the tweens would freeze mid-flight. */
  const runHeroIntro = () => {
    gsap.from(".hero-name .word", {
      yPercent: 110, duration: 1.1, stagger: 0.12, ease: "power4.out", delay: 0.15,
    });
    gsap.from(".hero-greeting", {
      opacity: 0, y: 24, duration: 0.9, ease: "power3.out", delay: 0.35,
    });
    /* the bio waits for the surname to land, then the scroll cue comes in last,
       so the eye is walked down the column: name → what I do → what to do next.
       Both start hidden in CSS so there's no flash before GSAP takes over. */
    gsap.to(".hero-tagline", {
      autoAlpha: 1, y: 0, duration: 0.8, ease: "power3.out", delay: 1.25,
    });
    gsap.to(".hero-cue", {
      autoAlpha: 1, y: 0, duration: 0.7, ease: "power3.out", delay: 1.95,
    });
  };
  if (document.visibilityState === "visible") {
    runHeroIntro();
  } else {
    document.addEventListener("visibilitychange", function onVis() {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onVis);
      runHeroIntro();
    });
  }
  /* ---- pinned hero sequence (desktop) ----
     The hero holds still while the name drifts apart and fades out; the clip
     only starts once the name is fully gone, then plays/loops while the section
     is on screen and the page auto-scrolls on to MY RECENT WORKS.
     Skipped on phones, where pinning fights mobile scroll. */
  const canPin = window.innerWidth > 720;
  if (canPin) {
    /* fraction of the pin over which the name exits. The clip is held until
       this point so it never competes with the headline */
    const NAME_OUT = 0.45;
    /* the point in the pin where the toolkit/bio begin arriving. The clip is
       keyed to this rather than to NAME_OUT so there is no window where the
       skillset is legible while the clip sits frozen on frame 1: parking
       anywhere in [LOWER_IN, 1] used to leave it stuck. */
    const LOWER_IN = NAME_OUT * 0.88;
    /* the hold has to be *seen* before we hand the reader on. One hard flick can
       cover the whole pin in a single frame, which used to fire the auto-advance
       instantly, so the icons and toolkit flashed past and the reader landed in MY
       RECENT WORKS without ever seeing the hero settle. */
    const MIN_HOLD_MS = 2000;
    let advanced = false;
    let holdStart = 0;      // when the reveal first came up
    let pending = null;     // deferred advance, waiting out the rest of the hold

    const setHeroVideo = (m) => { if (window.__heroVideoWanted) window.__heroVideoWanted(m); };

    /* Derived from position every time, never latched. onUpdate does not fire
       for a position you are simply already at, so this also runs on refresh:
       reloading (or restoring scroll) while parked on the skillset used to leave
       the clip on frame 1, because nothing re-applied the mode.

       LOWER_IN is a position on the TIMELINE, and scroll progress is normalised
       0..1 over the timeline's whole duration, which is not 1.0 here (the tweens
       and the trailing hold add up past it). Comparing the two directly is what
       produced the reported dead zone: the skillset became legible at progress
       ~0.32 while the clip waited for ~0.40. Divide by the live duration so the
       two can never drift apart again. */
    const lowerInProgress = (self) => {
      const d = self.animation ? self.animation.duration() : 0;
      return d > 0 ? LOWER_IN / d : LOWER_IN;
    };
    const syncHeroVideo = (self) => {
      setHeroVideo(self.progress >= lowerInProgress(self) ? "loop" : "rest");
    };

    const goNext = () => {
      /* with section snapping on, the pin's end IS a stop: the reader is parked
         on the hold deliberately and the next gesture moves them on. Advancing
         by ourselves would skip a stop they never asked to leave. */
      if (window.__snapActive) return;
      advanced = true;
      const next = document.getElementById("scene-reel");
      if (next) next.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    };
    const cancelPending = () => {
      if (pending) { clearTimeout(pending); pending = null; }
    };

    gsap.timeline({
      scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        /* longer than the viewport on purpose: at 115% a single trackpad flick
           could clear the whole pin, so the hold had no scroll room to live in */
        end: "+=170%",
        pin: true,
        anticipatePin: 1,
        scrub: 1,
        invalidateOnRefresh: true,
        /* past the pin there are no more updates, so hand the clip its idle
           state explicitly rather than leaving it decoding off screen */
        /* idle means "off screen", not "progress hit 1": sitting exactly at the
           end of the pin still shows the skillset, so the clip must keep running */
        onLeave: (self) => syncHeroVideo(self),
        onEnterBack: (self) => syncHeroVideo(self),
        /* fires on load, on resize and when fonts land: applies the state for
           wherever the reader actually is */
        onRefresh: (self) => syncHeroVideo(self),
        onUpdate: (self) => {
          /* The clip's state is a function of position, not a one-shot trigger.
             Past the name's exit it loops for as long as the reader stays on the
             skillset; scrolled back before it, the clip closes on frame 1. */
          syncHeroVideo(self);
          if (self.progress >= lowerInProgress(self)) {
            if (!holdStart) holdStart = performance.now();
          } else {
            holdStart = 0;   // scrolled back before the reveal: hold restarts
          }
          /* once the sequence completes, carry the reader into the next section,
             but never before MIN_HOLD_MS of the hold has actually elapsed */
          if (!advanced && self.progress > 0.995 && self.direction === 1) {
            const waited = holdStart ? performance.now() - holdStart : 0;
            if (waited >= MIN_HOLD_MS) {
              goNext();
            } else if (!pending) {
              pending = setTimeout(() => {
                pending = null;
                if (!advanced && self.progress > 0.995) goNext();
              }, MIN_HOLD_MS - waited);
            }
          }
          if (self.progress < 0.9) {   // re-arm on the way back up
            advanced = false;
            cancelPending();
          }
        },
      },
    })
      /* name exits over the first NAME_OUT of the pin, drifting apart as it
         fades. Applied to the .line wrappers, not the words: .line has
         overflow:hidden, which would clip a word sliding past its own edge. */
      .to(".hero-upper", { yPercent: -22, autoAlpha: 0, ease: "none", duration: NAME_OUT }, 0)
      .to(".hero-name .line-1", { xPercent: -12, ease: "none", duration: NAME_OUT }, 0)
      .to(".hero-name .line-2", { xPercent: 10, ease: "none", duration: NAME_OUT }, 0)
      /* subtext arrives as the name leaves, and holds for the rest of the pin */
      .fromTo(".hero-lower",
        { autoAlpha: 0, y: 28 },
        /* starts late in the name's exit: .hero-lower is taller now that it
           carries the mini toolkit, so it overlaps .hero-upper and the two
           must not be legible at the same time */
        { autoAlpha: 1, y: 0, ease: "none", duration: 0.3 }, LOWER_IN)
      .to({}, { duration: 1 - NAME_OUT });   // hold while the clip runs
  } else {
    /* no pin: reveal the lower copy in place and let the clip play on view */
    gsap.set(".hero-lower", { autoAlpha: 1, y: 0 });
    /* No pin means no landing/skillset split to key off, so the clip simply
       loops while the hero is in view and idles when it is not.
       Driven off isActive via onToggle + onRefresh rather than the four
       onEnter/onLeave callbacks: at load the hero is ALREADY inside the active
       range, and onEnter only fires on a crossing, so the clip would never have
       started. onRefresh applies the state we are actually in. */
    /* No pin here, so the clip is left to the observer in the video module,
       which loops it whenever it is actually on screen. Keying off .hero would
       have been wrong anyway: in the mobile stack the clip sits at the bottom of
       a hero well over a viewport tall, so the section is "in view" long before
       the clip is. */
  }

  /* safety net: if the intro tweens get interrupted or the page loads in a
     hidden tab (rAF suspended → GSAP clock frozen), never leave hero content
     stuck invisible. Plain setTimeout still fires in hidden tabs. */
  setTimeout(() => {
    gsap.set(".hero-greeting, .hero-name .word", { clearProps: "all" });
    gsap.set(".reel, .clip", { clearProps: "opacity,visibility,transform" });
  }, 3000);

  /* scene titles: clip in from below */
  document.querySelectorAll(".scene-title").forEach((t) => {
    gsap.from(t, {
      opacity: 0, y: 60, duration: 1, ease: "power3.out",
      scrollTrigger: { trigger: t, start: "top 85%" },
    });
  });

  /* reel coverflow: fade the whole stage in as it enters (the cards carry
     their own 3D motion, so one container fade is enough) */
  gsap.from(".reel", {
    autoAlpha: 0, y: 30, duration: 1, ease: "power3.out",
    scrollTrigger: { trigger: ".reel", start: "top 82%" },
  });

  /* work clips: staggered fade-in, opacity-only so it never fights the
     native drag/scroll of .work-track (mirrors the footage carousel intro) */
  gsap.from(".clip", {
    autoAlpha: 0, duration: 0.9, stagger: 0.12, ease: "power3.out",
    scrollTrigger: { trigger: ".work-track", start: "top 80%" },
  });

  /* pipeline line draw + step reveals. The rail's progress also fills each
     diamond as it passes through it: the svg is preserveAspectRatio="none" over
     the pipe's full height, so progress maps straight to a pixel depth and each
     diamond lights once the drawn line has reached its centre. */
  const pipeEl = document.querySelector(".pipe");
  const pipeSteps = [...document.querySelectorAll(".pipe-step")];
  const litUpTo = (progress) => {
    if (!pipeEl) return;
    const pipeTop = pipeEl.getBoundingClientRect().top;
    const drawn = progress * pipeEl.getBoundingClientRect().height;
    pipeSteps.forEach((step) => {
      /* ::before is 8px down from the step's top and 24px tall (20 + borders) */
      const centre = step.getBoundingClientRect().top - pipeTop + 8 + 12;
      step.classList.toggle("is-lit", drawn >= centre);
    });
  };
  gsap.to("#pipe-path", {
    strokeDashoffset: 0, ease: "none",
    scrollTrigger: {
      trigger: ".pipe", start: "top 70%", end: "bottom 60%", scrub: true,
      onUpdate: (self) => litUpTo(self.progress),
      onRefresh: (self) => litUpTo(self.progress),
    },
  });
  document.querySelectorAll(".pipe-step").forEach((step) => {
    gsap.from(step, {
      opacity: 0, x: -40, duration: 0.8, ease: "power3.out",
      scrollTrigger: { trigger: step, start: "top 80%" },
    });
  });

  /* stat counters */
  document.querySelectorAll(".stat-val").forEach((el) => {
    const target = parseFloat(el.dataset.count);
    const prefix = el.dataset.prefix || "";
    const suffix = el.dataset.suffix || "";
    const decimals = String(el.dataset.count).includes(".") ? 1 : 0;
    const obj = { v: 0 };
    gsap.to(obj, {
      v: target, duration: 1.6, ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 85%" },
      onUpdate: () => { el.textContent = prefix + obj.v.toFixed(decimals) + suffix; },
    });
  });

  /* about + contact reveals */
  gsap.from(".about-copy p, .about-video", {
    opacity: 0, y: 30, duration: 0.8, stagger: 0.08, ease: "power3.out",
    scrollTrigger: { trigger: ".about-grid", start: "top 80%" },
  });
  gsap.from(".contact-title, .contact-email, .contact-links", {
    opacity: 0, y: 50, duration: 1, stagger: 0.12, ease: "power3.out",
    scrollTrigger: { trigger: ".contact", start: "top 65%" },
  });
  /* re-measure pin positions once web fonts land (layout heights shift) */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }
} else {
  /* reduced motion or no GSAP: the hero copy is hidden by default for the
     staged reveal, so show it outright rather than leaving it invisible */
  document.querySelectorAll(".hero-tagline, .hero-cue").forEach((el) => {
    el.style.opacity = "1";
    el.style.visibility = "visible";
    el.style.transform = "none";
  });
  /* the rail is drawn by a scrubbed tween, so without one it would stay
     invisible: show it complete, with every diamond filled */
  const pipePath = document.getElementById("pipe-path");
  if (pipePath) pipePath.style.strokeDashoffset = "0";
  document.querySelectorAll(".pipe-step").forEach((s) => s.classList.add("is-lit"));
  /* static counters */
  document.querySelectorAll(".stat-val").forEach((el) => {
    el.textContent = (el.dataset.prefix || "") + el.dataset.count + (el.dataset.suffix || "");
  });
}

/* ---------- section snapping (desktop) ----------
   One scroll gesture moves one stop, instead of free-scrolling the whole page.
   The reader steps through the site rather than dragging a wheel through it.

   Only the opening run of the page is stepped: the hero, the reel and Behind
   the Scenes. CASE STUDIES is the last stop, and from there down (the pipeline,
   the receipts, the credits) scrolling is free, because that stretch is reading
   material rather than a set of beats.

   Stops are derived, not hard-coded:
     - the hero contributes two, the start of its pin and the end of it, so the
       name exit and the toolkit hold each get a stop of their own;
     - every other section in the stepped run contributes one, unless its content
       is taller than the viewport, in which case it is split into evenly spaced
       stops.

   Left alone on phones (touch scrolling is already gesture-based and pinning
   is off there) and under prefers-reduced-motion, where the native scroll is
   the accessible behaviour. ---------- */
(() => {
  if (reduceMotion || window.innerWidth <= 720) return;

  const sections = [...document.querySelectorAll("main section.scene")];
  if (sections.length < 2) return;

  const DURATION = 720;      // ms per hop
  const QUIET_MS = 140;      // wheel silence that marks the end of one gesture
  const SPLIT_FRACTION = 0.45;   // excess content this deep gets its own stop
  /* the last stepped section. Its stop is the final one; everything below it
     scrolls freely. */
  const LAST_STEPPED = "scene-work";
  const EDGE = 6;            // px of slack around the boundary

  let stops = [];
  let index = 0;
  let animating = false;
  let lastWheel = 0;

  const maxScroll = () =>
    Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  /* how far below a section's top its actual content ends. Bottom padding is
     excluded on purpose: aligning to the padding would push the content off
     the top of the screen to show empty space. */
  const contentDepth = (sec) => {
    const top = sec.getBoundingClientRect().top + window.scrollY;
    let deepest = 0;
    sec.querySelectorAll(":scope > *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.height) return;
      deepest = Math.max(deepest, r.bottom + window.scrollY - top);
    });
    return deepest || sec.getBoundingClientRect().height;
  };

  function buildStops() {
    const vh = window.innerHeight;
    const list = [];
    const pin = window.ScrollTrigger
      ? ScrollTrigger.getAll().find((t) => t.pin && t.trigger === document.querySelector(".hero"))
      : null;

    let past = false;
    sections.forEach((sec) => {
      if (past) return;                       // free-scrolling territory
      if (sec.id === LAST_STEPPED) past = true;   // include this one, then stop
      const top = Math.round(sec.getBoundingClientRect().top + window.scrollY);

      /* the pinned hero: its scroll length IS its animation, so both ends of
         the pin are stops. Landing 2px short of the end keeps us inside the
         pin rather than on the frame where it releases. */
      if (pin && sec === pin.trigger) {
        list.push({ y: Math.round(pin.start), sec });
        list.push({ y: Math.round(pin.end) - 2, sec });
        return;
      }

      const excess = contentDepth(sec) - vh;
      if (excess <= 0) {
        list.push({ y: top, sec });
      } else if (excess <= vh * SPLIT_FRACTION) {
        /* shallow overflow: sit the content's bottom on the viewport's bottom,
           spending the section's own top padding rather than adding a stop */
        list.push({ y: top + Math.round(excess), sec });
      } else {
        /* deep enough to need its own stops. Spaced by roughly three quarters of
           a viewport: sizing by total height instead produced 250px hops that
           read as a stutter rather than a move. */
        const n = 1 + Math.ceil(excess / (vh * 0.75));
        for (let i = 0; i < n; i++) {
          list.push({ y: top + Math.round((excess * i) / (n - 1)), sec });
        }
      }
    });

    const limit = maxScroll();
    stops = list
      .map((s) => ({ ...s, y: Math.min(Math.max(0, s.y), limit) }))
      .filter((s, i, arr) => i === 0 || Math.abs(s.y - arr[i - 1].y) > 8);   // drop duplicates
  }

  const nearest = () => {
    let best = 0;
    let bestDist = Infinity;
    stops.forEach((s, i) => {
      const d = Math.abs(s.y - window.scrollY);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  };

  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* rAF is suspended while the page is hidden, which would leave a hop frozen
     mid-flight and the input lock stuck on. Fall back to a timer there, and cap
     the whole thing so a stalled frame can never wedge scrolling. */
  const nextFrame = (cb) =>
    (document.hidden
      ? setTimeout(() => cb(performance.now()), 16)
      : requestAnimationFrame(cb));

  function glideTo(i) {
    if (!stops.length) return;
    index = Math.min(Math.max(0, i), stops.length - 1);
    const from = window.scrollY;
    const to = stops[index].y;
    if (Math.abs(to - from) < 2) { settle(); return; }

    animating = true;
    const t0 = performance.now();
    const frame = (now) => {
      const elapsed = now - t0;
      const t = Math.min(1, elapsed / DURATION);
      window.scrollTo(0, from + (to - from) * easeInOut(t));
      if (t < 1 && elapsed < DURATION * 4) nextFrame(frame);
      else { window.scrollTo(0, to); settle(); }
    };
    nextFrame(frame);
  }

  /* hold the lock until the gesture's momentum has actually drained, or a
     single trackpad flick would roll straight through several stops */
  function settle() {
    const check = () => {
      if (performance.now() - lastWheel < QUIET_MS) {
        setTimeout(check, QUIET_MS);
      } else {
        animating = false;
      }
    };
    setTimeout(check, QUIET_MS);
  }

  const step = (dir) => glideTo(nearest() + dir);

  const lastStopY = () => (stops.length ? stops[stops.length - 1].y : 0);

  /* Below the final stop the page is the reader's to scroll. Also true when
     sitting exactly on that stop and heading down, so a gesture there releases
     into the pipeline rather than snapping nowhere. */
  const isFree = (dir) => {
    const y = window.scrollY;
    const last = lastStopY();
    if (y > last + EDGE) return true;
    return dir > 0 && y >= last - EDGE;
  };

  window.addEventListener("wheel", (e) => {
    if (e.ctrlKey) return;               // pinch-zoom belongs to the browser
    /* sideways gestures belong to whatever they are over: the reel and the case
       studies are horizontal scrollers, and swallowing deltaX would break them */
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (Math.abs(e.deltaY) < 2) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    if (isFree(dir)) return;             // hands off: native scrolling from here down
    e.preventDefault();                  // we own vertical scrolling above that
    lastWheel = performance.now();
    if (animating) return;
    step(dir);
  }, { passive: false });

  const KEY_NEXT = ["ArrowDown", "PageDown", " ", "Spacebar"];
  const KEY_PREV = ["ArrowUp", "PageUp"];
  window.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
    if (KEY_NEXT.includes(e.key)) {
      if (isFree(1)) return;             // let the browser page down through the tail
      e.preventDefault();
      if (!animating) step(1);
    } else if (KEY_PREV.includes(e.key)) {
      if (isFree(-1)) return;
      e.preventDefault();
      if (!animating) step(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      glideTo(0);
    }
    /* End is left to the browser: the bottom of the page is past the last stop */
  });

  /* the nav, the play button and any in-page anchor route through here so they
     land on a real stop and leave the index in sync */
  window.__snapToSection = (el) => {
    if (!stops.length) buildStops();
    const i = stops.findIndex((s) => s.sec === el);
    if (i === -1) return false;
    glideTo(i);
    return true;
  };
  window.__snapStep = (dir) => { if (!animating) step(dir); };
  window.__snapActive = true;

  buildStops();
  index = nearest();

  let rebuild = null;
  const queueRebuild = () => {
    clearTimeout(rebuild);
    rebuild = setTimeout(buildStops, 150);
  };
  window.addEventListener("resize", queueRebuild);
  if (window.ScrollTrigger) ScrollTrigger.addEventListener("refresh", queueRebuild);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueRebuild);
})();

/* hero play button: arm (▶ rotates to ▼), then head for MY RECENT WORKS */
(() => {
  const btn = document.getElementById("hero-play");
  const target = document.getElementById("scene-reel");
  if (!btn || !target) return;
  btn.addEventListener("click", () => {
    if (btn.classList.contains("is-armed")) return;
    btn.classList.add("is-armed");
    /* Was 420ms before the scroll even started, which read as a dead press.
       120ms is enough for the rotation to register while the move is already
       underway, so the click feels answered immediately. */
    setTimeout(() => {
      if (!(window.__snapToSection && window.__snapToSection(target))) {
        target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
      }
    }, 120);
    setTimeout(() => btn.classList.remove("is-armed"), 1100);
  });
})();

/* scroll cue: same job as a first scroll gesture, for anyone who clicks it */
(() => {
  const cue = document.getElementById("hero-cue");
  if (!cue) return;
  cue.addEventListener("click", () => {
    if (window.__snapStep) { window.__snapStep(1); return; }
    /* no snapping (phones, reduced motion): the skillset is further down the
       same hero here, so bring the block itself into view rather than guessing
       at a viewport-height jump */
    const kit = document.querySelector(".hero-kit");
    if (kit) {
      kit.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      return;
    }
    window.scrollTo({ top: window.innerHeight, behavior: reduceMotion ? "auto" : "smooth" });
  });
})();

/* in-page anchors: JS smooth scroll (CSS scroll-behavior is off for ScrollTrigger) */
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const target = document.querySelector(a.getAttribute("href"));
    if (!target) return;
    e.preventDefault();
    if (window.__snapToSection && window.__snapToSection(target)) return;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  });
});
