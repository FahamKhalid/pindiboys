# PindiBoys

PindiBoys is a realtime Rawalpindi-style group and private chat app. Users join with only a name, then chat in the public Pindi Gang room or start private 1-on-1 chats from the online user list.

## Features

- Soft blue messenger dashboard design
- Join with only a display name
- Optional profile photo upload on join
- Four built-in preset avatars plus default initials
- Group and private chat
- Add online users as friends
- Create custom groups and add online users as members
- Chat inside custom groups
- Send emojis and voice messages
- Send local sticker-pack stickers by reference
- Uploaded profile images show beside names and messages
- New users do not receive old public group history
- Browser saved login with a 4 digit key
- Same username requires the same key on future login
- Saved browser login expires after 1 week of inactivity
- Returning users restore old chats, friends, and groups
- Typing indicators and unread badges

Friends, custom groups, and messages are restored for the same username/key account.

## Stickers

The local sticker pack uses Microsoft Fluent Emoji SVG assets under the MIT license. Assets are stored in `public/stickers/fluent`, and sticker messages send only a sticker id/reference instead of uploading image data each time.

## Tech Stack

- Node.js
- Express
- Socket.io
- Vanilla HTML, CSS, JavaScript
- PostgreSQL on Render

## Local Run

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Local development works without PostgreSQL. If `DATABASE_URL` is missing, messages are stored in memory and reset when the server restarts.

## Environment Variables

Create a `.env` file for local PostgreSQL testing:

```env
DATABASE_URL=postgresql://user:pass@host:5432/pindiboys
PORT=3000
NODE_ENV=development
```

Render will provide `DATABASE_URL` automatically when you add a PostgreSQL database.

## GitHub Push

If your GitHub repo is empty, run these commands from this folder:

```bash
git init
git add .
git commit -m "Initial PindiBoys chat app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

If the repo already has a remote:

```bash
git add .
git commit -m "Initial PindiBoys chat app"
git push
```

## Render Deploy

Use either Blueprint deploy with `render.yaml`, or create services manually.

Manual settings:

- Build Command: `npm install`
- Start Command: `node server.js`
- Environment: Node
- Add PostgreSQL database on Render free tier
- Add env var `DATABASE_URL` from the Render database internal connection string
- Add env var `NODE_ENV=production`

After deploy, open the Render web service URL and test with two browser tabs.
