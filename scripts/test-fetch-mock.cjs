const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "html.duckduckgo.com") {
    const robots = url.pathname === "/robots.txt";
    return new Response(
      robots ? "User-agent: *\nAllow: /" : "<html></html>",
      { headers: { "content-type": robots ? "text/plain" : "text/html" } },
    );
  }
  return originalFetch(input, init);
};
