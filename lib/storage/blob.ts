/**
 * Storage abstraction — PlanoMagistra
 *
 * Implementação atual: Vercel Blob (tier gratuito 500 MB)
 * Env var necessária: BLOB_READ_WRITE_TOKEN (gerada em vercel.com → Storage → Blob)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GUIA DE MIGRAÇÃO PARA CLOUDFLARE R2 (quando atingir ~400 MB ou monetização)
 * ─────────────────────────────────────────────────────────────────────────────
 * Por que R2? Zero egress. Cada download do plano faz 1 fetch do arquivo original.
 * Com 1.000 professores × 10 planos/mês × 1 MB = 10 GB/mês de egress.
 * Vercel Blob: ~$1,20/mês de bandwidth. R2: $0.
 *
 * 1. Criar bucket R2 em dash.cloudflare.com → R2 → Create Bucket
 * 2. Gerar API Token com permissão de Object Read & Write
 * 3. Adicionar env vars:
 *    CF_R2_ACCOUNT_ID=xxx
 *    CF_R2_ACCESS_KEY_ID=xxx
 *    CF_R2_SECRET_ACCESS_KEY=xxx
 *    CF_R2_BUCKET_NAME=planomagistra-templates
 *    CF_R2_PUBLIC_URL=https://seu-dominio.r2.dev (ou custom domain)
 *
 * 4. npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 *
 * 5. Substituir as funções abaixo por:
 *
 *    import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
 *
 *    const r2 = new S3Client({
 *      region: "auto",
 *      endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
 *      credentials: {
 *        accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
 *        secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
 *      },
 *    });
 *
 *    export async function uploadFile({ path, buffer, contentType }) {
 *      await r2.send(new PutObjectCommand({
 *        Bucket: process.env.CF_R2_BUCKET_NAME,
 *        Key: path,
 *        Body: buffer,
 *        ContentType: contentType,
 *      }));
 *      return `${process.env.CF_R2_PUBLIC_URL}/${path}`;
 *    }
 *
 *    export async function downloadFile(url: string) {
 *      const key = url.replace(process.env.CF_R2_PUBLIC_URL + "/", "");
 *      const res = await r2.send(new GetObjectCommand({
 *        Bucket: process.env.CF_R2_BUCKET_NAME,
 *        Key: key,
 *      }));
 *      return Buffer.from(await res.Body!.transformToByteArray());
 *    }
 *
 *    export async function deleteFile(url: string) {
 *      const key = url.replace(process.env.CF_R2_PUBLIC_URL + "/", "");
 *      await r2.send(new DeleteObjectCommand({
 *        Bucket: process.env.CF_R2_BUCKET_NAME,
 *        Key: key,
 *      }));
 *    }
 *
 * 6. Para migrar arquivos existentes do Vercel Blob para R2, use o script:
 *    scripts/migrate-blob-to-r2.ts (implementar com listing + download + reupload)
 *
 * 7. Atualizar STORAGE_PROVIDER=r2 em .env e remover BLOB_READ_WRITE_TOKEN
 * ─────────────────────────────────────────────────────────────────────────────
 */
import "server-only";

import { put, del, head } from "@vercel/blob";

export interface UploadOptions {
  path: string;
  buffer: Buffer;
  contentType: string;
}

/** Upload a file. Returns the URL stored in Firestore. */
export async function uploadFile({ path, buffer, contentType }: UploadOptions): Promise<string> {
  const blob = await put(path, buffer, {
    access: "private",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob.url;
}

/** Download a file by its URL. Adds auth header for private Vercel Blob URLs. */
export async function downloadFile(url: string): Promise<Buffer> {
  const headers: Record<string, string> = {};
  if (url.includes("blob.vercel-storage.com") && process.env.BLOB_READ_WRITE_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`;
  }
  // cache: "no-store" bypasses the Vercel CDN so we always get the latest
  // version of overwritten files (same path, new content after each save).
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`Storage fetch failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Delete a file by its URL. */
export async function deleteFile(url: string): Promise<void> {
  await del(url);
}

/** Check if a file exists. Returns false if not found. */
export async function fileExists(url: string): Promise<boolean> {
  try {
    await head(url);
    return true;
  } catch {
    return false;
  }
}
