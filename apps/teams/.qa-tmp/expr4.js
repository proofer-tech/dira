(() => {
  const table = document.querySelector('table');
  if (!table) return { error: 'no table', bodyText: document.body.innerText.slice(0,2000) };
  const rows = Array.from(table.querySelectorAll('tbody tr'));
  const result = rows.map(tr => {
    const text = tr.innerText.replace(/\n/g, ' | ');
    const badges = Array.from(tr.querySelectorAll('[class*="badge"], span')).map(s => s.textContent.trim()).filter(Boolean);
    const buttons = Array.from(tr.querySelectorAll('button')).map(b => ({ text: b.textContent.trim(), disabled: b.disabled }));
    return { text, buttons };
  });
  return { rowCount: rows.length, rows: result };
})()
