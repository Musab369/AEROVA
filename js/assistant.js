/**
 * AEROVA - Standalone Assistant Agent Page Script
 * Powers the interactive AI agent in assistant.html
 */
(function () {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const THEME_KEY = "aerova.theme";
  function initTheme() {
    const btn = $("#themeToggle");
    const icon = $("#themeIconUse");
    const meta = $("#themeMeta");

    function apply(theme) {
      const dark = theme === "dark";
      if (dark) document.documentElement.dataset.theme = "dark";
      else delete document.documentElement.dataset.theme;
      if (icon) icon.setAttribute("href", dark ? "#i-sun" : "#i-moon");
      const label = dark ? "Switch to light theme" : "Switch to dark theme";
      if (btn) {
        btn.setAttribute("aria-label", label);
        btn.setAttribute("title", label);
        btn.setAttribute("aria-pressed", String(dark));
      }
      if (meta) meta.setAttribute("content", dark ? "#0a1220" : "#d9ecea");
    }

    let current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") current = saved;
    } catch (e) {}
    apply(current);

    if (btn) {
      btn.addEventListener("click", () => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
        apply(next);
      });
    }
  }

  // Load city and snapshot data cached by the main page, or use defaults
  function getCachedContext() {
    let city = "Your City";
    let aqi = 112;
    let temp = 24;
    let humidity = 45;
    let wind = 12;
    let mainPollutant = "PM2.5";
    let pm25 = 40.5;

    try {
      const savedCity = localStorage.getItem("aerova.city");
      if (savedCity) {
        const parsed = JSON.parse(savedCity);
        if (parsed && parsed.city) city = parsed.city;
      }
    } catch (e) {}

    try {
      const savedAqi = localStorage.getItem("aerova.latestAqi");
      if (savedAqi) aqi = Number(savedAqi) || aqi;
    } catch (e) {}

    return { city, aqi, temp, humidity, wind, mainPollutant, pm25 };
  }

  const context = getCachedContext();

  function bandFor(aqi) {
    if (aqi <= 50) return { label: "Good", color: "#10b981", health: "Air quality is satisfactory and poses little or no risk." };
    if (aqi <= 100) return { label: "Moderate", color: "#f59e0b", health: "Air quality is acceptable; unusually sensitive people should consider limiting heavy outdoor exertion." };
    if (aqi <= 150) return { label: "Unhealthy for Sensitive Groups", color: "#f97316", health: "Members of sensitive groups may experience health effects. The general public is less likely to be affected." };
    if (aqi <= 200) return { label: "Unhealthy", color: "#ef4444", health: "Some members of the general public may experience health effects; sensitive groups should avoid outdoor exertion." };
    if (aqi <= 300) return { label: "Very Unhealthy", color: "#8b5cf6", health: "Health alert: The risk of health effects is increased for everyone." };
    return { label: "Hazardous", color: "#881337", health: "Health warning of emergency conditions: everyone is more likely to be affected." };
  }

  const REPLIES = [
    {
      match: /safe.*(outside|out)|go outside|outdoor|outside|go out/i,
      html: () => {
        const band = bandFor(context.aqi);
        const head = `<p>Current AQI in <strong>${context.city}</strong> is <strong>${context.aqi} (${band.label})</strong>.</p>`;
        if (context.aqi <= 50) return head + "<p>Air quality is clean and healthy. It is safe and ideal for outdoor workouts and leisure.</p>";
        if (context.aqi <= 100) return head + "<p>Most people can go outside without restrictions. Unusually sensitive individuals with asthma should take it easy during long activities.</p>";
        if (context.aqi <= 150) return head + "<ul><li>Sensitive groups (children, seniors, individuals with respiratory conditions) should reduce prolonged outdoor exertion.</li><li>Others can go out but should avoid heavy exercise near busy arterial roads.</li></ul>";
        if (context.aqi <= 200) return head + "<ul><li>Avoid prolonged or intense outdoor exertion.</li><li>If heading outdoors, wear a high-efficiency N95 / FFP2 mask.</li><li>Keep vulnerable individuals indoors.</li></ul>";
        return head + "<ul><li><strong>Hazardous alert:</strong> Remain indoors with windows and doors sealed.</li><li>Avoid all outdoor physical activity.</li><li>Run an indoor HEPA purifier if available.</li></ul>";
      }
    },
    {
      match: /indoor|improve.*air|purif|ventilat|window/i,
      html: () =>
        "<p>Top recommendations to keep indoor air clean:</p><ul><li><strong>Keep windows closed</strong> during rush hours or smog spikes.</li><li><strong>Run an indoor air purifier</strong> equipped with a genuine HEPA filter.</li><li><strong>Avoid indoor combustion</strong> such as incense sticks, unventilated candles, or frying without an exhaust fan.</li><li><strong>Damp-mop surfaces</strong> to capture settled fine particulate matter rather than dry sweeping.</li></ul>"
    },
    {
      match: /aqi\s*\d+|what does.*aqi|aqi mean|what is.*aqi|current aqi/i,
      html: () => {
        const b = bandFor(context.aqi);
        return `<p>An Air Quality Index (AQI) of <strong>${context.aqi}</strong> indicates the <strong>${b.label}</strong> category.</p><p>${b.health}</p><p>Primary atmospheric concern: <strong>${context.mainPollutant}</strong>.</p>`;
      }
    },
    {
      match: /weather|temperature|humid|wind|visib|rain|hot|cold/i,
      html: () =>
        `<p>In <strong>${context.city}</strong>, current ambient conditions: Temperature around <strong>${context.temp} °C</strong>, relative humidity at <strong>${context.humidity}%</strong>, and wind speeds around <strong>${context.wind} km/h</strong>.</p>`
    },
    {
      match: /mask|n95|respirator/i,
      html: () =>
        "<p>When PM2.5 or PM10 pollution levels rise above 100 AQI, standard cloth and surgical masks offer very little protection against microscopic particles. A certified, snug-fitting <strong>N95, KN95, or FFP2 respirator</strong> is recommended for outdoor transit.</p>"
    },
    {
      match: /exercise|\brun(ning)?\b|workout|\bjog|\bwalk|\bgym/i,
      html: () => {
        if (context.aqi > 150) return `<p>With an AQI of <strong>${context.aqi}</strong>, it is strongly advised to move cardio and strenuous workouts indoors. High respiration rates outdoors significantly increase pollutant intake into deep lung tissue.</p>`;
        if (context.aqi > 100) return `<p>With an AQI of <strong>${context.aqi}</strong>, moderate outdoor walks are acceptable, but reschedule vigorous running or endurance training to indoor gyms.</p>`;
        return `<p>With an AQI of <strong>${context.aqi}</strong>, outdoor exercise, running, and cycling are fully encouraged.</p>`;
      }
    },
    {
      match: /pm\s*2\.?5|pm2|particulate|pollutant/i,
      html: () =>
        `<p><strong>PM2.5</strong> refers to fine particulate matter with aerodynamic diameters smaller than 2.5 microns (about 30 times smaller than a human hair). Because of their micro size, they bypass nasal cilia and penetrate alveolar regions. Current level in ${context.city} is estimated at <strong>${context.pm25} µg/m³</strong>.</p>`
    },
    {
      match: /\b(hello|hi|hey|namaste)\b/i,
      html: () =>
        `<p>Greetings! I am the <strong>AEROVA Environmental Intelligence Agent</strong>. Ask me about air quality status in <strong>${context.city}</strong>, outdoor safety, workout advice, or protective respirators.</p>`
    },
    {
      match: /thank/i,
      html: () => "<p>You are very welcome! Prioritize your respiratory health and breathe easy.</p>"
    }
  ];

  const FALLBACK = "<p>I am the AEROVA Environmental Intelligence Agent. You can ask me about safe outdoor exposure, today's weather, mask recommendations, indoor HEPA air filtration, or how AQI is calculated.</p>";

  function initChat() {
    const log = $("#chatLog");
    const form = $("#chatForm");
    const input = $("#chatInput");
    const sub = $("#assistantCitySub");
    if (sub && context.city) {
      sub.textContent = `Connected to live telemetry for ${context.city} (Current AQI: ${context.aqi})`;
    }

    let busy = false;

    function addMessage(kind, content, isHtml) {
      const row = document.createElement("div");
      row.className = "msg msg--" + kind;
      const av = document.createElement("span");
      av.className = "msg__avatar";
      if (kind === "bot") {
        av.innerHTML = '<svg class="icon"><use href="#i-spark"/></svg>';
      } else {
        av.textContent = "You";
      }
      av.setAttribute("aria-hidden", "true");
      const bubble = document.createElement("div");
      bubble.className = "msg__bubble";
      if (isHtml) bubble.innerHTML = content;
      else bubble.textContent = content;
      row.append(av, bubble);
      log.append(row);
      log.scrollTop = log.scrollHeight;
      return bubble;
    }

    function reply(question) {
      const bubble = addMessage("bot", "", false);
      const dots = document.createElement("span");
      dots.className = "typing";
      dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
      dots.setAttribute("aria-label", "Agent is analyzing");
      bubble.append(dots);
      log.scrollTop = log.scrollHeight;

      setTimeout(() => {
        const hit = REPLIES.find((r) => r.match.test(question));
        bubble.innerHTML = hit ? hit.html() : FALLBACK;
        const note = document.createElement("small");
        note.textContent = `AEROVA Agent telemetry response · ${context.city}`;
        bubble.append(note);
        log.scrollTop = log.scrollHeight;
        busy = false;
      }, 500 + Math.random() * 300);
    }

    function send(text) {
      const q = text.trim();
      if (!q || busy) return;
      busy = true;
      addMessage("user", q, false);
      input.value = "";
      reply(q);
    }

    form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); send(input.value); }
    });

    $$(".suggest").forEach((b) => b.addEventListener("click", () => send(b.dataset.q)));

    addMessage("bot", `<p>Hello! I am your <strong>AEROVA Environmental Intelligence Agent</strong>.</p><p>I am calibrated for <strong>${context.city}</strong> (Current AQI: <strong>${context.aqi}</strong>). Ask me anything about outdoor safety, weather conditions, or protective measures.</p>`, true);
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initChat();
  });
})();
