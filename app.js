/* FELT — static GitHub Pages build. Places and the journal stay in localStorage. */
(function () {
  const CITIES = [
    ["Wellington", "New Zealand", -41.2924, 174.7787],
    ["Auckland", "New Zealand", -36.8509, 174.7645],
    ["Christchurch", "New Zealand", -43.5321, 172.6362],
    ["Dunedin", "New Zealand", -45.8788, 170.5028],
    ["Napier", "New Zealand", -39.4928, 176.912],
    ["New Plymouth", "New Zealand", -39.0556, 174.0752],
    ["Nelson", "New Zealand", -41.2706, 173.284],
    ["Hamilton", "New Zealand", -37.787, 175.2793],
    ["Gisborne", "New Zealand", -38.6623, 178.0176],
    ["Tokyo", "Japan", 35.6762, 139.6503],
    ["Osaka", "Japan", 34.6937, 135.5023],
    ["Sendai", "Japan", 38.2682, 140.8694],
    ["Los Angeles", "USA", 34.0522, -118.2437],
    ["San Francisco", "USA", 37.7749, -122.4194],
    ["Seattle", "USA", 47.6062, -122.3321],
    ["Anchorage", "USA", 61.2181, -149.9003],
    ["Mexico City", "Mexico", 19.4326, -99.1332],
    ["Lima", "Peru", -12.0464, -77.0428],
    ["Santiago", "Chile", -33.4489, -70.6693],
    ["Istanbul", "Türkiye", 41.0082, 28.9784],
    ["Athens", "Greece", 37.9838, 23.7275],
    ["Rome", "Italy", 41.9028, 12.4964],
    ["Naples", "Italy", 40.8518, 14.2681],
    ["Jakarta", "Indonesia", -6.2088, 106.8456],
    ["Manila", "Philippines", 14.5995, 120.9842],
    ["Taipei", "Taiwan", 25.033, 121.5654],
    ["Kathmandu", "Nepal", 27.7172, 85.324],
    ["Tehran", "Iran", 35.6892, 51.389],
    ["Reykjavík", "Iceland", 64.1466, -21.9426],
    ["Suva", "Fiji", -18.1248, 178.4501],
    ["Sydney", "Australia", -33.8688, 151.2093],
    ["London", "United Kingdom", 51.5072, -0.1276],
    ["Singapore", "Singapore", 1.3521, 103.8198],
  ].map(([name, region, lat, lon]) => ({ name, region, lat, lon }));

  const QUICK = ["Wellington", "Auckland", "Christchurch", "Tokyo", "Los Angeles", "Istanbul", "Jakarta", "Mexico City"];
  const KEYS = { places: "felt.v1.places", active: "felt.v1.active", journal: "felt.v1.journal", listen: "felt.v1.listen" };

  const state = {
    quakes: [],
    errors: [],
    fetchedAt: Date.now(),
    geonet: 0,
    usgs: 0,
    places: read(KEYS.places, []),
    activeId: read(KEYS.active, null),
    journal: read(KEYS.journal, []),
    listen: read(KEYS.listen, false) === true,
    adding: false,
    query: "",
    tab: "planet",
    panel: "answer",
    installOpen: false,
    busy: false,
    copied: false,
    geoNote: "",
    now: Date.now(),
  };
  if (!state.places.some((p) => p.id === state.activeId)) state.activeId = state.places[0]?.id ?? null;
  if (state.activeId) state.tab = "near";

  let audio = null;
  let armed = null;

  const app = document.getElementById("app");

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }
  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}`;
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function distanceKm(lat1, lon1, lat2, lon2) {
    const r = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const y = Math.sin(dLon) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
    const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
  }
  function bearingRad(lat1, lon1, lat2, lon2) {
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const y = Math.sin(dLon) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
    return Math.atan2(y, x);
  }
  function estimateFelt(mag, distKm, depthKm) {
    const hypo = Math.max(1, Math.hypot(distKm, depthKm));
    let score = 3.15 + 1.22 * mag - 2.85 * Math.log10(hypo) - 0.002 * hypo;
    if (mag < 4) score -= (4 - mag) * 0.55;
    if (mag < 2.2) score = Math.min(score, 1.4);
    else if (mag < 3) score = Math.min(score, 2.55);
    return Math.max(0, Math.min(10, score));
  }
  function feltBand(score) {
    if (score < 1.85) return ["Not felt", "Too faint to notice."];
    if (score < 2.7) return ["Maybe", "Only if you were sitting still."];
    if (score < 3.6) return ["Light jolt", "A small startle. Hanging things might sway."];
    if (score < 4.5) return ["Clearly felt", "Most people indoors notice. Windows can rattle."];
    if (score < 5.4) return ["Strong", "Everyone feels it. Dishes can shift."];
    if (score < 6.3) return ["Hard shake", "Hard to keep your footing. Check on people nearby."];
    return ["Severe", "Serious near the epicentre. Follow local civil defence."];
  }
  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return m === 1 ? "1 min ago" : `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 36) return h === 1 ? "1 hr ago" : `${h} hr ago`;
    const d = Math.round(h / 24);
    return d === 1 ? "1 day ago" : `${d} days ago`;
  }
  function distLabel(km) {
    if (km < 2) return "right under this place";
    if (km < 10) return `${km.toFixed(1)} km away`;
    return `${Math.round(km)} km away`;
  }
  function active() {
    return state.places.find((p) => p.id === state.activeId) || null;
  }
  function reading(place, quake) {
    const dist = distanceKm(place.lat, place.lon, quake.lat, quake.lon);
    return { dist, estimate: estimateFelt(quake.mag, dist, quake.depthKm) };
  }
  function verdict() {
    const place = active();
    if (!place) {
      return {
        tone: "unset",
        title: "Was that an earthquake?",
        detail: "Name the rooms you actually care about — home, your mum, the night shift. Felt answers for those, not for a map of the whole planet.",
        quake: null,
        estimate: null,
        dist: null,
      };
    }
    const scored = state.quakes
      .map((q) => ({ q, ...reading(place, q), age: state.now - q.time }))
      .filter((s) => s.age > -120000 && s.age < 8 * 86400000);
    const bestOf = (rows) => rows.reduce((top, row) => (!top || row.estimate > top.estimate ? row : top), null);
    const recent = bestOf(scored.filter((s) => s.age <= 30 * 60000));
    const describe = (row) => {
      const band = feltBand(row.estimate);
      const deep = row.q.depthKm >= 70 && row.estimate < 4 ? ` It was ${Math.round(row.q.depthKm)} km deep, so the magnitude looks louder than the shake.` : "";
      const shallow = row.q.depthKm < 12 && row.estimate >= 2.7 ? " Shallow, which is why nearby rooms notice it." : "";
      const tsunami = row.q.tsunami ? " A tsunami flag is set on the official record. Check that source if you are near a coast — Felt does not issue warnings." : "";
      return `${band[1]} M${row.q.mag.toFixed(1)} ${row.q.place}, ${distLabel(row.dist)} ${bearing(place.lat, place.lon, row.q.lat, row.q.lon)}, ${ago(state.now - row.q.time)}.${deep}${shallow}${tsunami}`;
    };
    if (recent && recent.estimate >= 2.7) {
      const band = feltBand(recent.estimate);
      const severe = recent.estimate >= 6.3;
      return {
        tone: "yes",
        title: severe ? `Yes. A severe shake at ${place.name}.` : `Yes. ${band[0]} at ${place.name}.`,
        detail: describe(recent) + (severe ? " If it is still moving: drop, cover, hold on." : ""),
        quake: recent.q,
        estimate: recent.estimate,
        dist: recent.dist,
      };
    }
    if (recent && recent.estimate >= 1.85) {
      return {
        tone: "maybe",
        title: "Maybe. Only if you were still.",
        detail: `At ${place.name}, that one is right on the edge of noticing. ${describe(recent)}`,
        quake: recent.q,
        estimate: recent.estimate,
        dist: recent.dist,
      };
    }
    const earlier = bestOf(scored.filter((s) => s.age <= 18 * 3600000));
    if (earlier && earlier.estimate >= 2.7) {
      return {
        tone: "earlier",
        title: "Not this minute.",
        detail: `Earlier, ${place.name} would have felt ${feltBand(earlier.estimate)[0].toLowerCase()}. ${describe(earlier)}`,
        quake: earlier.q,
        estimate: earlier.estimate,
        dist: earlier.dist,
      };
    }
    return {
      tone: "quiet",
      title: `All quiet at ${place.name}.`,
      detail: "Nothing on the live feeds is close enough, or strong enough, to move a cup there. If the window rattled, it was probably a truck.",
      quake: null,
      estimate: null,
      dist: null,
    };
  }
  function spotlight() {
    return state.quakes.filter((q) => state.now - q.time < 2 * 86400000).sort((a, b) => b.mag - a.mag)[0] || state.quakes[0] || null;
  }
  function notice() {
    const entries = state.journal;
    if (entries.length < 3) return "";
    const yes = entries.filter((e) => e.felt);
    const no = entries.filter((e) => !e.felt);
    if (!yes.length) return "So far you've only logged shakes you didn't feel. That still draws the line under your floor.";
    const yesLabel = feltBand(Math.min(...yes.map((e) => e.estimate)))[0].toLowerCase();
    if (!no.length) return `You've said yes ${yes.length} times, starting around “${yesLabel}”.`;
    const noMax = Math.max(...no.map((e) => e.estimate));
    const yesMin = Math.min(...yes.map((e) => e.estimate));
    if (noMax < yesMin) return `Your notice line sits between “${feltBand(noMax)[0].toLowerCase()}” (you didn't) and “${yesLabel}” (you did).`;
    return `You tend to notice from about “${yesLabel}” upward — with a few exceptions, which is very human.`;
  }

  function btn(label, className, onClick) {
    const node = el("button", className, label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  function render() {
    const focus = document.activeElement && document.activeElement.id;
    const place = active();
    const answer = verdict();
    const lead = answer.quake || spotlight();
    app.replaceChildren();
    app.dataset.panel = state.panel;

    const top = el("header", "felt-top");
    const brand = el("div", "felt-brand");
    const mark = el("span", "felt-mark");
    mark.append(el("i"));
    const names = el("div");
    names.append(el("p", "felt-word", "Felt"), el("p", "felt-tag", "Was that an earthquake?"));
    brand.append(mark, names);
    const actions = el("div", "felt-top-actions");
    const live = el("p", "felt-live");
    live.append(el("span", "felt-dot"), document.createTextNode(" Live"));
    const refresh = btn(state.busy ? "Refreshing" : "Refresh", "felt-btn felt-btn-ghost", () => load(true));
    const phone = btn("Phone", "felt-btn felt-btn-ghost", () => { state.installOpen = true; render(); });
    actions.append(live, phone, refresh);
    top.append(brand, actions);

    const hero = el("section", "felt-hero");
    const strata = el("img", "felt-strata");
    strata.src = "assets/strata.jpg";
    strata.alt = "Layered stone split by a thin amber vein";
    const cup = el("img", "felt-cup");
    cup.src = "assets/cup.jpg";
    cup.alt = "A ceramic cup of tea with one ripple, photographed at night";
    const heroCopy = el("div", "felt-hero-copy");
    heroCopy.append(el("p", "felt-kicker felt-kicker-light", "For the rooms you love"), el("p", null, "Magnitude is the quake. Felt is whether your kitchen noticed."));
    hero.append(strata, cup, heroCopy);
    hero.dataset.mobilePanel = "answer";

    const layout = el("div", "felt-layout");
    const card = el("article", "felt-card felt-verdict");
    card.id = "felt-answer";
    card.dataset.tone = answer.tone;
    card.dataset.mobilePanel = "answer";
    card.setAttribute("aria-live", "polite");
    const seal = el("div", "felt-seal", { yes: "Yes", maybe: "Maybe", earlier: "Earlier", quiet: "Quiet", unset: "Listen" }[answer.tone]);
    seal.dataset.tone = answer.tone;
    card.append(seal, el("p", "felt-kicker", "The answer"), el("h1", null, answer.title), el("p", "felt-detail", answer.detail));

    if (answer.tone === "unset" && lead) {
      const mean = el("div", "felt-meanwhile");
      mean.append(el("p", "felt-kicker", "Meanwhile, on the planet"), el("p", "felt-strong", `M${lead.mag.toFixed(1)} · ${lead.place}`), el("p", "felt-meta", `${ago(state.now - lead.time)} · ${lead.source === "geonet" ? "GeoNet" : "USGS"}`));
      card.append(mean);
    }
    if (place && lead) {
      const list = el("ul", "felt-readings");
      state.places.forEach((p) => {
        const r = reading(p, lead);
        const item = el("li");
        const name = el("div", "felt-reading-name");
        name.append(el("span", null, p.name), el("span", null, feltBand(r.estimate)[0]));
        const bar = el("div", "felt-bar");
        const fill = el("span");
        fill.style.width = `${Math.max(6, Math.min(100, r.estimate * 12))}%`;
        fill.dataset.hot = r.estimate >= 2.7 ? "yes" : "no";
        bar.append(fill);
        item.append(name, bar);
        list.append(item);
      });
      card.append(list);
    }
    const rowActions = el("div", "felt-actions");
    if (answer.quake && place) {
      rowActions.append(
        btn("I felt it", "felt-btn felt-btn-primary", () => logFelt(true, answer)),
        btn("Not me", "felt-btn felt-btn-ghost", () => logFelt(false, answer)),
      );
    }
    if (lead && state.places.length) rowActions.append(btn(state.copied ? "Copied" : "Text the group", "felt-btn felt-btn-ghost", () => share(lead)));
    if (answer.quake) {
      const link = el("a", "felt-btn felt-btn-ghost", "Official record");
      link.href = answer.quake.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      rowActions.append(link);
    }
    card.append(rowActions);
    const learned = notice();
    if (learned) card.append(el("p", "felt-note", learned));

    const side = el("aside", "felt-card felt-side");
    side.id = "felt-reach";
    side.dataset.mobilePanel = "reach";
    side.append(el("p", "felt-kicker", place ? `Reach of ${place.name}` : "The day, worldwide"));
    const radar = el("canvas", "felt-radar");
    radar.setAttribute("role", "img");
    radar.setAttribute("aria-label", place ? `Quakes that could reach ${place.name}` : "Largest magnitude each hour");
    side.append(radar);
    let ribbon = null;
    if (place) {
      ribbon = el("canvas", "felt-ribbon");
      ribbon.setAttribute("role", "img");
      side.append(ribbon);
    }
    const err = state.errors.length ? ` · ${state.errors.join(", ")} didn't answer` : "";
    side.append(el("p", "felt-meta", `${state.geonet} GeoNet · ${state.usgs} USGS · heard ${ago(state.now - state.fetchedAt)}${err}`));

    const placesCard = el("section", "felt-span felt-card");
    placesCard.id = "felt-places";
    placesCard.dataset.mobilePanel = "places";
    const head = el("div", "felt-place-head");
    const headText = el("div");
    headText.append(el("p", "felt-kicker", "Places"), el("h2", null, "Who are we listening for?"));
    head.append(headText, btn("Add a place", "felt-btn felt-btn-primary", () => { state.adding = !state.adding; render(); }));
    placesCard.append(head);
    const chips = el("div", "felt-chips");
    if (state.places.length) {
      state.places.forEach((p) => {
        const chip = btn(p.name, "felt-chip", () => { state.activeId = p.id; state.tab = "near"; write(KEYS.active, p.id); render(); });
        chip.dataset.on = p.id === state.activeId ? "yes" : "no";
        chips.append(chip);
      });
    } else if (!state.adding) {
      QUICK.forEach((name) => chips.append(btn(name, "felt-chip", () => addCity(name))));
    }
    placesCard.append(chips);
    if (state.adding) {
      const add = el("div", "felt-add");
      const label = el("label", "felt-label", "City");
      label.htmlFor = "felt-city";
      const input = el("input", "felt-input");
      input.id = "felt-city";
      input.value = state.query;
      input.placeholder = "Wellington, Sendai, Naples…";
      input.autocomplete = "off";
      input.addEventListener("input", () => { state.query = input.value; render(); });
      add.append(label, input);
      const q = state.query.trim().toLowerCase();
      if (q) {
        const matches = el("div", "felt-matches");
        CITIES.filter((c) => c.name.toLowerCase().includes(q) || c.region.toLowerCase().includes(q)).slice(0, 6).forEach((city) => {
          const match = btn("", "felt-match", () => addCity(city.name));
          match.append(el("span", null, city.name), el("span", null, city.region));
          matches.append(match);
        });
        add.append(matches);
      }
      add.append(btn("Use where I am", "felt-btn felt-btn-ghost", locate));
      if (state.geoNote) add.append(el("p", "felt-meta", state.geoNote));
      add.append(el("p", "felt-meta", "Coordinates never leave this browser. Up to eight places."));
      placesCard.append(add);
    }
    if (place) {
      const form = el("form", "felt-rename");
      const label = el("label", "felt-label", `Call ${place.name}`);
      label.htmlFor = "felt-name";
      const row = el("div", "felt-rename-row");
      const input = el("input", "felt-input");
      input.id = "felt-name";
      input.value = place.name;
      input.maxLength = 28;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const name = input.value.trim().slice(0, 28);
        if (!name) return;
        state.places = state.places.map((p) => (p.id === place.id ? { ...p, name } : p));
        write(KEYS.places, state.places);
        render();
      });
      row.append(input, btn("Save name", "felt-btn felt-btn-ghost", () => form.requestSubmit()), btn("Remove", "felt-btn felt-btn-ghost", () => {
        state.places = state.places.filter((p) => p.id !== place.id);
        state.activeId = state.places[0]?.id ?? null;
        write(KEYS.places, state.places);
        write(KEYS.active, state.activeId);
        render();
      }));
      form.append(label, row);
      placesCard.append(form);
    }

    const listCard = el("section", "felt-span felt-card");
    listCard.id = "felt-quakes";
    listCard.dataset.mobilePanel = "quakes";
    const tabs = el("div", "felt-tabs");
    tabs.setAttribute("role", "tablist");
    [["near", "Near you"], ["planet", "The planet"], ["log", "Your log"]].forEach(([id, label]) => {
      const tab = btn(label, "felt-tab", () => { state.tab = id; render(); });
      tab.dataset.on = state.tab === id ? "yes" : "no";
      tab.setAttribute("role", "tab");
      tabs.append(tab);
    });
    listCard.append(tabs);
    if (state.tab === "near" && !place) listCard.append(el("p", "felt-detail", "Add a place and this list sorts by what could actually reach it."));
    if (state.tab === "near" && place) {
      const rows = state.quakes
        .map((q) => ({ q, ...reading(place, q) }))
        .filter((row) => state.now - row.q.time < 2 * 86400000 && (row.dist < 900 || row.estimate >= 1.6))
        .sort((a, b) => b.estimate - a.estimate)
        .slice(0, 8);
      if (!rows.length) listCard.append(el("p", "felt-detail", `Nothing within a day's reach of ${place.name}.`));
      rows.forEach((row) => listCard.append(quakeRow(row.q, `${feltBand(row.estimate)[0]} · ${distLabel(row.dist)}`)));
    }
    if (state.tab === "planet") {
      const rows = [...state.quakes].sort((a, b) => b.mag - a.mag).slice(0, 8);
      if (!rows.length) listCard.append(el("p", "felt-detail", "The feeds haven't answered yet. Try refresh."));
      rows.forEach((q) => listCard.append(quakeRow(q, q.source === "geonet" ? "GeoNet" : "USGS")));
    }
    if (state.tab === "log") {
      if (!state.journal.length) listCard.append(el("p", "felt-detail", "When something might have reached you, say whether you felt it. Felt learns the size of shake you actually notice — and that memory stays on this device."));
      state.journal.forEach((entry) => {
        const row = el("div", "felt-row");
        const mag = el("div", "felt-mag", entry.felt ? "Yes" : "No");
        mag.dataset.hot = entry.felt ? "yes" : "no";
        const text = el("div");
        text.append(el("p", "felt-strong", `${entry.placeName} · M${entry.mag.toFixed(1)}`), el("p", "felt-meta", `${entry.where} · ${feltBand(entry.estimate)[0]} · ${ago(state.now - entry.at)}`));
        row.append(mag, text);
        listCard.append(row);
      });
    }
    const listen = el("label", "felt-listen");
    const box = el("input");
    box.type = "checkbox";
    box.checked = state.listen;
    box.addEventListener("change", () => {
      state.listen = box.checked;
      write(KEYS.listen, state.listen);
      if (state.listen) {
        const Ctx = window.AudioContext;
        if (Ctx) {
          audio = audio || new Ctx();
          audio.resume();
        }
        armed = answer.tone === "yes" && answer.quake ? answer.quake.id : "hold";
      }
      render();
    });
    const listenText = el("span");
    listenText.append(el("strong", null, "Stay with it. "), document.createTextNode("Leave this open. If the answer flips to yes, the tab title changes" + (state.listen ? " and a soft tone plays." : ". Turn this on for the tone too.")));
    listen.append(box, listenText);
    listCard.append(listen);

    layout.append(card, side, placesCard, listCard);

    const foot = el("footer", "felt-foot");
    foot.dataset.mobilePanel = "answer";
    foot.append(el("p", null, "Felt’s number is a rough estimate from magnitude, distance and depth. It is not a GeoNet MMI and not a USGS ShakeMap, and it is never a warning. In a strong shake: drop, cover, hold on — then read the official record."));
    const sources = el("p");
    sources.append(document.createTextNode("Live data from "));
    const g = el("a", null, "GeoNet");
    g.href = "https://www.geonet.org.nz/";
    g.target = "_blank";
    g.rel = "noreferrer";
    const u = el("a", null, "USGS");
    u.href = "https://earthquake.usgs.gov/earthquakes/map/";
    u.target = "_blank";
    u.rel = "noreferrer";
    sources.append(g, document.createTextNode(" and "), u, document.createTextNode(". Your places, your yes/no log, and the listen switch never leave this browser."));
    foot.append(sources, el("p", null, "Add Felt to your home screen and it stays a tap away. Still an estimate, not a warning."));

    const dock = el("nav", "felt-dock");
    dock.setAttribute("aria-label", "On this page");
    [["answer", "Answer"], ["reach", "Reach"], ["places", "Places"], ["quakes", "Quakes"]].forEach(([id, label]) => {
      dock.append(btn(label, "", () => document.getElementById(`felt-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })));
    });

    app.append(top, hero, layout, foot, dock);
    if (state.installOpen) {
      const sheet = el("div", "felt-sheet");
      sheet.setAttribute("role", "presentation");
      sheet.addEventListener("click", () => { state.installOpen = false; render(); });
      const cardEl = el("div", "felt-sheet-card");
      cardEl.setAttribute("role", "dialog");
      cardEl.addEventListener("click", (event) => event.stopPropagation());
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      cardEl.append(el("p", "felt-kicker", "On this phone"), el("h2", null, "Add Felt to your home screen"));
      const steps = el("ol", "felt-steps");
      (ios
        ? ["Tap the share button in Safari.", "Choose Add to Home Screen.", "Open Felt from the icon."]
        : ["Open the browser menu.", "Choose Install app, or Add to Home screen.", "Felt then opens without the browser bar."]
      ).forEach((line) => steps.append(el("li", null, line)));
      const close = btn("Close", "felt-btn felt-btn-ghost", () => { state.installOpen = false; render(); });
      const actionsRow = el("div", "felt-actions");
      actionsRow.append(close);
      cardEl.append(steps, el("p", "felt-meta", "Places and your yes/no log stay on this device."), actionsRow);
      sheet.append(cardEl);
      app.append(sheet);
    }
    requestAnimationFrame(() => {
      if (place) {
        drawRadar(radar, place);
        if (ribbon) drawRibbon(ribbon);
      } else drawRibbon(radar);
    });
    if (focus) document.getElementById(focus)?.focus();
    const title = answer.tone === "yes" ? `FELT · ${answer.title.replace(/^Yes\.\s*/, "")}` : answer.tone === "maybe" ? "FELT · maybe a faint roll" : "FELT — was that an earthquake?";
    document.title = title;
    watch(answer);
  }

  function quakeRow(quake, extra) {
    const row = el("a", "felt-row");
    row.href = quake.url;
    row.target = "_blank";
    row.rel = "noreferrer";
    const mag = el("div", "felt-mag", quake.mag.toFixed(1));
    mag.dataset.hot = quake.mag >= 5 ? "yes" : "no";
    const text = el("div");
    text.append(el("p", "felt-strong", quake.place), el("p", "felt-meta", `${ago(state.now - quake.time)} · ${Math.round(quake.depthKm)} km deep · ${extra}${quake.tsunami ? " · tsunami flag" : ""}`));
    row.append(mag, text);
    return row;
  }

  function addCity(name) {
    const city = CITIES.find((c) => c.name === name);
    if (!city || state.places.length >= 8) return;
    const existing = state.places.find((p) => p.name === city.name);
    if (existing) state.activeId = existing.id;
    else {
      const place = { id: uid(), name: city.name, lat: city.lat, lon: city.lon };
      state.places = [...state.places, place];
      state.activeId = place.id;
    }
    state.adding = false;
    state.query = "";
    state.tab = "near";
    write(KEYS.places, state.places);
    write(KEYS.active, state.activeId);
    render();
  }

  function locate() {
    if (!navigator.geolocation) {
      state.geoNote = "This browser won't share a location. Pick a city instead.";
      render();
      return;
    }
    state.geoNote = "Finding you…";
    render();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const place = { id: uid(), name: "Here", lat: pos.coords.latitude, lon: pos.coords.longitude };
        state.places = [...state.places, place].slice(0, 8);
        state.activeId = place.id;
        state.adding = false;
        state.geoNote = "";
        state.tab = "near";
        write(KEYS.places, state.places);
        write(KEYS.active, state.activeId);
        render();
      },
      () => {
        state.geoNote = "Location stayed on your device — the browser said no. Pick a city instead.";
        render();
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  }

  function logFelt(felt, answer) {
    const place = active();
    if (!place || !answer.quake) return;
    const entry = {
      id: uid(),
      quakeId: answer.quake.id,
      placeId: place.id,
      placeName: place.name,
      felt,
      at: Date.now(),
      mag: answer.quake.mag,
      distKm: answer.dist,
      estimate: answer.estimate,
      where: answer.quake.place,
    };
    state.journal = [entry, ...state.journal.filter((item) => !(item.quakeId === entry.quakeId && item.placeId === entry.placeId))].slice(0, 80);
    write(KEYS.journal, state.journal);
    render();
  }

  async function share(quake) {
    const lines = state.places.map((p) => {
      const r = reading(p, quake);
      return `${p.name}: ${feltBand(r.estimate)[0].toLowerCase()}, ${distLabel(r.dist)} ${bearing(p.lat, p.lon, quake.lat, quake.lon)}`;
    });
    const text = [`M${quake.mag.toFixed(1)} — ${quake.place}. ${ago(state.now - quake.time)}.`, ...lines, "Felt-estimate only. Not a GeoNet or USGS warning."].join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ title: "FELT", text });
        return;
      }
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(text);
      state.copied = true;
      render();
      setTimeout(() => { state.copied = false; render(); }, 1600);
    } catch {
      /* ignore */
    }
  }

  function watch(answer) {
    if (!state.listen || answer.tone !== "yes" || !answer.quake) return;
    if (armed === answer.quake.id) return;
    const first = armed == null;
    armed = answer.quake.id;
    if (!first) tone();
  }
  function tone() {
    if (!audio) return;
    const now = audio.currentTime;
    [[392, 0, 0.42, 0.045], [523.25, 0.14, 0.55, 0.03]].forEach(([freq, at, hold, gain]) => {
      const osc = audio.createOscillator();
      const amp = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      amp.gain.setValueAtTime(0.0001, now + at);
      amp.gain.exponentialRampToValueAtTime(gain, now + at + 0.03);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + at + hold);
      osc.connect(amp);
      amp.connect(audio.destination);
      osc.start(now + at);
      osc.stop(now + at + hold + 0.02);
    });
  }

  function fit(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 2) return null;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }
  function drawRibbon(canvas) {
    const box = fit(canvas);
    if (!box) return;
    const { ctx, width, height } = box;
    const slots = 24;
    const mags = Array.from({ length: slots }, () => 0);
    state.quakes.forEach((q) => {
      const age = state.now - q.time;
      if (age < 0 || age > 86400000) return;
      const index = slots - 1 - Math.min(slots - 1, Math.floor((age / 86400000) * slots));
      mags[index] = Math.max(mags[index], q.mag);
    });
    const max = Math.max(5, ...mags);
    ctx.beginPath();
    mags.forEach((mag, i) => {
      const x = (i / (slots - 1)) * width;
      const y = height - 8 - (mag / max) * (height - 18);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#c65d12";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  function drawRadar(canvas, place) {
    const box = fit(canvas);
    if (!box) return;
    const { ctx, width, height } = box;
    const cx = width / 2;
    const cy = height / 2 + 6;
    const radius = Math.min(width, height) * 0.38;
    const nearby = state.quakes
      .map((q) => ({ q, ...reading(place, q), age: state.now - q.time }))
      .filter((item) => item.age > -120000 && item.age < 86400000 && item.dist < 700 && item.estimate >= 1.2);
    let maxR = 100;
    if (nearby.length) {
      const furthest = Math.max(...nearby.map((item) => item.dist));
      maxR = furthest <= 50 ? 50 : furthest <= 120 ? 120 : furthest <= 250 ? 250 : 500;
    }
    ctx.strokeStyle = "rgba(28,25,21,0.14)";
    ctx.fillStyle = "#7a7166";
    ctx.font = "11px Outfit, sans-serif";
    [0.33, 0.66, 1].forEach((ring) => {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * ring, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${Math.round(maxR * ring)} km`, cx + 6, cy - radius * ring + 12);
    });
    ctx.fillStyle = "#1c1915";
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    nearby.sort((a, b) => b.estimate - a.estimate).slice(0, 24).forEach((item, index) => {
      const ang = bearingRad(place.lat, place.lon, item.q.lat, item.q.lon);
      const r = (item.dist / maxR) * radius;
      const x = cx + Math.sin(ang) * r;
      const y = cy - Math.cos(ang) * r;
      ctx.beginPath();
      ctx.fillStyle = item.estimate >= 2.7 ? "#c65d12" : "rgba(28,25,21,0.45)";
      ctx.arc(x, y, Math.min(9, 3 + item.q.mag * 0.7), 0, Math.PI * 2);
      ctx.fill();
      if (index === 0) {
        ctx.fillStyle = "#1c1915";
        ctx.font = "600 12px Outfit, sans-serif";
        ctx.fillText(`M${item.q.mag.toFixed(1)}`, Math.min(width - 36, Math.max(8, x + 8)), Math.min(height - 8, Math.max(16, y - 8)));
      }
    });
  }

  function num(v) {
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  function parseUsgs(data) {
    const out = [];
    for (const feature of data.features || []) {
      const props = feature.properties || {};
      if (props.type && props.type !== "earthquake") continue;
      const coords = feature.geometry?.coordinates || [];
      const mag = num(props.mag);
      const lon = num(coords[0]);
      const lat = num(coords[1]);
      const time = num(props.time);
      if (mag == null || lon == null || lat == null || time == null) continue;
      out.push({
        id: `usgs:${props.code || time}`,
        source: "usgs",
        mag, place: props.place || "Unknown place", time, lat, lon,
        depthKm: Math.abs(num(coords[2]) ?? 10),
        url: props.url || "https://earthquake.usgs.gov/earthquakes/map/",
        tsunami: props.tsunami === 1,
      });
    }
    return out;
  }
  function parseGeonet(data) {
    const out = [];
    for (const feature of data.features || []) {
      const props = feature.properties || {};
      if (props.quality === "deleted") continue;
      const coords = feature.geometry?.coordinates || [];
      const mag = num(props.magnitude);
      const lon = num(coords[0]);
      const lat = num(coords[1]);
      const time = Date.parse(props.time);
      if (mag == null || lon == null || lat == null || !props.publicID || Number.isNaN(time)) continue;
      out.push({
        id: `geonet:${props.publicID}`,
        source: "geonet",
        mag, place: props.locality || "New Zealand", time, lat, lon,
        depthKm: Math.abs(num(props.depth) ?? 10),
        url: `https://www.geonet.org.nz/earthquake/${props.publicID}`,
        tsunami: false,
      });
    }
    return out;
  }
  function dedupe(quakes) {
    const kept = [];
    for (const quake of [...quakes].sort((a, b) => b.time - a.time)) {
      const twin = kept.find((item) => Math.abs(item.time - quake.time) < 90000 && Math.abs(item.mag - quake.mag) < 0.7 && distanceKm(item.lat, item.lon, quake.lat, quake.lon) < 60);
      if (!twin) kept.push(quake);
      else if (quake.source === "geonet" && twin.source !== "geonet") kept[kept.indexOf(twin)] = quake;
    }
    return kept.sort((a, b) => b.time - a.time);
  }
  async function fetchJson(url, headers) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }
  async function load(manual) {
    if (manual) {
      state.busy = true;
      render();
    }
    const errors = [];
    const [geonet, day, week] = await Promise.all([
      fetchJson("https://api.geonet.org.nz/quake?MMI=1", { Accept: "application/vnd.geo+json;version=2" }).then(parseGeonet).catch(() => { errors.push("GeoNet"); return []; }),
      fetchJson("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson").then(parseUsgs).catch(() => { errors.push("USGS day"); return []; }),
      fetchJson("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson").then(parseUsgs).catch(() => { errors.push("USGS week"); return []; }),
    ]);
    const quakes = dedupe([...geonet, ...day, ...week]);
    if (quakes.length || !state.quakes.length) {
      state.quakes = quakes;
      state.geonet = quakes.filter((q) => q.source === "geonet").length;
      state.usgs = quakes.filter((q) => q.source === "usgs").length;
    }
    state.errors = errors;
    state.fetchedAt = Date.now();
    state.now = Date.now();
    state.busy = false;
    render();
  }

  render();
  load(false);
  setInterval(() => {
    state.now = Date.now();
    if (document.visibilityState === "visible") load(false);
  }, 60000);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  const sections = ["answer", "reach", "places", "quakes"];
  const markDock = () => {
    const buttons = [...document.querySelectorAll(".felt-dock button")];
    let current = "answer";
    sections.forEach((id) => {
      const node = document.getElementById(`felt-${id}`);
      if (node && node.getBoundingClientRect().top < 180) current = id;
    });
    buttons.forEach((button, index) => {
      button.dataset.on = sections[index] === current ? "yes" : "no";
    });
  };
  document.addEventListener("scroll", markDock, { passive: true });
  markDock();
})();
