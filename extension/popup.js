async function getSettings() {
  const { serverUrl, token } = await browser.storage.local.get(['serverUrl', 'token']);
  return { serverUrl, token };
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.style.color = isError ? '#ff453a' : '#30d158';
}

async function checkLogin() {
  const { serverUrl, token } = await getSettings();
  if (!serverUrl || !token) {
    document.getElementById('loggedArea').hidden = true;
    document.getElementById('notLoggedIn').hidden = false;
  }
}

async function sendText(text) {
  const { serverUrl, token } = await getSettings();
  if (!serverUrl || !token) return setStatus('Login first', true);
  try {
    const res = await fetch(`${serverUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error();
    setStatus('Sendildi ✅');
    document.getElementById('msgInput').value = '';
  } catch {
    setStatus('Sendilemedi, sunucuya ulaşılamıyor', true);
  }
}

document.getElementById('sendBtn').addEventListener('click', () => {
  const val = document.getElementById('msgInput').value.trim();
  if (!val) return setStatus('Cannot send an empty message', true);
  sendText(val);
});

document.getElementById('msgInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    document.getElementById('sendBtn').click();
  }
});

document.getElementById('sendTabBtn').addEventListener('click', async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    await sendText(tab.url);
    window.close();
  }
});

document.getElementById('openChatBtn').addEventListener('click', async () => {
  const { serverUrl, token } = await getSettings();
  if (!serverUrl || !token) return setStatus('Login first', true);
  await browser.tabs.create({ url: browser.runtime.getURL('chat.html') });
  window.close();
});

document.getElementById('settingsBtn').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});
document.getElementById('openOptionsBtn')?.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

checkLogin();

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
