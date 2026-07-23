# AI Talent frontend

The browser talks only to same-origin `/api` routes. The Next.js API bridge then
forwards requests to FastAPI, whose default address is `http://127.0.0.1:8000`.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

To use a different backend address, copy `.env.local.example` to `.env.local`
and change `BACKEND_URL`, then restart Next.js.

## Verify

```bash
npm run lint
npm run build -- --webpack
```
