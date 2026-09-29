// Signal Nodus closed on 2026-09-29. Every host and path answers 410 Gone with a short notice,
// and robots.txt asks crawlers to drop the site. The product's code stays in src/ and git history.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Signal Nodus has closed</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1024; color: #eaf2ff;
         font: 17px/1.5 system-ui, -apple-system, sans-serif; padding: 16px; box-sizing: border-box; }
  main { max-width: 34rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { margin: 0; color: #b8c4e0; }
</style>
</head>
<body>
<main>
<h1>Signal Nodus has closed</h1>
<p>The service stopped on 29 September 2026 and no longer collects or stores any data. Thank you to everyone who tried it.</p>
</main>
</body>
</html>`;

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(PAGE, {
      status: 410,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-robots-tag": "noindex",
        "cache-control": "public, max-age=3600",
      },
    });
  },
};
