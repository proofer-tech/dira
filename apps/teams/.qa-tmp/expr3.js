(() => ({ url: location.href, title: document.title, bodyLen: document.body ? document.body.innerHTML.length : -1, bodyText: document.body ? document.body.innerText.slice(0,300) : '' }))()
