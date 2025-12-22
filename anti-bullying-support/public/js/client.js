// Theme toggle
(function() {
  const root = document.documentElement;
  const toggle = document.getElementById('themeToggle');
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  if (toggle) {
    toggle.addEventListener('click', () => {
      const curr = document.documentElement.getAttribute('data-theme');
      const next = curr === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
    });
  }
})();

// Load config (contact info, quick replies)
async function loadConfig() {
  try {
    const res = await fetch('/config.json');
    return await res.json();
  } catch {
    return { contact: [], quickReplies: [] };
  }
}

function renderContactInfo(container, config) {
  if (!container || !config?.contact) return;
  container.innerHTML = config.contact.map(c =>
    `<div class="contact-item"><strong>${c.label}:</strong> ${c.value}</div>`
  ).join('');
}

function renderChips(container, items, onClick) {
  if (!container) return;
  container.innerHTML = '';
  items.forEach(text => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = text;
    btn.addEventListener('click', () => onClick(text));
    container.appendChild(btn);
  });
}

export { loadConfig, renderContactInfo, renderChips };