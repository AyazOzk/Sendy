let ws;
let serverUrl, token, currentDeviceId;

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function fetchImageBlobUrl(url) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

async function renderMessage(msg) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper';
  wrapper.dataset.id = msg.id;
  wrapper.dataset.url = msg.url || '';

  let content;
  if (msg.type === 'text') {
    content = document.createElement('div');
    content.className = 'text-bubble' + (msg.device_id && msg.device_id !== currentDeviceId ? ' other-device' : '');
    content.textContent = msg.text;
  } else {
    content = document.createElement('a');
    content.className = 'link-card' + (msg.status === 'pending' ? ' pending' : '');
    content.href = msg.url;
    content.target = '_blank';
    
    let imgHtml = '<div class="img-container"><div style="height:140px;background:var(--border-color)"></div></div>';
    if (msg.image) {
      const blobUrl = await fetchImageBlobUrl(`${serverUrl}${msg.image}`);
      if (blobUrl) imgHtml = `<div class="img-container"><img src="${blobUrl}" alt="cover" /></div>`;
    }
    
    content.innerHTML = `
      ${imgHtml}
      <div class="content">
        <h3>${escapeHtml(msg.title || msg.url)}</h3>
        <p>${escapeHtml(msg.description || '')}</p>
        <div class="link-card-site-container">
          <img src="https://www.google.com/s2/favicons?domain=${new URL(msg.url).hostname}&sz=32" class="site-favicon" alt="" onerror="this.style.display='none'">
          <div class="link-card-site">${escapeHtml(msg.site_name || new URL(msg.url).hostname)}</div>
        </div>
      </div>
    `;
  }

  const actionsCol = document.createElement('div');
  actionsCol.className = 'actions-col';

  const delBtn = document.createElement('button');
  delBtn.className = 'action-icon-btn delete';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete';
  delBtn.onclick = async () => {
    await fetch(`${serverUrl}/api/messages/${msg.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
  };
  actionsCol.appendChild(delBtn);

  if (msg.type === 'link') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-icon-btn copy';
    copyBtn.textContent = '🔗';
    copyBtn.title = 'Copy Link';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await navigator.clipboard.writeText(msg.url);
      copyBtn.textContent = '✓';
      setTimeout(() => copyBtn.textContent = '🔗', 2000);
    });
    actionsCol.appendChild(copyBtn);

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'action-icon-btn refresh';
    refreshBtn.textContent = '🔄';
    refreshBtn.title = 'Refresh Data';
    refreshBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      refreshBtn.textContent = '⏳';
      await fetch(`${serverUrl}/api/messages/${msg.id}/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
    });
    actionsCol.appendChild(refreshBtn);
  }

  wrapper.appendChild(actionsCol);
  wrapper.appendChild(content);
  return wrapper;
}

async function upsertMessage(msg) {
  const container = document.getElementById('messages');
  document.querySelector('.empty-hint')?.remove();
  let existing = container.querySelector(`[data-id="${msg.id}"]`);
  const newEl = await renderMessage(msg);
  if (existing) {
    existing.replaceWith(newEl);
  } else {
    container.appendChild(newEl);
    container.scrollTop = container.scrollHeight;
  }
}

let currentOffset = 0;
const limit = 100;
let allLoaded = false;
let isFetching = false;
let isSearchMode = false;

async function loadMessages(loadMore = false, loadAll = false) {
  if (isFetching || (allLoaded && !loadAll)) return;
  isFetching = true;

  const s = await browser.storage.local.get(['serverUrl', 'token', 'deviceId']);
  serverUrl = s.serverUrl;
  token = s.token;
  currentDeviceId = s.deviceId;
  const container = document.getElementById('messages');

  if (!serverUrl || !token) {
    container.innerHTML = '<div class="empty-hint">Not logged in. Login from Settings.</div>';
    isFetching = false;
    return;
  }

  try {
    let url = `${serverUrl}/api/messages?limit=${limit}&offset=${currentOffset}`;
    if (loadAll) url = `${serverUrl}/api/messages?all=true`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error();
    const messages = await res.json();
    
    if (messages.length < limit && !loadAll) allLoaded = true;

    const oldScrollHeight = container.scrollHeight;

    if (!loadMore) container.innerHTML = '';
    document.querySelector('.empty-hint')?.remove();

    if (messages.length === 0 && !loadMore) {
      container.innerHTML = '<div class="empty-hint">No messages yet. Send something below 👇</div>';
    } else {
      const fragment = document.createDocumentFragment();
      for (const m of messages) {
        fragment.appendChild(await renderMessage(m));
      }

      if (loadMore) {
        container.insertBefore(fragment, container.firstChild);
        container.scrollTop = container.scrollHeight - oldScrollHeight;
      } else {
        container.appendChild(fragment);
        container.scrollTop = container.scrollHeight;
      }
    }

    if (loadAll) {
      allLoaded = true;
      isSearchMode = true;
    }

    if (!loadMore && !loadAll && !ws) {
      connectWebSocket();
    }
  } catch {
    container.innerHTML = '<div class="empty-hint">Cannot reach server.</div>';
  }
  
  isFetching = false;
}

document.getElementById('messages').addEventListener('scroll', (e) => {
  if (e.target.scrollTop === 0 && !allLoaded && !isSearchMode) {
    currentOffset += limit;
    loadMessages(true, false);
  }
});

function connectWebSocket() {
  const wsUrl = serverUrl.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(token)}`;
  ws = new WebSocket(wsUrl);
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'message:created' || msg.type === 'message:updated') {
      upsertMessage(msg.message);
    } else if (msg.type === 'message:deleted') {
      document.querySelector(`[data-id="${msg.id}"]`)?.remove();
    } else if (msg.type === 'import:done') {
      loadMessages();
    }
  };
  ws.onclose = () => setTimeout(connectWebSocket, 3000);
}

async function send() {
  const input = document.getElementById('composer');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await fetch(`${serverUrl}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text }),
  });
}

document.getElementById('sendBtn').addEventListener('click', send);
document.getElementById('composer').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
document.getElementById('settingsBtn').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

document.getElementById('clearBtn').addEventListener('click', async () => {
  if (!serverUrl || !token) return;
  if (!confirm("Are you sure you want to permanently delete all chats and images?")) return;
  
  const res = await fetch(`${serverUrl}/api/messages`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (res.ok) {
    document.getElementById('messages').innerHTML = '<div class="empty-hint">Chat cleared.</div>';
  } else {
    alert("Clear failed.");
  }
});

document.getElementById('exportBtn').addEventListener('click', async () => {
  if (!serverUrl || !token) return;
  const res = await fetch(`${serverUrl}/api/messages/export/zip`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok) {
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sendy-export-${new Date().toISOString().slice(0,10)}.zip`;
    a.click();
  } else {
    alert("Export failed.");
  }
});

document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importInput').click();
});

document.getElementById('importInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !serverUrl || !token) return;
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const res = await fetch(`${serverUrl}/api/messages/import/zip`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    
    if (res.ok) {
      alert("Messages and images imported successfully!");
    } else {
      alert("Import failed.");
    }
  } catch (err) {
    alert("Error occurred during upload.");
  }
  
  e.target.value = '';
});

loadMessages();

// Search Filter Logic
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    
    if (!isSearchMode && query.length > 0) {
      loadMessages(false, true).then(() => filterRows(query));
    } else {
      filterRows(query);
    }
    
    function filterRows(q) {
      const rows = document.querySelectorAll('.message-wrapper');
      rows.forEach(row => {
        const url = (row.dataset.url || '').toLowerCase();
        const text = row.textContent.toLowerCase();
        if (url.includes(q) || text.includes(q)) {
          row.style.display = 'flex';
        } else {
          row.style.display = 'none';
        }
      });
    }
  });
}

// Dark Mode Logic
const darkModeBtn = document.getElementById('darkModeBtn');
if (darkModeBtn) {
  const currentTheme = localStorage.getItem('theme') || 'light';
  if (currentTheme === 'dark') {
    document.body.classList.add('dark-mode');
    darkModeBtn.textContent = '☀️';
  }
  darkModeBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    if (document.body.classList.contains('dark-mode')) {
      localStorage.setItem('theme', 'dark');
      darkModeBtn.textContent = '☀️';
    } else {
      localStorage.setItem('theme', 'light');
      darkModeBtn.textContent = '🌙';
    }
  });
}
