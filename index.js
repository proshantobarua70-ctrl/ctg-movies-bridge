
const WORKER_API =
  "https://ctgmovies-api.proshantobarua70-4a5.workers.dev/movies";

const PAGE_SIZE = 100;

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
  res.end(type.includes("application/json") ? JSON.stringify(data) : data);
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanUrl(value) {
  if (typeof value !== "string") return "";

  let url = value.trim();

  // Markdown: [https://example.com/file.mp4](https://example.com/file.mp4)
  const markdown = url.match(/^\[.*?\]\((https?:\/\/[^)]+)\)$/);
  if (markdown) url = markdown[1];

  // Decode common escaped characters without damaging URL encoding.
  url = url.replace(/&amp;/g, "&");

  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol)
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

function getTitle(item) {
  return item.title || item.name || item.id || "Untitled";
}

function getCategory(item) {
  const kind = String(item.kind || item.type || "").toLowerCase();

  if (kind.includes("anime")) return "anime";
  if (kind === "tv" || kind.includes("series") || kind.includes("show")) {
    return "tv";
  }
  if (kind.includes("movie") || kind === "film") return "movie";

  return kind || "unknown";
}

function normalizeLinks(rawLinks, episodeName = "") {
  const output = [];

  for (const raw of parseArray(rawLinks)) {
    const link = typeof raw === "string" ? { url: raw } : raw || {};
    const url = cleanUrl(link.url || link.href || link.link || "");

    if (!url) continue;

    const subtitles = parseArray(link.subs)
      .map((sub) => ({
        label: sub.label || sub.language || "Subtitle",
        url: cleanUrl(sub.url || sub.href || sub.link || "")
      }))
      .filter((sub) => sub.url);

    output.push({
      title: [
        episodeName,
        link.quality || link.title || link.name || link.label || "Open source"
      ].filter(Boolean).join(" — "),
      url,
      quality: link.quality || "",
      source: link.source || "",
      subtitles
    });
  }

  return output;
}

function normalizeItem(item) {
  const episodes = parseArray(item.episodes).map((episode) => {
    const name = episode.name ||
      (episode.s && episode.e
        ? "S" + episode.s + "E" + String(episode.e).padStart(2, "0")
        : "Episode");

    return {
      season: episode.s || null,
      episode: episode.e || null,
      name,
      overview: episode.overview || "",
      still: cleanUrl(episode.still || ""),
      airDate: episode.air || "",
      links: normalizeLinks(episode.links)
    };
  });

  // Movies use item.links; TV/anime sources often live inside episodes.
  const directLinks = normalizeLinks(item.links);

  const allLinks = [
    ...directLinks,
    ...episodes.flatMap((episode) =>
      episode.links.map((link) => ({
        ...link,
        title: episode.name + " — " + link.title
      }))
    )
  ];

  return {
    id: String(item.id || ""),
    title: getTitle(item),
    kind: getCategory(item),
    year: item.year || null,
    poster: cleanUrl(item.poster || item.posterUrl || ""),
    overview: item.overview || item.description || "",
    links: allLinks,
    episodes
  };
}

async function loadPage(page) {
  const url = new URL(WORKER_API);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(PAGE_SIZE));

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error("Cloudflare Worker HTTP " + response.status);
  }

  const data = await response.json();

  const items = Array.isArray(data)
    ? data
    : Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.results)
        ? data.results
        : null;

  if (!items) {
    throw new Error("Worker response does not contain an items array");
  }

  return {
    items,
    total: Number.isFinite(Number(data.total)) && data.total != null
      ? Number(data.total)
      : null
  };
}

function pageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CTG Movies Catalog</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#10131a;color:#edf0f7;font:15px Arial,sans-serif}
header{padding:22px 5%;background:#191f2b}
h1{margin:0 0 8px;font-size:25px}
main{padding:20px 5%}
.controls{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
input,select,button{padding:11px;border:1px solid #424b5c;border-radius:7px;background:#1b2230;color:white}
input{flex:1;min-width:180px}
button{cursor:pointer}
button:disabled{opacity:.4;cursor:default}
#status{color:#bac4d6;margin:14px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:13px}
.card{background:#1b2230;border:1px solid #30394a;border-radius:9px;padding:14px;min-width:0}
.card img{width:100%;max-height:240px;object-fit:contain;border-radius:6px;margin-bottom:10px}
.card h3{font-size:16px;overflow-wrap:anywhere;margin:0 0 10px}
.meta{font-size:12px;color:#b6c0d2;margin-bottom:10px}
a{color:#8dc6ff;overflow-wrap:anywhere}
.links{display:flex;flex-direction:column;gap:8px}
details{margin-top:10px}
summary{cursor:pointer;color:#b8d5ff}
.episode{border-top:1px solid #394354;margin-top:9px;padding-top:9px}
nav{display:flex;align-items:center;gap:12px;margin:22px 0}
</style>
</head>
<body>
<header>
<h1>CTG Movies Catalog</h1>
<div>Movies · TV · Anime · Available source links</div>
</header>
<main>
<div class="controls">
<input id="search" placeholder="Search loaded items..." aria-label="Search loaded items">
<select id="kind" aria-label="Category">
<option value="all">All categories</option>
<option value="movie">Movies</option>
<option value="tv">TV</option>
<option value="anime">Anime</option>
</select>
</div>
<div id="status">Loading catalog...</div>
<div id="grid" class="grid"></div>
<nav>
<button id="prev">Previous</button>
<span id="page">Page 1</span>
<button id="next">Next</button>
</nav>
</main>
<script>
const $ = id => document.getElementById(id);
let currentPage = 1;
let items = [];
let canGoNext = false;

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function addLink(parent, link) {
  const url = safeUrl(link.url);
  if (!url) return;

  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = link.title || link.quality || "Open source";
  parent.appendChild(a);

  if (Array.isArray(link.subtitles)) {
    for (const sub of link.subtitles) {
      const subUrl = safeUrl(sub.url);
      if (!subUrl) continue;

      const subtitle = document.createElement("a");
      subtitle.href = subUrl;
      subtitle.target = "_blank";
      subtitle.rel = "noopener noreferrer";
      subtitle.textContent = "Subtitle: " + (sub.label || "Open");
      parent.appendChild(subtitle);
    }
  }
}

function render() {
  const query = $("search").value.trim().toLowerCase();
  const kind = $("kind").value;

  const filtered = items.filter(item => {
    const matchesName = !query ||
      String(item.title).toLowerCase().includes(query);
    const matchesKind = kind === "all" || item.kind === kind;
    return matchesName && matchesKind;
  });

  $("grid").replaceChildren();

  for (const item of filtered) {
    const card = document.createElement("article");
    card.className = "card";

    if (item.poster) {
      const img = document.createElement("img");
      img.src = item.poster;
      img.alt = item.title;
      img.loading = "lazy";
      img.onerror = () => img.remove();
      card.appendChild(img);
    }

    const title = document.createElement("h3");
    title.textContent = item.title;
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = item.kind.toUpperCase() +
      (item.year ? " · " + item.year : "");
    card.appendChild(meta);

    if (item.overview) {
      const overview = document.createElement("p");
      overview.textContent = item.overview;
      card.appendChild(overview);
    }

    const linksBox = document.createElement("div");
    linksBox.className = "links";

    for (const link of item.links || []) {
      addLink(linksBox, link);
    }

    if (linksBox.children.length) {
      card.appendChild(linksBox);
    }

    if (item.episodes && item.episodes.length) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Episodes (" + item.episodes.length + ")";
      details.appendChild(summary);

      for (const episode of item.episodes) {
        const section = document.createElement("div");
        section.className = "episode";

        const episodeTitle = document.createElement("strong");
        episodeTitle.textContent = episode.name;
        section.appendChild(episodeTitle);

        if (episode.overview) {
          const text = document.createElement("p");
          text.textContent = episode.overview;
          section.appendChild(text);
        }

        const episodeLinks = document.createElement("div");
        episodeLinks.className = "links";

        for (const link of episode.links || []) {
          addLink(episodeLinks, link);
        }

        if (!episodeLinks.children.length) {
          const noLinks = document.createElement("div");
          noLinks.className = "meta";
          noLinks.textContent = "No links found for this episode";
          episodeLinks.appendChild(noLinks);
        }

        section.appendChild(episodeLinks);
        details.appendChild(section);
      }

      card.appendChild(details);
    }

    if (!linksBox.children.length &&
        !(item.episodes || []).some(ep => (ep.links || []).length)) {
      const noLinks = document.createElement("div");
      noLinks.className = "meta";
      noLinks.textContent = "No playable links found in this item";
      card.appendChild(noLinks);
    }

    $("grid").appendChild(card);
  }

  $("status").textContent =
    filtered.length + " matching items · " +
    items.length + " items loaded on this page";

  $("page").textContent = "Page " + currentPage;
  $("prev").disabled = currentPage <= 1;
  $("next").disabled = !canGoNext;
}

async function loadCatalog() {
  $("status").textContent = "Loading page " + currentPage + "...";
  $("grid").replaceChildren();
  $("prev").disabled = true;
  $("next").disabled = true;

  try {
    const response = await fetch(
      "/api/catalog?page=" + currentPage,
      { cache: "no-store" }
    );

    const data = await response.json();

    if (!response.ok || data.ok !== true) {
      throw new Error(data.error || "Catalog request failed");
    }

    items = data.items || [];
    canGoNext = items.length === 100;
    render();
  } catch (error) {
    $("status").textContent = "Catalog error: " + error.message;
  }
}

$("prev").addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    loadCatalog();
  }
});

$("next").addEventListener("click", () => {
  if (canGoNext) {
    currentPage++;
    loadCatalog();
  }
});

$("search").addEventListener("input", render);
$("kind").addEventListener("change", render);
loadCatalog();
</script>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "https://bridge.local");
  const pathname = url.pathname;

  if (pathname === "/favicon.ico") {
    res.statusCode = 204;
    return res.end();
  }

  if (pathname === "/" || pathname === "/index.html") {
    return send(res, 200, pageHtml(), "text/html; charset=utf-8");
  }

  if (pathname === "/health") {
    return send(res, 200, {
      ok: true,
      service: "ctg-movies-bridge",
      worker: WORKER_API
    });
  }

  if (pathname === "/api/catalog") {
    const page = Math.max(
      1,
      Math.min(10000, Number(url.searchParams.get("page")) || 1)
    );

    try {
      const result = await loadPage(page);
      const items = result.items.map(normalizeItem);

      return send(res, 200, {
        ok: true,
        page,
        limit: PAGE_SIZE,
        total: result.total,
        count: items.length,
        items
      });
    } catch (error) {
      return send(res, 502, {
        ok: false,
        error: error.message,
        page,
        hint: "Worker request failed or returned an unsupported response format."
      });
    }
  }

  return send(res, 404, { ok: false, error: "Not found" });
};
