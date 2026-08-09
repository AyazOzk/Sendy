

# Sendy
<p align="center">
  <img src="backend/public/icon.png" width="200"/>
</p>
Cross-device link chat: Send links to your own server with one click, see them instantly on all devices.

## Features

- **Cross-Device Sync:** Send and receive messages or notes instantly across all your connected devices.
- **Effortless Link Sharing:** Share links seamlessly with just one click.
- **Server-Side Thumbnails:** Automatically fetches and securely stores cover images and metadata for your shared links.
- **Import & Export:** Easily backup your entire chat history (including images) to a `.zip` file and restore it anywhere.
- **Device Support:** Comes with a fully compatible browser extension for Firefox. & Android support (**not just firefox mobile via [HTTP Shortcuts](https://github.com/Waboodoo/HTTP-Shortcuts).**).
- **The Perfect Opera Flow Alternative:** Enjoy the exact same seamless experience as Opera's "My Flow", but with 100% privacy and full control over your own self-hosted data.


## Requirements
- **Node.js** (v18.0 or higher recommended)

## How to Install?

**Server Side**
1. Download ```backend``` file.
2. Unzip in your server, then create a new ```.env``` file. Fill it with ```.env.example``` and edit.
**`.env.example`:**
```
PORT=4000
JWT_SECRET=write-long-secret-text
```
3. Use ```npm install``` in the backend folder. Then start the server with ```npm start```.



**Client Side**

For Firefox:
1. Install the [browser extension](https://github.com/AyazOzk/Sendy/releases/tag/publish) from ```about:addons``` with ```install from file```
   
For Android:
1. Download [HTTP Shortcuts](https://github.com/Waboodoo/HTTP-Shortcuts)
2. Download [HTTP Shortcuts config](https://github.com/AyazOzk/Sendy/blob/main/shortcuts.json)
3. Import your shortcuts.json
4. Edit IP and Token fields.
Token find scripts:
Powershell:
```
curl http://your_ip:4000/api/messages -X POST -H "Authorization: Bearer your_token" -H "Content-Type: application/json" -d "{
  \"text\": \"\"
}"
```
Bash:
```
curl http://your_ip:4000/api/messages -X POST -H "Authorization: Bearer your_token" -H "Content-Type: application/json" -d '{"text": "hi"}'
```
6. While you're on the site you want to share from your browser, just select the http shortcut from the share menu. It will send the link directly.

## Licence

This project is licensed under the GNU General Public License v3.0.
