# Mahans Cloud Companion

Build a new application from scratch named MAHAN OS. This is an implementation project, not a mockup. Create a polished responsive React + TypeScript + Vite + Tailwind application with Lucide icons, dark/light themes, and complete English (en-US) and Persian (fa-IR) localization including true RTL/LTR layout, persisted language preference, localized dates, and a header language switcher.

PRODUCT: private personal cloud workspace combining Drive, Notion, media library, and desktop-like workspace. Premium restrained SaaS visual design: refined typography, carefully spaced sidebar, clean panels/cards, no excessive gradients/glassmorphism. Desktop sidebar and responsive mobile navigation.

ARCHITECTURE REQUIREMENT: Target Cloudflare Workers + TypeScript backend, D1 database, private R2 bucket, Workers static assets (or Pages if technically appropriate). Do NOT use Lovable/Supabase backend as a substitute and do not invent deployed bindings or credentials. Structure backend as a Worker API with typed bindings and documented wrangler.jsonc, D1 SQL migrations, R2 bindings, .dev.vars.example / .env.example, README, SECURITY.md. If the environment cannot run or deploy Cloudflare services, still implement the source/config and clearly document required manual Cloudflare setup. No secrets in client code.

Implement maintainable modular storage provider abstraction: StorageProvider interface for listFiles/uploadFile/downloadFile/deleteFile/renameFile/createFolder/getFileMetadata/getStorageUsage and capabilities; Cloudflare R2 native adapter as primary, generic S3-compatible adapter only where securely implementable (server-side credentials, AWS SigV4; no credentials sent to browser); MEGA adapter must be explicitly marked unsupported/not connected unless a verified supported API/auth method is actually implemented. Storage Connections UI with provider cards, status, test/disconnect flows, provider-specific capability display, per-file provider identity, browse provider. Never fake successful provider connectivity or usage.

Functional app areas: dashboard, file manager, media library, notes, global search, storage overview, storage connections, settings, login. Build the visual experience and implement functional client interactions against a typed API layer. Backend API must enforce owner-only auth and authorization on every protected endpoint, HttpOnly secure cookies, modern password hashing available in Workers runtime (use a reviewed implementation such as PBKDF2 WebCrypto if argon2 unavailable; never weak/plaintext), CSRF protection, rate limiting strategy, input validation, safe file access, no public R2 bucket, short-lived upload/download authorization. For R2 uploads use short-lived presigned URLs or a Worker-mediated authorization pattern; do not stream large files through Worker. For media implement authenticated range streaming / signed access. D1 schema with users, sessions, files, folders, notes, tags, note_tags, favorites, media_metadata, activity_records, storage_connections metadata (never plaintext credentials), indexes and migrations. Add pagination, search, sorting/filtering, upload progress/retry, drag-drop, breadcrumbs, file previews, notes autosave/tags/pin/copy, media player, storage stats derived from real DB metadata, and meaningful empty/loading/error states. Never use mock statistics or claim backend operations succeed if unconfigured.

IMPORTANT DELIVERY: Start with a real implementation and coherent architecture, not just a dashboard. Provide working UI states and typed API integration; make any unavailable backend setup explicit. Add tests for localization and direction switching, storage adapter contracts/error handling, auth and API utilities where feasible. Run build/typecheck/tests and fix errors. Do not deploy without Cloudflare credentials/authorization. Ensure README documents exact Cloudflare setup and deployment.

Design details: app brand MAHAN OS, sidebar sections Overview / Files / Media / Notes, then Storage / Connections, Settings. Dashboard greeting, quick actions, recent files and notes, storage usage. Build polished empty states instead of demo records. Language default Persian if sensible, but provide complete English. Ensure mixed-script content uses bidi isolation and correct input direction. Use accessible labels and keyboard support. Keep source maintainable and avoid unnecessary dependencies.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/929b1217-9633-4e22-aae0-db04864d4c0d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
