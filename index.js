
const WORKER_API =
  "https://ctgmovies-api.proshantobarua70-4a5.workers.dev/movies";

const PAGE_SIZE = 100;

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=120"
  );

  res.end(
    type.includes("application/json") ? JSON.stringify(data) : data
  );
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

  let input = value.trim();

  // Handle escaped characters that may occur in copied data.
  input = input.replace(/\\([:/])/g, "$1");

  // Prefer the actual URL inside a Markdown link.
  const markdown = input.match(
    /\]\((https?:\/\/[^)\s]+)\)/i
  );

  let url;

  if (markdown) {
    url = markdown[1];
  } else {
    // Also accept plain URLs or Markdown containing a URL label.
    const matches = input.match(/https?:\/\/[^\s)\]]+/ig);
    if (!matches || !matches.length) return "";
    url = matches[matches.length - 1];
  }

  url = url
    .replace(/&amp;/g, "&")
    .replace(/[.,;]+$/, "");

  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }

    return parsed.href;
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

  if (
    kind === "tv" ||
    kind.includes("series") ||
    kind.includes("show")
  ) {
    return "tv";
  }

  if (kind.includes("movie") || kind === "film") {
    return "movie";
  }

  return kind || "unknown";
}

function normalizeSubtitles(rawSubs) {
  return parseArray(rawSubs)
    .map((sub) => {
      if (typeof sub === "string") {
        return {
          label: "Subtitle",
          url: cleanUrl(sub)
        };
      }

      sub = sub || {};

      return {
        label: sub.label || sub.language || "Subtitle",
        url: cleanUrl(sub.url || sub.href || sub.link || "")
      };
    })
    .filter((sub) => sub.url);
}

function normalizeLinks(rawLinks) {
  return parseArray(rawLinks)
    .map((raw) => {
      const link =
        typeof raw === "string" ? { url: raw } : raw || {};

      const url = cleanUrl(
        link.url || link.href || link.link || ""
      );

      if (!url) return null;

      return {
        title:
          link.quality ||
          link.title ||
          link.name ||
          link.label ||
          "Open source",
        url,
        quality: link.quality || "",
        source: link.source || "",
        subtitles: normalizeSubtitles(link.subs || link.subtitles)
      };
    })
    .filter(Boolean);
}

function normalizeItem(item) {
  const episodes = parseArray(item.episodes).map((episode) => {
    const name =
      episode.name ||
      (
        episode.s && episode.e
          ? "S" +
            episode.s +
            "E" +
            String(episode.e).padStart(2, "0")
          : "Episode"
      );

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

  const directLinks = normalizeLinks(item.links);

  // Include episode links in the top-level list as well.
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
    headers: {
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(
      "Cloudflare Worker returned HTTP " + response.status
    );
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
    throw new Error(
      "Worker response does not contain an items array"
    );
  }

  const totalValue = data.total ?? data.count ?? null;
  const total =
    totalValue !== null &&
    totalValue !== "" &&
    Number.isFinite(Number(totalValue))
      ? Number(totalValue)
      : null;

  return { items, total };
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
#status{color:#bac4d6;margin:14px 0;overflow-wrap:anywhere}
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
<div>Movies · TV · Anime · Source links</div>
</header>
<main>
<div class="controls">
<input id="search" placeholder="Search loaded items..." aria-label="Search">
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
<button id="prev" disabled>Previous</button>
<span id="page">Page 1</span>
<button id="next" disabled>Next</button>
</nav>
</main>
<script>
const $ = (id) => document.getElementById(id);

let currentPage = 1;
let items = [];
let canGoNext = false;
let loading = false;

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      ? url.href
      : "";
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
  a.textContent =
    link.title || link.quality || "Open source";

  parent.appendChild(a);

  for (const sub of link.subtitles || []) {
    const subUrl = safeUrl(sub.url);
    if (!subUrl) continue;

    const subtitle = document.createElement("a");
    subtitle.href = subUrl;
    subtitle.target = "_blank";
    subtitle.rel = "noopener noreferrer";
    subtitle.textContent =
      "Subtitle: " + (sub.label || "Open");

    parent.appendChild(subtitle);
  }
}

function render() {
  const query = $("search").value.trim().toLowerCase();
  const kind = $("kind").value;

  const filtered = items.filter((item) => {
    const matchesName =
      !query ||
      String(item.title).toLowerCase().includes(query);

    const matchesKind =
      kind === "all" || item.kind === kind;

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
    meta.textContent =
      item.kind.toUpperCase() +
      (item.year ? " · " + item.year : "");
    card.appendChild(meta);

    if (item.overview) {
      const overview = document.createElement("p");
      overview.textContent = item.overview;
      card.appendChild(overview);
    }

    const directBox = document.createElement("div");
    directBox.className = "links";

    for (const link of item.links || []) {
      addLink(directBox, link);
    }

    if (directBox.children.length) {
      card.appendChild(directBox);
    }

    const episodes = item.episodes || [];

    if (episodes.length) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");

      summary.textContent =
        "Episodes (" + episodes.length + ")";

      details.appendChild(summary);

      for (const episode of episodes) {
        const section = document.createElement("div");
        section.className = "episode";

        const heading = document.createElement("strong");
        heading.textContent = episode.name || "Episode";
        section.appendChild(heading);

        if (episode.overview) {
          const description = document.createElement("p");
          description.textContent = episode.overview;
          section.appendChild(description);
        }

        const episodeLinks = document.createElement("div");
        episodeLinks.className = "links";

        for (const link of episode.links || []) {
          addLink(episodeLinks, link);
        }

        if (!episodeLinks.children.length) {
          const none = document.createElement("div");
          none.className = "meta";
          none.textContent = "No links found for this episode";
          episodeLinks.appendChild(none);
        }

        section.appendChild(episodeLinks);
        details.appendChild(section);
      }

      card.appendChild(details);
    }

    if (
      !directBox.children.length &&
      !episodes.some((episode) => (episode.links || []).length)
    ) {
      const none = document.createElement("div");
      none.className = "meta";
      none.textContent = "No source links found";
      card.appendChild(none);
    }

    $("grid").appendChild(card);
  }

  $("status").textContent =
    filtered.length +
    " matching items · " +
    items.length +
    " loaded on this page";

  $("page").textContent = "Page " + currentPage;
  $("prev").disabled = loading || currentPage <= 1;
  $("next").disabled = loading || !canGoNext;
}

async function loadCatalog() {
  if (loading) return;

  loading = true;
  $("status").textContent =
    "Loading catalog page " + currentPage + "...";
  $("prev").disabled = true;
  $("next").disabled = true;

  try {
    const response = await fetch(
      "/api/catalog?page=" + currentPage,
      { cache: "no-store" }
    );

    const data = await response.json();

    if (!response.ok || data.ok !== true) {
      throw new Error(
        data.error || "Catalog request failed"
      );
    }

    items = Array.isArray(data.items) ? data.items : [];

    canGoNext =
      data.total !== null &&
      Number.isFinite(Number(data.total))
        ? currentPage * 100 < Number(data.total)
        : items.length === 100;
  } catch (error) {
    items = [];
    canGoNext = false;
    $("grid").replaceChildren();
    $("status").textContent =
      "Catalog error: " + error.message;
  } finally {
    loading = false;
    render();
  }
}

$("prev").addEventListener("click", () => {
  if (!loading && currentPage > 1) {
    currentPage--;
    loadCatalog();
  }
});

$("next").addEventListener("click", () => {
  if (!loading && canGoNext) {
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
    return send(
      res,
      200,
      pageHtml(),
      "text/html; charset=utf-8"
    );
  }

  if (pathname === "/health") {
    return send(res, 200, {
      ok: true,
      service: "ctg-movies-bridge",
      workerConfigured: Boolean(WORKER_API)
    });
  }

  if (pathname === "/api/catalog") {
    const requestedPage =
      Number(url.searchParams.get("page")) || 1;

    const page = Math.max(
      1,
      Math.min(10000, Math.floor(requestedPage))
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
        hint:
          "Check Cloudflare Worker reachability and response format."
      });
    }
  }

  return send(res, 404, {
    ok: false,
    error: "Not found"
  });
};
