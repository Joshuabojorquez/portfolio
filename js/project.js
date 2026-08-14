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
