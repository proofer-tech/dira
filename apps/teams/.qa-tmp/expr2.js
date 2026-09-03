(() => {
  const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(Boolean);
  return { title: document.title, buttons: Array.from(new Set(buttons)).slice(0, 40) };
})()
