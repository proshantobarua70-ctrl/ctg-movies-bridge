
const WORKER_API =
  "https://ctgmovies-api.proshantobarua70-4a5.workers.dev/movies";

const PAGE_SIZE = 100;

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
  res.end(type.includes("application/json") ? JSON.stringify(data) : data);
}

function parseValue(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return fallback;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function getTitle(item) {
  return item.title || item.name || item.id || "Untitled";
}

function getLinks(item) {
  const links = parseValue(item.links);

  return links
    .map((link) => {
      if (typeof link === "string") {
        return { title: "Open source", url: link };
      }

      return {
        title: link.title || link.name || link.label || "Open source",
        url: link.url || link.href || link.link || ""
      };
    })
    .filter((link) => /^https?:\/\//i.test(link.url));
}

async function loadPage(page) {
  const url = new URL(WORKER_API);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(PAGE_SIZE));

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`Cloudflare Worker returned HTTP ${response.status}`);
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
    throw new Error("Worker response has no recognized items array");
  }

  return {
    items,
    total: Number(data.total || data.count || 0)
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
#status{color:#bac4d6;margin:14px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:13px}
.card{background:#1b2230;border:1px solid #30394a;border-radius:9px;padding:14px;min-width:0}
.card h3{font-size:16px;overflow-wrap:anywhere;margin:0 0 10px}
.meta{font-size:12px;color:#b6c0d2;margin-bottom:10px}
a{color:#8dc6ff;overflow-wrap:anywhere}
.links{display:flex;flex-direction:column;gap:8px}
nav{display:flex;align-items:center;gap:12px;margin:22px 0}
nav button:disabled{opacity:.4;cursor:default}
</style>
</head>
<body>
<header>
<h1>CTG Movies Catalog</h1>
<div>Browse catalog items and available source links</div>
</header>
<main>
<div class="controls">
<input id="search" placeholder="Search this page..." aria-label="Search current page">
<select id="kind" aria-label="Filter category">
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

function category(item) {
  const value = String(item.kind || item.type || "").toLowerCase();
  if (value.includes("anime")) return "anime";
  if (value.includes("tv") || value.includes("series") || value.includes("show")) return "tv";
  if (value.includes("movie") || value === "film") return "movie";
  return "other";
}

function safeUrl(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}

function render() {
  const q = $("search").value.trim().toLowerCase();
  const selected = $("kind").value;

  const shown = items.filter(item => {
    const title = String(item.title || item.name || item.id || "").toLowerCase();
    const matchesText = !q || title.includes(q);
    const matchesKind = selected === "all" || category(item) === selected;
    return matchesText && matchesKind;
  });

  $("grid").replaceChildren();

  for (const item of shown) {
    const card = document.createElement("article");
    card.className = "card";

    const title = document.createElement("h3");
    title.textContent = item.title || item.name || item.id || "Untitled";
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = "Category: " + category(item) +
      (item.year ? " · " + item.year : "");
    card.appendChild(meta);

    const links = Array.isArray(item.links) ? item.links : [];
    const linkBox = document.createElement("div");
    linkBox.className = "links";

    for (const raw of links) {
      const link = typeof raw === "string"
        ? { url: raw, title: "Open source" }
        : raw || {};

      const href = safeUrl(link.url || link.href || link.link || "");
      if (!href) continue;

      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = link.title || link.name || link.label || "Open source";
      linkBox.appendChild(a);
    }

    if (!linkBox.children.length) {
      const noLink = document.createElement("div");
      noLink.className = "meta";
      noLink.textContent = "No direct links in this item";
      linkBox.appendChild(noLink);
    }

    card.appendChild(linkBox);
    $("grid").appendChild(card);
  }

  $("status").textContent =
    shown.length + " matching items on this page · " +
    items.length + " items loaded";
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

    if (!response.ok) {
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
  const pathname = new URL(req.url, "https://bridge.local").pathname;

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
      workerConfigured: Boolean(WORKER_API)
    });
  }

  if (pathname === "/api/catalog") {
    const params = new URL(req.url, "https://bridge.local").searchParams;
    const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));

    try {
      const result = await loadPage(page);

      const items = result.items.map((item) => ({
        id: item.id || "",
        title: getTitle(item),
        kind: item.kind || item.type || "unknown",
        year: item.year || "",
        links: getLinks(item),
        episodes: parseValue(item.episodes),
        poster: item.poster || item.posterUrl || ""
      }));

      return send(res, 200, {
        ok: true,
        page,
        limit: PAGE_SIZE,
        total: result.total || null,
        count: items.length,
        items
      });
    } catch (error) {
      return send(res, 502, {
        ok: false,
        error: error.message,
        hint: "Check whether the Cloudflare Worker is reachable and returns an items array."
      });
    }
  }

  return send(res, 404, { ok: false, error: "Not found" });
};
