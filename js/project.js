/* JB PORTFOLIO / project.js (case-study pages: HUD, cursor, reveals) */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* timecode + playhead */
const tcEl = document.getElementById("timecode");
const fillEl = document.getElementById("playhead-fill");
const pad = (n) => String(n).padStart(2, "0");

function updateHud() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const p = max > 0 ? window.scrollY / max : 0;
  const totalFrames = 45 * 24; // 45-second "clip"
  const f = Math.round(p * totalFrames);
  if (tcEl) tcEl.textContent = `00:00:${pad(Math.floor(f / 24))}:${pad(f % 24)}`;
  if (fillEl) fillEl.style.width = (p * 100).toFixed(2) + "%";
}
window.addEventListener("scroll", updateHud, { passive: true });
updateHud();

/* custom cursor */
const cursor = document.querySelector(".cursor");
if (cursor && window.matchMedia("(hover: hover)").matches) {
  const label = cursor.querySelector(".cursor-label");
  window.addEventListener("mousemove", (e) => {
    cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
  });
  document.querySelectorAll("[data-cursor]").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      cursor.classList.add("is-active");
      if (label) label.textContent = el.dataset.cursor;
    });
    el.addEventListener("mouseleave", () => cursor.classList.remove("is-active"));
  });
}

/* staggered section reveals */
if (!reduceMotion && "IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }),
    { threshold: 0.15 }
  );
  document.querySelectorAll(".case-section, .case-media, .case-next").forEach((el) => {
    el.classList.add("reveal");
    io.observe(el);
  });
}

/* design-stage stepper: one sheet at a time, tabs double as the progress bar.
   Auto-advances while on screen, pauses on hover or focus, and stays put under
   reduced motion. Markup: [data-stepper] > .stepper-stage img + .stepper-tabs button */
document.querySelectorAll("[data-stepper]").forEach((root) => {
  const imgs = [...root.querySelectorAll(".stepper-stage img")];
  const tabs = [...root.querySelectorAll(".stepper-tabs button")];
  const caption = root.querySelector(".stepper-caption");
  if (!imgs.length || imgs.length !== tabs.length) return;
  const STEP_MS = 4200;
  root.style.setProperty("--step-ms", STEP_MS + "ms");
  let i = 0, timer = null, paused = false, visible = false;

  const show = (n) => {
    i = (n + imgs.length) % imgs.length;
    imgs.forEach((im, k) => im.classList.toggle("is-on", k === i));
    tabs.forEach((t, k) => {
      /* restart the fill: drop the class, reflow, re-add */
      t.classList.remove("is-on");
      t.setAttribute("aria-selected", k === i ? "true" : "false");
    });
    void root.offsetWidth;
    tabs[i].classList.add("is-on");
    if (caption) caption.textContent = tabs[i].dataset.caption || "";
  };
  const schedule = () => {
    clearTimeout(timer);
    if (reduceMotion || paused || !visible) return;
    timer = setTimeout(() => { show(i + 1); schedule(); }, STEP_MS);
  };

  tabs.forEach((t, k) => t.addEventListener("click", () => { show(k); schedule(); }));
  root.addEventListener("mouseenter", () => { paused = true; root.classList.add("is-paused"); clearTimeout(timer); });
  root.addEventListener("mouseleave", () => { paused = false; root.classList.remove("is-paused"); show(i); schedule(); });
  root.addEventListener("focusin", () => { paused = true; clearTimeout(timer); });
  root.addEventListener("focusout", () => { paused = false; schedule(); });
  if (reduceMotion) root.classList.add("is-static");

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) show(i); schedule(); },
      { threshold: 0.35 }).observe(root);
  } else { visible = true; schedule(); }
  show(0);
});
