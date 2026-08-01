# AI Backend — Supabase Edge Functions

Backend untuk 3 fitur AI di app (AI Custom Plan, Chat AI, Meal Plan). Lihat `docs/decisions.md`
ADR-008 untuk keputusan arsitektur & penyederhanaan yang diambil di pass ini, dan
`docs/deploy-supabase.md` untuk panduan deploy step-by-step (termasuk troubleshooting).

Ini kode TypeScript/Deno, terpisah total dari kode Kotlin di `shared/`/`androidApp/`/`iosApp/` —
tidak ikut ke-build/ke-package saat build KMP app. Client (`shared/.../data/*/datasource/
*RemoteDataSource.kt`) memanggil endpoint di sini lewat HTTP biasa, kontraknya didokumentasikan di
`docs/techspec/{ai-custom-plan,chat-ai,meal-plan}.md`.

## Struktur

```
supabase/
  config.toml              -- konfigurasi project (per-function JWT verification, dll)
  migrations/               -- schema SQL (tabel user_entitlement, ai_usage, exercise + seed data)
  functions/
    _shared/                 -- kode dipakai bareng oleh ketiga function (auth, entitlement,
                                 quota, LLM client, exercise catalog, context Postgres)
    ai-custom-plan-generate/  -- POST /v1/ai-custom-plan/generate (Subscribe only)
    chat-send/                 -- POST /v1/chat/send (Logged In minimum)
    meal-plan-generate/        -- POST /v1/meal-plan/generate (Subscribe only)
```

## Provider AI

Pakai [OpenRouter](https://openrouter.ai) (model saat ini: lihat `DEFAULT_MODEL` di
`_shared/llmClient.ts`) -- dipilih supaya ganti model/provider nanti cukup ubah 1 file, tidak
menyentuh 3 function-nya. Model gratis di OpenRouter suka berubah/dicabut sewaktu-waktu; kalau ada
error yang menyebut nama model, cek dulu apakah modelnya masih tersedia di
https://openrouter.ai/models sebelum curiga ke tempat lain.

## Setiap function di-deploy terpisah

Penting: mengubah file di `_shared/` **tidak otomatis** ter-apply ke function yang sudah
di-deploy. Tiap `supabase functions deploy <nama>` membekukan salinan kodenya sendiri. Kalau ubah
`_shared/`, deploy ulang **semua** function yang memakainya (lihat `docs/deploy-supabase.md`).

## Testing lokal

`.env.local` (di-gitignore, tidak pernah ke-commit) dipakai untuk `supabase functions serve` --
lihat `docs/deploy-supabase.md` §7b untuk setup-nya.
