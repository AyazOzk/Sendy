// Sendy background script

const MENU_ID = 'sendy-send';

browser.contextMenus.create({
  id: MENU_ID,
  title: "Send to Sendy",
  contexts: ['page', 'link'],
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const url = info.linkUrl || info.pageUrl || tab.url;
  await sendLink(url);
});

async function getSettings() {
  const { serverUrl, token } = await browser.storage.local.get(['serverUrl', 'token']);
  return { serverUrl, token };
}

async function sendLink(url) {
  const { serverUrl, token } = await getSettings();
  if (!serverUrl || !token) {
    browser.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Sendy',
      message: 'You must login to the server from settings first.',
    });
    browser.runtime.openOptionsPage();
    return;
  }
  try {
    const res = await fetch(`${serverUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: url }),
    });
    if (!res.ok) throw new Error('Request failed');
    browser.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Sendy',
      message: 'Link sent ✅',
    });
  } catch (err) {
    browser.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Sendy',
      message: 'Failed to send. Server unreachable.',
    });
  }
}

// Listen for messages from other scripts
browser.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'send-current-tab') {
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.url) sendLink(tab.url);
    });
  }
});
