(() => {
  const links = Array.from(document.querySelectorAll('a[href^="/p/"]')).map(a => a.getAttribute('href'));
  return { title: document.title, links: Array.from(new Set(links)).slice(0, 20) };
})()
